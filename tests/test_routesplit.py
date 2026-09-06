# -*- coding: utf-8 -*-
"""test_routesplit.py: ルートの段が1枚へ戻っていないこと（§9.333、REVIEW 3-10）。

============================================================
なぜ要るか
------------------------------------------------------------
`routes/masters.py`は**73ルート・2,093行**の1枚だった。中身は無関係な9つの
マスタで、直したい1つへ辿り着くのに関係のない8つを飛ばすことになる。
段へ分けたが、**次にマスタを1つ足す人が「どこへ書くか」を迷えば、いちばん
近い段が太っていく**——1枚に戻るのは1回の判断ではなく、20回の小さな判断の
積み上がりなので、気づいたときには元の大きさに戻っている。

分け方の値打ちは**Blueprintが1つのまま**であること。`access_mode`の
`_WRITE_ALLOWED_MODES`／`_ENDPOINT_EXTRA_MODES`／`_READ_ONLY_POST_ENDPOINTS`と
`master_share.WRITING_BLUEPRINTS`は**Blueprint名と関数名**で書いてあるので、
段を増やしても権限表を触らずに済む。**逆に、段ごとにBlueprintを作ると
その瞬間に鍵が全部変わり、未宣言のBlueprintは fail-open（素通し）**なので
**閲覧モードから書けるようになる**（`test_modeguard`の但し書き）。黙って
穴が空くので、ここで数える。

------------------------------------------------------------
数えること
------------------------------------------------------------
 1. `backend/routes`のどの段も**1ファイル20ルート以下**。まだ分けていない段
    （`schedule.py` 41ルート）は**今の件数を上限に固定**する（`PINNED`）
    ——減ったら下げる。**上げる更新はできない**（`test_eslint`の
    ベースラインと同じ作法）。
 2. `masters/`の段はどれも`_base.py`の`bp`を使う（自前のBlueprintを
    作らない）。
 3. `masters/__init__.py`が段を**1つ残らず**importしている
    ——import しないと`@bp.post(...)`が走らず、**そのAPIだけ404**になる。
 4. 段の中の**相対importが1つ残らず解決する**。段を1つ深くすると
    `from ..repositories import …` は**1つ足りなくなる**が、その多くは
    **関数の中**（読み込み時には走らない）ので、import しただけでは気づけない
    ——実際にこの分割で36件あり、`/api/operation-choice-master`・
    `/api/roll-master`・`/api/query-join-master` が**500になっていた**
    （ルート数を数えるだけの網は素通りした。`test_crudroutes`が拾った）。
 5. 網そのものが素通りしないこと（写しを注いで数える）。
============================================================
"""
import ast
import importlib
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))       # どこから回しても `backend` を引けるように
ROUTES = ROOT / 'backend' / 'routes'
MASTERS = ROUTES / 'masters'
LIMIT = 20
# まだ分けていない段。**理由を書けないものは載せない。** 数は「今そこにある
# 件数」で、これを**超えたら落ちる**（減らすのは自由・そのとき数を下げる）。
PINNED = {
    'schedule.py': (41, '作業予定・設備停止・在席・書込役が同居（REVIEW 3-10の次の候補）。'
                        'masters と違い、Blueprintの中で読み書きのサイクル（§9.325）を'
                        '共有しているので、分けるときはその境目から決める'),
}
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def routes_in(tree):
    """`@bp.get('/…')`／`@bp.post('/…')`の数。"""
    n = 0
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for d in fn.decorator_list:
            f = d.func if isinstance(d, ast.Call) else d
            if isinstance(f, ast.Attribute) and getattr(f.value, 'id', '') == 'bp' \
               and f.attr in ('get', 'post', 'put', 'delete', 'route'):
                n += 1
    return n


def blueprints_in(tree):
    """`Blueprint(...)` を呼んでいる箇所の数。"""
    return sum(1 for n in ast.walk(tree)
               if isinstance(n, ast.Call) and getattr(n.func, 'id', '') == 'Blueprint')


