"""server.py: **開発と網（テスト）のための HTTP の入口**（§9.548）。利用者の起動の道ではない。

利用者が起動するのはデスクトップ版だけ（Start.vbs → WaveLog.exe → `program/sidecar.py`・ポートなし）。
ブラウザ版の起動の道（待機画面・二重起動の判定・タブが0件で終わる見張り）は§9.548で外した。
ここは、画面を HTTP で開いて確かめる網（Playwright）と手元の開発のために、**同じアプリを
同じ背景処理で**立てるだけ: `python3 program/app.py`。止めるのは`POST /api/shutdown`（片付けを通る）。
"""

from backend.launcher import services
from backend.config import HOST, PORT
from backend.logging_setup import launcher_logger
from backend.paths import ensure_local_dirs


def run():
 """Flask の開発サーバーを実行する（ブロックする）。"""
 ensure_local_dirs()
 log=launcher_logger()
 from backend.app_module import flask_app as _app   # 素の`from app import`を書かない（§9.404）
 flask_app=_app()
 # 写し・見張り・書込役は**窓口によらず同じ**に始める（§9.544）。手順は`services.start()`の1箇所
 # ——デスクトップ版の窓口(program/sidecar.py)も同じ関数を呼ぶ。網の書込役もこれで本番とそろう。
 services.start(log)
 log.info('開発・網の入口: 起動します (%s:%s)',HOST,PORT)
 try:
  # threaded=True: 1件の遅い問い合わせ（共有の不調）が、ほかの問い合わせ（在席・終了）を
  # 道連れにしない（リクエストごとにDB接続を個別に開くのでスレッド間で共有しない）。
  flask_app.run(host=HOST,port=PORT,debug=False,threaded=True)
 except OSError as e:
  log.error('開発・網の入口: 起動できませんでした: %s（ポート %s を他が使っている可能性）',e,PORT)
  raise
 log.info('開発・網の入口: 終了しました')


if __name__=='__main__':
 run()
