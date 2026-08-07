"""db_access.py: SQLiteデータベースへの接続と共通ヘルパ。

- DBS: 画面から選択できるデータベース(仕掛/品質/マスタ)の定義
- MEAS_DB: 測定データのバックアップ先(db/records.sqlite3)
- connect/cols/tables/qi: 接続とスキーマ操作の基本関数(SQLite専用)
- パス設定マスタ: 仕掛/品質データの読み込み先・スケジュール共有パス等、
  アプリ運用中に変わり得るパス/間隔設定をdb/master.sqlite3側で管理する
  (旧config/local.json。詳細は下記「パス設定マスタ」節を参照)
- 監査列(登録者ID/更新者ID)とバックアップテーブルの整備

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の別システムが所有・書込する
読み取り専用だが、接続先は実機を含め全てSQLiteへ統一した(Access接続は廃止)。旧記述:
読み取る。一方、マスタ(オペレータ/設備/フィルタ等)と測定データバックアップは
本アプリ自身が読み書きするローカルストアのため、SQLite(db/フォルダ)へ移行した。
"""
from pathlib import Path
from datetime import datetime
from urllib.parse import quote
import sqlite3
import threading
import time

from .paths import APP_ROOT, configured_path, load_local_config
from .logging_setup import app_logger

# DBの置き場所は既定でAPP_ROOT/db。config/local.jsonの"db_dir"で上書き可能
# (未配置なら従来どおり)。個別ファイルの上書きはDBS['MASTER']['path']/
# MEAS_DBの設定時にconfigured_pathで別途反映する。
# ここ(db_dir/master_db_path/records_db_path)だけは、下記「パス設定マスタ」
# (db/master.sqlite3側)へ移行できない。マスタDB自体の置き場所を決める値を
# そのマスタDBの中に保存すると、読みに行く先が分からないまま読みに行く
# (鶏と卵)になるため、この3つに限り引き続きconfig/local.jsonが唯一の
# 設定手段(起動時に一度だけ読む、ブートストラップ専用の最小限のファイル)。
DB_DIR=configured_path('db_dir') or APP_ROOT/"db"
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")
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
 import re
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
   c=sqlite3.connect(_sqlite_ro_uri(path),uri=True,timeout=10,detect_types=sqlite3.PARSE_DECLTYPES)
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
  c=sqlite3.connect(str(path),timeout=10,detect_types=sqlite3.PARSE_DECLTYPES)
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
def cfg(k):
 if k not in DBS: raise ValueError('データベース指定が不正です')
 return DBS[k]

# ========================================================================
# 更新対象者（ユーザーID）の管理
# ========================================================================
AUDIT_COLUMNS=(('登録者ID','TEXT'),('更新者ID','TEXT'))
def ensure_audit_columns(c,table):
 try:existing=set(cols(c,table))
 except Exception:return False
 cur=c.cursor();changed=False
 for name,typ in AUDIT_COLUMNS:
  if name not in existing:
   cur.execute(f'ALTER TABLE {qi(table)} ADD COLUMN {qi(name)} {typ}');changed=True
 if changed:c.commit()
 return changed

# db/ 導入以前に使われていた置き場所とファイル名(新しい順)。db/に無い場合の
# 移行先探索にのみ使う(過去バージョンからの引き継ぎ用で、新規環境では未使用)。
_LEGACY_LOCATIONS=(APP_ROOT/"data",APP_ROOT)
def resolve_local_db(name,legacy_names):
 path=DB_DIR/name
 if path.exists():return path
 for base in _LEGACY_LOCATIONS:
  for old_name in legacy_names:
   old_path=base/old_name
   if old_path.exists():return old_path
 return DB_DIR/name

# マスタDB(db/master.sqlite3)自体の置き場所はブートストラップ専用設定
# (db_dir/master_db_path、上記参照)でのみ決まる。ここで先に確定させておく
# ことで、以降のパス設定マスタ読み込み(_master_path_config等)がこの値を
# 使える。
_MASTER_PATH=configured_path('master_db_path') or resolve_local_db('master.sqlite3',['マスタ.sqlite3','マスタデータ.sqlite3','Master.sqlite3'])
MEAS_DB=configured_path('records_db_path') or resolve_local_db('records.sqlite3',['測定データ.sqlite3','Measurement.sqlite3']); MEAS_ENGINE='sqlite'
SCHEDULE_CACHE_PATH=DB_DIR/'schedule_cache.sqlite3'

