"""setup_check.py: 起動前の確認と下ごしらえ(§9.225)。

刻印が食い違ったときのデスクトップ版の窓口（`program/sidecar.py`の`_prepare()`）がここを通る。
（以前は`update.bat`も同じここを通っていた。§9.559 で update.bat を外し、確認は起動の1本になった。）

ここでやること(どれも「環境が変わらない限り答えが変わらない」もの):
  1. ローカル領域のフォルダを作る
  2. 必要な部品(flask)が揃っているか確認し、無ければ導入する
  3. **バイトコードを事前にコンパイルする**(いちばん効く。実測5.5倍)
  4. 旧配置のDBファイルを取り込む
  5. 外した物・置き場が変わった物の残りを片付ける（`RETIRED`・`MOVED_AWAY`）
  6. 通ったら刻印を書く

**共有配置を前提にする。** アプリ本体が共有フォルダーにあるとき、
バイトコードを元ファイルの隣(`__pycache__`)へ書くと、書けないか、
書けても全台で1つを取り合うことになる。`_pycache_bootstrap`が
`sys.pycache_prefix`を端末ごとの場所へ向けてあるので、**コンパイルも
その設定が効いた状態で走らせる**こと(`compileall`は
`importlib.util.cache_from_source()`を通るのでprefixに従う)。
"""
import compileall
import importlib.util
import subprocess
import sys

from ..config import REQUIRED_PACKAGES
from ..paths import APP_ROOT, PROGRAM_DIR, browser_dir, ensure_local_dirs, runtime_dir
from . import ready
from ..quiet import quiet

# 旧配置(リポジトリ直下 / data フォルダ)に残っているDBファイルの取り込み先。
# 取り込み先に同名ファイルが既にある場合は上書きしない(繰り返し実行しても安全)。
LEGACY_DB = (
    ('マスタ.sqlite3', 'db/master.sqlite3'),
    ('測定データ.sqlite3', 'db/records.sqlite3'),
    ('data/マスタ.sqlite3', 'db/master.sqlite3'),
    ('data/測定データ.sqlite3', 'db/records.sqlite3'),
)
# 事前コンパイルの対象。アプリのコードだけ(site-packagesは触らない——
# 共有でも他人の環境でもないし、pipが入れた時点で済んでいる)。
COMPILE_TARGETS = ('backend',)
# 直接実行する3本と、その道具は`program/`（§9.404・§9.406・§9.548）。
# リポジトリ直下に置くPythonは**1本も無い**。
COMPILE_FILES = ('program/app.py', 'program/sidecar.py',
                 'program/_pycache_bootstrap.py', 'program/_approot.py')

# 置き場・名前が変わったもの（§9.404・§9.405）。**現場は上書きコピーで更新する**
# ので、古いほうは消えずに残る——しかも古い`setup.bat`は`python setup_app.py`と
# いう**移した前の行**を持っているので、押すと失敗する（押せるのに何も起きない
# 物を残さない・§CLAUDE 画面の基準4）。
#
# **消してよい理由は「新しいほうが在る」こと**。§9.249の「消えても取り直せる
# ものだけ」とは別の話で、ここで消すのは**中身が新しい場所に在る写し**
# ——だから**片方しか無いうちは1バイトも触らない**（更新の途中や、混ざった
# 配置で消してしまわないため）。
MOVED_AWAY = (
    ('app.py', 'program/app.py'),
    ('requirements.txt', 'program/requirements.txt'),
    ('requirements-dev.txt', 'program/requirements-dev.txt'),
    ('_pycache_bootstrap.py', 'program/_pycache_bootstrap.py'),
)

