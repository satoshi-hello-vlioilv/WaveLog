"""start_app.py: Python側の起動開始点。

アプリ本体(app.py)を読み込む前に実行環境を整え、起動状況を記録する。
Start.vbs(通常起動)と start_app.bat(診断起動)は、どちらも最終的にこの
ファイルを呼ぶ。起動経路を1本に揃えることで、「通常起動では失敗するが
診断起動では再現しない」という状況を避ける。

処理の順序:
  1. ログを初期化し、実行環境(Python・配置場所・PID)を記録する
  2. 起動待機画面をブラウザで開く  ← 早い段階で開く
  3. 既に同じアプリが起動していれば、新たに起動せず終了する
  4. **確認済みの刻印があれば飛ばす**(§9.225)。無い/合わないときだけ、
     不足パッケージの導入・バイトコードの事前コンパイル・旧配置DBの
     取り込みをその場で行う
  5. Webサーバーを起動する

4の確認は`setup.bat`(→`setup_app.py`)が受け持ち、済むと端末ごとの刻印
(`%LOCALAPPDATA%\\WaveLog\\runtime\\ready.json`)が残る。**刻印は速さの
ための門であって正しさの門ではない**ので、食い違ったときは止めずに
その場で同じ確認をやり直す(利用者の指示①)。実処理は
`backend/launcher/setup_check.py`の1箇所で、setup.batと共有する。

2を先に行うのは、以降のどの段階で失敗しても利用者の画面には必ず待機画面が
表示され、規定時間後に「起動できません」と確認手順まで案内されるため。
また多重起動時は、待機画面が既存インスタンスを検出して即座にアプリへ
遷移するので、「既存の画面を開く」動作(仕様書2.4)がそのまま実現される。
"""
import _pycache_bootstrap  # 他のimportより前に。必ず1行目のimportにすること

import sys
import threading
import time
import webbrowser

from backend.launcher import guard as launch_guard
from backend.launcher import ready, setup_check
from backend import boot_status
from backend.config import PORT, app_url
from backend.logging_setup import launcher_logger, log_environment
from backend.paths import APP_ROOT, configured_path, ensure_local_dirs, is_network_path


def open_waiting_screen(log):
 """起動待機画面を開く。**手元の写しがあればそちらを開く**(§9.225)。
    共有配置では、進捗ファイル(`boot_status.js`)を共有へ書くと全台が同じ
    1つを取り合う——他の端末の進捗が自分の画面に出る。写しの隣へ書けば
    端末ごとに分かれ、共有への書き込みも消える。写しが無ければ今までどおり
    共有側を開く(**開けないより遅いほうがまし**)。"""
 page=setup_check.waiting_page()
 if not page.exists():
  page=setup_check.copy_waiting_page() or APP_ROOT/'loading.html'
 if not page.exists():
  log.error('待機画面 %s が見つかりません。アプリURLを直接開きます',page)
  webbrowser.open(app_url()); return
 log.info('待機画面を開きます: %s',page)
 try:
  if sys.platform=='win32':
   import os
   os.startfile(str(page))               # 既定のブラウザで開く
  else:
   webbrowser.open(page.as_uri())
 except Exception as e:
  log.error('待機画面を開けませんでした: %s',e)


def run_full_check(log,why):
 """刻印が無い/合わないときの完全な確認(§9.225)。**setup.batと同じ処理を
    同じ場所から呼ぶ**——2つ持つと「setup.batでは通るのに起動では失敗する」
    が作れる。"""
 log.info('起動前の確認: %s。この起動でまとめて確かめます（setup.batを実行しておくと次回から速くなります）',
          ' / '.join(why) if why else '刻印がありません')
 def say(message,bad=False):
  (log.warning if bad else log.info)('起動前の確認: %s',message)
 ok,_reason=setup_check.run(say)
 return ok


def warn_if_shared(log):
 """共有フォルダー配置を検出したら記録する(SQLiteの同時書込は破損し得る)。
    config/local.jsonでrecords_db_pathが上書きされていれば、その実際の
    置き場所を確認する(既定はAPP_ROOT/db/records.sqlite3)。"""
 records=configured_path('records_db_path') or APP_ROOT/'db'/'records.sqlite3'
 if is_network_path(APP_ROOT):
  log.warning('アプリ本体がネットワーク上に配置されています: %s',APP_ROOT)
 if is_network_path(records) and records.exists():
  log.warning('測定データバックアップ(%s)が共有上にあります。複数端末から'
              '同時に使用するとSQLiteが破損する恐れがあります',records)


