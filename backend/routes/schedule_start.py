"""schedule_start.py: 厳密モードのロットの開始（§9.588）。

利用者の指示:
  「運用のモードを現状が『通常モード』だとすると『厳密モード』というものを作り、ロットの開始を
   作業スケジュール一覧の一番上のロットからしかできないようにするモードを作成してください。」
  「スタートしたロットより上の設備停止は前のロットの終了時間とスタートしたロットの開始時刻の間の
   時間で実時間を登録を自動的にできるので、設備停止が残留してしまうということを避けられます。」
  「作業スケジュールの中で開始判定フラグを設け、管理する」

**口は1本**（`POST /api/schedule/plan/start`）。測定画面を開く関門（予定の「開始」・仕掛の一覧の
どちらの道も通る）が呼ぶ。決めるのは`schedule_calc`（`strict_top()`／`strict_start_plan()`）で、
ここは読む・断る・書くの段取りだけを持つ。

・**通常モードの設備では何も書かない**（`strict: False`を返す）——今までの開始のまま。
・断るときは書く前に、読むだけの写しで理由と一番上のロットを返す（409）。書くときは書込サイクルの
  中で**もう一度決め直す**（あいだに別の端末が開始・並べ替えをしていても、古い判断で書かない）。
・編集セッション（§9.211）では止めない——開始はラインで起きた事実で、計画者が並びを直している
  最中でもラインは止められない（書き込みの排他はロックと改訂番号が受ける）。

`routes/schedule.py`はルートの数が上限（`test_routesplit`の`PINNED`）なので段を分けた。書込の共通処理
（`_write_response`）・読むだけの取得（`_read`）はあちらの1箇所を使う。
"""
from datetime import datetime

from flask import Blueprint, jsonify

from .. import schedule_calc
from ..repositories import schedule_repo as sr
from ..repositories.master_repo import read_equipment_run_mode, RUN_MODE_STRICT
from ..access_mode import request_user_id, request_pc_name
from .body import body, any_
from .schedule import _read, _write_response

bp = Blueprint('schedule_start', __name__)

START_PATH = '/api/schedule/plan/start'


def _run_mode(equipment):
    mc = sr.config_master_conn()
    try:
        return read_equipment_run_mode(mc, equipment)
    finally:
        mc.close()


def _decide(c, equipment, x, now):
    """予定の状態を組み、開始してよいか・何を書くかを決める（読む側も書く側も同じ1本）。"""
    mc = sr.config_master_conn()
    try:
        entries, minutes_of, idx = schedule_calc.plan_states(c, mc, equipment, now)
    finally:
        mc.close()
    target = schedule_calc.find_plan_target(entries, x.get('id'), x.text('lotNo'), x.text('castingNo'),
                                            x.text('mfgMaterial'))
    if target is None:
        # 予定に無いロットでも、**既に始めた記録**（計画外の作業・前に開いた下書き）の続きは開ける。
        # 厳密モードが止めるのは「新しく始めること」で、記録を直すことではない。
        rec = schedule_calc.match_actual(idx, x.text('lotNo'), x.text('castingNo'), x.text('mfgMaterial'))
        if rec is not None:
            return {'ok': True, 'already': True, 'top': schedule_calc.strict_top(entries), 'id': None}
        return dict(schedule_calc.strict_start_plan(entries, None, now, minutes_of), id=None)
    return dict(schedule_calc.strict_start_plan(entries, target['id'], now, minutes_of), id=target['id'])


@bp.post(START_PATH)
def plan_start():
    x = body({'equipment': any_, 'id': any_, 'lotNo': any_, 'castingNo': any_, 'mfgMaterial': any_})
    equipment = x.text('equipment')
    if not equipment:
        return jsonify(error='設備名がありません（測定画面の「使用設備」を選んでください）。'), 400
    if _run_mode(equipment) != RUN_MODE_STRICT:
        return jsonify(ok=True, strict=False)
    now = datetime.now()
    pre, _stale, err = _read(lambda c: _decide(c, equipment, x, now))
    if err:
        return jsonify(error=f'作業スケジュールを読めないため、厳密モードの開始を確かめられません: {err}', strict=True), 503
    if not pre['ok']:
        return jsonify(error=pre['error'], code=pre['code'], top=pre['top'], strict=True), 409
    if pre['already']:
        return jsonify(ok=True, strict=True, already=True, top=pre['top'])
    uid, pc = request_user_id(x), request_pc_name(x)

    def fn(c):
        plan = _decide(c, equipment, x, datetime.now())
        if not plan['ok']:
            raise ValueError(plan['error'])
        if plan['already']:
            return {'strict': True, 'already': True}
        target_id = plan['id']
        sr.plan_set_start_flag(c, target_id, uid, {'at': plan['start'], 'by': uid, 'pc': pc}, pc=pc)
        for st in plan['stops']:
            sr.plan_set_manual_times(c, st['id'], uid, schedule_calc.strict_stop_payload(st, uid, pc), pc=pc)
        return {'strict': True, 'id': target_id, 'startAt': plan['start'], 'stops': plan['stops'], 'prev': plan['prev']}
    return _write_response(fn)
