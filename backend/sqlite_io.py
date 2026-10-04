"""sqlite_io.py: SQLiteの入出力そのもの（接続・列の取得・後から足す列）。

**このモジュールは「どのDBか」を知らない。** 受け取ったパスを開き、渡された
接続の列を読み、頼まれた列を足すだけで、`DBS`（どのデータソースがあるか）も
パス設定マスタも見ない。だから`paths`より下、`db_access`より下の層に居られる。

分けた理由（§9.329、REVIEW 3-2）: 以前はこの層が`db_access.py`の中にあり、
`db_access`は同時に「置き場の答え（`DBS`／パス設定マスタ）」も持っていた。
そのため**接続の仕方を知りたいだけのモジュール**（`db_mirror`・`master_share`・
`master_repo`）が、置き場の答えごと読み込むことになり、**その置き場の答えは
`db_mirror`を必要とする**——輪ができる。輪は関数の中へimportを逃がして
避けていたが、逃がすと「誰が誰を必要とするか」がファイルの頭から読めなくなる。

**ここへ`DBS`やパス設定を持ち込まないこと。** 持ち込んだ瞬間に、分けた意味が
無くなる（`db_access`を読み込まずにSQLiteを開けることが、この層の値打ち）。
"""
from datetime import datetime
from urllib.parse import quote
import re
import sqlite3
import threading
import time

from .logging_setup import app_logger
from .quiet import quiet

# 接続はSQLiteのみ。以前はAccess(pyodbc)にも接続できたが、実機を含め全ての
# 接続先をSQLiteへ統一したため廃止した。古い設定が残っていても黙って落ちない
# よう、Accessの拡張子が指定されていたら理由を添えて弾く(_reject_access_path)。
ACCESS_SUFFIXES=('.accdb','.mdb')

def _reject_access_path(path):
 """Accessのパスが設定されていたら、何をすればよいかを添えて弾く。
    分岐を消すだけだと、古いパス設定が残った端末で「接続できない」理由が
    分からないまま失敗する。"""
 if str(path).lower().endswith(ACCESS_SUFFIXES):
  raise RuntimeError(
   f"Accessファイルへは接続できません(接続先はSQLiteへ統一しました): {path}\n"
   "マスタ管理 > パス設定 で .sqlite3 のパスを指定し、サーバーを再起動してください。")

# ========================================================================
# SQLite側のAccess SQL互換関数
#  - Now()/Nz()/CStr()/Val()はAccess独自のSQL関数。masters.py・汎用一覧
#    API(/api/table)側のSQL文言はそのまま流用し、これらをSQLite接続へ
#    ユーザー定義関数として登録することで差分を吸収する(呼び出し側のSQL
#    文字列を書き換えずに済む)。Max()はSQLite組込のMAX()とキーワードが
#    大小無視で一致するため登録不要。
#  - DATETIME列はISO8601文字列で保存し、detect_types+コンバータで
#    読み出し時に自動的にdatetimeオブジェックへ復元する(既存コードの
#    .isoformat()呼び出しをそのまま使えるようにするため)。
# ========================================================================
def _sqlite_now():return datetime.now().isoformat(sep=' ')
def _sqlite_nz(value,default):return default if value is None else value
def _sqlite_cstr(value):return '' if value is None else str(value)
def _sqlite_val(value):
 m=re.match(r'^\s*[+-]?\d+(\.\d+)?',str(value or ''))
 return float(m.group(0)) if m else 0.0
sqlite3.register_adapter(datetime,lambda dt:dt.isoformat(sep=' '))
sqlite3.register_converter('DATETIME',lambda b:datetime.fromisoformat(b.decode()))

def qi(s): return '['+str(s).replace(']',']]')+']'
def path_exists_safe(path):
 """存在を確かめる。ただし**判定できなかった場合はNone**を返す。

 pathlib の Path.exists() は OSError のうち ENOENT/ENOTDIR/EBADF/ELOOP と
 WinError 21/123/1921 だけを「無し」と読み替え、**それ以外はそのまま送出する**。
 ネットワーク共有では WinError 59(予期しないネットワークエラー)や
 64/1231 のように「一時的に問い合わせできない」種類のエラーが起こり、
 これらは送出される。存在確認のつもりの1行が例外の発生源になり、しかも
 メッセージが「ファイルが無い」ではなく生のネットワークエラーになるため、
 原因の見当がつかない(実際に、エクスプローラでも sqlite3.connect() でも
 開ける共有ファイルに対して、この行だけが WinError 59 で失敗した端末があった)。

 戻り値: True=ある / False=無い / None=確かめられなかった(共有が応答しない等)"""
 try:
  return path.exists()
 except OSError as e:
  app_logger().warning('存在確認に失敗しました(共有の応答不良の可能性): %s (%s)',path,e)
  return None

