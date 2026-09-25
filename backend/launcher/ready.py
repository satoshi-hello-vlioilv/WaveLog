"""ready.py: 「この端末では起動前の確認が済んでいる」という刻印(§9.225)。

============================================================
なぜ要るか
------------------------------------------------------------
起動のたびにやっていた確認のうち、**環境が変わらない限り答えが変わらない
もの**がある——Pythonの有無・版、flaskの有無、バイトコードの事前コンパイル、
旧配置DBの取り込み。実測では、バイトコードが無い状態のapp読み込みが
1,168ms、有る状態が211ms(5.5倍)、flaskの有無を調べるだけで83msだった。

そこで確認は`setup_app.py`(update.bat)が受け持ち、済んだらこの刻印を書く。
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
import json
import sys

from ..paths import APP_ROOT, PROGRAM_DIR, local_root, runtime_dir
from ..quiet import quiet

# 刻印そのものの形。**作りを変えたら上げること**——上げないと、古い形の
# 刻印を新しい判定が「合っている」と読んでしまう。
# 4: Pythonの指紋を`python.exe`へそろえた（§9.415）。
STAMP_VERSION = 4


def stamp_file():
    return runtime_dir() / 'ready.json'


def _requirements_mark():
    """`requirements.txt`の指紋。**中身は読まない**(共有越しの読みを増やさない)。
    無ければ空文字＝「無い」という状態として記録する。"""
    path = PROGRAM_DIR / 'requirements.txt'
    try:
        st = path.stat()
        return f'{st.st_size}:{int(st.st_mtime)}'
    except OSError:
        return ''


def python_mark(exe=None):
    """Pythonの指紋。**`pythonw.exe`と`python.exe`を同じものとして数える**（§9.415）。

    `update.bat`はコンソールの`python.exe`で、`Start.vbs`は黒い画面を出さない
    `pythonw.exe`で、**同じPythonの同じ環境**を起動する。実行ファイル名をその
    まま控えると**この2つは永久に食い違う**ので、update.bat を実行した次の
    起動が必ず完全な確認（30〜60秒）へ落ち、待機画面に
    「変わったもの: Pythonの場所（…\\python.exe → …\\pythonw.exe）」が出ていた
    ——**update.bat の「次回からの起動が速くなります」が一度も守られていない**。

    2つは同じフォルダーに並び、同じ`sys.prefix`・同じ`site-packages`・同じ
    バイトコードを見る。**刻印が門にしているもの（部品の有無とバイトコード）に
    差は出ない**ので、末尾の`w`だけを落としてそろえる。綴りの違いで別物に
    しないよう、`python`で始まる名前のときだけ落とす。

    綴りを切るのは**文字列のまま**やる。`pathlib`はいま動いているOSの綴りで
    読むので、Linuxで回す網が`C:\\…\\pythonw.exe`を「1つの名前」と読んで
    末尾の`w`を落とせない——**本番だけ効いて網では確かめられない**作りになる。
    """
    raw = sys.executable if exe is None else exe
    raw = raw or ''
    if not raw:
        return ''
    cut = max(raw.rfind('\\'), raw.rfind('/'))
    head, name = raw[:cut + 1], raw[cut + 1:]
    stem, dot, ext = name.rpartition('.')
    if not dot:
        stem, ext = name, ''
    low = stem.lower()
    if low.startswith('python') and low.endswith('w'):
        stem = stem[:-1]
    return head + stem + (dot + ext if dot else '')


def current():
    """いまの環境の指紋。**共有へ触るのはここだけ**(requirements.txtのstat 1回と、
    `changelog_data`の読み込み1回)。"""
    from ..changelog_data import APP_VERSION
    return {
        'stampVersion': STAMP_VERSION,
        'appVersion': APP_VERSION,
        'requirements': _requirements_mark(),
        'python': python_mark(),
        'pythonVersion': '.'.join(str(x) for x in sys.version_info[:3]),
        'appRoot': str(APP_ROOT),
        'localRoot': str(local_root()),
    }


def read():
    """前回の刻印。読めなければ None(＝確認していないものとして扱う)。"""
    try:
        data = json.loads(stamp_file().read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else None
    except Exception as _e:
        quiet('保存された値を読めない（既定で続ける）',_e)
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
    except Exception as _e:
        quiet('刻印を書けない（次の起動でもう一度確認する）',_e)
        return False


def clear():
    try:
        stamp_file().unlink(missing_ok=True)
    except Exception as _e:
        quiet('いらないファイルを消せない（次の掃除で片付く）',_e)


def _short(value):
    """長い置き場を**読める長さ**にする（§9.415）。待機画面の1行に絶対パスを
    2本並べると、**どこが違うのかが読み取れない**（実測: 2本で124文字）。末尾の
    2つだけ残して先頭を「…」にする——変わったことが分かればよく、完全な綴りは
    ログ（`log_environment`）と「起動前確認の刻印」（ログの画面）が持っている。

    **区切りは元の綴りのまま**返す（`\\`を`/`に直さない）。直すと、画面に出る
    道とログに出る道が別物に見える。"""
    text = str(value)
    if len(text) <= 30:
        return text
    sep = '\\' if text.rfind('\\') > text.rfind('/') else '/'
    parts = text.split(sep)
    if len(parts) <= 2:
        return text
    return '…' + sep + sep.join(parts[-2:])


# 食い違いの言い方。**「変わったもの: 〇〇」の断片ではなく、それだけで読める
# 1文**にする（§9.415）——以前は「変わったもの: まだ確認していません」のように
# 文として成り立たない並びが出ていた。`None` は値を添えない（置き場が変わった
# ことは言えるが、2本の絶対パスを並べても読めない）。
# 比べる前に**そろえる**もの。`current()`と同じ関数を通す（1箇所で持つ）。
_NORMALIZE = {'python': python_mark}

_REASONS = [
    ('appVersion', 'アプリの版が上がりました', '{a} → {b}'),
    ('requirements', '必要な部品の一覧（requirements.txt）が変わりました', None),
    ('pythonVersion', 'Pythonの版が変わりました', '{a} → {b}'),
    ('python', 'Pythonの場所が変わりました', '{a} → {b}'),
    ('appRoot', 'アプリの置き場所が変わりました', '{a} → {b}'),
    ('localRoot', '利用者ごとの置き場所が変わりました', '{a} → {b}'),
]


def diff():
    """刻印と今の環境の食い違いを **[(鍵, 1文)]** で返す。**合っていれば空**。

    鍵つきで返すのは、待機画面の題を「更新を反映中」と「起動前の確認中」で
    言い分けるため（§9.415）——**アプリの版が上がっていないのに「更新」と
    言わない**。字だけ返して呼ぶ側に綴りを探させると、2箇所で同じ言葉を
    持つことになる（§CLAUDE 8）。

    **答えは1回で出す。** `mismatch()`と別々に数えると、`current()`が持つ
    共有フォルダーへのstatが2回になる（この仕組みは、その1回を惜しんで
    作ってある）。"""
    saved = read()
    if saved is None:
        return [('none', 'この端末では初めての起動です')]
    now = current()
    # **形が変わったときは、それだけを言う。** 古い形の刻印と新しい指紋を
    # 1つずつ比べても「全部変わりました」としか出ず、読む側の手掛かりにならない。
    if str(saved.get('stampVersion', '')) != str(now.get('stampVersion', '')):
        return [('stampVersion', '起動前の確認の仕組みが新しくなりました')]
    out = []
    for key, text, shape in _REASONS:
        a, b = str(saved.get(key, '')), str(now.get(key, ''))
        # **控えてある値もそろえてから比べる**（§9.415）。指紋のそろえ方を
        # `current()`側だけに書くと、**前の版が書いた刻印**（`pythonw.exe`の
        # ままの値）が永久に食い違ったままになる。読む側でも同じ1本を通す。
        if key in _NORMALIZE:
            a = _NORMALIZE[key](a)
        if a == b:
            continue
        if shape:
            out.append((key, f'{text}（{shape.format(a=_short(a) or "-", b=_short(b) or "-")}）'))
        else:
            out.append((key, text))
    return out


def version_note(prev=None):
    """update.bat に出す版の1行（§9.497）。`prev`は前回の刻印（無ければ初めて）。
    **前回の確認と比べる**——前回の確認は update.bat か、刻印が食い違ったときの起動が書く。"""
    cur = current().get('appVersion') or '?'
    old = (prev or {}).get('appVersion') if isinstance(prev, dict) else None
    if not old:
        return 'VER%s（この端末で初めての確認です）' % cur
    if str(old) == str(cur):
        return 'VER%s（前回の確認と同じ版です）' % cur
    return 'VER%s（前回の確認は %s → 今回 更新しました）' % (cur, old)


def mismatch():
    """食い違いの理由（1文ずつ）。**合っていれば空**——理由の分からない
    再確認は、遅いだけで利用者が打つ手を持てない(§CLAUDE 4・6)。"""
    return [text for _key, text in diff()]


def ok():
    return not mismatch()
