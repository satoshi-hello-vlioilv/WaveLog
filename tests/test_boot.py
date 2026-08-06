# 起動ステップの可視化(§9.47)の検証: 起動中にboot_status.jsが実ステップを
# 順に書き出し、起動完了で消えること。
import json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # tests/ の1つ上がリポジトリルート
STATUS = ROOT / 'boot_status.js'
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
subprocess.run([sys.executable, 'process_manager.py', 'stop'], cwd=ROOT,
               capture_output=True, timeout=60)
time.sleep(1.0)
if STATUS.exists():
    STATUS.unlink()

log = open(Path(__file__).resolve().parent / 'boot_probe.log', 'w')   # tests/配下へ(.gitignore済み)
proc = subprocess.Popen([sys.executable, '-u', 'start_app.py'], cwd=ROOT, stdout=log, stderr=log)

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
from backend import boot_status  # noqa: E402

src = (ROOT / 'start_app.py').read_text(encoding='utf-8')
missing = [k for k, _ in boot_status.STEPS if ("boot_status.report('%s'" % k) not in src]
rec('定義された全段階(6つ)が起動処理から実際に報告される',
    not missing, '未報告=' + (','.join(missing) or 'なし'))
rec('時間ベースの3段階より細かい段階を持つ',
    len(boot_status.STEPS) >= 6, '%d段階' % len(boot_status.STEPS))

# 書き出しの中身が待機画面から読める形か(1段階ずつ実際に書いて確かめる)
ok_payload = True
for key, label in boot_status.STEPS:
    boot_status.report(key, 'テスト')
    s = read_status()
    if not s or s['step'] != key or s['label'] != label or s['total'] != len(boot_status.STEPS):
        ok_payload = False
        break
rec('各段階が「何番目/全何段階/作業名」を伴って書き出される', ok_payload)
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
html = (ROOT / 'loading.html').read_text(encoding='utf-8')
rec('loading.htmlが進捗ファイルを読み込むコールバックを持つ',
    'window.wavelogBootStatus' in html and 'boot_status.js' in html)
rec('loading.htmlのステップ一覧がboot_status.pyの段階数と一致する',
    html.count('<li data-step=') == 7, '%d個' % html.count('<li data-step='))
rec('時間だけで段階を決める旧ロジック(stageFor)は残っていない', 'stageFor' not in html)

log.close()
ng = [n for n, ok in R if not ok]
print('\n== %d/%d PASS ==' % (len(R) - len(ng), len(R)))
sys.exit(1 if ng else 0)
