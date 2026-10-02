#!/usr/bin/env python3
"""test_portdep.py: 共有の層は画面のポートを知らない（§9.544・評価関数 E1）。

============================================================
なぜ要るか
------------------------------------------------------------
デスクトップ版（Tauri）は画面のポート（127.0.0.1:5029）を開かず、窓が
標準入出力で Python へ問い合わせる（`program/sidecar.py`）。移行の前提は
**共有DBの管理（錠・改訂番号・写し・在席・書込役）が画面のポートにも
ブラウザの置き場にも頼っていない**こと——頼っていなければ、窓口が
パイプに変わっても同じコードが同じ手順で共有へ書き、ブラウザ版の端末と
混ざっても約束が崩れない（docs/DESKTOP_MIGRATION_DESIGN.md §1〜§3）。

事前確認では、この「頼っていない」を数で確かめた（18モジュール・0件）。
**1回の確認は次の変更で黙って崩れる**——共有の層の誰かが`PORT`や
`request.host`を読み始めた瞬間、デスクトップ版だけで壊れる（ブラウザ版の
網はすべて通る）。だからここで固定する。

対象は**名前で並べない**。共有の基本部品（`atomic_io`・`master_share`・
`schedule_sync`…）を読むモジュールを構文木から集める——共有へ触る
モジュールを足せば、ここへ載せ忘れても自動で見張りに入る。

数える印:
  ・画面の窓口の値: `HOST`・`PORT`・`app_url`（`backend/config.py`）
  ・問い合わせの出どころ: `request.host`/`host_url`/`url_root`/`remote_addr`/`origin`
  ・絶対URLを作る: `url_for(..., _external=...)`
  ・ループバックの名前の字: `127.0.0.1`・`localhost`（説明文は数えない）
当たってよいのは理由の書ける物だけ（`ALLOW`）。理由の無い当たりは0件であること。
============================================================
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / 'backend'

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


# 共有の基本部品。これ自身と、これを読むモジュールが「共有の層」。
SHARED_PRIMITIVES = {'atomic_io', 'sqlite_io', 'master_share', 'schedule_sync', 'schedule_owner',
                     'schedule_watch', 'presence', 'db_mirror', 'records_export'}
UI_NAMES = {'HOST', 'PORT', 'app_url'}
REQUEST_ATTRS = {'host', 'host_url', 'url_root', 'remote_addr', 'origin'}
LOOPBACK_WORDS = ('127.0.0.1', 'localhost')

# 当たってよい物（モジュール, 印）→ 理由。**理由が書けない当たりは置かない。**
ALLOW = {
    ('backend/schedule_owner.py', '127.0.0.1'):
        '書込役の受け口（PORT+1・LAN）の予備のURL。名前もIPも引けない端末の最後の候補で、画面のポートではない',
    ('backend/access_mode.py', '127.0.0.1'):
        'PC名として使えない名前の除外表（_USELESS_PC_NAMES）。ループバックへ問い合わせてはいない',
    ('backend/access_mode.py', 'localhost'):
        'PC名として使えない名前の除外表（_USELESS_PC_NAMES）。ループバックへ問い合わせてはいない',
}


def _imported(tree):
    names = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom):
            if n.module:
                names.add(n.module.split('.')[-1])
            names.update(a.name for a in n.names)
        elif isinstance(n, ast.Import):
            names.update(a.name.split('.')[-1] for a in n.names)
    return names


def shared_modules(root=BACKEND):
    """共有の層（基本部品そのものと、それを読むモジュール）。→ [(相対パス, 構文木)]"""
    out = []
    for p in sorted(root.rglob('*.py')):
        if '__pycache__' in p.parts:
            continue
        tree = ast.parse(p.read_text(encoding='utf-8'))
        if p.stem in SHARED_PRIMITIVES or _imported(tree) & SHARED_PRIMITIVES:
            out.append((p.relative_to(root.parent).as_posix(), tree))
    return out


def _docstrings(tree):
    """説明文（モジュール・クラス・関数の先頭の文字列）の node の id。"""
    ids = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(n, 'body', [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], 'value', None), ast.Constant) \
                    and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def hits_of(tree):
    """→ [(行, 印)]。画面のポート・問い合わせの出どころ・ループバックの字に触る所。"""
    docs = _docstrings(tree)
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Name) and n.id in UI_NAMES:
            out.append((n.lineno, n.id))
        elif isinstance(n, ast.alias) and n.name in UI_NAMES:
            out.append((getattr(n, 'lineno', 0), n.name))
        elif isinstance(n, ast.Attribute):
            if n.attr in UI_NAMES:
                out.append((n.lineno, n.attr))
            elif n.attr in REQUEST_ATTRS and isinstance(n.value, ast.Name) and n.value.id == 'request':
                out.append((n.lineno, 'request.' + n.attr))
        elif isinstance(n, ast.keyword) and n.arg == '_external':
            out.append((n.value.lineno, '_external'))
        elif isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
            for w in LOOPBACK_WORDS:
                if w in n.value:
                    out.append((n.lineno, w))
    return sorted(set(out))


def main():
    mods = shared_modules()
    names = [m for m, _t in mods]
    rec('共有の層を構文木から集められる（基本部品を読むモジュール）', len(mods) >= len(SHARED_PRIMITIVES),
        f'{len(mods)}本')
    # 集め方が緩んでいないこと: 事前確認で数えた要のモジュールが入っている
    for must in ('backend/schedule_sync.py', 'backend/master_share.py', 'backend/schedule_owner.py',
                 'backend/presence.py', 'backend/db_mirror.py', 'backend/routes/schedule.py',
                 'backend/watchdog.py'):
        rec(f'共有の層に {must} が入っている', must in names)

    unexplained, used = [], set()
    for mod, tree in mods:
        for line, mark in hits_of(tree):
            if (mod, mark) in ALLOW:
                used.add((mod, mark))
            else:
                unexplained.append(f'{mod}:{line} {mark}')
    rec('共有の層が画面のポート・問い合わせの出どころに頼っていない（理由の無い当たり 0件）',
        not unexplained, ' / '.join(unexplained[:8]) or f'{len(mods)}本を見た')
    stale = sorted(f'{m} {k}' for (m, k) in ALLOW if (m, k) not in used)
    rec('ALLOW に当たらなくなった行が残っていない（理由だけ残すと緩む）', not stale, ' / '.join(stale))

    # ---- 網そのものが効くこと（欠陥注入。本物のファイルは書かない・§9.504） ----
    bad = ast.parse(
        '"""PORT や 127.0.0.1 と説明文に書くのは数えない"""\n'
        'from .config import PORT\n'
        'def f(request):\n'
        '    """localhost は説明文"""\n'
        '    u = f"http://127.0.0.1:{PORT}/"\n'
        '    return request.host, url_for("x", _external=True), u\n')
    marks = {k for _l, k in hits_of(bad)}
    rec('欠陥を入れると見つける（PORT・request.host・_external・127.0.0.1）',
        {'PORT', 'request.host', '_external', '127.0.0.1'} <= marks, ', '.join(sorted(marks)))
    rec('説明文の中の字は数えない', 'localhost' not in marks, ', '.join(sorted(marks)))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    return 0 if all(R) else 1


if __name__ == '__main__':
    sys.exit(main())