def _sqlite_ro_uri(path):
 """読み取り専用オープン用のfile: URIを組み立てる(str連結だとドライブレター
 区切りやUnicodeファイル名でURI解釈を誤り得るため、パーセントエンコードする)。
 UNC共有パス(\\\\server\\share\\...)は要注意: pathlibの標準as_uri()は
 file://server/share/...という2スラッシュ形式を返すが、これは"server"を
 URIのauthority部分と解釈させてしまい、SQLITE_ALLOW_URI_AUTHORITYでビルド
 されていない標準的なsqlite3モジュールでは"invalid uri authority"で拒否
 される(実際にsikalotnow_path等をUNC上の.sqlite3へ向けたときに発生した)。
 authorityを空のままサーバー名をpath側に含める4スラッシュ形式
 (file:////server/share/...)にするとこの制限を回避できる
 (SQLiteのURI filename仕様に沿った回避策)。

 **絶対パスに resolve() を掛けないこと**。resolve()はWindowsでは
 GetFinalPathNameByHandle を呼ぶ実ファイルアクセスで、共有が不安定だと
 ここでも WinError 59 等で失敗する。加えて UNC を「\\?\\UNC\\...」形式へ書き換える
 ことがあり、URIの組み立て前提が崩れる。相対パス(開発時のみ)の解決に必要な
 ときだけ resolve() する。"""
 target=path if path.is_absolute() else path.resolve()
 posix=target.as_posix()
 if posix.startswith('//'):
  return 'file://'+quote(posix)+'?mode=ro'
 return target.as_uri()+'?mode=ro'
class _ClosingConnection(sqlite3.Connection):
 """`with connect(...) as c:` を抜けたら**確定してから閉じる**接続（§9.563）。

 素の`sqlite3.Connection.__exit__`はコミット／ロールバックだけで閉じない。参照の輪を作るので
 GC が回るまでハンドルが残り、Windows ではそのファイルを置き換えも削除もできなかった（§9.270・§9.108）。
 107 か所の`with connect(...)`を書き換えず、接続を作る**この1か所**で塞ぐ。"""
 def __exit__(self,*exc):
  try:
   return super().__exit__(*exc)
  finally:
   self.close()


def connect(path,readonly=False,engine=None):
 """SQLiteへ接続する。engine引数は呼び出し側の互換のため残しているが
    'sqlite'以外は受け付けない。"""
 _reject_access_path(path)
 if engine not in (None,'sqlite'):
  raise ValueError(f"未対応のエンジンです(SQLiteのみ対応): {engine}")
 if readonly:
  # **開く前に存在確認をしない**。読みたいのはファイルそのもので、確認は
  # 別のファイルアクセス(os.stat)になる。共有越しでは「開けるのに stat だけ
  # 失敗する」ことがあり(WinError 59 等)、確認のつもりの1行が唯一の失敗
  # 原因になっていた。まず開き、失敗したときだけ理由を切り分ける。
  try:
   c=sqlite3.connect(_sqlite_ro_uri(path),uri=True,timeout=10,detect_types=sqlite3.PARSE_DECLTYPES,
                     factory=_ClosingConnection)
  except sqlite3.Error as e:
   found=path_exists_safe(path)
   if found is False:
    raise FileNotFoundError(f"データベースが見つかりません: {path}") from e
   raise RuntimeError(
    f"データベースを開けませんでした: {path}\n"
    f"SQLiteからの応答: {e}\n"
    +("共有フォルダの応答を確認できませんでした。ネットワーク共有への接続を確認してください。"
      if found is None else
      "ファイルはありますが開けませんでした。読み取り権限と、他プロセスによる排他を確認してください。")) from e
 else:
  path.parent.mkdir(parents=True,exist_ok=True)
  c=sqlite3.connect(str(path),timeout=10,detect_types=sqlite3.PARSE_DECLTYPES,factory=_ClosingConnection)
 # Now()/Nz()/CStr()/Val()はAccess方言のSQL関数。masters.pyのSQLが今もこの
 # 方言で書かれているため、SQLite側へユーザー定義関数として登録して吸収する。
 # **接続をSQLiteへ統一した後も残す**(消すと全マスタSQLの書き換えが要る)。
 c.create_function('Now',0,_sqlite_now);c.create_function('Nz',2,_sqlite_nz)
 c.create_function('CStr',1,_sqlite_cstr);c.create_function('Val',1,_sqlite_val)
 return c

# 列名の取得は「1行だけSELECTして description を見る」実装のため、共有越しの
# Access(SIKALOTNOW/SIKALOTDEF)では1往復まるごとかかる。列構成は運用中に
# 変わらないので短時間キャッシュする(docs/ARCHITECTURE.md「共有ファイルを
# 読む処理は回数が効く」)。一覧を開くたびの往復を1回減らす。
COLS_CACHE_TTL_SEC=60.0
_cols_cache={}
_cols_cache_lock=threading.Lock()

def invalidate_cols_cache():
 with _cols_cache_lock:_cols_cache.clear()

