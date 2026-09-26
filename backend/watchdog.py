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
from .quiet import quiet

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

# 片付けに使ってよい時間（§9.301 ②）。**終了そのものは止めない**——共有が
# 不調でも閉じられなくなっては困る（§9.108「確認のつもりの1行が唯一の失敗
# 原因になる」と同じ理由）。片付けは別スレッドで走らせ、この秒数で見切る。
TEARDOWN_BUDGET_SEC=3.0


def teardown():
 """終わる前の片付け（§9.301 ②、利用者の指示「安全なアプリの終了ボタンも
 欲しいです」）。

 **落ちるときに必ず1回だけ通る道**——`_exit()`から呼ぶので、タブを閉じた
 ときも`stop.bat`のときも終了ボタンのときも同じ片付けが走る（3つ持つと、
 どれか1つだけ片付け忘れる）。

 片付けないと、その端末が持っていた**共有の目印が期限まで残る**:
  ・書込役の目印(schedule.owner.json、既定90秒)……他の端末はその間ずっと
    「書込役は生きている」と信じ、書き込みのたびに届かない相手を待つ
    （利用者の報告「書き込み失敗するような場合」の正体・§9.301 ①）。
  ・編集セッション(schedule.sessions.json、既定90秒)……他の端末が
    その設備を読み取り専用のまま待たされる（§9.211 ②）。
  ・在席(presence/<端末キー>.json)……接続状況に幽霊が残る（§9.272）。

 **どれも失敗してよい**（期限で消えるのが本来の保険）。戻り値は片付けた
 内容で、終了ボタンが「何をしたか」を画面へ出せるようにしてある（§4）。
 """
 done={'owner':False,'sessions':[],'presence':False,'errors':[]}
 try:
  from .access_mode import current_login_id,current_pc_name
  login,pc=current_login_id(),current_pc_name()
 except Exception as e:
  login,pc='',''
  done['errors'].append(f'名乗り: {e}')
 # ① 書込役をやめる（いちばん効く。次の端末が期限を待たずに引き継げる）
 try:
  from . import schedule_owner
  if schedule_owner.is_owner():
   schedule_owner.resign()
   done['owner']=True
 except Exception as e:
  done['errors'].append(f'書込役: {e}')
 # ② 編集セッションを手放す
 try:
  from . import schedule_sync
  done['sessions']=schedule_sync.release_my_sessions(login,pc)
 except Exception as e:
  done['errors'].append(f'編集セッション: {e}')
 # ③ 在席を消す
 try:
  from . import presence
  presence.leave(login,pc)
  done['presence']=True
 except Exception as e:
  done['errors'].append(f'在席: {e}')
 return done


def _teardown_within_budget(log):
 """片付けを**時間で見切る**。共有が不調なときに終了が止まらないように、
 別スレッドで走らせて`TEARDOWN_BUDGET_SEC`だけ待つ。"""
 out={}
 def run():
  try:out.update(teardown() or {})
  except Exception as e:out['errors']=[str(e)]
 t=threading.Thread(target=run,name='teardown',daemon=True)
 t.start()
 t.join(TEARDOWN_BUDGET_SEC)
 if t.is_alive():
  log.info('片付け      : 時間切れ（%.1f秒）。共有の目印は期限で消えます',
           TEARDOWN_BUDGET_SEC)
  return {'timeout':True}
 log.info('片付け      : 書込役=%s / 編集セッション=%s / 在席=%s%s',
          'やめた' if out.get('owner') else 'なし',
          ('、'.join(out.get('sessions') or []) or 'なし'),
          '消した' if out.get('presence') else 'なし',
          ('  ※'+' / '.join(out['errors']) if out.get('errors') else ''))
 return out


