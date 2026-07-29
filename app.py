"""app.py: Flask本体の組み立て。

業務API自体は backend/routes/(core/tables/measurement/quality) と
backend/masters.py(マスタCRUD)が持つ。ここではFlaskインスタンスの生成、
Blueprintの登録、リクエスト共通処理(キャッシュ無効化)、ウォッチドッグの
組み込みのみを行う(起動制御と業務ロジックを分ける方針。詳細は
docs/ARCHITECTURE.md・docs/REBUILD_PLAN.mdを参照)。
"""
import _pycache_bootstrap  # 他のimportより前に。単独実行(python app.py)される場合に備える

from flask import Flask

app=Flask(__name__)

from backend import watchdog
from backend.routes.core import bp as core_bp
from backend.routes.tables import bp as tables_bp
from backend.routes.measurement import bp as measurement_bp
from backend.routes.quality import bp as quality_bp
from backend.masters import bp as masters_bp

app.register_blueprint(core_bp)
app.register_blueprint(tables_bp)
app.register_blueprint(measurement_bp)
app.register_blueprint(quality_bp)
app.register_blueprint(masters_bp)

@app.after_request
def no_cache(response):
 response.headers['Cache-Control']='no-store, no-cache, must-revalidate, max-age=0'
 response.headers['Pragma']='no-cache'
 response.headers['Expires']='0'
 return response

# プロセスの生存管理(ハートビート監視・明示停止)は backend/watchdog.py が
# 所有する。業務機能の変更が起動・停止の挙動へ影響しないよう分離している。
watchdog.install(app)

if __name__=='__main__':
 # 直接 python app.py で起動された場合も、通常の起動経路(Start.vbs /
 # start_app.bat)と同じ処理を通すため server.py へ委譲する。
 import server
 server.run()
