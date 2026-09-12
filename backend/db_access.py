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
import hashlib
import json as _json
import threading
import time

from . import paths
from .textnorm import normalize_equipment_name
from .paths import APP_ROOT, configured_path, load_local_config, local_config_error
from .logging_setup import app_logger
from .quiet import quiet
# SQLiteの入出力そのもの（接続・列・後から足す列）は backend/sqlite_io.py が持つ
# （§9.329）。ここから名前を再公開しているのは、`db_access.connect(...)` 等で
# 呼んでいる既存の約100箇所を1つも書き換えないため。**新しく書くコードは
# sqlite_io から直に読むこと**——置き場の答え（DBS・パス設定マスタ）が要らない
# のに db_access を読み込むと、分けたはずの輪が戻る。
from .sqlite_io import (  # noqa: F401 既存の呼び出し互換のための再公開（§9.329）
 ACCESS_SUFFIXES,_reject_access_path,
 _sqlite_now,_sqlite_nz,_sqlite_cstr,_sqlite_val,
 qi,path_exists_safe,_sqlite_ro_uri,connect,
 COLS_CACHE_TTL_SEC,invalidate_cols_cache,cols,tables,
 _already_added,add_missing_columns,AUDIT_COLUMNS,ensure_audit_columns)

# DBの置き場所は既定でAPP_ROOT/db。config/local.jsonの"db_dir"で上書き可能
# (未配置なら従来どおり)。個別ファイルの上書きはDBS['MASTER']['path']/
# MEAS_DBの設定時にconfigured_pathで別途反映する。
# ここ(db_dir/master_db_path/records_db_path)だけは、下記「パス設定マスタ」
# (db/master.sqlite3側)へ移行できない。マスタDB自体の置き場所を決める値を
# そのマスタDBの中に保存すると、読みに行く先が分からないまま読みに行く
# (鶏と卵)になるため、この3つに限り引き続きconfig/local.jsonが唯一の
# 設定手段(起動時に一度だけ読む、ブートストラップ専用の最小限のファイル)。
DB_DIR=paths.db_dir()
# 作り直せるファイル(共有からの写し・スケジュールの作業コピー)の置き場は
# DB_DIRとは別に決まる(§9.109)。DB_DIRが共有/クラウド同期フォルダーの上
# だと、Windowsでは置き換えが拒まれて更新できなくなるため、その場合だけ
# 自動でユーザー別のローカル領域へ逃がす。**本物のデータ(マスタ・測定
# データ)はDB_DIRのまま**——黙って移すと、同期されているつもりのデータが
# 同期対象から外れる。
WORK_DIR=paths.work_dir()
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")
def cfg(k):
 """そのデータソースの設定。**読む場所は写し(あれば)を指す**(§9.89)。

 共有上の .sqlite3 は別PCの別アプリが更新しており、直接読むと更新と
 重なったときに正しく読めない。db_mirror が手元へ写しているので、
 読むときはそちらを見る。設定として保存されている元のパスは
 ['path_remote'] に残す(パス設定画面・接続診断はこちらを使う)。"""
 if k not in DBS:
  # **何が正しいのかまで書く。** 以前は「不正です」だけを返しており、
  # データソースマスタでキーを変えた端末では、左メニューに残った古いキーの
  # ボタンがこの文言だけを出して原因に辿り着けなかった(実機で発生)。
  raise ValueError(f'データベース指定が不正です（指定: {k or "(空欄)"} / '
                   f'選べるのは: {"、".join(DBS)}）。'
                   'マスタ管理 > データソースの「キー」と合っているか確認してください。')
 entry=DBS[k]
 if entry.get('role')!='readonly':return entry
 try:
  from . import db_mirror
  local=db_mirror.read_path(k,entry['path'])
 except Exception as _e:
  quiet('写しの場所を引けない（元のパスをそのまま読む）',_e)
  return entry
 if Path(local)==Path(entry['path']):return entry
 out=dict(entry);out['path_remote']=entry['path'];out['path']=Path(local);out['mirrored']=True
 return out


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

# ブートストラップ設定(config/local.json)を**読めなかったことを黙らせない**
# (§9.271、利用者の報告「master_db_pathを書いたのに正しく読み込んでいない」)。
# ここは値を実際に使う場所なので、効いていないことに気づける唯一の場所。
_LOCAL_CFG_ERROR=local_config_error()
if _LOCAL_CFG_ERROR:
 app_logger().warning('%s この端末の置き場は既定のままで動いています。',_LOCAL_CFG_ERROR)

# 設定値 -> 実際のDBファイル。**フォルダを書いてもよい**(§9.271)。
# 利用者は「この共有フォルダに master.sqlite3 と schedule.sqlite3 を置きたい」と
# 考えるので、置き場の綴りはどれも同じ約束にする(スケジュールは§9.262で
# 既にそうなっており、**マスタと測定データだけが違った**)。
# 判定は**綴りだけ**——共有越しでは`is_dir()`が失敗することがあり、
# 存在確認そのものが唯一の失敗原因になるのを避ける(§9.262と同じ理由)。
DB_FILE_SUFFIXES=('.sqlite3','.db','.sqlite')
def resolve_db_file(raw,filename):
 text=str(raw or '').strip().rstrip('\\/')
 if not text:return None
 p=Path(text)
 return p if p.suffix.lower() in DB_FILE_SUFFIXES else p/filename

# マスタDB(db/master.sqlite3)自体の置き場所はブートストラップ専用設定
# (db_dir/master_db_path、上記参照)でのみ決まる。ここで先に確定させておく
# ことで、以降のパス設定マスタ読み込み(_master_path_config等)がこの値を
# 使える。
_MASTER_PATH_CONFIGURED=resolve_db_file(configured_path('master_db_path'),'master.sqlite3') or resolve_local_db('master.sqlite3',['マスタ.sqlite3','マスタデータ.sqlite3','Master.sqlite3'])
# マスタを共有に置いたときは**手元の写しを読む**(§9.263)。共有でなければ
# 設定どおりのパスがそのまま返るので、手元に置いている端末は何も変わらない。
# **ここで1回だけ差し替える**——以降のコードは今までどおり`_MASTER_PATH`
# （＝`DBS['MASTER']['path']`）を開けばよく、72箇所を書き換えずに済む。
from . import master_share as _master_share
_MASTER_PATH=_master_share.configure(_MASTER_PATH_CONFIGURED)
MEAS_DB=resolve_db_file(configured_path('records_db_path'),'records.sqlite3') or resolve_local_db('records.sqlite3',['測定データ.sqlite3','Measurement.sqlite3']); MEAS_ENGINE='sqlite'
# 共有スケジュールDBのローカル作業コピー。**共有から取り直せる**ので
# WORK_DIR側(§9.109)。毎回の取得で丸ごと置き換えるため、共有・クラウド
# 同期フォルダーの上にあると置き換えを拒まれる(§9.108)。
SCHEDULE_CACHE_PATH=WORK_DIR/'schedule_cache.sqlite3'

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
# **データソースごとの読み込み先(<キー小文字>_path)はここに並べない**(§9.163)。
# データソースは利用者が増減できるので、固定で書くと増やしたぶんが漏れる。
# 名前は source_override_key() が作り、値は path_config_rows() が
# キーで絞らずに読む（＝登録されたぶんだけ自然に効く）。
# 下の2件は既定のデータソースぶんで、config/local.json からの一度きりの
# 移行(_migrate_legacy_path_config)のために名前を残してある。
PATH_CONFIG_STATIC_KEYS=('sikalot_source','sikalotnow_path','sikalotdef_path','records_backup_export_path','schedule_share_path',
                         # 測定データの置き場(§9.258)。接続先と同じ扱いで再起動が要る。
                         # **この一覧に入れ忘れると、保存はできるのに読み出せない**
                         # ——画面の欄が空のままになり「保存されていない」と読まれる。
                         'records_share_dir')
