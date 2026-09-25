"""schedule_history.py: 作業スケジュールの過去履歴のAPI（§9.502）。**読むだけ**。

`routes/schedule.py`はルートの数が上限（`test_routesplit`の`PINNED`）なので、読むだけのこの口は
別の段に置く。**GETだけ**なのでモードの関所（`access_mode._guard_write`）は通らない
——どのモードからでも見られる（履歴は見るだけの画面）。

共有の予定DBは`routes/schedule.py`の`_read`と同じ道で読む（手元の写しから・ロックを取らない）。
期間の既定（現場歴の今日）と上限の切り詰めは`schedule_history.history()`が答える。
"""
import json

from flask import Blueprint, request, jsonify

from .. import schedule_history
from ..repositories import schedule_repo as sr
from .schedule import _read

bp = Blueprint('schedule_history', __name__)


def _keys(raw):
    """画面が出す内容の列（JSONの並び）。読めなければ空（明細は運ばない）。"""
    try:
        v = json.loads(raw or '[]')
    except ValueError:
        return []
    return [str(k) for k in v][:300] if isinstance(v, list) else []


@bp.get('/api/schedule/history')
def schedule_history_list():
    equipment = str(request.args.get('equipment') or '').strip()
    if not equipment:
        return jsonify(error='どの設備の履歴か指定してください(equipment)。'), 400
    day_from = schedule_history.parse_day(request.args.get('from'))
    day_to = schedule_history.parse_day(request.args.get('to'))
    keys = _keys(request.args.get('keys'))
    query = str(request.args.get('q') or '').strip()[:100]
    anywhere = request.args.get('scope') == 'all'   # 既定は期間の中だけ（全期間は明示して選ぶ）

    def run(c):
        sr.migrate_config_masters_from_shared()
        mc = sr.config_master_conn()
        try:
            return schedule_history.history(c, mc, equipment, day_from, day_to, keys=keys, query=query,
                                             anywhere=anywhere)
        finally:
            mc.close()
    result, stale, err = _read(run)
    if err == 'not_configured':
        return jsonify(ok=True, configured=False, equipment=equipment, entries=[], days={}, undated=0,
                       shifts=[], cats=schedule_history.CATS, notes=[])
    if err:
        return jsonify(error=err), 503
    notes = []
    if stale:
        notes.append('共有スケジュールを取り込めなかったため、直前の写しで出しています。')
    if result['clipped']:
        notes.append('1回に出せるのは%d日までです。%s〜%sを出しています。'
                     % (schedule_history.MAX_DAYS, result['from'], result['to']))
    if query and result['found'] > schedule_history.MAX_FOUND:
        notes.append('「%s」に当たる記録は%d件あります。新しい%d件を出しています（語を足すと絞れます）。'
                     % (query, result['found'], schedule_history.MAX_FOUND))
    return jsonify(ok=True, configured=True, equipment=equipment, notes=notes, **result)
