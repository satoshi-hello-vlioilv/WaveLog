"""sidecar.py: デスクトップ版（Tauri・docs/DESKTOP_MIGRATION_DESIGN.md）の窓口。**ポートを開かない**（§9.544）。

以前のブラウザ版（Start.vbs → start_app.py・127.0.0.1:5029）は、ポートのために次の仕組みを抱えていた
（プロキシが 127.0.0.1 宛てまで社内へ送る・古いサーバーがポートを掴んで残る・ブラウザを閉じたかを
ハートビートで推し量る）。§9.548 でその起動の道を外し、利用者の起動はこの窓口だけになった。
デスクトップ版はこのプロセスを窓（Rust）が子として起こし、パイプで問い合わせる。窓を閉じれば
標準入力が閉じ、それを見て**同じ片付け（`watchdog._exit()`→`teardown()`）を通って**終わる。

**画面のポートとは別の物はそのまま**: 書込役の LAN の受け口（PORT+1・§9.192）は、窓口がパイプでも
同じに開く（共有の作法を端末どうしで揃えるため。始めるのは`backend/launcher/services.py`の1箇所）。

枠の形（両方向とも同じ。テキストの行と生のバイトを混ぜる・Defect-Pitch-Analyzer と同じ形）:
    ヘッダー: JSON 1行（UTF-8・改行で終わる）。"len" が本文のバイト数
    本文    : len バイトそのまま（base64 にしない。大きな一覧でも膨らませない）
  問い合わせ {"id", "method", "path", "query", "headers": {名前: 値}, "len"}
  答え       {"id", "status", "headers": [[名前, 値], ...], "len"}
  知らせ     {"id": 0, "event": "progress" | "ready" | "fatal", ...}（id 0 は問い合わせに使わない）

アプリ本体（Flask）はそのまま WSGI として呼ぶ。画面・ルート・網はブラウザ版と同じものを使う。
"""
import _pycache_bootstrap  # noqa: F401 副作用のためのimport。**いちばん最初に**（.pycの置き場を決める・§9.406）
import _approot  # noqa: F401,E402 副作用のためのimport。リポジトリ直下（`backend`の在り処）を探索先へ入れる・§9.404

import json  # noqa: E402
import os  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

from backend.config import DESKTOP_BASE_URL  # noqa: E402

# 同時に答える本数。ブラウザ版は1つのホストへ同時6本（HTTP/1.1 の上限）までしか送れないので、
# 16 あれば今より詰まらない。長い問い合わせ（共有の書込サイクル約1.5秒・RNE の抽出）の
# あいだも、ハートビートや一覧の取得に答えられる。
WORKERS = 16
# 枠の約束の版。**窓（Rust）と食い違ったら、窓が「開き直してください」と言う**——exe は端末の手元へ
# 写して使い、Python は共有のフォルダから読むので、更新が届くと版がずれることがある（§9.544）。
# 枠の形（ヘッダーの鍵・知らせの種類）を変えたら1つ上げる。
PROTOCOL = 1
# 「窓を閉じた」ときの終了理由（launcher.log に残る。網もこの字で確かめる）
EXIT_REASON = '窓を閉じた（標準入力が閉じた・デスクトップ版）'


# ---------------- 枠を読む・書く ----------------
def read_frame(stream):
    """→ (ヘッダー dict, 本文 bytes)。入力が閉じたら None。読めない行は ValueError。"""
    line = stream.readline()
    if not line:
        return None
    head = json.loads(line.decode('utf-8'))
    if not isinstance(head, dict):
        raise ValueError('ヘッダーがオブジェクトではありません')
    n = int(head.get('len') or 0)
    body = stream.read(n) if n else b''
    if len(body) != n:
        return None                    # 途中で閉じた
    return head, body


class Writer:
    """答えを書く係（複数の糸から呼ばれても、1つの枠を混ぜずに書く）。"""

    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, head, body=b''):
        line = json.dumps({**head, 'len': len(body)}, ensure_ascii=False).encode('utf-8') + b'\n'
        with self.lock:
            self.stream.write(line + body)
            self.stream.flush()


# ---------------- 1つの問い合わせをアプリへ渡す ----------------
def handle(app, head, body):
    """問い合わせのヘッダー・本文 → (答えのヘッダー, 本文)。アプリの中で何が起きても答えは返す。"""
    from werkzeug.test import EnvironBuilder, run_wsgi_app
    rid = head.get('id')
    try:
        env = EnvironBuilder(path=head.get('path') or '/', base_url=DESKTOP_BASE_URL,
                             query_string=head.get('query') or '',
                             method=(head.get('method') or 'GET').upper(),
                             headers=list((head.get('headers') or {}).items()),
                             data=body).get_environ()
        app_iter, status, headers = run_wsgi_app(app, env, buffered=True)
        try:
            out = b''.join(app_iter)
        finally:
            getattr(app_iter, 'close', lambda: None)()
        return {'id': rid, 'status': int(str(status).split()[0]),
                'headers': [[k, v] for k, v in headers.items() if k.lower() != 'content-length']}, out
    except Exception as e:             # ここまで来るのはアプリの外の失敗（枠の中身がおかしい等）
        _log().exception('SIDECAR 問い合わせを処理できませんでした path=%s', head.get('path'))
        msg = json.dumps({'error': f'問い合わせを処理できませんでした: {e}', 'type': type(e).__name__},
                         ensure_ascii=False).encode('utf-8')
        return {'id': rid, 'status': 500, 'headers': [['Content-Type', 'application/json']]}, msg


