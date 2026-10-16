"""test_doneflow.py: 完了ロットは実績の時刻順に処理する・終了で次の設備停止が始まる・始まった停止の終わり（§9.611）

============================================================
利用者の指示
------------------------------------------------------------
「作業スケジュールの完了ロットは開始終了時刻順に並べて完了側に並べてその続きで予定スケジュールを並べる…
 完了ロットの時刻順に処理し、そのタイミングで入っている、そのロットより前のスケジュールに組まれている停止項目は
 そのロットの開始時刻を設備停止の終了時間として…開始したことに」
「このアプリで作業ロットを開始して終了まで時間登録した場合、次の項目が設備停止の時は、設備停止が開始された
 ことに…自動的に設定された時間が経過して終了…途中でその開始されている設備停止を終了時間を打つか、次のロットの
 開始をする、または次の設備停止の開始を行うと設備停止実績が入るように」
（停止の時刻の分け方は §9.605 のまま——利用者の答え「現状そのルールが適用されているのであれば問題ない」）

物差し（**直す前にも同じ材料で測った**・前の値は §9.611 の決定記録）:
 D1. 表示順と違う順に終えたとき（表示順 S1・A・S2・B、終えた順 B→A）、上の設備停止に時刻が入った数（あるべき 2/2）
 D2. 作業中のロットを「終了」すると、ロットに終わりの時刻が入り、次の設備停止が「始まった」になる
 D3. 始まった設備停止は、予定の時間が過ぎたら自動で終わる（終わり＝始まり＋見積）
 D4. 予定の時間の前に次のロットが始まったら、その始まりで終わる
 D5. 予定の時間の前に次の設備停止が始まったら、その始まりで終わる
 D6. 始まった設備停止に「終了」を打つと、その時刻で終わる（次が設備停止なら、それが始まる）
 D7. 予定の時間の途中で何も起きていなければ「作業中」のまま（時刻は始まりだけ）
 D8. 測定画面でロットを終えたら、次の設備停止は終えた時刻から始まる（開始判定は書込役が残す・開始の口は数えない）

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


EQ = '完了の流れ試験設備'
NOW = datetime.now().replace(second=0, microsecond=0)
sc.actual_match.lookup = lambda detail, entry, defs=None: {'missing': False, 'reason': ''}
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_doneflow_'))
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
                     json.dumps({'lotNo': lot, 'castingNo': 'C' + lot, 'mfgMaterial': 'A5052'} if lot else {}), est, '予定'])
        ids[key] = cur.lastrowid
    c.commit()
    return c, ids


def times(c, pid, st, minutes, est=60):
    sr.plan_set_manual_times(c, pid, 'tester', sc.manual_payload(st.isoformat(), (st + timedelta(minutes=minutes)).isoformat(), est))
    c.commit()


def started(c, pid, at):
    """「始まった」の印（開始判定）を書く。作業も設備停止も同じ1列（[開始判定JSON]）。"""
    try:
        n = sr.plan_set_start_flag(c, pid, 'tester', {'at': at.isoformat(timespec='minutes'), 'by': 'tester', 'pc': 'PC-T'})
    except ValueError as e:
        print('   （開始の印を書けない: ' + str(e) + '）')
        n = 0
    c.commit()
    return n


def expand(c, now=NOW):
    out = sc._expand_plan_with(c, mc, EQ, now, sr.plan_rows(c, EQ), include_unplanned=False, actual_index={})
    return out, {e['id']: e for e in out['entries']}


def act(e):
    return e.get('actual') or {}


def progress(c, pid, action, now):
    """「開始」「終了」で書く物を決めて書く（口 `/api/schedule/plan/progress` と同じ道）。無ければ None。"""
    fn = getattr(sc, 'progress_plan', None)
    if fn is None:
        return None
    entries, minutes_of, _idx = sc.plan_states(c, mc, EQ, now, actual_index={})
    plan = fn(entries, pid, action, now, minutes_of)
    if plan.get('ok'):
        sc.apply_progress(c, plan, 'tester', 'PC-T')
        c.commit()
    return plan


T0 = NOW - timedelta(hours=6)
try:
    # ---- D1: 表示順と違う順に終えた（表示順 S1・A・S2・B／終えた順 B→A） ----
    c1, i1 = plan_db('d1.sqlite3', [('S1', '設備停止', '', 20), ('A', '作業', 'LA', 60), ('S2', '設備停止', '', 40),
                                    ('B', '作業', 'LB', 60)])
    times(c1, i1['B'], T0, 60)
    times(c1, i1['A'], T0 + timedelta(minutes=120), 60)
    _o1, b1 = expand(c1)
    got = [k for k in ('S1', 'S2') if act(b1[i1[k]]).get('startAt')]
    rec(f'D1: 表示順と違う順に終えても、上の設備停止に時刻が入る 2/2——今は {len(got)}/2', len(got) == 2, got)
    s2 = act(b1[i1['S2']])
    rec('D1: 先に終えたロット B の上の停止 S2 は B の開始で終わる（時刻の順に処理）',
        s2.get('endAt') == T0.isoformat(timespec='minutes'), s2)

    # ---- D2: 作業中のロットを「終了」すると、次の設備停止が始まる ----
    c2, i2 = plan_db('d2.sqlite3', [('A', '作業', 'LA', 60), ('S', '設備停止', '', 30), ('B', '作業', 'LB', 60)])
    started(c2, i2['A'], NOW - timedelta(minutes=50))
    p = progress(c2, i2['A'], 'end', NOW - timedelta(minutes=10))
    _o2, b2 = expand(c2)
    a2, s2b = act(b2[i2['A']]), b2[i2['S']]
    rec('D2: 「終了」でロットに終わりの時刻（押した時刻）が入り完了になる',
        p is not None and b2[i2['A']]['state'] == '完了' and a2.get('endAt') == (NOW - timedelta(minutes=10)).isoformat(timespec='minutes'),
        (p and p.get('error'), b2[i2['A']]['state'], a2))
    rec('D2: 次の項目が設備停止なら「始まった」（作業中・始まりはロットの終わり）',
        s2b['state'] == '着手' and act(s2b).get('startAt') == (NOW - timedelta(minutes=10)).isoformat(timespec='minutes'),
        (s2b['state'], act(s2b)))

    # ---- D3: 予定の時間が過ぎたら自動で終わる ----
    _o3, b3 = expand(c2, NOW + timedelta(minutes=30))
    s3 = b3[i2['S']]
    rec('D3: 始まった停止は予定の時間（30分）が過ぎたら終わる（終わり＝始まり＋見積）',
        s3['state'] == '完了' and act(s3).get('endAt') == (NOW + timedelta(minutes=20)).isoformat(timespec='minutes')
        and act(s3).get('minutes') == 30, (s3['state'], act(s3)))
    rec('D3: 自動で終えた時刻は書込役が残す（stopTimesToSave）', bool(s3.get('stopTimesToSave')), s3.get('stopTimesToSave'))

    # ---- D7: 予定の時間の途中で何も起きていなければ作業中のまま ----
    s7 = b2[i2['S']]
    rec('D7: 予定の時間の途中は作業中（終わりは入れない）', s7['state'] == '着手' and not act(s7).get('endAt'), act(s7))

    # ---- D4: 予定の時間の前に次のロットが始まった ----
    c4, i4 = plan_db('d4.sqlite3', [('A', '作業', 'LA', 60), ('S', '設備停止', '', 30), ('B', '作業', 'LB', 60)])
    times(c4, i4['A'], NOW - timedelta(minutes=70), 60)
    started(c4, i4['S'], NOW - timedelta(minutes=10))
    started(c4, i4['B'], NOW - timedelta(minutes=2))
    _o4, b4 = expand(c4)
    s4 = b4[i4['S']]
    rec('D4: 次のロットが始まったら、その始まりで終わる（8分）',
        s4['state'] == '完了' and act(s4).get('endAt') == (NOW - timedelta(minutes=2)).isoformat(timespec='minutes')
        and act(s4).get('minutes') == 8, (s4['state'], act(s4)))

    # ---- D5: 予定の時間の前に次の設備停止が始まった ----
    c5, i5 = plan_db('d5.sqlite3', [('A', '作業', 'LA', 60), ('S1', '設備停止', '', 30), ('S2', '設備停止', '', 20),
                                    ('B', '作業', 'LB', 60)])
    times(c5, i5['A'], NOW - timedelta(minutes=70), 60)
    started(c5, i5['S1'], NOW - timedelta(minutes=10))
    p5 = progress(c5, i5['S2'], 'start', NOW - timedelta(minutes=4))
    _o5, b5 = expand(c5)
    rec('D5: 次の設備停止を「開始」したら、前の停止はその始まりで終わる（6分）・次の停止は作業中',
        p5 is not None and b5[i5['S1']]['state'] == '完了' and act(b5[i5['S1']]).get('minutes') == 6
        and b5[i5['S2']]['state'] == '着手', (p5 and p5.get('error'), b5[i5['S1']]['state'], act(b5[i5['S1']]), b5[i5['S2']]['state']))

    # ---- D6: 始まった停止に「終了」を打つ ----
    p6 = progress(c5, i5['S2'], 'end', NOW - timedelta(minutes=1))
    _o6, b6 = expand(c5)
    rec('D6: 始まった停止に「終了」を打つとその時刻で終わる（3分・出どころは手入力）',
        p6 is not None and b6[i5['S2']]['state'] == '完了' and act(b6[i5['S2']]).get('minutes') == 3
        and act(b6[i5['S2']]).get('source') == '手入力', (p6 and p6.get('error'), b6[i5['S2']]['state'], act(b6[i5['S2']])))

    # ---- D8: 測定画面でロットを終えた ----
    c8, i8 = plan_db('d8.sqlite3', [('A', '作業', 'LA', 60), ('S', '設備停止', '', 30), ('B', '作業', 'LB', 60)])
    a_end = NOW - timedelta(minutes=12)
    idx = sc._build_actual_index([{'id': 'ra', 'status': '完了', 'updated_at': NOW.isoformat(), 'equipment': EQ,
                                   'payload': json.dumps({'basic': {'lotNo': 'LA', 'castingNo': 'CLA', 'mfgMaterial': 'A5052'},
                                                          'settings': {'registeredEquipment': EQ},
                                                          'workTime': {'startAt': (a_end - timedelta(minutes=60)).isoformat(),
                                                                       'endAt': a_end.isoformat()}})}])
    o8 = sc._expand_plan_with(c8, mc, EQ, NOW, sr.plan_rows(c8, EQ), include_unplanned=False, actual_index=idx)
    s8 = next(e for e in o8['entries'] if e['id'] == i8['S'])
    rec('D8: 測定画面でロットを終えたら、次の設備停止は終えた時刻から作業中',
        s8['state'] == '着手' and act(s8).get('startAt') == a_end.isoformat(timespec='minutes'), (s8['state'], act(s8)))
    real_with_write, real_writable = actual_keep.schedule_sync.with_write, actual_keep.writable
    actual_keep.schedule_sync.with_write = lambda uid, pc, who, fn: fn(c8) and c8.commit()
    actual_keep.writable = lambda: ''
    try:
        actual_keep.persist(o8, 'auto:test', 'PC-T')
    finally:
        actual_keep.schedule_sync.with_write, actual_keep.writable = real_with_write, real_writable
    flag = sc.start_flag(sr.plan_row(c8, i8['S'])[24])
    rec('D8: その開始判定は書込役が残す（控え startFlagToSave は応答へ出さない）',
        flag and flag.get('at') == a_end.isoformat(timespec='minutes') and not any('startFlagToSave' in e for e in o8['entries']), flag)
    ents, _m, _x = sc.plan_states(c8, mc, EQ, NOW, actual_index=idx)
    rec('D8: 残したあとは開始の口（plan_states）も同じ答え（作業中）',
        next(e for e in ents if e['id'] == i8['S'])['state'] == '着手')
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    rec('一時の置き場を片付けた', not tmp.exists())

ok = sum(R)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