# 呼び出しのたびに読み直せる項目(間隔・タイムアウト値のみで、接続先には
# 影響しないため、変更を再起動無しで反映できる)。
# rne_extract_enabled: RNE抽出(定期実行)を動かすかどうか。
#   'auto'(既定) … sikalot_source=='local' のときだけ動かす(従来どおり)
#   'on'          … 取得元に関わらず動かす(共有から読みつつローカルも更新する等)
#   'off'         … 定期実行しない(手動の「今すぐ抽出」は別途いつでも実行できる)
# 抽出そのものは取得元と独立して動けるようにしてある(§9.50)。
# 共有上の読み取り専用DBを手元へ写してから読むか(§9.89)。
#   'auto'(既定)/'on' … 写して読む  /  'off' … 従来どおり共有を直接読む
# 別PCの別アプリが更新している .sqlite3 を直接読むと、更新と重なったときに
# 正しく読めない(SQLiteのロックは共有では当てにならない)。詳細はbackend/db_mirror.py。
# 共有スケジュールの見張り(§9.188)。
#   schedule_watch_enabled  … 'auto'(既定)/'on' … 見張る / 'off' … 読むたびに写す(従来)
#   schedule_watch_interval_sec … 変化を見る間隔(秒)。写しはこの間だけ「新しい」
#   schedule_watch_pause_sec    … 写した直後に休む時間(秒)
PATH_CONFIG_LIVE_KEYS=('rne_extract_interval_sec','rne_extract_enabled','schedule_lock_ttl_sec','schedule_lock_verify_delay_ms',
                       'rne_assets_dir','rne_conf_path','db_mirror_enabled','db_mirror_interval_sec',
                       'schedule_watch_enabled','schedule_watch_interval_sec','schedule_watch_pause_sec',
                       # 共有スケジュールの持ち主(§9.192→§9.269)。既定は on。
                       'schedule_owner_enabled','schedule_owner_port','schedule_owner_ttl_sec',
                       # 編集セッションで操作を止めるか(§9.291 ③)。既定は off。
                       'schedule_session_block',
                       # 既定の品質データ結合(§9.194)。'off'で解除。既定は on。
                       'builtin_quality_join',
                       # 予定に組み込んだロットの元データが変わったときの扱い
                       # (§9.375、利用者の指示)。'auto'(既定)＝見つけたら更新、
                       # 'confirm'＝中身を見せてから取り込む。読むのは画面が
                       # 予定を開いたときなので、再起動は要らない。
                       'schedule_source_sync',
                       # 測定データの閲覧用複製を見に行く間隔(§9.202)。複製先の
                       # パスは接続先と同じ扱い(再起動が要る)だが、間隔だけは
                       # 呼び出しのたびに読み直すので再起動は要らない。
                       'records_backup_export_interval_sec',
                       # 不要ファイルの掃除(§9.249 ①)。既定は入で6時間ごと。
                       #   cleanup_auto_enabled     … 'on'(既定)/'off'
                       #   cleanup_interval_sec     … 掃除の間隔(秒)
                       #   cleanup_keep_days        … 何日以内のものを残すか
                       #   cleanup_keep_generations … 何世代を残すか
                       'cleanup_auto_enabled','cleanup_interval_sec',
                       'cleanup_keep_days','cleanup_keep_generations',
                       # この端末の呼び名(§9.208 ⑧)。空なら OS から解決する。
                       # 権限マスタとの照合・監査列・編集セッションの持ち主表示が
                       # すべてこの1つの答えを見るので、**現場で名乗り直せる**
                       # 手立てを1つだけ用意しておく。
                       'pc_name')
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
 except Exception as _e:
  quiet('マスタの設定を読めない（既定で続ける）',_e)
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
# ---- 役割(§9.87) -------------------------------------------------------
# 「どれが作業対象の一覧(仕掛)で、どれが品質データか」を**1行の設定として
# 持つ**。以前はキーの文字列そのもの('SIKALOTNOW'/'SIKALOTDEF')を全画面で
# 直接比較しており、マスタでキーを変えると
#   ・左メニューに古いキーのボタンが残って「データベース指定が不正です」
#   ・測定/予定の列・品質データ結合・条割の再検索が黙って消える
# という壊れ方をした(実機で発生)。役割で判定すれば、キーは利用者が自由に
# 付けてよい**ただの識別子**に戻る。
#
# **役割は「読むかどうか」ではなく「何として使うか」**(§9.193、利用者の指示
# 「今までのようにデータを読むだけで終わらず、使うかどうか、どのデータとして
# 使うかを選択できることで幅を広げたい」)。読むだけの行は「その他」のまま
# 一覧に出る——役割を付けた行だけが、測定・予定投入・スケジュール本体という
# **決まった役目**に就く。
PURPOSE_WORK='仕掛'          # 作業対象の一覧。測定・予定投入の対象
PURPOSE_QUALITY='品質'       # 品質データ
PURPOSE_ACTUAL='実績'        # 前工程の実績(§9.364)。仕掛から消えたロットの行き先
PURPOSE_SCHEDULE='スケジュール'  # 作業予定の本体(共有スケジュールDB)
PURPOSE_OTHER=''             # その他(一覧として見るだけ)
DATA_SOURCE_PURPOSES=(PURPOSE_WORK,PURPOSE_QUALITY,PURPOSE_ACTUAL,PURPOSE_SCHEDULE,PURPOSE_OTHER)
# 旧い呼び名(§9.193)。保存済みの行をそのまま読めるようにする。**移行は
# ensure_data_source_table が1回だけ書き換える**が、読む側にも別名を置く
# ——書き換え前のDBを読み取り専用で開く経路があるため(片方だけだと、
# そこでは役割が「その他」に落ちて測定も予定投入もできなくなる)。
_PURPOSE_ALIASES={'作業':PURPOSE_WORK}
# 役割が未設定の既存行を、初回だけこのキーで補う(移行)。ここに載っていない
# キーは PURPOSE_OTHER のまま＝「一覧として見るだけ」。
_LEGACY_PURPOSE_BY_KEY={'SIKALOTNOW':PURPOSE_WORK,'SIKALOTDEF':PURPOSE_QUALITY}