def serve(app, rin, writer, workers=WORKERS):
    """入力が閉じるまで問い合わせを読み、糸の組で答える（長い問い合わせが短いものを待たせない）。"""
    def one(head, body):
        h, b = handle(app, head, body)
        writer.send(h, b)

    pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix='sidecar')
    try:
        while True:
            try:
                frame = read_frame(rin)
            except ValueError as e:    # 壊れた行（JSON でない）。番号が分からないので答えられない——記録して続ける
                _log().warning('SIDECAR 読めない枠を捨てました: %s', e)
                continue
            if frame is None:
                break
            pool.submit(one, *frame)
    finally:
        # 入力が閉じた＝窓が終わった。答える先が無いので、待っている問い合わせは捨てる
        pool.shutdown(wait=False, cancel_futures=True)


def protocol_streams():
    """枠を通す入出力。標準出力は枠だけに使い、print や子プロセスの出力が紛れ込まないよう
    fd 1 を標準エラーへ向け直す（子プロセスは向け直した fd 1 を受け継ぐ）。"""
    rin = sys.stdin.buffer
    out = os.fdopen(os.dup(sys.stdout.fileno()), 'wb', buffering=0)
    try:
        sys.stdout.flush()
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    except (OSError, ValueError, AttributeError):
        pass
    sys.stdout = sys.stderr
    return rin, out


def _log():
    from backend.logging_setup import launcher_logger
    return launcher_logger()


def _prepare(writer, log):
    """起動前の確認（§9.225）。刻印が合えば飛ばす。**update.bat と同じ`setup_check.run()`**
    を通す（2つ持つと「片方では通るのに」が作れる）。していることは窓へ知らせる。"""
    from backend.launcher import ready, setup_check
    changes = ready.diff()
    if not changes:
        log.info('起動前の確認: 済んでいます。飛ばします')
        return True
    why = [text for _k, text in changes]
    log.info('起動前の確認: %s', ' / '.join(why))
    writer.send({'id': 0, 'event': 'progress', 'text': '起動前の確認をしています', 'reasons': why})

    def say(message, bad=False, quiet=False):
        (log.warning if bad else log.info)('起動前の確認: %s', message)
        if not quiet:
            writer.send({'id': 0, 'event': 'progress', 'text': message, 'bad': bool(bad)})
    ok, _reason = setup_check.run(say)
    return ok


def main():
    started = time.perf_counter()
    rin, out = protocol_streams()      # **何より先に**（以降の print・子プロセスの出力が枠を壊さない）
    writer = Writer(out)
    # backend は**向け直しの後に**読む（読み込みのときにコンソールへ書く物があっても枠に混ざらない）
    from backend.paths import ensure_local_dirs
    from backend.quiet import quiet
    try:
        ensure_local_dirs()
    except Exception as _e:
        quiet('実行時フォルダを用意できない（起動は続ける）', _e)
    log = _log()
    try:
        from backend.logging_setup import log_environment
        log.info('起動: デスクトップ版の窓口（標準入出力・ポートなし）')
        log_environment(log)
        if not _prepare(writer, log):
            writer.send({'id': 0, 'event': 'fatal', 'error': '必要な部品を用意できませんでした（launcher.log を確認）'})
            return 1
        from backend.app_module import flask_app as _app   # 素の`from app import`を書かない（§9.404）
        flask_app = _app()
        from backend.launcher import services
        services.start(log)
        from backend.changelog_data import APP_VERSION
    except Exception as e:             # 起動できない理由を窓（Rust）へ伝える
        log.exception('SIDECAR 起動できませんでした')
        writer.send({'id': 0, 'event': 'fatal', 'error': f'{type(e).__name__}: {e}'})
        return 1
    elapsed = round(time.perf_counter() - started, 3)
    log.info('起動準備: 完了 (%.2f秒・デスクトップ版)', elapsed)
    writer.send({'id': 0, 'event': 'ready', 'version': APP_VERSION, 'protocol': PROTOCOL, 'pid': os.getpid(),
                 'python': sys.executable, 'elapsed': elapsed})
    try:
        serve(flask_app, rin, writer)
    finally:
        # **終わり方は1本**（§9.301 ②）: 書込役・編集セッション・在席の片付けを通してから終わる。
        # 裏の糸（写し・見張り）は待たない。親（窓）はもう居ない。
        from backend import watchdog
        watchdog._exit(EXIT_REASON)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
