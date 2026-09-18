"""process_manager.py: 対象アプリだけを安全に停止する。

同じPCで動く別のPythonアプリを巻き添えにしないため、プロセス名(python.exe)
では絶対に判定しない。停止は次の順序で行う(仕様書2.8)。

  1. まずアプリ自身へ正常終了を要求する(POST /api/shutdown)
  2. 応答しない場合だけ、記録しておいたプロセスIDを使う
  3. 強制終了の前に、そのPIDが「このフォルダーのアプリ」として記録された
     ものであることを確認する(instance.json の app_root を照合)

使い方:
  python process_manager.py stop     停止する
  python process_manager.py status   起動状況を表示する
"""
import _approot  # noqa: F401 副作用のためのimport。**いちばん最初に**（program/から実行されるので、リポジトリ直下をimportの探索先へ入れる・§9.404）
import _pycache_bootstrap  # noqa: F401,E402 副作用のためのimport。stop.bat等から単独実行されるため必要

import json
import os
import signal
import sys
import time
import urllib.request

from backend.launcher import guard as launch_guard
from backend.config import HOST, PORT
from backend.paths import APP_ROOT
from backend.logging_setup import launcher_logger
from backend.quiet import quiet


def request_shutdown(timeout=3.0):
 """アプリ自身へ正常終了を要求する。受け付けられたらTrue。"""
 req=urllib.request.Request(f'http://{HOST}:{PORT}/api/shutdown',method='POST',data=b'')
 try:
  # プロキシを経由させない(guard.urlopen_local参照。社内プロキシ設定のある
  # 端末では127.0.0.1宛てまで転送され、407で停止できなくなる)。
  with launch_guard.urlopen_local(req,timeout=timeout) as r:
   return json.loads(r.read().decode('utf-8','replace')).get('stopping') is True
 except Exception as _e:
  quiet('アプリが正常終了の要求に答えない（記録したPIDでの停止へ進む）',_e)
  return False


def wait_until_stopped(seconds=10.0,interval=0.4):
 deadline=time.monotonic()+seconds
 while time.monotonic()<deadline:
  if not launch_guard.port_in_use():
   return True
  time.sleep(interval)
 return not launch_guard.port_in_use()


def force_stop():
 """記録済みPIDを使った強制終了。このフォルダーのアプリに限る。"""
 log=launcher_logger()
 info=launch_guard.read_instance()
 if not info:
  log.error('停止: 起動情報(instance.json)が無いため、強制終了できません')
  return False
 pid=info.get('pid')
 recorded_root=info.get('app_root')
 # プロセス名ではなく「このフォルダーのアプリとして記録されたPIDか」で判定する。
 if recorded_root!=str(APP_ROOT):
  log.error('停止: 記録されたアプリ配置(%s)が現在の配置(%s)と異なるため中止しました',
            recorded_root,APP_ROOT)
  return False
 if not isinstance(pid,int):
  log.error('停止: 記録されたプロセスIDが不正です: %r',pid)
  return False
 try:
  os.kill(pid,signal.SIGTERM)
 except ProcessLookupError:
  log.info('停止: プロセス %s は既に存在しません',pid)
  return True
 except Exception as e:
  log.error('停止: プロセス %s を終了できませんでした: %s',pid,e)
  return False
 log.info('停止: プロセス %s へ終了を要求しました',pid)
 return wait_until_stopped(5.0)


def stop():
 log=launcher_logger()
 state,info=launch_guard.probe()
 if state==launch_guard.FREE:
  log.info('停止: アプリは起動していません')
  print('アプリは起動していません。')
  return 0
 if state==launch_guard.FOREIGN:
  # 原因調査用に、実際に何が応答したかも残す(次回同じ現象が起きたときに
  # 「本当に別アプリなのか、WaveLogだが何かおかしいのか」をログだけで
  # 切り分けられるようにするため)。
  detail=f' (応答内容: {info})' if info else ''
  log.error('停止: ポート %s は別のアプリが使用しています。停止しません%s',PORT,detail)
  print(f'ポート {PORT} は別のアプリが使用しています。停止操作は行いません。{detail}')
  return 1
 if state==launch_guard.UNRESPONSIVE:
  # HTTPが応答しない(重いネットワーク共有I/O等でブロックされている可能性)。
  # POST /api/shutdownを送っても同じ理由で処理されない見込みが高いため、
  # 最初から記録済みPIDでの強制終了へ進む(force_stop()がinstance.jsonの
  # app_rootを照合し、このフォルダーのアプリでなければ拒否する)。
  log.info('停止: ポート %s は使用中だが応答が無いため、記録済みのプロセスIDで終了します',PORT)
  print('応答が無いため、記録済みのプロセスIDで終了します…')
  if force_stop():
   launch_guard.clear_instance()
   print('停止しました。')
   return 0
  print('停止できませんでした。ログを確認してください。')
  return 1

 print('アプリへ終了を要求しています…')
 if request_shutdown() and wait_until_stopped():
  log.info('停止: 正常終了しました')
  launch_guard.clear_instance()
  print('停止しました。')
  return 0

 print('応答が無いため、記録済みのプロセスIDで終了します…')
 if force_stop():
  launch_guard.clear_instance()
  print('停止しました。')
  return 0
 print('停止できませんでした。ログを確認してください。')
 return 1


def status():
 state,info=launch_guard.probe()
 if state==launch_guard.OURS:
  print(f'起動中です (バージョン {info.get("version","?")} / ポート {PORT})')
 elif state==launch_guard.FOREIGN:
  print(f'ポート {PORT} を別のアプリが使用しています。')
 elif state==launch_guard.UNRESPONSIVE:
  print(f'ポート {PORT} は使用中ですが応答がありません(重い処理でブロックされている可能性があります)。')
 else:
  print('起動していません。')
 recorded=launch_guard.read_instance()
 if recorded:
  print(f'  記録: PID={recorded.get("pid")} 起動={recorded.get("started_at")}')
 return 0


if __name__=='__main__':
 command=sys.argv[1] if len(sys.argv)>1 else 'status'
 sys.exit(stop() if command=='stop' else status())
