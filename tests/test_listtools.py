"""test_listtools.py: 一覧の道具のサーバー側（§9.591）——スライサーの「どれかと同じ」・色付けの当たり・数

============================================================
利用者の指示
------------------------------------------------------------
「仕掛情報や品質情報、作業スケジュールの仕掛一覧や作業スケジュール表に関しても上部メニューの構成の不満や
 UIサイズのバラバラ感が残っており…別リポジトリのLotScopeのメニューなどのUIの内容構成や配置が非常に優秀で
 参考になると思うので不足している機能は実装し」（足す機能は利用者に選んでもらった: Excel に出力・一覧の拡大・
 表示の設定の書き出し／読み込み・スライサー・色付け）

固定すること（サーバーの答え。画面は `test_listtools.js`）:
 1. 「どれかと同じ」（`in`）: 並びのどれかに当たる・空の字は空欄（NULL も''も）・読めない並びは何にも当たらない
 2. 色付けの決まり: 表に無い列を使う決まりは当てない（None）。条件は かつ
 3. ページの行の当たりは一覧の絞り込みと同じSQL（`_build_filter_where`）で引く（数の読み方も同じ＝`NumOf`）
 4. 当たる数は絞り込んだ全件で数える（ページの外も）
 5. 一覧・スライサー・色付けの数は同じ絞り込み（`_table_where`）を読む

**材料は自分で作る**（一時フォルダの SQLite）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import json
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.routes import tables as tb  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_listtools_'))
c = connect(tmp / 'w.sqlite3', False)
c.execute('CREATE TABLE t (ロット TEXT, 材質 TEXT, 板幅 TEXT)')
data = [('L1', 'A5052', '1000'), ('L2', 'A1100', '1,250'), ('L3', None, '900'), ('L4', '', '1300'), ('L5', 'A3004', '12A')]
c.executemany('INSERT INTO t VALUES (?,?,?)', data)
c.commit()
cs = ['ロット', '材質', '板幅']


def lots(filters, q=''):
    where, params, _f = tb._table_where(cs, q, json.dumps(filters))
    return [r[0] for r in c.execute('SELECT ロット FROM t' + where + ' ORDER BY ロット', params).fetchall()]


# ---- 1 ----
rec('1: 「どれかと同じ」は並びのどれかに当たる', lots([{'column': '材質', 'op': 'in', 'value': ['A5052', 'A3004']}]) == ['L1', 'L5'])
rec('1: 空の字は空欄（NULL も\'\'も）', lots([{'column': '材質', 'op': 'in', 'value': ['']}]) == ['L3', 'L4'])
rec('1: 字で来た並び（JSON）も読む', lots([{'column': '材質', 'op': 'in', 'value': '["A1100"]'}]) == ['L2'])
rec('1: 読めない並びは何にも当たらない', lots([{'column': '材質', 'op': 'in', 'value': 'A1100'}]) == [])
rec('1: 空の並びも何にも当たらない', lots([{'column': '材質', 'op': 'in', 'value': []}]) == [])

# ---- 2 ----
rules = tb._mark_rules(json.dumps([[{'column': '板幅', 'op': 'gte', 'value': '1200'}],
                                   [{'column': '無い列', 'op': 'eq', 'value': 'x'}],
                                   [{'column': '材質', 'op': 'starts', 'value': 'A'}, {'column': '板幅', 'op': 'lt', 'value': '1100'}]]), cs)
rec('2: 表に無い列を使う決まりは当てない（None）', rules[1] is None and rules[0] and rules[2], [bool(x) for x in rules])
rec('2: 決まりは8つまで', len(tb._mark_rules(json.dumps([[{'column': '材質', 'op': 'empty', 'value': ''}]] * 12), cs)) == tb.MARK_RULES_MAX)

# ---- 3 ----
rows = c.execute('SELECT * FROM t ORDER BY ロット').fetchall()
hits = tb._mark_hits(c, cs, rows, rules)
rec('3: 板幅 ≧ 1200 は 1,250 と 1300（3桁区切りも数・12A は数でない）', hits[0] == [1, 3], hits)
rec('3: 当てない決まりは空・かつ（A で始まる かつ 板幅 ＜ 1100）は L1 だけ', hits[1] == [] and hits[2] == [0], hits)

# ---- 4・5 ----
where, params, _f = tb._table_where(cs, '', json.dumps([{'column': 'ロット', 'op': 'neq', 'value': 'L2'}]))
cnt = tb._mark_counts(c, 't', where, params, rules)
rec('4: 当たる数は絞り込んだ全件で数える（L2 を外すと 板幅≧1200 は1件）', cnt == [1, None, 1], cnt)
rec('5: 検索の字もスライサー・色付けと同じ絞り込みに効く', lots([], q='A11') == ['L2'])

print(f'== {sum(R)}/{len(R)} PASS ==')
sys.exit(0 if all(R) else 1)
