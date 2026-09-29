#!/usr/bin/env python3
"""test_funclen.py: 長い関数を「増やさない」（REVIEW 3-22・§9.519）

1つの関数が数百行あると、途中の1行を直すにも全体の局所変数を頭に置く
ことになる（`renderGridInner` は 554行で、30近い局所変数を8つの役目が
共有していた）。段ごとに関数へ切り出せば、段ごとに読んで・直して・試せる。

ここで見張るのは**増えないこと**。80行を超える関数について、ファイルごとに
 ・本数
 ・超過行数の合計（各関数の「行数−80」を足したもの）
の2つを `tests/fixtures/funclen_baseline.json` に固定し、**下げる方向だけ**
動かせる（`test_importlint`／`test_eslint` の baseline と同じ作法）。
関数の名前や行番号では固定しない——切り出して名前が変わったり、上に
1行足して位置がずれたりしただけで落ちる網は、直す人を止めるだけになる。
減ったら `python3 tests/test_funclen.py --update` で上限を下げる。

数え方:
 * JS（`static/js`）は eslint の `max-lines-per-function`。**ファイルを丸ごと
   包む IIFE は数えない**（`IIFEs:false`・§9.359 で全部閉じたので、数えると
   全ファイルが1本の長い関数になる）。eslint の探し方は `test_eslint` の1箇所。
 * Python（`backend`・`program`）は `ast` の `end_lineno - lineno + 1`。
 * どちらも**空行と説明の行も数える**（読む人は説明ごと読む）。入れ子の
   関数は外側にも内側にも数える——内側を外へ出せば両方減る。
"""
import ast
import json
import pathlib
import re
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from test_eslint import eslint_cmd  # noqa: E402  探し方は1箇所（§9.326）

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASELINE = ROOT / 'tests' / 'fixtures' / 'funclen_baseline.json'
LIMIT = 80
JS_DIR = 'static/js'
PY_DIRS = ('backend', 'program')
RULE = json.dumps({'max-lines-per-function': ['warn', {'max': LIMIT, 'IIFEs': False}]})
LEN_RE = re.compile(r'\((\d+)\)')
NAME_RE = re.compile(r'^(.*?) has too many lines')
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def js_long(cmd, targets=(JS_DIR,), stdin=None, stdin_name=None):
    """[(rel, 行, 名前, 行数)]。stdin を渡すとファイルへ書かずに調べる（本物の置き場を汚さない・§9.504）。"""
    args = cmd + ['-f', 'json', '--no-error-on-unmatched-pattern', '--rule', RULE]
    args += (['--stdin', '--stdin-filename', stdin_name] if stdin is not None else list(targets))
    r = subprocess.run(args, input=stdin, capture_output=True, text=True, cwd=str(ROOT), timeout=600)
    try:
        data = json.loads(r.stdout)
    except ValueError:
        raise RuntimeError('eslint の出力が読めません: ' + (r.stderr or r.stdout)[:400])
    out = []
    for f in data:
        rel = pathlib.Path(f['filePath']).resolve().relative_to(ROOT).as_posix()
        for m in f['messages']:
            if m.get('ruleId') != 'max-lines-per-function':
                continue
            n = LEN_RE.search(m['message'])
            name = NAME_RE.search(m['message'])
            out.append((rel, m['line'], name.group(1) if name else '?', int(n.group(1)) if n else 0))
    return out


def py_long_src(src, rel):
    out = []
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            n = node.end_lineno - node.lineno + 1
            if n > LIMIT:
                out.append((rel, node.lineno, node.name, n))
    return out


def py_long():
    out = []
    for d in PY_DIRS:
        for p in sorted((ROOT / d).rglob('*.py')):
            out += py_long_src(p.read_text(encoding='utf-8'), p.relative_to(ROOT).as_posix())
    return out


def tally(found):
    """{rel: [本数, 超過行数の合計]}"""
    t = {}
    for rel, _, _, n in found:
        c = t.setdefault(rel, [0, 0])
        c[0] += 1
        c[1] += n - LIMIT
    return t


def main(update=False):
    cmd = eslint_cmd()
    rec('eslint がある（無いと JS を数えられない・黙って通さない）', bool(cmd),
        'npm i -g eslint（v9以上）' if not cmd else cmd[0])
    if not cmd:
        return
    found = js_long(cmd) + py_long()
    now = tally(found)
    rec('数える相手がいる（網が空振りしていない）', len(now) >= 20, f'{len(now)}ファイル')
    base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    over, under = [], []
    for k in sorted(set(now) | set(base)):
        n, b = now.get(k, [0, 0]), base.get(k, [0, 0])
        if n[0] > b[0] or n[1] > b[1]:
            over.append(f'{k} 本数{b[0]}→{n[0]}・超過{b[1]}→{n[1]}行')
        elif n != b:
            under.append(f'{k} 本数{b[0]}→{n[0]}・超過{b[1]}→{n[1]}行')
    if update:
        if over and base:
            print('!! 上限を上げる更新はしません: ' + '; '.join(over[:10]))
        else:
            BASELINE.parent.mkdir(exist_ok=True)
            BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                encoding='utf-8')
            print(f'baseline を書き直しました: {BASELINE.relative_to(ROOT)} ({len(now)} files)')
            base = now
            over, under = [], []
    tot_n = sum(v[0] for v in now.values())
    tot_x = sum(v[1] for v in now.values())
    rec(f'{LIMIT}行を超える関数がファイルごとの上限を超えていない（本数・超過行数とも・増えたら落ちる）',
        not over, '; '.join(over[:12]) or f'いま {tot_n}本・超過 {tot_x}行 / {len(now)}ファイル')
    if under:
        print('   注: 上限を下げられます（python3 tests/test_funclen.py --update）: '
              + '; '.join(under[:8]) + (' …' if len(under) > 8 else ''))
    rec('baseline がある（無いと「増えた」を言えない）', BASELINE.exists(), str(BASELINE.relative_to(ROOT)))
    # 網そのものが素通りしないこと（ファイルへは書かない）
    body = '\n'.join(f' x+={i};' for i in range(LIMIT + 5))
    js = f'(function(){{\nfunction longOne(){{\n let x=0;\n{body}\n return x;\n}}\nwindow.zzLong=longOne;\n}})();\n'
    got = js_long(cmd, stdin=js, stdin_name=f'{JS_DIR}/_funclen_probe.js')
    rec('網そのものが素通りしない（JS: 長い関数を1本数え、包んだ IIFE は数えない）',
        [g[2] for g in got] == ["Function 'longOne'"], got)
    py = 'def long_one():\n    x = 0\n' + ''.join(f'    x += {i}\n' for i in range(LIMIT)) + '    return x\n'
    got = py_long_src(py, '_probe.py')
    rec('網そのものが素通りしない（Python: 長い関数を1本数える）', [g[2] for g in got] == ['long_one'], got)
    top = sorted(found, key=lambda x: -x[3])[:8]
    print('  残っている上位: ' + ', '.join(f'{name}（{rel}:{line}）{n}行' for rel, line, name, n in top))


if __name__ == '__main__':
    try:
        main(update='--update' in sys.argv)
    except Exception as e:  # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    n_ok = sum(1 for x in R if x)
    print(f'\n{n_ok} PASS / {len(R) - n_ok} FAIL')
    sys.exit(0 if all(R) else 1)
