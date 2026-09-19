# -*- coding: utf-8 -*-
"""test_pyflakes.py: Pythonの「使っていないimport・変数・二重定義」を0件に固定する
（§9.326、REVIEW 3-1）。

============================================================
なぜ要るか
------------------------------------------------------------
自前の網（`test_patchlint`・`test_globallint`・`test_ddllint`…）は方針の
写しを数えるが、**標準の静的解析が拾う形は誰も見ていなかった**——実測で
pyflakes が77件（うち`backend/routes/masters.py`だけで33件の使っていない
import）。使っていないimportは「どこから読んでいるか」を嘘で語り
（`masters.py`は`cols`/`cfg`/`path_config_rows`を読むように見えたが1つも
使っていなかった）、使っていない変数は**書いたつもりの処理が動いていない**
合図（`rne_extract.py`の`last=e`は控えたまま誰も読まなかった）。

------------------------------------------------------------
約束
------------------------------------------------------------
 * 対象は`program/`（直接実行される4本とその道具）・`backend/`・`tests/`の全部。
 * **`# noqa`を書いた行は数えない**——副作用のためのimport
   （`import _pycache_bootstrap`＝`.pyc`の置き場を決める）と、名前を引き継ぐ
   ためのimport（`atomic_io.cloud_sync_hint`）は使わなくてよいものなので、
   **理由をその行に書いて**除く（flake8の作法。pyflakes自身はnoqaを読まないので
   この網が読む）。理由の無い`noqa`は書かないこと。
 * 網そのものが素通りしないことを確かめる（欠陥を1つ注いで1件になる）。
 * pyflakes が無い環境では**落とす**（黙って通さない・§CLAUDE 4）。
   入れ方は `pip install -r program/requirements-dev.txt`。
============================================================
"""
import os
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = ['program', 'backend', 'tests']
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def pyflakes_cmd():
    """pyflakes の呼び方。モジュール → PATH の順。無ければ None。"""
    try:
        r = subprocess.run([sys.executable, '-m', 'pyflakes', '--version'],
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            return [sys.executable, '-m', 'pyflakes']
    except Exception:
        pass
    exe = shutil.which('pyflakes')
    return [exe] if exe else None


LINE = re.compile(r'^(?P<path>.+?):(?P<line>\d+):(?:\d+:)? (?P<msg>.*)$')


def run(cmd, targets):
    """pyflakes を回して (path, line, msg) の一覧に。`noqa`の行は落とす。"""
    r = subprocess.run(cmd + [str(ROOT / t) for t in targets], capture_output=True,
                       text=True, cwd=str(ROOT), timeout=600)
    found, skipped = [], []
    for raw in (r.stdout + r.stderr).splitlines():
        m = LINE.match(raw.strip())
        if not m:
            continue
        p = pathlib.Path(m.group('path'))
        ln = int(m.group('line'))
        try:
            src = p.read_text(encoding='utf-8').splitlines()[ln - 1]
        except Exception:
            src = ''
        rel = os.path.relpath(str(p), str(ROOT))
        item = (rel, ln, m.group('msg'))
        (skipped if 'noqa' in src else found).append(item)
    return found, skipped


def main():
    cmd = pyflakes_cmd()
    rec('pyflakes が使える（無ければ pip install -r program/requirements-dev.txt）', bool(cmd))
    if not cmd:
        return
    found, skipped = run(cmd, TARGETS)
    rec('使っていないimport・変数・二重定義が0件（noqa無し）', not found,
        '; '.join(f'{p}:{l} {m}' for p, l, m in found[:20]) or f'noqaで除いたのは{len(skipped)}件')
    # noqa が「理由つき」であること——`# noqa: F401 副作用の…` のように字が続く
    bare = []
    for rel, ln, _ in skipped:
        src = (ROOT / rel).read_text(encoding='utf-8').splitlines()[ln - 1]
        tail = src.split('noqa', 1)[1]
        if len(re.sub(r'[:\sA-Z0-9,]', '', tail)) < 4:
            bare.append(f'{rel}:{ln}')
    rec('noqa には理由が書いてある', not bare, ', '.join(bare))
    # 素通りしないこと: 欠陥を1つ注いで数えられるか
    probe = ROOT / 'tests' / '_pyflakes_probe.py'
    try:
        probe.write_text('import os\nimport sys  # noqa: F401 網の確認用（除かれる側）\n'
                         'def f():\n    x = 1\n', encoding='utf-8')
        f2, s2 = run(cmd, ['tests/_pyflakes_probe.py'])
        msgs = sorted(m for _, _, m in f2)
        rec('網そのものが素通りしない（注いだ欠陥2件を数え、noqaの1件は除く）',
            len(f2) == 2 and len(s2) == 1 and any('os' in m for m in msgs)
            and any("'x'" in m for m in msgs), (msgs, len(s2)))
    finally:
        try:
            probe.unlink()
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