def cols(c,t,use_cache=True,source=None):
 """テーブルtの列名を、SELECT * と同じ並びで返す。

 **sourceを渡したときだけキャッシュする**。sourceは接続先を一意に表す値
 (DBファイルのパス)。呼び出し側が接続先を知っているときだけ渡すこと。

 以前は接続オブジェクトへ目印(_wavelog_source)を付けて接続先を引く実装
 だったが、sqlite3.Connectionは属性を追加でき
 ないC実装のため**目印付けは常に失敗**し、キャッシュキーが
 `id(type(c))`(=同じエンジンなら全DB共通の定数)へ落ちていた。結果、
 「同じ名前のテーブルを持つ別のDB」を続けて開くと、先に開いた方の列名が
 返り、`dict(zip(cols,row))`で**値が別の列名へ紐づく**(品質データの一覧で
 ロット№欄に日時が出る等)。列数が違えばzipで末尾が黙って捨てられもする。
 接続オブジェクトから接続先を推測するのは諦め、呼び出し側から明示的に
 受け取る。sourceが無ければキャッシュしない(速度より正しさを優先する)。
 """
 key=(str(source),str(t)) if (use_cache and source) else None
 if key:
  now=time.time()
  with _cols_cache_lock:
   hit=_cols_cache.get(key)
  if hit and (now-hit[0])<COLS_CACHE_TTL_SEC:return list(hit[1])
 cur=c.cursor()
 cur.execute(f"SELECT * FROM {qi(t)} LIMIT 1")
 out=[x[0] for x in cur.description]
 if key:
  with _cols_cache_lock:_cols_cache[key]=(time.time(),list(out))
 return out
def tables(c):
 if isinstance(c,sqlite3.Connection):
  cur=c.cursor();cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  return sorted({r[0] for r in cur.fetchall() if r[0]},key=str.casefold)
 return sorted({r.table_name for r in c.cursor().tables(tableType='TABLE') if r.table_name and not r.table_name.startswith(('MSys','USys','~'))},key=str.casefold)

# ========================================================================
# 後から足した列を「無ければ足す」（§9.315、利用者の報告）
# ------------------------------------------------------------------------
# 「起動時に *読み込みに失敗しました: … duplicate column name: 丸め方* と
#   出る。リロードすると正しく読める」
#
# 現場では**マスタを作り直さず「無ければ足す」で移行する**（§9.216 ②）。
# その処理はどこも `PRAGMA table_info` で今ある列を読み、無い列だけ
# `ALTER TABLE ADD COLUMN` する形だった——**読んでから足すまでのあいだに
# 別のリクエストが同じ列を足せる**。`flask_app.run(threaded=True)`（§9.98で
# 外さないと決めてある）なので、画面を開いた瞬間に走る何本かの問い合わせが
# 素直に重なる。2本とも「無い」と見て2本とも足しに行き、後の1本が
# `duplicate column name` で落ちる。
#
# **その版へ上げた最初の1回にしか起きない**（次からは列が在るのでALTERを
# 通らない）ので、**リロードすると直る**——原因に辿り着きにくいのはこのため。
#
# ここが唯一の窓口。**散らばった場所で気を付けるのではなく、入口で1回だけ
# 落とす**（§9.113）。「足そうとしたら既に在った」は**失敗ではない**
# ——他の誰かが今まさに足したということなので、そのまま先へ進む。
# ========================================================================
def _already_added(exc):
 """その失敗は「誰かが今足したところだった」か。**綴りで見るしかない**
    ——SQLiteはこれを専用のエラー番号で返さない。"""
 return 'duplicate column name' in str(exc).lower()

def add_missing_columns(c,table,columns,commit=True):
 """`columns`（(列名, 型) の並び）のうち**まだ無いものだけ**足す。

    戻り値は**実際に足した列名のリスト**（呼び出し側の「足したか」の判定に
    使う）。同時に走った別のリクエストが先に足していた場合は、その列は
    戻り値に入らない（足したのはこちらではない）。

    **例外は握り潰さない**——「既に在った」以外の失敗（権限・読み取り専用・
    ディスク）は呼び出し側へそのまま返す。黙って進むと、列が無いまま
    SELECTして別の場所で落ちる。"""
 try:existing=set(cols(c,table))
 except Exception as _e:quiet('列を読めない（足す列を決められないので何もしない）',_e);return []
 cur=c.cursor();added=[]
 for name,decl in columns:
  if name in existing:continue
  try:
   cur.execute(f'ALTER TABLE {qi(table)} ADD COLUMN {qi(name)} {decl}')
   added.append(name)
  except Exception as e:
   if not _already_added(e):raise
 if added and commit:c.commit()
 return added

# ========================================================================
# 更新対象者（ユーザーID）の管理
# ========================================================================
AUDIT_COLUMNS=(('登録者ID','TEXT'),('更新者ID','TEXT'))
def ensure_audit_columns(c,table):
 return bool(add_missing_columns(c,table,AUDIT_COLUMNS))