# ========================================================================
# パス設定マスタ（仕掛/品質データの読み込み先・共有パス等の運用設定）
#  - 旧config/local.json相当。マスタ管理画面(master-maint.jsの
#    MASTER_DEFS、key:pathConfig)から編集できるよう、db/master.sqlite3の
#    テーブルとして持つ(他の各種マスタと同じくキー1件=1行、値の無い項目は
#    行自体が無い＝既定値を使う、という互換ポリシー)。
#  - 本来ならbackend/repositories/master_repo.pyへ置く各種マスタと同じ
#    層だが、ここに置く（master_repo.pyへ置けない）理由: このモジュール
#    自身が起動直後にDBS/MEAS_DB等の接続先パスを1回だけ確定させる必要が
#    あり、master_repo.pyはdb_accessに依存する側(逆方向)のため、
#    db_access.py→master_repo.pyの参照は循環importになってしまう。
#  - path_config_rows/set_path_configは他マスタのCRUDと同じ形にして
#    routes/masters.pyから直接呼べるようにしてある。
# ========================================================================
PATH_CONFIG_TABLE='パス設定マスタ'
# プロセス起動時に1回だけ解決し、以後は再起動まで固定する項目(DBの接続先
# そのものを決めるため、実行中に切り替えると接続先が食い違う恐れがある)。
PATH_CONFIG_STATIC_KEYS=('sikalot_source','sikalotnow_path','sikalotdef_path','records_backup_export_path','schedule_share_path')
# 呼び出しのたびに読み直せる項目(間隔・タイムアウト値のみで、接続先には
# 影響しないため、変更を再起動無しで反映できる)。
# rne_extract_enabled: RNE抽出(定期実行)を動かすかどうか。
#   'auto'(既定) … sikalot_source=='local' のときだけ動かす(従来どおり)
#   'on'          … 取得元に関わらず動かす(共有から読みつつローカルも更新する等)
#   'off'         … 定期実行しない(手動の「今すぐ抽出」は別途いつでも実行できる)
# 抽出そのものは取得元と独立して動けるようにしてある(§9.50)。
PATH_CONFIG_LIVE_KEYS=('rne_extract_interval_sec','rne_extract_enabled','schedule_lock_ttl_sec','schedule_lock_verify_delay_ms',
                       'rne_assets_dir','rne_conf_path')
PATH_CONFIG_KEYS=PATH_CONFIG_STATIC_KEYS+PATH_CONFIG_LIVE_KEYS

def ensure_path_config_table(c):
 names=tables(c);created=False
 if PATH_CONFIG_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [パス設定マスタ] ([設定キー] TEXT PRIMARY KEY, [設定値] TEXT, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,PATH_CONFIG_TABLE)
 return created

def path_config_rows(c):
 """{設定キー: 設定値}を返す。テーブル未作成なら空(読み取り専用接続からも
 安全に呼べる。ensure_path_config_tableのようなCREATE/ALTERは行わない)。"""
 if PATH_CONFIG_TABLE not in tables(c):return {}
 cur=c.cursor();cur.execute('SELECT [設定キー],[設定値] FROM [パス設定マスタ]')
 return {str(k):str(v) for k,v in cur.fetchall() if k and v not in (None,'')}

