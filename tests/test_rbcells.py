# -*- coding: utf-8 -*-
"""test_rbcells.py: 帳票ブロックの[内容]を「セル」で持つ（§9.274、利用者の指示）。

  「板厚MIN、板厚MAX、板幅MIN、板幅MAX、板丈MIN、板丈MAXをブロックに設定して
   表示させると、すべて横方向に、2段のカラムで並べられます。縦にも項目を
   並べて、横も共通軸で並べたりすることでマトリクスも整形できるようにしたい」
  「配置したデータの書式変更もできるようにしてください。数値の桁数、日付の
   書式、文字列を寄せる方向など」

固定するのは6つ。
 ① 今までの行の形（`ラベル=道|横x縦`）はそのまま読める（既に登録してある塊）
 ② 見出し・ラベルを出さない・寄せ・書式を1つでも使うとJSONで持つ
 ③ **何も新しいものを使っていない塊の保存値は1バイトも変わらない**
    （`|1`や`x1`を足さない＝触っていない塊が保存のたびに形を変えない）
 ④ 壊れたJSON・知らない綴りは倒して読む（塊が丸ごと開けなくならない）
 ⑤ 語彙（種別・寄せ・書式・日付の見本）は**サーバーが答える**（§9.163）
 ⑥ 統計の候補は**行と列の軸を名乗る**（盤の「表に組む」がこれを見る）

**画面（`fbParse`/`fbText`）と同じ例で確かめる**——読み方が2通りあると、
盤で組んだ形と紙が食い違う（§9.245）。例は`tests/fixtures/report_cells.json`。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.repositories import report_block_repo as rb  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


HERE = os.path.dirname(os.path.abspath(__file__))
CASES = json.load(open(os.path.join(HERE, 'fixtures', 'report_cells.json'), encoding='utf-8'))

KEYS = ('label', 'path', 'kind', 'span', 'rows', 'showLabel', 'align', 'format')


def shape(c):
    return {k: c.get(k) for k in KEYS}


# ---- ① ② ④ 読む -----------------------------------------------------------
bad = []
for case in CASES['parse']:
    got = [shape(c) for c in rb.parse_content(case['text'])]
    want = [shape(c) for c in case['cells']]
    if got != want:
        bad.append((case['why'], want, got))
rec('① 例の通りに読める（サーバー）', not bad, bad[:2])

# `blank` は kind から決まる（読む側が `f.blank` を見ているので消せない）
cells = rb.parse_content('|1\nA=basic.lotNo')
rec('`blank`は今までどおり付く（画面と紙が`f.blank`で見ている）',
    cells[0]['blank'] is True and cells[1]['blank'] is False, cells)

# ---- ③ 書く ---------------------------------------------------------------
bad = []
for case in CASES['dump']:
    got = rb.dump_content(case['cells'])
    if case.get('json'):
        if not got.startswith('['):
            bad.append((case['why'], 'JSONのはず', got))
    elif got != case['text']:
        bad.append((case['why'], case['text'], got))
rec('② 新しい持ちものを使うときだけJSONへ切り替える', not bad, bad[:2])

seed = ('ロット番号=basic.lotNo\n検査番号=basic.inspectionNo\n鋳造番号=basic.castingNo\n'
        'オーダー番号=basic.orderNo\n引当番号=basic.allocationNo\n用途コード=basic.purposeCode\n'
        '用途名=basic.purposeName\n取引先=basic.customer\n納入先=basic.delivery')
rec('③ 触っていない塊の保存値は1バイトも変わらない',
    rb.dump_content(rb.parse_content(seed)) == seed,
    rb.dump_content(rb.parse_content(seed)))

# 往復（新しい持ちもの入り）
rich = [dict(rb._cell(label='板厚', path='stat.thickness.min', span=2, rows=3,
                      show_label=False, align='right',
                      fmt={'kind': 'number', 'decimals': 3, 'thousands': True, 'suffix': 'mm'})),
        dict(rb._cell(label='MIN', kind=rb.CELL_HEAD)),
        dict(rb._cell(kind=rb.CELL_BLANK, span=2))]
back = rb.parse_content(rb.dump_content(rich))
rec('③ 見出し・寄せ・書式は往復しても変わらない',
    [shape(c) for c in back] == [shape(c) for c in rich],
    [shape(c) for c in back])

# ---- ④ 壊れたものを倒す ----------------------------------------------------
rec('④ 壊れたJSONは行の形として読み直す（黙って空にしない）',
    len(rb.parse_content('[こわれている')) == 1)
rec('④ 知らない書式はNone（そのまま）',
    rb.normalize_format({'kind': '色'}) is None and rb.normalize_format('x') is None)
rec('④ 小数桁は範囲へ丸め、数でなければ「そのまま」',
    (rb.normalize_format({'kind': 'number', 'decimals': 99})['decimals'] == rb.DECIMAL_MAX
     and rb.normalize_format({'kind': 'number', 'decimals': 'あ'})['decimals'] is None))
rec('④ 既定だけの「文字」の書式は持たない（保存のたびに形が変わらない）',
    rb.normalize_format({'kind': 'text'}) is None
    and rb.normalize_format({'kind': 'text', 'suffix': 'mm'}) == {'kind': 'text', 'suffix': 'mm'})
rec('④ 知らない寄せは自動へ倒す',
    rb.normalize_align('ななめ') == '' and rb.normalize_align('right') == 'right')

# ---- 保存の口を通して往復する（塊のUPSERTが content を落とさない） ------------
import sqlite3  # noqa: E402
import tempfile  # noqa: E402

tmp = tempfile.mkdtemp()
db = os.path.join(tmp, 'm.sqlite3')
c = sqlite3.connect(db)
c.create_function('Now', 0, lambda: '2026-01-01 00:00:00')
try:
    rb.ensure_table(c)
    rich_text = rb.dump_content(rich)
    bid = rb.block_upsert(c, 'tester', equipment='*', name='ZZセル往復',
                          content=rich_text, span=6, rows=0)
    row = [x for x in rb.block_rows(c, True) if x['id'] == bid][0]
    rec('保存の口を通しても内容が落ちない',
        row['content'] == rich_text and len(row['fields']) == 3,
        (row['content'][:60], len(row['fields'])))
    rec('読み出した fields は「セル」の形（画面がそのまま紙へ渡せる）',
        row['fields'][0]['kind'] == 'value' and row['fields'][0]['showLabel'] is False
        and row['fields'][1]['kind'] == 'head' and row['fields'][2]['blank'] is True,
        row['fields'])
finally:
    c.close()

# ---- ⑤ 語彙はサーバーが持つ -------------------------------------------------
rec('⑤ 種別は3つ（値・見出し・空き）',
    [v for v, _ in rb.CELL_KINDS] == ['value', 'head', 'blank'])
rec('⑤ 寄せは一覧（§9.239 ④）と同じ綴り',
    [v for v, _ in rb.ALIGNS] == ['', 'left', 'center', 'right'])
rec('⑤ 書式の綴りは WL.cellFormat と同じ',
    [v for v, _ in rb.FORMAT_KINDS] == ['', 'number', 'datetime', 'text'])
rec('⑤ 日付の見本を持つ（手で書いてもよいが、選べる）',
    len(rb.DATE_PATTERNS) >= 4 and 'yyyy/MM/dd' in rb.DATE_PATTERNS)

# **画面へ写していないこと**（§9.163）。写すと書式を1つ足すたびに2箇所直す。
js = open(os.path.join(os.path.dirname(HERE), 'static', 'js', 'master-maint.js'),
          encoding='utf-8').read()
# **見分けの付く呼び名だけを見る**——`数値`や`文字`は操業データ項目マスタの
# `[型]`の選択肢でもあるので、それを数えると常に落ちる（意味のない網）。
labels = [lb for _v, lb in rb.CELL_KINDS] + ['日付・時刻']
leaked = [lb for lb in labels if lb in js]
rec('⑤ 呼び名を画面へ書き写していない（語彙はサーバーが答える）', not leaked, leaked)

# ---- ⑥ 統計の候補は軸を名乗る ------------------------------------------------
rec('⑥ 統計の候補は行と列の軸を持つ（盤の「表に組む」がこれを見る）',
    rb.STAT_AXIS.get('stat.thickness.min') == ('板厚', 'MIN')
    and len(rb.STAT_AXIS) == len(rb.STAT_CATALOG),
    len(rb.STAT_AXIS))

c2 = sqlite3.connect(db)
c2.create_function('Now', 0, lambda: '2026-01-01 00:00:00')
try:
    groups = rb.field_catalog(c2, '')
    st = [g for g in groups if g['group'] == '測定した値の統計']
    ok = bool(st) and all(x.get('row') and x.get('col') for x in st[0]['items'])
    # 軸を名乗らない群もある（そこは表に組めない、と画面が言える）
    other = [g for g in groups if g['group'] != '測定した値の統計']
    plain = all(not x.get('row') for g in other for x in g['items'])
    rec('⑥ 候補の一覧でも軸が届く／軸を持たない群と見分けが付く', ok and plain,
        (ok, plain))
finally:
    c2.close()

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print('%d/%d passed' % (len(R) - len(ng), len(R)))
for n, _o, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