# 実績との突合キー(§9.364)。**予定の明細(仕掛行の写し)と実績の、同じ名前の列**を
# 順に突き合わせる。既定は利用者の指定どおり3つ。**後から変えられる**ように
# データソースマスタの[突合キー](JSON配列)が持ち、答えるのは下の1箇所。
DEFAULT_ACTUAL_MATCH_KEYS=('ロット番号','鋳造番号','前工程実績_作業終了_日付')

def parse_match_keys(raw):
 """保存値(JSON配列 or 読点/改行区切り)を列名の並びへ。空なら既定。

 **入力の形を1つに絞らない**——画面はJSONで送るが、手で直した行が
 「ロット番号,鋳造番号」のような書き方になっていることがある。
 読めなかったものを黙って既定へ倒すと、**設定したつもりの列で
 突合していない**状態が作れる(§9.328)ので、理由を1行残す。"""
 v=raw
 if isinstance(v,str):
  t=v.strip()
  if not t:return list(DEFAULT_ACTUAL_MATCH_KEYS)
  if t.startswith('['):
   try:v=_json.loads(t)
   except Exception as e:
    app_logger().warning('突合キーを読めませんでした(%s)。既定の%sを使います。',e,
                         '/'.join(DEFAULT_ACTUAL_MATCH_KEYS))
    return list(DEFAULT_ACTUAL_MATCH_KEYS)
  else:
   v=[x for x in t.replace('\n',',').replace('、',',').split(',')]
 if not isinstance(v,(list,tuple)):return list(DEFAULT_ACTUAL_MATCH_KEYS)
 out=[]
 for x in v:
  name=str(x or '').strip()
  if name and name not in out:out.append(name)
 return out or list(DEFAULT_ACTUAL_MATCH_KEYS)

def actual_match_keys():
 """いま効いている突合キー。**答えるのはここだけ**(§9.364)。

 役割「実績」の行が無ければ既定を返す(突合そのものは呼ぶ側が
 `ACTUAL_DB_KEY`の有無で決める)。"""
 for s in DATA_SOURCES:
  if (s.get('purpose') or PURPOSE_OTHER)==PURPOSE_ACTUAL:
   return parse_match_keys(s.get('matchKeys'))
 return list(DEFAULT_ACTUAL_MATCH_KEYS)

def normalize_purpose(raw):
 """保存値・画面からの入力を今の呼び名へ寄せる。知らない値は「その他」。"""
 v=str(raw or '').strip()
 v=_PURPOSE_ALIASES.get(v,v)
 return v if v in DATA_SOURCE_PURPOSES else PURPOSE_OTHER

# 既定の2件。マスタが空のときだけ入れる(初回起動・既存環境の互換)。
# 出力先/共有パスは下で解決するため、ここではファイル名だけを持つ。
_DEFAULT_DATA_SOURCES=(
 {'key':'SIKALOTNOW','label':'仕掛（現在）','rne':'SIKALOTNOW.RNE','table':'仕掛',
  'output':'sikalotnow.sqlite3','share':'SIKALOTNOW.sqlite3','preferred':'仕掛','order':10,
  'purpose':PURPOSE_WORK},
 {'key':'SIKALOTDEF','label':'品質データ','rne':'SIKALOTDEF.RNE','table':'仕掛',
  'output':'sikalotdef.sqlite3','share':'SIKALOTDEF.sqlite3','preferred':'仕掛','order':20,
  'purpose':PURPOSE_QUALITY},
)

# ---- 読み方(§9.168) ---------------------------------------------------
# 「このデータソースをどこから読むか」を**行ごとに**持つ。
#   ''      … 指定なし。全体設定(参照データの取得元)に従う（従来どおり）
#   'share' … 共有フォルダの .sqlite3 をそのまま読む（RNEを使わない）
#   'rne'   … この端末でRNEから抽出した出力ファイルを読む
# **RNEが無い端末・現場がある**（利用者の指摘）ので、全体スイッチ1つで
# 全ソースの読み方が決まる作りをやめた。空欄を残してあるのは、既に動いて
# いる環境の挙動を1つも変えないため。
READ_MODE_AUTO=''
READ_MODE_SHARE='share'
READ_MODE_RNE='rne'
# パス設定マスタの個別上書き(<キー>_path)が入っているときだけ名乗る、
# 画面向けの4つ目の呼び名。**保存値ではない**(上書きの有無で決まる)。
READ_MODE_DIRECT='direct'
DATA_SOURCE_READ_MODES=(READ_MODE_AUTO,READ_MODE_SHARE,READ_MODE_RNE)

def _read_mode_value(raw,key=''):
 v=str(raw or '').strip().lower()
 if v in DATA_SOURCE_READ_MODES:return v
 if v:
  app_logger().warning('データソースマスタの読み方(%r, キー=%s)は%sのいずれでもないため'
                       '「全体設定に従う」として扱います。',v,key,
                       '/'.join(x or '空欄' for x in DATA_SOURCE_READ_MODES))
 return READ_MODE_AUTO

