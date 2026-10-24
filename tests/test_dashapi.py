#!/usr/bin/env python3
"""test_dashapi.py: ダッシュボードの API（§9.628。LotScope のグリッドのパネルの移植）。

============================================================
利用者の指示
------------------------------------------------------------
「別リポジトリのLotScopeのダッシュボードがとても優秀なので、その多機能なダッシュボードを移植してください。」
前の生産管理ダッシュボード（稼働状況・自設備・自由集計）は、組み込みのダッシュボードとして作り直す（機能を減らさない）。

ここで固定すること:
 1. 元の並び（測定データ・作業予定・データソース）と役割 → 元の鍵（組み込みは role: で書く）
 2. 組み込みの4つ（標準・稼働状況・自設備・作業時間の分析）が並び、★が無ければ「標準」が開く
 3. **物差し**: 組み込みのパネルのうち、数を返したパネルの数（全部のパネル・理由つき）。5xx は 0
 4. 測定データの列（作業開始・作業時間（分）・設備名…）と特別な段（設備・設備グループ・作業日・直）
 5. 保存: 名前は置き場ごとに1つ・★は置き場ごとに1つ・古い版で直すと 409・消す
 6. 組み込みを外す・戻す／セット／設備グループの作る・直す・消す
 7. 閲覧モードでも数は読める（読むだけの POST）。保存は断る
**自分が作った行だけ**を片付ける（finally）。
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
from backend.dashboard import answer, layout, sources  # noqa: E402 パスを通してから読む

R = []
client = flask_app.app.test_client()
TAG = 'DASHAPI'
# 「いま」はきょうの昼に止める。記録は 07:00〜10:30 に置くので、壁時計のままだと夜明け前（0時〜現場日の始まり）は
# 記録が「まだ来ない時刻」・前の作業日に入り、作業日の段とガントと平均が数えられなかった（UTC 0:05 と 1:25 に落ちた）
NOW = datetime.now().replace(hour=12, minute=0, second=0, microsecond=0)


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def mode(m):
    r = client.post('/api/access-mode', json={'mode': m})
    return r.status_code == 200


def check_sources():
    j = client.get('/api/dashboard/sources').get_json() or {}
    keys = [x['key'] for x in j.get('items') or []]
    rec('元の並び: 測定データ → 作業予定 → データソース', keys[:2] == ['rec', 'plan'] and any(k.startswith('src:') for k in keys), keys)
    rec('役割 → 元の鍵（仕掛）', str((j.get('roles') or {}).get('仕掛') or '').startswith('src:'), j.get('roles'))
    rec('自設備の印を画面へ渡す', j.get('mine') == layout.MINE)


def check_list():
    j = client.get('/api/dashboards').get_json() or {}
    ids = [x['id'] for x in j.get('items') or [] if x.get('builtin')]
    rec('組み込みの5つが並ぶ（生産の状況が先頭・§9.630 ④）', ids == ['b:home', 'b:status', 'b:standard', 'b:mine', 'b:analysis'], ids)
    rec('★が無ければ組み込みの「生産の状況」が開く（§9.630 ④）', j.get('standardId') == layout.BUILTIN_DEFAULT == 'b:home', j.get('standardId'))
    return [x for x in j.get('items') or [] if x.get('builtin')]


def query(p):
    r = client.post('/api/dashboard/query', json={'panel': p})
    return r.status_code, r.get_json() or {}


def _answered(st, a):
    if st != 200:
        return False
    if 'groups' in a:
        return all('cells' in g for g in a['groups'])
    return 'cells' in a or 'equips' in a


def _as_screen(p, mine):
    """画面と同じ置き換え（自設備＝この端末の使用設備・static/js/dash/dashboard.js）"""
    s = json.dumps(p, ensure_ascii=False).replace(json.dumps(layout.MINE), json.dumps(mine, ensure_ascii=False))
    return json.loads(s)


def check_panels(items):
    """物差し: 組み込みのパネルのうち、数を返したパネルの数（理由つき）。5xx は 0"""
    total, ok, bad, crash, took = 0, 0, [], [], []
    for d in items:
        for p in d['body']['panels']:
            if p.get('visual') == 'slicer':
                continue
            total += 1
            t0 = time.perf_counter()
            st, a = query(_as_screen(p, 'テスト設備A'))
            took.append((time.perf_counter() - t0, f"{d['name']}/{p['title']}"))
            if _answered(st, a):
                ok += 1
            else:
                errs = [g.get('error') for g in a.get('groups') or [] if 'cells' not in g] if 'groups' in a else [a.get('error')]
                bad.append(f"{d['name']}/{p['title']}: {st} {errs}")
            if st >= 500:
                crash.append(p['title'])
    print(f'  物差し: 組み込みのパネル {ok}/{total} が数を返した')
    # 物差し: 数え時間（1回目＝写しを作る・答えの控えなし）。遅い順に5つ
    print('  物差し: 数え時間（遅い順）: ' + ' / '.join(f'{n} {t:.2f}秒' for t, n in sorted(took, reverse=True)[:5]))
    for b in bad:
        print('   - ' + b)
    rec('組み込みのパネルで 5xx は 0', not crash, crash)
    rec('組み込みのパネルはどれも数を返す（理由は上）', ok == total, f'{ok}/{total}')


def check_fields():
    j = client.post('/api/dashboard/fields', json={'source': 'rec'}).get_json() or {}
    cols = [f['column'] for f in j.get('fields') or []]
    special = [x['column'] for x in j.get('special') or []]
    want = ['作業開始', '作業終了', '作業時間（分）', '設備名', '状態', '品種', '作業日']
    rec('測定データの列（芯の列）', all(c in cols for c in want), [c for c in want if c not in cols])
    rec('特別な段（設備・設備グループ・作業日・直）', special == ['@equip', '@egroup', '@workday', '@shift'], special)


def _mk(name, scope='me', standard=False):
    r = client.post('/api/dashboards', json={'name': name, 'scope': scope, 'standard': standard,
                                             'body': {'rows': 8, 'panels': [{'id': 'a', 'x': 0, 'y': 0, 'w': 4, 'h': 2, 'title': 't', 'visual': 'kpi',
                                                                             'source': 'rec', 'body': {'measures': [{'agg': 'lots'}]}}]}})
    return r.status_code, r.get_json() or {}


def check_save(made):
    st, a = _mk(TAG + '1', standard=True)
    rec('自分だけに置ける（201）', st == 201 and a.get('scope') == 'me', (st, a.get('error')))
    if st != 201:
        return
    made.append(a['id'])
    st2, _ = _mk(TAG + '1')
    rec('同じ置き場に同じ名前は置けない（400）', st2 == 400, st2)
    st3, b = _mk(TAG + '2', standard=True)
    if st3 == 201:
        made.append(b['id'])
    j = client.get('/api/dashboards').get_json() or {}
    stars = [x['id'] for x in j['items'] if x.get('standard') and x['scope'] == 'me']
    rec('★は置き場ごとに1つ（後から立てた物）', stars == [b.get('id')], stars)
    rec('自分の★が開く', j.get('standardId') == b.get('id'), j.get('standardId'))
    r = client.put(f"/api/dashboards/{a['id']}", json={'name': TAG + '1b', 'base_rev': a['rev'] + 5})
    rec('古い版で直すと 409（今の行を返す）', r.status_code == 409 and (r.get_json() or {}).get('current'), r.status_code)
    rev = next(x['rev'] for x in (client.get('/api/dashboards').get_json() or {})['items'] if x['id'] == a['id'])   # ★を降ろした分も版が上がる
    r = client.put(f"/api/dashboards/{a['id']}", json={'name': TAG + '1b', 'base_rev': rev})
    rec('今の版なら直せる（版が上がる）', r.status_code == 200 and (r.get_json() or {}).get('rev', 0) > rev, r.status_code)


def check_hidden_and_sets(made):
    r = client.put('/api/dashboards-hidden', json={'scope': 'me', 'keys': ['analysis']})
    j = client.get('/api/dashboards').get_json() or {}
    rec('組み込みを自分の一覧から外せる', r.status_code == 200 and 'b:analysis' not in [x['id'] for x in j['items']]
        and [h['id'] for h in j.get('hidden') or []] == ['b:analysis'], r.status_code)
    client.put('/api/dashboards-hidden', json={'scope': 'me', 'keys': []})
    j = client.get('/api/dashboards').get_json() or {}
    rec('外した組み込みを戻せる', 'b:analysis' in [x['id'] for x in j['items']])
    r = client.post('/api/dashboard-sets', json={'name': TAG + 'S', 'scope': 'me', 'body': {'items': ['b:standard', 'b:status']}})
    s = r.get_json() or {}
    rec('セットを置ける', r.status_code == 201 and s.get('body', {}).get('items') == ['b:standard', 'b:status'], (r.status_code, s.get('error')))
    if r.status_code == 201:
        client.delete(f"/api/dashboard-sets/{s['id']}")


def check_groups():
    r = client.post('/api/masters/equipgroups', json={'name': TAG + 'G', 'set': TAG + 'まとめ', 'equipment': ['テスト設備A']})
    j = r.get_json() or {}
    gid = j.get('created')
    rec('設備グループを作れる', r.status_code == 201 and gid, (r.status_code, j.get('error')))
    if not gid:
        return
    try:
        r2 = client.post('/api/masters/equipgroups', json={'name': TAG + 'G', 'set': TAG + 'まとめ', 'equipment': ['テスト設備B']})
        rec('同じまとめ方に同じ名前は作れない（400）', r2.status_code == 400, r2.status_code)
        tree = client.get('/api/dashboard/equip-tree').get_json() or {}
        hit = next((s for s in tree.get('sets') or [] if s['name'] == TAG + 'まとめ'), None)
        rec('スライサーの設備の木にグループが出る', bool(hit) and hit['groups'][0]['members'] == ['テスト設備A'], hit)
        # マスタ管理の画面の約束（§9.82: 直すのは POST /update・id は本文）。決まりは1行に1つの字で直せる
        r3 = client.post('/api/masters/equipgroups/update', json={'id': gid, 'rulesText': 'テスト設備 で始まる'})
        row = next((x for x in (r3.get_json() or {}).get('items') or [] if x['id'] == gid), {})
        rec('決まりを字で直せる（1行に1つ）', r3.status_code == 200 and row.get('rules') == [{'op': 'prefix', 'value': 'テスト設備'}]
            and row.get('rulesText') == 'テスト設備 で始まる', (r3.status_code, row.get('rules'), (r3.get_json() or {}).get('error')))
        r4 = client.post('/api/masters/equipgroups/update', json={'id': gid, 'rulesText': 'テスト設備'})
        rec('比べ方の無い決まりは断る（400・例を言う）', r4.status_code == 400 and '例' in ((r4.get_json() or {}).get('error') or ''), r4.status_code)
        r5 = client.post('/api/masters/equipgroups/update', json={'id': gid, 'equipment': '*'})
        rec('「すべての設備」はグループに入れない（400）', r5.status_code == 400, r5.status_code)
    finally:
        r = client.post('/api/masters/equipgroups/delete', json={'id': gid})
        rec('設備グループを消せる（POST /delete）', r.status_code == 200 and gid not in [x['id'] for x in (r.get_json() or {}).get('items') or []], r.status_code)


def _item(i, status, start, end, minutes, crew, equipment='テスト設備A', weight=None):
    return {'id': f'{TAG}{i}', 'equipment': equipment, 'lotNo': f'L{i}', 'status': status, 'workStart': start, 'workEnd': end,
            'durationMin': minutes, 'workDate': start[:10], 'shift': '', 'updatedAt': start, 'updatedAtDb': start,
            'basic': {'purposeName': '用途X'}, 'settings': {'crewSize': crew, 'operator': '検査太郎', 'verticalCount': 2, 'horizontalCount': 3},
            'opData': {'良品重量': weight} if weight is not None else {}, 'mother': {}, 'product': {}, 'qualityGrades': {},
            'source': {'BOX実績_良品重量': 999} if weight is None else {}, 'readable': True}


def check_rec_values():
    """測定データの写しの中身: 作業の記録を3件（完了2・編集中1）入れて、数・平均・作業日・ガントを数える。
    検証用のデータに記録が無いので、実績データリストの読み口（actuals.rows）を差し替える（finally で戻す）"""
    day = NOW.strftime('%Y-%m-%d')
    items = [_item(1, '完了', f'{day} 08:00:00', f'{day} 08:30:00', 30.0, '2', weight=300), _item(2, '完了', f'{day} 09:00:00', f'{day} 10:00:00', 60.0, '3', weight=600),
             _item(3, '編集中', f'{day} 10:30:00', '', None, '2'), _item(4, '完了', f'{day} 07:00:00', f'{day} 08:30:00', 90.0, '2', 'テスト設備B')]
    keep = sources.actuals.rows
    sources.actuals.rows = lambda *a, **k: items
    answer.forget()
    try:
        base = {'source': 'rec', 'equips': ['テスト設備A'], 'filters': [{'column': '状態', 'op': 'eq', 'value': '完了'}]}
        st, a = query({**base, 'visual': 'kpi', 'body': {'measures': [{'agg': 'lots'}, {'agg': 'avg', 'column': '作業時間（分）'}]}})
        grand = next((c['v'] for c in a.get('cells') or [] if not c['r'] and not c['c']), None)
        rec('完了の作業の本数と平均作業時間（2本・45分）', st == 200 and grand == [2, 45.0], (st, grand, a.get('error')))
        st, a = query({**base, 'visual': 'none', 'body': {'rows': [{'column': '作業人数'}], 'measures': [{'agg': 'lots'}]}})
        labels = sorted((a.get('labels') or [{}])[0].values())
        rec('作業人数は「N名班」で並ぶ（前の画面と同じ呼び名）', labels == ['2名班', '3名班'], labels)
        st, a = query({**base, 'visual': 'time', 'body': {'rows': [{'column': '@workday'}], 'measures': [{'agg': 'lots'}]},
                       'period': {'column': '@workday', 'kind': 'today'}})
        rec('作業日の段で数えられる（きょう 2本）', st == 200 and any(c['v'] == [2] for c in a.get('cells') or [] if c['r']), (st, a.get('error')))
        st, a = query({'source': 'rec', 'equips': ['テスト設備A'], 'visual': 'gantt', 'body': {'measures': [{'agg': 'count'}]},
                       'period': {'column': '@workday', 'kind': 'today'}})
        eq = (a.get('equips') or [{}])[0]
        rec('ガント: 区間の分かる作業 2本・終わりの無い作業は「いま動いている」か理由つき', st == 200 and eq.get('count') == 3
            and len(eq.get('ops') or []) >= 2, (st, eq.get('count'), len(eq.get('ops') or []), a.get('error')))
        # §9.630 ④: 生産性＝良品重量の合計 ÷ 作業時間の合計（分）× 60 ＝ (300+600)/(30+60)×60 ＝ 600 kg/時（1 行ずつの比の平均ではない）
        home = next(d for d in layout.BUILTIN_LAYOUTS if d['key'] == 'home')
        hp = {x['id']: x for x in home['body']['panels']}
        st, a = query({**hp['monthRate'], 'equips': ['テスト設備A'], 'filters': [{'column': '状態', 'op': 'eq', 'value': '完了'}]})
        grand = next((c['v'] for c in a.get('cells') or [] if not c['r'] and not c['c']), None)
        rec('生産性は合計の比（600 kg/時）', st == 200 and grand == [600.0], (st, grand, a.get('error')))
        st, a = query({**hp['todayWeight'], 'equips': ['テスト設備A']})
        grand = next((c['v'] for c in a.get('cells') or [] if not c['r'] and not c['c']), None)
        rec('本日の良品重量: 操業データの良品重量、無ければ仕掛の BOX実績_良品重量（300+600+999）', st == 200 and grand == [1899.0], (st, grand, a.get('error')))
        st, a = query({**hp['monthAbc'], 'equips': ['テスト設備A']})
        keys = [x.get('parts') for x in ((a.get('all') or {}).get('items') or [])]
        rec('ABC の品種は 用途名 × 丈数 × 条数 の組み合わせ', st == 200 and keys and all(len(k or []) == 3 for k in keys) and ['用途X', '2丈', '3条'] in [[str(v) for v in k] for k in keys],
            (st, keys, a.get('error')))
        # 自設備の平均は全設備の平均と比べる（前の画面の「全設備平均との差」）: 自 45分・全 (30+60+90)/3=60分 → 差 −15分
        mine = next(d for d in layout.BUILTIN_LAYOUTS if d['key'] == 'mine')
        panel = next(p for p in mine['body']['panels'] if p['id'] == 'mineAvg')
        st, a = query(_as_screen(panel, 'テスト設備A'))
        grand = next((c['v'] for c in a.get('cells') or [] if not c['r'] and not c['c']), None)
        names = [m.get('name') for m in a.get('measures') or []]
        rec('自設備の平均作業時間に全設備との差を添える（45・60・差 −15）', st == 200 and grand == [45.0, 60.0, -15.0] and '差（実績−基準）' in names,
            (st, grand, names, a.get('error')))
    finally:
        sources.actuals.rows = keep
        answer.forget()


def _entry(i, kind, state, start, end, a=None, title='', est=60):
    return {'id': i, 'kind': kind, 'state': state, 'lotNo': f'P{i}' if kind == '作業' else '', 'title': title, 'plannedStart': start, 'plannedEnd': end,
            'estimate': {'minutes': est}, 'actual': a, 'overdueMinutes': 0, 'detail': {}, 'parentId': None}


def check_plan_layer():
    """§9.630 ②④: 予定と実績を重ねたガント・いまの作業。作業予定の読み口（plan_rows）を差し替える（finally で戻す）。
    実績は行の実績（手入力・測定データ）、予定はまだ終わっていない行の予定開始〜予定終了"""
    day = NOW.strftime('%Y-%m-%d')
    es = [_entry(1, '作業', '完了', f'{day}T08:00', f'{day}T08:50', {'startAt': f'{day}T08:00', 'endAt': f'{day}T09:00', 'source': '手入力', 'endFrom': '手入力'}),
          _entry(2, '作業', '着手', f'{day}T09:00', f'{day}T12:30', {'startAt': f'{day}T10:00', 'endAt': None}),
          _entry(3, '作業', '予定', f'{day}T12:30', f'{day}T13:30'),
          _entry(4, '設備停止', '予定', f'{day}T13:30', f'{day}T14:00', title='段取り替え')]
    names = list(sources.PLAN_CORE)
    keep = sources.plan_rows
    # 署名は中身から（写しのファイル名になる。中身を変えた 2 回目も新しい写しにする）
    sources.plan_rows = lambda: (sources._sig([names, es]), {'テスト設備A': (names, [sources._plan_core('テスト設備A', e) for e in es])})
    answer.forget()
    try:
        home = next(d for d in layout.BUILTIN_LAYOUTS if d['key'] == 'home')
        hp = {x['id']: x for x in home['body']['panels']}
        st, a = query(hp['planGantt'])
        eq = (a.get('equips') or [{}])[0]
        rec('予定と実績のガント: 実績の棒 2（完了・作業中）', st == 200 and len(eq.get('ops') or []) == 2, (st, eq.get('ops'), a.get('error')))
        rec('予定の枠 3（作業中・予定・設備停止。完了は出さない）', [x[2] for x in eq.get('plans') or []] == ['P2', 'P3', '段取り替え'], eq.get('plans'))
        rec('作業中の予定の枠は 予定開始〜予定開始＋見積（09:00〜10:00）', (eq.get('plans') or [[0, '']])[0][1].endswith('10:00:00'), eq.get('plans'))
        rec('ガントの出どころは実績の出どころも言う', '実績' in str(a.get('sourceName')), a.get('sourceName'))
        rec('実績の出どころを数える（手入力 1・測定データ 1）', eq.get('from') == {'手入力': 1, '測定データ': 1}, eq.get('from'))
        rec('作業中の実績はいままで（印 r）', any(o[5] == 'r' for o in eq.get('ops') or []), eq.get('ops'))
        st, a = query({**hp['planGantt'], 'visual': 'now', 'ops': {}, 'period': None})
        e = (a.get('equips') or [{}])[0]
        cur, nxt = e.get('cur') or {}, e.get('next') or {}
        rec('いまの作業: 作業中のロットと予定完了＝作業開始＋見積（P2・10:00＋60分＝11:00）', st == 200 and cur.get('name') == 'P2' and str(cur.get('end')).endswith('11:00:00'), (st, e, a.get('error')))
        rec('いまの作業: 次の予定（P3）', nxt.get('name') == 'P3', nxt)
        rec('予定と実績のガントの行も、いまの作業を持つ（同じ答え）', ((eq.get('now') or {}).get('cur') or {}).get('name') == 'P2', eq.get('now'))
        # 作業中の予定完了（作業開始＋見積）がいまより後なら、後ろの予定をその分ずらして見せる（§9.630・push_of）:
        # P2 は 10:00＋180分＝13:00。いま 12:00 なので、12:30 からの P3 は 13:30 から
        es[1] = _entry(2, '作業', '着手', f'{day}T09:00', f'{day}T12:00', {'startAt': f'{day}T10:00', 'endAt': None}, est=180)
        answer.forget()
        st, a = query({**hp['planGantt'], 'visual': 'now', 'ops': {}, 'period': None})
        e2 = (a.get('equips') or [{}])[0]
        rec('作業中の予定完了の後ろへ次の予定をずらす（次 P3 13:30〜・ずらし 60分）', str((e2.get('next') or {}).get('start')).endswith('13:30:00') and e2.get('shift') == 60.0, e2)
        st, a = query(hp['planGantt'])
        p3 = [x for x in ((a.get('equips') or [{}])[0].get('plans') or []) if x[2] == 'P3']
        rec('ガントの予定の枠も同じだけずれる（P3 13:30〜14:30）', p3 and p3[0][0].endswith('13:30:00') and p3[0][1].endswith('14:30:00'), p3)
        st, a = query({**hp['planGantt'], 'visual': 'now', 'ops': {}, 'period': None, 'source': 'rec'})
        rec('いまの作業は作業予定でないと理由を言って断る（400）', st == 400 and '作業予定' in str(a.get('error')), (st, a.get('error')))
    finally:
        sources.plan_rows = keep
        answer.forget()


def check_empty_total():
    """1 行も当たらない数字のパネル: 数える物と合計は 0（前は総計のマスが無く、画面が「–」＝分からないと出した）"""
    p = {'visual': 'kpi', 'source': 'plan', 'body': {'rows': [], 'measures': [{'agg': 'count'}, {'agg': 'distinct', 'column': '設備名'}]},
         'filters': [{'column': '状態', 'op': 'eq', 'value': '無い状態_' + TAG}]}
    st, a = query(p)
    cell = next((c for c in a.get('cells') or [] if not c['r'] and not c['c']), None)
    rec('当たる行が無くても総計は 0（件数・種類）', st == 200 and cell is not None and cell['v'] == [0, 0], (st, a.get('error'), cell))


def check_view_mode():
    if not mode('view'):
        rec('閲覧モードへ切り替えられる（この端末の権限）', False)
        return
    try:
        st, a = query({'visual': 'kpi', 'source': 'rec', 'body': {'measures': [{'agg': 'lots'}]}})
        rec('閲覧モードでも数は読める', st == 200 and 'cells' in a, (st, a.get('error')))
        st2, _ = _mk(TAG + 'V')
        rec('閲覧モードでは保存しない（403）', st2 == 403, st2)
    finally:
        mode('edit')


def check_source_state(tmp=None):
    """元の状態（§9.630 ③）: 置き場が空＝unset（選べない）・写しがまだ無い＝copying（選べる）・写しがある＝ready"""
    import tempfile
    from backend import db_mirror
    with tempfile.TemporaryDirectory() as d:
        far = str(pathlib.Path(d) / 'まだ無い元.sqlite3')
        rec('置き場が空の元は unset', sources.source_state('DASHAPI_X', {'path': ''}) == 'unset')
        want = 'copying' if db_mirror.enabled() else 'ready'
        got = sources.source_state('DASHAPI_X', {'path': far})
        rec(f'写しがまだ無い元は {want}（待たずに答える）', got == want, got)
        rec('設備ごとのファイルの元は ready（読めない設備は数えるときに名指し）', sources.source_state('DASHAPI_X', {'path': d, 'pattern': '{設備}.sqlite3'}) == 'ready')


def main():
    flask_app.app.config['DASHBOARD_NOW'] = NOW
    made = []
    try:
        mode('edit')
        check_sources()
        check_source_state()
        items = check_list()
        check_panels(items)
        check_fields()
        check_save(made)
        check_hidden_and_sets(made)
        check_groups()
        check_rec_values()
        check_plan_layer()
        check_empty_total()
        check_view_mode()
    finally:
        for i in made:
            client.delete(f'/api/dashboards/{i}')
        client.put('/api/dashboards-hidden', json={'scope': 'me', 'keys': []})
    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


if __name__ == '__main__':
    main()
