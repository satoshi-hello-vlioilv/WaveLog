"""test_filtersaved.py: 保存したフィルタのサーバー側（§9.614）

============================================================
利用者の指摘「登録したフィルタの再編集もできないため、使えない」「登録内容からのプリセットへの
組み立てもわかりづらいので完全にゼロからフィルタ機能をデザインも機能も作り直してください」。

固定すること:
 1. 保存したフィルタを**IDで直せる**（名前・条件。送った項目だけ書く）
 2. 直すときに同じ場面・同じ持ち主の別の行と名前がぶつかったら 409（`nameTaken`）で断る
 3. 他人の個人フィルタは直せない（403）。条件0件には直せない（400）
 4. 「名前を付けて保存」（`onExists:'error'`）は同じ名前を黙って上書きしない（409）
 5. 前の版の組み合わせ（`[メンバーJSON]`）は、読むときに条件へ展開して1件の保存したフィルタとして返す
 6. 条件を直したら`[メンバーJSON]`は空になる（前の版の画面が古い部品で読まない）
 7. 条件の上限（60件）を越えたぶんは黙って捨てず、効いていない条件として名乗る
 8. 列の値の一覧の「除く（not_in）」: 選んだ値の行を除き、空欄（NULL）の行は残す。空欄そのものを除くこともできる。
    値が無い「除く」は絞らない／値が無い「選ぶ（in）」は1行も出さない

実際のマスタ（検証用フィクスチャ）へ書くので、**作った行は最後に物理的に消す**（削除の口は論理削除）。
============================================================
"""
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app                                   # noqa: E402
from backend import db_access                              # noqa: E402
from backend.routes import tables as tb                    # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


client = flask_app.app.test_client()
TAG = '保存テスト' + str(int(time.time() * 1000))[-7:]
DB, TABLE = 'TESTDB_' + TAG, 'TESTTABLE'
ME, OTHER = 'tester_' + TAG, 'other_' + TAG
made = []


def post(path, body):
    r = client.post(path, json=body)
    return r.status_code, (r.get_json() or {})


def listing(user=ME):
    r = client.get('/api/filter-presets', query_string={'db': DB, 'table': TABLE, 'mode': '', 'user': user})
    return (r.get_json() or {}).get('items') or []


def register(name, filters, user=ME, **extra):
    st, j = post('/api/filter-presets', {'name': name, 'db': DB, 'table': TABLE, 'mode': '', 'filters': filters,
                                         'user': user, 'user_id': user, **extra})
    if j.get('id') is not None:
        made.append(j['id'])
    return st, j


