"""setup_check.py: 起動前の確認と下ごしらえ(§9.225)。

`setup.bat`(導入時・更新後に1回)と、刻印が食い違ったときの`start_app.py`の
自動フォールバックが**同じここ**を通る。2つ持つと「setup.batでは通るのに
起動では失敗する」が作れる——起動経路を1本に揃える`start_app.py`の設計
(冒頭の説明)と同じ理由。

ここでやること(どれも「環境が変わらない限り答えが変わらない」もの):
  1. ローカル領域のフォルダを作る
  2. 必要な部品(flask)が揃っているか確認し、無ければ導入する
  3. **バイトコードを事前にコンパイルする**(いちばん効く。実測5.5倍)
  4. 旧配置のDBファイルを取り込む
  5. 起動待機画面(loading.html)を手元へ写す
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
from ..paths import APP_ROOT, browser_dir, ensure_local_dirs
from . import ready

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
COMPILE_FILES = ('app.py', 'start_app.py', 'process_manager.py', '_pycache_bootstrap.py')


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
        say('必要な部品: 揃っています (%s)' % ', '.join(REQUIRED_PACKAGES))
        return True
    say('必要な部品: %s が不足しています。導入を試みます' % ', '.join(missing))
    try:
        result = subprocess.run(
            [sys.executable, '-m', 'pip', 'install', '-r', str(APP_ROOT / 'requirements.txt')],
            capture_output=True, text=True, **_no_window())
    except Exception as e:
        say('必要な部品: 導入を実行できませんでした: %s' % e, bad=True)
        return False
    if result.returncode != 0:
        say('必要な部品: 導入に失敗しました\n%s' % (result.stderr or '').strip()[:2000], bad=True)
        return False
    say('必要な部品: 導入しました')
    return True


def precompile(say):
    """バイトコードを先に作っておく。**失敗しても起動は止めない**——
    その場でコンパイルされるだけで、遅くなるだけだから。"""
    if sys.pycache_prefix is None:
        # `_pycache_bootstrap`を通さずに呼ばれた場合。元ファイルの隣へ書くと
        # 共有を汚すので、**何もしない**方を選ぶ(黙って場所を変えない)。
        say('バイトコード: 置き場が決まっていないので飛ばします', bad=True)
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
        say('バイトコード: 事前に用意しました（置き場: %s）' % sys.pycache_prefix)
    else:
        say('バイトコード: 一部を用意できませんでした（その場でコンパイルされます）', bad=True)
    return ok


def adopt_legacy_databases(say):
    (APP_ROOT / 'db').mkdir(exist_ok=True)
    for old_name, new_name in LEGACY_DB:
        old = APP_ROOT / old_name
        new = APP_ROOT / new_name
        if old.exists() and not new.exists():
            try:
                old.rename(new)
                say('旧DBを取り込みました: %s -> %s' % (old_name, new_name))
            except Exception as e:
                say('旧DBを取り込めませんでした(%s): %s' % (old_name, e), bad=True)


def waiting_page():
    """起動待機画面の**手元の写し**。共有配置では、進捗ファイル
    (`boot_status.js`)を共有へ書くと**全台が同じ1つを取り合う**——他の端末の
    進捗が自分の画面に出る。写しの隣へ書けば端末ごとに分かれる。
    `loading.html`は`<script src="boot_status.js">`と**相対で**読むので、
    写しを開くだけで置き場が切り替わる(画面側の変更は要らない)。

    置き場は`paths.browser_dir()`が答える（§9.318）——**ブラウザが読む**
    ファイルなので、`%LOCALAPPDATA%`への書き込みがこのアプリからしか
    見えない写しへ回される端末では、見える場所へ移る。健全な端末では
    `runtime_dir()`のままで、今までと1バイトも変わらない。"""
    return browser_dir() / 'loading.html'


def staged_waiting_page():
    """次の起動で使う写しの**置き場**（§9.314）。

    **ブラウザへ渡したファイルを、その起動のあいだ差し替えないため**にある。
    以前は`copy_waiting_page()`が`waiting_page()`（＝いま開いたばかりの
    ファイル）をそのまま置き換えており、本体が遅い端末では**ブラウザが
    立ち上がっている最中**にその差し替えが起きていた（実測: 渡した1ms後では
    なく1.2秒後）。手元にアプリを置いている端末では読み出しが一瞬で終わるので
    差し替えはブラウザが起動する前に済み、**開発機では一度も再現しない**。
    §9.108/§9.270の「自分が読んでいるファイルは名前を差し替えない」と同じ話。"""
    return browser_dir() / 'loading.next.html'


def copy_waiting_page(say=None):
    """本体の`loading.html`を手元へ写す。**意匠の出どころはあれ1つ**（§9.225）。

    **写す先は「次の起動用」**（`staged_waiting_page()`・§9.314）——いま
    ブラウザが開いているファイルには触らない。実際に使う名前へ移すのは
    `promote_waiting_page()`で、**起動のいちばん最初**（まだ誰も開いて
    いない時点）に1回だけ行う。

    **中身が同じなら何もしない**——毎回書いて毎回置き換えると、差し替えの
    機会だけが増える（開発機では写しが常に最新なので、ここで止まる）。

    **置き換えは一時ファイル→`atomic_io.replace()`**（§9.255 ③）。素の
    `write_bytes`だと**読んでいる途中の半分だけの画面**を見せうるし、
    Windowsでは掴まれている置き換えが`WinError 5`になる（§9.108）。"""
    from .. import atomic_io
    src = APP_ROOT / 'loading.html'
    dst = staged_waiting_page()
    tmp = dst.with_suffix(dst.suffix + '.tmp')
    try:
        data = src.read_bytes()
        try:
            if waiting_page().read_bytes() == data:
                # 既に最新。**差し替えを1回減らす**のがここの値打ち。
                try:
                    dst.unlink()
                except Exception:
                    pass
                if say:
                    say('起動待機画面の写しは最新です: %s' % waiting_page())
                return waiting_page()
        except Exception:
            pass                      # 読めない＝写しが無い/壊れている。写す。
        tmp.write_bytes(data)
        atomic_io.replace(tmp, dst, label='loading.next.html')
        if say:
            say('起動待機画面を手元へ写しました（次の起動から使います）: %s' % dst)
        return dst
    except Exception as e:
        try:
            tmp.unlink()
        except Exception:
            pass
        if say:
            say('起動待機画面を写せませんでした（いまの写しのまま開きます）: %s' % e, bad=True)
        return None


def promote_waiting_page(say=None):
    """次の起動用の写しを、実際に使う名前へ移す（§9.314）。

    **呼ぶのは起動のいちばん最初、待機画面を開くより前**——その時点なら
    このファイルを開いている者はいないので、差し替えがブラウザとぶつからない。
    **失敗しても何も起きない**（前の写しのまま開ける。次の起動でまた試す）。"""
    from .. import atomic_io
    src = staged_waiting_page()
    dst = waiting_page()
    try:
        if not src.exists():
            return None
    except Exception:
        return None
    try:
        atomic_io.replace(src, dst, label='loading.html(promote)')
        if say:
            say('起動待機画面の写しを新しくしました: %s' % dst)
        return dst
    except Exception as e:
        if say:
            say('起動待機画面の写しを新しくできませんでした（いまの写しで開きます）: %s' % e, bad=True)
        return None


def sweep_shared_leftovers(say=None):
    """以前の版がアプリ本体の隣へ書いていた進捗ファイルを片付ける(§9.225)。

    置き場を端末ごとへ移したので、共有側に残った1個は**誰も読まない**。
    放っておくと共有フォルダーに意味の分からないファイルが残り続け、
    「これは何か」を次に触る人に調べさせることになる。**消せなくても
    黙って進む**——読み取り専用の共有に置いている現場もある。"""
    old = APP_ROOT / 'boot_status.js'
    try:
        if old.exists():
            old.unlink()
            if say:
                say('以前の進捗ファイルを片付けました: %s' % old)
    except Exception:
        pass


def run(say, write_stamp=True):
    """確認一式。戻り値は (通ったか, 失敗の理由)。"""
    ensure_local_dirs()
    if not ensure_packages(say):
        return False, '必要な部品を用意できませんでした'
    precompile(say)
    adopt_legacy_databases(say)
    copy_waiting_page(say)
    sweep_shared_leftovers(say)
    if write_stamp:
        if ready.write():
            say('確認の刻印を書きました: %s' % ready.stamp_file())
        else:
            say('確認の刻印を書けませんでした（次回も確認します）', bad=True)
    return True, ''