def scan(paths):
    big, own = [], []
    for f in paths:
        tree = ast.parse(f.read_text(encoding='utf-8'))
        n = routes_in(tree)
        cap = PINNED.get(f.name, (LIMIT, ''))[0] if f.parent == ROUTES else LIMIT
        if n > cap:
            big.append(f'{f.relative_to(ROOT)}:{n}ルート（上限{cap}）')
        if f.parent == MASTERS and f.name != '_base.py' and blueprints_in(tree):
            own.append(str(f.relative_to(ROOT)))
    return big, own


def unresolved(paths):
    """解決できない相対import。**関数の中のものまで見る**——読み込み時には
    走らないので、`import backend.routes.masters` が通っても残っている。"""
    bad = []
    for f in paths:
        pkg = 'backend.' + '.'.join(f.relative_to(ROOT / 'backend').parts[:-1])
        pkg = pkg.rstrip('.')
        for n in ast.walk(ast.parse(f.read_text(encoding='utf-8'))):
            if not isinstance(n, ast.ImportFrom) or n.level == 0:
                continue
            base = pkg.rsplit('.', n.level - 1)[0] if n.level > 1 else pkg
            mod = (base + '.' + n.module) if n.module else base
            try:
                m = importlib.import_module(mod)
            except Exception as e:
                bad.append(f'{f.relative_to(ROOT)}:{n.lineno} {mod} {e.__class__.__name__}')
                continue
            for a in n.names:
                if hasattr(m, a.name):
                    continue
                try:
                    importlib.import_module(mod + '.' + a.name)
                except Exception:
                    bad.append(f'{f.relative_to(ROOT)}:{n.lineno} {mod}.{a.name} が無い')
    return bad


def main():
    files = sorted(ROUTES.rglob('*.py'))
    big, own = scan(files)
    rec(f'どの段も{LIMIT}ルート以下（固定した段はその件数以下）', not big, '; '.join(big))
    stale = [f'{k}:{v[0]}' for k, v in PINNED.items()
             if not (ROUTES / k).exists()
             or routes_in(ast.parse((ROUTES / k).read_text(encoding='utf-8'))) < v[0]]
    rec('固定した件数が腐っていない（減ったら下げる）', not stale, '; '.join(stale))
    rec('固定した段には理由が書いてある',
        all(len(v[1].strip()) >= 20 for v in PINNED.values()))
    rec('masters の段は自前のBlueprintを作らない（_base.py の1つを使う）',
        not own, '; '.join(own))

    init = MASTERS / '__init__.py'
    tree = ast.parse(init.read_text(encoding='utf-8'))
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and n.level == 1 and n.module is None:
            imported |= {a.name for a in n.names}
    mods = {f.stem for f in MASTERS.glob('*.py')
            if not f.stem.startswith('_')}
    rec('__init__.py が段を1つ残らず import している（漏れるとそのAPIだけ404）',
        mods <= imported, sorted(mods - imported))

    bad = unresolved(files)
    rec('相対importが1つ残らず解決する（関数の中まで）', not bad, '; '.join(bad[:6]))

    # ---- 網そのものが素通りしないこと（§9.200） ----
    probe = MASTERS / '_split_probe.py'
    try:
        body = 'from flask import Blueprint\nbp2=Blueprint("x",__name__)\n'
        body += 'def g():\n from ..repositories import master_repo\n return master_repo\n'
        body += ''.join(f'@bp.get("/a{i}")\ndef f{i}():pass\n' for i in range(LIMIT + 1))
        probe.write_text(body, encoding='utf-8')
        big2, own2 = scan([probe])
        rec('網が太った段と自前のBlueprintを実際に数える',
            bool(big2) and bool(own2), (big2, own2))
        # 段が1つ深いので `..repositories` は届かない＝この分割で36件あった形
        rec('網が「1つ足りない相対import」を数える（関数の中でも）',
            bool(unresolved([probe])), unresolved([probe]))
    finally:
        probe.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:      # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    ok = sum(1 for x in R if x)
    print(f'\n{ok} PASS / {len(R) - ok} FAIL')
    sys.exit(0 if all(R) else 1)
