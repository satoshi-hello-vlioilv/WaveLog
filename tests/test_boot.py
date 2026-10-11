# 起動の覆い（`#appBoot`）と、デスクトップ版の起動画面（desktop/splash）の決まり。
#
# §9.548 でブラウザ版の起動の道（start_app.py・待機画面 loading.html・進捗ファイル boot_status.js）を外した。
# 中身の起動の進み具合はデスクトップ版の起動画面が窓口の`progress`の知らせで出すので、ここで固定するのは:
#   ① 起動画面（desktop/splash）の色が本体（00-base.css）と一致し、地が`#appBoot`と同じ指定
#   ② 見せる4段が boot_status.PHASES の1箇所から出て（覆いと窓の起動画面）、base.js の分母も一致
#   ③ 本体を伏せる印と、base.js が読めなかったときの保険
#   ④ 外した物（待機画面・進捗の書き手）が残っていない
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # tests/ の1つ上がリポジトリルート
sys.path.insert(0, str(ROOT))
import apppath  # noqa: F401 `program/` を探索先へ（§9.406）
import _pycache_bootstrap  # noqa: E402,F401  (置き場をアプリ外へ。他より先に)
from backend import boot_status  # noqa: E402
R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + detail if detail else ''))


# --- ④ 外した物が残っていない（§9.548） ---
rec('待機画面（program/loading.html）は置いていない', not (ROOT / 'program' / 'loading.html').exists())
rec('進捗ファイルの書き手（report/clear）は残っていない（段の顔ぶれだけ）',
    not hasattr(boot_status, 'report') and not hasattr(boot_status, 'clear')
    and len(boot_status.STEPS) == 6 and len(boot_status.BROWSER_STEPS) == 4)
core_src = (ROOT / 'backend' / 'routes' / 'core.py').read_text(encoding='utf-8')
rec('待機画面用の /api/ready.js は無い', "'/api/ready.js'" not in core_src)

# --- ① 起動画面とアプリ内の起動の覆いの「地」が同じ色か(§9.411／§9.546) ---
BASE_CSS = (ROOT / 'static' / 'css' / '00-base.css').read_text(encoding='utf-8')
BOOT_CSS = (ROOT / 'static' / 'css' / '95-boot.css').read_text(encoding='utf-8')


