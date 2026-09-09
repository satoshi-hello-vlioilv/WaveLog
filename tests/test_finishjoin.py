#!/usr/bin/env python3
"""test_finishjoin.py: 完了突合をクエリ結合マスタの1行として持つ（§9.365）。

============================================================
利用者の指示
------------------------------------------------------------
「今回追加した「実績」の完了突合せを、クエリ結合のようなスタイルでデータを
 キーで突合せする汎用スタイルにしてほしいです。結合後に、どのデータを
 使えるようにするか、作業スケジュールに使用可能とするデータも選べるように
 してください。…作業スケジュールで完了となったものは、指定した作業日時を
 完了時刻として、記録し…」

ここで固定すること:
 1. `クエリ結合マスタ`に**用途**があり、「完了突合」で1行登録できる
 2. **左右で別の列名**を組める（既定の1件にできない、これがこの段の値打ち）
 3. **取り込む列と接頭辞**が効く＝「結合後にどのデータを使えるようにするか」
 4. **完了日時列**の値が`finishedAt`に入る（時刻まで入っている列も読める）
 5. 登録が1件でもあれば**既定の1件は当たらない**（同じロットを2つで探さない）
 6. 一覧の結合は「**作業スケジュールでも使う**」を外せる
 7. 保存する前の**下見**が相手の側を見て答える

**材料は自分で用意し、自分で消す**（§9.351・§9.362）——作った結合も予定も
finally で消し、消えたことを確かめる。
============================================================
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# noqa: E402 は「ROOT を sys.path へ入れてから import する」ため（ほかの網と同じ作法）。
import app as flask_app                                  # noqa: E402 パスを通してから読む
from backend import db_access, actual_match, query_join  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


client = flask_app.app.test_client()
EQ = 'テスト設備A'
TAG = 'FJ' + str(pathlib.os.getpid())
made_joins = []
made_plans = []
mine = {}


def mode(m):
    client.post('/api/access-mode', json={'mode': m})


def add_join(name, keys, **kw):
    """完了突合を1件登録する。**登録できるのは編集モード**。"""
    payload = {'name': name, 'left': db_access.WORK_DB_KEY, 'leftTable': '',
               'right': db_access.ACTUAL_DB_KEY, 'rightTable': '',
               'keys': keys, 'columns': [], 'prefix': '',
               'purpose': '完了突合', 'finishColumn': '',
               'order': 10, 'enabled': '有効', 'user_id': 'tests'}
    payload.update(kw)
    r = client.post('/api/query-join-master', json=payload)
    j = r.get_json() or {}
    if j.get('id'):
        made_joins.append(j['id'])
    else:
        print('  [join] %s: %s %s' % (name, r.status_code, j))
    actual_match.forget()
    return j


def add_plan(lot, casting, end_date):
    r = client.post('/api/schedule/plan/add', json={
        'equipment': EQ, 'kind': '作業', 'lotNo': lot, 'castingNo': casting,
        'title': TAG + lot,
        'detail': {'ロット番号': lot, '鋳造番号': casting,
                   '前工程実績_作業終了_日付': end_date},
        'user_id': 'tests'})
    j = r.get_json() or {}
    if j.get('id'):
        made_plans.append(j['id'])
        mine[lot] = j['id']
    else:
        print('  [add] %s: %s %s' % (lot, r.status_code, j))
    return j


def find(lot):
    pid = mine.get(lot)
    if pid is None:
        return None
    r = client.get('/api/schedule/plan?equipment=' + EQ)
    for e in ((r.get_json() or {}).get('entries') or []):
        if str(e.get('id')) == str(pid):
            return e
    return None


def joins_now():
    return ((client.get('/api/query-join-master').get_json() or {}).get('items') or [])


def cleanup():
    """**消えたことまで確かめる**（§9.362）。マスタに1行でも残ると、以降の
    通し全部が「頼んでいない完了突合」を見ることになる。"""
    mode('schedule')
    for pid in made_plans:
        try:
            client.post('/api/schedule/plan/delete',
                        json={'id': pid, 'equipment': EQ, 'user_id': 'tests'})
        except Exception as e:
            print('  [cleanup] 予定を消せない:', e)
    mode('edit')
    for jid in made_joins:
        try:
            client.post('/api/query-join-master/delete', json={'id': jid, 'user_id': 'tests'})
        except Exception as e:
            print('  [cleanup] 結合を消せない:', e)
    actual_match.forget()
    left = [x['id'] for x in joins_now() if x['id'] in made_joins]
    rec('後片付け: 作った結合が1件も残っていない', not left, str(left))


def main():
    mode('edit')
    got = client.get('/api/query-join-master').get_json() or {}

    # ---- 1) 用途がある ----
    keys = [p.get('key') for p in (got.get('purposes') or [])]
    rec('用途の語彙は「一覧に列を足す」と「完了突合」の2つ',
        keys == ['', '完了突合'], str(keys))
    rec('用途の既定は「一覧に列を足す」（保存済みの行の意味を変えない）',
        got.get('purposeDefault') == '', str(got.get('purposeDefault')))
    rec('既定の完了突合を画面へ返す（どうつないでいるか見て真似できる）',
        bool(got.get('builtinFinish'))
        and (got['builtinFinish'].get('purpose') == '完了突合'),
        json.dumps(got.get('builtinFinish'), ensure_ascii=False)[:160])
    rec('登録が無いあいだは既定の完了突合が効いている',
        got.get('builtinFinishActive') is True, str(got.get('builtinFinishActive')))

    # ---- 2) 左右で別の列名を組める ----
    # 検証用の実績は[材料ロット]に[ロット番号]と同じ値を持つ。**既定の1件では
    # 絶対に当てられない組み合わせ**（あちらは左右同じ名前しか使えない）。
    j = add_join(TAG + '別名', [{'left': 'ロット番号', 'right': '材料ロット'},
                                {'left': '鋳造番号', 'right': '鋳造番号'}],
                 finishColumn='前工程実績_作業終了_日時',
                 columns=['前工程実績_設備名', '前工程実績_数量'], prefix='実績_')
    rec('完了突合を1件登録できる', bool(j.get('id')), str(j)[:120])
    saved = [x for x in joins_now() if x['id'] in made_joins]
    one = saved[0] if saved else {}
    rec('用途・完了日時列・取り込む列・接頭辞がそのまま保存される',
        one.get('purpose') == '完了突合'
        and one.get('finishColumn') == '前工程実績_作業終了_日時'
        and one.get('columns') == ['前工程実績_設備名', '前工程実績_数量']
        and one.get('prefix') == '実績_',
        json.dumps({k: one.get(k) for k in ('purpose', 'finishColumn', 'columns', 'prefix')},
                   ensure_ascii=False))
    rec('「作業スケジュールでも使う」の既定は使う（保存値は「使わない」側だけ）',
        one.get('useInSchedule') is True, str(one.get('useInSchedule')))

    # ---- 5) 登録があれば既定の1件は当たらない ----
    defs = query_join.finish_definitions()
    rec('登録が1件でもあれば既定は当てない（同じロットを2つで探さない）',
        len(defs) == 1 and not defs[0].get('builtin'),
        str([(d.get('name'), bool(d.get('builtin'))) for d in defs]))
    rec('画面にも「既定はいま効いていない」と返す',
        (client.get('/api/query-join-master').get_json() or {}).get('builtinFinishActive') is False)

    # ---- 3)(4) 実際に当ててみる ----
    mode('schedule')
    add_plan('ACT0002', 'C9002', '2026-09-02')
    hit = find('ACT0002')
    rec('左右で名前の違う列でも突き合わせられる（完了になる）',
        bool(hit) and hit.get('state') == '完了' and hit.get('missingFromWork') is True,
        json.dumps({'state': hit and hit.get('state'),
                    'reason': (hit or {}).get('missingReason')}, ensure_ascii=False)[:200])
    src = (hit or {}).get('actualSource') or {}
    rec('取り込む列だけが、接頭辞つきで持ち帰られる',
        set(src.keys()) == {'実績_前工程実績_設備名', '実績_前工程実績_数量'}
        and src.get('実績_前工程実績_設備名') == '前工程2号',
        json.dumps(src, ensure_ascii=False)[:180])
    rec('完了日時は「指定した列」から（時刻まで入っている列も読める）',
        str((hit or {}).get('finishedAt') or '').startswith('2026-09-02T13:45'),
        str((hit or {}).get('finishedAt')))
    rec('どの定義で当たったかを行が名乗る',
        (hit or {}).get('finishedBy') == TAG + '別名', str((hit or {}).get('finishedBy')))

    # 突合の設定を、定義ごとに答えられる。
    d = actual_match.describe()
    dd = (d.get('definitions') or [{}])[0]
    rec('describe() が登録した定義を答える',
        dd.get('name') == TAG + '別名' and dd.get('actualColumns') == ['材料ロット', '鋳造番号'],
        json.dumps({'name': dd.get('name'), 'cols': dd.get('actualColumns')},
                   ensure_ascii=False))

    # ---- 7) 下見は相手の側を見る ----
    mode('edit')
    pr = (client.post('/api/query-join-master/probe', json={
        'name': '(下見)', 'left': db_access.WORK_DB_KEY, 'right': db_access.ACTUAL_DB_KEY,
        'purpose': '完了突合', 'finishColumn': '前工程実績_作業終了_日時',
        'keys': [{'left': 'ロット番号', 'right': '材料ロット'}],
        'columns': [], 'prefix': ''}).get_json() or {}).get('result') or {}
    rec('下見は相手の行数と「日時を読めた件数」で答える',
        pr.get('ok') is True and pr.get('matched') >= 3 and pr.get('finishReadable') >= 3,
        json.dumps({k: pr.get(k) for k in ('ok', 'matched', 'finishReadable', 'table', 'reason')},
                   ensure_ascii=False)[:200])
    pr2 = (client.post('/api/query-join-master/probe', json={
        'name': '(下見)', 'left': db_access.WORK_DB_KEY, 'right': db_access.ACTUAL_DB_KEY,
        'purpose': '完了突合', 'finishColumn': '',
        'keys': [{'left': 'ロット番号', 'right': '材料ロット'}]}).get_json() or {}).get('result') or {}
    rec('完了日時が未指定なら「さかのぼりでは常に表示される」と断る',
        'さかのぼり' in str(pr2.get('note') or ''), str(pr2.get('note'))[:120])

    # ---- 6) 一覧の結合はスケジュールで使うかを選べる ----
    ql = client.post('/api/query-join-master', json={
        'name': TAG + '一覧', 'left': db_access.WORK_DB_KEY,
        'right': db_access.ACTUAL_DB_KEY, 'purpose': '',
        'keys': [{'left': 'ロット番号', 'right': '材料ロット'}],
        'columns': ['前工程実績_設備名'], 'prefix': '一覧_',
        'useInSchedule': False, 'order': 20, 'enabled': '有効',
        'user_id': 'tests'}).get_json() or {}
    if ql.get('id'):
        made_joins.append(ql['id'])
    rec('一覧の結合を「スケジュールでは使わない」で登録できる', bool(ql.get('id')), str(ql)[:120])
    mine_row = [x for x in joins_now() if x['id'] == ql.get('id')]
    rec('「使わない」が保存される',
        bool(mine_row) and mine_row[0].get('useInSchedule') is False,
        str(mine_row and mine_row[0].get('useInSchedule')))
    all_keys = (client.get('/api/query-join/keys?db=' + db_access.WORK_DB_KEY
                           + '&builtin=0').get_json() or {})
    sc_keys = (client.get('/api/query-join/keys?db=' + db_access.WORK_DB_KEY
                          + '&builtin=0&for=schedule').get_json() or {})
    names_all = [x.get('name') for x in (all_keys.get('joins') or [])]
    names_sc = [x.get('name') for x in (sc_keys.get('joins') or [])]
    rec('一覧には出るが、スケジュール表には出ない',
        (TAG + '一覧') in names_all and (TAG + '一覧') not in names_sc,
        str(names_all) + ' / ' + str(names_sc))
    rec('完了突合の行は一覧の結合として当たらない（列を足すものではない）',
        (TAG + '別名') not in names_all, str(names_all))


try:
    main()
except Exception as e:
    import traceback
    traceback.print_exc()
    rec('FATAL', False, str(e))
finally:
    try:
        cleanup()
    except Exception as e:
        print('  [cleanup] FATAL:', e)
    try:
        client.post('/api/access-mode', json={'mode': 'edit'})
    except Exception as e:
        print('  [cleanup] editへ戻せない:', e)

print('\n%d PASS / %d FAIL' % (sum(1 for x in R if x), sum(1 for x in R if not x)))
sys.exit(0 if all(R) else 1)