def _exit(reason,code=0):
 """終了理由を必ず記録してからプロセスを終了する(仕様書2.6)。

 **記録の前に片付ける**（§9.301 ②）——共有の目印を残したまま落ちると、
 他の端末が期限（既定90秒）まで待たされる。"""
 log=launcher_logger()
 log.info('終了理由    : %s',reason)
 try:_teardown_within_budget(log)
 except Exception as e:log.warning('片付けで例外: %s',e)
 log.info('--- 終了 ---')
 for handler in log.handlers:
  try:handler.flush()
  except Exception as _e:quiet('ログを書き切れない（終了は続ける）',_e)
 os._exit(code)

def active_tab_count():
 with _tabs_lock:
  return len(_active_tabs)

def install(app):
 """Flaskアプリへハートビート関連のルートを登録する。"""
 @app.post('/api/heartbeat')
 def heartbeat():
  global _closed_notice,_empty_since
  with _tabs_lock:
   _active_tabs[_tab_key()]=time.monotonic()
   # 1件でも生きているなら「閉じた」の記憶は捨てる。リロードは
   # close→(すぐに)新しいIDのheartbeat、という順で届くため、
   # ここで戻さないと読み直しただけで終了してしまう。
   _closed_notice=False
   # **「0件になった時刻」も同時に捨てる**（§9.302の追補）。
   # `_empty_since`は起動時にセットされ、監視が**次に起きたとき**にしか
   # 消えない。そのため「起動 → 10秒未満で画面を開く → すぐリロード」を
   # すると、閉じた通知で監視が起こされた時点でまだ起動時の値が入っており、
   # `now - _empty_since` が既に8秒を超えていて**その場で終了する**
   # （実測: サーバー起動の7秒後に開いてリロードしたら1秒未満で落ちた）。
   # §9.98で禁じた「リロードで終了してしまう」が、§9.284の旗の消し忘れとは
   # **別の道**で起きていた形。**タブが名乗った時点で0件ではない。**
   _empty_since=None
  # ---- 在席(§9.272) ----
  # **ハートビートに相乗りさせる**——専用の周期を足すと、間隔・失敗時の
  # 扱い・タブを閉じたときの後始末を2つ持つことになる。
  # **書くのは裏のスレッド**で、ここは待たない(共有が遅いときに
  # ハートビートを止めない)。失敗しても ok を返す——在席が出ないことより
  # 「生きていると言えない」ことのほうが重い(§9.98)。
  # ---- 版の知らせ(§9.515) ----
  # 運用中の最新版を**全区分の端末へ**届ける道もここに相乗りさせる
  # (`/api/presence`は区分で断るので、設備作業者の端末には届かない)。
  # 返すのは裏で数えてある値だけ——ここで共有を読みに行かない。
  notice=None
  try:
   from . import presence
   from .access_mode import current_login_id,current_pc_name,current_permission_flags,get_mode
   role=current_permission_flags().get('role','')
   presence.touch_async(current_login_id(),current_pc_name(),get_mode(),role,
                        str(request.args.get('view') or '')[:40])
   notice=presence.version_notice(role)   # 開発者の端末は急かさない(§9.516)
  except Exception as _e:
   quiet('在席を書けない（ハートビートは受け付ける）',_e)
  return jsonify(ok=True,version=notice)

 @app.post('/api/heartbeat/close')
 def heartbeat_close():
  global _closed_notice
  with _tabs_lock:
   _active_tabs.pop(_tab_key(),None)
   if not _active_tabs:_closed_notice=True
  if not _active_tabs:
   # 最後のタブが閉じた＝この端末はもう繋いでいない。**消せなくてもTTLで
   # 消える**ので、失敗しても何もしない。
   try:
    from . import presence
    from .access_mode import current_login_id,current_pc_name
    presence.leave(current_login_id(),current_pc_name())
   except Exception as _e:
    quiet('在席から抜けられない（期限で自然に消える）',_e)
  _wake.set()          # 寝て待たずに、すぐ数え始める
  return jsonify(ok=True)

 @app.post('/api/shutdown')
 def shutdown():
  """stop.bat 等からの明示停止。まずアプリ自身へ正常終了を要求する経路
     (仕様書2.8)。応答を返してから終了したいので少し遅らせる。
     片付け（書込役・編集セッション・在席）は`_exit()`が持つ（§9.301 ②）。"""
  threading.Timer(0.3,lambda:_exit('明示停止の要求を受け付けた(/api/shutdown)')).start()
  return jsonify(ok=True,stopping=True)

 @app.get('/api/app/quit-check')
 def app_quit_check():
  """終了ボタンを押す前に**何が起きるか**を答える（§9.301 ②）。

  **判定はここ1箇所**（§9.163）——画面はこの答えをそのまま出す。
  未保存の測定は**画面しか知らない**（端末のブラウザの中にある・§9.202）ので、
  ここでは数えない。画面の側が自分で見て添える。"""
  tabs=active_tab_count()
  owner=False;sessions=[]
  try:
   from . import schedule_owner
   owner=schedule_owner.is_owner()
  except Exception as _e:quiet('書込役かどうかを確かめられない（その一言を出さない）',_e)
  try:
   from . import schedule_sync
   from .access_mode import current_login_id,current_pc_name
   st=schedule_sync.sessions_all(current_login_id(),current_pc_name())
   sessions=[x['equipment'] for x in (st.get('sessions') or []) if x.get('mine')]
  except Exception as _e:quiet('編集権の状況を引けない（その一言を出さない）',_e)
  return jsonify(ok=True,tabs=tabs,isOwner=owner,sessions=sessions)

 @app.post('/api/app/quit')
 def app_quit():
  """画面の「アプリを終了」（§9.301 ②、利用者の指示「安全なアプリの終了
  ボタンも欲しいです」）。

  `/api/shutdown`と**同じ道**（`_exit()`）を通す——片付けの手順を2つ持つと、
  片方だけ直した状態が作れる。違うのは「誰が押したか」を記録へ残すことだけ。
  """
  who=''
  try:
   from .access_mode import current_login_id,current_pc_name
   who=f'{current_login_id() or "?"}@{current_pc_name() or "?"}'
  except Exception as _e:quiet('誰が終了したかを記録できない（終了は続ける）',_e)
  threading.Timer(0.3,lambda:_exit(f'画面の終了ボタン({who})')).start()
  return jsonify(ok=True,stopping=True)

 return app

