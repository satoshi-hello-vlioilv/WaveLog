"""actual_keep.py: 完了突合で当たった実績を、予定へ残す（§9.364・§9.595）。

------------------------------------------------------------------------
利用者の指示（§9.595）:「このデータは過去1カ月までさかのぼった最新の実績であるが、
順次更新され、1か月以上経つものは保持されないので、データを突き合せたらこちらで
保持する機構を設けておく必要がある」——当たった行だけを予定の`[実績JSON]`へ残し、
**誰も作業スケジュールを開かなくても**裏で定期に突き合わせて残す。

保存の決まりは1つ（`persist()`）で、呼ぶ道は2つ:
  ・作業スケジュールを開いたとき（`GET /api/schedule/plan`。§9.364からの道）
  ・裏の見回り（`start()`。この端末が書込役のときだけ。既定15分ごと）

**書くのは書込役の端末だけ**（§4.2 `with_write`）。持ち主が別の端末なら書かない
——あちらの見回りが書く。閲覧モードでも書かない。**上書きはしない**
（`plan_set_actual_json`が既に入っている行を断る）。
------------------------------------------------------------------------
"""
import json
import threading
import time
from datetime import datetime

from . import query_join, schedule_calc, schedule_owner, schedule_sync
from .access_mode import current_pc_name, get_mode
from .db_access import connect, path_config_value
from .logging_setup import app_logger
from .quiet import quiet
from .repositories import schedule_repo as sr

# 裏の見回りの間隔（分）。パス設定マスタで変えられる（再起動は要らない）。
INTERVAL_KEY = 'actual_keep_interval_min'
INTERVAL_DEFAULT_MIN = 15
INTERVAL_MIN_MIN = 5
# 裏の見回りが名乗る更新者。人の操作と見分けられるように。
SWEEP_USER = 'auto:実績の保持'

_status = {'running': False, 'lastAt': None, 'lastSaved': 0, 'lastEquipments': 0,
           'lastError': '', 'lastSkip': ''}
_status_lock = threading.Lock()
_thread = None
_start_lock = threading.Lock()
_wake = threading.Event()


def interval_sec():
    try:
        v = float(path_config_value(INTERVAL_KEY, INTERVAL_DEFAULT_MIN) or INTERVAL_DEFAULT_MIN)
    except (TypeError, ValueError):
        v = INTERVAL_DEFAULT_MIN
    return int(max(INTERVAL_MIN_MIN, v) * 60)


def status():
    """画面・診断用。直近の見回りの結果。"""
    with _status_lock:
        return dict(_status)


def _payload(e):
    """予定へ残す形。**完了・開始の時刻と、どの定義で・どの条件で当たったかも一緒に**
    ——値だけ残すと、相手のデータが消えたあとに「いつ始まり、いつ終わったのか」を
    二度と言えなくなる（§9.365・§9.595）。"""
    return {'values': e['actualSource'], 'finishedAt': e.get('finishedAt') or '',
            'startedAt': e.get('startedAt') or '',
            'joinName': e.get('finishedBy') or '', 'finishWhen': e.get('finishWhen') or '',
            'savedAt': datetime.now().isoformat()}


def pending(result):
    """まだ残していない、当たった行。"""
    return [e for e in (result.get('entries') or [])
            if e.get('actualSource') and not e.get('actualSourceSaved') and e.get('id') is not None]


def writable():
    """この端末が残してよいか。だめなら理由（空＝よい）。"""
    if get_mode() == 'view':
        return '閲覧モードです。'
    try:
        if schedule_owner.should_relay():
            return '共有スケジュールの持ち主が別の端末です（あちらが残します）。'
    except Exception as _e:
        quiet('書込役を確かめられない（保存は見送る）', _e)
        return '書込役を確かめられません。'
    return ''


