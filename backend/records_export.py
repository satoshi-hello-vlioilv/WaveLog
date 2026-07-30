"""records_export.py: 測定データバックアップ(records.sqlite3)の閲覧用複製。

config/local.jsonの"records_backup_export_path"が設定されている場合のみ、
records.sqlite3への書き込みがあった際に変化フラグ(mark_dirty)を立てておき、
一定間隔(RECORDS_BACKUP_EXPORT_INTERVAL_SEC)ごとに変化があれば複製する
(変化が無ければ何もしない。負荷軽減のため)。

複製はsqlite3.Connection.backup()(オンラインバックアップAPI)を使う。単純な
ファイルコピーだと書き込み中のファイルを複製したときに壊れたコピーになり
得るため、書き込み中でも整合性の取れたコピーを作れるこのAPIを使う。

複製先がBox等の同期フォルダで書き込みが遅い/失敗しても、測定データの
ローカル保存自体は絶対にブロックしない(呼び出し元はmark_dirty()を呼ぶだけ
で、複製の成否を待たない)。失敗時は次回また複製を試みる。
"""
import sqlite3
import threading
import time

from .config import RECORDS_BACKUP_EXPORT_INTERVAL_SEC
from .db_access import MEAS_DB, RECORDS_BACKUP_EXPORT_PATH
from .logging_setup import app_logger

_dirty=threading.Event()

def mark_dirty():
 """records.sqlite3への書き込み成功後に呼ぶ。次回の定期チェックで複製される。"""
 if RECORDS_BACKUP_EXPORT_PATH is not None:
  _dirty.set()

def export_once():
 """今すぐ複製を試みる。戻り値は成功可否(例外は投げない)。"""
 if RECORDS_BACKUP_EXPORT_PATH is None or not MEAS_DB.exists():
  return False
 src=dst=None
 try:
  RECORDS_BACKUP_EXPORT_PATH.parent.mkdir(parents=True,exist_ok=True)
  src=sqlite3.connect(str(MEAS_DB))
  dst=sqlite3.connect(str(RECORDS_BACKUP_EXPORT_PATH))
  src.backup(dst)
  return True
 except Exception as e:
  app_logger().warning('測定データバックアップの複製に失敗しました(%s): %s',RECORDS_BACKUP_EXPORT_PATH,e)
  return False
 finally:
  if dst is not None:dst.close()
  if src is not None:src.close()

def _loop():
 while True:
  time.sleep(RECORDS_BACKUP_EXPORT_INTERVAL_SEC)
  if not _dirty.is_set():continue
  _dirty.clear()
  if not export_once():_dirty.set()  # 失敗時は次回また試みる

def start():
 """複製の背景スレッドを開始する(デーモンスレッド)。
    records_backup_export_path未設定なら何もしない(既定は現状維持)。"""
 if RECORDS_BACKUP_EXPORT_PATH is None:return
 threading.Thread(target=_loop,daemon=True,name='records-export').start()
