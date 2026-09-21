# 起動ステップの可視化(§9.47)の検証: 起動中にboot_status.jsが実ステップを
# 順に書き出し、起動完了で消えること。
import json, re, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # tests/ の1つ上がリポジトリルート
sys.path.insert(0, str(ROOT))
import apppath  # noqa: F401 `program/` を探索先へ（§9.406）
import _pycache_bootstrap  # noqa: E402,F401  (置き場をアプリ外へ。他より先に)
from backend import boot_status as _bs  # noqa: E402
# 進捗ファイルは**端末ごとの置き場**へ移した(§9.225)。パスを書き写さず、
# 製品側が答える1箇所(`status_path()`)を通す——書き写すと、置き場を変えた
# ときに「消したつもりのファイルが残っている」を見て通ってしまう。
STATUS = _bs.status_path()
R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + detail if detail else ''))


def read_status():
    try:
        txt = STATUS.read_text(encoding='utf-8')
    except OSError:
        return None
    m = re.search(r'wavelogBootStatus\((\{.*\})\);', txt)
    return json.loads(m.group(1)) if m else None


# --- 停止してから起動し直し、進捗ファイルの推移を細かく拾う ---
subprocess.run([sys.executable, 'program/process_manager.py', 'stop'], cwd=ROOT,
               capture_output=True, timeout=60)
time.sleep(1.0)
if STATUS.exists():
    STATUS.unlink()

log = open(Path(__file__).resolve().parent / 'boot_probe.log', 'w')   # tests/配下へ(.gitignore済み)
proc = subprocess.Popen([sys.executable, '-u', 'program/start_app.py'], cwd=ROOT, stdout=log, stderr=log)

seen = []          # (index, label, elapsed)
t0 = time.time()
ready_at = None
while time.time() - t0 < 60:
    s = read_status()
    if s and (not seen or seen[-1][0] != s['index']):
        seen.append((s['index'], s['label'], s['elapsed']))
    if ready_at is None:
        try:
            with urllib.request.urlopen('http://127.0.0.1:5029/api/ready.js?cb=x', timeout=0.4) as r:
                if r.status == 200:
                    ready_at = time.time() - t0
        except Exception:
            pass
    if ready_at is not None and time.time() - t0 > ready_at + 1.5:
        break
    time.sleep(0.02)

print('  観測したステップ:')
for i, label, el in seen:
    print('    %.2fs [%d] %s' % (el, i, label))
print('  サーバー応答まで %.2fs' % (ready_at if ready_at else -1))
cleared_by_server = not STATUS.exists()

rec('起動処理が進捗ファイル(boot_status.js)を書き出す', len(seen) > 0, '%d段階' % len(seen))
# サンドボックスは共有もAccessも無く起動が0.3秒で終わるため、20ms間隔で
# ポーリングしても最初の数段階は上書きされて観測できない。段階が全部
# 埋まっていることは「start_app.pyが全キーをreportしているか」で確かめる
# (実機では共有の応答待ちで各段階に実時間がかかり、そこが見えることに意味がある)。
sys.path.insert(0, str(ROOT))
boot_status = _bs

src = (ROOT / 'program' / 'start_app.py').read_text(encoding='utf-8')
missing = [k for k, _ in boot_status.STEPS if ("boot_status.report('%s'" % k) not in src]
rec('定義された全段階(6つ)が起動処理から実際に報告される',
    not missing, '未報告=' + (','.join(missing) or 'なし'))
rec('時間ベースの3段階より細かい段階を持つ',
    len(boot_status.STEPS) >= 6, '%d段階' % len(boot_status.STEPS))

# 書き出しの中身が待機画面から読める形か(1段階ずつ実際に書いて確かめる)。
# 分母は**ブラウザ側の4段階を含めた合計**(§9.76)。待機画面はサーバーの
# 6段階ぶんだけ進めて、残りをアプリ内の起動オーバーレイへ引き渡す。
ok_payload = True
for key, label in boot_status.STEPS:
    boot_status.report(key, 'テスト')
    s = read_status()
    if not s or s['step'] != key or s['label'] != label or s['total'] != boot_status.TOTAL_STEPS:
        ok_payload = False
        break