def _loop():
 global _empty_since,_closed_notice
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
   # **タブが戻ったら「閉じたと告げられた」は過去のこと**（§9.284）。
   # 以前はこの旗が一度立つと二度と下りず、**次に0件になったときの意味に
   # 関わらず8秒で終了**していた。リロードで一度立ってしまうと、以降は
   # 「気づいたら0件だった」（通知が届かなかった・スリープ復帰・重い画面の
   # 読み直し）まで8秒扱いになる——§9.98で「8秒へ揃えるとリロードや別ページへ
   # の移動で終了してしまう」と書いた壊れ方そのものが、旗の消し忘れで
   # 起きていた（実測: 回帰テストの重い一覧を読み直すとアプリが落ちた）。
   _closed_notice=False
   continue
  # **写しへ取ってから使うこと**——`heartbeat()`が別スレッドから
  # `_empty_since=None`を書きうるので、判定の途中で読み直すと
  # `now-None`でTypeErrorになる（そのときは終了の判定そのものが落ちる）。
  since=_empty_since
  if since is None:
   _empty_since=now
   continue
  # 閉じたと分かっているなら短く、気づいたら0件だったなら長く待つ。
  grace=CLOSED_GRACE_SEC if closed else EMPTY_GRACE_SEC
  if now-since>grace:
   _exit(f'開いているタブが{grace}秒以上存在しない'
         +('(タブが閉じられた通知を受け取った)' if closed else '(ブラウザを閉じたと判断)'))

def start():
 """監視スレッドを開始する。デーモンスレッドなので本体終了を妨げない。"""
 global _empty_since
 _empty_since=time.monotonic()
 threading.Thread(target=_loop,daemon=True,name='watchdog').start()
