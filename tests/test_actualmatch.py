#!/usr/bin/env python3
"""test_actualmatch.py: 仕掛から消えたロットを「実績」で突き合わせる（§9.364）。

============================================================
利用者の指示
------------------------------------------------------------
「作業スケジュール表に組んだロットが、仕掛データから消えた場合は、作業完了
 または作業開始したものとして扱いたいです。…「仕掛」「品質」に続いて
 「実績」というジャンルを1つ追加します。このデータが設定ある場合、仕掛
 データから消えたロットを「実績」から「ロット番号」と「鋳造番号」と
 「前工程実績_作業終了_日付」の組み合わせで検索し、対象のロットがHITした
 場合、作業完了とし、スケジュールデータにHITした実績データを保存して実績
 データが今度更新されてなくなっても保持できるようにしてください。この
 キーの組み合わせは後から変更できるようにしてほしいです。」

ここで固定すること:
 1. 役割「実績」が語彙にあり、データソース1件に付けられる
 2. 突合キーは**後から変えられる**（既定はロット番号／鋳造番号／
    前工程実績_作業終了_日付。空欄は既定に戻る）
 3. **仕掛に在る**ロットは今までどおり「予定」のまま
 4. **仕掛から消えて実績にHIT** → 完了。HITした実績の行が付く
 5. **仕掛から消えて実績に無い** → 着手（消えた＝少なくとも手は付いている）
 6. HITした実績は**予定へ保存**され、実績データが消えても残る
 7. 判定できないときは**状態を1つも動かさない**（分からないことを
    分かったことにしない）

**材料は自分で用意する**（§9.351）——検証用の実績DB
（`db/test_fixture/sikalotact_test.sqlite3`）は仕掛に**居ない**ロットを
3件だけ持つ。予定は自分で足して、自分で消す。
============================================================
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# noqa: E402 は「ROOT を sys.path へ入れてから import する」ため（ほかの網と同じ作法）。
import app as flask_app                                    # noqa: E402 パスを通してから読む
from backend import db_access, actual_match, schedule_sync  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr       # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
EQ = 'テスト設備A'
TAG = 'AM' + str(pathlib.os.getpid())
made = []
mine = {}


def add_plan(lot, casting, end_date):
    """予定を1件足す。**明細（仕掛行の写し）に突合キーの値を入れる**——
    実運用でも投入時の写しがそのまま鍵になる。

    **予定を足せるのはスケジュールモードだけ**（`_check_session`の関所）。
    editモードのまま呼ぶと403で1件も入らないのに、フィクスチャに元から
    ある同じロットの予定を拾って**通ってしまう**（実際に踏んだ）。
    ここでIDを控え、以降は**自分が足した行だけ**を見る。"""
    r = client.post('/api/schedule/plan/add', json={
        'equipment': EQ, 'kind': '作業', 'lotNo': lot, 'castingNo': casting,
        'title': TAG + lot,
        'detail': {'ロット番号': lot, '鋳造番号': casting,
                   '前工程実績_作業終了_日付': end_date},
        'user_id': 'tests'})
    j = r.get_json() or {}
    if j.get('id'):
        made.append(j['id'])
        mine[lot] = j['id']
    else:
        print('  [add] %s: %s %s' % (lot, r.status_code, j))
    return j


def entries():
    r = client.get('/api/schedule/plan?equipment=' + EQ)
    return (r.get_json() or {}).get('entries') or []


def find(lot):
    """**自分が足した行だけ**を引く。ロット番号で引くと、フィクスチャに
    元からある同じロットの予定に当たる。"""
    pid = mine.get(lot)
    if pid is None:
        return None
    for e in entries():
        if str(e.get('id')) == str(pid):
            return e
    return None


def cleanup():
    try:
        client.post('/api/access-mode', json={'mode': 'schedule'})
    except Exception as e:
        print('  [cleanup] モードを戻せない:', e)
    for pid in made:
        try:
            client.post('/api/schedule/plan/delete', json={'id': pid, 'equipment': EQ,
                                                           'user_id': 'tests'})
        except Exception as e:
            print('  [cleanup]', e)
    # **モードは必ず戻す**（同じ群の後続は編集モードで走る）。
    try:
        client.post('/api/access-mode', json={'mode': 'edit'})
    except Exception as e:
        print('  [cleanup] editへ戻せない:', e)


def main():
    # **予定を足せるのはスケジュールモードだけ**（`_check_session`）。
    # 最後に必ず edit へ戻す（後続の網は編集モードで走る・§9.121）。
    client.post('/api/access-mode', json={'mode': 'schedule'})

    # ---- 1) 役割「実績」が語彙にある ----
    got = (client.get('/api/data-source-master').get_json() or {})
    purposes = got.get('purposes') or []
    rec('役割の語彙に「実績」がある', '実績' in purposes, '/'.join(purposes))
    rec('突合キーの既定をサーバーが答える',
        got.get('matchKeyDefaults') == ['ロット番号', '鋳造番号', '前工程実績_作業終了_日付'],
        str(got.get('matchKeyDefaults')))
    act = [x for x in (got.get('items') or []) if x.get('purpose') == '実績']
    rec('検証用フィクスチャに役割「実績」の行がある', len(act) == 1,
        str([x.get('key') for x in act]))

    # ---- 2) 突合キーは後から変えられる ----
    rec('既定の突合キーが効いている',
        db_access.actual_match_keys() == ['ロット番号', '鋳造番号', '前工程実績_作業終了_日付'],
        str(db_access.actual_match_keys()))
    rec('読点区切りでも読める（手で直した行を捨てない）',
        db_access.parse_match_keys('ロット番号, 鋳造番号') == ['ロット番号', '鋳造番号'])
    rec('空欄は既定へ戻る',
        db_access.parse_match_keys('') == list(db_access.DEFAULT_ACTUAL_MATCH_KEYS))
    rec('読めない値は既定へ倒す（黙って壊れない）',
        db_access.parse_match_keys('[こわれた') == list(db_access.DEFAULT_ACTUAL_MATCH_KEYS))

    # 突合の設定は**定義ごと**に答える（§9.365）。登録が無い現場では
    # データソースマスタ[突合キー]から作った「既定の1件」だけが並ぶ。
    d = actual_match.describe()
    one = (d.get('definitions') or [{}])[0]
    rec('突合の設定を「定義ごと」に答える（既定の1件が名乗っている）',
        d['configured'] and len(d['definitions']) == 1 and one.get('builtin') is True,
        json.dumps({'n': len(d.get('definitions') or []),
                    'name': one.get('name')}, ensure_ascii=False))
    rec('仕掛と実績を実際に読めている',
        d['ready'] and one.get('actualRows', 0) >= 3 and not one.get('actualError'),
        json.dumps({k: one.get(k) for k in ('workRows', 'actualRows', 'workColumns',
                                            'actualColumns', 'actualError')},
                   ensure_ascii=False))
    # **仕掛には無い列がある**（実測: 仕掛は前工程実績_作業終了_日付を持たない）。
    # 在席の判定は「仕掛にも実在する列だけ」で行う、が要件。
    rec('仕掛の在席は「仕掛にも実在する列だけ」で見る',
        one.get('workColumns') == ['ロット番号', '鋳造番号']
        and one.get('actualColumns') == ['ロット番号', '鋳造番号', '前工程実績_作業終了_日付'],
        str(one.get('workColumns')) + ' / ' + str(one.get('actualColumns')))
    # 既定の1件でも、利用者が名指しした列（§9.364の原文）を完了日時に使う。
    rec('既定の1件は「前工程実績_作業終了_日付」を完了日時に使う',
        one.get('finishColumn') == '前工程実績_作業終了_日付',
        str(one.get('finishColumn')))

    # ---- 3) 仕掛に在るロットは動かさない ----
    with db_access.connect(db_access.cfg('SIKALOTNOW')['path'], True) as c:
        alive = c.execute('SELECT [ロット番号],[鋳造番号] FROM [仕掛] '
                          'WHERE [ロット番号]<>"" LIMIT 1').fetchone()
    if not alive:
        rec('仕掛に1件はロットがある（この網の前提）', False, '0件')
        return
    add_plan(str(alive[0]), str(alive[1] or ''), '2026-09-01')
    e = find(str(alive[0]))
    rec('仕掛に在るロットは「予定」のまま',
        bool(e) and e['state'] == '予定' and e.get('missingFromWork') is False,
        json.dumps({'state': e and e.get('state'),
                    'missing': e and e.get('missingFromWork')}, ensure_ascii=False))

    # ---- 4) 消えて実績にHIT → 完了 ----
    add_plan('ACT0001', 'C9001', '2026-09-01')
    hit = find('ACT0001')
    rec('仕掛から消えて実績にHITしたら「完了」',
        bool(hit) and hit['state'] == '完了' and hit.get('missingFromWork') is True
        and bool(hit.get('actualSource')),
        json.dumps({'state': hit and hit.get('state'),
                    'actual': (hit or {}).get('actualSource'),
                    'reason': (hit or {}).get('missingReason')}, ensure_ascii=False)[:220])
    src = (hit or {}).get('actualSource') or {}
    rec('HITした実績の中身がそのまま付く（列を選り好みしない）',
        src.get('前工程実績_設備名') == '前工程1号' and src.get('前工程実績_数量') == 120,
        json.dumps(src, ensure_ascii=False)[:160])
    # 完了時刻(§9.365)。**さかのぼりで隠せるのはここに時刻が入った行だけ**。
    rec('完了日時が「指定した列」から入る',
        str((hit or {}).get('finishedAt') or '').startswith('2026-09-01'),
        str((hit or {}).get('finishedAt')))

    # ---- 5) 消えて実績に無い → 着手 ----
    add_plan(TAG + 'GONE', 'C0000', '2026-09-09')
    gone = find(TAG + 'GONE')
    rec('仕掛から消えて実績にも無ければ「着手」',
        bool(gone) and gone['state'] == '着手' and gone.get('missingFromWork') is True
        and not gone.get('actualSource'),
        json.dumps({'state': gone and gone.get('state'),
                    'reason': (gone or {}).get('missingReason')}, ensure_ascii=False)[:200])

    # ---- 6) HITした実績は予定へ保存され、実績が消えても残る ----
    rec('HITした実績は予定へ保存される',
        bool(hit) and hit.get('actualSourceSaved') is True,
        str((hit or {}).get('actualSourceSaved')))
    saved = ''
    try:
        local, _stale = schedule_sync.fetch_snapshot(force=True)
        with db_access.connect(local, True, 'sqlite') as c:
            row = c.execute('SELECT [%s] FROM [作業予定] WHERE [ロット番号]=?'
                            % sr.PLAN_ACTUAL_JSON_COLUMN, ['ACT0001']).fetchone()
            saved = str((row or [''])[0] or '')
    except Exception as e:
        saved = 'error: %s' % e
    rec('共有スケジュールの行に実績の写しが入っている',
        '前工程1号' in saved, saved[:120])
    # **実績データが消えても保持される**——突合の控えを捨て、実績のキーを
    # 「当たらない列」へ変えても、保存済みの行は完了のまま。
    keys_before = db_access.actual_match_keys()
    try:
        db_access.DATA_SOURCES  # noqa: B018  参照だけ（下で差し替える）
        for s in db_access.DATA_SOURCES:
            if s.get('purpose') == '実績':
                s['matchKeys'] = json.dumps(['ロット番号', '鋳造番号', '存在しない列'],
                                            ensure_ascii=False)
        actual_match.forget()
        still = find('ACT0001')
        rec('実績側が当たらなくなっても、保存済みなら完了のまま',
            bool(still) and still['state'] == '完了' and bool(still.get('actualSource')),
            json.dumps({'state': still and still.get('state'),
                        'reason': (still or {}).get('missingReason')}, ensure_ascii=False)[:200])
    finally:
        for s in db_access.DATA_SOURCES:
            if s.get('purpose') == '実績':
                s['matchKeys'] = ''
        actual_match.forget()
    rec('突合キーを戻せている', db_access.actual_match_keys() == keys_before,
        str(db_access.actual_match_keys()))

    # ---- 7) 判定できないときは状態を動かさない ----
    r = client.post('/api/schedule/plan/add', json={
        'equipment': EQ, 'kind': '作業', 'lotNo': '', 'castingNo': '',
        'title': TAG + 'NOKEY', 'detail': {}, 'user_id': 'tests'})
    j = r.get_json() or {}
    if j.get('id'):
        made.append(j['id'])
    blank = None
    for e in entries():
        if str(e.get('title') or '') == TAG + 'NOKEY':
            blank = e
    rec('鍵が揃わない行は状態を動かさない（分からないことを分かったことにしない）',
        bool(blank) and blank['state'] == '予定' and blank.get('missingFromWork') is None
        and '揃っていません' in str(blank.get('missingReason') or ''),
        json.dumps({'state': blank and blank.get('state'),
                    'missing': blank and blank.get('missingFromWork'),
                    'reason': (blank or {}).get('missingReason')}, ensure_ascii=False)[:200])


try:
    main()
except Exception as e:
    import traceback
    traceback.print_exc()
    rec('FATAL', False, str(e))
finally:
    cleanup()

print('\n%d PASS / %d FAIL' % (sum(1 for x in R if x), sum(1 for x in R if not x)))
sys.exit(0 if all(R) else 1)
