#!/usr/bin/env python3
"""test_tabclose.py: タブを閉じたらアプリも速やかに終了する（§9.98）。

============================================================
なぜ要るか
------------------------------------------------------------
「タブを閉じたのにアプリが残り続ける」という状態は、次に開いたときに
**古いプロセスが同じポートを掴んでいる**ことになり、起動ガードが
「別のアプリが応答した」と誤判定する原因にもなる。実測では、タブを
閉じてから終了するまで**85秒**かかっていた。

原因は「開いているタブが0件」を1種類しか区別していなかったこと。

  閉じたと告げられた   … 利用者がタブを閉じた。もう戻ってこない。
  気づいたら0件だった … 通知が届かなかった。本当に閉じたのか分からない。

後者に90秒待つのは正しい（リロードや別ページへの移動でも一瞬0件になる）。
**前者にも同じ90秒を使っていた**のが問題だった。加えて監視自体が10秒
間隔で寝ているため、通知が届いてもまず最大10秒気づかない。

ここで固定するのは4つ。
 1. 閉じたと告げられたら短い猶予で終了する（すぐには終了しない＝猶予はある）
 2. その猶予の内に新しいタブが名乗れば終了しない（リロードで落とさない）
 3. 通知が無いまま0件になっただけなら、短い猶予では終了しない
 4. 画面側がタブを閉じるときに終了通知を送っている
============================================================
"""
import importlib
import pathlib
import sys
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import flask  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


# 監視スレッドがテスト用の終了スタブでSystemExitを投げて終わるのは正常系。
# 既定のフックが毎回トレースバックを出すので黙らせる。
threading.excepthook = lambda arg: None

# テスト用の時間。実時間で待つので、確かめたい差だけが出る最小の値にする。
CLOSED, EMPTY, TICK = 0.4, 3.0, 0.05


class Watch:
    """監視スレッドを1本、隔離した状態で動かす。

    `_active_tabs`/`_wake`/`_empty_since` はモジュール変数なので、
    シナリオごとに importlib.reload で作り直す（前のスレッドは前の
    モジュールの変数を見ているため干渉しない。daemonなので放置してよい）。
    """

    def __init__(self):
        import backend.watchdog as wd
        self.wd = importlib.reload(wd)
        self.exits = []
        self.done = threading.Event()
        self.wd._exit = self._fake_exit
        self.wd.CLOSED_GRACE_SEC = CLOSED
        self.wd.EMPTY_GRACE_SEC = EMPTY
        self.wd.WATCHDOG_CHECK_INTERVAL_SEC = TICK
        self.wd.WATCHDOG_CLOSING_INTERVAL_SEC = TICK
        app = flask.Flask(__name__)
        self.wd.install(app)
        self.client = app.test_client()
        self.wd._empty_since = time.monotonic()
        threading.Thread(target=self.wd._loop, daemon=True, name='watchdog-test').start()

    def _fake_exit(self, reason, code=0):
        self.exits.append(reason)
        self.done.set()
        raise SystemExit(code)   # 監視スレッドだけを終わらせる

    def beat(self, tab):
        self.client.post(f'/api/heartbeat?tab={tab}')

    def close(self, tab):
        self.client.post(f'/api/heartbeat/close?tab={tab}')

    def vanish(self):
        """通知が届かないまま0件になった状態（ハートビート途絶＝異常系）。"""
        with self.wd._tabs_lock:
            self.wd._active_tabs.clear()

    def settle(self):
        """監視が「1件生きている」を1度は見た状態にする。"""
        time.sleep(TICK * 4)

    def wait_exit(self, limit):
        return self.done.wait(limit)


