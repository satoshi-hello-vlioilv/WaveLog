"""watchdog.py: プロセスの生存管理(ハートビート監視・明示停止)。

app.pyから起動制御を切り離したもの。業務機能の変更が起動・停止の挙動へ
影響しないようにするため、プロセスの寿命に関わる処理はここへ集める。

【判定の考え方】
フロント(base.js)はタブごとに固有IDを発行し、開いている間は定期的に
POST /api/heartbeat?tab=<id> で自分の存在を伝える。タブを閉じる・別ページへ
移動する際は pagehide から POST /api/heartbeat/close?tab=<id> を送り、その
タブが無くなったことを明示的に知らせる(リロード時も pagehide は発火するが、
直後に新しいタブIDのハートビートが届くため、猶予以内なら消えたと判定しない)。

【0件の意味を2つに分ける】(§9.98)
同じ「開いているタブが0件」でも、**そうなった経緯で意味が違う**。

  閉じたと告げられた   … CLOSED_GRACE_SEC(8秒)。利用者がタブを閉じた場合で、
                         もう戻ってこないと分かっている。リロードだけは
                         直後に新しいIDのハートビートが来るので、それを
                         待てるぶんだけ残す。
  気づいたら0件だった … EMPTY_GRACE_SEC(90秒)。通知が届かなかった場合で、
                         本当に閉じたのか一時的なものか分からない。

以前はどちらも90秒だったため、**タブを閉じてもアプリが1分半残っていた**
(実測85秒)。さらに監視は10秒間隔で寝ているので、通知が届いても最大10秒
気づかない。終了通知で監視を起こし(_wake)、閉じた直後だけ1秒間隔で見る。
結果、閉じてから約8秒で終了する。

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

from .config import (CLOSED_GRACE_SEC, EMPTY_GRACE_SEC, HEARTBEAT_STALE_SEC,
                     WATCHDOG_CHECK_INTERVAL_SEC, WATCHDOG_CLOSING_INTERVAL_SEC)
from .logging_setup import launcher_logger

_active_tabs={}
_tabs_lock=threading.Lock()
_empty_since=time.monotonic()
# 終了通知が届いた瞬間に監視を起こす。**寝ている間は気づけない**ので、
# これが無いと「8秒の猶予」の前に最大10秒の寝落ちが挟まる(実測18秒)。
_wake=threading.Event()
# **最後の1件が「閉じた」と告げて消えたのか**(§9.98)。
# 同じ0件でも意味が違う: 閉じたと分かっているなら短く待てばよく、
# 気づいたら0件だった(通知が届かなかった)なら長く待つ。
_closed_notice=False

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
  global _closed_notice
  with _tabs_lock:
   _active_tabs[_tab_key()]=time.monotonic()
   # 1件でも生きているなら「閉じた」の記憶は捨てる。リロードは
   # close→(すぐに)新しいIDのheartbeat、という順で届くため、
   # ここで戻さないと読み直しただけで終了してしまう。
   _closed_notice=False
  return jsonify(ok=True)

 @app.post('/api/heartbeat/close')
 def heartbeat_close():
  global _closed_notice
  with _tabs_lock:
   _active_tabs.pop(_tab_key(),None)
   if not _active_tabs:_closed_notice=True
  _wake.set()          # 寝て待たずに、すぐ数え始める
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
  # 「閉じた」と告げられた直後だけ細かく見る(§9.98)。10秒間隔のままだと
  # 8秒の猶予を確かめるのが最大10秒後になり、結局18秒近くかかる。
  _wake.wait(WATCHDOG_CLOSING_INTERVAL_SEC if _closed_notice else WATCHDOG_CHECK_INTERVAL_SEC)
  _wake.clear()
  now=time.monotonic()
  with _tabs_lock:
   for tab in [t for t,last in _active_tabs.items() if now-last>HEARTBEAT_STALE_SEC]:
    del _active_tabs[tab]
   empty=not _active_tabs
   closed=_closed_notice
  if not empty:
   _empty_since=None
   continue
  if _empty_since is None:
   _empty_since=now
   continue
  # 閉じたと分かっているなら短く、気づいたら0件だったなら長く待つ。
  grace=CLOSED_GRACE_SEC if closed else EMPTY_GRACE_SEC
  if now-_empty_since>grace:
   _exit(f'開いているタブが{grace}秒以上存在しない'
         +('(タブが閉じられた通知を受け取った)' if closed else '(ブラウザを閉じたと判断)'))

def start():
 """監視スレッドを開始する。デーモンスレッドなので本体終了を妨げない。"""
 global _empty_since
 _empty_since=time.monotonic()
 threading.Thread(target=_loop,daemon=True,name='watchdog').start()
