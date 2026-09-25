#!/usr/bin/env python3
"""test_faststart.py: 起動前の確認を別ファイルへ切り出した仕掛け(§9.225)。

============================================================
ここで固定すること
------------------------------------------------------------
- **刻印は端末ごと**。共有配置では、共有側へ書くと1台の確認結果を全台が
  信じることになる（Pythonの場所も版も端末ごとに違う）。
- **刻印は速さの門であって正しさの門ではない**。刻印を消しても起動できる
  （その場で確認し直す＝利用者の指示①の自己修復）。
- **確認の実処理は1箇所**。update.bat と起動時のフォールバックが同じ
  `setup_check.run()`を通る——2つ持つと「update.batでは通るのに起動では
  失敗する」が作れる。
- **進捗ファイル(boot_status.js)と待機画面の写しも端末ごと**。共有へ書くと
  2台が同時に起動したとき相手の進捗が自分の画面に出る。
- update.bat（旧`setup.bat`・§9.405）は **CP932**（UTF-8の日本語だとcmd.exeが誤読する）。
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
PROGRAM = ROOT / 'program'   # 直接実行する4本の置き場（§9.404）
sys.path.insert(0, str(ROOT))
# `import start_app`（下の 5b）が通るように。**本物と同じ探索先**で読む
# ——`program/_approot.py`がリポジトリ直下を足すので、素の名前で読める。
sys.path.insert(0, str(PROGRAM))
import _pycache_bootstrap  # noqa: E402,F401 副作用のためのimport（.pycの置き場）
from backend import boot_status  # noqa: E402
from backend.launcher import ready, setup_check  # noqa: E402
from backend.paths import APP_ROOT, local_root  # noqa: E402

API = 'http://127.0.0.1:5029'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


def say(_message, bad=False, quiet=False):
    """`setup_check.run()` が呼ぶ口（§9.431）。**`quiet=True` は記録だけ**
    ——受けられないと、そこを通った起動が TypeError で止まる。"""
    pass


def stop_app():
    subprocess.run([sys.executable, 'program/process_manager.py', 'stop'], cwd=ROOT,
                   capture_output=True, timeout=90)
    time.sleep(1.0)


def start_and_time(timeout=90):
    """起動してトップページが返るまでの秒数。返らなければ None。"""
    t0 = time.monotonic()
    subprocess.Popen([sys.executable, '-u', 'program/start_app.py'], cwd=ROOT,
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
        # **パスとして中にあるか**で見る（文字列の先頭一致だと `…/app` と `…/apphome` を取り違える）。
        inside_local = Path(path).is_relative_to(local_root())
        inside_app = Path(path).is_relative_to(APP_ROOT)
        rec(f'{label}は端末ごとの置き場（アプリ本体の側ではない）',
            inside_local and not inside_app, str(path))

    # ---- 2) 刻印が無ければ理由を言う ----
    ready.clear()
    why = ready.mismatch()
    rec('刻印が無いときは「初めての起動」と1文で言う（§9.415）',
        why == ['この端末では初めての起動です'], str(why))

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
    # **形が変わったときは、それだけを言う**（§9.415）。古い形の刻印と新しい
    # 指紋を1つずつ比べても「全部変わりました」としか出ず、手掛かりにならない。
    rec('刻印の形が古ければ確認し直す（理由はその1件だけ）',
        ready.mismatch() == ['起動前の確認の仕組みが新しくなりました'],
        str(ready.mismatch()))

    # ---- 4b) `pythonw.exe` と `python.exe` を同じものとして数える（§9.415） ----
    # **update.bat はコンソールの`python.exe`、Start.vbs は`pythonw.exe`**で
    # 同じ環境を起動する。実行ファイル名をそのまま控えると**永久に食い違い**、
    # update.bat を実行した次の起動が必ず完全な確認（30〜60秒）へ落ちて、
    # 待機画面に「Pythonの場所（…python.exe → …pythonw.exe）」が出ていた。
    W = r'C:\Py\pythoncore-3.14-64\pythonw.exe'
    E = r'C:\Py\pythoncore-3.14-64\python.exe'
    rec('pythonw.exe の指紋は python.exe と同じ', ready.python_mark(W) == E,
        f'{ready.python_mark(W)} / {E}')
    rec('python.exe の指紋は変えない', ready.python_mark(E) == E, ready.python_mark(E))
    rec('Pythonを別の場所へ移したら食い違いとして出る',
        ready.python_mark(r'D:\Other\python.exe') != E,
        ready.python_mark(r'D:\Other\python.exe'))
    # **`python`で始まる名前のときだけ**末尾のwを落とす（綴りの似た別物を潰さない）
    rec('pythonで始まらない名前の末尾wは落とさない',
        ready.python_mark(r'C:\Py\myw.exe') == r'C:\Py\myw.exe',
        ready.python_mark(r'C:\Py\myw.exe'))
    # 刻印ごしでも同じことを見る（本番の食い違いはここで起きていた）
    ready.stamp_file().write_text(
        json.dumps(dict(stamp, python=W), ensure_ascii=False), encoding='utf-8')
    saved_exe = sys.executable
    try:
        sys.executable = E
        rec('update.bat(python.exe)の刻印を pythonw.exe の起動が「合っている」と読む',
            not any('Python' in x for x in ready.mismatch()), str(ready.mismatch()))
        sys.executable = W
        rec('pythonw.exe どうしでも合っている',
            not any('Python' in x for x in ready.mismatch()), str(ready.mismatch()))
    finally:
        sys.executable = saved_exe

    # ---- 4c) 理由は**それだけで読める1文**（§9.415） ----
    # 「変わったもの: まだ確認していません」のような、文として成り立たない
    # 並びを画面へ出さない。長い置き場は末尾だけ残して読める長さにする。
    ready.stamp_file().write_text(
        json.dumps(dict(stamp, appRoot=r'C:\とても\長い\共有の\置き場\WaveLog\アプリ本体'),
                   ensure_ascii=False), encoding='utf-8')
    why = ready.mismatch()
    rec('理由は「〜ました／〜です」と読める1文（頭に「変わったもの:」を付けない）',
        bool(why) and all(('ました' in x) or x.endswith('です') for x in why), str(why))
    rec('長い置き場は末尾だけ残して短くする（…で始める）',
        any('…' in x for x in why), str(why)[:120])
    rec('鍵つきでも取れる（画面の題の言い分けに使う）',
        [k for k, _t in ready.diff()] == ['appRoot'], str(ready.diff()))

    # ---- 5) 待機画面の写しは中身が同じ ----
    src = (PROGRAM / 'loading.html').read_bytes()
    # 写す先は**次の起動用**（§9.314）なので、実際に使う名前へは
    # `promote_waiting_page()`で移る。2つで1組。
    setup_check.copy_waiting_page()
    setup_check.promote_waiting_page()
    rec('待機画面の写しは元と同じ中身',
        setup_check.waiting_page().read_bytes() == src,
        f'{len(src)}バイト')
    # ---- 5b) `say`の約束は say(m, bad=False, quiet=False)（§9.495） ----
    # 起動の裏の写し直しが渡す`say`が`quiet`を受けず、**写せたのに例外になって**
    # 「起動画面を写せませんでした」と逆のことをログへ残していた（実機のログで見つかった）。
    bad_say = []
    for f in list((ROOT / 'program').glob('*.py')) + list((ROOT / 'backend').rglob('*.py')):
        for m in re.finditer(r'say=lambda([^:]*):', f.read_text(encoding='utf-8', errors='replace')):
            if 'quiet' not in m.group(1) and '**' not in m.group(1):
                bad_say.append(f'{f.name}: lambda{m.group(1)}')
    rec('say=lambda はどれも quiet を受ける（§9.495）', not bad_say, ' / '.join(bad_say) or 'なし')
    # 相対で読む前提（写しの隣に進捗ファイルを置くのが筋になる）
    html = src.decode('utf-8')
    rec('待機画面は進捗ファイルを相対で読む（写しの隣を見る）',
        "src='boot_status.js" in html or 'src="boot_status.js' in html)
    rec('写しと進捗ファイルは同じフォルダに置かれる',
        setup_check.waiting_page().parent == boot_status.status_path().parent,
        str(setup_check.waiting_page().parent))

    # ---- 5b) 他PCで待機画面が出ない（§9.255 ③、利用者の報告） ----
    # 「他PCで起動に失敗する（モーダルが出ずエラー画面／loading.html 直クリック
    #   で復帰）」
    # 直したのは3つで、**どれが欠けても「何も出ない」に戻る**:
    #   ① 置き場の解決（`local_root()`）が送出しない＝起動の1行目で死なない
    #   ② 手元に写しが無くても**本体を読まずに**組み込みの簡易画面で開く
    #   ③ 手元にもテンポラリにも書けない、を作らない（候補を3段持つ）
    import tempfile  # noqa: E402
    from backend import paths as _paths  # noqa: E402
    import start_app as _start  # noqa: E402

    # ① 置き場が書けなくても**送出しない**。健全な端末の答えは変えない。
    _keep_root, _keep_env = _paths._LOCAL_ROOT, os.environ.get('LOCALAPPDATA')
    try:
        _paths._LOCAL_ROOT = None
        # **書けない置き場をわざと作る**——既存の「ファイル」を親にすると
        # `mkdir` は必ず失敗する（移動プロファイル・ポリシーで書けない端末の
        # 代わり。環境変数にNUL文字は入れられないので、この形で再現する）。
        blocker = Path(tempfile.gettempdir()) / 'wl-blocker.txt'
        blocker.write_text('x', encoding='utf-8')
        os.environ['LOCALAPPDATA'] = str(blocker / 'inside')
        picked = None
        raised = ''
        try:
            picked = _paths.local_root()
            _paths.ensure_local_dirs()
        except Exception as e:
            raised = f'{type(e).__name__}: {e}'
        rec('書けない置き場でも送出しない（起動の1行目で死なない）', not raised, raised)
        rec('書ける場所へ落ちる（一時フォルダーまで候補にする）',
            picked is not None and os.access(str(picked), os.W_OK), str(picked))
    finally:
        try:
            (Path(tempfile.gettempdir()) / 'wl-blocker.txt').unlink()
        except Exception:
            pass
        _paths._LOCAL_ROOT = _keep_root
        if _keep_env is None:
            os.environ.pop('LOCALAPPDATA', None)
        else:
            os.environ['LOCALAPPDATA'] = _keep_env

    # ② **本体を読まずに**開ける。写しを消した状態で、本体側の読み出しを
    #    わざと失敗させても待機画面のパスが返ること（＝直列路に本体が無い）。
    _page = setup_check.waiting_page()
    _backup = _page.read_bytes() if _page.exists() else None
    _real_copy = setup_check.copy_waiting_page
    try:
        _page.unlink(missing_ok=True)
        setup_check.copy_waiting_page = lambda say=None: (_ for _ in ()).throw(
            OSError('[WinError 59] 予期しないネットワークエラーです。'))
        _start.setup_check.copy_waiting_page = setup_check.copy_waiting_page

        class _Log:
            def info(self, *a, **k):
                pass
            warning = error = info
        got = _start._ensure_local_waiting_page(_Log())
        rec('写しが無く本体も読めなくても、待機画面のパスを返す（②）',
            got is not None and Path(got).exists(), str(got))
        rec('そのときは組み込みの簡易画面（目印が付く）',
            got is not None and _start._is_emergency_page(got), str(got))
        head = Path(got).read_text(encoding='utf-8', errors='ignore') if got else ''
        rec('簡易画面もサーバーを待って本体へ移る（http://を直接開かない）',
            '/api/ready.js' in head and 'location.replace' in head)
    finally:
        setup_check.copy_waiting_page = _real_copy
        _start.setup_check.copy_waiting_page = _real_copy
        if _backup is not None:
            _page.write_bytes(_backup)
    # ③ 候補は3段（渡された置き場 → 手元の runtime → 一時フォルダー）。
    #    **1つでも欠けると「1つもブラウザが開かない」経路が戻る。**
    _starter_src = (PROGRAM / 'start_app.py').read_text(encoding='utf-8')
    rec('書き出し先の候補に一時フォルダーがある（③）',
        'tempfile.gettempdir()' in _starter_src)
    # **コメントを落としてから見る**——この行の説明そのものに
    # `webbrowser.open(app_url())` と書いてあるので、素で探すと必ず当たる。
    _starter_code = '\n'.join(l for l in _starter_src.splitlines()
                              if not l.lstrip().startswith('#'))
    rec('サーバー未起動の http:// を直接開かない',
        'webbrowser.open(app_url())' not in _starter_code)
    rec('本体の写し直しは裏で走らせる（起動の直列路に置かない）',
        '_refresh_waiting_page_later' in _starter_src
        and 'daemon=True' in _starter_src)

    # ---- 5c) 開いた写しを、その起動のあいだ差し替えない（§9.314） ----
    # 利用者の報告「他のPCでは起動に失敗して、待機画面が
    # `ERR_FILE_NOT_FOUND`。**直接そのhtmlをクリックすると正しく起動する**」。
    # 以前は裏の写し直しが`waiting_page()`＝**いまブラウザへ渡したばかりの
    # ファイル**を置き換えており、本体（クラウド同期フォルダー）の読み出しが
    # 遅い端末では、ブラウザが立ち上がっている最中に差し替えが起きていた
    # （実測: 渡した1ms後ではなく1.2秒後）。手元にアプリを置いた開発機では
    # 読み出しが一瞬で終わり、差し替えはブラウザが起動する前に済むので
    # **開発機では一度も再現しない**——これが「自分のPCでは起きない」の正体。
    # **本体の読み出しをわざと遅くして測ること**——速いままだと、直す前でも
    # 差し替えが先に終わって通ってしまう（§9.108と同じ「Linuxでは何も
    # 起きない」の罠）。
    from backend import atomic_io as _aio  # noqa: E402
    _page = setup_check.waiting_page()
    _staged = setup_check.staged_waiting_page()
    _backup = _page.read_bytes() if _page.exists() else None
    _real_aio_replace, _real_os_replace = _aio.replace, os.replace
    _real_read_bytes = Path.read_bytes
    _real_wb = _start.webbrowser
    _replaced, _opened = [], {}
    try:
        def _slow_read(self):
            # 本体（共有・クラウド）側の読み出しだけ遅くする。
            if self.name == 'loading.html' and 'runtime' not in str(self):
                time.sleep(0.8)
            return _real_read_bytes(self)

        def _watch_aio(src_, dst_, **kw):
            _replaced.append((time.monotonic(), str(dst_)))
            return _real_aio_replace(src_, dst_, **kw)

        def _watch_os(src_, dst_):
            _replaced.append((time.monotonic(), str(dst_)))
            return _real_os_replace(src_, dst_)

        class _Browser:
            @staticmethod
            def open(uri):
                _opened['at'] = time.monotonic()
                _opened['path'] = uri.replace('file://', '')
                _opened['exists'] = Path(_opened['path']).exists()
                return True

        Path.read_bytes = _slow_read
        _aio.replace = _watch_aio
        setup_check.atomic_io = _aio
        os.replace = _watch_os
        _start.webbrowser = _Browser

        class _Log2:
            def info(self, *a, **k):
                pass
            warning = error = info
        _start.open_waiting_screen(_Log2())
        time.sleep(2.0)                      # 裏の写し直しが終わるまで
    finally:
        Path.read_bytes = _real_read_bytes
        _aio.replace = _real_aio_replace
        setup_check.atomic_io = _aio
        os.replace = _real_os_replace
        _start.webbrowser = _real_wb
    rec('待機画面を開いた時点で、そのファイルが在る',
        bool(_opened.get('exists')), str(_opened.get('path')))
    _after = [d for t_, d in _replaced
              if t_ >= _opened.get('at', 0) and d == str(_opened.get('path', ''))]
    rec('開いた写しは、その起動のあいだ差し替えない（§9.314）',
        not _after, '差し替え: ' + (' / '.join(_after) or 'なし'))
    rec('裏の写し直しは「次の起動用」の名前へ書く（§9.314）',
        any(d == str(_staged) for _t, d in _replaced)
        or setup_check.waiting_page().read_bytes() == (PROGRAM / 'loading.html').read_bytes(),
        '書いた先: ' + (' / '.join(sorted({Path(d).name for _t, d in _replaced})) or 'なし'))

    # 開く直前に消えていても、書き直して開く（外の掃除・ウイルス対策の隔離）。
    # **アプリは動いているのに利用者からは起動失敗にしか見えない**のがこの
    # 不具合の質の悪さなので、最後にもう一度確かめる。
    _real_ensure = _start._ensure_local_waiting_page
    _opened2 = {}
    try:
        _gone = setup_check.waiting_page().with_name('loading.gone.html')
        try:
            _gone.unlink()
        except Exception:
            pass
        _start._ensure_local_waiting_page = lambda log: _gone

        class _Browser2:
            @staticmethod
            def open(uri):
                _opened2['path'] = uri.replace('file://', '')
                _opened2['exists'] = Path(_opened2['path']).exists()
                return True
        _start.webbrowser = _Browser2
        _start.open_waiting_screen(_Log2())
    finally:
        _start._ensure_local_waiting_page = _real_ensure
        _start.webbrowser = _real_wb
    rec('開く直前に写しが消えていたら、書き直して開く（§9.314）',
        bool(_opened2.get('exists')), str(_opened2.get('path')))
    # **「在る」だけでは足りない**——隔離されて0バイトになった写しは
    # `exists()`を通るのにブラウザからは開けない。読めるかで見る。
    _real_ensure2 = _start._ensure_local_waiting_page
    _opened3 = {}
    try:
        _empty = setup_check.waiting_page().with_name('loading.empty.html')
        _empty.write_bytes(b'')
        _start._ensure_local_waiting_page = lambda log: _empty

        class _Browser3:
            @staticmethod
            def open(uri):
                _opened3['path'] = uri.replace('file://', '')
                try:
                    _opened3['size'] = Path(_opened3['path']).stat().st_size
                except Exception:
                    _opened3['size'] = -1
                return True
        _start.webbrowser = _Browser3
        _start.open_waiting_screen(_Log2())
    finally:
        _start._ensure_local_waiting_page = _real_ensure2
        _start.webbrowser = _real_wb
        try:
            _empty.unlink()
        except Exception:
            pass
    rec('中身が空の写しは「開ける」と数えない（§9.314）',
        _opened3.get('size', 0) > 0, str(_opened3))
    if _backup is not None:
        _page.write_bytes(_backup)

    # ---- 6) 確認の実処理は1箇所（起動側に写しを作らない） ----
    starter = (PROGRAM / 'start_app.py').read_text(encoding='utf-8')
    rec('起動側にパッケージ導入の写しを作っていない',
        'pip' not in starter and 'find_spec' not in starter)
    rec('起動側に旧DB取り込みの写しを作っていない',
        'マスタ.sqlite3' not in starter)
    rec('起動側は確認の1箇所を呼ぶ',
        'setup_check.run(' in starter, '')

    # ---- 6z) say の作法は1つ（§9.431） ----
    # `setup_check.run()` は「画面に出す／記録だけ」を`quiet`で言い分ける。
    # **渡す側が受けられないと、そこを通った起動が TypeError で止まる**
    # （update.bat の道と、刻印が食い違ったときの起動の道の2つがある）。
    # 綴りを追いかけるのではなく、**両方の`say`の引数**をここで見る。
    for name in ('program/setup_app.py', 'program/start_app.py'):
        src = (ROOT / name).read_text(encoding='utf-8')
        m = re.search(r'def say\(([^)]*)\)', src)
        rec(f'{name} の say は quiet を受ける（記録だけの行を渡せる）',
            bool(m) and 'quiet' in m.group(1), m.group(1) if m else 'say が無い')
    # **画面に出す言葉は setup_app.py の1箇所**（§9.431）。update.bat 側に
    # 「OK/NG」の言い分けを写すと、直したときに片方だけ古くなる。
    # 例外は「python が通っていない」——そのときは setup_app.py が動かない。
    bat_raw = (PROGRAM / 'update.bat').read_bytes()
    bat_txt = bat_raw.decode('cp932', errors='replace')
    rec('update.bat は結果の言い分けを持たない（言葉は setup_app.py の1箇所）',
        '準備ができました' not in bat_txt and bat_txt.count('goto ') <= 2,
        f"goto {bat_txt.count('goto ')}個")

    # ---- 6y) update.bat の画面は「結果と次にすること」だけ（§9.431） ----
    # 利用者の指摘「一般的には不要な情報が多いのでわかりにくい」。
    # **いちばん大きかったのは時刻つきの記録**——`launcher_logger()`が既定で
    # 画面にも出すので、`log_environment()`の6行を含めて記録がそのまま流れて
    # いた。記録は launcher.log に残し、画面は結果だけにする。
    # **実際に動かして出た字で見る**（呼び方を見るのではなく、出たものを見る）。
    setup_out = subprocess.run([sys.executable, 'program/setup_app.py'], cwd=ROOT,
                               capture_output=True, text=True, timeout=300)
    setup_txt = (setup_out.stdout or '')
    stamps = [x for x in setup_txt.splitlines() if re.match(r'^\d{4}-\d\d-\d\d \d\d:', x)]
    rec('update.bat の画面に時刻つきの記録を混ぜない（記録は launcher.log へ）',
        not stamps, f'{len(stamps)}行 混ざっている' + (f'（{stamps[0][:120]}）' if stamps else ''))
    rec('画面は「結果」と「次にすること」を言う',
        '準備ができました' in setup_txt and '次にすること' in setup_txt,
        setup_txt.replace('\n', ' / ')[:70])
    # **置き場の道は画面に出さない**（毎回同じで、読んでも打つ手が変わらない）。
    rec('置き場の道（刻印・バイトコード・写し）は画面に出さない',
        'ready.json' not in setup_txt and 'pycache' not in setup_txt
        and 'loading.html' not in setup_txt,
        setup_txt.replace('\n', ' / ')[:70])

    # ---- 7) update.bat / setup_app.py ----
    # 名前は`update.bat`（§9.405）。**押すのは「版が変わったら1回」**なので、
    # 名前がその時機を言う。旧`setup.bat`は残さない（入口を2つ持たない）。
    bat = PROGRAM / 'update.bat'
    rec('update.bat がある（§9.406で program/ へ）', bat.exists())
    rec('旧 setup.bat を入口として残していない（入口は1つ）',
        not (ROOT / 'setup.bat').exists() and not (PROGRAM / 'setup.bat').exists())
    if bat.exists():
        raw = bat.read_bytes()
        try:
            raw.decode('utf-8')
            utf8 = True
        except UnicodeDecodeError:
            utf8 = False
        rec('update.bat はCP932（UTF-8の日本語だとcmd.exeが誤読する）',
            not utf8 and b'setup_app.py' in raw)
    # ---- 7b) 起動スクリプトはCRLF ----
    # **LFだけだとcmd.exeがバッチを読み進める位置がずれる**（§9.229 ①）。
    # 実機では`rem`の行やechoの日本語が**行の途中から**コマンドとして実行され、
    # 「'after' は、内部コマンドまたは…」が並んだ。**2バイト文字の途中で
    # 切れる**（'ｫませんでした。'）ので、記号や引用符の問題では説明が付かない。
    # ここは**内容ではなく改行そのもの**を見る。
    # `Start.vbs`だけ直下（毎日の入口）、`.bat`3本は`program/`（§9.406）。
    for name in ('program/update.bat', 'program/start_app.bat',
                 'program/stop.bat', 'Start.vbs'):
        f = ROOT / name
        if not f.exists():
            rec(f'{name} がある', False)
            continue
        raw = f.read_bytes()
        lf = raw.count(b'\n')
        crlf = raw.count(b'\r\n')
        rec(f'{name} はCRLF改行（LFだけだとcmd.exeが行の途中から実行する）',
            lf > 0 and lf == crlf, f'LF={lf} CRLF={crlf}')
    rec('直接実行する4本とその道具は program/ にある（§9.404・§9.406）',
        all((PROGRAM / n).exists() for n in
            ('setup_app.py', 'start_app.py', 'app.py', 'process_manager.py',
             '_pycache_bootstrap.py', '_approot.py')),
        str(PROGRAM))
    # **リポジトリ直下にPythonは1本も置かない**（§9.406）。`.bat`も同じ
    # ——直下に残るのは`Start.vbs`（毎日の入口）と、移すと黙って無効になる
    # 2つ（`.gitignore`／`eslint.config.mjs`。理由は§9.406）だけ。
    stray = sorted(p.name for p in ROOT.glob('*.py')) + \
        sorted(p.name for p in ROOT.glob('*.bat'))
    rec('リポジトリ直下に .py / .bat を置かない（§9.406）', not stray, ', '.join(stray))
    rec('Start.vbs は直下のまま（毎日の入口は動かさない）',
        (ROOT / 'Start.vbs').exists())
    # 動かせない2つ。**移すと落ちるのではなく「黙って効かなくなる」**ので、
    # 在ることを機械で押さえる（§9.406の実測: eslint は 306件→0件）。
    rec('.gitignore は直下（gitはそのフォルダ以下にしか当てない）',
        (ROOT / '.gitignore').exists())
    rec('eslint.config.mjs は直下（program/へ移すと規則が1件も当たらない）',
        (ROOT / 'eslint.config.mjs').exists())

    # ---- 7c) 置き場・名前が変わった古いファイルを片付ける（§9.405） ----
    # 現場は**上書きコピー**で更新するので、古い`setup.bat`や直下の`app.py`は
    # 消えずに残る。古い`setup.bat`は`python setup_app.py`（§9.404で移す前の行）
    # を持っているので、**押すと失敗する**——押せるのに何も起きない物を残さない。
    #
    # **本物の`APP_ROOT`では試さない。** 消す網なので、作った場所だけで見る
    # （`setup_check.APP_ROOT`を差し替え、`finally`で必ず戻す）。
    # 見たいのは2つで、**どちらが欠けても網にならない**——
    #   ① 新しいほうが在れば古いほうが消える
    #   ② 新しいほうが**無ければ1バイトも触らない**（更新の途中・混ざった配置）
    _real_root = setup_check.APP_ROOT
    with tempfile.TemporaryDirectory() as _td:
        fake = Path(_td)
        try:
            setup_check.APP_ROOT = fake
            (fake / 'program').mkdir()
            (fake / 'program' / 'app.py').write_text('new', encoding='utf-8')
            (fake / 'app.py').write_text('old', encoding='utf-8')          # 片付く
            (fake / 'setup.bat').write_text('old', encoding='utf-8')       # まだ片付かない
            setup_check.sweep_shared_leftovers()
            rec('新しいほうが在る古いファイルは片付ける（§9.405）',
                not (fake / 'app.py').exists() and (fake / 'program' / 'app.py').exists())
            rec('新しいほうが無いうちは1バイトも触らない（更新の途中で消さない）',
                (fake / 'setup.bat').exists())
            (fake / 'update.bat').write_text('new', encoding='utf-8')
            setup_check.sweep_shared_leftovers()
            rec('改名した古い入口も、新しい入口が在れば片付ける（§9.405）',
                not (fake / 'setup.bat').exists() and (fake / 'update.bat').exists())
            # 直下の孤児 __pycache__（§9.406）。`.py`が1本も無いので誰も
            # 作り直さない。**`.pyc`だけのときに限って**消す。
            pyc = fake / '__pycache__'
            pyc.mkdir()
            (pyc / 'x.cpython-311.pyc').write_bytes(b'x')
            (pyc / 'memo.txt').write_text('触るな', encoding='utf-8')
            setup_check.sweep_shared_leftovers()
            rec('`.pyc`以外が混ざった __pycache__ は触らない（§9.406）', pyc.is_dir())
            (pyc / 'memo.txt').unlink()
            setup_check.sweep_shared_leftovers()
            rec('直下の孤児 __pycache__ を片付ける（§9.406）', not pyc.exists())
            # 直下に .py が在るうちは現役かもしれないので触らない
            pyc.mkdir()
            (pyc / 'x.cpython-311.pyc').write_bytes(b'x')
            (fake / 'なにか.py').write_text('x', encoding='utf-8')
            setup_check.sweep_shared_leftovers()
            rec('直下に .py が在るうちは __pycache__ を触らない（§9.406）', pyc.is_dir())
        finally:
            setup_check.APP_ROOT = _real_root

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
    html = (PROGRAM / 'loading.html').read_text(encoding='utf-8')
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
