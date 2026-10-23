#!/usr/bin/env python3
"""test_formulaparity.py: サーバーの式（backend/dashboard/formula.py）が、画面の式（static/js/list/list-formula.js）と
同じ答えを出すか（§9.628・評価関数）。

ダッシュボードの数はサーバーが数えるので、パネルの計算列の式もサーバーで計算する。食い違うと、一覧に見える値と
ダッシュボードの数が合わなくなる。同じ式・同じ行を両方で計算して突き合わせる（LotScope の test_formula_parity と同じ作り）:
- 書いた例（数の書き方〈WaveLog の looseNum／strictNum・3 桁区切り・先頭のゼロ〉・15 桁の丸め・四捨五入・空欄の大小・
  UTF-16 の数え方・JavaScript の空白・正規表現の読み替え・置き換えの $1 など、違いが出やすい所）
- 作った例（決まった種から、関数・演算子・列・値をでたらめに組んだ式 1,500 個 × 行）
答え（数・字・空）と、その字（String(値)）と、読めない式の理由が全部合えば通る。
"""
import json
import math
import pathlib
import random
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.dashboard import formula as F  # noqa: E402

TOOL = ROOT / 'tests' / 'lib' / 'formula_parity.js'
NODE = shutil.which('node') or '/opt/node22/bin/node'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


VALUES = [None, "", " ", 0, 1, -1, 2.5, 10, 1200, 0.1, 1e21, 1e-7, 123456789012, "0", "010", "10", "1.0", "1,000", " 5 ", "+5", "-3.5e2", "12abc",
          "abc", "ABC def", "A5052", "H24", "L0123C4", "ｱｲｳ", "１２３", "　全角の空白　", "😀x", "x😀y", "Infinity", "1e3", ".5",
          "2026/10/16 08:30", "2026/10/01 8:15:00", "2026-10-01T09:45", "26/10/02 23:48:54", "2026年10月3日", "20261003", "8:15", "2026/02/30", "451", "141", "567", "仕掛", "検査待ち", "O'Neil", "a,b,c", "CR1 L-1 LS3", "﻿BOM", "ß", "İ"]
COLUMNS = ["A", "B", "C", "日本"]
REGEX = ["[0-9]+", "\\\\d+", "^L", "C(\\\\d)", "\\\\s", "(?<n>\\\\d)", ".", "\\\\w+$", "[^]", "a|b", "^$", "(x)?y", "[A-Z]{2,}", "\\\\.", "\\\\bdef"]
REPL = ["$1", "$&", "[$`]", "$'", "$<n>", "$$", "$9", "-", ""]
FUNCS1 = ["num", "text", "abs", "len", "trim", "upper", "lower", "hankaku",
          "lenb", "int", "ceil", "sqrt", "isnum", "isblank", "year", "month", "day", "hour", "minute", "weekday", "date", "roundup", "rounddown",
          "min", "max", "sum", "avg"]
FUNCS2 = ["round", "left", "right", "find", "contains", "startswith", "endswith", "cmp", "mid", "padleft", "extract", "match",
          "count", "regcount", "rept", "roundup", "rounddown", "datediff", "ifs", "min", "max", "sum", "avg", "kamadate"]
FUNCS3 = ["replace", "split", "mid", "padleft", "extract", "regreplace", "datediff", "switch", "ifs", "min", "sum"]

