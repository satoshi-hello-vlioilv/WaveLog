"""app.py: Flask本体の組み立て。

業務API自体は backend/routes/(core/tables/measurement/quality/masters) が持つ。
データアクセス層は backend/db_access.py・backend/repositories/(master_repo)。
ここではFlaskインスタンスの生成、Blueprintの登録、リクエスト共通処理
(キャッシュ無効化)、ウォッチドッグの組み込みのみを行う(起動制御と業務
ロジックを分ける方針。詳細はdocs/ARCHITECTURE.md・docs/REBUILD_PLAN.mdを参照)。
"""
import _pycache_bootstrap  # noqa: F401 副作用のためのimport。他のimportより前に。単独実行(python app.py)される場合に備える

from flask import Flask, request

from backend.logging_setup import app_logger

# **Flaskが app.logger へ触れるより前に**、こちらのファイル出力を付けておく。
# Flaskはハンドラの無いロガーに既定のStreamHandler(標準エラー)を勝手に足し、
# 通常起動(Start.vbs)はコンソールを持たないため、そこへ出た内容は消える。
# 未処理例外のtracebackを取り逃がさないための1行(§9.77)。
app_logger()

app=Flask(__name__)

from backend import watchdog, records_export, access_mode, rne_scheduler, errors, file_cleanup, db_access
from backend.routes.core import bp as core_bp
from backend.routes.tables import bp as tables_bp
from backend.routes.measurement import bp as measurement_bp
from backend.routes.quality import bp as quality_bp
from backend.routes.masters import bp as masters_bp
from backend.routes.path_config import bp as path_config_bp
from backend.routes.rne import bp as rne_bp
from backend.routes.schedule import bp as schedule_bp
from backend.routes.logs import bp as logs_bp
from backend.routes.cleanup import bp as cleanup_bp
from backend.routes.master_tables import bp as master_tables_bp
from backend.routes.presence import bp as presence_bp

app.register_blueprint(core_bp)
app.register_blueprint(tables_bp)
app.register_blueprint(measurement_bp)
app.register_blueprint(quality_bp)
app.register_blueprint(masters_bp)
app.register_blueprint(path_config_bp)
app.register_blueprint(rne_bp)
app.register_blueprint(schedule_bp)
app.register_blueprint(logs_bp)
app.register_blueprint(cleanup_bp)
app.register_blueprint(master_tables_bp)
app.register_blueprint(presence_bp)

# 読み込みでは起こさない書込（旧config/local.jsonの一度きりの移行）は、
# **アプリの起動がここで1回だけ**行う（§9.329）。import に副作用を持たせると、
# 読み込んだだけで何が起きるかが呼ぶ側から読めない。
db_access.bootstrap()

# ========================================================================
# キャッシュの方針(§9.97)
# ------------------------------------------------------------------------
# 画面(HTML)とAPIの応答は**毎回取り直させる**。古い在庫・古いマスタを
# 見せないため、ここは今までどおり no-store。
#
# **ただし版がURLに入っている資材は別。** JS/CSSは `?t=<全資材の最新更新
# 時刻>` を付けて読み込んでおり(templates/index.html の起動ローダーと
# core.home())、中身が変われば**URLごと変わる**。だから長期キャッシュして
# よい——というより、しないと起動のたびに1.4MB(JS 1.0MB + CSS 0.4MB)を
# 読み直すことになる。
#
# 以前ここは**全ての応答へ無条件に no-store を付けていた**。そのため
# `core.py` の `_css_bundle()` が明示していた
# `public, max-age=31536000, immutable` は、後から走るこの関数に
# 上書きされて**一度も効いていなかった**(「以前は no-cache で毎回取り直して
# おり…」というコメント付きの対処が、効かないまま残っていた)。
# after_request はビューの後に走るので、ビューの指定を消さないこと。
#
# 資材が読めなかった回など、**ビューが自分で `no-store` を宣言している応答**は
# そのまま尊重する(次の表示で直っていてほしいものを長期キャッシュしない)。
# 合図に `no-cache` を使わないこと——Flaskの静的配信が既定で付けるため、
# それを合図にすると`/static/`が1つも長期キャッシュにならない(実際にそうなった)。
# ========================================================================
_LONG_CACHE='public, max-age=31536000, immutable'
_VERSIONED_ENDPOINTS={'static','core.app_css','core.boot_css'}

@app.after_request
def cache_policy(response):
 declared=response.headers.get('Cache-Control','')
 if (request.args.get('t') and request.endpoint in _VERSIONED_ENDPOINTS
         and 'no-store' not in declared and response.status_code==200):
  response.headers['Cache-Control']=_LONG_CACHE
  response.headers.pop('Pragma',None)
  response.headers.pop('Expires',None)
  return response
 response.headers['Cache-Control']='no-store, no-cache, must-revalidate, max-age=0'
 response.headers['Pragma']='no-cache'
 response.headers['Expires']='0'
 return response

# 想定外の例外を必ずログへ残し、画面には日本語で原因と次の一手を出す。
# (既定のFlaskは英語1行の Internal Server Error だけで、traceback がどこにも
#  残らない。別端末での「起動時に Internal Server Error」が切り分けできなかった)
errors.install(app)
# プロセスの生存管理(ハートビート監視・明示停止)は backend/watchdog.py が
# 所有する。業務機能の変更が起動・停止の挙動へ影響しないよう分離している。
watchdog.install(app)
# 測定データバックアップの閲覧用複製(records_backup_export_path未設定なら何もしない)。
records_export.start()
# 編集可能モード/閲覧モードの判定・切替・書込ガード。
access_mode.install(app)
# 仕掛/品質データのローカル運用(sikalot_source=local)時のみRNE定期抽出を開始。
rne_scheduler.start()
# 不要ファイルの掃除(§9.249 ①)。作り直せるものだけを、決めた間隔で片付ける。
# **自動で消すのは`auto=True`の種別だけ**(バイトコードのように「消すと次の
# 起動が遅くなる」ものは押したときだけ)。入切・間隔はパス設定マスタ。
file_cleanup.start()

if __name__=='__main__':
 # 直接 python app.py で起動された場合も、通常の起動経路(Start.vbs /
 # start_app.bat)と同じ処理を通すため server.py へ委譲する。
 from backend.launcher import server
 server.run()