rec('各段階が「何番目/全何段階/作業名」を伴って書き出される', ok_payload)
# バージョンは進捗ファイルの最初の1件から分かる(サーバーの応答を待たない)。
boot_status.report('env', 'テスト')
s = read_status()
rec('進捗ファイルにバージョン番号が入っている',
    bool(s) and s.get('version') == boot_status.APP_VERSION, (s or {}).get('version', '-'))
boot_status.clear()

rec('ステップ番号が後戻りせず単調に進む',
    all(seen[i][0] < seen[i + 1][0] for i in range(len(seen) - 1)),
    ','.join(str(i) for i, _, _ in seen))
rec('各ステップに日本語の作業名が付いている',
    all(label for _, label, _ in seen), '/'.join(label for _, label, _ in seen))
rec('最後のステップは「Webサーバーを起動」',
    bool(seen) and seen[-1][1] == 'Webサーバーを起動', seen[-1][1] if seen else '-')
rec('サーバーが応答する', ready_at is not None, '%.2fs' % (ready_at or -1))
rec('起動完了後は進捗ファイルを残さない(次回起動で古い表示が出ない)',
    cleared_by_server, 'cleared=%s' % cleared_by_server)

# --- 起動時に必ず開くページが実際に描画できるか(loading.html) ---
html = (ROOT / 'program' / 'loading.html').read_text(encoding='utf-8')
rec('loading.htmlが進捗ファイルを読み込むコールバックを持つ',
    'window.wavelogBootStatus' in html and 'boot_status.js' in html)
rec('時間だけで段階を決める旧ロジック(stageFor)は残っていない', 'stageFor' not in html)

# --- 待機画面とアプリ内オーバーレイの「地」が同じ色か(§9.411／§9.413 追補) ---
# 規則は「起動画面は待機画面と #appBoot が**同じ意匠・同じ色**」だが、
# これまで機械で見張っていたのは**段のリストだけ**だった。色は人が見比べる
# しかなく、実際§9.411では手で13項目を突き合わせて確かめている。
# 地は2箇所に別々に書いてある（loading.html は file:// から開くので外部CSSを
# 読めず、トークンを写してある）ので、**片方だけ直すと黙ってずれる**。
# ここで固定するのは2つ:
#   ① 写してあるトークンの値が本体(00-base.css)と1文字も違わないこと
#   ② 地の指定そのもの(background)が2箇所で同じ文字列であること
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


base_tok, wait_tok = _tokens(BASE_CSS), _tokens(html)
bad = sorted(k for k, v in wait_tok.items() if k in base_tok and base_tok[k] != v)
rec('待機画面へ写したトークンが本体(00-base.css)と一致する(新しい色を足さない)',
    not bad and len(wait_tok) > 5,
    ', '.join('%s %s≠%s' % (k, wait_tok[k], base_tok[k]) for k in bad[:4]) or '%d色' % len(wait_tok))
ground_app = _decl(BOOT_CSS, '#appBoot', 'background')
ground_wait = _decl(html, ' body', 'background')
rec('待機画面とアプリ内オーバーレイの地が同じ指定になっている',
    bool(ground_app) and ground_app == ground_wait,
    ('同じ: ' + ground_app[:60]) if ground_app == ground_wait
    else 'overlay=%s / wait=%s' % (ground_app[:70], ground_wait[:70]))

# --- 段階の一覧が3箇所(Python / 待機画面 / アプリ内オーバーレイ)で一致する ---
# ここがずれると、進捗バーの分母と段階リストが食い違って「90%のまま
# 終わる」「一覧に無い段階が現在になる」といった表示になる(§9.76)。
ALL_LABELS = [label for _, label in boot_status.STEPS] + \
             [label for _, label in boot_status.BROWSER_STEPS]

def li_labels(src, pattern):
    return re.findall(pattern, src)

STEP_LI = r'<li[^>]*data-step="\d+"[^>]*><span>([^<]+)</span></li>'
wait_labels = li_labels(html, STEP_LI)
rec('待機画面の段階リストがboot_status.pyと一致する',
    wait_labels == ALL_LABELS, '待機画面=%s' % '/'.join(wait_labels))