WRITTEN = [
    # 釜番 → 日付（版 3.51.2）: 月をまたぐ・第 6 週・読めない釜番・数の釜番・基準日の形
    "kamadate('451', '2026-10-23')", "kamadate('141', '2026-10-23')", "kamadate('567', '2026/10/23')", "kamadate(161, '2021/03/05 08:00')",
    "kamadate('111', '2026-12-28')", "kamadate('171', '2027-01-03')", "kamadate('0', '2026-10-23')", "kamadate('811', '2026-10-23')",
    "kamadate('１４１', '2026-10-23')", "kamadate(' 451 ', '2026-10-23')", "kamadate('451', 'x')", "kamadate([A], [B])",
    "[A] + [B]", "[A] - [B]", "[A] * [B]", "[A] / [B]", "[A] % [B]", "-[A]", "not [A]", "[A] and [B]", "[A] or [B]",
    "[A] = [B]", "[A] <> [B]", "[A] < [B]", "[A] <= [B]", "[A] > [B]", "[A] >= [B]", "[A] != 10",
    "0.1 + 0.2", "1 / 3", "10 % 3", "-7 % 3", "2 * 1000000000000000000000", "1 / 10000000", "round(2.5, 0)", "round(-2.5, 0)", "round(1.005, 2)",
    "left('abcdef', 2.7)", "right('abcdef', 0.5)", "right('abcdef', 2)", "mid('abcdef', 2.9, 2.5)", "mid('abcdef', 3)",
    "len('😀x')", "left('😀x', 1)", "right('x😀', 1)", "find('x😀y', 'y')", "replace('abc', '', '-')", "replace('😀', '', '-')",
    "padleft('7', 3)", "padleft('7', 5, 'ab')", "padleft('7', 2.9, '')", "padleft('😀', 4, '😀')",
    "trim('　a　')", "upper('ß')", "lower('İ')", "hankaku('１２３ＡＢＣ　ｱ')",
    "extract('L0123C4', '[0-9]+')", "extract('L0123C4', 'C(\\d)', 1)", "extract('L0123C4', 'C(\\d)', 2)", "extract('ab', '(x)?b', 1)",
    "extract('１２３', '\\d+')", "match('a\nb', 'a.b')", "match('ab\n', 'b$')", "match('x y', '\\s')", "match('x　y', '\\s')",
    "regreplace('a1b2', '(\\d)', '<$1>')", "regreplace('a1b2', '\\d', '$&$&')", "regreplace('abc', 'b', '[$`|$\\']')",
    "regreplace('a1', '(?<n>\\d)', '$<n>!')", "regreplace('abc', 'x*', '-')", "regreplace('ab', 'b', '$$')", "regreplace('ab', '(b)', '$01$2')",
    "split('a,b,c', ',', 2)", "split('a,b,c', ',', 9)", "split('abc', '', 1)", "coalesce('', [A], 'z')", "concat([A], '-', [B])",
    "if([A] > 1000, '重', '軽')", "if([A], 1)", "if([A] = '010', 'x', 'y')", "cmp([A], [B])", "cmp('5', '05')", "[A] = 10",
    "num('12abc')", "num('1,000')", "num('Infinity')", "num(' 3')", "num('.5e1x')", "text(1/3)", "text(100000000000000000000)",
    "'a' < 'b'", "'😀' > '￿'", "abs(-0)", "-0", "0 * -1", "[日本] + 1", "[無い列]", "[A] + [無い列]",
    # 版 3.46.0 で足した関数
    "count('1、2、3', '、')", "count('aaaa', 'aa')", "count('abc', '')", "count('😀😀x', '😀')", "regcount('a1b22c333', '[0-9]+')", "regcount('abc', 'x*')",
    "lenb('ｱ漢x12')", "lenb('😀')", "lenb('')", "rept('ab', 3)", "rept('ab', 2.9)", "rept('x', -1)", "len(rept('abc', 5000))",
    "min(3, [A], 1)", "max('a', 'b')", "sum(1, 2, '3x')", "avg(1, 2, 4)", "sum(0.1, 0.2, 0.3)", "int(-1.5)", "int('2.7')", "ceil(1.000001)", "ceil(-1.5)",
    "roundup(1.1, 1)", "roundup(1.11, 1)", "roundup(-2.01, 1)", "rounddown(-1.19, 1)", "rounddown(2.999, 2)", "roundup(0.1 + 0.2, 1)", "roundup(3)", "rounddown(9.99, 8.5)",
    "sqrt(2)", "sqrt(-1)", "isnum('010')", "isnum('10')", "isnum(1.5)", "isblank('　')", "isblank([A])",
    "ifs([A] > 5, '大', [A] > 1, '中', '小')", "ifs(0, 'x')", "switch([A], 10, 'ten', '010', 'zero', 'other')", "switch('B', 'A', 1, 'B', 2)",
    "year('2026/10/01 8:15:00')", "month('2026年10月3日')", "day('20261003')", "hour('2026-10-01T09:45')", "minute('8:15')", "year('8:15')",
    "weekday('2026/10/01')", "weekday('1969/12/31')", "weekday('0000/03/01')", "date('26/10/02 23:48:54')", "date('2026/02/30')", "date('2024/02/29')",
    "datediff('2026/10/01 8:15:00', '2026-10-01T09:45', 'm')", "datediff('26/10/02 23:48:54', '2026年10月3日')", "datediff('8:00', '9:30', '時間')",
    "datediff('2026/10/01', '2026/10/02', 'x')", "datediff([A], [B], 's')",
    # 読めない式（理由が同じか）
    "", "[A", "'abc", "foo(1)", "if(1)", "round(1)", "left('a')", "match('a', '[')", "1 +", "(1", "1 2", "#", "mid('a')", "count('a')", "ifs(1)", "switch(1, 2)", "regcount('a', '(')", "min()",
]


