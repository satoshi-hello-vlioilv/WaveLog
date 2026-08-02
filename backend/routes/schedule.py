"""schedule.py: スケジュール機能のBlueprint。

現時点では排他制御基盤(backend/schedule_sync.py、docs/SCHEDULE_MODE_DESIGN.md
§4)を確認するためのロック状態参照(GET /api/schedule/lock-status)のみを
持つ。予定データそのもの(作業予定・稼働カレンダー等)のCRUD APIとモード判定
(スケジュールモード・現場段取り)は未実装(設計のみ、同ドキュメント§5・§8参照)。
"""
from flask import Blueprint, jsonify

from .. import schedule_sync

bp=Blueprint('schedule',__name__)

@bp.get('/api/schedule/lock-status')
def lock_status():
 try:
  return jsonify(ok=True,**schedule_sync.lock_status())
 except Exception as e:
  return jsonify(error=str(e)),500
