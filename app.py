"""app.py: Flask本体の組み立て。

業務API自体は backend/routes/(core/tables/measurement/quality/masters) が持つ。
データアクセス層は backend/db_access.py・backend/repositories/(master_repo)。
ここではFlaskインスタンスの生成、Blueprintの登録、リクエスト共通処理
(キャッシュ無効化)、ウォッチドッグの組み込みのみを行う(起動制御と業務
ロジックを分ける方針。詳細はdocs/ARCHITECTURE.md・docs/REBUILD_PLAN.mdを参照)。
"""
import _pycache_bootstrap  # 他のimportより前に。単独実行(python app.py)される場合に備える

from flask import Flask

from backend.logging_setup import app_logger

# **Flaskが app.logger へ触れるより前に**、こちらのファイル出力を付けておく。
# Flaskはハンドラの無いロガーに既定のStreamHandler(標準エラー)を勝手に足し、
# 通常起動(Start.vbs)はコンソールを持たないため、そこへ出た内容は消える。
# 未処理例外のtracebackを取り逃がさないための1行(§9.77)。
app_logger()

app=Flask(__name__)

from backend import watchdog, records_export, access_mode, rne_scheduler, errors
from backend.routes.core import bp as core_bp
from backend.routes.tables import bp as tables_bp
from backend.routes.measurement import bp as measurement_bp
from backend.routes.quality import bp as quality_bp
from backend.routes.masters import bp as masters_bp
from backend.routes.path_config import bp as path_config_bp
from backend.routes.rne import bp as rne_bp
from backend.routes.schedule import bp as schedule_bp

app.register_blueprint(core_bp)
app.register_blueprint(tables_bp)
app.register_blueprint(measurement_bp)
app.register_blueprint(quality_bp)
app.register_blueprint(masters_bp)
app.register_blueprint(path_config_bp)
app.register_blueprint(rne_bp)
app.register_blueprint(schedule_bp)

@app.after_request
def no_cache(response):
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

if __name__=='__main__':
 # 直接 python app.py で起動された場合も、通常の起動経路(Start.vbs /
 # start_app.bat)と同じ処理を通すため server.py へ委譲する。
 from backend.launcher import server
 server.run()
