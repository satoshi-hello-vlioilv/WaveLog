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

import datetime  # noqa: E402

from backend import datetext, filter_sql, flags, rule_cells, safe_regex, sort_order, textnorm  # noqa: E402
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


# ---- P1b（§9.635）: 並べ替え・表示の書式・表示ルール・絞り込みの SQL ---------------------------------------------------
_NUMS = [None, '', ' ', '12', ' 12 ', '1,200', '1,2', '12,00', '-1,234.5', '+.5', '.5', '5.', '1e3', 'abc', '１２', '١٢', True, False,
         0, 3, 2.5, '12A', '1,234,567', ',123', '-', '00012']
_DATEKEYS = [None, '', '2026/08/01', '2026-8-1 9:30', '2026.08.01T09:30:15', '20260801', '20260801 0930', '202608010930',
             '20260801T093015', '2026/13/01', '2026/02/31', '2026/08/01 24:00', '２０２６/８/１', '26/08/01', 'x']
_NATURAL = [None, '', 'A2', 'A10', 'ロット3-12', '１２', 'x' + '9' * 25, 0, 12]
_SPECS = [None, '', {}, 'x', '{"buckets":["num","text"]}', {'buckets': ['text', 'num', 'zz', 'num']}, {'on': 'display'},
          {'natural': 1}, {'buckets': 'num'}, {'buckets': {'date': 1, 'empty': 2}}, {'buckets': [None, ' date ']}, [1], 0]