rec('待機画面の分母が合計段階数と一致する',
    ('TOTAL_STEPS=%d' % boot_status.TOTAL_STEPS) in html.replace(' ', '') and
    ('SERVER_STEPS=%d' % len(boot_status.STEPS)) in html.replace(' ', ''))

# --- 更新を当てているかが待機画面で読み分けられる(§9.411、利用者の指示③) ---
# 「アップデートなども実施してくれると思うので、実施しているときとして
#   いないときの違いも分かるように」
# **判定はサーバー側の1箇所**（`start_app`が刻印を見て決める）。ここで固定するのは
# 「3つの状態が在ること」「起動処理がその両方を渡していること」「待機画面が
# 同じ場所で言い分けること」の3つ。
rec('進捗に「更新の作業」の3状態がある(無印/飛ばした/やっている)',
    boot_status.WORK_NONE == '' and boot_status.WORK_SKIP == 'skip'
    and boot_status.WORK_UPDATE == 'update')
_probe = {}
boot_status.set_work(boot_status.WORK_UPDATE, ['アプリの版（1.0.0 → 1.0.1）'])
boot_status.report('packages', '確かめています')
_probe = read_status() or {}
rec('進捗ファイルが「更新中」と理由を運ぶ',
    _probe.get('work') == 'update' and _probe.get('reasons') == ['アプリの版（1.0.0 → 1.0.1）'],
    json.dumps({k: _probe.get(k) for k in ('work', 'reasons')}, ensure_ascii=False))
boot_status.set_work(boot_status.WORK_NONE, [])
boot_status.clear()
start_app_src = (ROOT / 'program' / 'start_app.py').read_text(encoding='utf-8')
rec('起動処理が「更新あり」「更新なし」の両方を渡している',
    'WORK_UPDATE' in start_app_src and 'WORK_SKIP' in start_app_src)
rec('刻印の食い違い（理由）を待機画面へ渡している',
    'reasons=why' in start_app_src)
rec('待機画面が更新の状態を同じ場所で言い分ける',
    'showWork' in html and "work==='update'" in html.replace(' ', '')
    and 'id="work"' in html)
rec('更新の状態は色だけでなく字でも出す(分類名を書く)',
    '更新を反映中' in html and '更新なし' in html)
# **「更新」と「確認」を言い分ける**（§9.415）。アプリの版が上がっていない
# のに「更新を反映中」と出すと、画面が事実と食い違う——初めての起動・
# Pythonの入れ替え・部品の一覧の変更でも同じ段（30〜60秒）を通る。
rec('版が上がっていないときの題を別に持つ（更新と確認を言い分ける）',
    '起動前の確認中' in html and "work==='setup'" in html.replace(' ', ''))
rec('起動処理が「確認だけ」の状態も渡している（WORK_SETUP）',
    'WORK_SETUP' in start_app_src and 'WORK_SETUP' in
    (ROOT / 'backend' / 'boot_status.py').read_text(encoding='utf-8'))
# **理由は「変わったもの: 〇〇」の断片ではなく1文**（§9.415）。以前は
# 「変わったもの: まだ確認していません」のように文にならない並びが出ていた。
rec('理由に見出しの頭を継ぎ足さず、1文をそのまま出す',
    "変わったもの: '+" not in html and "reasons.join(' / ')" in html)

index = (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')
over_labels = li_labels(index, STEP_LI)
rec('アプリ内の起動オーバーレイの段階リストがboot_status.pyと一致する',
    over_labels == ALL_LABELS, 'オーバーレイ=%s' % '/'.join(over_labels))
# ブラウザ側の4段階だけがJSから進む(data-boot-step)。
marked = re.findall(r'data-boot-step="([\w-]+)"', index)
rec('ブラウザ側の段階だけにJSの進行印が付いている',
    marked == [k for k, _ in boot_status.BROWSER_STEPS], '/'.join(marked))
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

log.close()
ng = [n for n, ok in R if not ok]
print('\n== %d/%d PASS ==' % (len(R) - len(ng), len(R)))
sys.exit(1 if ng else 0)
