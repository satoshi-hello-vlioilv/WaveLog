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

KEYS = ('label', 'path', 'kind', 'span', 'rows', 'showLabel', 'stack',
        'align', 'format', 'lot')


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

# ---- ⑥ 候補は「軸の名前と値」だけを名乗る（§9.277）-----------------------------
# §9.274 では `row`/`col` という**置き場つきの名前**を名乗っており、
# 「板厚は行・MINは列」という**決め打ちの1通り**しか作れなかった。
# いまは `axes`（軸の名前→値）だけを返し、**置き場は盤が決める**。
rec('⑥ 統計の候補は軸を「名前→値」で名乗る（盤の「表に組む」がこれを見る）',
    rb.STAT_AXES.get('stat.thickness.min') == {rb.AXIS_ITEM: '板厚', rb.AXIS_AGG: 'MIN'}
    and len(rb.STAT_AXES) == len(rb.STAT_CATALOG),
    len(rb.STAT_AXES))
# 軸の並び順が**既定の置き場**を決める（1つ目が行・残りが列）。
rec('⑥ 軸の語彙と並び順はサーバーが持つ',
    rb.PIVOT_AXES == (rb.AXIS_LOT, rb.AXIS_ITEM, rb.AXIS_AGG)
    and rb.AXIS_LOT == '対象',
    rb.PIVOT_AXES)
# 繰り返しの**向き**（縦に積む／横に並べる）。**既定は縦**——これまでの
# 見え方を黙って変えない。
rec('⑥ 繰り返しの向きは2つで、既定は縦に積む',
    [v for v, _ in rb.REPEAT_DIRS] == ['', rb.REPEAT_DIR_ROW]
    and rb.REPEAT_DIRS[0][0] == '',
    rb.REPEAT_DIRS)

c2 = sqlite3.connect(db)
c2.create_function('Now', 0, lambda: '2026-01-01 00:00:00')
try:
    groups = rb.field_catalog(c2, '')
    st = [g for g in groups if g['group'] == '測定した値の統計']
    names = set(rb.PIVOT_AXES)
    ok = bool(st) and all(
        isinstance(x.get('axes'), dict) and x['axes'] and set(x['axes']) <= names
        for x in st[0]['items'])
    # 軸を名乗らない群もある（そこは表に組めない、と画面が言える）
    other = [g for g in groups if g['group'] != '測定した値の統計']
    plain = all(not x.get('axes') for g in other for x in g['items'])
    rec('⑥ 候補の一覧でも軸が届く／軸を持たない群と見分けが付く', ok and plain,
        (ok, plain))
    # **置き場は候補が持たない**（§9.277）——`row`/`col`を返していた頃は
    # 行と列を入れ替えられず、3つ目の軸（対象）も足せなかった。
    placed = [x['path'] for g in groups for x in g['items']
              if x.get('row') or x.get('col')]
    rec('⑥ 候補は置き場（行／列）を持たない——決めるのは盤', not placed, placed[:3])
finally:
    c2.close()

# ==========================================================
# ⑦ 同じ名前の塊を2つ置かせない（§9.282、利用者の報告「帳票ブロック
#    マスタでは正しく再現して表示もするのに、紙の帳票レイアウトだと、
#    全然違う表を持ってくる」）
# ----------------------------------------------------------
# 紙は塊を**名前で**引く（並び・幅・高さ・出す/出さないが全部その鍵）。
# 自作の行に既定の塊と同じ名前が入ると、紙はどちらを出すか決められず、
# 先に見つけたほうを出して**もう片方を隠す**。しかも`/api/report-block-master`
# は`組み込みキー`を渡さないので、既定の名前でPOSTすると**空の組み込みキーを
# 持つ別の行**ができる——盤ではその行を編集していて正しく見えるのに、紙は
# 既定の塊のほうを出す（＝「盤は合っているのに紙が別物」）。入口で断る。
# ==========================================================
c3 = sqlite3.connect(db)
c3.create_function('Now', 0, lambda: '2026-01-01 00:00:00')
try:
    dup = rb.BUILTIN_KEYS[0]
    err = ''
    try:
        rb.block_upsert(c3, 'tester', equipment='テスト設備A', name=dup,
                        content='[{"kind":"value","path":"basic.lotNo","label":"ロット"}]')
    except ValueError as e:
        err = str(e)
    rows = [r for r in rb.block_rows(c3, '') if r['name'] == dup and not r['builtin']]
    rec('⑦ 既定の塊と同じ名前では新しい行を作れない', bool(err) and not rows,
        (err[:40], len(rows)))
    rec('⑦ 断り方は「なぜ」と「どうすれば」を言う（§4）',
        ('画面がもともと持っている' in err) and ('違う名前' in err), err[:80])
    # 既定の行そのものは今までどおり編集できる（名前を鍵にした引き当て）
    ok_edit = True
    try:
        rb.block_upsert(c3, 'tester', equipment='*', name=dup, builtin=dup, span=6)
    except Exception as e:
        ok_edit = False
        err2 = str(e)
    rec('⑦ 既定の塊そのもの（組み込みキーつき）は今までどおり直せる', ok_edit,
        '' if ok_edit else err2)
finally:
    c3.close()