_FMT = [
    ({'kind': 'number'}, ['12', '12.5', '0.0001', '1234567.891', '1,200', '-0', 'x', '', 1e-7, 123456789]),
    ({'kind': 'number', 'decimals': 2}, ['1.005', '2.675', '0.125', '-1.5', '12']),
    ({'kind': 'number', 'decimals': '0'}, ['2.5', '3.5', '-2.5']),
    ({'kind': 'number', 'decimals': 'x'}, ['2.5']),
    ({'kind': 'number', 'decimals': -1}, ['2.5']),
    ({'kind': 'number', 'decimals': 1.9, 'thousands': True, 'prefix': '¥', 'suffix': '円'}, ['1234567.25', '-1234', '999']),
    ({'kind': 'number', 'thousands': True}, ['1234567', '0.00001234', '12345678901']),
    ({'kind': 'datetime'}, ['2026/08/01 09:05', '20260801', '9:05', 'x', '']),
    ({'kind': 'datetime', 'pattern': "yy/M/d (ddd) H:m:s tt 'yyyy'"}, ['2026/08/01 09:05:07', '2026/08/02 15:00']),
    ({'kind': 'datetime', 'pattern': 'yyyy年MM月dd日 dddd hh:mm'}, ['2026/08/03 00:30', '2026/08/03 12:30']),
    ({'kind': 'datetime', 'pattern': 'yyyy HH:mm'}, ['9:05']),
    ({'kind': 'text', 'prefix': '[', 'suffix': ']'}, [' a ', 'b']),
    ({'kind': 'zz'}, ['a']),
    (None, ['a', None, 3]),
]
_ROW = {'厚': '1.5', '幅': '1,200', '名': 'SUS304', '空': '', '日': '2026/08/01'}
_RULE_CONDS = [
    {'left': {'kind': 'self'}, 'op': 'eq', 'right': {'kind': 'value', 'value': '1.50'}},
    {'left': {'kind': 'self'}, 'op': 'ne', 'right': {'kind': 'value', 'value': '1.5'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'contains', 'right': {'kind': 'value', 'value': 'US'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'contains', 'right': {'kind': 'value', 'value': ''}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'startsWith', 'right': {'kind': 'value', 'value': 'SUS'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'endsWith', 'right': {'kind': 'value', 'value': '304'}},
    {'left': {'kind': 'column', 'column': '幅'}, 'op': 'gt', 'right': {'kind': 'value', 'value': '999'}},
    {'left': {'kind': 'column', 'column': '空'}, 'op': 'lt', 'right': {'kind': 'value', 'value': '1'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'ge', 'right': {'kind': 'value', 'value': 'SUS'}},
    {'left': {'kind': 'self'}, 'op': 'between', 'right': {'kind': 'value', 'value': '1'}, 'right2': {'kind': 'value', 'value': '2'}},
    {'left': {'kind': 'self'}, 'op': 'le', 'right': {'kind': 'column', 'column': '幅'}},
    {'left': {'kind': 'column', 'column': '空'}, 'op': 'empty'},
    {'left': {'kind': 'column', 'column': '無い'}, 'op': 'notEmpty'},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'regex', 'right': {'kind': 'value', 'value': r'^SUS\d{3}$'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'regex', 'right': {'kind': 'value', 'value': '(a+)+'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'regex', 'right': {'kind': 'value', 'value': '[unclosed'}},
    {'left': {'kind': 'column', 'column': '名'}, 'op': 'regex', 'right': {'kind': 'value', 'value': '(?i)sus'}},
    {'left': None, 'op': 'eq', 'right': {'kind': 'value', 'value': ''}},
    {'left': {'kind': 'value', 'value': None}, 'op': 'eq', 'right': {'kind': 'value', 'value': None}},
    {'left': {'kind': 'value', 'value': 3}, 'op': 'eq', 'right': {'kind': 'value', 'value': '3.0'}},
    {'left': {'kind': 'self'}, 'op': 'zz'},
]
_GROUP = {'kind': 'group', 'conditions': [_RULE_CONDS[0], dict(_RULE_CONDS[7], join='or')]}
_RULE_ROWS = [
    [{'text': '薄い', 'conditions': [_RULE_CONDS[0]]}, {'text': '既定', 'conditions': []}],
    [{'text': 'x', 'conditions': [_RULE_CONDS[1], dict(_RULE_CONDS[2], join='or')]}],
    [{'text': 'g', 'conditions': [_GROUP, _RULE_CONDS[6]]}, {'text': '', 'conditions': [_RULE_CONDS[5]]}],
    [{'text': 'e', 'conditions': [{'kind': 'group', 'conditions': []}]}],
    [{'text': '=a+1', 'conditions': [_RULE_CONDS[0]]}],
    [{'text': 'f', 'conditions': [{'op': 'formula'}]}],
    [{'text': 'c', 'conditions': [{'left': {'kind': 'calc'}, 'op': 'eq'}]}],
    [{'text': 'n', 'conditions': [_GROUP]}],
]
_SORT_ROWS = [{'id': i, 'v': v, 'w': w} for i, (v, w) in enumerate(
    [('10', 'b'), ('3', 'a'), ('', 'a'), ('A10', 'c'), ('A2', 'b'), ('2026/08/01', 'a'), (None, 'c'), ('3', 'b'), ('1,200', 'a'),
     ('a', 'b'), ('2025-1-1 9:00', 'c'), (' ', 'a')])]
_SORT_KEYS = [
    [{'col': 'v'}], [{'col': 'v', 'dir': 'desc'}], [{'col': 'v', 'spec': {'buckets': ['text', 'num', 'date', 'empty']}}],
    [{'col': 'v', 'dir': 'DESC', 'spec': {'buckets': ['empty', 'num'], 'natural': True}}],
    [{'col': 'w'}, {'col': 'v', 'dir': 'desc'}], [{'col': 'w', 'dir': 'desc', 'spec': {'natural': True}}, {'col': 'v'}], []]
_TABLE_COLS = ['名', '厚', '日', 'a]b']
_FILTERS = [
    None, '', 'x', '{}', [], [{'column': '名', 'op': 'contains', 'value': ' SUS '}],
    [{'column': '名'}, {'column': '無い', 'op': 'eq', 'value': '1'}, {'column': '名', 'op': 'zz', 'value': '1'}, 'bad',
     {'column': ' 厚 ', 'op': ' gte ', 'value': 5}],
    [{'column': '名', 'op': 'in', 'value': ['A', '', 3, None, True]}, {'column': '名', 'op': 'not_in', 'value': ['A', 'B']},
     {'column': '名', 'op': 'not_in', 'value': ['', 'B']}, {'column': '名', 'op': 'not_in', 'value': []}, {'column': '名', 'op': 'in', 'value': '["x"]'},
     {'column': '日', 'op': 'in', 'value': ['2026-08'], 'key': 'month'}, {'column': '日', 'op': 'not_in', 'value': ['2026'], 'key': 'year'},
     {'column': '日', 'op': 'in', 'value': ['2026-08-01'], 'key': 'date'}, {'column': '日', 'op': 'in', 'value': ['x'], 'key': 'week'}],
    [{'column': '名', 'op': 'eq', 'value': 'a'}, {'column': '名', 'op': 'neq', 'value': 'a'}, {'column': '名', 'op': 'starts', 'value': 'a'},
     {'column': '名', 'op': 'ends', 'value': 'a'}, {'column': '名', 'op': 'not_contains', 'value': 'a'}, {'column': '名', 'op': 'empty'},
     {'column': '名', 'op': 'not_empty'}, {'column': '名', 'op': 'starts_any', 'value': 'A,,B'}, {'column': '名', 'op': 'starts_any', 'value': ''},
     {'column': 'a]b', 'op': 'eq', 'value': 'x'}],
    [{'column': '厚', 'op': 'gt', 'value': '1,200'}, {'column': '厚', 'op': 'lte', 'value': 'abc'}, {'column': '厚', 'op': 'lt', 'value': '.5'}],
    [{'column': '日', 'op': 'date_range', 'value': '2026-08-01..2026-08-31'}, {'column': '日', 'op': 'date_range', 'value': '..2026-02-30'},
     {'column': '日', 'op': 'date_range', 'value': 'x'}, {'column': '日', 'op': 'within_days', 'value': '7'},
     {'column': '日', 'op': 'within_weeks', 'value': ' 2.9 '}, {'column': '日', 'op': 'within_months', 'value': '1'},
     {'column': '日', 'op': 'within_months', 'value': '13'}, {'column': '日', 'op': 'within_years', 'value': '-3'},
     {'column': '日', 'op': 'within_days', 'value': 'x'}, {'column': '日', 'op': 'within_days', 'value': '1_0'}],
    [{'column': 'k', 'op': 'tuple_in', 'value': [['A', 1], ['B', None], ['C', True], ['D'], [2.5, 'x'], 'z'], 'columns': ['名', '厚']},
     {'column': 'k', 'op': 'tuple_in', 'value': '[]', 'columns': ['名']}, {'column': 'k', 'op': 'tuple_in', 'value': [], 'columns': ['名', '名']},
     {'column': 'k', 'op': 'tuple_in', 'value': [], 'columns': ['無い']}, {'column': 'k', 'op': 'tuple_in', 'value': 'x', 'columns': ['名']}],
    [{'column': f'c{i}', 'op': 'eq'} for i in range(62)],
]
_TODAYS = ['2026-03-31', '2024-02-29', '2026-01-15']


# ---- P1c（§9.636）: ダッシュボードの式。問いは画面との突き合わせ（test_formulaparity）の例をそのまま使う --------------
def _formula_cases():
    sys.path.insert(0, str(ROOT / 'tests'))
    import test_formulaparity as tf  # 遅延: 式の領域を作るときだけ（corpus と py_answer の答えの形を共有する）
    out = [('answer', [c['expr'], c['row']], tf.py_answer) for c in tf.corpus()]
    # Rust の読み替え（formula.rs の translate・matches）で違いが出やすい形。画面との突き合わせの例には無い
    extra = ["match('a<b', '\\<')", "match('a>b', 'a\\>')", "match('ab', '\\<')", "match('ab', 'b\\>')", "match('a{b', 'a{')", "match('a}b', 'a}')", "match('aaa', 'a{,2}')",
             "match('a&b', '[&]')", "match('a~b', '[~]')", "match('a[b', '[[]')", "match('a-b', '[a-]')", "match('-', '[--z]')",
             "extract('L0123C4', 'C(\\d)', 1.5)", "extract('L0123C4', 'C(\\d)', 0.5)", "regreplace('abxd', 'x*', '-')",
             "regcount('abxd', 'x*')", "regreplace('a1b2', '\\d?', '#')", "match('ab', '\\Bb')", "match('a b', 'a\\b')",
             "regreplace('tab\tx', '\\t', '_')", "match('\x0b', '\\v')", "match('é', '\\w')", "match('٣', '\\d')",
             "extract('x123', '(?<n>\\d+)', 1)", "regreplace('ab', '(?<x>a)', '[$<x>|$<y>]')", "match('A', '\\cA')",
             "match('a', '\\u0061')", "match('a', '\\x61')", "match('\x00', '\\0')", "regreplace('aa', 'a', '$0$10$1')"]
    out += [('answer', [e, {'A': 'x'}], tf.py_answer) for e in extra]
    from backend.dashboard import formula as F
    calc = F.CalcColumns({'区分': "if([板厚(表示)] > 1, '厚', '薄')", '倍': '[重量] * 2', '倍の倍': '[倍] * 2', '重量': '[重量] + 1',
                          '自分': '[自分]', '壊れ': '[A'}, {'板厚': '板厚(表示)'}, ['板厚', '重量'])

    def calc_run(name, vals):
        if calc.broken(name):
            return {'broken': True}
        run, deps = calc.runner(name)
        return {'deps': deps, 'value': run(*vals)}
    out += [('calc_columns', [], lambda: {'calcs': calc.calcs, 'broken': [k for k in calc.compiled if calc.broken(k)]})]
    out += [('calc_run', [n, v], calc_run) for n, v in (('区分', [2]), ('区分', [0.5]), ('倍の倍', [10]), ('倍', [10]), ('自分', []), ('壊れ', []))]
    out += [('sql_value', [v], F.sql_value) for v in (3.0, 2.5, 1e16, -0.0, 'x', None, 9007199254740992.0)]
    out += [('clean_calc', [v], F.clean_calc) for v in (None, '', 'x', '{"formulas": {"a": "[b]+1", "c": " "}, "names": {"b": "B"}, "own": ["a", "z"]}',
                                                         {'formulas': {}}, {'formulas': {'a': 1, ' ': 'x', 'b': 'y' * 2100}}, [1])]
    out += [('check', [e], F.check) for e in ('', '   ', '[A] + 1', 'if([A] > [B], [C], [A])', '[A', 'concat([日本], [A], [日本])')]
    return out


def _today(s):
    return datetime.date.fromisoformat(s)


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
    so = [('num_of', [v], sort_order.num_of) for v in _NUMS] + \
         [('date_key', [v], sort_order.date_key) for v in _DATEKEYS] + \
         [('classify', [v], sort_order.classify) for v in _NUMS + _DATEKEYS + _NATURAL] + \
         [('natural_key', [v], sort_order.natural_key) for v in _NATURAL] + \
         [('normalize_spec', [x], sort_order.normalize_spec) for x in _SPECS] + \
         [('spec_json', [x], sort_order.spec_json) for x in _SPECS] + \
         [('describe', [x], sort_order.describe) for x in _SPECS] + \
         [('value_key', [sp, v], sort_order.value_key) for sp in (None, {'natural': True}) for v in _NUMS + _DATEKEYS + _NATURAL] + \
         [('bucket_rank', [sp, v], sort_order.bucket_rank) for sp in (None, {'buckets': ['text', 'empty']}) for v in _NUMS[:12]] + \
         [('format_value', [sp, v], sort_order.format_value) for sp, vs in _FMT for v in vs] + \
         [('rule_test', [c, _ROW, '厚'], sort_order.rule_test) for c in _RULE_CONDS] + \
         [('rule_match', [r, _ROW, '厚'], sort_order.rule_match) for r in _RULE_ROWS] + \
         [('rules_need_formula', [r], sort_order.rules_need_formula) for r in _RULE_ROWS] + \
         [('rule_leaves', [r[0]['conditions']], sort_order.rule_leaves) for r in _RULE_ROWS] + \
         [('display_text', [raw, fmt, rows, _ROW, '厚'], sort_order.display_text) for raw, fmt, rows in
          (('1.5', None, _RULE_ROWS[0]), ('9', {'kind': 'number', 'decimals': 1}, _RULE_ROWS[2]), ('9', {'kind': 'text', 'suffix': 'mm'}, None),
           ('', {'kind': 'number'}, None), ('7', None, [{'text': None, 'conditions': []}]))] + \
         [('order_rows', [_SORT_ROWS, k], lambda rows, keys: [r['id'] for r in sort_order.order_rows(rows, keys, lambda r, k: r.get(k['col']))])
          for k in _SORT_KEYS]
    fs = [('safe_filters', [f, _TABLE_COLS, ['計']], filter_sql.safe_filters) for f in _FILTERS] + \
         [('build_filter_where', [filter_sql.safe_filters(f, _TABLE_COLS, ['計']), t, {'計': '(A+B)'}],
           lambda f, t, e: filter_sql.build_filter_where(f, _today(t), e)) for f in _FILTERS for t in _TODAYS[:1]] + \
         [('cutoff_date', [op, v, t], lambda op, v, t: filter_sql.cutoff_date(op, v, _today(t)))
          for op in filter_sql.RELATIVE_OPS for v in ('0', '1', '12', '25', ' 3.9 ', 'x') for t in _TODAYS] + \
         [('date_range', [v], filter_sql.date_range) for v in ('2026-08-01..2026-08-31', '..', '', None, '2026-8-1..', '..2024-02-29', '2026-02-29..x', 'a..b..c')] + \
         [('slice_key', ['[日]', k], filter_sql.slice_key) for k in ('', 'date', 'month', 'year', 'week')] + \
         [('search_filter_where', [_TABLE_COLS, q, f, '2026-03-31', e], lambda cs, q, f, t, e: filter_sql.search_filter_where(cs, q, f, _today(t), e))
          for q, f, e in (('', '', None), (' a ', '', None), ('x', json.dumps(_FILTERS[5], ensure_ascii=False), {'計': 'X'}),
                          ('', [{'column': '計', 'op': 'gt', 'value': '1'}], {'計': '(A*2)'}))] + \
         [('ignored_filter_columns', [f, _TABLE_COLS, ['計']], filter_sql.ignored_filter_columns) for f in _FILTERS]
    return {'textnorm': tn, 'flags': fl, 'datetext': dt, 'safe_regex': rx, 'num_expr': ne, 'rule_cells': rc,
            'sort_order': so, 'filter_sql': fs, 'formula': _formula_cases()}


def _plain(v):
    """JSON に書ける形へ。組（tuple）は並び、有限でない数（inf・nan）は `{"$float": "inf"}`（JSON に無いので）、
    割れたサロゲート（JS の字を UTF-16 の単位で切った物・`formula.u16slice`）を持つ字は `{"$u16": [単位…]}`（UTF-8 に書けないので）。"""
    if isinstance(v, str) and any('\ud800' <= c <= '\udfff' for c in v):
        b = v.encode('utf-16-le', 'surrogatepass')
        return {'$u16': [int.from_bytes(b[i:i + 2], 'little') for i in range(0, len(b), 2)]}
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
