# -*- coding: utf-8 -*-
"""parity_cases.py: Python と Rust の同じ関数が同じ答えを出すかの**試験表**（§9.634・計画 docs/RUST_MIGRATION_PLAN.md P1）。

**答えの正は Python**（移し終えるまで、利用者の端末で動いているのは Python のほう）。ここに並べた問いを Python の関数へ
通し、答えを `tests/fixtures/parity/<領域>.json` に書く。Rust（`desktop/core/tests/parity.rs`）は同じ表を読み、
同じ問いに同じ答えを返すかを `cargo test` で見る。網 `test_parity.py` は「表が今の Python の答えと同じか」を見る
（Python を直したのに表が古いと、Rust は古い答えに合わせてしまう）。

問いは**違いが出やすい所**を選ぶ: Python の `str()`（`1.0`・`1e-05`・`True`）、`strip()` の空白（全角・`\\x1c`）、
`\\d` が全角や他の字の数字にも当たること、2桁の年・閏日・14 桁の日時・午前／午後、入れ子の繰り返し、0 で割る・
累乗の行き過ぎ、壊れた条件の行。

使い方:
  python3 tests/lib/parity_cases.py --write   表を作り直す
  python3 tests/lib/parity_cases.py           表の問いの数を出す
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'tests' / 'fixtures' / 'parity'
sys.path.insert(0, str(ROOT))

from backend import datetext, flags, rule_cells, safe_regex, textnorm  # noqa: E402
from backend.dashboard import num_expr  # noqa: E402

# ---- 問い ---------------------------------------------------------------------------------------------------------
_TEXTS = ['', ' ', None, 'ＡＢＣ　１２３', 'abc', ' Line-1 ', 'ｶﾞｲﾄﾞ', 'Straße', 'ǅ', '①②', 'ﬁ', '　設備Ａ　',
          '\x1c設備\x1f', 'İstanbul', 'ΣΑΣ', 12, 1.5, True]
_FLAGS = [None, '', ' ', '無効', ' 無効 ', '有効', '出さない', 'しない', 'できない', '載せない', 'false', 'False', '0', '1',
          'true', True, False, 0, 1, 2.5, 0.0, '登録しない', 'x']
_DATES = [None, '', '  ', '2026/9/5', '2026-09-28 10:00', '2026.09.28', '2026-09-28T10:00', '2026年9月28日', '2026年 9月 28日 午後',
          '20260928', '20260928 1200', '26/09/28 23:48:54', '2026/02/29', '2024/02/29', '2026/13/01', '２０２６/９/５',
          '２０２６年９月５日', '٢٠٢٦-٠٩-٠٥', 'abc', '2026/9', 20260928, 2026.5, '1899/12/30 8:15:00', '99/1/1']
_TIMES = [None, '', '8:15', '08:15:30', '1899/12/30 8:15:00', '2026-10-01T08:15', '25:00', '8:60', '8:15 PM', '8:15:00.123 am',
          '１２:３０', 'x8:15', '2026/10/02 午後 8:15:00', 815, '8:15:61']
_DT = [None, '', '2026/10/01 8:15:00', '2026-10-01', '2026-10-01T08:15', '20261002201500', 20261002201500, '20261302201500',
       '20261002241500', '2026/10/02 午後 8:15:00', '2026/10/02 8:15:00 PM', '2026/10/02 12:15:00 AM', '2026/10/02 12:15:00 PM',
       '2026/10/02 13:15:00 PM', '2026年10月2日 8:15', '26/10/02 8:15', '2026/10/02 8:15:00.5', '2026/02/30 8:15', 'abc',
       '2026/10/02 25:00', ' 2026/10/01 8:15 ', '2026/10/01 8:15 Amazon', 1.0, True]
_DT_TIME = [('2026/10/01', '8:15'), ('2026/10/01', '1899/12/30 9:30:15'), ('2026/10/01', 'abc'), ('2026/10/01 7:00', '8:15'),
            ('2026年10月1日', '午後 8:15:00'), ('2026/10/01', '8:15 PM'), ('20261001', '8:15'), (None, '8:15')]
_SORT = [None, '', '  ', ' 54', '1e-05', '1.5', '-3', '+2', 'e', '.', '1,000', 'abc', ' abc ', 54, 1.5, '１２', '1.2.3', '1e400',
         '0x10', 'inf', 'nan', '12abc']
_REGEX = ['', None, 'a+', '(a+)+', '(a*)*', r'(\w+\s?)+', '(.*a){12}', '(.*a){1}', '(a|b)+', '(a){2,}', '(a+){0,1}', '(?:a+)+',
          '(?P<n>a+)+', '(?=a+)+', r'\(a+\)+', '[(]a+[)]+', '[]a+]+', '[^]a]+', '((a)+)', '((a)+)+', '(a?)+', '(a+?)+',
          '(a{2})+', '(a{,3})+', '(a{})+', 'x{3}', '(ab)+c', '(a+)b(c+)+', '((?:ab)+)+', '\\']
_EXPR = [('÷1000', [1500, 0, -2.5]), ('×100', [0.25]), ('x*2', [3]), ('(値−10)×2', [12, 10]), ('+5', [1]), ('-3', [10]),
         ('x^2', [-3, 1.5]), ('x^0.5', [-4, 9]), ('2^x', [2000, 3]), ('x/0', [1]), ('1/(x-1)', [1, 2]), ('', [1]),
         ('５＋ｘ', [2]), ('10', [1]), ('x+', [1]), ('(x+1', [1]), ('x)', [1]), ('x a', [1]), ('x**2', [3]), ('xx', [2]),
         ('1.', [0]), ('.5x', [2]), ('-x', [4]), ('--x', [4]), ('x--1', [1]), ('2^3^2', [0]), ('x ÷ 3', [10]),
         ('x×1.5e3', [1]), ('X+1', [1]), ('ｘ+1', [1]), ('x+١', [1]), ('x✕2', [3]), ('x–1', [3]), ('(x)', [7]), ('()', [1])]
_PREFIX = [('source.ロット', 'source.'), ('source.', 'source.'), (' source.a ', 'source.'), ('source.a[1]', 'source.'),
           ('x.a', 'source.'), ('source.' + 'あ' * 73, 'source.'), ('source.' + 'あ' * 74, 'source.'), (None, 'source.')]
_ALLOWED = ['板厚', '材質', '幅']
_CONDS = [
    None, 'x', [],
    [{'field': '板厚', 'op': 'ge', 'value': ' 1.5 '}, {'field': '材質', 'op': 'eq', 'value': 'SUS'}],
    [{'field': '板厚', 'op': 'between', 'value': '1', 'value2': '2'}, {'field': '幅', 'op': 'empty', 'value': 'x'}],
    [{'field': '不明', 'op': 'eq', 'value': '1'}, {'field': '板厚', 'op': 'zz', 'value': '1'}, 'bad',
     {'field': '材質', 'op': 'contains', 'value': None}],
    [{'field': '板厚', 'op': 'eq', 'value': '1', 'or': True}, {'field': '板厚', 'op': 'eq', 'value': '2', 'or': True},
     {'field': '材質', 'op': 'eq', 'value': 'A', 'or': 'yes'}],
    [{'field': ' 板厚 ', 'op': ' regex ', 'value': 'あ' * 130}, {'field': 'source.厚', 'op': 'notEmpty'}],
    [{'field': '板厚', 'op': 'eq', 'value': 5}, {'field': '板厚', 'op': 'lt', 'value': 1.0}, {'field': '板厚', 'op': 'gt', 'value': True}],
]
_COLS = [None, 'x', [], ['板厚', '材質', '板厚', ' 幅 ', '不明', None, 'source.厚'], ['板厚'] * 3 + ['source.c%d' % i for i in range(50)]]


def _field_ok(field):
    """試験の列の見分け: 決めた列か、`source.`の付いた列（呼ぶ側が渡す`field_ok`の代わり）。"""
    return field in _ALLOWED or rule_cells.prefixed_field(field, 'source.')


def _expr(src, xs):
    fn, msg, text = num_expr.compile_expr(src)
    return [None if fn is None else [fn(x) for x in xs], msg, text]


# 領域 → [(関数の名前, 引数の並び, Python の答えを出す関数)]
def cases():
    tn = [('normalize_equipment_name', [v], textnorm.normalize_equipment_name) for v in _TEXTS] + \
         [('search_fold', [v], textnorm.search_fold) for v in _TEXTS]
    fl = [('flag_of', [v], flags.flag_of) for v in _FLAGS] + \
         [('text_or', [x, 'enabled'], flags.text_or) for x in
          ({'enabledText': '無効', 'enabled': True}, {'enabled': False}, {}, {'enabledText': None, 'enabled': 1}, {'enabledText': ''})]
    dt = [('sort_key', [v], datetext.sort_key) for v in _SORT] + \
         [('to_date', [v], datetext.to_date) for v in _DATES] + \
         [('to_minutes', [v], datetext.to_minutes) for v in _TIMES] + \
         [('to_datetime', [v], datetext.to_datetime) for v in _DT] + \
         [('to_datetime', [v, t], datetext.to_datetime) for v, t in _DT_TIME]
    rx = [('risk', [p], safe_regex.risk) for p in _REGEX]
    ne = [('compile_expr', [s, xs], _expr) for s, xs in _EXPR]
    rc = [('prefixed_field', [f, p], rule_cells.prefixed_field) for f, p in _PREFIX] + \
         [('normalize_conditions', [c], lambda c: rule_cells.normalize_conditions(c, _field_ok)) for c in _CONDS] + \
         [('normalize_cols', [c], lambda c: rule_cells.normalize_cols(c, _field_ok)) for c in _COLS] + \
         [('table_cols', [['材質'], [{'conditions': [{'field': '板厚'}, {'field': '材質'}]}, {'conditions': None}, {}]],
           lambda s, r: rule_cells.table_cols(s, r, _field_ok))]
    return {'textnorm': tn, 'flags': fl, 'datetext': dt, 'safe_regex': rx, 'num_expr': ne, 'rule_cells': rc}


def _plain(v):
    """JSON に書ける形へ。組（tuple）は並び、有限でない数（inf・nan）は `{"$float": "inf"}`（JSON に無いので）。"""
    if isinstance(v, float) and v != v:
        return {'$float': 'nan'}
    if isinstance(v, float) and v in (float('inf'), float('-inf')):
        return {'$float': 'inf' if v > 0 else '-inf'}
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


def table(area):
    """1つの領域の試験表（JSON に書く形）。"""
    return [{'fn': fn, 'args': args, 'want': _plain(run(*args))} for fn, args, run in cases()[area]]


def text(area):
    return json.dumps(table(area), ensure_ascii=False, indent=0, allow_nan=False) + '\n'


if __name__ == '__main__':
    if '--write' in sys.argv:
        OUT.mkdir(parents=True, exist_ok=True)
        for a in cases():
            (OUT / f'{a}.json').write_text(text(a), encoding='utf-8')
        print('書き直しました: ' + ', '.join(f'tests/fixtures/parity/{a}.json' for a in cases()))
    else:
        print({a: len(v) for a, v in cases().items()})
