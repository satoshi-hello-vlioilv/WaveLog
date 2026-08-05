"""db_access.py: Access/SQLiteデータベースへの接続と共通ヘルパ。

- DBS: 画面から選択できるデータベース(仕掛/品質/マスタ)の定義
- MEAS_DB: 測定データのバックアップ先(db/records.sqlite3)
- connect/cols/tables/qi: 接続とスキーマ操作の基本関数(Access/SQLite両対応)
- パス設定マスタ: 仕掛/品質データの読み込み先・スケジュール共有パス等、
  アプリ運用中に変わり得るパス/間隔設定をdb/master.sqlite3側で管理する
  (旧config/local.json。詳細は下記「パス設定マスタ」節を参照)
- 監査列(登録者ID/更新者ID)とバックアップテーブルの整備

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の別システムが所有・書込する
読み取り専用のAccessファイルのため、これらは引き続きpyodbc経由でAccessのまま
読み取る。一方、マスタ(オペレータ/設備/フィルタ等)と測定データバックアップは
本アプリ自身が読み書きするローカルストアのため、SQLite(db/フォルダ)へ移行した。
"""
from pathlib import Path
from datetime import datetime
from urllib.parse import quote
import sqlite3
import threading
import time
import pyodbc

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
DRIVER="Microsoft Access Driver (*.mdb, *.accdb)"

def _engine_for(path):
 """パスの拡張子からAccess/SQLiteを判定する(connect()の自動判定と同一基準)。
    工場側システムが将来SQLiteへ移行した場合でも、DBS/connect双方が同じ
    基準で判定するため、ファイル名を差し替えるだけで読み替えられる。
    拡張子の判定は大文字/小文字を区別しない(.SQLITE3等も自動判定する)。"""
 return 'sqlite' if str(path).lower().endswith(('.sqlite3','.sqlite','.db')) else 'access'

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
 (SQLiteのURI filename仕様に沿った回避策)。"""
 resolved=path.resolve()
 posix=resolved.as_posix()
 if posix.startswith('//'):
  return 'file://'+quote(posix)+'?mode=ro'
 return resolved.as_uri()+'?mode=ro'
def connect(path,readonly=False,engine=None):
 if engine is None:
  engine='sqlite' if str(path).lower().endswith(('.sqlite3','.sqlite','.db')) else 'access'
 if engine=='sqlite':
  if readonly:
   if not path.exists():raise FileNotFoundError(f"データベースが見つかりません: {path}")
   c=sqlite3.connect(_sqlite_ro_uri(path),uri=True,timeout=10,detect_types=sqlite3.PARSE_DECLTYPES)
  else:
   path.parent.mkdir(parents=True,exist_ok=True)
   c=sqlite3.connect(str(path),timeout=10,detect_types=sqlite3.PARSE_DECLTYPES)
  c.create_function('Now',0,_sqlite_now);c.create_function('Nz',2,_sqlite_nz)
  c.create_function('CStr',1,_sqlite_cstr);c.create_function('Val',1,_sqlite_val)
  return c
 if not path.exists(): raise FileNotFoundError(f"データベースが見つかりません: {path}")
 return pyodbc.connect(f"DRIVER={{{DRIVER}}};DBQ={path};"+("READONLY=1;" if readonly else ""),autocommit=False,timeout=10)
def cols(c,t):
 cur=c.cursor()
 if isinstance(c,sqlite3.Connection):cur.execute(f"SELECT * FROM {qi(t)} LIMIT 1")
 else:cur.execute(f"SELECT TOP 1 * FROM {qi(t)}")
 return [x[0] for x in cur.description]
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
#  - 旧config/local.json相当。マスタ管理画面(measurement-worklog.jsの
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
PATH_CONFIG_LIVE_KEYS=('rne_extract_interval_sec','schedule_lock_ttl_sec','schedule_lock_verify_delay_ms')
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
_sikalotnow_override=_static_path_cfg('sikalotnow_path')
_SIKALOTNOW_PATH=Path(_sikalotnow_override) if _sikalotnow_override else (SIKALOTNOW_LOCAL_PATH if SIKALOT_SOURCE=='local' else SIKA_DIR/"SIKALOTNOW.accdb")
_sikalotdef_override=_static_path_cfg('sikalotdef_path')
_SIKALOTDEF_PATH=Path(_sikalotdef_override) if _sikalotdef_override else (SIKALOTDEF_LOCAL_PATH if SIKALOT_SOURCE=='local' else SIKA_DIR/"SIKALOTDEF.accdb")
DBS={
 "SIKALOTNOW":{"path":_SIKALOTNOW_PATH,"label":"仕掛（現在）","role":"readonly","preferred":"仕掛","engine":_engine_for(_SIKALOTNOW_PATH)},
 "SIKALOTDEF":{"path":_SIKALOTDEF_PATH,"label":"品質データ","role":"readonly","preferred":"仕掛","engine":_engine_for(_SIKALOTDEF_PATH)},
 "MASTER":{"path":_MASTER_PATH,"label":"マスタ一覧","role":"master","preferred":"オペレータマスタ","engine":"sqlite"}}
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
 return ''

def read_backup_rows(path):
 # [Web測定バックアップ]テーブルを読み取り専用で読む共通処理。
 # backend/routes/measurement.py(PC引継ぎ用/閲覧モード一覧)と
 # backend/schedule_calc.py(実績突合、docs/SCHEDULE_MODE_DESIGN.md §7.4)が
 # 共用する。書き込みは一切行わない。戻り値: (行のlist of dict, path)。
 # ファイル自体が無ければ (None, path)。
 if path is None or not path.exists():return None,path
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
