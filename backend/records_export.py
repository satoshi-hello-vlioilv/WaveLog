"""records_export.py: 測定データバックアップ(records.sqlite3)の閲覧用複製。

パス設定マスタの"records_backup_export_path"が設定されている場合のみ、
records.sqlite3への書き込みがあった際に変化フラグ(mark_dirty)を立てておき、
一定間隔ごとに変化があれば複製する(変化が無ければ何もしない。負荷軽減のため)。
間隔は"records_backup_export_interval_sec"(既定600秒)で、**呼び出しのたびに
読み直す**ので再起動は要らない(複製先のパスは接続先と同じ扱いで再起動が要る)。

複製はsqlite3.Connection.backup()(オンラインバックアップAPI)を使う。単純な
ファイルコピーだと書き込み中のファイルを複製したときに壊れたコピーになり
得るため、書き込み中でも整合性の取れたコピーを作れるこのAPIを使う。

複製先がBox等の同期フォルダで書き込みが遅い/失敗しても、測定データの
ローカル保存自体は絶対にブロックしない(呼び出し元はmark_dirty()を呼ぶだけ
で、複製の成否を待たない)。失敗時は次回また複製を試みる。

**いつ・何が起きたかを画面へ出せるようにしておく**(§9.202)。以前は成否を
ログにしか書いておらず、利用者からは「複製されているのかどうか」が
一切分からなかった(設定画面そのものが無かった)。
"""
import sqlite3
import threading
import time

from .config import RECORDS_BACKUP_EXPORT_INTERVAL_SEC
from .db_access import MEAS_DB, RECORDS_BACKUP_EXPORT_PATH, RECORDS_SHARE_DIR, path_config_value
from .logging_setup import app_logger

_dirty=threading.Event()
# 最後に試した結果。画面(GET /api/measurement/storage)がそのまま出す。
_state={'lastOkAt':None,'lastTryAt':None,'lastError':'','running':False}
_lock=threading.Lock()

# 測定データを設備ごとに共有へ置く運用(§9.258)にすると、この複製は**役目を終える**。
# 閲覧端末は records_paths_all() で全設備のファイルを直接読むので写しが要らず、
# しかも写しは**全端末が同じ1ファイルへ書く**形なので、残すと消したばかりの
# 「同じファイルを2台が変える」を1つだけ残すことになる。
# **黙って止めないこと**——理由を status() が返し、画面がそのまま出す(§4)。
def retired_reason():
 if RECORDS_SHARE_DIR is None:return ''
 return ('測定データは設備ごとに共有へ置く設定になっているため、閲覧用の複製は使いません'
         f'（{RECORDS_SHARE_DIR}）。閲覧端末はそちらを直接読みます。')

def interval_sec():
 """複製を見に行く間隔(秒)。パス設定マスタから毎回読み直す。"""
 try:
  raw=path_config_value('records_backup_export_interval_sec',RECORDS_BACKUP_EXPORT_INTERVAL_SEC)
  n=int(str(raw).strip() or RECORDS_BACKUP_EXPORT_INTERVAL_SEC)
 except Exception:
  n=RECORDS_BACKUP_EXPORT_INTERVAL_SEC
 return max(30,n)

def mark_dirty():
 """records.sqlite3への書き込み成功後に呼ぶ。次回の定期チェックで複製される。"""
 if RECORDS_BACKUP_EXPORT_PATH is not None:
  _dirty.set()

def pending():
 """まだ複製していない変更があるか。"""
 return bool(_dirty.is_set())

def status():
 """いまの状態。**設定していないことも「状態」として返す**——画面が
    「複製しない設定です」と書けるようにするため(推測させない)。"""
 with _lock:
  st=dict(_state)
 st['configured']=RECORDS_BACKUP_EXPORT_PATH is not None
 st['path']=str(RECORDS_BACKUP_EXPORT_PATH) if RECORDS_BACKUP_EXPORT_PATH else ''
 st['intervalSec']=interval_sec()
 st['retired']=retired_reason()
 st['pending']=pending()
 st['size']=None
 st['exists']=None
 if RECORDS_BACKUP_EXPORT_PATH is not None:
  # **statの失敗は「分からない」**として扱う(共有越しではstatだけ失敗する)。
  try:
   st['size']=RECORDS_BACKUP_EXPORT_PATH.stat().st_size
   st['exists']=True
  except FileNotFoundError:
   st['exists']=False
  except OSError:
   st['exists']=None
 return st

def export_once():
 """今すぐ複製を試みる。戻り値は成功可否(例外は投げない)。"""
 if retired_reason():
  with _lock:_state['lastError']=retired_reason()
  return False
 if RECORDS_BACKUP_EXPORT_PATH is None or not MEAS_DB.exists():
  return False
 src=dst=None
 with _lock:
  _state['lastTryAt']=time.time();_state['running']=True
 try:
  RECORDS_BACKUP_EXPORT_PATH.parent.mkdir(parents=True,exist_ok=True)
  src=sqlite3.connect(str(MEAS_DB))
  dst=sqlite3.connect(str(RECORDS_BACKUP_EXPORT_PATH))
  src.backup(dst)
  with _lock:
   _state['lastOkAt']=time.time();_state['lastError']=''
  return True
 except Exception as e:
  app_logger().warning('測定データバックアップの複製に失敗しました(%s): %s',RECORDS_BACKUP_EXPORT_PATH,e)
  with _lock:
   _state['lastError']=str(e)
  return False
 finally:
  with _lock:_state['running']=False
  if dst is not None:dst.close()
  if src is not None:src.close()

def export_now():
 """画面の「いま複製する」。変化が無くても実行する(押した手応えを返す)。"""
 ok=export_once()
 if ok:_dirty.clear()
 return ok

def _loop():
 while True:
  time.sleep(interval_sec())
  if not _dirty.is_set():continue
  _dirty.clear()
  if not export_once():_dirty.set()  # 失敗時は次回また試みる

def start():
 """複製の背景スレッドを開始する(デーモンスレッド)。
    records_backup_export_path未設定なら何もしない(既定は現状維持)。"""
 if RECORDS_BACKUP_EXPORT_PATH is None:return
 if retired_reason():
  app_logger().info('閲覧用複製は行いません: %s',retired_reason());return
 threading.Thread(target=_loop,daemon=True,name='records-export').start()
