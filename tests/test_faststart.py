#!/usr/bin/env python3
"""test_faststart.py: 起動前の確認を別ファイルへ切り出した仕掛け(§9.225)。

============================================================
ここで固定すること
------------------------------------------------------------
- **刻印は端末ごと**。共有配置では、共有側へ書くと1台の確認結果を全台が
  信じることになる（Pythonの場所も版も端末ごとに違う）。
- **刻印は速さの門であって正しさの門ではない**。刻印を消しても起動できる
  （その場で確認し直す＝利用者の指示①の自己修復）。
- **確認の実処理は1箇所**。update.bat とデスクトップ版の窓口（`sidecar._prepare()`）が同じ
  `setup_check.run()`を通る——2つ持つと「update.batでは通るのに起動では
  失敗する」が作れる。
- **毎日の入口（Start.vbs）は exe を手元へ写して起こすだけ**（§9.548）。ブラウザ版の起動の道は無い。
- **外した物の残り**（上書きコピーで消えずに残る）は、新しい Start.vbs が届いていれば片付ける。
- update.bat（旧`setup.bat`・§9.405）は **CP932**（UTF-8の日本語だとcmd.exeが誤読する）。
- 起動スクリプトは **CRLF改行**（LFだけだとcmd.exeが行の途中から実行する）。

**確かめ方の注意**: 刻印を消した状態で「窓口が確認し直して通ること」まで見ること。
「刻印が書かれる」だけを見る網は、確認し直す道が壊れていても通る。
============================================================
"""
import json
import re
import subprocess
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
    # **渡す側が受けられないと、そこを通った起動が TypeError で止まる**
    # （update.bat の道と、刻印が食い違ったときの窓口の道の2つがある）。
    # 綴りを追いかけるのではなく、**両方の`say`の引数**をここで見る。
    for name in ('program/setup_app.py', 'program/sidecar.py'):
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
    # `Start.vbs`だけ直下（毎日の入口）、`update.bat`は`program/`（§9.406）。
    for name in ('program/update.bat', 'Start.vbs'):
        f = ROOT / name
        if not f.exists():
            rec(f'{name} がある', False)
            continue
        raw = f.read_bytes()
        lf = raw.count(b'\n')
        crlf = raw.count(b'\r\n')
        rec(f'{name} はCRLF改行（LFだけだとcmd.exeが行の途中から実行する）',
            lf > 0 and lf == crlf, f'LF={lf} CRLF={crlf}')
    rec('直接実行する3本とその道具は program/ にある（§9.404・§9.406・§9.544・§9.548）',
        all((PROGRAM / n).exists() for n in
            ('setup_app.py', 'app.py', 'sidecar.py', '_pycache_bootstrap.py', '_approot.py')),
        str(PROGRAM))
    gone = ('program/start_app.py', 'program/start_app.bat', 'program/stop.bat', 'program/process_manager.py',
            'program/loading.html', 'backend/launcher/guard.py', 'backend/launch_mode.py')
    rec('ブラウザ版の起動の道（start_app・process_manager・待機画面・.bat）は置いていない（§9.548）',
        not any((ROOT / n).exists() for n in gone), ', '.join(n for n in gone if (ROOT / n).exists()))
    rec('外した物はどれも片付けの一覧（RETIRED）に載っている（上書きコピーで残っても消える）',
        all(n in setup_check.RETIRED for n in gone), ', '.join(n for n in gone if n not in setup_check.RETIRED))
    # **リポジトリ直下にPythonは1本も置かない**（§9.406）。`.bat`も同じ
    # ——直下に残るのは`Start.vbs`（毎日の入口）と、移すと黙って無効になる
    # 2つ（`.gitignore`／`eslint.config.mjs`。理由は§9.406）だけ。
    stray = sorted(p.name for p in ROOT.glob('*.py')) + \
        sorted(p.name for p in ROOT.glob('*.bat'))
    rec('リポジトリ直下に .py / .bat を置かない（§9.406）', not stray, ', '.join(stray))
    rec('Start.vbs は直下のまま（毎日の入口は動かさない）',
        (ROOT / 'Start.vbs').exists())
    # 毎日の入口は**デスクトップ版だけ**（§9.546・§9.548）。exe を**手元の版ごとのフォルダへ写して**起動する
    # （Box の上の exe を直に起こすと、動いている間ファイルを掴み、その PC の更新が詰まる）。
    vbs = (ROOT / 'Start.vbs').read_bytes().decode('cp932')
    rec('Start.vbs は program\\WaveLog.exe を手元の版ごとのフォルダへ写して起動する（§9.546・§9.548）',
        all(w in vbs for w in ('"\\program\\WaveLog.exe"', '\\WaveLog\\desktop\\', 'f.Size', 'MoveFile tmp, dst')))
    rec('Start.vbs は program の場所を exe へ渡す（WAVELOG_PROGRAM_DIR）',
        '("WAVELOG_PROGRAM_DIR") = root & "\\program"' in vbs)
    rec('Start.vbs はブラウザ版を起こさない（start_app.py・pythonw を呼ばない・§9.548）',
        'start_app.py' not in vbs and 'pythonw' not in vbs)
    rec('exe が無い・写せない・起こせないときは理由と次の一手を出す（黙ってブラウザ版へ逃げない）',
        vbs.count('StartDesktop = "') >= 3 and 'MsgBox why' in vbs and 'ZIP' in vbs,
        '理由 %d個' % vbs.count('StartDesktop = "'))
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
            # 外した物（§9.548）。**合図は新しい Start.vbs**（start_app.py を起こさない）。
            for n in ('program/start_app.py', 'program/loading.html', 'stop.bat', 'backend/launch_mode.py'):
                (fake / n).parent.mkdir(parents=True, exist_ok=True)
                (fake / n).write_text('old', encoding='utf-8')
            (fake / 'Start.vbs').write_bytes(b'sh.Run "pythonw.exe " & root & "\\program\\start_app.py"')
            setup_check.sweep_shared_leftovers()
            rec('古い Start.vbs のうちは外した物を1バイトも触らない（届く途中で消さない）',
                (fake / 'program' / 'start_app.py').exists() and (fake / 'stop.bat').exists())
            (fake / 'Start.vbs').write_bytes(b'src = root & "\\program\\WaveLog.exe"')
            setup_check.sweep_shared_leftovers()
            left = [n for n in ('program/start_app.py', 'program/loading.html', 'stop.bat', 'backend/launch_mode.py')
                    if (fake / n).exists()]
            rec('新しい Start.vbs が届いていれば、外した物を片付ける（§9.548）', not left, ', '.join(left))
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
