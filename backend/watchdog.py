"""watchdog.py: プロセスの寿命（片付けて終わる・明示停止・ハートビート）。

app.pyから起動制御を切り離したもの。業務機能の変更が起動・停止の挙動へ
影響しないようにするため、プロセスの寿命に関わる処理はここへ集める。

**終わり方は`_exit()`の1箇所**（片付け＝書込役・編集セッション・在席を通ってから）。
入口は3つ: 窓を閉じる（デスクトップ版の窓口`program/sidecar.py`が標準入力の閉じで呼ぶ）、
画面の「アプリを終了」（`/api/app/quit`）、明示停止（`/api/shutdown`・開発と網の入口を止める）。

以前のブラウザ版は「開いているタブが0件になったら終わる」見張り（タブごとのハートビート・
閉じた通知・猶予8秒／90秒・§9.98）を持っていた。§9.548 でブラウザ版の起動の道を外したので、
その見張りも外した——窓を閉じれば窓口の入力が閉じるので、推し量る必要が無い。
ハートビート（`/api/heartbeat`）は**在席と版の知らせ**のために残る（§9.272・§9.515）。

os._exit()を使うのは、別スレッドからsys.exit()を呼んでもそのスレッドが
終わるだけでプロセス自体は終了しないため(SystemExitはスレッドローカル)。
"""
from flask import jsonify, request
import os
import threading

from .logging_setup import launcher_logger
from .quiet import quiet

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

def install(app):
 """Flaskアプリへハートビート関連のルートを登録する。"""
 @app.post('/api/heartbeat')
 def heartbeat():
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

 @app.post('/api/shutdown')
 def shutdown():
  """明示停止（開発と網の入口を止める・§9.548）。応答を返してから終了したいので少し遅らせる。
     片付け（書込役・編集セッション・在席）は`_exit()`が持つ（§9.301 ②）。"""
  threading.Timer(0.3,lambda:_exit('明示停止の要求を受け付けた(/api/shutdown)')).start()
  return jsonify(ok=True,stopping=True)

 @app.get('/api/app/quit-check')
 def app_quit_check():
  """終了ボタンを押す前に**何が起きるか**を答える（§9.301 ②）。

  **判定はここ1箇所**（§9.163）——画面はこの答えをそのまま出す。
  未保存の測定は**画面しか知らない**（端末のブラウザの中にある・§9.202）ので、
  ここでは数えない。画面の側が自分で見て添える。"""
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
  return jsonify(ok=True,isOwner=owner,sessions=sessions)

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
