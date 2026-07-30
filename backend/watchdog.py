"""watchdog.py: プロセスの生存管理(ハートビート監視・明示停止)。

app.pyから起動制御を切り離したもの。業務機能の変更が起動・停止の挙動へ
影響しないようにするため、プロセスの寿命に関わる処理はここへ集める。

【判定の考え方】
フロント(base.js)はタブごとに固有IDを発行し、開いている間は定期的に
POST /api/heartbeat?tab=<id> で自分の存在を伝える。タブを閉じる・別ページへ
移動する際は pagehide から POST /api/heartbeat/close?tab=<id> を送り、その
タブが無くなったことを明示的に知らせる(リロード時も pagehide は発火するが、
同じtab idのハートビートが直後に届くため EMPTY_GRACE_SEC 以内なら消えたと
判定しない)。開いているタブが0件のままEMPTY_GRACE_SEC秒経過したら終了する。

判定基準を「通信が届くかどうか」ではなく「タブが存在するかどうか」にして
いるのは、Wi-Fi瞬断など単なる通信断でもタブ自体は開いたままのケースがあり、
通信復旧後もプロセスが既に終了していて二度と繋がらなくなる不具合があった
ため。ハートビートが届かないことだけを根拠にした終了(HEARTBEAT_STALE_SEC)は、
強制終了・端末のフリーズ・停電などpagehideが発火しない異常系のみを想定した
保険として、通信瞬断では発動しない程度に十分長くする。

os._exit()を使うのは、別スレッドからsys.exit()を呼んでもそのスレッドが
終わるだけでプロセス自体は終了しないため(SystemExitはスレッドローカル)。
"""
from flask import jsonify, request
import os
import threading
import time

from .config import EMPTY_GRACE_SEC, HEARTBEAT_STALE_SEC, WATCHDOG_CHECK_INTERVAL_SEC
from .logging_setup import launcher_logger

_active_tabs={}
_tabs_lock=threading.Lock()
_empty_since=time.monotonic()

def _tab_key():
 return request.args.get('tab') or 'default'

def _exit(reason,code=0):
 """終了理由を必ず記録してからプロセスを終了する(仕様書2.6)。"""
 log=launcher_logger()
 log.info('終了理由    : %s',reason)
 log.info('--- 終了 ---')
 for handler in log.handlers:
  try:handler.flush()
  except Exception:pass
 os._exit(code)

def active_tab_count():
 with _tabs_lock:
  return len(_active_tabs)

def install(app):
 """Flaskアプリへハートビート関連のルートを登録する。"""
 @app.post('/api/heartbeat')
 def heartbeat():
  with _tabs_lock:
   _active_tabs[_tab_key()]=time.monotonic()
  return jsonify(ok=True)

 @app.post('/api/heartbeat/close')
 def heartbeat_close():
  with _tabs_lock:
   _active_tabs.pop(_tab_key(),None)
  return jsonify(ok=True)

 @app.post('/api/shutdown')
 def shutdown():
  """stop.bat 等からの明示停止。まずアプリ自身へ正常終了を要求する経路
     (仕様書2.8)。応答を返してから終了したいので少し遅らせる。"""
  threading.Timer(0.3,lambda:_exit('明示停止の要求を受け付けた(/api/shutdown)')).start()
  return jsonify(ok=True,stopping=True)

 return app

def _loop():
 global _empty_since
 while True:
  time.sleep(WATCHDOG_CHECK_INTERVAL_SEC)
  now=time.monotonic()
  with _tabs_lock:
   for tab in [t for t,last in _active_tabs.items() if now-last>HEARTBEAT_STALE_SEC]:
    del _active_tabs[tab]
   empty=not _active_tabs
  if not empty:
   _empty_since=None
   continue
  if _empty_since is None:
   _empty_since=now
  elif now-_empty_since>EMPTY_GRACE_SEC:
   _exit(f'開いているタブが{EMPTY_GRACE_SEC}秒以上存在しない(ブラウザを閉じたと判断)')

def start():
 """監視スレッドを開始する。デーモンスレッドなので本体終了を妨げない。"""
 global _empty_since
 _empty_since=time.monotonic()
 threading.Thread(target=_loop,daemon=True,name='watchdog').start()
