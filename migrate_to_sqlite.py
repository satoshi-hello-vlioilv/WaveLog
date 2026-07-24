"""migrate_to_sqlite.py: 既存のマスタ.accdb / 測定データ.accdbからSQLiteへの一度限りの移行。

WaveLogは、本アプリ自身が読み書きするローカルストア(マスタ・測定データ
バックアップ)をAccess(.accdb)からSQLite(.sqlite3)へ移行した。仕掛
(SIKALOTNOW.accdb)・品質データ(SIKALOTDEF.accdb)は工場側の別システムが
所有するネットワーク共有上の読み取り専用ファイルのため、これらは移行対象
外で引き続きAccessのまま読み取る。

このスクリプトは、旧アプリ資産としてこのフォルダに残っている
マスタ.accdb / 測定データ.accdb (存在すれば)から、新しい
マスタ.sqlite3 / 測定データ.sqlite3 へ全テーブル・全行をコピーする。
IDは元の値のまま引き継ぐ(他テーブルからの参照を壊さないため)。

使い方:
    python migrate_to_sqlite.py            # 移行を実行(対象sqlite3が既に
                                            # データを持つ場合は安全のため中断)
    python migrate_to_sqlite.py --force    # 対象sqlite3のテーブルを空にしてから再移行

このスクリプトはWindows側(Accessドライバがインストールされた実機)で実行する
想定。Accessドライバの無い環境(このサンドボックス等)では、移行元ファイルが
見つからない旨を表示してスキップする。
"""
import sys
import sqlite3
from pathlib import Path

import pyodbc

import db_access as dba
import masters as m

BASE=Path(__file__).resolve().parent

# 移行対象テーブル一覧: (テーブル名, ensure_*_table関数)
MASTER_TABLE_ENSURERS=[
 (m.EQUIPMENT_MASTER_TABLE, m.ensure_equipment_master_table),
 (m.OPERATOR_MASTER_TABLE, m.ensure_operator_master_table),
 (m.OPERATOR_EQUIPMENT_TABLE, m.ensure_operator_equipment_table),
 (m.SPOOL_MASTER_TABLE, m.ensure_spool_master_table),
 (m.INNER_MASTER_TABLE, m.ensure_inner_master_table),
 (m.DEVICE_MASTER_TABLE, m.ensure_device_master_table),
 (m.FILTER_PRESET_TABLE, m.ensure_filter_preset_table),
 (m.COLUMN_DISPLAY_TABLE, m.ensure_column_display_table),
]

def find_old_accdb(candidates):
 for name in candidates:
  path=BASE/name
  if path.exists():return path
 for path in BASE.glob('*.accdb'):
  if any(token.lower() in path.name.lower() for token in candidates):return path
 return None

def table_has_rows(sqlite_path,table):
 if not sqlite_path.exists():return False
 with sqlite3.connect(str(sqlite_path)) as c:
  if table not in dba.tables(c):return False
  cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {dba.qi(table)}')
  return cur.fetchone()[0]>0

def copy_table(src_conn,dst_conn,table,ensure_fn=None):
 if ensure_fn:ensure_fn(dst_conn)
 if table not in dba.tables(src_conn):
  print(f'  - {table}: 移行元に存在しないためスキップ');return 0
 src_cols=dba.cols(src_conn,table)
 dst_cols=set(dba.cols(dst_conn,table))
 use_cols=[c for c in src_cols if c in dst_cols]
 if not use_cols:
  print(f'  - {table}: 対応する列がないためスキップ');return 0
 cur=src_conn.cursor();cur.execute(f'SELECT {",".join(dba.qi(c) for c in use_cols)} FROM {dba.qi(table)}')
 rows=cur.fetchall()
 placeholders=','.join('?' for _ in use_cols)
 col_list=','.join(dba.qi(c) for c in use_cols)
 dst_cur=dst_conn.cursor()
 n=0
 for row in rows:
  values=[None if v is None else v for v in row]
  dst_cur.execute(f'INSERT INTO {dba.qi(table)} ({col_list}) VALUES ({placeholders})',values)
  n+=1
 dst_conn.commit()
 print(f'  - {table}: {n}件移行しました')
 return n

def migrate_master(force):
 src_path=find_old_accdb(['マスタ.accdb','マスタデータ.accdb','Master.accdb'])
 dst_path=dba.DBS['MASTER']['path']
 print(f'マスタ: {src_path} -> {dst_path}')
 if not src_path:
  print('  移行元(マスタ.accdb)が見つからないためスキップします。');return
 for table,_ in MASTER_TABLE_ENSURERS:
  if not force and table_has_rows(dst_path,table):
   print(f'  中断: {dst_path.name} の [{table}] に既にデータがあります。'
         '再移行するには --force を指定してください。');return
 try:
  with dba.connect(src_path,True,engine='access') as src_conn, dba.connect(dst_path,False,engine='sqlite') as dst_conn:
   if force:
    for table,_ in MASTER_TABLE_ENSURERS:
     if table in dba.tables(dst_conn):dst_conn.cursor().execute(f'DELETE FROM {dba.qi(table)}')
    dst_conn.commit()
   total=0
   for table,ensure_fn in MASTER_TABLE_ENSURERS:
    total+=copy_table(src_conn,dst_conn,table,ensure_fn)
  print(f'  マスタ移行完了: 合計{total}件')
 except pyodbc.Error as e:
  print(f'  移行元(Access)に接続できませんでした(Accessドライバ未インストール等): {e}')

def migrate_measurement(force):
 src_path=find_old_accdb(['測定データ.accdb','Measurement.accdb'])
 dst_path=dba.MEAS_DB
 table='Web測定バックアップ'
 print(f'測定データ: {src_path} -> {dst_path}')
 if not src_path:
  print('  移行元(測定データ.accdb)が見つからないためスキップします。');return
 if not force and table_has_rows(dst_path,table):
  print(f'  中断: {dst_path.name} の [{table}] に既にデータがあります。'
        '再移行するには --force を指定してください。');return
 try:
  with dba.connect(src_path,True,engine='access') as src_conn, dba.connect(dst_path,False,engine='sqlite') as dst_conn:
   if force and table in dba.tables(dst_conn):
    dst_conn.cursor().execute(f'DELETE FROM {dba.qi(table)}');dst_conn.commit()
   total=copy_table(src_conn,dst_conn,table,dba.ensure_backup_table)
  print(f'  測定データ移行完了: 合計{total}件')
 except pyodbc.Error as e:
  print(f'  移行元(Access)に接続できませんでした(Accessドライバ未インストール等): {e}')

if __name__=='__main__':
 force='--force' in sys.argv[1:]
 print('=== WaveLog: Access -> SQLite 移行 ===')
 migrate_master(force)
 migrate_measurement(force)
 print('=== 完了 ===')
