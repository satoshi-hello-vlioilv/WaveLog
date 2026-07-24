"""db_access.py: Access/SQLiteデータベースへの接続と共通ヘルパ。

- DBS: 画面から選択できるデータベース(仕掛/品質/マスタ)の定義
- MEAS_DB: 測定データのバックアップ先(測定データ.sqlite3)
- connect/cols/tables/qi: 接続とスキーマ操作の基本関数(Access/SQLite両対応)
- 監査列(登録者ID/更新者ID)とバックアップテーブルの整備

仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の別システムが所有・書込する
読み取り専用のAccessファイルのため、これらは引き続きpyodbc経由でAccessのまま
読み取る。一方、マスタ(オペレータ/設備/フィルタ等)と測定データバックアップは
本アプリ自身が読み書きするローカルストアのため、SQLiteへ移行した。
"""
from pathlib import Path
from datetime import datetime
import sqlite3
import pyodbc

APP_ROOT=Path(__file__).resolve().parent.parent
DATA_DIR=APP_ROOT/"data"
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")
DBS={
 "SIKALOTNOW":{"path":SIKA_DIR/"SIKALOTNOW.accdb","label":"仕掛（現在）","role":"readonly","preferred":"仕掛","engine":"access"},
 "SIKALOTDEF":{"path":SIKA_DIR/"SIKALOTDEF.accdb","label":"品質データ","role":"readonly","preferred":"仕掛","engine":"access"},
 "MASTER":{"path":DATA_DIR/"マスタ.sqlite3","label":"マスタ","role":"master","preferred":"オペレータマスタ","engine":"sqlite"}}
def resolve_local_db(candidates):
 # data/ (新しい既定の置き場所) を優先し、見つからなければ旧配置
 # (リポジトリ直下、data/フォルダ導入前のバージョンで使われていた場所)を
 # 探す。どちらにも無ければ新規作成先としてdata/配下のパスを返す。
 for base in (DATA_DIR,APP_ROOT):
  for name in candidates:
   path=base/name
   if path.exists():return path
  for path in base.glob('*.sqlite3'):
   if any(token.lower() in path.name.lower() for token in candidates):return path
 return DATA_DIR/candidates[0]
DBS['MASTER']['path']=resolve_local_db(['マスタ.sqlite3','マスタデータ.sqlite3','Master.sqlite3'])
MEAS_DB=resolve_local_db(['測定データ.sqlite3','Measurement.sqlite3']); MEAS_ENGINE='sqlite'
DRIVER="Microsoft Access Driver (*.mdb, *.accdb)"

# ========================================================================
# SQLite側のAccess SQL互換関数
#  - Now()/Nz()はAccess独自のSQL関数。masters.py側のSQL文言はそのまま
#    流用し、この2つをSQLite接続へユーザー定義関数として登録することで
#    差分を吸収する(呼び出し側のSQL文字列を書き換えずに済む)。
#  - DATETIME列はISO8601文字列で保存し、detect_types+コンバータで
#    読み出し時に自動的にdatetimeオブジェックへ復元する(既存コードの
#    .isoformat()呼び出しをそのまま使えるようにするため)。
# ========================================================================
def _sqlite_now():return datetime.now().isoformat(sep=' ')
def _sqlite_nz(value,default):return default if value is None else value
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
