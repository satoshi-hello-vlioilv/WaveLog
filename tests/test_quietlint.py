# -*- coding: utf-8 -*-
"""test_quietlint.py: 「黙って捨てる」を0件に固定する（§9.328、REVIEW 3-4）。

============================================================
なぜ要るか
------------------------------------------------------------
`except Exception: pass` と `catch(e){}` は**何が起きても誰にも見えない**。
§9.190で「`.catch(()=>{})`が403を握り潰し、鍵が外れる不具合に誰も気づけ
なかった」が既に起きており、§9.317・§9.271でも「黙ったせいで打つ手が無い」を
繰り返し踏んでいる。**捨てること自体は正しい場面が多い**（共有が読めなくても
画面は出す、端末の設定が壊れていても既定で続ける）ので禁じない。要求するのは
**なぜ捨ててよいのかを1行書くこと**だけで、書けば`WL.quiet`／`quiet()`が
`console.debug`／DEBUGログへ残す。

------------------------------------------------------------
「黙っている」の定義（Python）
------------------------------------------------------------
**広い except**（`except:` ／ `Exception` ／ `BaseException`）の本体が
  * 関数を1つも呼ばず、かつ
  * 束縛した例外名（`as e`の`e`）を1度も読まない
とき。`pass`・`return None`・`return {}`・`continue`がこれに当たる。

**`return False, f'{e}'` や `return jsonify(error=str(e)),500` は数えない**
——理由を呼び出し元へ返している＝黙っていない。狭いexcept
（`except FileNotFoundError:`）も数えない（**何を捨てたか綴りが語る**）。

------------------------------------------------------------
「黙っている」の定義（JS）
------------------------------------------------------------
`catch(e){}`（本体が空）と `.catch(()=>{})`。対象は`static/js`だけで、
**テストは対象外**（網の中の見送りは製品の挙動ではない）。

------------------------------------------------------------
約束
------------------------------------------------------------
 * 理由は**空にしない**（`WL.quiet.note('')`・`quiet('')`を数える）。
 * `backend/quiet.py`と`static/js/core/base.js`の`WL.quiet`自身は窓口なので対象外
   （**ここで黙るのは理由を出す道そのもの**）。
 * 網そのものが素通りしないことを確かめる（欠陥を注いで数えられるか）。
============================================================
"""
import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
R = []
# 窓口そのもの。ここを対象にすると「理由を出す道」が書けない。
EXEMPT_PY = {'backend/quiet.py'}


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def py_files():
    for name in ('app.py', 'start_app.py', 'process_manager.py'):
        p = ROOT / name
        if p.exists():
            yield p
    for p in sorted((ROOT / 'backend').rglob('*.py')):
        yield p


def is_broad(h):
    """広い except か（何を捨てたのか綴りが語らないもの）。"""
    t = h.type
    if t is None:
        return True
    if isinstance(t, ast.Name) and t.id in ('Exception', 'BaseException'):
        return True
    if isinstance(t, ast.Tuple):
        return any(isinstance(e, ast.Name) and e.id in ('Exception', 'BaseException')
                   for e in t.elts)
    return False


def is_silent(h):
    """本体が何も呼ばず、束縛した例外名も読まない＝黙っている。"""
    names, calls = set(), 0
    for n in ast.walk(ast.Module(body=h.body, type_ignores=[])):
        if isinstance(n, ast.Call):
            calls += 1
        elif isinstance(n, ast.Name):
            names.add(n.id)
    if calls:
        return False
    return not (h.name and h.name in names)


def scan_py(files):
    out = []
    for p in files:
        rel = p.relative_to(ROOT).as_posix()
        if rel in EXEMPT_PY:
            continue
        try:
            tree = ast.parse(p.read_text(encoding='utf-8'))
        except SyntaxError as e:
            out.append((rel, getattr(e, 'lineno', 0), 'parse: ' + str(e)))
            continue
        for n in ast.walk(tree):
            if isinstance(n, ast.ExceptHandler) and is_broad(n) and is_silent(n):
                out.append((rel, n.lineno, 'silent except'))
    return out