def main():
    # ---- 1. 閉じたと告げられたら短い猶予で終了する ----
    w = Watch()
    w.beat('a')
    w.settle()
    t0 = time.monotonic()
    w.close('a')
    ended = w.wait_exit(CLOSED * 4)
    dt = time.monotonic() - t0
    rec('タブを閉じたら終了する', ended, f'{dt:.2f}秒')
    rec('終了までに猶予がある（通知が届いた瞬間には終了しない）',
        ended and dt >= CLOSED, f'{dt:.2f}秒 >= {CLOSED}秒')
    rec('猶予は「気づいたら0件だった」ときより短い',
        ended and dt < EMPTY, f'{dt:.2f}秒 < {EMPTY}秒')
    rec('終了理由に経緯が残る',
        bool(w.exits) and '閉じられた' in w.exits[0], w.exits[0] if w.exits else '(終了せず)')

    # ---- 2. 猶予の内に新しいタブが名乗れば終了しない（リロード） ----
    w = Watch()
    w.beat('a')
    w.settle()
    w.close('a')                 # リロードでも pagehide は発火する
    time.sleep(CLOSED / 2)
    w.beat('b')                  # 読み直した画面が新しいIDで名乗る
    rec('リロードでは終了しない（閉じた直後に新しいタブが名乗る）',
        not w.wait_exit(CLOSED * 3), w.exits[0] if w.exits else '')
    rec('リロード後は「閉じた」の記憶を捨てている',
        w.wd._closed_notice is False, str(w.wd._closed_notice))

    # ---- 2b. 起動してすぐ開いてリロードしても終了しない（§9.302の追補） ----
    # `_empty_since`は**起動時にセットされ、監視が次に起きたときにしか
    # 消えない**。そのため「起動 → 監視が一度も起きないうちに画面を開く →
    # すぐリロード」をすると、閉じた通知で起こされた時点でまだ起動時の値が
    # 入っており、`now - _empty_since`が既に猶予を超えていて**その場で
    # 終了する**（実測: サーバー起動の7秒後に開いてリロードしたら1秒未満で
    # 落ちた）。§9.98で禁じた「リロードで終了してしまう」が、§9.284の旗の
    # 消し忘れとは**別の道**で起きていた形。
    # **`settle()`を挟まないこと**——挟むと監視が一度起きて`_empty_since`が
    # 消え、この道を一度も通らないまま通る（上の2番がまさにそれ）。
    w = Watch()
    w.wd._empty_since = time.monotonic() - CLOSED * 5   # 誰も開かないまま経った時間
    w.beat('a')
    rec('タブが名乗った時点で「0件になった時刻」を捨てる',
        w.wd._empty_since is None, str(w.wd._empty_since))
    w.close('a')                 # リロード（pagehide）
    time.sleep(CLOSED / 2)
    w.beat('b')                  # 読み直した画面が名乗る
    rec('起動してすぐ開いてリロードしても終了しない',
        not w.wait_exit(CLOSED * 3), w.exits[0] if w.exits else '')

    # ---- 3. 通知が無いまま0件になっただけなら、短い猶予では終了しない ----
    w = Watch()
    w.beat('a')
    w.settle()
    w.vanish()
    rec('通知が無い0件は短い猶予で終了しない（通信断で落とさない）',
        not w.wait_exit(CLOSED * 3), w.exits[0] if w.exits else '')
    rec('通知が無い0件でも、長い猶予を過ぎれば終了する（後始末の保険）',
        w.wait_exit(EMPTY * 1.5), '')

    # ---- 4. 設定値そのものの関係 ----
    from backend import config
    rec('閉じたときの猶予 < 気づいたら0件だったときの猶予',
        config.CLOSED_GRACE_SEC < config.EMPTY_GRACE_SEC,
        f'{config.CLOSED_GRACE_SEC} < {config.EMPTY_GRACE_SEC}')
    rec('閉じた直後の監視間隔 < その猶予（寝ている時間が猶予を上回らない）',
        config.WATCHDOG_CLOSING_INTERVAL_SEC < config.CLOSED_GRACE_SEC,
        f'{config.WATCHDOG_CLOSING_INTERVAL_SEC} < {config.CLOSED_GRACE_SEC}')

    # ---- 5. 画面側が終了通知を送っている ----
    js = (ROOT / 'static' / 'js' / 'core' / 'base.js').read_text(encoding='utf-8')
    rec('画面が終了通知を送る（sendBeaconなので閉じる途中でも届く）',
        'sendBeacon' in js and '/api/heartbeat/close' in js)
    rec('pagehide と unload の両方で送る（ブラウザ実装差の保険）',
        "addEventListener('pagehide',notifyTabClosed)" in js
        and "addEventListener('unload',notifyTabClosed)" in js)

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


main()
