"""test_stoprule.py: 設備停止の挿入条件（§9.588）——保存の前に整える・読み直す・写す・見送り

============================================================
利用者の指示
------------------------------------------------------------
「条件は列のデータを組み合わせて条件テーブルを判定条件とし、その設備停止の挿入数、挿入すべきそれぞれの
 時間と自動挿入か、警告のみか選べるようにします。」「判定条件は設備停止マスタの設備停止ごとに持たせ」

固定すること（判定そのものは画面の`firstRule()`の1本・`test_stoprules.js`）:
 1. 列は prev./next./chg./diff. の4つの群だけ（仕掛の列名つき）。ほかの列・壊れた条件は1件だけ落とす
 2. 答え: 挿入数は 0〜9、時間は挿入数ぶんの並び（空は標準の分）、動作は auto／warn（知らない字は warn）
 3. 条件のある行を上から、条件の無い行は最後の1つだけ既定。既定が無ければ「0本（要らない）」を足す
 4. 保存→読み直しで同じ表・列の並び。未登録は既定の1行。未登録に戻せる。停止内容の複製で表も写る
 5. 見送り（今回は入れない）は「停止×前のロット」の組で1つ。外せる。読めない物は落とす
 6. 刃組の表の整え方（`bladeset_repo`）は共通の部品へ移しても同じ答え
 7. 語彙（列の群・動作・上限）はサーバーが答える

**材料は自分で作る**（一時フォルダの設定DB）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.repositories import stop_rule_repo as rr  # noqa: E402 パスを通してから読む
from backend.repositories import bladeset_repo as bs  # noqa: E402 パスを通してから読む
from backend import schedule_calc as sc, rule_cells  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_stoprule_'))
mc = connect(tmp / 'master.sqlite3', False)

# ---- 1・2・3: 整える ----
rows = [
    {'conditions': [{'field': 'chg.製造材質', 'op': 'eq', 'value': '変わる'},
                    {'field': 'source.板厚', 'op': 'gt', 'value': '1'},           # 群の外の列は落とす
                    {'field': 'next.製造板厚', 'op': 'between', 'value': '0.5', 'value2': '1.2'},
                    {'field': 'next.製造板厚', 'op': 'gt', 'value': '3', 'or': True},
                    {'field': 'prev.[x]', 'op': 'eq', 'value': '1'},              # 字の形が崩れた列は落とす
                    {'field': 'diff.製造板幅', 'op': 'nope', 'value': '1'}],      # 知らない比べ方は落とす
     'count': '2', 'minutes': '30,15', 'action': 'auto', 'note': '材質替え'},
    {'conditions': [], 'count': 1, 'minutes': [10], 'action': 'warn'},           # 途中の既定は最後の1つに負ける
    {'conditions': [{'field': 'diff.製造板幅', 'op': 'ge', 'value': '100'}], 'count': 99, 'minutes': [], 'action': 'x'},
]
tidy = rr._tidy(rows)
rec('条件のある行を上から、既定は最後の1つ（途中の既定は捨てない＝最後の既定になる）',
    len(tidy) == 3 and tidy[-1]['conditions'] == [] and tidy[-1]['count'] == 1, [len(t['conditions']) for t in tidy])
conds = tidy[0]['conditions']
rec('群の外の列・字の崩れた列・知らない比べ方は1件ずつ落とし、残りは残す',
    [c['field'] for c in conds] == ['chg.製造材質', 'next.製造板厚', 'next.製造板厚'], conds)
rec('セルの中の「または」は同じ列の2つ目から残る', conds[2].get('or') is True and 'or' not in conds[1])
rec('答え: 挿入数2・時間は挿入数ぶん（30, 15）・自動', (tidy[0]['count'], tidy[0]['minutes'], tidy[0]['action']) == (2, [30, 15], 'auto'))
rec('挿入数は 9 まで・時間が足りなければ空（標準の分）・知らない動作は知らせるだけ',
    (tidy[1]['count'], tidy[1]['minutes'], tidy[1]['action']) == (9, [None] * 9, 'warn'), tidy[1])
rec('既定の行が無い表には「0本（要らない）」の既定を足す',
    rr._tidy([rows[0]])[-1] == {'conditions': [], 'count': 0, 'minutes': [], 'action': 'warn', 'note': ''})
rec('時間は 1〜1440 分に丸める', rr.normalize_answer({'count': 2, 'minutes': [0, 9999]})['minutes'] == [1, 1440])

# ---- 4: 保存・読み直し・未登録・複製 ----
rec('未登録は既定の1行（要らない）', rr.rules_for(mc, 7) == {'rows': rr._seed(), 'cols': [], 'stored': False})
rr.rules_replace(mc, 7, rows, ['next.製造板厚', 'chg.製造材質', 'source.x'], 'tester')
mc.commit()
got = rr.rules_for(mc, 7)
rec('保存した表を同じ形で読み直す（既定は最後）', got['stored'] and got['rows'] == tidy, got['rows'])
rec('列の並びは保存した順（群の外は落とし、条件にあって並びに無い列は後ろへ）',
    got['cols'] == ['next.製造板厚', 'chg.製造材質', 'diff.製造板幅'], got['cols'])
rr.rules_copy(mc, 7, 8, 'tester')
mc.commit()
rec('停止内容を複製すると表も写る', rr.rules_for(mc, 8)['rows'] == tidy)
rec('登録の無い停止内容を写しても何も作らない', (rr.rules_copy(mc, 99, 100, 't'), rr.rules_for(mc, 100)['stored'])[1] is False)
rr.rules_reset(mc, 7)
mc.commit()
rec('未登録に戻せる（写した側は残る）', not rr.rules_for(mc, 7)['stored'] and rr.rules_for(mc, 8)['stored'])
rec('一覧は停止理由IDごと', set(rr.rules_all(mc)) == {8})

# ---- 5: 見送り ----
m = sc.stop_skips_merge([], 3, 11)
m = sc.stop_skips_merge(m, 3, 11)
m = sc.stop_skips_merge(m, 4, 11)
rec('見送りは「停止×前のロット」の組で1つ（2回足しても1つ）', m == [{'stopId': 3, 'prevId': 11}, {'stopId': 4, 'prevId': 11}], m)
rec('見送りを外せる', sc.stop_skips_merge(m, 3, 11, on=False) == [{'stopId': 4, 'prevId': 11}])
rec('見送りの読み: 読めない1件は落とし、ほかは残す',
    sc.stop_skips('[{"stopId":3,"prevId":11},{"stopId":"x"},5]') == [{'stopId': 3, 'prevId': 11}])
try:
    sc.stop_skips_merge([], 'a', None)
    rec('見送りの停止・前のロットが読めなければ断る', False)
except ValueError as e:
    rec('見送りの停止・前のロットが読めなければ断る', '指定してください' in str(e), str(e))

# ---- 6: 刃組の表の整え方は同じ答え ----
b = bs.normalize_pick_conditions([{'field': 'source.製造材質', 'op': 'eq', 'value': 'SUS'},
                                  {'field': 'thickness', 'op': 'lt', 'value': '0.6'},
                                  {'field': 'prev.製造材質', 'op': 'eq', 'value': 'SUS'}])
rec('刃組の表は仕掛の列（source.）と計算値を受け、設備停止の群（prev.）は受けない',
    [c['field'] for c in b] == ['source.製造材質', 'thickness'], b)
rec('比べ方の語彙は1つ（刃組と設備停止が同じ組を使う）', bs.BLADEPICK_OPS is rule_cells.RULE_OPS)

# ---- 7: 語彙 ----
v = rr.vocab()
rec('語彙: 列の群は4つ（前・後ろ・変わったか・差）、動作は2つ、上限つき',
    [s['key'] for s in v['sets']] == ['prev', 'next', 'chg', 'diff'] and [a['key'] for a in v['actions']] == ['warn', 'auto']
    and v['countMax'] == 9 and v['sets'][2]['options'] == ['変わる', '同じ'] and v['sets'][3]['kind'] == 'num', v['sets'])

ok = sum(R)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
