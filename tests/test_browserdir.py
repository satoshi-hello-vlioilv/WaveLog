#!/usr/bin/env python3
"""test_browserdir.py: ほかのプログラムが読むファイルの置き場（`paths.browser_dir()`・§9.318・§9.496）。

Microsoft Store 版の Python は`%LOCALAPPDATA%`への書き込みを**このアプリからしか見えない写し**へ回す。
ショートカットの補助スクリプト（wscript.exe が読む）と絵（エクスプローラーが読む）は、ほかの
プログラムから見える場所へ置く必要がある。その判定を**実測で**固める。

 1. 健全な端末の置き場は**1バイトも変わらない**（`runtime_dir()`のまま）
 2. 私的な写しを**実測で**見分ける（`%LOCALAPPDATA%\\Packages\\…\\LocalCache`）
 3. 私的な写しになる置き場は避け、ほかのプログラムから見える場所を選ぶ

（以前は test_bootopen.py。待機画面が見えないときにアプリを開く保険〈§9.318〉は、
ブラウザ版の起動の道とともに §9.548 で外した。）
"""
import os
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.406）
import _pycache_bootstrap  # noqa: E402,F401 副作用のためのimport（.pycの置き場）
from backend import paths as P  # noqa: E402

R = []
def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


# ---- 置き場の判定 ----
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-browserdir-'))
saved_lad = os.environ.get('LOCALAPPDATA')
saved_runtime = P.runtime_dir
home_dir = pathlib.Path.home() / ('.' + P.LOCAL_DIR_NAME.lower())
home_existed = home_dir.exists()
try:
    # 7. 健全な端末では既定のまま（**ここを先に見る**——移す道を通したあとだと
    #    覚えた値が残って、何も確かめないまま通る）
    P.reset_browser_dir_cache()
    rec('健全な端末の置き場は今までどおり（runtime_dir のまま）',
        P.browser_dir() == P.runtime_dir() and P.browser_dir_reason() == '',
        str(P.browser_dir()))

    # 6. 私的な写しを実測で見分ける
    lad = tmp / 'Local'
    runtime = lad / P.LOCAL_DIR_NAME / 'runtime'
    runtime.mkdir(parents=True, exist_ok=True)
    os.environ['LOCALAPPDATA'] = str(lad)
    target = runtime / 'loading.html'
    target.write_text('x', encoding='utf-8')
    rec('ふつうの場所は私的な写しと見なさない',
        P.msix_private_copy(target) is None, str(P.msix_private_copy(target)))

    pkg = (lad / 'Packages' / 'PythonSoftwareFoundation.Python.3.12_qbz5n2kfra8p0'
           / 'LocalCache' / 'Local' / P.LOCAL_DIR_NAME / 'runtime')
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / 'loading.html').write_text('x', encoding='utf-8')
    (pkg / '.visible').write_text('', encoding='utf-8')
    hit = P.msix_private_copy(target)
    rec('パッケージの私的な写しを見つける（実測で言う。推測しない）',
        hit is not None and str(hit).startswith(str(lad / 'Packages')), str(hit))

    # 私的な写しになる場所なら、別の場所を選ぶ
    P.reset_browser_dir_cache()
    P.runtime_dir = lambda: runtime
    picked = P.browser_dir()
    rec('私的な写しになる置き場は避け、ほかのプログラムから見える場所を選ぶ',
        picked != runtime and P.browser_dir_reason() != '',
        f'{picked} / {P.browser_dir_reason()[:60]}')
finally:
    P.runtime_dir = saved_runtime
    if saved_lad is None:
        os.environ.pop('LOCALAPPDATA', None)
    else:
        os.environ['LOCALAPPDATA'] = saved_lad
    P.reset_browser_dir_cache()
    shutil.rmtree(tmp, ignore_errors=True)
    # 検証で作った置き場は片付ける（§9.121）。元から在ったなら触らない。
    if not home_existed:
        shutil.rmtree(home_dir, ignore_errors=True)

ng = [x for x in R if not x[1]]
print(f'\n== {len(R)-len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