def rnd_expr(r, depth=0):
    k = r.random()
    if depth > 3 or k < 0.25:
        c = r.random()
        if c < 0.45:
            return f"[{r.choice(COLUMNS)}]"
        if c < 0.75:
            return r.choice(["0", "1", "2", "3", "10", "2.5", "0.5", "1000", "7"])
        return "'" + r.choice([v for v in VALUES if isinstance(v, str) and "'" not in v and "\n" not in v]) + "'"
    if k < 0.45:
        op = r.choice(["+", "-", "*", "/", "%", "=", "<>", "<", ">=", " and ", " or "])
        return f"({rnd_expr(r, depth + 1)} {op} {rnd_expr(r, depth + 1)})"
    if k < 0.5:
        return f"{r.choice(['-', 'not '])}{rnd_expr(r, depth + 1)}"
    if k < 0.58:
        return f"if({rnd_expr(r, depth + 1)}, {rnd_expr(r, depth + 1)}, {rnd_expr(r, depth + 1)})"
    if k < 0.66:
        return f"{r.choice(['concat', 'coalesce'])}({', '.join(rnd_expr(r, depth + 1) for _ in range(r.randint(1, 3)))})"
    if k < 0.76:
        return f"{r.choice(FUNCS1)}({rnd_expr(r, depth + 1)})"
    name = r.choice(FUNCS2 + FUNCS3)
    n = 3 if name in FUNCS3 and (name not in FUNCS2 or r.random() < 0.5) else 2
    args = [rnd_expr(r, depth + 1)]
    if name in ("extract", "match", "regreplace"):
        args.append("'" + r.choice(REGEX).replace("\\\\", "\\") + "'")
        if n == 3:
            args.append("'" + r.choice(REPL) + "'" if name == "regreplace" else r.choice(["0", "1", "2", "1.5"]))
    elif name == "round":         # 桁に小数を書いたときの最後の桁は合わない（formula.py の説明）。桁は整数で
        args.append(r.choice(["0", "1", "2", "-1", "9"]))
    else:
        args += [rnd_expr(r, depth + 1) if r.random() < 0.5 else r.choice(["0", "1", "2", "3", "-1", "2.5", "', '", "''"]) for _ in range(n - 1)]
    return f"{name}({', '.join(args)})"


def rnd_row(r):
    return {c: r.choice(VALUES) for c in COLUMNS if r.random() < 0.95}


def corpus():
    r = random.Random(20261016)
    rows = [{"A": 1200, "B": 400, "C": "A5052", "日本": "仕掛"}, {"A": "010", "B": 10, "C": None, "日本": ""}] + [rnd_row(r) for _ in range(4)]
    cases = [{"expr": e, "row": row} for e in WRITTEN for row in rows[:3]]
    cases += [{"expr": rnd_expr(r), "row": rnd_row(r)} for _ in range(1500)]
    return cases



# WaveLog の数の読み方（§9.581）で違いが出やすい所（LotScope の版には無い例）
WRITTEN += [
    "'1,200' + 1", "num('1,2')", "num('12,000.5')", "num('12A')", "num('.5')", ".5 + 1", "'010' = 10", "'010' + '3'", "'12A' + '3'",
    "[A] < 5", "'' < 5", "' ' >= 0", "'' = ''", "round(1.005, 2)", "round(-2.5, 0)", "round(2.675, 2)", "0.1 * 3", "1 - 0.9",
    "sum(0.1, 0.2)", "avg(0.1, 0.2, 0.3)", "datediff('2026/10/01 08:00', '2026/10/01 08:00:20', 'm')", "sqrt(0.0004)", "isnum('1,200')",
    "isnum('0.5')", "isnum('007')", "switch('1,200', 1200, 'ok', 'ng')",
]


def py_answer(expr, row):
    chk = F.check(expr)
    if not chk['ok']:
        return {'ok': False, 'error': chk['error']}
    v = F.Formula(expr).run(lambda c: row.get(c))
    if isinstance(v, float) and not math.isfinite(v):
        return {'ok': True, 'value': '#' + F.js_num_text(v), 'text': F.js_num_text(v)}
    return {'ok': True, 'value': v, 'text': F.text_of(v)}