def strip_js(src):
    """コメントと文字列の中身を空白へ落とす（行番号と長さは保つ）。

    **説明文が規則の綴りを引用しているだけで数えられるのを避ける**（§9.286 ⑦の
    「印そのものを引用する文」と同じ問題）。同時に、**中身がコメントだけの
    catch は数える側へ回る**——読む人には理由が見えても、実行時には何も残らない
    （Python側で`pass`の上のコメントを数えないのと同じ扱い）。

    **正規表現リテラルを見分けること**——`/'/` のような1文字を見落とすと、
    そこから先が「文字列の中」になり**残り全部を数えない**（緩む側に壊れる。
    実際に`list-view.js`で1件を見落とした）。`/`の直前の意味のある文字で
    「割り算か正規表現か」を決める（JSの構文解析器と同じ見分け方）。
    """
    out = []
    i, n, st, q = 0, len(src), 'code', ''
    prev = ''          # 直前の意味のある文字（空白・コメントは飛ばす）
    while i < n:
        c = src[i]
        nx = src[i + 1] if i + 1 < n else ''
        if st == 'code':
            if c == '/' and nx == '*':
                st = 'block'; out.append('  '); i += 2; continue
            if c == '/' and nx == '/':
                st = 'line'; out.append('  '); i += 2; continue
            if c == '/' and (prev == '' or prev in '(,=:[!&|?{};+-*%~^<>'):
                st = 'regex'; out.append(c); i += 1; continue
            if c in '\'"`':
                st = 'str'; q = c; out.append(c); i += 1; continue
            out.append(c)
            if not c.isspace():
                prev = c
            i += 1; continue
        if st == 'block':
            if c == '*' and nx == '/':
                st = 'code'; out.append('  '); i += 2; continue
            out.append('\n' if c == '\n' else ' '); i += 1; continue
        if st == 'line':
            if c == '\n':
                st = 'code'; out.append('\n'); i += 1; continue
            out.append(' '); i += 1; continue
        if st == 'regex':
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == '[':
                st = 'class'; out.append(' '); i += 1; continue
            if c == '/':
                st = 'code'; prev = c; out.append(c); i += 1; continue
            if c == '\n':      # 改行を跨ぐ正規表現は無い＝割り算だった
                st = 'code'; out.append('\n'); i += 1; continue
            out.append(' '); i += 1; continue
        if st == 'class':      # 正規表現の [ ... ]
            if c == '\\':
                out.append('  '); i += 2; continue
            if c == ']':
                st = 'regex'
            out.append('\n' if c == '\n' else ' '); i += 1; continue
        # st == 'str'
        if c == '\\':
            out.append('  '); i += 2; continue
        if c == q:
            st = 'code'; prev = c; out.append(c); i += 1; continue
        out.append('\n' if c == '\n' else ' '); i += 1
    return ''.join(out)


EMPTY_CATCH = re.compile(r'catch\s*(?:\(\s*[A-Za-z_$][\w$]*\s*\))?\s*\{\s*\}')
EMPTY_THEN = re.compile(r'\.catch\(\s*\(\s*[A-Za-z_$]?[\w$]*\s*\)\s*=>\s*\{\s*\}\s*\)')
# 理由の空文字（`quiet('')` / `quiet.note("")` / `quiet(' ')`）
BLANK_WHY = re.compile(r'\bquiet(?:\.note)?\(\s*([\'"])\s*\1')


def scan_js(paths):
    out = []
    for p in paths:
        rel = p.relative_to(ROOT).as_posix()
        raw = p.read_text(encoding='utf-8')
        # 中身の有無は**字句を落としてから**、理由の中身は**生のまま**見る
        # （落とすと文字列の中身が空白になり、どの理由も空に見える）。
        for i, (line, bare) in enumerate(zip(strip_js(raw).splitlines(),
                                             raw.splitlines()), 1):
            for rx, txt, why in ((EMPTY_CATCH, line, '空のcatch'),
                                 (EMPTY_THEN, line, '.catch(()=>{})'),
                                 (BLANK_WHY, bare, '理由が空')):
                if rx.search(txt):
                    out.append((rel, i, why))
    return out