# **外した物**（§9.548、利用者の指示「一本化を進めて」——ブラウザ版の起動の道を外した）。
# 移した先が無いので`MOVED_AWAY`の「新しいほうが在るとき」は使えない。合図は`_retired_ok()`
# （§9.559 から「デスクトップ版の窓の中で動いている」。前は「新しい Start.vbs が届いている」だった）。
RETIRED = (
    'program/start_app.py', 'program/start_app.bat', 'program/stop.bat',
    'program/process_manager.py', 'program/loading.html',
    'backend/launcher/guard.py', 'backend/launch_mode.py',
    # §9.404・§9.406 より前の置き場（直下）に残っている同じ物
    'start_app.py', 'process_manager.py', 'loading.html', 'start_app.bat', 'stop.bat',
)
# 端末の手元に残る、もう使わない物——ブラウザ版だけが使っていた物（待機画面の写し・進捗・起動中の印）と、
# ショートカットの補助スクリプト（§9.552。いまは窓〈exe〉が直に作る）。
RETIRED_LOCAL = ('loading.html', 'loading.next.html', 'boot_status.js', 'instance.json', 'make_shortcut.vbs')
# **デスクトップ版へ移って要らなくなった入口**（§9.559、利用者の指示「デスクトップ版への移行も進んできているので、
# vbsをはじめ、不要なファイルの整理もお願いします」）。毎日の入口は exe・起動前の確認は起動のたびに窓口が行うので、
# `Start.vbs`（移行期間の入口）と`update.bat`／`setup_app.py`（手で押す確認）は誰も起こさない。前の置き場・前の名前の物も同じ。
# 前に`Start.vbs`へ作ったショートカットは、窓の中で起動したときに入口へ付け替わる（`desktop_shortcut.migrate()`・§9.554）。
RETIRED_DESKTOP = ('Start.vbs', 'program/update.bat', 'program/setup_app.py', 'update.bat', 'setup.bat', 'setup_app.py')


def _no_window():
    """pythonw(コンソール非表示)から子プロセスを起動しても黒い画面を出さない。"""
    if sys.platform == 'win32':
        return {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)}
    return {}


def missing_packages():
    return [name for name in REQUIRED_PACKAGES if importlib.util.find_spec(name) is None]


def ensure_packages(say):
    missing = missing_packages()
    if not missing:
        say('必要な部品（%s）' % ', '.join(REQUIRED_PACKAGES))
        return True
    say('必要な部品が足りません（%s）。いま導入します' % ', '.join(missing))
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', str(PROGRAM_DIR / 'requirements.txt')],
            capture_output=True, text=True, **_no_window())
    except Exception as e:
        say('必要な部品を導入できませんでした: %s' % e, bad=True)
        return False
    if result.returncode != 0:
        say('必要な部品を導入できませんでした\n%s' % (result.stderr or '').strip()[:2000], bad=True)
        return False
    say('必要な部品（%s）を導入しました' % ', '.join(missing))
    return True


def precompile(say):
    """バイトコードを先に作っておく。**失敗しても起動は止めない**——
    その場でコンパイルされるだけで、遅くなるだけだから。"""
    if sys.pycache_prefix is None:
        # `_pycache_bootstrap`を通さずに呼ばれた場合。元ファイルの隣へ書くと
        # 共有を汚すので、**何もしない**方を選ぶ(黙って場所を変えない)。
        say('起動を速くする準備を飛ばしました（置き場が決まっていません）', bad=True)
        return False
    ok = True
    for name in COMPILE_TARGETS:
        target = APP_ROOT / name
        if not target.exists():
            continue
        ok = compileall.compile_dir(str(target), quiet=1, force=False,
                                    workers=0) and ok
    for name in COMPILE_FILES:
        path = APP_ROOT / name
        if path.exists():
            ok = compileall.compile_file(str(path), quiet=1, force=False) and ok
    if ok:
        say('起動を速くする準備（事前コンパイル）')
        # **置き場の道は記録だけ**（§9.431）。毎回同じで、読んでも打つ手が変わらない。
        say('バイトコードの置き場: %s' % sys.pycache_prefix, quiet=True)
    else:
        say('一部のバイトコードを用意できませんでした'
            '（起動はできます。その回だけ少し遅くなります）', bad=True)
    return ok


def adopt_legacy_databases(say):
    (APP_ROOT / 'db').mkdir(exist_ok=True)
    for old_name, new_name in LEGACY_DB:
        old = APP_ROOT / old_name
        new = APP_ROOT / new_name
        if old.exists() and not new.exists():
            try:
                old.rename(new)
                say('古いDBを取り込みました: %s → %s' % (old_name, new_name))
            except Exception as e:
                say('古いDBを取り込めませんでした（%s）: %s' % (old_name, e), bad=True)