def set_path_config(c,key,value,uid):
 """1項目を更新する。valueが空文字/Noneなら行を削除して既定値へ戻す
 (他マスタの完全同期方式と違い、こちらは1キーずつ独立して保存する)。"""
 ensure_path_config_table(c)
 value=str(value).strip() if value not in (None,'') else ''
 cur=c.cursor()
 if not value:
  cur.execute('DELETE FROM [パス設定マスタ] WHERE [設定キー]=?',[key])
 else:
  cur.execute('SELECT [設定キー] FROM [パス設定マスタ] WHERE [設定キー]=?',[key])
  if cur.fetchone():
   cur.execute('UPDATE [パス設定マスタ] SET [設定値]=?,[更新者ID]=?,[更新日時]=Now() WHERE [設定キー]=?',[value,uid,key])
  else:
   cur.execute('INSERT INTO [パス設定マスタ] ([設定キー],[設定値],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[key,value,uid,uid])
 c.commit()

def _master_path_config():
 """db/master.sqlite3のパス設定マスタを読み込む。ファイル/テーブルが
 まだ無ければ空(新規環境・未設定時は上書き無し=既定動作のまま)。"""
 try:
  if not _MASTER_PATH.exists():return {}
  with connect(_MASTER_PATH,True) as c:
   return path_config_rows(c)
 except Exception:
  return {}

def path_config_value(key,default=None):
 """マスタDBから都度読み直して1項目を返す(PATH_CONFIG_LIVE_KEYS向け。
 呼び出しのたびにdb/master.sqlite3を開き直すため、頻繁に呼ぶ用途には
 使わないこと)。sikalotnow_path等のPATH_CONFIG_STATIC_KEYSはプロセス
 起動時に1回だけ解決してDBS等へ反映する設計のため、こちらではなく
 起動時に確定した値(DBS/SCHEDULE_SHARE_PATH等)を使うこと。"""
 v=_master_path_config().get(key)
 return v if v not in (None,'') else default

# ========================================================================
# データソースマスタ（§9.79）
# ------------------------------------------------------------------------
# 「RNEから抽出して .sqlite3 を作り、それを一覧として読む」というのが、
# 参照データの唯一の作られ方。以前はその1本の流れが3箇所に分かれて
# ハードコードされていた:
#   ・何を抽出するか        rne_scheduler.JOBS
#   ・どこへ書くか          JOBS[].output
#   ・どこを読むか          db_access.DBS[].path
# 増やすには3箇所を直す必要があり、しかも**抽出先と読込先を別々に書ける**
# ため「抽出しているのに読まない」状態が作れてしまった。
# 1行=1データソースにして、作る側と読む側を隣り合う欄に置く。
#
# パス設定マスタと同じくここ(db_access.py)に自己完結させる。master_repo.py
# は db_access に依存する側なので、あちらへ置くと循環importになる。
# ========================================================================
DATA_SOURCE_TABLE='データソースマスタ'
# 既定の2件。マスタが空のときだけ入れる(初回起動・既存環境の互換)。
# 出力先/共有パスは下で解決するため、ここではファイル名だけを持つ。
_DEFAULT_DATA_SOURCES=(
 {'key':'SIKALOTNOW','label':'仕掛（現在）','rne':'SIKALOTNOW.RNE','table':'仕掛',
  'output':'sikalotnow.sqlite3','share':'SIKALOTNOW.sqlite3','preferred':'仕掛','order':10},
 {'key':'SIKALOTDEF','label':'品質データ','rne':'SIKALOTDEF.RNE','table':'仕掛',
  'output':'sikalotdef.sqlite3','share':'SIKALOTDEF.sqlite3','preferred':'仕掛','order':20},
)

def ensure_data_source_table(c):
 names=tables(c);created=False
 if DATA_SOURCE_TABLE not in names:
  c.cursor().execute(
   'CREATE TABLE [データソースマスタ] ('
   '[ソースID] INTEGER PRIMARY KEY AUTOINCREMENT, [キー] TEXT, [表示名] TEXT, '
   '[RNEファイル] TEXT, [抽出テーブル] TEXT, [出力ファイル] TEXT, [共有パス] TEXT, '
   '[既定テーブル] TEXT, [表示順] INTEGER, [有効] INTEGER, '
   '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 return created

def data_source_rows(c,include_disabled=False):
 """{キー: 設定}のリスト。テーブルが無ければ空(読み取り専用接続からも
 安全に呼べるよう、CREATEはしない)。"""
 if DATA_SOURCE_TABLE not in tables(c):return []
 cur=c.cursor()
 cur.execute('SELECT [ソースID],[キー],[表示名],[RNEファイル],[抽出テーブル],[出力ファイル],'
             '[共有パス],[既定テーブル],[表示順],[有効] FROM [データソースマスタ] '
             'ORDER BY [表示順],[キー]')
 out=[]
 for r in cur.fetchall():
  active=True if r[9] is None else bool(r[9])
  key=str(r[1] or '').strip()
  if not key or (not active and not include_disabled):continue
  out.append({'id':r[0],'key':key,'label':str(r[2] or '').strip() or key,
              'rne':str(r[3] or '').strip(),'table':str(r[4] or '').strip() or '仕掛',
              'output':str(r[5] or '').strip(),'share':str(r[6] or '').strip(),
              'preferred':str(r[7] or '').strip(),'order':int(r[8] or 0),'active':active})
 return out

_DATA_SOURCE_SEEDED_KEY='__data_sources_seeded__'

def seed_data_sources(c):
 """1件も無いときだけ既定を入れる。**既存環境の動作を変えないため**の種で、
 利用者が全部消した状態を勝手に復活させないよう「空のときだけ」に限る
 ……とすると全削除が復活してしまうので、パス設定マスタの移行と同じく
 一度きりの目印で判定する(_DATA_SOURCE_SEEDED_KEY)。"""
 ensure_data_source_table(c)
 if path_config_rows(c).get(_DATA_SOURCE_SEEDED_KEY):return False
 cur=c.cursor()
 cur.execute('SELECT COUNT(*) FROM [データソースマスタ]')
 if int(cur.fetchone()[0] or 0)==0:
  for d in _DEFAULT_DATA_SOURCES:
   cur.execute('INSERT INTO [データソースマスタ] ([キー],[表示名],[RNEファイル],[抽出テーブル],'
               '[出力ファイル],[共有パス],[既定テーブル],[表示順],[有効],[登録者ID],[更新者ID],'
               '[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
               [d['key'],d['label'],d['rne'],d['table'],d['output'],d['share'],
                d['preferred'],d['order'],'seed','seed'])
 set_path_config(c,_DATA_SOURCE_SEEDED_KEY,'done','seed')
 c.commit()
 return True

def _master_data_sources():
 try:
  if not _MASTER_PATH.exists():return []
  with connect(_MASTER_PATH,False) as c:
   seed_data_sources(c)
   return data_source_rows(c)
 except Exception as e:
  app_logger().warning('データソースマスタを読めませんでした(既定の2件で続行します): %s',e)
  return []

_VALID_SIKALOT_SOURCES=('network','local')
# 移行済みかどうかの目印。パス設定マスタ自身に1行として保存する(移行専用の
# 別テーブル/別ファイルを増やさないため)。PATH_CONFIG_KEYSに含めていない
# ため、path_config_value等の通常の参照経路には出てこない。
# これが無いと、移行後にマスタ管理画面から値を空へ戻して既定に戻しても、
# 次回起動時に「マスタ側に値が無い(削除された)」→「config/local.jsonから
# また複製する」を繰り返し、UIでの削除操作が復活してしまう不具合になる。
_MIGRATION_MARKER_KEY='__legacy_json_migrated__'

def _migrate_legacy_path_config():
 """旧config/local.jsonにあった値を、初回起動時に一度だけパス設定マスタへ
 複製する(後方互換の一度きりの移行)。一度移行が済んだら_MIGRATION_MARKER_KEY
 を残し、以後はconfig/local.jsonの内容を一切見ない(マスタ管理画面での編集・
 削除を正とする。sikalot_sourceが'network'/'local'以外の値(誤記・別項目の
 値の書き間違い等)なら、誤った値をそのまま引き継がず読み捨ててログへ残す。"""
 try:
  legacy=load_local_config()
  if not legacy:return
  current=_master_path_config()
  if _MIGRATION_MARKER_KEY in current:return
  updates={}
  for key in PATH_CONFIG_STATIC_KEYS+PATH_CONFIG_LIVE_KEYS:
   if key=='sikalot_source':continue
   value=legacy.get(key)
   if value not in (None,''):updates[key]=str(value)
  src=legacy.get('sikalot_source')
  if src in _VALID_SIKALOT_SOURCES:updates['sikalot_source']=src
  elif src:
   app_logger().warning('config/local.jsonのsikalot_source(%r)は"network"/"local"以外の値のため移行しませんでした(値の書き間違いの可能性があります)。マスタ管理 > パス設定から選び直してください。',src)
  with connect(_MASTER_PATH,False) as c:
   for key,value in updates.items():
    set_path_config(c,key,value,'migrate:config/local.json')
   set_path_config(c,_MIGRATION_MARKER_KEY,'done','migrate:config/local.json')
  if updates:
   app_logger().info('config/local.jsonの設定%d件をパス設定マスタへ移行しました: %s',len(updates),sorted(updates))
 except Exception as e:
  app_logger().warning('config/local.jsonからパス設定マスタへの移行に失敗しました: %s',e)

_migrate_legacy_path_config()
# プロセス起動時に1回だけ読み込むスナップショット。PATH_CONFIG_STATIC_KEYS
# (接続先を決める項目)はこれを使う。以降にマスタ管理画面から変更しても、
# このプロセスでは反映されない(再起動が必要。config/local.json時代から
# 変わらない既存の制約)。
_PATH_CONFIG=_master_path_config()
def _static_path_cfg(key,default=None):
 v=_PATH_CONFIG.get(key)
 return v if v not in (None,'') else default

_sikalot_source_raw=_static_path_cfg('sikalot_source')
if _sikalot_source_raw and _sikalot_source_raw not in _VALID_SIKALOT_SOURCES:
 app_logger().warning('パス設定マスタのsikalot_source(%r)は"network"/"local"以外の値のため、既定のnetworkとして扱います。',_sikalot_source_raw)
 _sikalot_source_raw=None
# 仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)の読み込み元は既定でネットワーク
# 共有上のAccessファイル(工場側システムが所有)だが、パス設定マスタの
# "sikalot_source"="local"にすると、WaveLog自身がRNE経由で定期的に抽出・
# 更新するローカルSQLite3(db/sikalotnow.sqlite3・db/sikalotdef.sqlite3、
# backend/rne_scheduler.pyが背景スレッドで更新)を読む運用に切り替えられる。
# ネットワーク共有への到達性が無い/不安定な環境向けの切替で、2つのDBを
# まとめて1つのスイッチで切り替える(個別切替は用途が無いため)。
SIKALOT_SOURCE='local' if _sikalot_source_raw=='local' else 'network'
SIKALOTNOW_LOCAL_PATH=DB_DIR/"sikalotnow.sqlite3"
SIKALOTDEF_LOCAL_PATH=DB_DIR/"sikalotdef.sqlite3"
# "sikalotnow_path"/"sikalotdef_path"による明示的な上書き(検証用に手元へ
# 複製したファイルを指す、等)はsikalot_sourceの切替より常に優先する
# (従来からの開発/検証用の上書き挙動を変えないため)。上書き先の拡張子が
# .sqlite3等であれば自動的にSQLiteとして接続する(_engine_for)。
def _source_path(entry):
 """1件のデータソースが「今どこを読むか」を決める。優先順位は
    (1) パス設定マスタの個別上書き(sikalotnow_path 等。検証用に手元の複製へ
        向ける従来の仕掛けで、常に最優先)
    (2) sikalot_source が local なら 出力ファイル(RNEで作った成果物)
    (3) それ以外は 共有パス
    相対パスは、出力ファイルは db/、共有パスは仕掛の共有フォルダを基点にする
    (現場は「ファイル名だけ」を入れることが多く、絶対パスを強制すると
    設定の手間と打ち間違いが増えるため)。"""
 override=_static_path_cfg(f"{entry['key'].lower()}_path")
 if override:return Path(override)
 local=entry.get('output') or ''
 share=entry.get('share') or ''
 if SIKALOT_SOURCE=='local' and local:
  p=Path(local);return p if p.is_absolute() else DB_DIR/p
 if share:
  p=Path(share);return p if p.is_absolute() else SIKA_DIR/p
 if local:
  p=Path(local);return p if p.is_absolute() else DB_DIR/p
 return DB_DIR/f"{entry['key'].lower()}.sqlite3"

DATA_SOURCES=_master_data_sources() or [
 # マスタを読めなかった場合の保険。既定の2件で従来どおり動かす。
 {'key':d['key'],'label':d['label'],'rne':d['rne'],'table':d['table'],
  'output':d['output'],'share':d['share'],'preferred':d['preferred'],
  'order':d['order'],'active':True,'id':None}
 for d in _DEFAULT_DATA_SOURCES]

DBS={s['key']:{"path":_source_path(s),"label":s['label'],"role":"readonly",
               "preferred":s.get('preferred') or s.get('table') or '仕掛',
               "engine":"sqlite","source":s}
     for s in DATA_SOURCES}
DBS["MASTER"]={"path":_MASTER_PATH,"label":"マスタ一覧","role":"master",
               "preferred":"オペレータマスタ","engine":"sqlite"}
# 閲覧用の追加複製先(パス設定マスタの"records_backup_export_path")。
# 未設定ならNoneのままで、records_export.pyは複製を一切行わない(既定は現状維持)。
_records_backup_export_override=_static_path_cfg('records_backup_export_path')
RECORDS_BACKUP_EXPORT_PATH=Path(_records_backup_export_override) if _records_backup_export_override else None

# スケジュール機能(docs/SCHEDULE_MODE_DESIGN.md §4)のデータ本体。共有環境
# (Box等)上のパスをパス設定マスタの"schedule_share_path"で指定する。
# 未設定ならNoneのままで、backend/schedule_sync.pyはScheduleNotConfiguredを
# 送出し、機能自体が無効になる(仕掛/品質データのsikalotnow_path等と同じく、
# 検証時はここをローカルの空ファイルへ一時的に切り替えて安全に試せる)。
_schedule_share_override=_static_path_cfg('schedule_share_path')
SCHEDULE_SHARE_PATH=Path(_schedule_share_override) if _schedule_share_override else None

def ensure_backup_table(c):
 names=tables(c)
 if 'Web測定バックアップ' not in names:
  c.cursor().execute('CREATE TABLE [Web測定バックアップ] ([記録ID] TEXT, [設備] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, [状態] TEXT, [更新日時] DATETIME, [圧縮形式] TEXT, [ペイロード] TEXT)')
  c.commit()

def request_user_id(x):
 x=x or {}
 for k in ('user_id','userId','updated_by','更新者ID'):
  v=str(x.get(k) or '').strip()
  if v:return v[:50]
 # 指定が無ければ端末のログインIDを使う。画面からの操作は必ず利用者IDを
 # 送るが、直接APIを叩いた場合に空文字のまま[更新者ID]へ入ると「誰が変えたか」
 # が残らない。分かる範囲で埋めておく(監査列は空より端末の主が有用)。
 # access_mode側がdb_accessを読むため、循環importにならないよう遅延取得する。
 try:
  from .access_mode import current_login_id
  return str(current_login_id() or '')[:50]
 except Exception:
  return ''

def read_backup_rows(path):
 # [Web測定バックアップ]テーブルを読み取り専用で読む共通処理。
 # backend/routes/measurement.py(PC引継ぎ用/閲覧モード一覧)と
 # backend/schedule_calc.py(実績突合、docs/SCHEDULE_MODE_DESIGN.md §7.4)が
 # 共用する。書き込みは一切行わない。戻り値: (行のlist of dict, path)。
 # ファイル自体が無ければ (None, path)。
 # 存在確認そのものが例外の発生源にならないようにする(path_exists_safe)。
 # 「無い」と分かったときだけ打ち切り、**確かめられなかったときは開きにいく**
 # ——共有越しでは stat だけ失敗して open は成功することがあるため
 # (WinError 59。読めるかどうかは実際に開いた結果で決める)。
 if path is None or path_exists_safe(path) is False:return None,path
 with connect(path,True) as c:
  if 'Web測定バックアップ' not in tables(c):return [],path
  cur=c.cursor()
  cur.execute('SELECT [記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード] FROM [Web測定バックアップ] ORDER BY [更新日時] DESC')
  rows=cur.fetchall()
 return [{'id':str(r[0] or ''),'equipment':str(r[1] or ''),'lotNo':str(r[2] or ''),'inspectionNo':str(r[3] or ''),'castingNo':str(r[4] or ''),'status':str(r[5] or ''),'updated_at':r[6].isoformat() if r[6] else None,'codec':str(r[7] or ''),'payload':str(r[8] or '')} for r in rows],path

# ---------- 実績バックアップ読込のキャッシュ(docs/SCHEDULE_MODE_DESIGN.md §9.41) ----------
# RECORDS_BACKUP_EXPORT_PATHは閲覧用複製(Box等のネットワーク共有)を指すのが
# 普通で、merged_backup_rows()は毎回そのテーブルを**全件**読む。作業スケジュールの
# 俯瞰ボードは設備数だけexpand_plan()を回すため、10設備なら同じ全件読込が10回
# 走っていた(load_factorのモデル計算も設備ごとに読むため、実測では1画面で
# read_backup_rows()が60回)。共有越しではこれがそのまま待ち時間になる。
#
# 中身は「測定端末が保存したときだけ」変わる。ファイルの署名(更新時刻+サイズ)で
# 変化を検出し、変わっていなければ読み直さない。TTL内は署名の確認(stat)すら
# 省く(statも共有越しでは往復が発生するため)。
BACKUP_ROWS_CACHE_TTL_SEC=20.0
_backup_rows_cache={'rows':None,'ts':0.0,'sig':None}
_backup_rows_lock=threading.Lock()

def _backup_sources_signature():
 sig=[]
 for path in (MEAS_DB,RECORDS_BACKUP_EXPORT_PATH):
  try:
   st=path.stat();sig.append((str(path),st.st_mtime_ns,st.st_size))
  except Exception:
   sig.append((str(path),None,None))
 return tuple(sig)

def invalidate_backup_rows_cache():
 # 測定データを保存した直後など、次の読込で必ず取り直したいときに呼ぶ。
 # 署名でも変化は拾えるが、同一秒内の連続書込を取りこぼさないよう
 # 明示的に捨てられる口を用意しておく。
 with _backup_rows_lock:
  _backup_rows_cache['rows']=None;_backup_rows_cache['ts']=0.0;_backup_rows_cache['sig']=None

def _merged_backup_rows_uncached():
 # MEAS_DB(書込端末のローカルrecords.sqlite3)とRECORDS_BACKUP_EXPORT_PATH
 # (閲覧用複製、Box等)の両方から[Web測定バックアップ]を集め、記録IDごとに
 # 更新日時が新しい方を残す。schedule_calc.py(実績突合、§7.4)・
 # load_factor.py(換算係数モデルの学習、§6.6)が共用する。どちらの端末
 # (書込端末そのもの/閲覧・スケジュール専用端末)から呼んでも同じ実績が
 # 見える。
 merged={}
 for path in (MEAS_DB,RECORDS_BACKUP_EXPORT_PATH):
  try:
   items,_=read_backup_rows(path)
  except Exception:
   items=None
  for row in (items or []):
   rid=row.get('id')
   if not rid:continue
   existing=merged.get(rid)
   if existing is None or (row.get('updated_at') or '')>(existing.get('updated_at') or ''):
    merged[rid]=row
 return list(merged.values())

def merged_backup_rows(force=False):
 # MEAS_DB(書込端末のローカルrecords.sqlite3)とRECORDS_BACKUP_EXPORT_PATH
 # (閲覧用複製、Box等)の両方から[Web測定バックアップ]を集め、記録IDごとに
 # 更新日時が新しい方を残す。schedule_calc.py(実績突合、§7.4)・
 # load_factor.py(換算係数モデルの学習、§6.6)が共用する。どちらの端末
 # (書込端末そのもの/閲覧・スケジュール専用端末)から呼んでも同じ実績が
 # 見える。結果は上記のとおりキャッシュする(§9.41)。
 now=time.time()
 if not force:
  with _backup_rows_lock:
   cached=_backup_rows_cache['rows']
   if cached is not None and (now-_backup_rows_cache['ts'])<BACKUP_ROWS_CACHE_TTL_SEC:
    return cached
 sig=_backup_sources_signature()
 if not force:
  with _backup_rows_lock:
   cached=_backup_rows_cache['rows']
   if cached is not None and _backup_rows_cache['sig']==sig:
    # 中身は変わっていない。読み直さず、鮮度だけ更新して使い回す。
    _backup_rows_cache['ts']=now
    return cached
 rows=_merged_backup_rows_uncached()
 with _backup_rows_lock:
  _backup_rows_cache['rows']=rows;_backup_rows_cache['ts']=time.time();_backup_rows_cache['sig']=sig
 return rows
