"""server.py: Webサーバーの起動のみを担当する。

起動監視(多重起動の判定・ブラウザ起動・待機画面)と、Web処理そのものを
切り離す境界。ここから上(start_app.py / launch_guard.py)は「アプリを
立ち上げるまで」を、ここから下(app.py / backend/)は「立ち上がった後」を
担当する。
"""

from backend import watchdog
from backend.config import HOST, PORT
from backend.logging_setup import launcher_logger


def run():
 """ウォッチドッグを開始し、Flaskの開発サーバーを実行する(ブロックする)。"""
 log=launcher_logger()
 from app import app as flask_app          # Flaskアプリ本体(業務機能)
 watchdog.start()
 # 共有上の読み取り専用DBを手元へ写す背景処理(§9.89)。共有の更新と読み取りが
 # 重なると正しく読めないため、画面は常に手元の写しを読む。写せなくても
 # 画面は前の写し(または共有)で動くので、ここでの失敗は起動を止めない。
 try:
  from backend import db_mirror, paths
  if db_mirror.enabled():
   db_mirror.start()
   log.info('共有DBの写し: %d秒ごとに更新します',db_mirror.interval_sec())
   # 置き場が共有・クラウド同期フォルダーの上なら、写しは自動で手元へ
   # 逃がしてある(§9.109)。**利用者に設定を求めない**ので、ここは
   # 「こうしてください」ではなく「こうしました」を残すだけにする。
   if paths.work_dir_relocated():
    log.info('作業用ファイル(写し・作業コピー)は手元へ置きます: %s（%s）',
             paths.work_dir(),paths.work_dir_reason())
 except Exception as e:
  log.warning('共有DBの写しを開始できませんでした: %s',e)
 # 共有スケジュールの見張り(§9.188)。**読むたびに共有から写すのをやめ**、
 # 改訂番号だけを見て変わったときだけ写す。写せなくても画面は前の写しで
 # 動くので、ここでの失敗は起動を止めない。
 try:
  from backend import schedule_sync, schedule_watch
  if schedule_sync.SCHEDULE_SHARE_PATH and schedule_sync.watch_enabled():
   schedule_watch.start()
   log.info('共有スケジュールの見張り: %d秒ごとに確かめ、取り込んだら%d秒休みます',
            schedule_sync.watch_interval_sec(),schedule_sync.watch_pause_sec())
 except Exception as e:
  log.warning('共有スケジュールの見張りを開始できませんでした: %s',e)
 # 共有スケジュールの持ち主(§9.192→§9.269)。**既定は on**。持ち主になれた
 # 端末だけが小さな受け口をLANへ開く。切ってある現場は今までどおり
 # 各端末が自分で共有へ書く。
 # 見張りは**入れていなくても回す**（1分ごとに設定だけを見る。共有には触らない）。
 # こうしておくと、マスタ管理で入れ切りしたときに再起動を待たなくてよい。
 try:
  from backend import schedule_owner
  schedule_owner.start()
  if schedule_owner.enabled():
   log.info('共有スケジュールの持ち主機構: 有効（受け口 %s）',
            ', '.join(schedule_owner.local_urls()))
  else:
   log.info('共有スケジュールの持ち主機構: 無効（各端末が自分で共有へ書きます）')
 except Exception as e:
  log.warning('持ち主機構を開始できませんでした: %s',e)
 log.info('Webサーバー: 起動します (%s:%s)',HOST,PORT)
 try:
  # threaded=True: 既定(シングルスレッド)のままだと、仕掛/品質データや
  # スケジュール共有ファイルへのアクセスがネットワーク共有の不調で長時間
  # ブロックした場合、その間ハートビート(/api/heartbeat)・終了通知
  # (/api/heartbeat/close)・停止スクリプトの生存確認(/api/build)まで
  # 一切応答できなくなる(タブを閉じても自動終了せず、stop.batからも
  # 「別のアプリが使用しています」と誤判定されて停止できない不具合の実例)。
  # リクエストごとにスレッドを分離し、1件の遅い処理が他のリクエストを
  # 道連れにしないようにする(各リクエストはDB接続を個別に開くため
  # スレッド間で共有しない設計、と`_active_tabs`等のロック保護は既存のまま
  # 安全)。
  flask_app.run(host=HOST,port=PORT,debug=False,threaded=True)
 except OSError as e:
  # 最も多いのはポート使用中。原因が分かる形で記録して再送出する。
  log.error('Webサーバー: 起動できませんでした: %s',e)
  log.error('ポート %s を他のアプリが使用している可能性があります。',PORT)
  raise
 log.info('Webサーバー: 終了しました')


if __name__=='__main__':
 run()
