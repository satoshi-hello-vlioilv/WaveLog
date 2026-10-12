"""test_strictstart.py: 厳密モードのロットの開始（§9.588）——一番上からだけ・上の設備停止を残さない

============================================================
利用者の指示
------------------------------------------------------------
「ロットの開始を作業スケジュール一覧の一番上のロットからしかできないようにするモード」
「スタートしたロットより上の設備停止は前のロットの終了時間とスタートしたロットの開始時刻の間の時間で
 実時間を登録を自動的にできるので、設備停止が残留してしまうということを避けられます」
「作業スケジュールの中で開始判定フラグを設け、管理する」

物差し（**直す前にも同じ物差しで測った**・前の値は §9.588 の決定記録）:
 M1. 一番上以外で開始できるロットの数（前 1/2・仕掛からは予定外も開始できた）
 M2. 開始したロットより上で、実際の時刻が無い設備停止の数（前 2/2・どちらも人が入れる）
 M3. 開始の記録が予定に残るか（前 なし）
ほかに固定すること:
 4. 設備停止の時刻は「前のロットの終わり〜開始」を見積の比で分け、最後はちょうど開始で終わる
 5. 前の終わりが分からなければ開始から見積ぶん遡る（出どころ「見積」）
 6. 作業中のロット（計画内・計画外）があれば、一番上でも開始できない（理由に名前）
 7. 既に開始・完了した行は「already」（書き直さない）。開始判定は2回目で上書きしない
 8. 開始判定のある行は、測定の開始時刻が無くても着手で、予定の応答に一番上のロットと運用モードが載る
 9. 通常モードの設備は一番上のロットを答えない（`strictTop` は None）
 10. 運用モードの読み替え（鍵・呼び名・空＝通常）
 11. 作業スケジュールから切り替える（§9.592）: 書くのは`write_equipment_run_mode()`（知らない設備・語彙に無い字は断る）、
     切り替えてよい端末は`line_ops_allowed()`の1箇所（スケジュールモード／編集モードでスケジュール可否・その設備の現場段取り）

**材料は自分で作る**（一時フォルダの共有DB・設定DB）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import json
import pathlib
import sys
import tempfile
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import schedule_calc as sc  # noqa: E402 パスを通してから読む
from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr  # noqa: E402 パスを通してから読む
from backend.repositories import master_repo as mr  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


EQ = '厳密試験設備'
NOW = datetime.now().replace(second=0, microsecond=0)
# **仕掛の在席は「仕掛にある」に固定する**（`test_scload`と同じ）。ランナーの中では検証用の仕掛が読めるので、
# ここで作ったロット（LA・LB・LC）は「仕掛から消えた＝完了」になり、単独で回したとき（仕掛を読めず
# 「判定できない」）と答えが変わった。この網が見るのは開始の判定で、仕掛の突き合わせではない。
sc.actual_match.lookup = lambda detail, entry: {'missing': False, 'reason': ''}
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_strict_'))
c = connect(tmp / 'schedule.sqlite3', False)
mc = connect(tmp / 'master.sqlite3', False)
sr.ensure_plan_table(c)
sr.ensure_plan_table(c)   # 作った直後は後から足した列がまだ無い。2回目で足す
mr.ensure_equipment_master_table(mc)
mr.ensure_equipment_master_table(mc)
mc.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],[運用モード]) VALUES (?,10,-1,?)', [EQ, 'strict'])
mc.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効]) VALUES (?,20,-1)', ['通常試験設備'])
mc.commit()

IDS = {}


def put(key, kind, lot='', est=60, eq=EQ):
    d = {'lotNo': lot, 'castingNo': 'C' + lot, 'mfgMaterial': 'A5052'} if lot else {}
    cur = c.cursor()
    cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[鋳造番号],[予定名称],[明細JSON],[見積分],[状態],[有効]) '
                'VALUES (?,?,?,?,?,?,?,?,?,1)',
                [eq, len(IDS) + 1, kind, lot, 'C' + lot if lot else '', '段取り替え' if kind == '設備停止' else '',
                 json.dumps(d), est, '予定'])
    IDS[key] = cur.lastrowid


put('A', '作業', 'LA')
put('S1', '設備停止', est=30)
put('S2', '設備停止', est=10)
put('B', '作業', 'LB')
put('C', '作業', 'LC')
c.commit()


def record(id_, lot, st, en, status, eq=EQ):
    return {'id': id_, 'status': status, 'updated_at': NOW.isoformat(), 'equipment': eq,
            'payload': json.dumps({'basic': {'lotNo': lot, 'castingNo': 'C' + lot, 'mfgMaterial': 'A5052'},
                                   'settings': {'registeredEquipment': eq},
                                   'workTime': {'startAt': st, 'endAt': en}})}


A_END = NOW - timedelta(minutes=80)
IDX_A_DONE = sc._build_actual_index([record('a', 'LA', (NOW - timedelta(minutes=160)).isoformat(), A_END.isoformat(), '完了')])


def states(idx):
    return sc.plan_states(c, mc, EQ, NOW, actual_index=idx)


# ---- M1: 開始できるのは一番上のロットだけ ----
entries, minutes_of, _ = states(IDX_A_DONE)
top = sc.strict_top(entries)
rec('一番上のロットは、完了したAの次の予定のロット（B）', top and top['id'] == IDS['B'] and top['startable'], top)
plan_c = sc.strict_start_plan(entries, IDS['C'], NOW, minutes_of)
plan_b = sc.strict_start_plan(entries, IDS['B'], NOW, minutes_of)
m1 = sum(1 for k in ('B', 'C') if sc.strict_start_plan(entries, IDS[k], NOW, minutes_of)['ok'] and k != 'B')
rec(f'M1: 一番上以外で開始できるロット 0（前 1/2）——今は {m1}', m1 == 0)
rec('一番上でないロットは理由と一番上のロットの名前を言って断る',
    not plan_c['ok'] and plan_c['code'] == 'notTop' and 'LB' in plan_c['error'] and '並べ替え' in plan_c['error'], plan_c['error'])
none = sc.find_plan_target(entries, None, 'LZ', 'CLZ', 'A5052')
plan_none = sc.strict_start_plan(entries, None, NOW, minutes_of)
rec('予定に無いロットは見つからず、「予定に入れて一番上へ」と言って断る',
    none is None and not plan_none['ok'] and plan_none['code'] == 'notPlanned', plan_none['error'])
rec('ロット番号＋鋳造番号＋製造材質で予定の行を見つける（全角・空白のゆれも同じ）',
    (sc.find_plan_target(entries, None, ' ＬＢ ', 'CLB', 'A5052') or {}).get('id') == IDS['B'])

# ---- 4: 設備停止の時刻は前の終わり〜開始を見積の比で分ける ----
stops = plan_b['stops']
gap = (NOW - A_END).total_seconds() / 60
rec('開始で書く設備停止は、Aとのあいだの2本（並びの順）', [s['id'] for s in stops] == [IDS['S1'], IDS['S2']], stops)
rec('1本目はAの終わりから、最後はちょうど開始で終わる（出どころ「前のロットの終わり〜開始」）',
    stops and stops[0]['startAt'] == A_END.isoformat(timespec='minutes') and stops[-1]['endAt'] == NOW.isoformat(timespec='minutes')
    and all(s['endFrom'] == sc.MANUAL_FROM_PREV_END for s in stops), stops)
rec('見積の比（30:10）で分ける（80分 → 60分＋20分）', [s['minutes'] for s in stops] == [round(gap * 3 / 4), round(gap / 4)],
    [s['minutes'] for s in stops])
rec('つなぎ目に隙間も重なりも無い', all(stops[i]['endAt'] == stops[i + 1]['startAt'] for i in range(len(stops) - 1)))
rec('前のロットの終わりの時刻を返す（画面が「〜から」と言う）', (plan_b['prev'] or {}).get('endAt') == A_END.isoformat(timespec='minutes'))

# ---- 書く（ルートと同じ段取り）→ M2・M3 ----
uid, pc = 'tester', 'PC-T'
sr.plan_set_start_flag(c, IDS['B'], uid, {'at': plan_b['start'], 'by': uid, 'pc': pc}, pc=pc)
for st in stops:
    sr.plan_set_manual_times(c, st['id'], uid, sc.strict_stop_payload(st, uid, pc), pc=pc)
c.commit()
out = sc._expand_plan_with(c, mc, EQ, NOW, sr.plan_rows(c, EQ), actual_index=IDX_A_DONE)
by = {e['id']: e for e in out['entries'] if not e.get('unplanned')}
left = [k for k in ('S1', 'S2') if not ((by[IDS[k]].get('actual') or {}).get('startAt'))]
rec(f'M2: 開始したロットより上で実際の時刻が無い設備停止 0（前 2/2）——今は {len(left)}', not left, left)
rec('設備停止は完了・時刻の出どころは「開始で自動」・登録を促さない',
    all(by[IDS[k]]['state'] == '完了' and (by[IDS[k]].get('actual') or {}).get('source') == sc.MANUAL_SOURCE_START
        and not by[IDS[k]].get('timesNeeded') for k in ('S1', 'S2')),
    [(by[IDS[k]]['state'], by[IDS[k]].get('actual')) for k in ('S1', 'S2')])
b = by[IDS['B']]
rec('M3: 開始判定が予定に残る（誰が・いつ）', (b.get('startFlag') or {}).get('at') == plan_b['start'] and b['startFlag']['by'] == uid, b.get('startFlag'))
rec('測定の開始時刻が無くても、開始判定のある行は着手（開始は押した時刻）',
    b['state'] == '着手' and (b.get('actual') or {}).get('startAt') == plan_b['start']
    and (b.get('actual') or {}).get('startFrom') == sc.START_FLAG_FROM, (b['state'], b.get('actual')))
rec('予定の応答は運用モードと一番上のロットを持つ（Bは作業中なので開始できない）',
    out['runMode'] == 'strict' and out['strictTop']['id'] == IDS['B'] and not out['strictTop']['startable']
    and '作業中' in out['strictTop']['reason'], out['strictTop'])

# ---- 6・7: 作業中は次を始めない・2回目は書き直さない ----
entries2, minutes_of2, _ = states(IDX_A_DONE)
again = sc.strict_start_plan(entries2, IDS['B'], NOW, minutes_of2)
rec('開始済みの行をもう一度開始しても「already」（何も書かない）', again['ok'] and again['already'] and not again['stops'])
rec('開始判定は2回目で上書きしない（最初に開始した時刻が残る）',
    sr.plan_set_start_flag(c, IDS['B'], 'other', {'at': '2000-01-01T00:00', 'by': 'other'}) == 0)
c_plan = sc.strict_start_plan(entries2, IDS['C'], NOW, minutes_of2)
rec('作業中のロットがあるあいだは次のロットも始めない——理由は「作業中」（並べ替えに行かせない）',
    not c_plan['ok'] and c_plan['code'] == 'busy' and 'LB が作業中' in c_plan['error'] and '並べ替え' not in c_plan['error'], c_plan['error'])
IDX_B_DONE = sc._build_actual_index([
    record('a', 'LA', (NOW - timedelta(minutes=160)).isoformat(), A_END.isoformat(), '完了'),
    record('b', 'LB', plan_b['start'], (NOW + timedelta(minutes=1)).isoformat(), '完了')])
entries3, minutes_of3, _ = states(IDX_B_DONE)
top3 = sc.strict_top(entries3)
rec('Bを測定で完了すると、一番上はCになり開始できる', top3['id'] == IDS['C'] and top3['startable'], top3)
IDX_UNPLANNED = sc._build_actual_index([
    record('a', 'LA', (NOW - timedelta(minutes=160)).isoformat(), A_END.isoformat(), '完了'),
    record('b', 'LB', plan_b['start'], (NOW + timedelta(minutes=1)).isoformat(), '完了'),
    record('x', 'LX', (NOW - timedelta(minutes=5)).isoformat(), None, '編集中')])
entries4, _m4, _ = states(IDX_UNPLANNED)
top4 = sc.strict_top(entries4)
rec('予定に無いロットが作業中なら、一番上でも開始できない（理由にそのロット）',
    top4['id'] == IDS['C'] and not top4['startable'] and 'LX' in top4['reason'] and '予定に無い' in top4['reason'], top4)

# ---- 5: 前の終わりが分からなければ見積ぶん遡る ----
c2 = connect(tmp / 'schedule2.sqlite3', False)
sr.ensure_plan_table(c2)
sr.ensure_plan_table(c2)
c2.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[予定名称],[見積分],[状態],[有効]) VALUES (?,1,?,?,?,?,1)',
           [EQ, '設備停止', '始業点検', 15, '予定'])
c2.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[鋳造番号],[明細JSON],[見積分],[状態],[有効]) VALUES (?,2,?,?,?,?,?,?,1)',
           [EQ, '作業', 'LF', 'CLF', json.dumps({'lotNo': 'LF', 'castingNo': 'CLF', 'mfgMaterial': 'A5052'}), 60, '予定'])
c2.commit()
e5, m5, _ = sc.plan_states(c2, mc, EQ, NOW, actual_index={})
p5 = sc.strict_start_plan(e5, sc.find_plan_target(e5, None, 'LF', 'CLF', 'A5052')['id'], NOW, m5)
rec('前のロットが無いときは、開始から見積（15分）ぶん遡って入れる（出どころ「見積」）',
    p5['ok'] and len(p5['stops']) == 1 and p5['stops'][0]['minutes'] == 15
    and p5['stops'][0]['endFrom'] == sc.MANUAL_END_FROM_ESTIMATE and p5['stops'][0]['endAt'] == NOW.isoformat(timespec='minutes'),
    p5['stops'])

# ---- 9・10: 通常モード・読み替え ----
put('N', '作業', 'LN', eq='通常試験設備')
c.commit()
outn = sc._expand_plan_with(c, mc, '通常試験設備', NOW, sr.plan_rows(c, '通常試験設備'), actual_index={})
rec('通常モードの設備は一番上のロットを答えない（今までどおり、どのロットからでも開始できる）',
    outn['runMode'] == 'normal' and outn['strictTop'] is None, (outn['runMode'], outn['strictTop']))
rec('運用モードの読み替え: 鍵・呼び名を受け、空・知らない字は通常（保存は空）',
    (mr.normalize_run_mode('strict'), mr.normalize_run_mode('厳密'), mr.normalize_run_mode('通常'), mr.normalize_run_mode('x'))
    == ('strict', 'strict', '', ''))
rec('設備マスタに登録の無い設備は通常', mr.read_equipment_run_mode(mc, '知らない設備') == 'normal')

# ---- 11: 作業スケジュールから切り替える（§9.592） ----
n = mr.write_equipment_run_mode(mc, '通常試験設備', 'strict', 'tester')
rec('11: 切り替えると設備マスタの運用モードが変わる（通常→厳密→通常）',
    n == 1 and mr.read_equipment_run_mode(mc, '通常試験設備') == 'strict'
    and mr.write_equipment_run_mode(mc, '通常試験設備', 'normal', 'tester') == 1
    and mr.read_equipment_run_mode(mc, '通常試験設備') == 'normal', n)
raw = mc.execute('SELECT [運用モード],[更新者ID] FROM [設備マスタ] WHERE [設備名]=?', ['通常試験設備']).fetchone()
rec('11: 通常の保存値は空（設備マスタの窓と同じ正規化）・更新者を残す', tuple(raw) == ('', 'tester'), tuple(raw))
bad = []
for args in (('知らない設備', 'strict'), ('通常試験設備', '厳しい'), ('', 'strict')):
    try:
        mr.write_equipment_run_mode(mc, args[0], args[1], 'tester')
        bad.append(args)
    except ValueError:
        pass
rec('11: 設備マスタに無い設備・語彙に無い字は断る（ValueError＝400）', not bad, bad)
from backend.routes import schedule as rs  # noqa: E402 切り替えてよい端末の答え（1箇所）を直に問う


def allowed(mode, flags, eq='通常試験設備'):
    rs.get_mode = lambda: mode
    rs.current_permission_flags = lambda: flags
    return rs.line_ops_allowed(eq)


grid = {
    'スケジュールモード': allowed('schedule', {}),
    '閲覧モード': allowed('view', {'canSchedule': True}),
    '編集・権限なし': allowed('edit', {'canSchedule': False, 'canFieldReorder': False}),
    '編集・スケジュール可否': allowed('edit', {'canSchedule': True}),
    '編集・現場段取り（この設備）': allowed('edit', {'canFieldReorder': True, 'fieldReorderEquipment': '通常試験設備'}),
    '編集・現場段取り（ほかの設備）': allowed('edit', {'canFieldReorder': True, 'fieldReorderEquipment': '厳密試験設備'}),
}
rec('11: 切り替えてよいのは並べ替えできる端末だけ（スケジュール／スケジュール可否／その設備の現場段取り）',
    grid == {'スケジュールモード': True, '閲覧モード': False, '編集・権限なし': False, '編集・スケジュール可否': True,
             '編集・現場段取り（この設備）': True, '編集・現場段取り（ほかの設備）': False}, grid)

ok = sum(R)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
