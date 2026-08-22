"""ready.py: 「この端末では起動前の確認が済んでいる」という刻印(§9.225)。

============================================================
なぜ要るか
------------------------------------------------------------
起動のたびにやっていた確認のうち、**環境が変わらない限り答えが変わらない
もの**がある——Pythonの有無・版、flaskの有無、バイトコードの事前コンパイル、
旧配置DBの取り込み。実測では、バイトコードが無い状態のapp読み込みが
1,168ms、有る状態が211ms(5.5倍)、flaskの有無を調べるだけで83msだった。

そこで確認は`setup_app.py`(setup.bat)が受け持ち、済んだらこの刻印を書く。
毎日の起動は刻印を見て、合っていれば確認を飛ばす。

**刻印は「速くするための門」であって「正しさの門」ではない。**
バイトコードが古いかどうかはPython自身が.pycの中の元ファイルの更新時刻と
大きさで判定する(こちらが刻印を見誤っても、古いバイトコードが使われる
ことはない)。だから刻印が食い違ったときは**止めずに今までどおりの完全な
確認へ落ちる**(利用者の指示①)。止めると、現場では「起動しなくなった」と
しか見えない。

**刻印は端末ごと**(`runtime_dir()`＝`%LOCALAPPDATA%\\WaveLog\\runtime`)。
アプリ本体は共有フォルダーへ置く運用があるので、共有側へ書くと**1台で
確認した結果を全台が信じる**ことになる——Pythonの場所も版も端末ごとに違う。

**材料は「軽いものだけ」**にする。全44ファイルの更新時刻を見に行くと、
共有越しでは確認そのものが起動より重くなる。アプリの版は意味のある変更の
たびに上がる約束(CLAUDE.md)なので、版と`requirements.txt`の2つで足りる。
============================================================
"""
from pathlib import Path
import json
import sys

from ..paths import APP_ROOT, local_root, runtime_dir

# 刻印そのものの形。**作りを変えたら上げること**——上げないと、古い形の
# 刻印を新しい判定が「合っている」と読んでしまう。
STAMP_VERSION = 3


def stamp_file():
    return runtime_dir() / 'ready.json'


def _requirements_mark():
    """`requirements.txt`の指紋。**中身は読まない**(共有越しの読みを増やさない)。
    無ければ空文字＝「無い」という状態として記録する。"""
    path = APP_ROOT / 'requirements.txt'
    try:
        st = path.stat()
        return f'{st.st_size}:{int(st.st_mtime)}'
    except OSError:
        return ''


def current():
    """いまの環境の指紋。**共有へ触るのはここだけ**(requirements.txtのstat 1回と、
    `changelog_data`の読み込み1回)。"""
    from ..changelog_data import APP_VERSION
    return {
        'stampVersion': STAMP_VERSION,
        'appVersion': APP_VERSION,
        'requirements': _requirements_mark(),
        'python': sys.executable or '',
        'pythonVersion': '.'.join(str(x) for x in sys.version_info[:3]),
        'appRoot': str(APP_ROOT),
        'localRoot': str(local_root()),
    }


def read():
    """前回の刻印。読めなければ None(＝確認していないものとして扱う)。"""
    try:
        data = json.loads(stamp_file().read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write(extra=None):
    """確認が通ったことを刻む。**書けなくても起動は止めない**——次回また
    確認するだけで、動かなくなるわけではない。"""
    payload = current()
    if extra:
        payload.update(extra)
    try:
        stamp_file().write_text(json.dumps(payload, ensure_ascii=False, indent=1),
                                encoding='utf-8')
        return True
    except Exception:
        return False


def clear():
    try:
        stamp_file().unlink(missing_ok=True)
    except Exception:
        pass


def mismatch():
    """刻印と今の環境の食い違い。**合っていれば空**。合っていないときは
    「何が違うのか」を名前で返す——理由の分からない再確認は、遅いだけで
    利用者が打つ手を持てない(§CLAUDE 4)。"""
    saved = read()
    if saved is None:
        return ['まだ確認していません']
    now = current()
    labels = {
        'stampVersion': '確認の仕組みの版',
        'appVersion': 'アプリの版',
        'requirements': '必要な部品の一覧(requirements.txt)',
        'python': 'Pythonの場所',
        'pythonVersion': 'Pythonの版',
        'appRoot': 'アプリの置き場所',
        'localRoot': '利用者ごとの置き場所',
    }
    out = []
    for key, label in labels.items():
        if str(saved.get(key, '')) != str(now.get(key, '')):
            out.append(f'{label}（{saved.get(key, "-")} → {now.get(key, "-")}）')
    return out


def ok():
    return not mismatch()
