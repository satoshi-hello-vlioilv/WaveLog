#!/usr/bin/env python3
"""test_faststart.py: 起動前の確認を別ファイルへ切り出した仕掛け(§9.225)。

============================================================
ここで固定すること
------------------------------------------------------------
- **刻印は端末ごと**。共有配置では、共有側へ書くと1台の確認結果を全台が
  信じることになる（Pythonの場所も版も端末ごとに違う）。
- **刻印は速さの門であって正しさの門ではない**。刻印を消しても起動できる
  （その場で確認し直す＝利用者の指示①の自己修復）。
- **確認の実処理は1箇所**。setup.bat と起動時のフォールバックが同じ
  `setup_check.run()`を通る——2つ持つと「setup.batでは通るのに起動では
  失敗する」が作れる。
- **進捗ファイル(boot_status.js)と待機画面の写しも端末ごと**。共有へ書くと
  2台が同時に起動したとき相手の進捗が自分の画面に出る。
- setup.bat は **CP932**（UTF-8の日本語だとcmd.exeが誤読する）。
- 起動スクリプトは **CRLF改行**（LFだけだとcmd.exeが行の途中から実行する）。

**確かめ方の注意**: 刻印を消した状態で「起動できること」まで見ること。
「刻印が書かれる」だけを見る網は、フォールバックが壊れていても通る。
============================================================
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import _pycache_bootstrap  # noqa: E402,F401
from backend import boot_status  # noqa: E402
from backend.launcher import ready, setup_check  # noqa: E402
from backend.paths import APP_ROOT, local_root, runtime_dir  # noqa: E402

API = 'http://127.0.0.1:5029'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


def say(_message, bad=False):
    pass


def stop_app():
    subprocess.run([sys.executable, 'process_manager.py', 'stop'], cwd=ROOT,
                   capture_output=True, timeout=90)
    time.sleep(1.0)


def start_and_time(timeout=90):
    """起動してトップページが返るまでの秒数。返らなければ None。"""
    t0 = time.monotonic()
    subprocess.Popen([sys.executable, '-u', 'start_app.py'], cwd=ROOT,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while time.monotonic() - t0 < timeout:
        try:
            urllib.request.urlopen(API + '/', timeout=1).read(1)
            return time.monotonic() - t0
        except Exception:
            time.sleep(0.05)
    return None


saved_stamp = ready.read()
try:
    # ---- 1) 置き場は端末ごと（共有側ではない） ----
    for label, path in (('刻印', ready.stamp_file()),
                        ('進捗ファイル', boot_status.status_path()),
                        ('待機画面の写し', setup_check.waiting_page())):
        inside_local = str(path).startswith(str(local_root()))
        inside_app = str(path).startswith(str(APP_ROOT))
        rec(f'{label}は端末ごとの置き場（アプリ本体の側ではない）',
            inside_local and not inside_app, str(path))

    # ---- 2) 刻印が無ければ理由を言う ----
    ready.clear()
    why = ready.mismatch()
    rec('刻印が無いときは「まだ確認していません」と言う',
        why == ['まだ確認していません'], str(why))

    # ---- 3) 確認を通すと刻印が合う ----
    ok, reason = setup_check.run(say)
    rec('確認一式が通る', ok is True, reason)
    rec('確認のあとは刻印が合う', ready.ok(), str(ready.mismatch()))

    # ---- 4) 版が変わったら「何が違うか」を名指しする ----
    stamp = ready.read() or {}
    bogus = dict(stamp, appVersion='0.0.0-検証')
    ready.stamp_file().write_text(json.dumps(bogus, ensure_ascii=False), encoding='utf-8')
    why = ready.mismatch()
    rec('版が違えば食い違いとして出る', any('アプリの版' in x for x in why), str(why))
    rec('食い違いは理由を名前で言う（数だけにしない）',
        bool(why) and all('（' in x for x in why), str(why))
    # 仕組みの版が上がれば全部作り直す
    ready.stamp_file().write_text(
        json.dumps(dict(stamp, stampVersion=stamp.get('stampVersion', 0) - 1),
                   ensure_ascii=False), encoding='utf-8')
    rec('刻印の形が古ければ確認し直す',
        any('確認の仕組みの版' in x for x in ready.mismatch()), str(ready.mismatch()))

    # ---- 5) 待機画面の写しは中身が同じ ----
    src = (APP_ROOT / 'loading.html').read_bytes()
    setup_check.copy_waiting_page()
    rec('待機画面の写しは元と同じ中身',
        setup_check.waiting_page().read_bytes() == src,
        f'{len(src)}バイト')
    # 相対で読む前提（写しの隣に進捗ファイルを置くのが筋になる）
    html = src.decode('utf-8')
    rec('待機画面は進捗ファイルを相対で読む（写しの隣を見る）',
        "src='boot_status.js" in html or 'src="boot_status.js' in html)
    rec('写しと進捗ファイルは同じフォルダに置かれる',
        setup_check.waiting_page().parent == boot_status.status_path().parent,
        str(setup_check.waiting_page().parent))

    # ---- 6) 確認の実処理は1箇所（起動側に写しを作らない） ----
    starter = (ROOT / 'start_app.py').read_text(encoding='utf-8')
    rec('起動側にパッケージ導入の写しを作っていない',
        'pip' not in starter and 'find_spec' not in starter)
    rec('起動側に旧DB取り込みの写しを作っていない',
        'マスタ.sqlite3' not in starter)
    rec('起動側は確認の1箇所を呼ぶ',
        'setup_check.run(' in starter, '')

    # ---- 7) setup.bat / setup_app.py ----
    bat = ROOT / 'setup.bat'
    rec('setup.bat がある', bat.exists())
    if bat.exists():
        raw = bat.read_bytes()
        try:
            raw.decode('utf-8')
            utf8 = True
        except UnicodeDecodeError:
            utf8 = False
        rec('setup.bat はCP932（UTF-8の日本語だとcmd.exeが誤読する）',
            not utf8 and b'setup_app.py' in raw)
    # ---- 7b) 起動スクリプトはCRLF ----
    # **LFだけだとcmd.exeがバッチを読み進める位置がずれる**（§9.229 ①）。
    # 実機では`rem`の行やechoの日本語が**行の途中から**コマンドとして実行され、
    # 「'after' は、内部コマンドまたは…」が並んだ。**2バイト文字の途中で
    # 切れる**（'ｫませんでした。'）ので、記号や引用符の問題では説明が付かない。
    # ここは**内容ではなく改行そのもの**を見る。
    for name in ('setup.bat', 'start_app.bat', 'stop.bat', 'Start.vbs'):
        f = ROOT / name
        if not f.exists():
            rec(f'{name} がある', False)
            continue
        raw = f.read_bytes()
        lf = raw.count(b'\n')
        crlf = raw.count(b'\r\n')
        rec(f'{name} はCRLF改行（LFだけだとcmd.exeが行の途中から実行する）',
            lf > 0 and lf == crlf, f'LF={lf} CRLF={crlf}')
    rec('setup_app.py はリポジトリ直下（直接実行されるもの）',
        (ROOT / 'setup_app.py').exists())

    # ---- 8) 刻印があっても無くても起動できる ----
    stop_app()
    ready.write()
    t_fast = start_and_time()
    rec('刻印があるとき起動できる', t_fast is not None,
        f'{t_fast*1000:.0f}ms' if t_fast else '起動しなかった')
    log = (local_root() / 'logs' / 'launcher.log')
    tail = log.read_text(encoding='utf-8', errors='replace')[-4000:] if log.exists() else ''
    rec('刻印があるときは確認を飛ばしたとログに残る',
        '起動前の確認: 済んでいます' in tail)

    stop_app()
    ready.clear()
    t_slow = start_and_time()
    rec('刻印が無くても起動できる（止めずに確認し直す）', t_slow is not None,
        f'{t_slow*1000:.0f}ms' if t_slow else '起動しなかった')
    rec('確認し直したら刻印が書かれる（次回から速い）', ready.ok(), str(ready.mismatch()))
    tail = log.read_text(encoding='utf-8', errors='replace')[-4000:] if log.exists() else ''
    rec('確認し直したことをログに残す（黙って遅くしない）',
        'この起動でまとめて確かめます' in tail)

    # ---- 9) 進捗ファイルは共有へ書かない ----
    rec('起動しても共有側に進捗ファイルを残さない',
        not (APP_ROOT / 'boot_status.js').exists(),
        str(APP_ROOT / 'boot_status.js'))

    # ---- 10) 待機画面の聞き方（体感の取りこぼし） ----
    html = (APP_ROOT / 'loading.html').read_text(encoding='utf-8')
    m = re.search(r'POLL_FAST_MS\s*=\s*(\d+)', html)
    rec('待機画面は立ち上がりを細かく聞く（500ms固定にしない）',
        bool(m) and int(m.group(1)) <= 200, m.group(1) if m else '見つからない')
finally:
    stop_app()
    if saved_stamp:
        try:
            ready.stamp_file().write_text(json.dumps(saved_stamp, ensure_ascii=False),
                                          encoding='utf-8')
        except Exception:
            pass

ok = sum(1 for x in R if x)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
