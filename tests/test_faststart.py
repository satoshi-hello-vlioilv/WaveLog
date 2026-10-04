#!/usr/bin/env python3
"""test_faststart.py: 起動前の確認を別ファイルへ切り出した仕掛け(§9.225)。

============================================================
ここで固定すること
------------------------------------------------------------
- **刻印は端末ごと**。共有配置では、共有側へ書くと1台の確認結果を全台が
  信じることになる（Pythonの場所も版も端末ごとに違う）。
- **刻印は速さの門であって正しさの門ではない**。刻印を消しても起動できる
  （その場で確認し直す＝利用者の指示①の自己修復）。
- **確認の実処理は1箇所**。デスクトップ版の窓口（`sidecar._prepare()`）が`setup_check.run()`を通る。
- **毎日の入口は exe**（§9.554）。Start.vbs・update.bat・setup_app.py は §9.559 で外した（手で押す入口を持たない）。
- **外した物の残り**（上書きコピーで消えずに残る）は、デスクトップ版の窓の中で動いているときに片付ける。

**確かめ方の注意**: 刻印を消した状態で「窓口が確認し直して通ること」まで見ること。
「刻印が書かれる」だけを見る網は、確認し直す道が壊れていても通る。
============================================================
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = ROOT / 'program'   # 直接実行する4本の置き場（§9.404）
sys.path.insert(0, str(ROOT))
# `import sidecar`（下の 8）が通るように。**本物と同じ探索先**で読む
# ——`program/_approot.py`がリポジトリ直下を足すので、素の名前で読める。
sys.path.insert(0, str(PROGRAM))
import _pycache_bootstrap  # noqa: E402,F401 副作用のためのimport（.pycの置き場）
from backend.launcher import ready, setup_check  # noqa: E402
from backend.paths import APP_ROOT, local_root  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


def say(_message, bad=False, quiet=False):
    """`setup_check.run()` が呼ぶ口（§9.431）。**`quiet=True` は記録だけ**
    ——受けられないと、そこを通った起動が TypeError で止まる。"""
    pass


saved_stamp = ready.read()
try:
    # ---- 1) 置き場は端末ごと（共有側ではない） ----
    for label, path in (('刻印', ready.stamp_file()),):
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

    # ---- 5b) `say`の約束は say(m, bad=False, quiet=False)（§9.495） ----
    # 起動の裏の写し直しが渡す`say`が`quiet`を受けず、**写せたのに例外になって**
    # 「起動画面を写せませんでした」と逆のことをログへ残していた（実機のログで見つかった）。
    bad_say = []
    for f in list((ROOT / 'program').glob('*.py')) + list((ROOT / 'backend').rglob('*.py')):
        for m in re.finditer(r'say=lambda([^:]*):', f.read_text(encoding='utf-8', errors='replace')):
            if 'quiet' not in m.group(1) and '**' not in m.group(1):
                bad_say.append(f'{f.name}: lambda{m.group(1)}')
    rec('say=lambda はどれも quiet を受ける（§9.495）', not bad_say, ' / '.join(bad_say) or 'なし')
    # ---- 6) 確認の実処理は1箇所（窓口は setup_check.run を呼ぶ） ----
    sidecar_src = (PROGRAM / 'sidecar.py').read_text(encoding='utf-8')
    rec('窓口は確認の1箇所（setup_check.run）を呼び、写しを作らない',
        'setup_check.run(' in sidecar_src and 'pip' not in sidecar_src and 'マスタ.sqlite3' not in sidecar_src)

    # ---- 6z) say の作法は1つ（§9.431） ----
    # `setup_check.run()` は「画面に出す／記録だけ」を`quiet`で言い分ける。
    # **渡す側が受けられないと、そこを通った起動が TypeError で止まる**。
    src = (PROGRAM / 'sidecar.py').read_text(encoding='utf-8')
    m = re.search(r'def say\(([^)]*)\)', src)
    rec('program/sidecar.py の say は quiet を受ける（記録だけの行を渡せる）',
        bool(m) and 'quiet' in m.group(1), m.group(1) if m else 'say が無い')

    # ---- 7) 手で押す入口を持たない（§9.559、利用者の指示「vbsをはじめ、不要なファイルの整理」） ----
    # 毎日の入口は exe・起動前の確認は起動のたびに窓口が行う。Start.vbs（移行期間の入口）と
    # update.bat／setup_app.py（手で押す確認）は置かず、前に置いた物は片付けの一覧に載せる。
    hand = ('Start.vbs', 'program/update.bat', 'program/setup_app.py', 'update.bat', 'setup.bat', 'setup_app.py')
    rec('Start.vbs・update.bat・setup_app.py を置いていない（§9.559）',
        not any((ROOT / n).exists() for n in hand), ', '.join(n for n in hand if (ROOT / n).exists()))
    rec('外した入口はどれも片付けの一覧（RETIRED_DESKTOP）に載っている（上書きコピーで残っても消える）',
        all(n in setup_check.RETIRED_DESKTOP for n in hand), ', '.join(n for n in hand if n not in setup_check.RETIRED_DESKTOP))
    stray_scripts = sorted(str(p.relative_to(ROOT)) for p in list(ROOT.glob('*.vbs')) + list(ROOT.glob('*.bat'))
                           + list(PROGRAM.glob('*.vbs')) + list(PROGRAM.glob('*.bat')))
    rec('起動スクリプト（.vbs・.bat）を1本も置かない（WSH・cmd を通らない）', not stray_scripts, ', '.join(stray_scripts))
    rec('直接実行する3本とその道具は program/ にある（§9.404・§9.406・§9.544・§9.548）',
        all((PROGRAM / n).exists() for n in
            ('app.py', 'sidecar.py', '_pycache_bootstrap.py', '_approot.py')),
        str(PROGRAM))
    gone = ('program/start_app.py', 'program/start_app.bat', 'program/stop.bat', 'program/process_manager.py',
            'program/loading.html', 'backend/launcher/guard.py', 'backend/launch_mode.py')
    rec('ブラウザ版の起動の道（start_app・process_manager・待機画面・.bat）は置いていない（§9.548）',
        not any((ROOT / n).exists() for n in gone), ', '.join(n for n in gone if (ROOT / n).exists()))
    rec('外した物はどれも片付けの一覧（RETIRED）に載っている（上書きコピーで残っても消える）',
        all(n in setup_check.RETIRED for n in gone), ', '.join(n for n in gone if n not in setup_check.RETIRED))
    # **リポジトリ直下にPythonは1本も置かない**（§9.406）。`.bat`も同じ
    # ——直下に残るのは、移すと黙って無効になる2つ（`.gitignore`／`eslint.config.mjs`。理由は§9.406）だけ。
    stray = sorted(p.name for p in ROOT.glob('*.py')) + \
        sorted(p.name for p in ROOT.glob('*.bat'))
    rec('リポジトリ直下に .py / .bat を置かない（§9.406）', not stray, ', '.join(stray))
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
    _real_dirs = (setup_check.runtime_dir, setup_check.browser_dir)
    with tempfile.TemporaryDirectory() as _td:
        fake = Path(_td)
        try:
            setup_check.APP_ROOT = fake
            (fake / 'rt').mkdir()
            setup_check.runtime_dir = setup_check.browser_dir = lambda: fake / 'rt'
            (fake / 'program').mkdir()
            (fake / 'program' / 'app.py').write_text('new', encoding='utf-8')
            (fake / 'app.py').write_text('old', encoding='utf-8')          # 片付く
            (fake / 'requirements.txt').write_text('old', encoding='utf-8')  # 新しいほうが無いので片付かない
            setup_check.sweep_shared_leftovers()
            rec('新しいほうが在る古いファイルは片付ける（§9.405）',
                not (fake / 'app.py').exists() and (fake / 'program' / 'app.py').exists())
            rec('新しいほうが無いうちは1バイトも触らない（更新の途中で消さない）',
                (fake / 'requirements.txt').exists())
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
            # 外した物（§9.548・§9.559）。**合図はデスクトップ版の窓の中で動いていること**（窓が名乗る`WAVELOG_SHELL`）。
            retired = ('program/start_app.py', 'program/loading.html', 'stop.bat', 'backend/launch_mode.py',
                       'Start.vbs', 'program/update.bat', 'program/setup_app.py', 'setup.bat')
            for n in retired:
                (fake / n).parent.mkdir(parents=True, exist_ok=True)
                (fake / n).write_text('old', encoding='utf-8')
            _shell = os.environ.pop('WAVELOG_SHELL', None)
            try:
                setup_check.sweep_shared_leftovers()
                rec('窓の外（開発・網）では外した物を1バイトも触らない',
                    all((fake / n).exists() for n in retired))
                os.environ['WAVELOG_SHELL'] = 'desktop'
                (fake / '.git').mkdir()
                setup_check.sweep_shared_leftovers()
                rec('開発の作業ツリー（.git）では窓の中でも触らない（更新の update.rs と同じ線引き）',
                    all((fake / n).exists() for n in retired))
                (fake / '.git').rmdir()
                setup_check.sweep_shared_leftovers()
                left = [n for n in retired if (fake / n).exists()]
                rec('窓の中なら、外した物（ブラウザ版の道・Start.vbs・update.bat・setup_app.py）を片付ける（§9.548・§9.559）',
                    not left, ', '.join(left))
            finally:
                os.environ.pop('WAVELOG_SHELL', None)
                if _shell is not None:
                    os.environ['WAVELOG_SHELL'] = _shell
            # 期待する名前は**網の側に書く**（製品の一覧をそのまま材料にすると、一覧から抜けた物を見逃す）。
            local_left = ('loading.html', 'loading.next.html', 'boot_status.js', 'instance.json')
            for n in local_left:
                (fake / 'rt' / n).write_text('old', encoding='utf-8')
            (fake / 'rt' / 'ready.json').write_text('{}', encoding='utf-8')
            (fake / 'boot_status.js').write_text('old', encoding='utf-8')
            setup_check.sweep_shared_leftovers()
            rec('端末の手元に残った待機画面・進捗・起動中の印を片付け、刻印は残す（§9.548）',
                not any((fake / 'rt' / n).exists() for n in local_left)
                and (fake / 'rt' / 'ready.json').exists() and not (fake / 'boot_status.js').exists())
        finally:
            setup_check.APP_ROOT = _real_root
            setup_check.runtime_dir, setup_check.browser_dir = _real_dirs

    # ---- 8) 刻印があっても無くても窓口は通る（§9.225・§9.544） ----
    # 刻印は速さの門であって正しさの門ではない。**刻印が無ければ窓口がその場で確認し直す**。
    import sidecar  # noqa: E402  program/sidecar.py（起動前の確認の道）

    class _W:
        def __init__(self):
            self.sent = []

        def send(self, head, body=b''):
            self.sent.append(head)

    class _L:
        def __init__(self):
            self.lines = []

        def info(self, f, *a):
            self.lines.append(f % a if a else f)
        warning = info

    ready.write()
    w, lg = _W(), _L()
    rec('刻印があるときは確認を飛ばし、そう記録する', sidecar._prepare(w, lg) is True
        and any('済んでいます' in x for x in lg.lines) and not w.sent, ' / '.join(lg.lines)[:80])
    ready.clear()
    w, lg = _W(), _L()
    rec('刻印が無くても止めずに確認し直す（窓口が通る）', sidecar._prepare(w, lg) is True, ' / '.join(lg.lines)[:80])
    rec('確認し直したら刻印が書かれる（次回から速い）', ready.ok(), str(ready.mismatch()))
    rec('確認し直していることを窓へ知らせる（黙って遅くしない）',
        any(h.get('event') == 'progress' for h in w.sent), str(len(w.sent)))
finally:
    if saved_stamp:
        try:
            ready.stamp_file().write_text(json.dumps(saved_stamp, ensure_ascii=False),
                                          encoding='utf-8')
        except Exception:
            pass

ok = sum(1 for x in R if x)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