def _sweep_orphan_pycache(say=None):
    """アプリの置き場の直下に残った`__pycache__`を片付ける（§9.406）。

    直下に`.py`が**1本も無くなった**（`_pycache_bootstrap.py`も`program/`へ
    移した）ので、そこの`.pyc`は**もう誰も作り直さないし、誰も読まない**。
    §9.249の「消えても取り直せるものだけ」より更に手前——取り直されもしない。

    **`.pyc`だけで出来ているときに限る。** 中に別の物が入っていたら、それは
    こちらの知らない物なので触らない。直下にまだ`.py`が在るなら、その
    `__pycache__`は現役かもしれないので触らない。
    """
    d = APP_ROOT / '__pycache__'
    try:
        if not d.is_dir() or any(APP_ROOT.glob('*.py')):
            return
        kids = list(d.iterdir())
        if not kids or not all(k.is_file() and k.suffix == '.pyc' for k in kids):
            return
        for k in kids:
            k.unlink()
        d.rmdir()
        if say:
            say('もう読まれない __pycache__ を片付けました: %s' % d)
    except Exception as _e:
        quiet('いらないファイルを消せない（次の掃除で片付く）',_e)


def _retired_ok():
    """外した物を片付けてよいか（`RETIRED`・`RETIRED_DESKTOP`の合図）。**デスクトップ版の窓の中で動いているとき**だけ真
    ——その PC はもう exe から起動しているので、外した入口を起こす者は居ない（§9.559）。開発の作業ツリー（`.git`）は
    触らない（更新の`update.rs`と同じ線引き）。"""
    from .. import desktop_shell   # 遅延: 起動前の確認の読み込みを軽く保つ
    return desktop_shell.running()['kind'] == 'desktop' and not (APP_ROOT / '.git').exists()


def _unlink(path, label, say):
    try:
        if path.is_file():
            path.unlink()
            if say:
                say('%s: %s' % (label, path))
    except Exception as _e:
        quiet('いらないファイルを消せない（次の掃除で片付く）',_e)


def sweep_shared_leftovers(say=None):
    """以前の版が残したものを片付ける(§9.225・§9.404・§9.405・§9.548)。

    3種類ある:
      ① 置き場・名前が変わった実行ファイル(`MOVED_AWAY`)——**新しいほうが
         在るときだけ**片付ける。古い`setup.bat`は押すと失敗するので、
         残すほうが害がある。
      ② 外した物(`RETIRED`・`RETIRED_DESKTOP`)——ブラウザ版の起動の道と、Start.vbs・update.bat。
         デスクトップ版の窓の中で動いているときだけ（§9.559）。
      ③ 端末の手元の、ブラウザ版だけが使っていた物(`RETIRED_LOCAL`)と、共有側に残った進捗ファイル。

    放っておくと共有フォルダーに意味の分からないファイルが残り続け、
    「これは何か」を次に触る人に調べさせることになる。**消せなくても
    黙って進む**——読み取り専用の共有に置いている現場もある。
    **消したことは黙らない**（`say`で1件ずつ言う）。"""
    _unlink(APP_ROOT / 'boot_status.js', '以前の進捗ファイルを片付けました', say)
    _sweep_orphan_pycache(say)
    for old_name, new_name in MOVED_AWAY:
        stale = APP_ROOT / old_name
        moved = APP_ROOT / new_name
        try:
            # **両方が揃っているときだけ**。片方しか無いのは「まだ移して
            # いない」か「もう片付いた」のどちらかで、どちらも触る場面ではない。
            if stale.is_file() and moved.is_file():
                stale.unlink()
                if say:
                    say('置き場が変わった古いファイルを片付けました: %s（いまは %s）'
                        % (old_name, new_name))
        except Exception as _e:
            quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
    if _retired_ok():
        for name in RETIRED + RETIRED_DESKTOP:
            _unlink(APP_ROOT / name, '外したファイルを片付けました', say)
    for d in {runtime_dir(), browser_dir()}:
        for name in RETIRED_LOCAL:
            _unlink(d / name, 'この端末に残っていた、もう使わないファイルを片付けました', say)


def run(say, write_stamp=True):
    """確認一式。戻り値は (通ったか, 失敗の理由)。"""
    ensure_local_dirs()
    if not ensure_packages(say):
        return False, '必要な部品を用意できませんでした'
    precompile(say)
    adopt_legacy_databases(say)
    sweep_shared_leftovers(say)
    if write_stamp:
        if ready.write():
            say('確認の刻印を書きました: %s' % ready.stamp_file(), quiet=True)
        else:
            say('確認の刻印を書けませんでした（次の起動でもう一度確かめます）', bad=True)
    return True, ''
