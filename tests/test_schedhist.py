#!/usr/bin/env python3
"""test_schedhist.py: 作業スケジュールの過去履歴（§9.502）——記録を1つも取りこぼさない。

============================================================
利用者の指示
------------------------------------------------------------
「作業スケジュールの過去履歴を見る機能」「設備停止も含んだ形で記録のすべてを残し、
 フィルタなども検索しやすいように」（案A＝段「履歴」）。

物差し（**直す前にも同じ物差しで測る**）:
 A. 見える記録の数 … 予定の表に残っている「起きたこと」の記録（下の9件）のうち、
    画面から見えるもの。前＝作業スケジュールの「さかのぼり: すべて残す」、後＝履歴。
 B. 区分と時刻の出どころが正しい数（9件中）
 C. いまの予定・並びの目印（予定・着手の作業／いまの設備停止／日付・直の枠／子ロット）を
    履歴に**出さない**
 D. 日ごとの件数（暦の材料）と期間の絞り込み
 E. 全期間から探す（ロット番号・名称・内訳・担当…。空白で区切った語はすべて当たるもの）

**材料は自分で作る**（一時フォルダの共有DB・設定DB）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import json
import pathlib
import sys
import tempfile
from datetime import date, datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import schedule_calc as sc, schedule_history as sh  # noqa: E402 パスを通してから読む
from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


EQ = '履歴試験設備'
NOW = datetime.now().replace(microsecond=0)
# 記録の時刻は**その日の10:00（1直）を起点に固定**する。「いま」から作ると、夜中に回したとき
# だけ3直（日付補正 −1）に入って現場歴の日付が1日ずれ、時計しだいで落ちる網になる（実際に踏んだ）。
BASE = NOW.replace(hour=10, minute=0, second=0)
D1 = BASE - timedelta(days=1)         # 昨日の10:00。足しても 18:00 まで（1直・2直＝同じ現場歴の日）
D5 = BASE - timedelta(days=5)
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_hist_'))
c = connect(tmp / 'schedule.sqlite3', False)
mc = connect(tmp / 'master.sqlite3', False)
sr.ensure_plan_table(c)
sr.ensure_plan_table(c)   # 作った直後は後から足した列（実績JSON等）がまだ無い。2回目で足す
# 勤務は3交代（3直は日を跨ぐ・日付補正 −1＝跨いだ後は前の日の現場歴）。**現場歴の網のために自分で置く**。
_pid, _ = sr.shift_pattern_upsert(mc, None, [], '3交代', 'tests')
sr.shift_segment_sync(mc, _pid, [{'name': '1直', 'start': '07:00', 'end': '15:00'},
                                 {'name': '2直', 'start': '15:00', 'end': '23:00'},
                                 {'name': '3直', 'start': '23:00', 'end': '07:00', 'dayOffset': -1}], 'tests')
mc.commit()


def fmt(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def put(key, kind, *, lot='', casting='', material='', title='', state='予定', active=1,
        created=None, updated=None, est=None, detail=None, parent=None, actual_json=None, remark=''):
    d = dict(detail or {})
    if lot:
        d.setdefault('lotNo', lot)
    if casting:
        d.setdefault('castingNo', casting)
    if material:
        d.setdefault('mfgMaterial', material)
    cur = c.cursor()
    cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[鋳造番号],[予定名称],[明細JSON],'
                '[見積分],[状態],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時],[親予定ID],[登録端末名],'
                '[更新端末名],[実績JSON],[備考]) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                [EQ, len(IDS) + 1, kind, lot, casting, title, json.dumps(d, ensure_ascii=False), est, state, active,
                 'u_add', 'u_upd', fmt(created or D1), fmt(updated or created or D1), parent, 'PC1', 'PC2',
                 actual_json, remark])
    c.commit()
    IDS[key] = cur.lastrowid
    return cur.lastrowid


IDS = {}
# ---- 記録（履歴に出るべきもの。ここの8件＋下の計画外の実績1件＝9件） ----
put('done', '作業', lot='H001', casting='C1', material='A5052')                 # 測定データで完了
put('cancel', '作業', lot='H002', casting='C2', material='A5052', state='取消', updated=D1 + timedelta(hours=1))
put('removed', '作業', lot='H003', casting='C3', material='A5052', active=0, updated=D1 + timedelta(hours=2))
put('stop', '設備停止', title='刃交換', est=30, active=0, created=D1, updated=D1 + timedelta(hours=3),
    detail={'stopSub': '上刃', 'stopSub2': '研磨済み'})
put('cmt', 'コメント', title='次は幅狭', created=D1 + timedelta(hours=4))
put('cmt_off', 'コメント', title='取り消した申し送り', active=0, created=D5)
put('saved', '作業', lot='H004', casting='C4', material='A5052',
    actual_json=json.dumps({'values': {'ロット番号': 'H004'}, 'finishedAt': fmt(D5 + timedelta(hours=1)),
                            'joinName': '前工程実績'}, ensure_ascii=False))
put('done_off', '作業', lot='H005', casting='C5', material='A5052', active=0, updated=D1 + timedelta(hours=6))
# ---- 履歴に出してはいけないもの ----
put('plan', '作業', lot='H006', casting='C6', material='A5052')                 # いまの予定
put('stop_now', '設備停止', title='清掃', est=20)                                 # いまの設備停止
put('frame', '枠', detail={'frameDate': NOW.date().isoformat(), 'frameShift': '1直'})
put('child', '作業', lot='H001-1', parent=IDS['done'])                          # 子ロット（親に束ねる）

ACT = {}


def actual(key, lot, casting, start, end, eq=EQ, rid=None):
    k = (sc.normalize_match_key(lot), sc.normalize_match_key(casting), sc.normalize_match_key('A5052'))
    ACT[k] = {'id': rid or ('R' + lot), 'startAt': start.isoformat(), 'endAt': end.isoformat() if end else None,
              'updatedAt': '', 'equipment': eq, 'status': '完了' if end else '', 'key': k,
              'basic': {'lotNo': lot, 'castingNo': casting, 'mfgMaterial': 'A5052'},
              'createdBy': 'tanaka', 'createdPc': 'PC9', 'updatedBy': '', 'updatedPc': '', 'createdAt': ''}


actual('done', 'H001', 'C1', D1, D1 + timedelta(minutes=105))
actual('done_off', 'H005', 'C5', D1 + timedelta(hours=5), D1 + timedelta(hours=5, minutes=40))
actual('unplanned', 'H099', 'C99', D1 + timedelta(hours=7), D1 + timedelta(hours=8))   # 予定に無い実績
actual('other_eq', 'H098', 'C98', D1, D1 + timedelta(hours=1), eq='ほかの設備')           # ほかの設備は出さない

EXPECT = {  # 記録 → (区分, 時刻の出どころ)
    'done': ('done', '測定データの実績'), 'cancel': ('cancel', '状態を変えた日時'),
    'removed': ('removed', '外した日時'), 'stop': ('stop', '外した日時'),
    'cmt': ('comment', '書いた日時'), 'cmt_off': ('comment', '書いた日時'),
    'saved': ('done', '完了突合（前工程実績）'), 'done_off': ('done', '測定データの実績'),
    'unplanned': ('unplanned', '測定データの実績'),
}
NOT_HISTORY = ['plan', 'stop_now', 'frame', 'child']

# ---- A. 前: 作業スケジュールの「さかのぼり: すべて残す」で見える記録 ----
try:
    before = sc._expand_plan_with(c, mc, EQ, NOW, sr.plan_rows(c, EQ), actual_index=ACT, history='all')
    seen = {str(e['id']) for e in before['entries']}
    seen_before = [k for k in EXPECT if (str(IDS.get(k)) in seen) or
                   (k == 'unplanned' and any(str(e.get('lotNo')) == 'H099' for e in before['entries']))]
except Exception as e:  # 前の値を測れないときは測れないと言う
    seen_before = None
    print('  前の値を測れませんでした: %s' % e)

# ---- 後: 履歴 ----
out = sh.history(c, mc, EQ, (NOW - timedelta(days=30)).date(), NOW.date(), keys=['lotNo'], actual_index=ACT)
by_id = {str(e['id']): e for e in out['entries']}


def find(k):
    if k == 'unplanned':
        return next((e for e in out['entries'] if e['cat'] == 'unplanned' and e['lotNo'] == 'H099'), None)
    return by_id.get(str(IDS[k]))


seen_after = [k for k in EXPECT if find(k)]
print('#MEASURE ' + json.dumps({'records': len(EXPECT),
                                'before': None if seen_before is None else len(seen_before),
                                'after': len(seen_after),
                                'before_keys': seen_before, 'after_keys': seen_after}, ensure_ascii=False))
rec('A: 記録はどれも履歴に出る（%d件中%d件・前は%s件）' % (len(EXPECT), len(seen_after),
                                                        '測れず' if seen_before is None else len(seen_before)),
    len(seen_after) == len(EXPECT), json.dumps(sorted(set(EXPECT) - set(seen_after)), ensure_ascii=False))

bad = []
for k, (cat, src) in EXPECT.items():
    e = find(k)
    if e and (e['cat'] != cat or e['atSource'] != src):
        bad.append('%s: %s/%s' % (k, e['cat'], e['atSource']))
rec('B: 区分と時刻の出どころが正しい（%d件中%d件）' % (len(EXPECT), len(EXPECT) - len(bad)), not bad, '；'.join(bad))

e = find('done')
rec('B: 測定データの実績は開始〜終了と所要（105分）と担当を持つ',
    bool(e) and e['minutes'] == 105.0 and e['who'] == 'tanaka' and e['start'] and e['end'],
    json.dumps({k: e.get(k) for k in ('start', 'end', 'minutes', 'who')} if e else None, ensure_ascii=False))
rec('B: 子ロットは親の1件に束ねる', bool(e) and e['children'] == ['H001-1'], str(e and e['children']))
e = find('stop')
rec('B: 設備停止は内訳・見積の分・入れた日時と外した日時を持つ（実際の開始は持たないので出さない）',
    bool(e) and e['subText'] == '上刃／研磨済み' and e['minutes'] == 30 and e['createdAt'] and e['removedAt']
    and e['start'] is None,
    json.dumps({k: e.get(k) for k in ('subText', 'minutes', 'createdAt', 'removedAt', 'start')} if e else None,
               ensure_ascii=False))
e = find('done_off')
rec('B: 完了してから外した作業は「完了」のまま、外したことも持つ', bool(e) and e['cat'] == 'done' and e['removed'],
    str(e and (e['cat'], e['removed'])))
rec('B: 明細は画面が出す列だけ運ぶ', bool(find('done')) and set(find('done')['detail']) == {'lotNo'},
    str(find('done') and find('done')['detail']))

leak = [k for k in NOT_HISTORY if str(IDS[k]) in by_id]
leak += ['ほかの設備の実績'] if any(e['lotNo'] == 'H098' for e in out['entries']) else []
rec('C: いまの予定・いまの設備停止・枠・子ロット・ほかの設備は履歴に出さない', not leak, str(leak))

d1 = (D1 + timedelta(days=0)).date().isoformat()
rec('D: 日ごとの件数（暦の材料）を区分ごとに返す', out['days'].get(d1, {}).get('done', 0) >= 2,
    json.dumps(out['days'].get(d1), ensure_ascii=False))
one = sh.history(c, mc, EQ, D5.date(), D5.date(), keys=[], actual_index=ACT)
cats = sorted(e['cat'] for e in one['entries'])
rec('D: 期間で絞れる（5日前の1日だけ＝申し送り1件・完了突合1件）', cats == ['comment', 'done'], str(cats))
rec('D: 期間の外の日も暦の件数には数える', d1 in one['days'], str(sorted(one['days'])))
rec('D: 日時の分からない記録は0件（黙って落としていない）', out['undated'] == 0, str(out['undated']))
night = datetime.combine(NOW.date(), datetime.min.time()).replace(hour=2)   # 3直（23:00〜翌7:00）の途中
dflt = sh.history(c, mc, EQ, keys=[], actual_index=ACT, now=night)
want = (night.date() - timedelta(days=1)).isoformat()
rec('D: 期間を渡さなければ「現場歴の今日」（夜中の2時＝3直の途中は前の日）',
    dflt['from'] == dflt['to'] == dflt['today'] == want, '%s〜%s today=%s（期待 %s）' % (dflt['from'], dflt['to'], dflt['today'], want))
wide = sh.history(c, mc, EQ, (NOW - timedelta(days=200)).date(), NOW.date(), keys=[], actual_index=ACT)
rec('D: 期間は%d日までに切り詰め、切ったことを言う' % sh.MAX_DAYS,
    wide['clipped'] and (date.fromisoformat(wide['to']) - date.fromisoformat(wide['from'])).days + 1 == sh.MAX_DAYS,
    '%s〜%s clipped=%s' % (wide['from'], wide['to'], wide['clipped']))

# ---- E. 全期間から探す（期間を見ない・AND・担当や内訳でも当たる） ----
q1 = sh.history(c, mc, EQ, NOW.date(), NOW.date(), keys=['lotNo'], actual_index=ACT, query='h00', anywhere=True)
rec('E: 語を渡すと期間を見ずに全期間から探す（今日1日の期間でも昨日・5日前の記録が当たる）',
    sorted(e['lotNo'] for e in q1['entries']) == ['H001', 'H002', 'H003', 'H004', 'H005'] and q1['found'] == 5,
    str(sorted(e['lotNo'] for e in q1['entries'])))
q2 = sh.history(c, mc, EQ, NOW.date(), NOW.date(), keys=[], actual_index=ACT, query='刃交換 研磨', anywhere=True)
rec('E: 空白で区切った語はすべて当たるもの（AND）。設備停止の内訳でも当たる',
    [e['cat'] for e in q2['entries']] == ['stop'], str([e['cat'] for e in q2['entries']]))
q3 = sh.history(c, mc, EQ, NOW.date(), NOW.date(), keys=[], actual_index=ACT, query='tanaka', anywhere=True)
q4 = sh.history(c, mc, EQ, D5.date(), D5.date(), keys=[], actual_index=ACT, query='h00', anywhere=False)
rec('E: 期間の中だけで探すこともできる（5日前の1日＝完了突合の H004 だけ）',
    [e['lotNo'] for e in q4['entries']] == ['H004'], str([e['lotNo'] for e in q4['entries']]))
rec('E: 担当（測定した人）でも当たる（試験の実績はどれも tanaka が測った＝計画外の H099 も当たる）',
    sorted(e['lotNo'] for e in q3['entries']) == ['H001', 'H005', 'H099'],
    str(sorted(e['lotNo'] for e in q3['entries'])))

# ---- F. 実績1件は予定の行1本にだけ当たる（外して入れ直した・ほかの設備へ移した） ----
# 物差し: 同じ実績を2本以上の行が「完了」として持つ数（前＝外した行にも当てていたので2件）と、
# 外したあとに始めた作業が外した行へ「完了」で付く数。**直す前にも同じ物差しで測った**（前 1・2）。
put('redo_off', '作業', lot='K007', casting='C7', material='A5052', active=0,
    created=D1 - timedelta(days=2), updated=D1 + timedelta(hours=1))     # 作業の前に外した
put('redo', '作業', lot='K007', casting='C7', material='A5052', created=D1 + timedelta(hours=1))  # 入れ直した
put('moved_off', '作業', lot='K008', casting='C8', material='A5052', active=0,
    created=D1 - timedelta(days=2), updated=D1 + timedelta(hours=1))     # 外して、ほかの設備で作業した
for lot, casting, eq in (('K007', 'C7', EQ), ('K008', 'C8', 'ほかの設備')):
    actual(lot, lot, casting, D1 + timedelta(hours=2), D1 + timedelta(hours=3), eq=eq)
    ACT[(sc.normalize_match_key(lot), sc.normalize_match_key(casting), sc.normalize_match_key('A5052'))]['createdBy'] = 'suzuki'
fo = sh.history(c, mc, EQ, (NOW - timedelta(days=30)).date(), NOW.date(), keys=[], actual_index=ACT)
fid = {str(e['id']): e for e in fo['entries']}
held = {}
for e in fo['entries']:
    if e['cat'] == 'done' and e.get('recordId'):
        held[e['recordId']] = held.get(e['recordId'], 0) + 1
dup = sum(1 for n in held.values() if n > 1)
late = [k for k in ('redo_off', 'moved_off') if (fid.get(str(IDS[k])) or {}).get('cat') == 'done']
print('#MEASURE ' + json.dumps({'actual_held_by_2_rows': dup, 'removed_before_work_as_done': len(late)},
                               ensure_ascii=False))
rec('F: 実績1件を「完了」で持つ行は1本だけ（同じ作業時間を2回数えない）', dup == 0, json.dumps(held))
e = fid.get(str(IDS['redo']))
rec('F: 入れ直した行が実績を持つ（完了・60分）', bool(e) and e['cat'] == 'done' and e['minutes'] == 60.0,
    str(e and (e['cat'], e['minutes'])))
rec('F: 作業の前に外した行・ほかの設備で作業した行は「外した作業」のまま',
    [(fid.get(str(IDS[k])) or {}).get('cat') for k in ('redo_off', 'moved_off')] == ['removed', 'removed'],
    str(late))
day_min = sum((x.get('minutes') or 0) for x in fo['entries'] if x['cat'] == 'done' and x['lotNo'] == 'K007')
rec('F: K007 の作業時間の合計は60分（前は外した行のぶんも足して120分）', day_min == 60.0, str(day_min))

# ---- G. 見積の分を持たない設備停止・全角で探す（§9.502の追補3） ----
# 設備停止を分を渡さずに入れた行（古い行・分を渡さない入れ方）は[見積分]が空のまま残る。いまの予定の画面は
# 停止理由の標準か既定の分で数えるが、履歴は空のまま出し、期間の合計からも抜けていた。
put('stop_noest', '設備停止', title='G試験停止', est=None, active=0, created=D5, updated=D5 + timedelta(hours=1))
g = sh.history(c, mc, EQ, D5.date(), D5.date(), keys=[], actual_index=ACT)
ge = next((x for x in g['entries'] if x['id'] == IDS['stop_noest']), None)
print('#MEASURE ' + json.dumps({'stop_noest_minutes': ge and ge['minutes'],
                                'source': ge and ge.get('minutesSource')}, ensure_ascii=False))
rec('G: 見積の分を持たない設備停止も、いまの予定と同じ見積で数え、出どころを言う（既定の分）',
    bool(ge) and ge['minutes'] == sc.DEFAULT_ESTIMATE_MINUTES and '既定' in (ge.get('minutesSource') or ''),
    json.dumps(ge and {k: ge.get(k) for k in ('minutes', 'minutesSource')}, ensure_ascii=False))
e = find('stop')
rec('G: 入れたときに分を持っていた設備停止はその分のまま（出どころは空＝入れたときの見積）',
    bool(e) and e['minutes'] == 30 and not e.get('minutesSource'), str(e and (e['minutes'], e.get('minutesSource'))))
qz = sh.history(c, mc, EQ, NOW.date(), NOW.date(), keys=['lotNo'], actual_index=ACT, query='Ｈ００１', anywhere=True)
print('#MEASURE ' + json.dumps({'fullwidth_hits': [x['lotNo'] for x in qz['entries']]}, ensure_ascii=False))
rec('G: 全角で打っても当たる（Ｈ００１ → H001）', [x['lotNo'] for x in qz['entries']] == ['H001'],
    str([x['lotNo'] for x in qz['entries']]))

c.close()
mc.close()
print('\n%d/%d PASS' % (sum(R), len(R)))
sys.exit(0 if all(R) else 1)
