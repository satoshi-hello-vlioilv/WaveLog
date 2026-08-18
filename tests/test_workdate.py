#!/usr/bin/env python3
"""test_workdate.py: 現場歴の日付補正（§9.195）。

============================================================
なぜ要るか
------------------------------------------------------------
「日付＋勤務」でまとめると、**日を跨ぐ勤務が2つに割れていた**。3直
23:00〜翌7:00 は1回の勤務なのに、23:30の行は「8/18 3直」・翌2:00の行は
「8/19 3直」となり、同じ勤務帯が別々の塊になる（利用者の指摘）。

現場の数え方（現場歴）では、跨いだ後の時間帯も**跨ぐ前の日**として数える。
**日付の演算をコードへ埋め込まないこと**が利用者の指示なので、
勤務形態マスタの1列（[日付補正]）で決め、勤務区分ごとに直せるようにした。

ここで固定するのは、
 1. 日付補正の既定（跨ぐ区分は-1／跨がない区分は0）と、明示した値が勝つこと
 2. 跨いだ後の時間帯にだけ当たること（跨ぐ前は補正しない）
 3. 保存・読み出しで残ること／跨がない区分には保存しないこと
 4. 時刻が HH:MM へそろうこと（1桁で保存されていると編集画面が空欄になり、
    そのまま保存すると400で断られていた。移行分が実際にそうなっていた）
============================================================
"""
import pathlib
import sqlite3
import sys
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                                     # noqa: E402
from backend import db_access, schedule_calc                # noqa: E402
from backend.repositories import schedule_repo as sr        # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
UID = 'test-workdate'
NAME = '現場歴テスト体系'