def persist(result, uid, pc):
    """当たった行を予定へ残す（§9.364）。戻り値: 画面へ返す注意（空＝無し）。

    ・**書けなくても読みは通す**（fail-open）。予定が読めないことのほうが痛い。
      黙って諦めない（§9.328）ので、理由は注意で返す。
    ・保存できたぶんは、いま返す応答の中でも「保存済み」に直す——同じ画面が
      「未保存」と言い続けるのは、次に開くまで直らない嘘になる。"""
    pend = pending(result)
    if not pend or writable():
        return ''

    def fn(c):
        n = 0
        for e in pend:
            if sr.plan_set_actual_json(c, e['id'], json.dumps(_payload(e), ensure_ascii=False), uid, pc):
                n += 1
        return {'saved': n}
    try:
        schedule_sync.with_write(uid, pc, uid, fn)
    except Exception as e:
        app_logger().warning('実績の写しを保存できませんでした: %s', e)
        return f'実績で確認できた{len(pend)}件を予定へ保存できませんでした（{e}）。次に開いたときにもう一度試します。'
    for e in pend:
        e['actualSourceSaved'] = True
    return ''


def sweep_once():
    """裏の見回り1回ぶん（テストからも呼ぶ）。戻り値: {'saved','equipments','skip','error'}。

    写しをまだ持たない行がある設備だけを、画面と同じ`expand_plan()`で突き合わせて残す
    （画面と同じ答えにするため、判定を別に書かない）。"""
    out = {'saved': 0, 'equipments': 0, 'skip': '', 'error': ''}
    if not query_join.finish_definitions():
        out['skip'] = '完了突合の設定がありません。'
        return _note(out)
    why = writable()
    if why:
        out['skip'] = why
        return _note(out)
    try:
        local_path, _stale = schedule_sync.fetch_snapshot()
    except Exception as e:
        out['skip'] = f'共有スケジュールを読めません（{e}）。'
        return _note(out)
    pc = current_pc_name()
    results = []
    c = connect(local_path, False, 'sqlite')
    try:
        for equip in sr.plan_equipments_unsaved_actual(c):
            out['equipments'] += 1
            try:
                results.append(schedule_calc.expand_plan(c, equip))
            except Exception as e:
                app_logger().warning('実績の保持: 設備「%s」の予定を読めませんでした: %s', equip, e)
                out['error'] = f'{equip}: {e}'
    finally:
        c.close()
    # 書くのは読み終えてから（読みの接続を開いたまま書込のサイクルへ入らない）。
    for result in results:
        n = len(pending(result))
        note = persist(result, SWEEP_USER, pc)
        if note:
            out['error'] = note
        else:
            out['saved'] += n
    return _note(out)


def _note(out):
    with _status_lock:
        _status.update(lastAt=datetime.now().isoformat(timespec='seconds'),
                       lastSaved=out['saved'], lastEquipments=out['equipments'],
                       lastError=out['error'], lastSkip=out['skip'])
    if out['saved']:
        app_logger().info('実績の保持: %d件を予定へ残しました（%d設備）', out['saved'], out['equipments'])
    return out


def _loop():
    # 起動直後は写し・見張りの最初の周回と重ならないよう待つ。
    _wake.wait(60)
    while True:
        t0 = time.monotonic()
        try:
            sweep_once()
        except Exception as e:
            # 見回りが転んでも画面は動く。次の周回で再挑戦する。
            app_logger().warning('実績の保持の見回りで例外: %s', e)
            with _status_lock:
                _status['lastError'] = str(e)
        _wake.clear()
        _wake.wait(max(1.0, interval_sec() - (time.monotonic() - t0)))


def start():
    """裏の見回りを始める。止める仕掛けは持たない（`schedule_watch`と同じデーモン1本）。"""
    global _thread
    with _start_lock:
        if _thread and _thread.is_alive():
            return
        _thread = threading.Thread(target=_loop, name='actual-keep', daemon=True)
        _thread.start()
        with _status_lock:
            _status['running'] = True


def wake():
    """次の見回りをすぐ始めさせる（設定を変えたあと）。"""
    _wake.set()
