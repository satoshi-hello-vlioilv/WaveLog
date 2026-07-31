"""db_access.py: Access/SQLiteデータベースへの接続と共通ヘルパ。

- DBS: 画面から選択できるデータベース(仕掛/品質/マスタ)の定義
- MEAS_DB: 測定データのバックアップ先(db/records.sqlite3)
- connect/cols/tables/qi: 接続とスキーマ操作の基本関数(Access/SQLite両対応)
- 監査列(登録者ID/更新者ID)とバックアップテーブルの整備

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の別システムが所有・書込する
読み取り専用のAccessファイルのため、これらは引き続きpyodbc経由でAccessのまま
読み取る。一方、マスタ(オペレータ/設備/フィルタ等)と測定データバックアップは
本アプリ自身が読み書きするローカルストアのため、SQLite(db/フォルダ)へ移行した。
"""
from pathlib import Path
from datetime import datetime
import sqlite3
import pyodbc

from .paths import APP_ROOT, configured_path, configured_value

# DBの置き場所は既定でAPP_ROOT/db。config/local.jsonの"db_dir"で上書き可能
# (未配置なら従来どおり)。個別ファイルの上書きはDBS['MASTER']['path']/
# MEAS_DBの設定時にconfigured_pathで別途反映する。
DB_DIR=configured_path('db_dir') or APP_ROOT/"db"
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")

def _engine_for(path):
 """パスの拡張子からAccess/SQLiteを判定する(connect()の自動判定と同一基準)。
    工場側システムが将来SQLiteへ移行した場合でも、DBS/connect双方が同じ
    基準で判定するため、ファイル名を差し替えるだけで読み替えられる。"""
 return 'sqlite' if str(path).lower().endswith(('.sqlite3','.sqlite','.db')) else 'access'

# 仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)の読み込み元は既定でネットワーク
# 共有上のAccessファイル(工場側システムが所有)だが、config/local.jsonの
# "sikalot_source"="local"にすると、WaveLog自身がRNE経由で定期的に抽出・
# 更新するローカルSQLite3(db/sikalotnow.sqlite3・db/sikalotdef.sqlite3、
# backend/rne_scheduler.pyが背景スレッドで更新)を読む運用に切り替えられる。
# ネットワーク共有への到達性が無い/不安定な環境向けの切替で、2つのDBを
# まとめて1つのスイッチで切り替える(個別切替は用途が無いため)。
SIKALOT_SOURCE='local' if configured_value('sikalot_source','network')=='local' else 'network'
SIKALOTNOW_LOCAL_PATH=DB_DIR/"sikalotnow.sqlite3"
SIKALOTDEF_LOCAL_PATH=DB_DIR/"sikalotdef.sqlite3"
# "sikalotnow_path"/"sikalotdef_path"による明示的な上書き(検証用に手元へ
# 複製したファイルを指す、等)はsikalot_sourceの切替より常に優先する
# (従来からの開発/検証用の上書き挙動を変えないため)。上書き先の拡張子が
# .sqlite3等であれば自動的にSQLiteとして接続する(_engine_for)。
_SIKALOTNOW_PATH=configured_path('sikalotnow_path') or (SIKALOTNOW_LOCAL_PATH if SIKALOT_SOURCE=='local' else SIKA_DIR/"SIKALOTNOW.accdb")
_SIKALOTDEF_PATH=configured_path('sikalotdef_path') or (SIKALOTDEF_LOCAL_PATH if SIKALOT_SOURCE=='local' else SIKA_DIR/"SIKALOTDEF.accdb")
DBS={
 "SIKALOTNOW":{"path":_SIKALOTNOW_PATH,"label":"仕掛（現在）","role":"readonly","preferred":"仕掛","engine":_engine_for(_SIKALOTNOW_PATH)},
 "SIKALOTDEF":{"path":_SIKALOTDEF_PATH,"label":"品質データ","role":"readonly","preferred":"仕掛","engine":_engine_for(_SIKALOTDEF_PATH)},
 "MASTER":{"path":DB_DIR/"master.sqlite3","label":"マスタ一覧","role":"master","preferred":"オペレータマスタ","engine":"sqlite"}}
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
DBS['MASTER']['path']=configured_path('master_db_path') or resolve_local_db('master.sqlite3',['マスタ.sqlite3','マスタデータ.sqlite3','Master.sqlite3'])
MEAS_DB=configured_path('records_db_path') or resolve_local_db('records.sqlite3',['測定データ.sqlite3','Measurement.sqlite3']); MEAS_ENGINE='sqlite'
# 閲覧用の追加複製先(config/local.jsonの"records_backup_export_path")。
# 未設定ならNoneのままで、records_export.pyは複製を一切行わない(既定は現状維持)。
RECORDS_BACKUP_EXPORT_PATH=configured_path('records_backup_export_path')
DRIVER="Microsoft Access Driver (*.mdb, *.accdb)"

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
def connect(path,readonly=False,engine=None):
 if engine is None:
  engine='sqlite' if str(path).lower().endswith(('.sqlite3','.sqlite','.db')) else 'access'
 if engine=='sqlite':
  if readonly:
   if not path.exists():raise FileNotFoundError(f"データベースが見つかりません: {path}")
   # Windowsのバックスラッシュパスをfile: URIへ安全に変換するため
   # (str連結だとドライブレター区切りやUnicodeファイル名でURI解釈を誤り得る)、
   # pathlibのas_uri()でパーセントエンコード済みのURIを組み立てる。
   c=sqlite3.connect(path.resolve().as_uri()+"?mode=ro",uri=True,timeout=10,detect_types=sqlite3.PARSE_DECLTYPES)
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
def request_user_id(x):
 x=x or {}
 for k in ('user_id','userId','updated_by','更新者ID'):
  v=str(x.get(k) or '').strip()
  if v:return v[:50]
 return ''

def ensure_backup_table(c):
 names=tables(c)
 if 'Web測定バックアップ' not in names:
  c.cursor().execute('CREATE TABLE [Web測定バックアップ] ([記録ID] TEXT, [設備] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, [状態] TEXT, [更新日時] DATETIME, [圧縮形式] TEXT, [ペイロード] TEXT)')
  c.commit()