def ensure_data_source_table(c):
 names=tables(c);created=False
 if DATA_SOURCE_TABLE not in names:
  c.cursor().execute(
   'CREATE TABLE [データソースマスタ] ('
   '[ソースID] INTEGER PRIMARY KEY AUTOINCREMENT, [キー] TEXT, [表示名] TEXT, '
   '[RNEファイル] TEXT, [抽出テーブル] TEXT, [出力ファイル] TEXT, [共有パス] TEXT, '
   '[既定テーブル] TEXT, [表示順] INTEGER, [有効] INTEGER, [役割] TEXT, [読み方] TEXT, '
   '[一覧表示] INTEGER, '
   '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 elif '役割' not in {n for n in cols(c,DATA_SOURCE_TABLE)}:
  # 既存環境への追加(§9.87)。今までどおり動くよう、役割を補ってから使う。
  add_missing_columns(c,DATA_SOURCE_TABLE,(('役割','TEXT'),))
  cur=c.cursor()
  for key,purpose in _LEGACY_PURPOSE_BY_KEY.items():
   cur.execute('UPDATE [データソースマスタ] SET [役割]=? WHERE [キー]=?',[purpose,key])
  # キーを既定から変えている環境では、上の対応表が1件も当たらない。
  # その場合に役割「作業」が空のままだと、測定も予定投入もできない画面に
  # なってしまう。**移行で機能を減らさない**ため、表示順が先頭の有効な行を
  # 作業対象とみなす(以前の「先頭の一覧＝仕掛」という暗黙の扱いと同じ)。
  # 違っていればマスタ管理 > データソースで選び直せる。
  cur.execute("SELECT COUNT(*) FROM [データソースマスタ] WHERE [役割]=?",[PURPOSE_WORK])
  if not int(cur.fetchone()[0] or 0):
   cur.execute('SELECT [ソースID],[キー] FROM [データソースマスタ] WHERE [有効]<>0 '
               'ORDER BY [表示順],[キー] LIMIT 1')
   first=cur.fetchone()
   if first:
    cur.execute('UPDATE [データソースマスタ] SET [役割]=? WHERE [ソースID]=?',[PURPOSE_WORK,first[0]])
    app_logger().warning('データソースマスタに役割を追加しました。既定のキーから変更されているため、'
                         '表示順が先頭の「%s」を役割「%s」としました。違う場合は'
                         'マスタ管理 > データソースで選び直してください。',first[1],PURPOSE_WORK)
  c.commit()
 # 読み方(§9.168)。**行ごとに「どこから読むか」を持つ**——以前は
 # `sikalot_source`(network/local)という**全体の1つのスイッチ**しか無く、
 # 「このソースだけ共有、あのソースだけRNE」が表現できなかった。
 # 空欄＝今までどおり全体設定に従う（既存環境の動きを変えない）。
 if DATA_SOURCE_TABLE in tables(c):
  add_missing_columns(c,DATA_SOURCE_TABLE,(('読み方','TEXT'),))
 # 一覧に出すかどうか(§9.193)。**「使う/使わない」と「一覧に出す/出さない」は
 # 別のこと**——結合の相手としてだけ読みたいデータ（品質・単価表など）は、
 # 左メニューに並べても押す用が無い。空欄＝出す（既存の行の見え方を変えない）。
 if DATA_SOURCE_TABLE in tables(c):
  add_missing_columns(c,DATA_SOURCE_TABLE,(('一覧表示','INTEGER'),))
 # 実績との突合キー(§9.364)。**行が持つ**——全体の設定にすると、実績の
 # データソースを差し替えたときにキーだけ前のまま残る。空欄＝既定。
 if DATA_SOURCE_TABLE in tables(c):
  add_missing_columns(c,DATA_SOURCE_TABLE,(('突合キー','TEXT'),))
 # 役割の呼び名を今のものへ寄せる(§9.193)。**保存値を1つに保つ**——
 # 読む側の別名(_PURPOSE_ALIASES)だけで済ませると、役割の重なりを見る
 # SQL(`WHERE [役割]=?`)が旧い値の行を見落とし、「仕掛」が2件付いた状態を
 # 作れてしまう(どちらを使うか決められない)。
 if DATA_SOURCE_TABLE in tables(c) and '役割' in {n for n in cols(c,DATA_SOURCE_TABLE)}:
  cur=c.cursor()
  for old,new in _PURPOSE_ALIASES.items():
   cur.execute('UPDATE [データソースマスタ] SET [役割]=? WHERE [役割]=?',[new,old])
   if cur.rowcount:c.commit()
 return created

def data_source_rows(c,include_disabled=False):
 """{キー: 設定}のリスト。テーブルが無ければ空(読み取り専用接続からも
 安全に呼べるよう、CREATEはしない)。

 **同じキーの行が2つあったら後の行は捨てる。** DBS は辞書なので黙って
 片方に潰れ、画面には2つ並ぶ(=どちらを押しても同じものが出る)という
 分かりにくい状態になるため、読む時点で1つに決めて警告を残す。"""
 if DATA_SOURCE_TABLE not in tables(c):return []
 have=({n for n in cols(c,DATA_SOURCE_TABLE)})
 has_purpose='役割' in have
 has_mode='読み方' in have
 has_listed='一覧表示' in have
 has_match='突合キー' in have
 cur=c.cursor()
 cur.execute('SELECT [ソースID],[キー],[表示名],[RNEファイル],[抽出テーブル],[出力ファイル],'
             '[共有パス],[既定テーブル],[表示順],[有効],'
             +('[役割]' if has_purpose else "''")+','
             +('[読み方]' if has_mode else "''")+','
             +('[一覧表示]' if has_listed else 'NULL')+','
             +('[突合キー]' if has_match else "''")+' FROM [データソースマスタ] '
             'ORDER BY [表示順],[キー]')
 out=[];seen={}
 for r in cur.fetchall():
  active=True if r[9] is None else bool(r[9])
  key=str(r[1] or '').strip()
  if not key or (not active and not include_disabled):continue
  if key in seen:
   app_logger().warning('データソースマスタにキー%rの行が複数あります。表示順が先のソースID=%s'
                        'を使い、ソースID=%sは読み飛ばしました。',key,seen[key],r[0])
   continue
  seen[key]=r[0]
  purpose=normalize_purpose(r[10])
  if purpose==PURPOSE_OTHER and str(r[10] or '').strip():
   # 想定外の値は「その他」として扱う(勝手に作業対象へ昇格させない)。
   app_logger().warning('データソースマスタの役割(%r, キー=%s)は%sのいずれでもないため'
                        '「その他」として扱います。',str(r[10]).strip(),key,
                        '/'.join(x or '空欄' for x in DATA_SOURCE_PURPOSES))
  out.append({'id':r[0],'key':key,'label':str(r[2] or '').strip() or key,
              'rne':str(r[3] or '').strip(),'table':str(r[4] or '').strip() or '仕掛',
              'output':str(r[5] or '').strip(),'share':str(r[6] or '').strip(),
              'preferred':str(r[7] or '').strip(),'order':int(r[8] or 0),'active':active,
              'purpose':purpose,'mode':_read_mode_value(r[11],key),
              # 空欄＝出す。役割「仕掛」だけは隠せない（隠すと主画面が消える）。
              'listed':(True if r[12] is None else bool(r[12])) or purpose==PURPOSE_WORK,
              # 実績との突合キー(§9.364)。空欄は既定として読む側が補う。
              'matchKeys':str(r[13] or '').strip()})
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
 """データソースマスタの行を**読むだけ**（種は入れない）。

 **種を入れるのは`bootstrap()`**（§9.329）。以前はここが読み込みのその場で
 表を作って既定の2件を入れており、`import backend.db_access` するだけで
 マスタDBが書き変わっていた。表がまだ無い端末はここで空が返り、呼び出し側が
 `_DEFAULT_DATA_SOURCES`（種と同じ中身）へ落ちるので、**このプロセスの
 見え方は種を入れた後と同じ**になる。"""
 try:
  if not _MASTER_PATH.exists():return []
  with connect(_MASTER_PATH,True) as c:
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

def _legacy_path_config_updates():
 """旧config/local.jsonにあった値のうち、パス設定マスタへ移すべきものを返す
 （**読むだけ。1件も書かない**）。まだ移していなければその辞書、済んでいれば
 空の辞書。sikalot_sourceが'network'/'local'以外の値(誤記・別項目の値の
 書き間違い等)なら、誤った値をそのまま引き継がず読み捨ててログへ残す。

 **書くのは`bootstrap()`**（§9.329）。以前はこの関数が読み込みのその場で
 マスタDBへ書いており、`import backend.db_access` するだけでファイルが
 変わった——読み込んだだけで何が起きるかが呼ぶ側から読めず、検証も
 「importしない」以外に避けようがない。読むことと書くことを分ける。"""
 try:
  legacy=load_local_config()
  if not legacy:return {}
  current=_master_path_config()
  if _MIGRATION_MARKER_KEY in current:return {}
  updates={}
  for key in PATH_CONFIG_STATIC_KEYS+PATH_CONFIG_LIVE_KEYS:
   if key=='sikalot_source':continue
   value=legacy.get(key)
   if value not in (None,''):updates[key]=str(value)
  src=legacy.get('sikalot_source')
  if src in _VALID_SIKALOT_SOURCES:updates['sikalot_source']=src
  elif src:
   app_logger().warning('config/local.jsonのsikalot_source(%r)は"network"/"local"以外の値のため移行しませんでした(値の書き間違いの可能性があります)。マスタ管理 > パス設定から選び直してください。',src)
  return updates
 except Exception as e:
  app_logger().warning('config/local.jsonからパス設定マスタの移行内容を読めませんでした: %s',e)
  return {}

def bootstrap():
 """読み込みでは起こさなかった書込（旧config/local.jsonの一度きりの移行）を
 ここで行う。**アプリの起動が1回だけ呼ぶ**（`app.py`）。

 何度呼んでも同じ（移行済みの目印があれば何もしない）。呼ばれなくても
 動きは変わらない——移す値は読み込み時に`_PATH_CONFIG`へ重ねてあるので、
 目印が書かれないまま毎回読み直すだけになる。"""
 done=False
 try:
  with connect(_MASTER_PATH,False) as c:
   done=bool(seed_data_sources(c))
 except Exception as e:
  app_logger().warning('データソースマスタの既定を入れられませんでした: %s',e)
 updates=_legacy_path_config_updates()
 try:
  if not updates and _MIGRATION_MARKER_KEY in _master_path_config():return done
  with connect(_MASTER_PATH,False) as c:
   for key,value in updates.items():
    set_path_config(c,key,value,'migrate:config/local.json')
   set_path_config(c,_MIGRATION_MARKER_KEY,'done','migrate:config/local.json')
  if updates:
   app_logger().info('config/local.jsonの設定%d件をパス設定マスタへ移行しました: %s',len(updates),sorted(updates))
  return True
 except Exception as e:
  app_logger().warning('config/local.jsonからパス設定マスタへの移行に失敗しました: %s',e)
  return False

# 移す値は**読み込み時に重ねるだけ**（書くのは bootstrap()）。こうしておくと、
# 目印がまだ書かれていない端末でも、このプロセスは移行後と同じ値で動く。
_LEGACY_PATH_UPDATES=_legacy_path_config_updates()
# プロセス起動時に1回だけ読み込むスナップショット。PATH_CONFIG_STATIC_KEYS
# (接続先を決める項目)はこれを使う。以降にマスタ管理画面から変更しても、
# このプロセスでは反映されない(再起動が必要。config/local.json時代から
# 変わらない既存の制約)。
_PATH_CONFIG={**_master_path_config(),**_LEGACY_PATH_UPDATES}
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
def source_override_key(key):
 """そのデータソースの読み込み先を個別に上書きする、パス設定マスタのキー
 （§9.163）。**データソースを増やしても増える**——固定の2件を書き並べない
 ため、名前はキーから機械的に作る。"""
 return f"{str(key or '').lower()}_path"

def _source_override(entry,cfg_map=None):
 """パス設定マスタの個別上書き(<キー>_path)。**常に最優先**で、検証用に
    手元の複製へ向ける従来の仕掛け(tests/run_all.sh もこれで差し替える)。"""
 # cfg_map を渡すとその設定で計算する（マスタ管理が「再起動したらどこを
 # 読むか」を先に見せるため。省略＝プロセス起動時に確定した設定）。
 return str((cfg_map.get(source_override_key(entry['key'])) if cfg_map is not None
             else _static_path_cfg(source_override_key(entry['key']))) or '').strip()

def source_read_mode(entry,cfg_map=None):
 """このデータソースを**どこから読むか**を1語で答える(§9.168)。
    'direct'/'rne'/'share' のいずれかで、**画面もサーバーもこの1箇所を見る**
    ——判定が散ると「画面には共有と出ているのに実際はRNEの出力を読む」と
    いう食い違いが起きる(§9.87でキー文字列の直接比較が実際にそうなった)。
    行に指定が無ければ全体設定(参照データの取得元)から決める。"""
 if _source_override(entry,cfg_map):return READ_MODE_DIRECT
 mode=_read_mode_value(entry.get('mode'),entry.get('key',''))
 if mode:return mode
 return READ_MODE_RNE if SIKALOT_SOURCE=='local' else READ_MODE_SHARE

def _source_path(entry,cfg_map=None):
 """1件のデータソースが「今どこを読むか」を決める。優先順位は
    (1) パス設定マスタの個別上書き(<キー>_path。常に最優先)
    (2) 行の読み方が 'rne' なら 出力ファイル / 'share' なら 共有パス
    (3) 指定が無ければ 全体設定(sikalot_source)から決める
    (4) 指定した側が空欄なら、もう片方で読む(設定の途中でも一覧を出す)
    相対パスは、出力ファイルは db/、共有パスは仕掛の共有フォルダを基点にする
    (現場は「ファイル名だけ」を入れることが多く、絶対パスを強制すると
    設定の手間と打ち間違いが増えるため)。"""
 override=_source_override(entry,cfg_map)
 if override:return Path(override)
 local=entry.get('output') or ''
 share=entry.get('share') or ''
 mode=source_read_mode(entry,cfg_map)
 if mode==READ_MODE_RNE and local:
  p=Path(local);return p if p.is_absolute() else DB_DIR/p
 if mode==READ_MODE_SHARE and share:
  p=Path(share);return p if p.is_absolute() else SIKA_DIR/p
 if share:
  p=Path(share);return p if p.is_absolute() else SIKA_DIR/p
 if local:
  p=Path(local);return p if p.is_absolute() else DB_DIR/p
 return DB_DIR/f"{entry['key'].lower()}.sqlite3"

DATA_SOURCES=_master_data_sources() or [
 # マスタを読めなかった場合の保険。既定の2件で従来どおり動かす。
 {'key':d['key'],'label':d['label'],'rne':d['rne'],'table':d['table'],
  'output':d['output'],'share':d['share'],'preferred':d['preferred'],
  'order':d['order'],'active':True,'id':None,'purpose':d['purpose'],'listed':True}
 for d in _DEFAULT_DATA_SOURCES]

DBS={s['key']:{"path":_source_path(s),"label":s['label'],"role":"readonly",
               "preferred":s.get('preferred') or s.get('table') or '仕掛',
               "purpose":s.get('purpose') or PURPOSE_OTHER,
               # 左メニューに並べるか(§9.193)。**読むこと自体は止めない**
               # ——結合の相手として引くのはこのフラグと無関係。
               "listed":bool(s.get('listed',True)),
               "engine":"sqlite","source":s}
     for s in DATA_SOURCES}
DBS["MASTER"]={"path":_MASTER_PATH,"label":"マスタ一覧","role":"master",
               "purpose":PURPOSE_OTHER,"listed":True,
               "preferred":"オペレータマスタ","engine":"sqlite"}

def _purpose_key(purpose):
 """その役割を担うデータソースのキー。無ければNone。
 **役割は1件だけ**(2件以上あってもどちらを使うか決められないので先頭)。"""
 hit=[s['key'] for s in DATA_SOURCES if (s.get('purpose') or PURPOSE_OTHER)==purpose]
 if len(hit)>1:
  app_logger().warning('データソースマスタに役割「%s」の行が%d件あります(%s)。'
                       '先頭の%sを使います。',purpose,len(hit),'/'.join(hit),hit[0])
 return hit[0] if hit else None

# 「仕掛」「品質」「実績」「スケジュール」がどのキーかは**ここだけが決める**。
# 画面・APIはキーの文字列を直接比較せず、この4つを参照すること(§9.87・§9.193・§9.364)。
WORK_DB_KEY=_purpose_key(PURPOSE_WORK)
QUALITY_DB_KEY=_purpose_key(PURPOSE_QUALITY)
ACTUAL_DB_KEY=_purpose_key(PURPOSE_ACTUAL)
SCHEDULE_DB_KEY=_purpose_key(PURPOSE_SCHEDULE)
if not WORK_DB_KEY:
 app_logger().warning('データソースマスタに役割「%s」の行がありません。'
                      '測定・予定投入の対象一覧が決まらないため、一覧は閲覧のみになります。'
                      'マスタ管理 > データソースで役割を選んでください。',PURPOSE_WORK)
# 閲覧用の追加複製先(パス設定マスタの"records_backup_export_path")。
# 未設定ならNoneのままで、records_export.pyは複製を一切行わない(既定は現状維持)。
_records_backup_export_override=_static_path_cfg('records_backup_export_path')
RECORDS_BACKUP_EXPORT_PATH=Path(_records_backup_export_override) if _records_backup_export_override else None

# ---------- 測定データの置き場は設備ごとに1ファイル(§9.258) ----------
# 共有スペースを正とする運用では、測定データを**設備ごとに1ファイル**へ分ける。
# 1台の測定端末が担当するのは1設備なので、こうすると「1つのファイルを書くのは
# いつも1台だけ」が**構造として**成り立つ——クラウド同期で壊れるのは同じ
# ファイルを2台が変えたときだけなので、その条件そのものが消える(書込役を
# 立てる§9.192より強い。設定も要らない)。
#
#   <records_share_dir>\<設備>\records.sqlite3
#
# **ファイル名は据え置く**(`records.sqlite3`)。分ける手段はフォルダなので、
# 名前まで設備ごとにすると汎用性が落ちる(利用者の指示)。
#
# **未設定なら今までどおりMEAS_DB 1本**で、この節は何も変えない——現場で
# 動いている置き方を黙って変えないため(§9.251の「既定は今までどおり」と
# 同じ作法)。移行の途中でも、読む側は下記のとおり**旧い置き場も一緒に**
# 読むので、どちらに保存された記録も消えない。
_records_share_dir_override=_static_path_cfg('records_share_dir')
RECORDS_SHARE_DIR=Path(_records_share_dir_override) if _records_share_dir_override else None

# 置き場が決まっていない記録(設備を名乗らない古いレコード)の行き先。
# **捨てないこと**——設備を書き足す手立ては画面にしか無いので、隠すと
# 直しようが無くなる(§9.248 ⑥と同じ理由)。
RECORDS_UNSET_DIR_NAME='_未設定'
RECORDS_FILE_NAME='records.sqlite3'
# Windowsがフォルダ名に使えない文字。設備名は現場が付けるので、
# ここを通さないと**フォルダごと作れない設備**が出る(§9.240でシート名に
# ついて踏んだのと同じ罠)。
_RECORDS_BAD_CHARS='<>:"/\\|?*'

def _records_equipment_ident(equipment):
 # 設備の同一判定は**アプリ全体で1つ**(全角/半角のゆれを吸収する。§9.239 ⑥)。
 return normalize_equipment_name(equipment)

def records_dir_name(equipment):
 """設備名 -> その設備の測定データを置くフォルダ名。

 使えない文字は`_`へ落とし、**落としたときだけ**短い識別子を付ける
 ——落とすだけだと`A/B`と`A:B`が同じフォルダになり、**別の設備の測定
 データが1つのファイルに混ざる**。ふつうの設備名(`LS4`等)は素のまま。
 """
 ident=_records_equipment_ident(equipment)
 if not ident:return RECORDS_UNSET_DIR_NAME
 safe=''.join(('_' if (ch in _RECORDS_BAD_CHARS or ord(ch)<32) else ch) for ch in ident)
 safe=safe.rstrip(' .')  # Windowsは末尾の空白とピリオドを落とす
 if safe!=ident or not safe:
  safe=(safe or 'eq')+'-'+hashlib.sha1(ident.encode('utf-8')).hexdigest()[:6]
 return safe

def records_path_for(equipment,create=False):
 """その設備の測定データを**書き込む**ファイル。

 置き場が未設定なら今までどおりMEAS_DB(この端末のdb/records.sqlite3)。
 `create=True`のときだけフォルダを作る——**読む側では作らない**
 (存在しない設備のフォルダが読むたびに増える)。
 """
 if RECORDS_SHARE_DIR is None:return MEAS_DB
 d=RECORDS_SHARE_DIR/records_dir_name(equipment)
 if create:
  try:
   existed=d.is_dir()
   d.mkdir(parents=True,exist_ok=True)
   # **作ったときだけ**一覧の覚えを捨てる(毎回捨てると共有の走査が増える)。
   if not existed:invalidate_records_dirs_cache()
  except Exception as e:
   # 共有が不調でも**測定は続けられること**が最優先。手元へ落として理由を残す。
   app_logger().warning('測定データの置き場(%s)を作れませんでした: %s。この端末の%sへ保存します。',d,e,MEAS_DB)
   return MEAS_DB
  # **書く先として渡した時点で覚える**(§9.268)。以後この端末はここを
  # 写しではなく実物から読む——写しは間隔ぶん古いので、自分の書込が
  # 自分に見えなくなる。`create=True`は書くときにしか来ない。
  note_records_written(d/RECORDS_FILE_NAME)
 return d/RECORDS_FILE_NAME

# 設備フォルダの一覧は共有越しの走査になるので、短いあいだ覚える
# (§9.188と同じ考え方。新しい設備のフォルダが増えるのは稀で、
#  遅れて見えても実害が無い)。
RECORDS_DIR_SCAN_TTL_SEC=20.0
_records_dirs_cache={'paths':None,'ts':0.0}
_records_dirs_lock=threading.Lock()

def invalidate_records_dirs_cache():
 with _records_dirs_lock:
  _records_dirs_cache['paths']=None;_records_dirs_cache['ts']=0.0

def records_share_files():
 """共有に置かれている設備ごとの測定データファイル。**この名前で公開する**
 のは`db_mirror`が写す対象を作るため（§9.268）。"""
 return _records_share_files()

def _records_share_files():
 if RECORDS_SHARE_DIR is None:return []
 now=time.time()
 with _records_dirs_lock:
  cached=_records_dirs_cache['paths']
  if cached is not None and (now-_records_dirs_cache['ts'])<RECORDS_DIR_SCAN_TTL_SEC:
   return cached
 found=[]
 try:
  for entry in sorted(RECORDS_SHARE_DIR.iterdir(),key=lambda e:e.name):
   try:
    if entry.is_dir():found.append(entry/RECORDS_FILE_NAME)
   except Exception as _e:quiet('共有の中を辿れない（この項目を飛ばす）',_e);continue
 except Exception as e:
  # **読めなかったことを「1件も無い」と同じに扱わない**(§9.211 ②)。
  # 前に読めた一覧があればそれを使い続ける。
  app_logger().warning('測定データの置き場(%s)を一覧できませんでした: %s',RECORDS_SHARE_DIR,e)
  with _records_dirs_lock:
   return _records_dirs_cache['paths'] or []
 with _records_dirs_lock:
  _records_dirs_cache['paths']=found;_records_dirs_cache['ts']=time.time()
 return found

def records_paths_holding(ids):
 """その記録IDを実際に持っているファイルだけを返す({path: [記録ID,...]})。

 消すときに使う。**持っていないファイルは開かない**——1つの記録は1つの
 ファイルにしか無いので、全部へDELETEを流すと、無関係な設備のファイルまで
 この端末が書いたことになる(§9.258の「1ファイル1書き手」が崩れる)。
 """
 want={str(i).strip() for i in (ids or []) if str(i or '').strip()}
 out={}
 if not want:return out
 for path in records_paths_all():
  if path is None or path_exists_safe(path) is False:continue
  try:
   with connect(path,True) as c:
    if 'Web測定バックアップ' not in tables(c):continue
    cur=c.cursor()
    qs=','.join('?' for _ in want)
    cur.execute('SELECT [記録ID] FROM [Web測定バックアップ] WHERE [記録ID] IN ('+qs+')',list(want))
    hit=[str(r[0]) for r in cur.fetchall()]
  except Exception as e:
   app_logger().warning('測定データ(%s)を確かめられませんでした: %s',path,e)
   continue
  if hit:out[path]=hit
 return out

# ---------- 閲覧は手元の写しから（§9.268、利用者の指摘） ----------
# 「閲覧は複数人が同時にアクセスするため、直接閲覧はデータ書き込み更新を
#  阻害する要因になるはず」——そのとおりだった。作業予定・仕掛/品質・マスタは
# 既に手元の写しから読む形になっていて、**測定データだけが取り残されていた**。
# SQLiteの読み手は読んでいるあいだSHAREDロックを持つので、閲覧端末が増える
# ほど測定端末の書込(EXCLUSIVEが要る)が待たされる。SMB越しのロックは元々
# 当てにならないので、なおさら重なりを減らすほうがよい。
#
# **自分が書いたファイルは写しから読まない。** 写しは間隔ぶん古いので、
# 自分の書込が自分に見えなくなる。書いた先をこのプロセスが覚えておき、
# そこだけは実物を読む(1ファイル1書き手なので、自分の書込と競合しない)。
_records_written_here=set()
_records_written_lock=threading.Lock()

def note_records_written(path):
 """このプロセスがそのファイルへ書いたことを覚える（§9.268）。"""
 if path is None:return
 with _records_written_lock:
  if str(path) in _records_written_here:return
  _records_written_here.add(str(path))
 # 写す対象から外れるので、背景スレッドに知らせて台帳を作り直させる。
 try:
  from . import db_mirror
  db_mirror.wake()
 except Exception as _e:quiet('写しの取り直しを起こせない（次の巡回で写す）',_e)

def records_written_here():
 with _records_written_lock:
  return set(_records_written_here)

def records_read_paths():
 """測定データを**読む**ときに実際に開くファイル（§9.268）。

 共有のファイルは**手元の写し**を指す。写しがまだ無ければ実物
 （fail-open。写しが出来た時点から手元を読むようになる）。
 **自分が書いたぶんと、この端末のMEAS_DBは常に実物。**
 """
 mine=records_written_here()
 out=[];seen=set()
 try:
  from . import db_mirror
  by_path={str(remote):key for key,remote in db_mirror.records_targets()}
 except Exception as _e:
  quiet('写しの対応表を引けない（実物をそのまま読む）',_e)
  by_path={}
 for real in records_paths_all():
  use=real
  key=by_path.get(str(real))
  if key and str(real) not in mine:
   try:
    use=Path(db_mirror.read_path(key,real))
   except Exception as _e:
    quiet('写しの場所を引けない（実物をそのまま読む）',_e)
    use=real
  k=str(use)
  if k in seen:continue
  seen.add(k);out.append(use)
 return out

def records_paths_all():
 """測定データを**読む**ときに見るファイルの全部。

 閲覧は全設備の測定データが見られるべき(利用者の指示)なので、設備フォルダを
 全部並べる。**旧い置き場も必ず末尾に足す**——移行の途中でどちらに保存された
 記録も消えないようにするため(片方だけを見る形にすると、移行した瞬間に
 それまでの記録が画面から消える)。同じファイルは1回だけ。
 """
 out=[];seen=set()
 for p in list(_records_share_files())+[MEAS_DB,RECORDS_BACKUP_EXPORT_PATH]:
  if p is None:continue
  k=str(p)
  if k in seen:continue
  seen.add(k);out.append(p)
 return out

# スケジュール機能(docs/SCHEDULE_MODE_DESIGN.md §4)のデータ本体。共有環境
# (Box等)上のパスをパス設定マスタの"schedule_share_path"で指定する。
# 未設定ならNoneのままで、backend/schedule_sync.pyはScheduleNotConfiguredを
# 送出し、機能自体が無効になる(仕掛/品質データのsikalotnow_path等と同じく、
# 検証時はここをローカルの空ファイルへ一時的に切り替えて安全に試せる)。
# 共有スケジュールのファイル名。**フォルダを指定されたらこの名前を足す**
# （§9.262、利用者の指示「フォルダがなければフォルダは自動生成し、ファイルも
# 自動生成、フォルダがあればファイルを探し、ファイルがあればそれを使う」）。
SCHEDULE_FILE_NAME='schedule.sqlite3'

def resolve_schedule_share(raw):
 """設定値 -> 実際に読み書きする schedule.sqlite3 のパス。

 **フォルダを指定できる**——利用者が共有フォルダを指定して「登録を
 受け付けない」と読んだのはここ。判定は**綴りだけ**で行う（`.sqlite3`／
 `.db`で終わらなければフォルダ扱い）——共有越しでは`is_dir()`が失敗する
 ことがあり、**存在確認そのものが唯一の失敗原因になる**のを避けるため
 （`Path.exists()`を接続の前に置かない、という既存の約束と同じ理由）。
 """
 # **答えるのは resolve_db_file の1箇所**——マスタ・測定データと同じ約束。
 return resolve_db_file(raw,SCHEDULE_FILE_NAME)

_schedule_share_override=_static_path_cfg('schedule_share_path')
if _schedule_share_override:
 SCHEDULE_SHARE_PATH=resolve_schedule_share(_schedule_share_override)
elif SCHEDULE_DB_KEY and DBS.get(SCHEDULE_DB_KEY):
 # 役割「スケジュール」を付けたデータソースから決める(§9.193)。**共通設定の
 # schedule_share_path が最優先**——既に現場で効いている設定を、役割を付けた
 # 瞬間に別の場所へ向けないため。役割側は「まだ設定していない端末のための
 # もう1本の道」で、どちらで決まったかはマスタ管理の画面に出す。
 SCHEDULE_SHARE_PATH=Path(DBS[SCHEDULE_DB_KEY]['path'])
else:
 SCHEDULE_SHARE_PATH=None
# どちらで決まったか(画面に出すためだけの目印。判定には使わない)。
SCHEDULE_SHARE_FROM=('path-config' if _schedule_share_override
                     else ('data-source' if SCHEDULE_SHARE_PATH else ''))

# 測定データのバックアップに残す「誰が・どの端末で」(§9.180)。
# **共有DBは既に現場で動いているので作り直さない**——他のマスタと同じ
# 「無ければ足す」で移行する(古い版のアプリが書いた行はNULLのまま読める)。
# [更新時刻ISO]は**レコード自身の`updatedAt`をそのまま**入れる列(§9.208 ⑤)。
# [更新日時]はサーバーが`Now()`で押す**その端末の現地時刻**で、画面が持つ
# `updatedAt`(UTCのISO)とは物差しが違う。文字列で比べていたため、
#   ・10桁目が' '(0x20)と'T'(0x54)なので、ふつうは常に「共有のほうが古い」
#   ・現地時刻の日付がUTCの日付を追い越す時間帯(JSTなら0〜9時)は**常に
#     「共有のほうが新しい」**
# となり、**自分で保存しただけのデータに「新しい版あり」が付いていた**
# (実機で報告)。同じ物差しの列を1本足して、そちらで比べる。
BACKUP_AUDIT_COLUMNS=(('登録者ID','TEXT'),('登録端末名','TEXT'),
                      ('更新者ID','TEXT'),('更新端末名','TEXT'),('登録日時','DATETIME'),
                      ('更新時刻ISO','TEXT'))

def ensure_backup_table(c):
 names=tables(c)
 if 'Web測定バックアップ' not in names:
  c.cursor().execute('CREATE TABLE [Web測定バックアップ] ([記録ID] TEXT, [設備] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, [状態] TEXT, [更新日時] DATETIME, [圧縮形式] TEXT, [ペイロード] TEXT, [登録者ID] TEXT, [登録端末名] TEXT, [更新者ID] TEXT, [更新端末名] TEXT, [登録日時] DATETIME)')
  c.commit()
  return
 add_missing_columns(c,'Web測定バックアップ',BACKUP_AUDIT_COLUMNS)

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
  # **監査列が無い古いDBでもそのまま読む**(§9.180)。列の有無で分岐せず、
  # 無い列は NULL を選ぶ(マスタ側の column_layout_for と同じ作法)。
  have={x for x in cols(c,'Web測定バックアップ')}
  col=lambda n:('['+n+']') if n in have else 'NULL'
  cur=c.cursor()
  cur.execute('SELECT [記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード],'
              +col('登録者ID')+','+col('登録端末名')+','+col('更新者ID')+','+col('更新端末名')+','
              +col('登録日時')+','+col('更新時刻ISO')+' FROM [Web測定バックアップ] ORDER BY [更新日時] DESC')
  rows=cur.fetchall()
 def at(v):
  try:return v.isoformat() if v else None
  except Exception:return str(v or '') or None
 return [{'id':str(r[0] or ''),'equipment':str(r[1] or ''),'lotNo':str(r[2] or ''),'inspectionNo':str(r[3] or ''),'castingNo':str(r[4] or ''),'status':str(r[5] or ''),'updated_at':at(r[6]),'codec':str(r[7] or ''),'payload':str(r[8] or ''),
          'created_by':str(r[9] or ''),'created_pc':str(r[10] or ''),
          'updated_by':str(r[11] or ''),'updated_pc':str(r[12] or ''),
          'created_at':at(r[13]),
          # レコード自身の更新時刻(画面が持つ`updatedAt`と同じ物差し)。
          # 古い行には無いので空になる——**空を「同じ」と読まないこと**。
          'record_updated_at':str(r[14] or '')} for r in rows],path

# ---------- 実績バックアップ読込のキャッシュ(docs/decisions/9.41.md) ----------
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
 # **読む先の署名**（§9.268）——写しから読むなら、変わったかどうかも写しで
 # 見る。実物で見ると、写しがまだ古いのに「変わった」と判断して同じ写しを
 # 読み直すことになる。
 sig=[]
 for path in records_read_paths():
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
  # ファイルごとの覚えも捨てる——同一秒内の連続保存はstatの署名で拾えない
  # ことがあるので、明示的に捨てる口ではここも空にする。
  _backup_file_cache.clear()

# ファイルごとの読み結果を、そのファイルの署名で覚える。
# 設備ごとに分けた(§9.258)ことで読む対象がN本になったので、**1台が保存する
# たびにN本すべてを読み直す**形にすると、設備が増えるほど一覧が重くなる。
# 変わったファイルだけ読み直す。
_backup_file_cache={}

def _backup_file_rows(path):
 try:
  st=path.stat();sig=(st.st_mtime_ns,st.st_size)
 except Exception as _e:
  # 署名が取れないときは覚えない(共有越しではstatだけ失敗する。§9.188)。
  quiet('見かけ（更新時刻・大きさ）を取れない（分からないものとして続ける）',_e)
  sig=None
 if sig is not None:
  hit=_backup_file_cache.get(str(path))
  if hit is not None and hit[0]==sig:return hit[1]
 try:
  items,_=read_backup_rows(path)
 except Exception as _e:
  quiet('控えのファイルを読めない（この1件を飛ばす）',_e)
  items=None
 rows=items or []
 if sig is not None:_backup_file_cache[str(path)]=(sig,rows)
 return rows

def _merged_backup_rows_uncached():
 # 読む対象は records_paths_all() が答える1箇所(§9.258)——設備ごとの
 # 測定データ・この端末のMEAS_DB・閲覧用複製(Box等)の全部から
 # [Web測定バックアップ]を集め、記録IDごとに
 # 更新日時が新しい方を残す。schedule_calc.py(実績突合、§7.4)・
 # load_factor.py(換算係数モデルの学習、§6.6)が共用する。どちらの端末
 # (書込端末そのもの/閲覧・スケジュール専用端末)から呼んでも同じ実績が
 # 見える。
 merged={}
 for path in records_read_paths():
  for row in _backup_file_rows(path):
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
 # **写しを取り直す合図を送る**（§9.268）。ここは「20秒の覚えが切れた／
 # 明示的に取り直したい」瞬間なので、背景スレッドを起こしておくと次の
 # 読みでは新しい写しが読める（このリクエストは待たせない）。
 try:
  from . import db_mirror
  db_mirror.wake()
 except Exception as _e:quiet('写しの取り直しを起こせない（次の巡回で写す）',_e)
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
