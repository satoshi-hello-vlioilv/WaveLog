#!/usr/bin/env python3
"""test_actimes.py: 測定実績の値の出どころ（利用者の指示・§9.631 ②）。

============================================================
利用者の指示
------------------------------------------------------------
「測定データの登録がなくても、作業開始時刻と作業終了時刻の欄は列に出せるようにしてください。現状、入力してあるはずの
 操業データや測定データで打ち込まれたなどがほとんど表示されておらず、すべてを対象にしたいです。」

ここで固定すること:
 1. 操業データの道（`settings.opData.<項目名>`）で記録の値が引ける（前は抜粋の置き場と食い違って必ず空だった）
 2. 記録に作業開始・作業終了が無ければ、その記録が当たった予定の行の実績で補い、出どころを言う（`timeFrom`）
 3. 記録に時刻があれば記録が正（予定の実績で上書きしない）。片方だけ無ければその片方だけ補う
 4. 補った時刻で現場日を決める（期間で絞れる）
 5. ダッシュボードの測定データの列に、候補の列（操業データ等）が入る（前は候補の`key`を読んで1本も入っていなかった）
============================================================
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app  # noqa: F401,E402 パスを通してから読む（設定の読み込み）
from backend import actuals  # noqa: E402 パスを通してから読む
from backend.dashboard import sources  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def item(rid, work=None):
    row = {'id': rid, 'updated_at': '2026-03-10T12:00:00', 'payload': json.dumps(
        {'basic': {'lotNo': rid}, 'settings': {'registeredEquipment': 'テスト設備A', 'opData': {'良品重量': 321, 'オペレータ': '山田'}},
         'workTime': work or {}})}
    return actuals._extract(row)


def main():
    it = item('A')
    v = actuals.field_values(it, ['settings.opData.良品重量', 'settings.opData.オペレータ', 'settings.opData.無い項目'])
    rec('操業データの道で記録の値が引ける', v == {'settings.opData.良品重量': 321, 'settings.opData.オペレータ': '山田', 'settings.opData.無い項目': ''}, v)

    times = {'A': {'start': '2026-03-09 08:00:00', 'end': '2026-03-09 08:45:00', 'from': '開始判定'},
             'B': {'start': '2026-03-09 09:00:00', 'end': '2026-03-09 09:30:00', 'from': '手入力'},
             'C': {'start': '', 'end': '2026-03-09 10:40:00', 'from': '手入力'}}
    a = actuals._with_plan_times(item('A'), times)
    rec('記録に時刻が無ければ予定の実績で補い、出どころを言う', (a['workStart'], a['workEnd'], a['timeFrom']) ==
        ('2026-03-09 08:00:00', '2026-03-09 08:45:00', '開始判定'), (a['workStart'], a['workEnd'], a['timeFrom']))
    b = actuals._with_plan_times(item('B', {'startAt': '2026-03-09T09:05:00', 'endAt': '2026-03-09T09:20:00'}), times)
    rec('記録に時刻があれば記録が正（上書きしない）', (b['workStart'], b['workEnd'], b['timeFrom']) ==
        ('2026-03-09T09:05:00', '2026-03-09T09:20:00', actuals.TIME_FROM_RECORD), (b['workStart'], b['workEnd'], b['timeFrom']))
    c = actuals._with_plan_times(item('C', {'startAt': '2026-03-09T10:00:00'}), times)
    rec('片方だけ無ければその片方だけ補う（出どころは両方）', (c['workStart'], c['workEnd'], c['timeFrom']) ==
        ('2026-03-09T10:00:00', '2026-03-09 10:40:00', f'{actuals.TIME_FROM_RECORD}・手入力'), (c['workStart'], c['workEnd'], c['timeFrom']))
    d = actuals._with_plan_times(item('D'), times)
    rec('予定にも無ければ空のまま（出どころも空）', (d['workStart'], d['workEnd'], d['timeFrom']) == ('', '', ''))

    # 補った時刻で現場日を決める: rows() の読み口を差し替えて、時刻の無い記録が補った日で絞れる
    keep = actuals.merged_backup_rows
    actuals.merged_backup_rows = lambda force=False: [{'id': 'A', 'updated_at': '2026-03-10T12:00:00', 'payload': json.dumps(
        {'basic': {'lotNo': 'A'}, 'settings': {'registeredEquipment': 'テスト設備A'}, 'workTime': {}})}]
    actuals.forget()
    try:
        got = actuals.rows(date_from='2026-03-09', date_to='2026-03-09', times=times)
        rec('補った時刻で現場日を決める（期間で絞れる）', len(got) == 1 and got[0]['workDateFrom'] == 'start' and got[0]['durationMin'] == 45.0,
            [(x['workDate'], x['workDateFrom'], x['durationMin']) for x in got])
        rec('補わなければ更新時刻の日（前と同じ）', actuals.rows(date_from='2026-03-09', date_to='2026-03-09') == [])
    finally:
        actuals.merged_backup_rows = keep
        actuals.forget()

    names = [n for n, _p in sources.rec_columns()]
    paths = [p for _n, p in sources.rec_columns() if p]
    rec(f'ダッシュボードの測定データの列に候補の列が入る（芯 {len(sources.REC_CORE)}・候補 {len(paths)}）',
        any(p.startswith('settings.opData.') or p.startswith('source.') for p in paths), names[:30])
    rec('作業予定の写しは記録IDの列を持つ（測定実績が時刻を補う鍵）', '記録ID' in sources.PLAN_CORE)
    print(f'合計: {sum(R)}/{len(R)} PASS')
    return 0 if all(R) else 1


if __name__ == '__main__':
    sys.exit(main())
