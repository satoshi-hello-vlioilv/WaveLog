# -*- coding: utf-8 -*-
"""api_contract.py: 画面とサーバーの境界の約束を、サーバーのコードから読み出す（§9.567）。

**約束の定義はサーバーのコードの1か所**——ここは読むだけで、写しを持たない:

 * 道とメソッド      … Flask のルート表（`app.url_map`）
 * 受け取る本文      … ルートの中の `body({...})` の字面（§9.330。鍵と型）
 * 返す応答の鍵      … ルートの `return` の字面（`jsonify(a=…)`・`{'a': …}`・`(本体, 状態)`）。
                       400 以上の状態で返す物は数えない（`api()` が投げるので画面は読まない）

読めないもの（`return 関数(...)` など）は「分からない」として返し、推して埋めない。
読んだ結果は JSON で `tests/lib/js_types.js --contract` へ渡し、画面の `api('/api/…')` の型になる
（画面が、サーバーの返さない鍵を読んだら型の検査で止まる）。

使い方: python3 tests/lib/api_contract.py > contract.json
"""
import ast
import inspect
import json
import logging
import pathlib
import re
import sys
import textwrap

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _spec_types(call):
    """`body({...})` の字面 → {鍵: 型の名前}。字面でなければ None。"""
    if not call.args or not isinstance(call.args[0], ast.Dict):
        return None
    d = call.args[0]
    if not all(isinstance(k, ast.Constant) for k in d.keys):
        return None
    return {k.value: (getattr(v, 'id', None) or getattr(v, 'attr', None) or '?')
            for k, v in zip(d.keys, d.values)}


def _reply_keys(e):
    """応答の式 → (鍵の集合, 閉じているか)。400 以上なら 'error'。読めなければ None。"""
    if isinstance(e, ast.Tuple) and e.elts:
        st = e.elts[1] if len(e.elts) > 1 else None
        if isinstance(st, ast.Constant) and isinstance(st.value, int) and st.value >= 400:
            return 'error'
        return _reply_keys(e.elts[0])
    if isinstance(e, ast.Dict):
        ks, closed = set(), True
        for k in e.keys:
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                ks.add(k.value)
            else:
                closed = False   # `**x` か、字面でない鍵
        return ks, closed
    if isinstance(e, ast.Call) and getattr(e.func, 'id', '') == 'jsonify':
        if e.args and not e.keywords:
            return _reply_keys(e.args[0])
        ks, closed = set(), not e.args
        for kw in e.keywords:
            if kw.arg is None:
                closed = False
            else:
                ks.add(kw.arg)
        return ks, closed
    return None


def _own_nodes(fdef):
    """その関数の本体の節（入れ子の関数・lambda の中は除く）。"""
    inner = set()
    for d in ast.walk(fdef):
        if d is not fdef and isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            inner.update(id(m) for m in ast.walk(d))
    return [n for n in ast.walk(fdef) if id(n) not in inner]


def route_contract(fn):
    """1本のルートの関数 → {'body', 'strict', 'reply'}。"""
    out = {'body': None, 'strict': False, 'reply': {'kind': 'unknown', 'keys': []}}
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(inspect.unwrap(fn))))
    except (OSError, TypeError, SyntaxError):
        return out
    fdef = tree.body[0]
    nodes = _own_nodes(fdef)
    for n in nodes:
        if isinstance(n, ast.Call) and getattr(n.func, 'id', getattr(n.func, 'attr', '')) == 'body':
            spec = _spec_types(n)
            out['body'] = spec if spec is not None else '?'
            out['strict'] = out['strict'] or any(
                k.arg == 'strict' and getattr(k.value, 'value', False) for k in n.keywords)
    rets = [n for n in nodes if isinstance(n, ast.Return) and n.value is not None]
    keys, closed = set(), True
    for n in rets:
        k = _reply_keys(n.value)
        if k == 'error':
            continue
        if k is None:
            return out          # 1つでも読めない return があれば「分からない」
        keys |= k[0]
        closed = closed and k[1]
    if rets:
        out['reply'] = {'kind': 'closed' if closed else 'open', 'keys': sorted(keys)}
    return out


def contract(app):
    rows = []
    for r in app.url_map.iter_rules():
        if not r.rule.startswith('/api'):
            continue
        c = route_contract(app.view_functions[r.endpoint])
        rows.append({'rule': r.rule, 'pattern': re.sub(r'<[^>]+>', '{*}', r.rule),
                     'methods': sorted(r.methods - {'HEAD', 'OPTIONS'}), 'endpoint': r.endpoint, **c})
    return sorted(rows, key=lambda x: (x['rule'], x['methods']))


def load_app():
    sys.path.insert(0, str(ROOT))
    logging.disable(logging.CRITICAL)   # 起動の記録（端末の名前など）を標準出力へ混ぜない
    from backend.app_module import flask_app
    return flask_app()


if __name__ == '__main__':
    json.dump(contract(load_app()), sys.stdout, ensure_ascii=False)
