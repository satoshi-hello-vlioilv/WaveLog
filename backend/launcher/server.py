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