try:
    F1 = [{'column': '製造材質', 'op': 'in', 'value': ['A5052', 'A6061']}]
    F2 = [{'column': '用途名', 'op': 'contains', 'value': '一般'}]
    st, a = register('A系の残', F1)
    rec('前提: 保存できる', st == 200 and a.get('id') is not None, (st, a))
    st, b = register('一般だけ', F2)
    # ---- 1 ----
    st, j = post('/api/filter-presets/update', {'id': a['id'], 'name': 'A系の残（直した）', 'filters': F1 + F2, 'user': ME, 'user_id': ME})
    got = next((x for x in listing() if x['id'] == a['id']), {})
    rec('1: 名前と条件をIDで直せる', st == 200 and got.get('name') == 'A系の残（直した）' and got.get('filters') == F1 + F2, (st, j, got))
    st, j = post('/api/filter-presets/update', {'id': a['id'], 'name': 'A系の残（名前だけ）', 'user': ME, 'user_id': ME})
    got = next((x for x in listing() if x['id'] == a['id']), {})
    rec('1: 送らなかった条件は残る（名前だけ直す）', st == 200 and got.get('filters') == F1 + F2, got)
    # ---- 2 ----
    st, j = post('/api/filter-presets/update', {'id': a['id'], 'name': '一般だけ', 'user': ME, 'user_id': ME})
    rec('2: 同じ場面の別の行と同じ名前は 409', st == 409 and j.get('code') == 'nameTaken', (st, j))
    # ---- 3 ----
    st, j = post('/api/filter-presets/update', {'id': a['id'], 'filters': F2, 'user': OTHER, 'user_id': OTHER})
    rec('3: 他人の個人フィルタは直せない（403）', st == 403, (st, j))
    st, j = post('/api/filter-presets/update', {'id': a['id'], 'filters': [], 'user': ME, 'user_id': ME})
    rec('3: 条件0件には直せない（400）', st == 400, (st, j))
    # ---- 4 ----
    st, j = register('一般だけ', F1, onExists='error')
    rec('4: 名前を付けて保存は同じ名前を黙って上書きしない（409）', st == 409 and j.get('code') == 'nameTaken', (st, j))
    got = next((x for x in listing() if x['id'] == b['id']), {})
    rec('4: 断ったときは元の条件のまま', got.get('filters') == F2, got)
    # ---- 5 ----
    with db_access.connect(db_access.DBS['MASTER']['path'], False) as c:
        cur = c.cursor()
        cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[メンバーJSON],[使用回数],[表示順],[有効],[所有者ID],[グループ],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    "VALUES (?,?,?,'',?,?,0,999,-1,?,'',?,?,Now(),Now())",
                    ['前の組み合わせ', DB, TABLE, '[]', json.dumps([a['id'], b['id']]), ME, ME, ME])
        combo = cur.lastrowid
        c.commit()
    made.append(combo)
    got = next((x for x in listing() if x['id'] == combo), {})
    want = F1 + F2   # a は F1+F2・b は F2 → 同じ条件は1つ
    rec('5: 前の版の組み合わせは条件へ展開して返す（同じ条件は1つ）', got.get('filters') == want, got.get('filters'))
    # ---- 6 ----
    st, j = post('/api/filter-presets/update', {'id': combo, 'filters': F2, 'user': ME, 'user_id': ME})
    got = next((x for x in listing() if x['id'] == combo), {})
    rec('6: 条件を直したらメンバーは空（展開ではなく書いた条件を返す）', st == 200 and got.get('members') == [] and got.get('filters') == F2, got)
    # ---- 7 ----
    many = [{'column': 'a', 'op': 'eq', 'value': str(i)} for i in range(tb.FILTERS_MAX + 3)]
    kept = tb._safe_filters(json.dumps(many), ['a'])
    ign = tb._ignored_filter_columns(json.dumps(many), ['a'])
    rec('7: 上限まで当て、越えたぶんは効いていない条件として名乗る',
        len(kept) == tb.FILTERS_MAX and any('越えた3件' in x for x in ign), (len(kept), ign))
    # ---- 8 ----
    import tempfile, os
    from backend import sqlite_io
    fd, tmp = tempfile.mkstemp(suffix='.sqlite3'); os.close(fd)
    try:
        with sqlite_io.connect(pathlib.Path(tmp)) as c:
            c.execute('CREATE TABLE t (k TEXT)')
            c.executemany('INSERT INTO t VALUES (?)', [('A',), ('B',), ('C',), (None,), ('',)])
            c.commit()
            def hits(filters):
                w, prm = tb._build_filter_where(filters)
                sql = 'SELECT k FROM t' + (' WHERE ' + ' AND '.join(w) if w else '')
                return sorted(['∅' if r[0] is None else r[0] for r in c.execute(sql, prm).fetchall()])
            got = {
                'not_in_A_B': hits([{'column': 'k', 'op': 'not_in', 'value': ['A', 'B']}]),
                'not_in_blank': hits([{'column': 'k', 'op': 'not_in', 'value': ['']}]),
                'not_in_none': hits([{'column': 'k', 'op': 'not_in', 'value': []}]),
                'in_none': hits([{'column': 'k', 'op': 'in', 'value': []}]),
                'in_A': hits([{'column': 'k', 'op': 'in', 'value': ['A']}]),
            }
        rec('8: 除く（not_in）は選んだ値だけを除き、空欄の行は残す', got['not_in_A_B'] == ['', 'C', '∅'], got['not_in_A_B'])
        rec('8: 空欄を除くと空欄（NULL と空の字）の行が消える', got['not_in_blank'] == ['A', 'B', 'C'], got['not_in_blank'])
        rec('8: 値の無い「除く」は絞らない・値の無い「選ぶ」は1行も出さない', len(got['not_in_none']) == 5 and got['in_none'] == [] and got['in_A'] == ['A'], got)
        rec('8: not_in は効く条件として受け付ける（捨てない）', len(tb._safe_filters(json.dumps([{'column': 'k', 'op': 'not_in', 'value': ['A']}]), ['k'])) == 1)
    finally:
        os.remove(tmp)
finally:
    if made:
        with db_access.connect(db_access.DBS['MASTER']['path'], False) as c:
            c.execute('DELETE FROM [フィルタプリセットマスタ] WHERE [プリセットID] IN (' + ','.join('?' * len(made)) + ')', made)
            c.commit()

print('\n=== SUMMARY ===')
print(f'{sum(1 for x in R if x[1])}/{len(R)} passed')
for n, ok, d in R:
    if not ok:
        print(' - ' + n)
sys.exit(0 if all(x[1] for x in R) else 1)
