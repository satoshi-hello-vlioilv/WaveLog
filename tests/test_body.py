# -*- coding: utf-8 -*-
"""test_body.py: 画面から来るJSONの読み方を1つの型に固定する（§9.330、REVIEW 3-3）。

============================================================
なぜ要るか
------------------------------------------------------------
ルートが `request.get_json(force=True) or {}` を書き写し、そこから
`str(x.get('name') or '').strip()` を手で組み立てていると、

 * **送っていない（`None`）と、空で送った（`''`）が入口で混ざる**
   ——repo 側の「渡した鍵だけ書く」（§9.212 ②）が成り立たない。
 * **綴りの間違いが黙って捨てられる**——`x.get('enabld')` は `None` を
   返すだけで、誰も何も言わない。

`backend/routes/body.py` の `body(spec)` が受け口を1つにする。

------------------------------------------------------------
約束
------------------------------------------------------------
 1. `backend/routes` に `request.get_json` の直呼びが**無い**
    （窓口の `body.py` だけが呼ぶ）。
 2. **ルートが読む鍵は spec に宣言されている。** 宣言に無い鍵を読んだら
    落ちる（綴りの間違いをここで捕まえる）。宣言できない本文——鍵が実行時に
    決まるもの——は `body({})` と書き、**理由付きの一覧**に載せる。
 3. `Body` の約束（`None` は `None`／`given()` は送った鍵だけ／`in` は
    本文に在ったか／`strict=True` のときだけ知らない鍵を断る）。
 4. 網そのものが素通りしないこと（欠陥を注いで落ちる）。

**`strict` を既定にしないこと。** マスタ管理の汎用フォームは GET が返した
1行を丸ごと POST するので、サーバーが計算して返した項目（`active`・
`capability`・`loaded`…）が必ず混ざる。既定で断ると全部のマスタ画面が
保存できなくなる（実際に `test_dsrestart` がそれで落ちた）。
============================================================
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROUTES = ROOT / 'backend' / 'routes'
sys.path.insert(0, str(ROOT))
R = []

# spec を書けない本文と、その理由。**理由を書けないものは載せない**
# （宣言を持たないことを見えなくするだけ）。
FREE_SPEC = {
    ('path_config.py', 'path_config_master_update'):
        '鍵は設定の表と、登録済みデータソースぶんの <キー>_path から決まる',
    ('schedule.py', '_write_response'):
        '全部の書込ルートが通る共通処理。読むのは「誰が・どの端末で」と、中継へ渡す生の本文だけ',
}


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def _keys_read(fn):
    """`x` から読んだ鍵。`text_or(x,'K')` は `K` と `KText` の両方を読む
    （§9.324 R4。呼び名が spec に無いと `None` になり、**呼び名で送る汎用
    フォームだけが黙って既定へ倒れる**）。"""
    read = set()
    for n in ast.walk(fn):
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr in ('get', 'text', 'num', 'flag', 'items_of', 'sent')
                and isinstance(n.func.value, ast.Name) and n.func.value.id == 'x'
                and n.args and isinstance(n.args[0], ast.Constant)):
            read.add(str(n.args[0].value))
        if (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                and n.func.id == 'text_or' and len(n.args) == 2
                and isinstance(n.args[0], ast.Name) and n.args[0].id == 'x'
                and isinstance(n.args[1], ast.Constant)):
            k = str(n.args[1].value)
            read.add(k); read.add(k + 'Text')
        if (isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name)
                and n.value.id == 'x' and isinstance(n.slice, ast.Constant)):
            read.add(str(n.slice.value))
        if isinstance(n, ast.Compare) and isinstance(n.left, ast.Constant):
            for op, c in zip(n.ops, n.comparators):
                if isinstance(op, (ast.In, ast.NotIn)) and isinstance(c, ast.Name) and c.id == 'x':
                    read.add(str(n.left.value))
    return read


def _calls_with_x(fn):
    """本文をそのまま渡している呼び先の名前。渡し方は2通りあり、**両方見ること**
    ——`f(x)`（一度受けてから渡す）と `f(body({...}))`（その場で渡す）。
    片方だけだと、もう片方の書き方をしているルートで宣言漏れを見逃す。"""
    out = set()
    for n in ast.walk(fn):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name):
            for a in n.args:
                if isinstance(a, ast.Name) and a.id == 'x':
                    out.add(n.func.id)
                if (isinstance(a, ast.Call) and isinstance(a.func, ast.Name)
                        and a.func.id == 'body'):
                    out.add(n.func.id)
    return out


def body_calls(tree):
    """`... = body({...})` を持つ関数 → (宣言した鍵, 読んだ鍵)。

    **本文を渡した先（`_operation_item_save(x)` のような下請け）まで辿る**
    ——辿らないと、下請けだけが読む鍵が spec から抜けても誰も気づけない
    （実際に `inlineAdd` が抜けていた）。"""
    fns = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
    direct = {k: _keys_read(v) for k, v in fns.items()}
    callee = {k: _calls_with_x(v) for k, v in fns.items()}
    total = dict(direct)
    for _ in range(len(fns) + 1):        # 呼び先の呼び先まで（落ち着くまで）
        changed = False
        for k in fns:
            add = set().union(*[total.get(c, set()) for c in callee[k]]) if callee[k] else set()
            if not add <= total[k]:
                total[k] = total[k] | add
                changed = True
        if not changed:
            break
    out = {}
    for name, fn in fns.items():
        declared, has = set(), False
        for n in ast.walk(fn):
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                    and n.func.id == 'body' and n.args):
                has = True
                a = n.args[0]
                if isinstance(a, ast.Dict):
                    for k in a.keys:
                        if isinstance(k, ast.Constant):
                            declared.add(str(k.value))
                else:
                    declared.add('*')      # 実行時に組む spec（内包表記など）
        if has:
            out[name] = (declared, total[name])
    return out


def main():
    from backend.routes.body import Body, IDENTITY_KEYS, flag, any_   # noqa: E402

    # ---- 1) request.get_json の直呼びは窓口だけ ----
    raw = []
    for f in sorted(ROUTES.rglob('*.py')):
        if f.name == 'body.py':
            continue
        tree = ast.parse(f.read_text(encoding='utf-8'))
        for n in ast.walk(tree):
            if (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                    and n.func.attr == 'get_json'):
                raw.append(f'{f.name}:{n.lineno}')
    rec('request.get_json の直呼びは body.py だけ', not raw, ' / '.join(raw))

    # ---- 2) 読む鍵は spec に宣言されている ----
    undeclared, free_used = [], []
    for f in sorted(ROUTES.rglob('*.py')):
        if f.name == 'body.py':
            continue
        for name, (declared, read) in body_calls(ast.parse(f.read_text(encoding='utf-8'))).items():
            if '*' in declared:
                continue
            if not declared:
                free_used.append((f.name, name))
                continue
            miss = sorted(read - declared - set(IDENTITY_KEYS))
            if miss:
                undeclared.append(f'{f.name}.{name}: ' + '、'.join(miss))
    rec('ルートが読む鍵は spec に宣言されている', not undeclared, ' / '.join(undeclared[:6]))
    extra = [k for k in free_used if k not in FREE_SPEC]
    rec('spec を書かない本文は理由付きの一覧にある', not extra, extra)
    stale = [k for k in FREE_SPEC if k not in free_used]
    rec('一覧に腐った例外が残っていない', not stale, stale)
    for k, why in FREE_SPEC.items():
        rec(f'例外 {k[0]}.{k[1]} に理由が書いてある', len(str(why).strip()) >= 12)

    # ---- 3) Body の約束 ----
    b = Body({'name': str, 'n': int, 'on': flag, 'items': list, 'raw': any_},
             {'name': ' あ ', 'on': '無効', 'items': [1], 'raw': {'k': 1}})
    rec('文字は前後の空白を落とす', b.name == 'あ', repr(b.name))
    rec('送っていない鍵は None のまま（空文字にしない）', b.n is None, repr(b.n))
    rec('呼び名の「無効」を切として読む（§9.324 R4）', b.on is False, repr(b.on))
    rec('given() は送った鍵だけ（§9.212 ②）',
        sorted(b.given()) == ['items', 'name', 'on', 'raw'], sorted(b.given()))
    rec('in は「本文に在ったか」（値が空でも True）',
        ('name' in b) and ('n' not in b)
        and ('e' in Body({'e': str}, {'e': ''})), '')
    rec('text() は送っていなければ既定', b.text('n', '-') == '-', b.text('n', '-'))
    rec('items_of() は並びでなければ空', Body({'a': any_}, {'a': 3}).items_of('a') == [])
    got = None
    try:
        Body({'n': int}, {'n': 'abc'})
    except ValueError as e:
        got = str(e)
    rec('数で読めない値は理由付きで断る', got and 'n' in got, got)
    rec('知らない鍵は既定では通す（画面は読んだ行をそのまま送り返す）',
        Body({'a': str}, {'a': '1', 'capability': {}}).a == '1')
    got = None
    try:
        Body({'a': str}, {'a': '1', 'zz': 1}, strict=True)
    except ValueError as e:
        got = str(e)
    rec('strict=True のときだけ知らない鍵を断る', got and 'zz' in got, got)
    rec('strict でも「誰が・どの端末で」の鍵は通る',
        Body({'a': str}, {'a': '1', 'user_id': 'u', 'pcName': 'p'}, strict=True).a == '1')

    # ---- 4) 網そのものが素通りしないこと ----
    # 試しの源は**文字列のまま**読む（本物の置き場`backend/routes/`へ書かない・§9.504）。以前はファイルを書いて消して
    # いたので、並列で回る`test_ddllint`がその一瞬に一覧を取ると、読む前に消えて止まった（§9.549）。
    # 3通りの読み方すべてで「宣言に無い」を数えられること。
    # ①その場で読む ②一度受けて下請けへ渡す ③その場で下請けへ渡す
    # ——②③は呼び先まで辿らないと、④の呼び名（`text_or`）は展開しないと
    # 素通りする（どちらも実際に素通りしていた）。
    probe_src = ('def _save(x):\n return text_or(x, "c")\n'
                 'def r1():\n x=body({"a": str})\n return x.get("b")\n'
                 'def r2():\n x=body({"a": str})\n return _save(x)\n'
                 'def r3():\n return _save(body({"a": str}))\n')
    bad = {}
    for name, (declared, read) in body_calls(ast.parse(probe_src)).items():
        bad[name] = sorted(read - declared - set(IDENTITY_KEYS))
    rec('網が「その場で読んだ宣言に無い鍵」を数えている', bad.get('r1') == ['b'], bad.get('r1'))
    rec('網が「下請けへ渡した先」まで辿る（f(x)）',
        bad.get('r2') == ['c', 'cText'], bad.get('r2'))
    rec('網が「その場で下請けへ渡す」も辿る（f(body(...))）',
        bad.get('r3') == ['c', 'cText'], bad.get('r3'))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:      # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    n_ok = sum(1 for x in R if x)
    print(f'\n{n_ok} PASS / {len(R) - n_ok} FAIL')
    sys.exit(0 if all(R) else 1)
