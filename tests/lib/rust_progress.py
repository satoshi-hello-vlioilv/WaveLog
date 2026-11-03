# -*- coding: utf-8 -*-
"""rust_progress.py: 業務の Python を Rust へ移す移行の物差し（§9.633・計画 docs/RUST_MIGRATION_PLAN.md §5）。

**読むだけ**——答えはそれぞれのコードの1か所にあり、ここは写しを持たない:

 * Python のルート       … Flask のルート表（`app.url_map`・`tests/lib/api_contract.py` と同じ読み方）
 * Rust のルート         … `desktop/core/src/routes.rs` の `ROUTES`（Serve＝Rust が答える／Shadow＝影で比べている）
 * Rust が書き手の事実   … 同じファイルの `OWNS`
 * 書き手の対応表        … `backend/` の SQL の字面（INSERT・UPDATE・DELETE・REPLACE・CREATE・ALTER・DROP）を
                           関数ごとに拾う。表の名前が式で決まる所は、モジュールの字の定数で解き、解けなければ
                           「式で決まる」として数える（推して埋めない）

使い方:
  python3 tests/lib/rust_progress.py            物差しの数を JSON で出す
  python3 tests/lib/rust_progress.py --write    書き手の対応表（docs/RUST_WRITERS.md）を作り直す
"""
import ast
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
ROUTES_RS = ROOT / 'desktop' / 'core' / 'src' / 'routes.rs'
WRITERS_MD = ROOT / 'docs' / 'RUST_WRITERS.md'
# 業務の行数に数えない物（画面に出す字のデータ。P1 でデータファイルへ出す）
NOT_LOGIC = {'backend/changelog_data.py'}

# SQL で書く文。表の名前は [角括弧]・"引用"・素の名前のどれでもよい
_WRITE = re.compile(
    r'\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|'
    r'ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+(\[[^\]]+\]|"[^"]+"|[A-Za-z_][\w.]*|\{[^}]*\}|%s)',
    re.I)
# 「UPDATE」の後ろに SET が来るものだけを書込と読む（説明の字の「UPDATE」を拾わない）
_SET = re.compile(r'\bSET\b', re.I)
_VERB = {'insert': 'INSERT', 'replace': 'INSERT', 'update': 'UPDATE', 'delete': 'DELETE', 'create': 'CREATE',
         'alter': 'ALTER', 'drop': 'DROP'}


def _consts(tree):
    """モジュールの字の定数（NAME = '…'）。"""
    out = {}
    for n in tree.body:
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = n.value.value
    return out


def _text(node, consts):
    """字の式 → 字（f-string の中の式は、定数なら値・それ以外は {式}）。"""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = []
        for v in node.values:
            if isinstance(v, ast.Constant):
                parts.append(str(v.value))
            elif isinstance(v, ast.FormattedValue):
                e = v.value
                parts.append(consts[e.id] if isinstance(e, ast.Name) and e.id in consts else '{' + ast.unparse(e) + '}')
        return ''.join(parts)
    return None


def _table(tok):
    tok = tok.strip()
    if tok.startswith('[') or tok.startswith('"'):
        tok = tok[1:-1]
    return None if ('{' in tok or '%s' in tok) else tok


class _Walk(ast.NodeVisitor):
    def __init__(self, consts):
        self.consts, self.stack, self.hits = consts, [], []

    def _fn(self, node):
        self.stack.append(node.name)
        self.generic_visit(node)
        self.stack.pop()

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _fn

    def _str(self, node):
        s = _text(node, self.consts)
        if s is None:
            return
        for m in _WRITE.finditer(s):
            verb = _VERB[m.group(1).split()[0].lower()]
            if verb == 'UPDATE' and not _SET.search(s[m.end():m.end() + 400]):
                continue
            self.hits.append((verb, _table(m.group(2)), '.'.join(self.stack) or '(モジュール)'))

    def visit_Constant(self, node):
        self._str(node)

    def visit_JoinedStr(self, node):
        self._str(node)   # 中の式は見ない（字の断片を二重に拾わない）

    def visit_Call(self, node):
        # 表の定義（`TableDef(表, …)`・§9.324）は、その表の汎用の書き手（insert・update・delete）を名乗る
        f = node.func
        if (getattr(f, 'id', None) or getattr(f, 'attr', None)) == 'TableDef' and node.args:
            a = node.args[0]
            t = a.value if isinstance(a, ast.Constant) else self.consts.get(getattr(a, 'id', ''))
            if isinstance(t, str):
                self.hits.append(('TableDef', t, '.'.join(self.stack) or '(モジュール)'))
        self.generic_visit(node)


def _sources():
    for p in sorted(BACKEND.rglob('*.py')):
        rel = p.relative_to(ROOT).as_posix()
        if '__pycache__' not in rel and rel not in NOT_LOGIC:
            yield rel, ast.parse(p.read_text(encoding='utf-8'))


def writers():
    """{表の名前 または '(式で決まる)': {'module:function': {動詞,…}}}"""
    trees = list(_sources())
    # 表の名前の定数は別のモジュールから読み込んで使うことが多い（`from .x import TABLE`）。
    # 全部のモジュールの定数を合わせ、同じ名前が違う値を持つものは「解けない」として外す
    shared, clash = {}, set()
    for _, tree in trees:
        for k, v in _consts(tree).items():
            if shared.setdefault(k, v) != v:
                clash.add(k)
    for k in clash:
        shared.pop(k, None)
    out = {}
    for rel, tree in trees:
        w = _Walk({**shared, **_consts(tree)})
        w.visit(tree)
        mod = rel[:-3].replace('/', '.')
        for verb, table, fn in w.hits:
            out.setdefault(table or '(式で決まる)', {}).setdefault(f'{mod}:{fn}', set()).add(verb)
    return out