def main():
    pys = list(py_files())
    rec('対象のPythonが集まっている', len(pys) > 30, len(pys))
    bad = scan_py(pys)
    rec('Python: 黙って捨てている広いexceptが無い', not bad,
        '; '.join(f'{a}:{b}' for a, b, _ in bad[:20]) + (f' … 計{len(bad)}件' if bad else ''))

    jss = sorted((ROOT / 'static' / 'js').rglob('*.js'))
    rec('対象のJSが集まっている', len(jss) > 20, len(jss))
    badjs = scan_js(jss)
    rec('JS: 空のcatch・`.catch(()=>{})`・理由の空が無い', not badjs,
        '; '.join(f'{a}:{b} {c}' for a, b, c in badjs[:20]) + (f' … 計{len(badjs)}件' if badjs else ''))

    # 理由の中身（Python側）。`quiet('')`を書けないこと。
    blank = []
    for p in pys:
        rel = p.relative_to(ROOT).as_posix()
        if rel in EXEMPT_PY:
            continue
        for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
            if BLANK_WHY.search(line):
                blank.append(f'{rel}:{i}')
    rec('Python: 理由が空の quiet() が無い', not blank, ', '.join(blank[:10]))

    # 道具そのものが在る
    base = (ROOT / 'static' / 'js' / 'core' / 'base.js').read_text(encoding='utf-8')
    rec('WL.quiet が base.js に在る（`WL.quiet(理由)`と`WL.quiet.note`）',
        'WL.quiet=' in base and 'f.note=note' in base)
    q = (ROOT / 'backend' / 'quiet.py').read_text(encoding='utf-8')
    rec("backend/quiet.py は logging だけを読む（paths からも使える）",
        'import logging' in q and 'logging_setup' not in q.split('"""')[2])

    # 素通りしないこと（A/B）
    probe_py = ROOT / 'tests' / '_quiet_probe.py'
    probe_js = ROOT / 'static' / 'js' / '_quiet_probe.js'
    try:
        probe_py.write_text(
            'def f():\n'
            '    try:\n        pass\n    except Exception:\n        pass\n'          # 1件目
            '    try:\n        pass\n    except Exception as e:\n        return {}\n'  # 2件目
            '    try:\n        pass\n    except Exception as e:\n        return str(e)\n'  # 数えない
            '    try:\n        pass\n    except FileNotFoundError:\n        pass\n',   # 数えない
            encoding='utf-8')
        got = scan_py([probe_py])
        rec('網は Python の欠陥を数える（黙る2件だけ／理由を返す・狭いexceptは数えない）',
            len(got) == 2, [(a, b) for a, b, _ in got])
        probe_js.write_text('function f(){try{g()}catch(e){}\n'
                            'h().catch(()=>{});\n'
                            'try{g()}catch(e){WL.quiet.note("",e)}\n'
                            'try{g()}catch(e){/* 中身はコメントだけ */}\n'
                            '/* 説明文の中の catch(e){} は数えない */\n'
                            'try{g()}catch(e){WL.quiet.note("理由あり",e)}}\n',
                            encoding='utf-8')
        gotjs = scan_js([probe_js])
        rec('網は JS の欠陥を数える（空catch・捨て手・理由の空・コメントだけの4件。'
            '説明文の中の引用は数えない）', len(gotjs) == 4, gotjs)
    finally:
        for p in (probe_py, probe_js):
            try:
                p.unlink()
            except FileNotFoundError:
                pass


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    n_ok = sum(1 for x in R if x)
    print(f'\n{n_ok} PASS / {len(R) - n_ok} FAIL')
    sys.exit(0 if all(R) else 1)