# ==========================================================
# ⑧ 品質等級の呼び名は画面とそろっている（§9.285 ②）
# ==========================================================
# 記録は`qualityGrades[<呼び名>]`（`measurement-view.js`の
# `QUALITY_GRADE_SOURCE`が書く）。候補の綴りがずれると、**選んでも必ず空欄**に
# なる（§CLAUDE 6「見本が嘘をつく」の裏返し）。**目で数えないこと**——
# 呼び名は12個あり、片方だけ直した状態が作れる。
import re as _re
from pathlib import Path as _Path
ROOT = _Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_js = (ROOT / 'static' / 'js' / 'measurement-view.js').read_text(encoding='utf-8')
_m = _re.search(r'const QUALITY_GRADE_SOURCE=\{(.*?)\n\};', _js, _re.S)
_screen = set(_re.findall(r"'([^']+)':\[", _m.group(1))) if _m else set()
rec('⑧ 品質等級の呼び名がサーバーと画面でそろっている',
    _screen == set(rb.QUALITY_GRADE_LABELS),
    (sorted(_screen - set(rb.QUALITY_GRADE_LABELS)),
     sorted(set(rb.QUALITY_GRADE_LABELS) - _screen)))
# 母材の道（§9.285 ②）。**記録の置き場は`mother.<キー>`**——組み込みキーの
# 綴りは`motherManual`だが、`collect()`は`[data-mother]`を見て`mother.manual`へ
# 書く。候補が`settings.motherManual`を答えていたため、実データでは必ず空だった。
_html = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
_keys = set(_re.findall(r'data-mother="([^"]+)"', _html))
_mapped = {v.split('.', 1)[1] for k, v in rb.BUILTIN_PATHS.items() if v.startswith('mother.')}
rec('⑧ 母材の組み込みキーは記録の置き場（mother.<キー>）へ読み替える',
    _keys and _keys == _mapped, (sorted(_keys), sorted(_mapped)))
rec('⑧ 記録に残らない欄は読み替えの表にも候補にも出さない',
    all(k not in rb.BUILTIN_PATHS for k in rb.UNRECORDED_BUILTINS),
    rb.UNRECORDED_BUILTINS)

# ---------------------------------------------------------------------------
# §9.321 見本は「いまの入力の決まり」に乗る（利用者の指示）
# ---------------------------------------------------------------------------
# 「デモデータを最新のデータのパターンに合わせてアップデートしてください。
#  ステップ刻みのあるデータや、小数点の桁数が変わるものを想定しています」
#
# 刻みと器の桁そのものは`tests/test_rbsample.js`が**画面の決まりに聞いて**
# 確かめる（数を網へ書き写さない・§9.163）。ここで見るのは、そこからは
# 見えない2つ:
#  ① `stat.*`の見本を**手で書いていない**（見本の測定値から数えている）
#  ② `sample_for()`が**その項目の刻み・上下限に乗った値**を返す
_rec0 = rb.sample_record()
_ms = _rec0.get('measurements') or {}
_prod = (_rec0.get('product') or {}).get('rows') or []


def _stat_now(key):
    if key == 'length':
        return rb._stat_of([r['productLength'] for r in _prod])
    if key == 'wall':
        return rb._stat_of([r['wallThickness'] for r in _prod])
    return rb._stat_of([v for row in _ms.get(key) or [] for v in row])


_drift = []
for _k in list(rb._SAMPLE_SERIES) + ['length', 'wall']:
    for _agg, _v in _stat_now(_k).items():
        if rb.SAMPLE_VALUES.get('stat.%s.%s' % (_k, _agg)) != _v:
            _drift.append('stat.%s.%s: 見本=%r 実測=%r'
                          % (_k, _agg, rb.SAMPLE_VALUES.get('stat.%s.%s' % (_k, _agg)), _v))
rec('§9.321 統計の見本は見本の測定値から数える（手書きの表を持たない）',
    not _drift, _drift[:6])

# ② 刻み・上下限。**「見本の値を入れる」でそのまま欄へ入る**ので、欄が
#    受け付けない値・欄を離れた瞬間に丸められる値を返してはいけない。
#    最後の1件は**刻みでは範囲に入れない**形（範囲を優先して下限を返す）。
_CASES = [
    ({'type': '数値', 'decimals': 1, 'min': 20, 'max': 60, 'step': 5}, 1, 5, 20, 60),
    ({'type': '数値', 'decimals': 2, 'min': 0.5, 'max': 3.0, 'step': 0.25}, 2, 0.25, 0.5, 3.0),
    ({'type': '正の整数', 'min': 1, 'max': 40, 'step': 1}, 0, 1, 1, 40),
    ({'type': '正の数', 'decimals': 1, 'step': 0.5}, 1, 0.5, None, None),
    ({'type': '数値', 'decimals': 3}, 3, None, None, None),
    ({'type': '数値', 'decimals': 1, 'min': 0.1, 'max': 0.2, 'step': 0.5}, 1, None, 0.1, 0.2),
]
_bad = []
for _it, _d, _step, _lo, _hi in _CASES:
    _v = rb.sample_for('settings.opData.見本', _it)
    _why = []
    _dec = 0 if '.' not in _v else len(_v.split('.')[1])
    if _dec != _d:
        _why.append('小数%d桁のはず' % _d)
    try:
        _n = float(_v)
    except ValueError:
        _n = None
        _why.append('数として読めない')
    if _n is not None:
        if _step and abs(_n / _step - round(_n / _step)) > 1e-9:
            _why.append('刻み%s に乗らない' % _step)
        if _lo is not None and _n < _lo:
            _why.append('下限%s 未満' % _lo)
        if _hi is not None and _n > _hi:
            _why.append('上限%s 超え' % _hi)
    if _why:
        _bad.append('%r → %r: %s' % (_it, _v, '／'.join(_why)))
rec('§9.321 操業データの見本は刻み・上下限・小数桁に乗る', not _bad, _bad)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print('%d/%d passed' % (len(R) - len(ng), len(R)))
for n, _o, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
