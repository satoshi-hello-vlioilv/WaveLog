"""test_donestops.py: ロットが完了へ移ったら、上の設備停止へ時刻を入れる（§9.605）

============================================================
利用者の指示
------------------------------------------------------------
「作業スケジュールのロットを完了へ移行することができますが、その時にそのスケジュールより以前にあった
 設備停止項目もそのスケジューリングされた時間(前後のロットに挟まれた時刻の範囲)に設備停止として自動登録
 するようにしたいです。正しく使用している場合、ロットの実績が入って完了に移行したときにそのロットの開始
 時間がその前にある設備停止の終了時間ということで処理が可能。」

物差し（**直す前にも同じ材料で測った**・前の値は §9.605 の決定記録）:
 M4. 完了したロットより上の設備停止のうち、時刻が入った数（前 0/2）
 M5. その時刻の合計が「前のロットの終わり〜このロットの開始」に一致するか（前 0分／あるべき 90分）
ほかに固定すること:
 1. 分け方は厳密モードの開始と同じ（見積の比・最後はちょうど開始で終わる・つなぎ目に隙間なし）
 2. 出どころは「完了で自動」・設備停止は完了・時刻の登録を促さない
 3. 前のロットがまだ終わっていない・終わりの時刻が分からないなら**入れない**（推測で埋めない）
 4. 前にロットが無ければ開始から見積ぶん遡る（出どころ「見積」）
 5. 人が入れた時刻のある設備停止は動かさない（その終わりから後ろを分ける）
 6. 完了突合（実績データ）の作業時間で完了したロットでも同じ
 7. 書込役が残す（`actual_keep.persist()`）。人が入れた時刻は上書きしない・控えは応答へ出さない
 8. 裏の見回りが回る先に「時刻の無い設備停止がある設備」が入る

**材料は自分で作る**（一時フォルダの共有DB・設定DB）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import json
import pathlib
import shutil
import sys
import tempfile
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import actual_keep  # noqa: E402 パスを通してから読む
from backend import schedule_calc as sc  # noqa: E402 パスを通してから読む
from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr  # noqa: E402 パスを通してから読む
from backend.repositories import master_repo as mr  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


EQ = '完了停止試験設備'
NOW = datetime.now().replace(second=0, microsecond=0)
# 仕掛の突き合わせはこの網の外（`test_strictstart`と同じ）。完了突合で完了にする場面だけ差し替える。
HITS = {}
sc.actual_match.lookup = lambda detail, entry, defs=None: HITS.get(entry.get('lotNo')) or {'missing': False, 'reason': ''}
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_donestops_'))
mc = connect(tmp / 'master.sqlite3', False)
mr.ensure_equipment_master_table(mc)
mr.ensure_equipment_master_table(mc)
mc.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効]) VALUES (?,10,-1)', [EQ])
mc.commit()


def plan_db(name, rows):
    """予定の表を作る。rows は (鍵, 種別, ロット, 見積分)。戻り値: (接続, 鍵→予定ID)。"""
    c = connect(tmp / name, False)
    sr.ensure_plan_table(c)
    sr.ensure_plan_table(c)   # 作った直後は後から足した列がまだ無い。2回目で足す
    ids = {}
    for key, kind, lot, est in rows:
        cur = c.cursor()
        cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[鋳造番号],[予定名称],[明細JSON],[見積分],[状態],[有効]) '
                    'VALUES (?,?,?,?,?,?,?,?,?,1)',
                    [EQ, len(ids) + 1, kind, lot, 'C' + lot if lot else '', '段取り替え' if kind == '設備停止' else '',
                     json.dumps({'lotNo': lot} if lot else {}), est, '予定'])
        ids[key] = cur.lastrowid
    c.commit()
    return c, ids


def times(c, pid, st, minutes, est=60):
    sr.plan_set_manual_times(c, pid, 'tester', sc.manual_payload(st.isoformat(), (st + timedelta(minutes=minutes)).isoformat(), est))
    c.commit()


def expand(c):
    out = sc._expand_plan_with(c, mc, EQ, NOW, sr.plan_rows(c, EQ), include_unplanned=False, actual_index={})
    return out, {e['id']: e for e in out['entries']}


A0 = NOW - timedelta(hours=5)
A_END = A0 + timedelta(minutes=60)
B0 = A_END + timedelta(minutes=90)
try:
    # ---- M4・M5・1・2: 前後のロットが終わったら、あいだの2本へ時刻 ----
    c, ids = plan_db('s1.sqlite3', [('A', '作業', 'LA', 60), ('S1', '設備停止', '', 20), ('S2', '設備停止', '', 40),
                                    ('B', '作業', 'LB', 60), ('C', '作業', 'LC', 60)])
    times(c, ids['A'], A0, 60)
    times(c, ids['B'], B0, 60)
    out, by = expand(c)
    s1, s2 = by[ids['S1']], by[ids['S2']]
    got = [k for k in ('S1', 'S2') if (by[ids[k]].get('actual') or {}).get('startAt')]
    rec(f'M4: 完了したロットより上の設備停止に時刻が入る 2/2（前 0/2）——今は {len(got)}/2', len(got) == 2, got)
    total = sum(by[ids[k]]['actual']['minutes'] for k in got)
    rec(f'M5: 時刻の合計は前のロットの終わり〜このロットの開始の90分（前 0分）——今は {total}分', total == 90, total)
    rec('1: 1本目は前のロットの終わりから、最後はちょうどこのロットの開始で終わる・つなぎ目に隙間なし',
        s1['actual']['startAt'] == A_END.isoformat(timespec='minutes') and s2['actual']['endAt'] == B0.isoformat(timespec='minutes')
        and s1['actual']['endAt'] == s2['actual']['startAt'], (s1['actual'], s2['actual']))
    rec('1: 見積の比（20:40）で分ける（90分 → 30分＋60分）', [s1['actual']['minutes'], s2['actual']['minutes']] == [30, 60],
        [s1['actual']['minutes'], s2['actual']['minutes']])
    rec('2: 出どころは「完了で自動」・設備停止は完了・時刻の登録を促さない',
        all(e['state'] == '完了' and e['actual'].get('source') == sc.MANUAL_SOURCE_DONE and not e.get('timesNeeded')
            and e['actual'].get('manual') for e in (s1, s2)), [(e['state'], e['actual'].get('source'), e.get('timesNeeded')) for e in (s1, s2)])

    # ---- 7: 書込役が残す ----
    saved = []
    real_with_write, real_writable = actual_keep.schedule_sync.with_write, actual_keep.writable
    actual_keep.schedule_sync.with_write = lambda uid, pc, who, fn: saved.append(fn(c)) or c.commit()
    actual_keep.writable = lambda: ''
    try:
        note = actual_keep.persist(out, 'auto:test', 'PC-T')
        rec('7: 控え（stopTimesToSave）は応答へ出さない', not any('stopTimesToSave' in e for e in out['entries']))
        raw = [sc.manual_times(sr.plan_row(c, ids[k])[23]) for k in ('S1', 'S2')]
        rec('7: 残すと予定の[手入力実績JSON]に入る（出どころ「完了で自動」・状態は完了）',
            not note and saved and saved[0]['saved'] == 2 and all(m and m.get('source') == sc.MANUAL_SOURCE_DONE for m in raw)
            and all(sr.plan_row(c, ids[k])[11] == '完了' for k in ('S1', 'S2')), (note, saved, raw))
        out2, _by2 = expand(c)
        saved.clear()
        actual_keep.persist(out2, 'auto:test', 'PC-T')
        rec('7: 残したあとは控えが出ない（2回目は書かない）', not saved or saved[0]['saved'] == 0, saved)
        human = sc.manual_payload((A_END + timedelta(minutes=5)).isoformat(), (A_END + timedelta(minutes=25)).isoformat(), 20, 'person')
        sr.plan_set_manual_times(c, ids['S1'], 'person', human)
        rec('7: 自動で入れるとき（keep）は時刻が既にある行を上書きしない',
            sr.plan_set_manual_times(c, ids['S1'], 'auto', sc.strict_stop_payload(
                {'startAt': 'x', 'endAt': 'y', 'endFrom': '見積', 'minutes': 1}), keep=True) == 0
            and sc.manual_times(sr.plan_row(c, ids['S1'])[23])['by'] == 'person')
    finally:
        actual_keep.schedule_sync.with_write, actual_keep.writable = real_with_write, real_writable

    # ---- 3: 前のロットがまだ終わっていない ----
    c3, ids3 = plan_db('s3.sqlite3', [('A', '作業', 'LA', 60), ('S1', '設備停止', '', 20), ('B', '作業', 'LB', 60)])
    times(c3, ids3['B'], B0, 60)
    _o3, by3 = expand(c3)
    rec('3: 前のロットがまだ終わっていなければ入れない（分かったときに入れる）',
        not (by3[ids3['S1']].get('actual') or {}).get('startAt') and 'stopTimesToSave' not in by3[ids3['S1']], by3[ids3['S1']].get('actual'))
    sr.plan_update(c3, ids3['A'], 'tester', state='完了')
    c3.commit()
    _o3b, by3b = expand(c3)
    rec('3: 前のロットが完了でも終わりの時刻が分からなければ入れない（時刻の登録を促すまま）',
        not (by3b[ids3['S1']].get('actual') or {}).get('startAt'), by3b[ids3['S1']].get('actual'))

    # ---- 4: 前にロットが無い ----
    c4, ids4 = plan_db('s4.sqlite3', [('S1', '設備停止', '', 15), ('B', '作業', 'LB', 60)])
    times(c4, ids4['B'], B0, 60)
    _o4, by4 = expand(c4)
    a4 = by4[ids4['S1']].get('actual') or {}
    rec('4: 前にロットが無ければ開始から見積（15分）ぶん遡る（出どころ「見積」）',
        a4.get('minutes') == 15 and a4.get('endAt') == B0.isoformat(timespec='minutes')
        and a4.get('endFrom') == sc.MANUAL_END_FROM_ESTIMATE and a4.get('source') == sc.MANUAL_SOURCE_DONE, a4)

    # ---- 5: 人が入れた時刻の設備停止は動かさない ----
    c5, ids5 = plan_db('s5.sqlite3', [('A', '作業', 'LA', 60), ('S1', '設備停止', '', 20), ('S2', '設備停止', '', 40),
                                      ('B', '作業', 'LB', 60)])
    times(c5, ids5['A'], A0, 60)
    times(c5, ids5['S1'], A_END, 30, 20)
    times(c5, ids5['B'], B0, 60)
    _o5, by5 = expand(c5)
    a51, a52 = by5[ids5['S1']]['actual'], by5[ids5['S2']].get('actual') or {}
    rec('5: 人が入れた時刻はそのまま・残りはその終わりから開始まで',
        a51.get('source') == '手入力' and a52.get('startAt') == (A_END + timedelta(minutes=30)).isoformat(timespec='minutes')
        and a52.get('endAt') == B0.isoformat(timespec='minutes') and a52.get('minutes') == 60, (a51, a52))

    # ---- 6: 完了突合の作業時間で完了したロット ----
    c6, ids6 = plan_db('s6.sqlite3', [('A', '作業', 'LA', 60), ('S1', '設備停止', '', 20), ('B', '作業', 'LB', 60)])
    times(c6, ids6['A'], A0, 60)
    HITS['LB'] = {'missing': False, 'complete': True, 'actual': {}, 'startedAt': B0.isoformat(),
                  'finishedAt': (B0 + timedelta(minutes=50)).isoformat(), 'joinName': 'BOX実績突合', 'finishWhen': 'hit',
                  'code': 'hit', 'reason': ''}
    _o6, by6 = expand(c6)
    a6 = by6[ids6['S1']].get('actual') or {}
    rec('6: 完了突合（実績データ）の作業時間で完了したロットでも、上の設備停止へ入れる',
        by6[ids6['B']]['state'] == '完了' and a6.get('startAt') == A_END.isoformat(timespec='minutes')
        and a6.get('endAt') == B0.isoformat(timespec='minutes'), (by6[ids6['B']]['state'], a6))
    rec('6: 「時刻だけ」で値を持ち帰らない突合も、写しを残す対象（完了を言い続けるため）',
        [e['id'] for e in actual_keep.pending({'entries': [dict(by6[ids6['B']], actualSource={})]})] == [ids6['B']])
    HITS.clear()

    # ---- 8: 裏の見回りが回る先 ----
    rec('8: 時刻の無い設備停止がある設備を答える（取り消した行は数えない）',
        sr.plan_equipments_untimed_stops(c3) == [EQ] and sr.plan_equipments_untimed_stops(c) == [],
        (sr.plan_equipments_untimed_stops(c3), sr.plan_equipments_untimed_stops(c)))
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    rec('一時の置き場を片付けた', not tmp.exists())

ok = sum(R)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
