#!/usr/bin/env python3
"""test_dashperf.py: ダッシュボードの数え方の速さ（利用者の指示・§9.631 ③）。

============================================================
利用者の指示
------------------------------------------------------------
「ダッシュボード計算処理が非常に遅いです。データの取得元確認と処理の高速化も検討してください。」

物差し（評価関数）:
 1. 既定のダッシュボード（`BUILTIN_DEFAULT`）の全パネルを1回ずつ問い合わせたときの、材料（測定データ・作業予定）を
    作り直した回数。材料が変わっていなければ、1回の表示で作るのは元ごとに**1回まで**（前はパネルの数だけ作っていた）
 2. 2回目の表示（材料が変わっていない）で作り直す回数は 0
 3. 1回目・2回目の合計時間（数字は記録だけ。機械で違うので固定しない）
 4. 速くしても答えは同じ（1回目と2回目のパネルの答えが同じ）
 5. 材料が変わったら作り直す（測定データを1件足すと、本日の作業ロットが1つ増える）
**自分が作った記録だけ**を片付ける（finally）。
============================================================
"""
import json
import pathlib
import sys
import time
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app                       # noqa: E402 パスを通してから読む
from backend.dashboard import layout, sources  # noqa: E402 パスを通してから読む

R = []
client = flask_app.app.test_client()
TAG = 'DASHPERF'
NOW = datetime.now().replace(hour=12, minute=0, second=0, microsecond=0)
COUNT = {'rec': 0, 'plan': 0}


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def _counting(kind, fn):
    def wrap(*a, **k):
        COUNT[kind] += 1
        return fn(*a, **k)
    return wrap


def home_panels():
    body = next(b for b in layout.BUILTIN_LAYOUTS if 'b:' + b['key'] == layout.BUILTIN_DEFAULT)['body']
    return body['panels']


def show_once():
    """既定のダッシュボードを1回描く（パネルごとに1回の問い合わせ）→ (合計ミリ秒, {id: 答え}, {id: ミリ秒})"""
    out, ms = {}, {}
    t0 = time.perf_counter()
    for p in home_panels():
        t = time.perf_counter()
        r = client.post('/api/dashboard/query', json={'panel': p})
        ms[p['id']] = round((time.perf_counter() - t) * 1000)
        j = r.get_json() or {}
        j.pop('now', None)
        out[p['id']] = (r.status_code, json.dumps(j, ensure_ascii=False, sort_keys=True, default=str))
    return round((time.perf_counter() - t0) * 1000), out, ms


def main():
    flask_app.app.config['DASHBOARD_NOW'] = NOW
    real_rec, real_plan = sources.rec_rows, sources.plan_rows
    sources.rec_rows, sources.plan_rows = _counting('rec', real_rec), _counting('plan', real_plan)
    rid = f'{TAG}-{int(time.time())}'
    try:
        sources.forget()
        n_rec_panels = sum(1 for p in home_panels() if p.get('source') == 'rec')
        n_plan_panels = sum(1 for p in home_panels() if p.get('source') == 'plan')
        t1, a1, ms1 = show_once()
        c1 = dict(COUNT)
        rec(f'1回目: 測定データを作るのは1回まで（{c1["rec"]}回・パネル {n_rec_panels}枚）', c1['rec'] <= 1, ms1)
        rec(f'1回目: 作業予定を作るのは1回まで（{c1["plan"]}回・パネル {n_plan_panels}枚）', c1['plan'] <= 1)
        print(f'INFO: 1回目の合計 {t1}ms')
        COUNT.update(rec=0, plan=0)
        t2, a2, ms2 = show_once()
        rec(f'2回目（材料が同じ）: 作り直さない（測定データ {COUNT["rec"]}回・作業予定 {COUNT["plan"]}回）', COUNT['rec'] == 0 and COUNT['plan'] == 0, ms2)
        print(f'INFO: 2回目の合計 {t2}ms')
        rec('速くしても答えは同じ（1回目と2回目）', a1 == a2, [k for k in a1 if a1[k] != a2.get(k)])
        rec('5xx を返したパネルは 0', all(v[0] < 500 for v in a2.values()), {k: v[0] for k, v in a2.items()})
        # 材料が変わったら作り直す: 本日の記録を1件足すと本日の作業ロットが1つ増える
        iso = NOW.replace(hour=10).astimezone().isoformat()
        payload = json.dumps({'id': rid, 'status': '完了', 'updatedAt': iso, 'basic': {'lotNo': rid},
                              'settings': {'registeredEquipment': 'テスト設備A'},
                              'workTime': {'startAt': iso, 'endAt': iso}, 'measurements': {}})
        r = client.post('/api/measurement/backup', json={'id': rid, 'lotNo': rid, 'inspectionNo': '', 'equipment': 'テスト設備A', 'status': '完了',
                                                         'codec': 'json-full-v32', 'payload': payload, 'user_id': 'test', 'updated_at_iso': iso})
        rec('記録を1件足せる', r.status_code == 200, r.get_data(as_text=True)[:200])
        COUNT.update(rec=0, plan=0)
        _t3, a3, _ms3 = show_once()
        rec(f'材料が変わったら作り直す（測定データ {COUNT["rec"]}回・本日の作業ロットの答えが変わる）',
            COUNT['rec'] == 1 and a3['todayLots'] != a2['todayLots'], (a2['todayLots'][1][:160], a3['todayLots'][1][:160]))
    finally:
        sources.rec_rows, sources.plan_rows = real_rec, real_plan
        try:
            client.post("/api/measurement/backup/delete", json={"id": rid})
        except Exception as e:  # noqa: BLE001 片付けに失敗しても結果は出す
            print('INFO: 片付けに失敗', e)
    print(f'合計: {sum(R)}/{len(R)} PASS')
    return 0 if all(R) else 1


if __name__ == '__main__':
    sys.exit(main())