def _tokens(src):
    """最初の `:root{...}` から `--名前: 値` を拾う。"""
    m = re.search(r':root\s*\{(.*?)\}', src, re.S)
    if not m:
        return {}
    return {k: v.strip() for k, v in re.findall(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', m.group(1))}


def _decl(src, selector, prop):
    """`selector{...}` の中の `prop: ...;` を空白を潰して返す。"""
    m = re.search(re.escape(selector) + r'\s*\{(.*?)\n\}', src, re.S)
    if not m:
        return ''
    d = re.search(r'(?<![-\w])' + prop + r'\s*:(.*?);', m.group(1), re.S)
    return re.sub(r'\s+', '', d.group(1)) if d else ''


base_tok = _tokens(BASE_CSS)
ground_app = _decl(BOOT_CSS, '#appBoot', 'background')
# デスクトップ版の起動画面（desktop/splash/index.html・§9.544）も**同じ色・同じ地**。
# exe に入るので外部CSSを読めず、トークンと地を写してある。片方だけ直すと黙ってずれる。
SPLASH = (ROOT / 'desktop' / 'splash' / 'index.html').read_text(encoding='utf-8')
splash_tok = _tokens(SPLASH)
bad = sorted(k for k, v in splash_tok.items() if k in base_tok and base_tok[k] != v)
rec('デスクトップ版の起動画面のトークンが本体(00-base.css)と一致する(新しい色を足さない)',
    not bad and len(splash_tok) > 5,
    ', '.join('%s %s≠%s' % (k, splash_tok[k], base_tok.get(k)) for k in bad[:4]) or '%d色' % len(splash_tok))
rec('デスクトップ版の起動画面の地がアプリ内の起動の覆いと同じ指定',
    bool(ground_app) and _decl(SPLASH, ' body', 'background') == ground_app, ground_app[:60])

# --- ⑤ 起動の画面の字は、いまの起動の事実を言う（§9.549、利用者の指示「言い換えてください」） ---
# ブラウザ版の起動の道は§9.548で外した。起動画面と段の名前に「ブラウザ版」「Webサーバー」「desktop を付けて」が
# 残ると、利用者は無い道を探す（実際に「ブラウザ版でも開けます」と案内していた）。窓が出す失敗の理由（locate.rs）も見る。
LOCATE = (ROOT / 'desktop' / 'src' / 'locate.rs').read_text(encoding='utf-8')
_boot_area = re.search(r'id="appBoot".*?id="connectionLost"', (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8'), re.S).group(0)
# 行コメントは1行に限る（re.S の . は改行にも当たり、最初の // からファイルの終わりまで消してしまう）
_strip = lambda t: re.sub(r'<!--.*?-->|/\*.*?\*/|^[ \t]*//[^\n]*', '', t, flags=re.S | re.M)
_said = _strip(SPLASH) + _strip(_boot_area) + ' '.join(re.findall(r'"([^"]*)"', _strip(LOCATE))) \
    + ' '.join(label for _, label in boot_status.STEPS + boot_status.BROWSER_STEPS)
_old = [w for w in ('ブラウザ版', 'Webサーバー', '「desktop」を付け', '「desktop」から') if w in _said]
rec('起動の画面と段の名前は、無くなったブラウザ版・Webサーバー・引数 desktop を言わない（§9.549）', not _old, '・'.join(_old))

# --- ② 見せる段の顔ぶれ（§9.580）が boot_status.PHASES の1箇所から出る ---
# 覆い（index.html）はテンプレートが PHASES を回して描き、進める段の中身（BROWSER_STEPS）は data-boot-keys が名乗る。
# 窓の起動画面（exe に入る・写し）は同じ4段を同じ言葉で持つ。片方だけ直すと、窓から覆いへ切り替わったとき段が入れ替わる。
index = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
rec('アプリ内の起動の覆いは見せる段を boot_status.PHASES から描く',
    '{% for key, label, hint in boot_phases %}' in index and 'data-boot-keys="{{boot_keys}}"' in index
    and 'boot_phases=boot_status.PHASES' in core_src
    and "boot_keys=' '.join(k for k, _ in boot_status.BROWSER_STEPS)" in core_src)
splash_phases = re.findall(r'<li[^>]*id="p-(\w+)"[^>]*>.*?<b>([^<]+)</b><span class="d">([^<]*)</span></li>', SPLASH)
rec('デスクトップ版の起動画面の4段が boot_status.PHASES と同じ（鍵・名前・一言）',
    splash_phases == [tuple(p) for p in boot_status.PHASES], '/'.join(l for _, l, _ in splash_phases))
rec('見せる段に技術の言葉（Python・窓口・ポート）を出さない',
    not any(w in l + h for _, l, h in boot_status.PHASES for w in ('Python', '窓口', 'ポート', 'PATH')))
# 印は2つ付く。`app-booting`が本体を伏せる印、`boot-cold`は「最初の1枚を
# 描くまでレイアウトを省く」印(§9.86)。後者は最初の描画で外れるので、
# ここでは初期状態として両方が付いていることだけを見る。
rec('起動が終わるまで本体を伏せる印がhtmlに付いている',
    re.search(r'<html[^>]*class="[^"]*\bapp-booting\b', index) is not None)
# base.jsが読めなかった場合でも必ず解除される保険。これが無いと、
# 何かの拍子に画面が出ないまま固まる。
rec('base.jsが読めなかった場合の解除(保険)がindex.htmlにある',
    "classList.remove('app-booting')" in index and 'setTimeout' in index)

base_js = (ROOT / 'static' / 'js' / 'core' / 'base.js').read_text(encoding='utf-8')
rec('base.jsの段階数がboot_status.pyと一致する',
    ('BOOT_SERVER_STEPS=%d' % len(boot_status.STEPS)) in base_js.replace(' ', '') and
    ('BOOT_TOTAL_STEPS=%d' % boot_status.TOTAL_STEPS) in base_js.replace(' ', ''))
core = (ROOT / 'backend' / 'routes' / 'core.py').read_text(encoding='utf-8')
rec('起動オーバーレイのCSSが配信一覧に入っている', "'95-boot.css'" in core)

ng = [n for n, ok in R if not ok]
print('\n== %d/%d PASS ==' % (len(R) - len(ng), len(R)))
sys.exit(1 if ng else 0)
