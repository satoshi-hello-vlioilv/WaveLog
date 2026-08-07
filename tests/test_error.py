#!/usr/bin/env python3
"""test_error.py: 想定外の例外を「調べられる形」で返すことを固定する（§9.77）。

============================================================
背景（実際に起きた不具合）
------------------------------------------------------------
別端末で、アプリを起動すると

    Internal Server Error
    The server encountered an internal error and was unable to
    complete your request.

とだけ出て先へ進めない、という報告が上がった。Flaskの既定の応答である。
困るのは**どこで何が失敗したのかが一切残らない**ことで、報告を受けても
調べる取っかかりが無い(/api/tables で同じ問題を踏んだのが §9.75)。

ここで固定するのは2つ。

 1. 未処理の例外は必ず traceback をログへ残し、画面には日本語で
    「何が起きたか」「次にどこを見ればよいか」を出す。API経路はJSON。
 2. **起動直後に必ず通る経路(GET / と /css/app.css)は、静的ファイルの
    更新時刻が取れないだけで落ちない。** アプリ本体が共有フォルダー上に
    ある場合、stat() はネットワーク越しの問い合わせになり、共有が一瞬
    応答しないだけで失敗し得る(WinError 59 等)。この値はブラウザの
    キャッシュを捨てさせるためだけのもので、画面を出せない理由にならない。
============================================================
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                      # noqa: E402
from backend.errors import os_error_hint     # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def net_error():
    """WinError 59 相当。Windows以外でも winerror を持たせて同じ分岐を通す。"""
    e = OSError(5, '予期しないネットワーク エラーが発生しました。')
    e.winerror = 59
    return e


# 検証用の壊れる経路は、最初のリクエストより**前**に登録する
# (Flaskは初回リクエスト以降のルート追加を拒否する)。
@flask_app.app.get('/__test_boom')
def _boom_page():
    raise net_error()


@flask_app.app.get('/api/__test_boom')
def _boom_api():
    raise RuntimeError('わざと壊す')


client = flask_app.app.test_client()

# ---- 1) 画面経路: 日本語で原因と次の一手が出る ----
r = client.get('/__test_boom')
body = r.data.decode('utf-8')
rec('未処理の例外は500のまま返す（成功に見せない）', r.status_code == 500, str(r.status_code))
rec('画面には日本語で説明が出る', '処理中にエラーが発生しました' in body)
rec('どの要求で失敗したかが分かる', '/__test_boom' in body)
rec('例外の種類とメッセージが出る', 'OSError' in body)
rec('ネットワーク共有のエラーは対処まで添える', 'WinError 59' in body and '共有' in body)
rec('ログの場所を案内する', 'app.log' in body)
rec('差し込みトークンが残っていない', '@METHOD@' not in body and '@KIND@' not in body)

# ---- 2) API経路: JSONで返す（フロントのapi()がそのまま拾える） ----
r = client.get('/api/__test_boom')
rec('API経路はJSONで返す', r.status_code == 500 and r.is_json, str(r.status_code))
j = r.get_json() or {}
rec('JSONに例外の内容が入っている', 'RuntimeError' in str(j.get('error', '')), str(j.get('error'))[:60])
rec('JSONに要求パスが入っている', j.get('path') == '/api/__test_boom', str(j.get('path')))

# ---- 3) HTTP例外（404など）は今までどおり ----
r = client.get('/__no_such_page')
rec('404は500に化けさせない', r.status_code == 404, str(r.status_code))

# ---- 4) 手がかりの文面 ----
rec('WinError 59 に手がかりが出る', 'WinError 59' in os_error_hint(net_error()))
rec('ファイルが無い場合の手がかりが出る', 'ファイル' in os_error_hint(FileNotFoundError('x')))
rec('ふつうの例外には余計な手がかりを付けない', os_error_hint(ValueError('x')) == '')

# ---- 5) 共有が応答しなくても起動直後の画面は出る（本題） ----
orig_stat, orig_glob = pathlib.Path.stat, pathlib.Path.glob
pathlib.Path.stat = lambda self, *a, **k: (_ for _ in ()).throw(net_error())
pathlib.Path.glob = lambda self, p: (_ for _ in ()).throw(net_error())
try:
    r = client.get('/')
    rec('静的ファイルのstatが失敗してもトップページは出る',
        r.status_code == 200 and len(r.data) > 1000, f'{r.status_code} / {len(r.data)}バイト')
    r = client.get('/css/app.css')
    rec('同じ状況でもCSSを返せる（直前に読めた内容を使う）',
        r.status_code == 200 and len(r.data) > 1000, f'{r.status_code} / {len(r.data)}バイト')
except Exception as e:
    rec('静的ファイルのstatが失敗してもトップページは出る', False, f'{type(e).__name__}: {e}')
finally:
    pathlib.Path.stat, pathlib.Path.glob = orig_stat, orig_glob

# ---- 6) tracebackが本当に app.log へ残る（ここが抜けると調査ができない） ----
# Flask は app.logger へ初めて触れたときハンドラの無いロガーへ既定の
# StreamHandler(標準エラー)を足す。Flask(__name__)のnameは 'app' なので
# app_logger() と同じロガーで、先を越されるとファイル出力が付かないまま
# になる。通常起動(Start.vbs)はコンソールを持たないので、その場合
# tracebackはどこにも残らない——実際にこれで調査できなかった。
import logging                                  # noqa: E402
import logging.handlers                         # noqa: E402
from backend.logging_setup import app_logger    # noqa: E402

log = logging.getLogger('app')
files = [h for h in log.handlers if isinstance(h, logging.handlers.RotatingFileHandler)]
rec('アプリ本体のログがファイルへ出る設定になっている', bool(files),
    ' / '.join(getattr(h, 'baseFilename', '?') for h in files) or 'ファイル出力なし')
rec('Flaskと同じロガーを使っている（app.logへ集まる）',
    flask_app.app.logger is log, flask_app.app.logger.name)

# Flaskが先にハンドラを付けてしまった状況でも、後から足せること。
probe = logging.getLogger('wavelog_test_probe')
probe.addHandler(logging.StreamHandler())        # 先を越された状態を再現
before = len(probe.handlers)
from backend.logging_setup import get_logger     # noqa: E402
get_logger('wavelog_test_probe', 'app.log', to_console=False)
added = [h for h in probe.handlers if isinstance(h, logging.handlers.RotatingFileHandler)]
rec('既にハンドラがあってもファイル出力を足せる', bool(added) and len(probe.handlers) > before,
    f'{before}→{len(probe.handlers)}')
# 二重呼び出しで増えない
get_logger('wavelog_test_probe', 'app.log', to_console=False)
rec('二重に呼んでもハンドラが増えない',
    len([h for h in probe.handlers if isinstance(h, logging.handlers.RotatingFileHandler)]) == 1)

# 実際に書けているか（末尾に自分の印が残ることを確かめる）
if files:
    mark = 'test_error 動作確認 %d' % id(files)
    app_logger().error(mark)
    for h in files:
        h.flush()
    try:
        tail = pathlib.Path(files[0].baseFilename).read_text(encoding='utf-8', errors='replace')[-4000:]
        rec('書いた内容が app.log に残る', mark in tail)
    except OSError as e:
        rec('書いた内容が app.log に残る', False, str(e))

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