def writers_md():
    w = writers()
    named = sorted(k for k in w if k != '(式で決まる)')
    lines = ['# 書き手の対応表（Python → Rust の移行・自動で作る）', '',
             '**手で書き換えない。** `python3 tests/lib/rust_progress.py --write` が `backend/` の SQL の字面から作る',
             '（§9.633）。移す単位はこの表の「表ごとの書き手」で切る——**1つの事実の書き手は1言語**（`data.md`）。',
             '網 `test_rustplan.py` が「今のコードと同じか」と「Rust が書き手の表を Python が書いていないか」を見る。', '',
             f'表 {len(named)}・書く関数 {len({f for v in w.values() for f in v})}'
             f'（表の名前が式で決まる所 {len(w.get("(式で決まる)", {}))}）', '',
             '| 表 | 書く関数（モジュール:関数・文） |', '| --- | --- |']
    for t in named + (['(式で決まる)'] if '(式で決まる)' in w else []):
        fns = '<br>'.join(f'`{f}` {"・".join(sorted(v))}' for f, v in sorted(w[t].items()))
        lines.append(f'| {t} | {fns} |')
    return '\n'.join(lines) + '\n'


def rust_table():
    """routes.rs の ROUTES と OWNS（字面から読む。解けない形は落とす＝網が気づく）。"""
    src = ROUTES_RS.read_text(encoding='utf-8')
    m = re.search(r'pub static ROUTES: &\[Route\] = &\[(.*?)\];', src, re.S)
    o = re.search(r'pub const OWNS: &\[&str\] = &\[(.*?)\];', src, re.S)
    if not m or not o:
        raise SystemExit('routes.rs の ROUTES・OWNS が読めません（形を変えたら rust_progress.py も直す）')
    routes = [{'method': a, 'path': b, 'mode': c.lower()} for a, b, c in
              re.findall(r'Route\s*\{\s*method:\s*"(\w+)",\s*path:\s*"([^"]+)",\s*mode:\s*Mode::(\w+)', m.group(1))]
    return routes, re.findall(r'"([^"]+)"', o.group(1))


def python_routes():
    sys.path.insert(0, str(ROOT / 'tests' / 'lib'))
    import api_contract  # 遅延: Flask のアプリを読むのは物差しを出すときだけ
    app = api_contract.load_app()
    out = []
    for r in app.url_map.iter_rules():
        if r.endpoint == 'static':
            continue
        for meth in sorted(r.methods - {'HEAD', 'OPTIONS'}):
            out.append({'method': meth, 'path': re.sub(r'<[^>]+>', '{*}', r.rule)})
    return out


def same_path(rust_path, py_path):
    """Rust の `{名前}` と Flask の `<…>`（`{*}` に直した物）を同じ形に見る。"""
    return re.sub(r'\{[^}]*\}', '{*}', rust_path) == py_path


def logic_lines():
    n = 0
    for p in BACKEND.rglob('*.py'):
        rel = p.relative_to(ROOT).as_posix()
        if '__pycache__' not in rel and rel not in NOT_LOGIC:
            n += sum(1 for _ in p.open(encoding='utf-8'))
    return n


def tests_reading_backend():
    # 製品の Python を直に読み込む網（関数の中の import・`import app`・`importlib` も数える）。
    # これらは単位を移すときに `cargo test` へ移す（HTTP 越しの網はそのまま使える）
    pat = re.compile(r'^\s*(from|import) (backend|app)\b|import_module\(', re.M)
    return sum(1 for p in (ROOT / 'tests').glob('test_*.py') if pat.search(p.read_text(encoding='utf-8')))


def parity_counts():
    fns, n = set(), 0
    for p in sorted((ROOT / 'tests' / 'fixtures' / 'parity').glob('*.json')):
        for c in json.loads(p.read_text(encoding='utf-8')):
            fns.add(p.stem + '.' + c['fn'])
            n += 1
    return {'parity_functions': len(fns), 'parity_cases': n}


def measure():
    routes, owns = rust_table()
    py = python_routes()
    w = writers()
    return {
        'python_routes': len(py),
        'rust_serve': sum(r['mode'] == 'serve' for r in routes),
        'rust_shadow': sum(r['mode'] == 'shadow' for r in routes),
        'rust_owns': len(owns),
        'python_logic_lines': logic_lines(),
        'python_tests_reading_backend': tests_reading_backend(),
        'tables_written_by_python': len([k for k in w if k != '(式で決まる)']),
        'dynamic_writers': len(w.get('(式で決まる)', {})),
        # P1（§9.634）: Rust へ写した純粋な関数と、Python と突き合わせている問いの数（tests/fixtures/parity）
        **parity_counts(),
    }


if __name__ == '__main__':
    if '--write' in sys.argv:
        WRITERS_MD.write_text(writers_md(), encoding='utf-8')
        print(f'書き直しました: {WRITERS_MD.relative_to(ROOT)}')
    else:
        json.dump(measure(), sys.stdout, ensure_ascii=False, indent=1)
        print()