def main():
 ensure_local_dirs()
 log=launcher_logger()
 started=time.monotonic()
 # 段階表示(boot_status)は待機画面を開く前に1件書いておく。開いた直後の
 # ポーリングで「まだ何も無い」状態を見せないため。
 boot_status.report('env','ログと実行環境を準備しています')
 log_environment(log)

 # 以降どこで失敗しても利用者の画面に状況が出るよう、先に待機画面を開く。
 open_waiting_screen(log)

 boot_status.report('instance',f'ポート {PORT} を確認しています')
 state,info=launch_guard.probe()
 if state==launch_guard.OURS:
  log.info('多重起動: 既に起動しています (バージョン %s)。新たに起動しません',
           (info or {}).get('version','?'))
  log.info('--- 終了 --- (既存インスタンスへ委譲)')
  return 0
 if state==launch_guard.FOREIGN:
  log.error('多重起動: ポート %s を別のアプリが使用しています。起動を中止します',PORT)
  log.info('--- 終了 --- (ポート使用中)')
  return 1
 if state==launch_guard.UNRESPONSIVE:
  # このアプリの前回のプロセスがネットワーク共有I/O等で応答不能に陥って
  # いる可能性がある(別アプリと決め付けて起動を諦めるとFOREIGNと同じ
  # 見た目になり、stop.batも使えば直せることが伝わらない)。ここで自動的に
  # 強制終了はしない(本当に別アプリの可能性がまだ残るため)。対処方法を
  # 明示して起動を中止する。
  log.error('多重起動: ポート %s は使用中ですが応答がありません(WaveLogが重い処理でブロックされている可能性があります)。'
            'stop.bat(python process_manager.py stop)で停止してから再度起動してください',PORT)
  log.info('--- 終了 --- (ポート使用中・応答無し)')
  return 1

 # 確認済みの刻印があれば、ここは飛ばす(§9.225)。**刻印は速さのための門で
 # あって正しさの門ではない**——バイトコードが古いかどうかはPython自身が
 # 判定するので、飛ばして困るのは「速くならない」ことだけ。
 why=ready.mismatch()
 if why:
  boot_status.report('packages','必要な部品が揃っているか確認しています')
  if not run_full_check(log,why):
   boot_status.report('packages','必要な部品を用意できませんでした',failed=True)
   log.error('起動中止: 必須パッケージが揃いませんでした')
   return 1
 else:
  boot_status.report('packages','確認済みです（setup.batで確認しました）')
  log.info('起動前の確認: 済んでいます。飛ばします')

 boot_status.report('data','データの置き場所を確認しています')
 # 共有配置の確認はネットワーク越しのファイル存在確認を伴い、共有の応答が
 # 遅いと起動そのものが止まる。記録のための警告でしかないので、起動の
 # 直列路から外して裏で確認する(§9.47)。
 threading.Thread(target=warn_if_shared,args=(log,),daemon=True,name='warn-if-shared').start()
 launch_guard.write_instance()
 log.info('起動準備: 完了 (%.2f秒)',time.monotonic()-started)

 try:
  boot_status.report('app','アプリを読み込んでいます')
  try:
   from backend.launcher import server
  except ImportError as e:
   # 刻印はあるのに部品が消えている(誰かがアンインストールした・別の
   # Pythonを指している)。**刻印を信じ切って落ちない**——その場で確認し直し、
   # 1回だけやり直す(利用者の指示①の自己修復)。
   log.warning('アプリを読み込めませんでした(%s)。確認をやり直します',e)
   ready.clear()
   if not run_full_check(log,['読み込みに失敗しました']):
    boot_status.report('app','アプリを読み込めませんでした',failed=True)
    log.error('起動中止: 確認をやり直しても読み込めませんでした')
    return 1
   from backend.launcher import server
  boot_status.report('server',f'ポート {PORT} で待ち受けを開始します')
  server.run()
 except Exception as e:
  log.exception('起動失敗: %s',e)
  return 1
 finally:
  # ウォッチドッグ経由の終了は os._exit() のためここを通らない。その場合
  # instance.json は残るが、起動判定はポートの実応答で行うため支障はない。
  launch_guard.clear_instance()
 log.info('--- 終了 --- (Webサーバーが停止)')
 return 0


if __name__=='__main__':
 sys.exit(main())