def purge():
    """検証で作った勤務体系を**物理的に**消す。マスタDBは実行をまたいで
    生き延びるため（§9.121）、前後で必ず片付ける。"""
    try:
        conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
        ids = [r[0] for r in conn.execute(
            'SELECT [勤務体系ID] FROM [勤務体系マスタ] WHERE [名称]=?', (NAME,))]
        for pid in ids:
            conn.execute('DELETE FROM [勤務区分マスタ] WHERE [勤務体系ID]=?', (pid,))
            conn.execute('DELETE FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?', (pid,))
        conn.execute('DELETE FROM [勤務体系マスタ] WHERE [名称]=?', (NAME,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def rows_for(segments):
    """resolve_shift_info へ渡す形（勤務ID,設備名,名称,開始,終了,表示順,有効,日付補正）。"""
    return [(i, '', s[0], s[1], s[2], i * 10, -1,
             sr.segment_day_offset(s[1], s[2], s[3] if len(s) > 3 else None))
            for i, s in enumerate(segments, start=1)]


purge()
try:
    # ---- 1) 既定の決め方 ----
    rec('日を跨ぐ区分の既定は -1（跨いだ部分は前の日として数える）',
        sr.segment_day_offset('23:00', '07:00', None) == -1,
        str(sr.segment_day_offset('23:00', '07:00', None)))
    rec('日を跨がない区分は必ず 0（当てる時間帯が無い）',
        sr.segment_day_offset('08:15', '17:05', None) == 0
        and sr.segment_day_offset('08:15', '17:05', -1) == 0,
        f"{sr.segment_day_offset('08:15','17:05',None)}/{sr.segment_day_offset('08:15','17:05',-1)}")
    rec('明示した 0 は「暦どおり」として効く（解除できる）',
        sr.segment_day_offset('23:00', '07:00', 0) == 0)
    rec('とんでもない値は丸める（±7日）',
        sr.segment_day_offset('23:00', '07:00', -99) == -7
        and sr.segment_day_offset('23:00', '07:00', 99) == 7)
    rec('壊れた値は既定へ落とす（例外にしない）',
        sr.segment_day_offset('23:00', '07:00', 'あ') == -1)
    rec('日跨ぎの判定は1箇所（crosses_midnight）',
        sr.crosses_midnight('23:00', '07:00') and not sr.crosses_midnight('08:15', '17:05'),
        '')

    # ---- 2) 当たる時間帯 ----
    rows = rows_for([('1直', '07:00', '15:00'), ('2直', '15:00', '23:00'),
                     ('3直', '23:00', '07:00')])
    before = schedule_calc.resolve_shift_info([], rows, datetime(2026, 8, 18, 23, 30))
    after = schedule_calc.resolve_shift_info([], rows, datetime(2026, 8, 19, 2, 0))
    day = schedule_calc.resolve_shift_info([], rows, datetime(2026, 8, 19, 9, 0))
    rec('跨ぐ前（23:30）は補正しない', before == ('3直', 0), str(before))
    rec('跨いだ後（翌2:00）に補正が当たる', after == ('3直', -1), str(after))
    rec('跨がない勤務は補正0', day == ('1直', 0), str(day))
    # 現場歴の日付: 23:30 も 翌2:00 も同じ日になる（＝まとめが割れない）。
    d1 = (datetime(2026, 8, 18, 23, 30)).date()
    d2 = (datetime(2026, 8, 19, 2, 0)).date().toordinal() + after[1]
    rec('日を跨いでも同じ日付になる（まとめが割れない）',
        d1.toordinal() == d2, f'{d1} / {d1.fromordinal(d2)}')
    rec('名称だけ返す従来の関数も同じ判定を通る',
        schedule_calc.resolve_shift_label([], rows, datetime(2026, 8, 19, 2, 0)) == '3直')

    # ---- 3) 保存・読み出し ----
    r = client.post('/api/schedule/shift-pattern-master', json={
        'user_id': UID, 'name': NAME, 'equipment': [],
        'segments': [{'name': '日勤', 'start': '8:15', 'end': '17:05'},
                     {'name': '夜勤', 'start': '23:00', 'end': '7:00'},
                     {'name': '準夜', 'start': '19:00', 'end': '3:00', 'dayOffset': 0}]})
    body = r.get_json() or {}
    pid = body.get('id')
    rec('登録できる', r.status_code == 200 and bool(pid), f"{r.status_code} {body.get('error','')}")
    got = (client.get('/api/schedule/shift-pattern-master?scope=all').get_json() or {})
    pat = next((x for x in (got.get('items') or []) if x.get('name') == NAME), {})
    segs = {s['name']: s for s in (pat.get('segments') or [])}
    rec('時刻は HH:MM へそろえて返す（編集画面が空欄にならない）',
        segs.get('日勤', {}).get('start') == '08:15'
        and segs.get('夜勤', {}).get('start') == '23:00'
        and segs.get('夜勤', {}).get('end') == '07:00',
        str({k: (v.get('start'), v.get('end')) for k, v in segs.items()}))
    rec('日跨ぎの区分に既定の -1 が入る',
        segs.get('夜勤', {}).get('dayOffset') == -1
        and segs.get('夜勤', {}).get('crossesMidnight') is True,
        str(segs.get('夜勤')))
    rec('明示した 0 はそのまま残る（暦どおりに戻せる）',
        segs.get('準夜', {}).get('dayOffset') == 0, str(segs.get('準夜')))
    rec('跨がない区分は補正を持たない',
        segs.get('日勤', {}).get('dayOffset') == 0
        and segs.get('日勤', {}).get('crossesMidnight') is False,
        str(segs.get('日勤')))
    # 跨がない区分へ値を送っても保存しない（効かない設定を残さない）。
    client.post('/api/schedule/shift-pattern-master', json={
        'user_id': UID, 'id': pid, 'name': NAME, 'equipment': [],
        'segments': [{'name': '日勤', 'start': '08:15', 'end': '17:05', 'dayOffset': -1}]})
    conn = sqlite3.connect(db_access.DBS['MASTER']['path'])
    raw = conn.execute('SELECT [名称],[日付補正] FROM [勤務区分マスタ] WHERE [勤務体系ID]=?',
                       (pid,)).fetchall()
    conn.close()
    rec('跨がない区分には補正を保存しない（効かない設定を残さない）',
        raw and all(v is None for _n, v in raw), str(raw))
finally:
    purge()

print('\n=== SUMMARY ===')
ng = [x for x in R if not x[1]]
print('%d/%d passed' % (len(R) - len(ng), len(R)))
raise SystemExit(1 if ng else 0)
