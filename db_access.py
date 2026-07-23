"""db_access.py: Accessデータベースへの接続と共通ヘルパ。

- DBS: 画面から選択できるデータベース(仕掛/品質/マスタ)の定義
- MEAS_DB: 測定データのバックアップ先(測定データ.accdb)
- connect/cols/tables/qi: pyodbc接続とスキーマ操作の基本関数
- 監査列(登録者ID/更新者ID)とバックアップテーブルの整備
"""
from pathlib import Path
import pyodbc

BASE=Path(__file__).resolve().parent
SIKA_DIR=Path(r"\\Nlmsrvngy03\Read\【New】仕掛\台帳")
DBS={
 "SIKALOTNOW":{"path":SIKA_DIR/"SIKALOTNOW.accdb","label":"仕掛（現在）","role":"readonly","preferred":"仕掛"},
 "SIKALOTDEF":{"path":SIKA_DIR/"SIKALOTDEF.accdb","label":"品質データ","role":"readonly","preferred":"仕掛"},
 "MASTER":{"path":BASE/"マスタ.accdb","label":"マスタ","role":"master","preferred":"オペレータマスタ"}}
def resolve_local_db(candidates):
 for name in candidates:
  path=BASE/name
  if path.exists():return path
 for path in BASE.glob('*.accdb'):
  if any(token.lower() in path.name.lower() for token in candidates):return path
 return BASE/candidates[0]
DBS['MASTER']['path']=resolve_local_db(['マスタ.accdb','マスタデータ.accdb','Master.accdb'])
MEAS_DB=resolve_local_db(['測定データ.accdb','Measurement.accdb']); DRIVER="Microsoft Access Driver (*.mdb, *.accdb)"

def qi(s): return '['+str(s).replace(']',']]')+']'
def connect(path,readonly=False):
 if not path.exists(): raise FileNotFoundError(f"データベースが見つかりません: {path}")
 return pyodbc.connect(f"DRIVER={{{DRIVER}}};DBQ={path};"+("READONLY=1;" if readonly else ""),autocommit=False,timeout=10)
def cols(c,t):
 cur=c.cursor();cur.execute(f"SELECT TOP 1 * FROM {qi(t)}");return [x[0] for x in cur.description]
def tables(c): return sorted({r.table_name for r in c.cursor().tables(tableType='TABLE') if r.table_name and not r.table_name.startswith(('MSys','USys','~'))},key=str.casefold)
def cfg(k):
 if k not in DBS: raise ValueError('データベース指定が不正です')
 return DBS[k]

# ========================================================================
# 更新対象者（ユーザーID）の管理
# ========================================================================
AUDIT_COLUMNS=(('登録者ID','TEXT(50)'),('更新者ID','TEXT(50)'))
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
  c.cursor().execute('CREATE TABLE [Web測定バックアップ] ([記録ID] TEXT(80), [設備] TEXT(20), [ロット番号] TEXT(40), [検査番号] TEXT(40), [鋳造番号] TEXT(40), [状態] TEXT(20), [更新日時] DATETIME, [圧縮形式] TEXT(30), [ペイロード] LONGCHAR)')
  c.commit()

