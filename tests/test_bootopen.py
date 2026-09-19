#!/usr/bin/env python3
"""test_bootopen.py: 待機画面が見えなくても、アプリへ辿り着ける（§9.318）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の報告:
  「起動時、うまくいかなくてhtmlを後から直接クリックして起動している」

**渡したことと、見えていることは別。** `os.startfile()`は成功しても、
ブラウザがそのファイルを開けたかは分からない——隔離・同期・掃除・
私的な写し・復元タブ・関連付け、原因はいくらでもある。実機のログでは
「写しは在る・読める・渡した・3秒後も読める」と全部そろっていたのに、
ブラウザは「ファイルが見つかりません」だった。

だから**原因を1つずつ潰すのではなく、辿り着けることを保証する**。
待機画面は`/api/ready.js`を繰り返し読みに来るので、**1件も来なければ
ブラウザには出ていない**——そのときだけアプリのURLを直接開く。

あわせて、実機で唯一説明の付く道（Microsoft Store 版のPythonは
`%LOCALAPPDATA%`への書き込みを**このアプリからしか見えない写し**へ回す）を
**実測で**見分け、見える場所へ置くようにした。

ここで固定するのは次の8つ。
 1. 待機画面が名乗ったら、余計なタブを開かない
 2. 本体のタブが名乗ったら、余計なタブを開かない
 3. **どちらも来なければ開く**（原因を問わない保険）
 4. 開くのは**1回だけ**、理由をログに残す（黙って開かない）
 5. サーバーが立たなければ開かない（開いても接続拒否の白い画面になる）
 6. 私的な写しを**実測で**見分ける（`%LOCALAPPDATA%\\Packages\\…\\LocalCache`）
 7. 健全な端末の置き場は**1バイトも変わらない**（`runtime_dir()`のまま）
 8. 待機画面と進捗ファイルは**必ず同じ場所**（`<script src>`が相対のため）
============================================================
"""
import os
import pathlib
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.406）
import _pycache_bootstrap  # noqa: E402,F401 副作用のためのimport（.pycの置き場）
from backend import boot_status  # noqa: E402
from backend import paths as P  # noqa: E402
from backend.launcher import setup_check  # noqa: E402
import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import start_app  # noqa: E402

R = []
def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


class Log:
    """ログの代わり。**何を言ったか**を持つ（黙って開いていないかを見る）。"""
    def __init__(self):
        self.lines = []
    def _add(self, fmt, *a):
        try:
            self.lines.append(str(fmt) % a if a else str(fmt))
        except Exception:
            self.lines.append(str(fmt))
    info = warning = error = _add
    def text(self):
        return '\n'.join(self.lines)


def run_failsafe(*, answers, seen, tabs, grace=0.6, wait=3.0):
    """保険を1回まわして、開いたURLの一覧とログを返す。

    **本物の`open_app_if_unseen_later()`を通すこと**——判定を写して確かめると、
    本体が違う判定をしていても通る（§9.289）。"""
    opened = []
    orig = (start_app._server_answers, start_app._browser_reached_app,
            start_app.webbrowser.open,
            start_app.WAITING_SEEN_GRACE_SEC, start_app.WAITING_SEEN_WAIT_SEC)
    start_app._server_answers = lambda: answers
    start_app._browser_reached_app = lambda: bool(seen() or tabs())
    start_app.webbrowser.open = lambda u: opened.append((u, time.monotonic())) or True
    start_app.WAITING_SEEN_GRACE_SEC = grace
    start_app.WAITING_SEEN_WAIT_SEC = wait
    log = Log()
    try:
        start_app.open_app_if_unseen_later(log)
        time.sleep(grace + wait * (0 if answers else 1) + 1.2)
    finally:
        (start_app._server_answers, start_app._browser_reached_app,
         start_app.webbrowser.open,
         start_app.WAITING_SEEN_GRACE_SEC, start_app.WAITING_SEEN_WAIT_SEC) = orig
    return opened, log


# ---- 1. 待機画面が名乗ったら開かない ----
opened, log = run_failsafe(answers=True, seen=lambda: 1.0, tabs=lambda: 0)
rec('待機画面が名乗ったら、余計なタブを開かない', opened == [], str(opened))

# ---- 2. 本体のタブが名乗ったら開かない ----
opened, log = run_failsafe(answers=True, seen=lambda: 0.0, tabs=lambda: 1)
rec('本体のタブが名乗ったら、余計なタブを開かない', opened == [], str(opened))

# ---- 3・4. どちらも来なければ、1回だけ開いて理由を残す ----
opened, log = run_failsafe(answers=True, seen=lambda: 0.0, tabs=lambda: 0)
rec('待機画面も本体のタブも来なければ、アプリの画面を開く',
    len(opened) == 1 and opened[0][0].startswith('http://127.0.0.1:'), str(opened))
rec('開くのは1回だけ（押し売りにしない）', len(opened) == 1, str(len(opened)))
rec('黙って開かない（理由をログに残す）',
    'ブラウザに出ていないようです' in log.text() and '直接開きます' in log.text(),
    log.text()[:90])

# ---- 3b. **猶予のあいだに**名乗り出たら開かない ----
# ブラウザの立ち上がりは数秒かかるので、**現実にいちばん多いのがこの形**。
# 最初の1回だけを見る網では、猶予の中で見るのをやめた実装が素通りする
# （実際に素通りした）。
t0 = time.monotonic()
opened, log = run_failsafe(answers=True,
                           seen=lambda: 1.0 if time.monotonic() - t0 > 0.9 else 0.0,
                           tabs=lambda: 0, grace=2.5)
rec('猶予のあいだに待機画面が出たら、余計なタブを開かない', opened == [], str(opened))

# ---- 4b. **見えないと分かっているなら猶予を待たない** ----
# 保険は「分からないから待つ」ための仕掛け。私的な写しだと分かっているのに
# 12秒待つのは、利用者を12秒余計に待たせるだけ。
start_app._waiting_page_visible = False
try:
    t0 = time.monotonic()
    opened, log = run_failsafe(answers=True, seen=lambda: 0.0, tabs=lambda: 0, grace=6.0)
finally:
    start_app._waiting_page_visible = True
# **開いた瞬間で測ること**——検証側の待ち時間で測ると、猶予を飛ばしていても
# その待ちがそのまま出て何も確かめられない（実際に踏んだ）。
waited = (opened[0][1] - t0) if opened else 99.0
rec('ブラウザから見えないと分かっていれば、猶予を待たずに開く',
    len(opened) == 1 and waited < 3.0, f'{waited:.1f}秒 / {opened}')
rec('待たなかった理由も書く（何秒待ったかを嘘で書かない）',
    '見えないと分かっています' in log.text(), log.text()[:80])

# ---- 5. サーバーが立たなければ開かない ----
opened, log = run_failsafe(answers=False, seen=lambda: 0.0, tabs=lambda: 0, wait=1.0)
rec('サーバーが立たなければ開かない（接続拒否の白い画面を出さない）',
    opened == [], str(opened))

# ---- 6〜8. 置き場の判定 ----
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-bootopen-'))
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

    # 8. 待機画面と進捗ファイルは同じ場所
    rec('待機画面と進捗ファイルは必ず同じ場所（<script src>が相対のため）',
        setup_check.waiting_page().parent == boot_status.status_path().parent,
        f'{setup_check.waiting_page().parent} / {boot_status.status_path().parent}')

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
    rec('私的な写しになる置き場は避け、ブラウザから見える場所を選ぶ',
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