def same(js, py):
    if js['ok'] != py['ok']:
        return False
    if not js['ok']:
        # 壊れた正規表現の理由の後半は、正規表現の仕組みの言葉（JavaScript と Python で違う）。前半が合えばよい
        head = 'の正規表現として読めません: '
        return js['error'] == py['error'] or (head in js['error'] and js['error'].split(head)[0] == py['error'].split(head)[0])
    a, b = js['value'], py['value']
    num = (int, float)
    if isinstance(a, num) and isinstance(b, num) and not isinstance(a, bool):
        return float(a) == float(b) and js['text'] == py['text']     # JSON の大きな数は整数で読まれるので実数で比べる
    return a == b and js['text'] == py['text']


def main():
    cases = corpus()
    with tempfile.TemporaryDirectory() as d:
        src = pathlib.Path(d) / 'cases.json'
        src.write_text(json.dumps(cases, ensure_ascii=False), encoding='utf-8')
        r = subprocess.run([NODE, str(TOOL), str(src)], capture_output=True, text=True, encoding='utf-8', timeout=120)
    rec('画面の式を node で計算できた', r.returncode == 0, r.stderr[:300])
    if r.returncode:
        return
    js = json.loads(r.stdout)
    bad = [(c['expr'], c['row'], j, p) for c, j in zip(cases, js) if not same(j, p := py_answer(c['expr'], c['row']))]
    ok_n = sum(1 for j in js if j['ok'])
    rec('読める式が 6 割より多い（作った例の作り方が効いている）', ok_n > len(cases) * 0.6, f'{ok_n}/{len(cases)}')
    rec(f'サーバーの式が画面と同じ答え（{len(cases)} 件）', not bad, f'{len(bad)} 件が食い違い。最初の 5 件: ' + ' ／ '.join(
        f'{e!r} 行 {json.dumps(row, ensure_ascii=False)} 画面 {json.dumps(j, ensure_ascii=False)} サーバー {json.dumps(p, ensure_ascii=False)}'
        for e, row, j, p in bad[:5]))
    # 計算列の引き方（画面の baseRow と同じ）: 表示名・ほかの式の列を 1 段たどる・自分は空
    calc = F.CalcColumns({'区分': "if([板厚(表示)] > 1, '厚', '薄')", '倍': '[重量] * 2', '倍の倍': '[倍] * 2', '重量': '[重量] + 1', '自分': '[自分]'},
                         {'板厚': '板厚(表示)'}, ['板厚', '重量'])
    rec('表に無い列の式だけが計算列', calc.calcs == ['区分', '倍', '倍の倍', '自分'], str(calc.calcs))
    run, deps = calc.runner('区分')
    rec('表示名で書いても元の列を読む', (deps, run(2)) == (['板厚'], '厚'))
    run, deps = calc.runner('倍の倍')
    rec('計算列から計算列は元の値で 1 段（10*2*2）', (deps, run(10)) == (['重量'], 40))
    run, deps = calc.runner('倍')
    rec('表にある列の式（作り替え）は、計算列の中で [その列] と書くと効く（(10+1)*2）', run(10) == 22)
    run, deps = calc.runner('自分')
    rec('自分を読む式は空', (deps, run()) == ([], None))
    rec('整数に読める答えは整数（字にすると「3」）', F.sql_value(3.0) == 3)
    # 画面とサーバーの関数の顔ぶれが同じ（足したら両方へ）
    names = subprocess.run([NODE, '-e', "const vm=require('vm'),fs=require('fs');const c={window:{WL:{}},console};vm.createContext(c);"
                            "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);"
                            "process.stdout.write(JSON.stringify(c.window.WL.formula.sigs.map(x=>x[0])))",
                            str(ROOT / 'static' / 'js' / 'list' / 'list-formula.js')], capture_output=True, text=True, encoding='utf-8')
    js_names = set(json.loads(names.stdout or '[]')) - {'if', 'and', 'or', 'not'}
    rec('画面とサーバーの関数の顔ぶれが同じ', js_names == set(F.FUNCS), f'画面だけ {sorted(js_names - set(F.FUNCS))} サーバーだけ {sorted(set(F.FUNCS) - js_names)}')


if __name__ == '__main__':
    main()
    ng = [x for x in R if not x]
    print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
    sys.exit(1 if ng else 0)
