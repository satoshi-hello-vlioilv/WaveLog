"""test_appupdate.py: アプリの更新（§9.555）——共有に版を残し、配る版を決める

利用者の指示「更新の仕組みを作りたいです。…バージョンごとのデータをこの場所に保存し、アップデートを行う
機能を組み込みたいです」（選んだ形: ①手元へ写して動かす ②ZIP を選んで置く ③配る版を指定→起動時に自動）。

**サーバーもブラウザも要らない**（1段目の網）。一時の置き場で確かめる（本物の共有へは書かない・§9.504）。
固定すること:
  1. ZIP から置くのは**`PAYLOAD`の項目だけ**——db・config・tests は入らない（各PCのデータを上書きしない）
  2. 危ない道（`..`）は入れない・アプリの物でない ZIP・欠かせない物の無い ZIP・**同じ版の置き直し**は断る
  3. 目録（manifest.json）の大きさと sha256 は置いた中身と合う（窓がこれで写した物を確かめる）
  4. 配る版は**置いてある版だけ**・前の版を控える（戻すのは選び直すだけ）
  5. 窓（update.rs）と同じ置き場・鍵・版の読み方（2つの実装の字がずれない）
  6. 置く・配るのは開発者・メンテナンス者だけ
"""
import hashlib
import io
import json
import re
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import app_update  # noqa: E402
from backend.repositories.master_repo import ROLES, ROLE_DEVELOPER, ROLE_MAINTAINER, role_can  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def make_zip(version='9.1.0', head='WaveLog-main/', drop=(), extra=None):
    """GitHub の「Download ZIP」と同じ形（頭に`WaveLog-main/`）の小さな ZIP。"""
    files = {
        'backend/changelog_data.py': f"# x\nAPP_VERSION='{version}'\n",
        'backend/a.py': 'print(1)\n',
        'backend/__pycache__/a.cpython-312.pyc': 'junk',
        'static/js/core/base.js': '//\n',
        'templates/index.html': '<html></html>',
        'program/sidecar.py': '#\n',
        'program/WaveLog.exe': 'MZexe',
        'program/WaveLog.build.json': json.dumps({'commit': 'abcdef1234'}),
        'Start.vbs': "' x",
        'README.md': '# r',
        'db/master.sqlite3': 'DATA',
        'config/local.json': '{"x":1}',
        'tests/test_x.py': '#',
        'docs/a.md': '#',
    }
    files.update(extra or {})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        for p, text in files.items():
            if p not in drop:
                z.writestr(head + p, text)
    return buf.getvalue()


base = Path(tempfile.mkdtemp()) / 'share'

# ---- 1) 置くのは PAYLOAD の項目だけ ----
out = app_update.publish_zip(make_zip(extra={'../evil.txt': 'x', 'backend/../../evil2.txt': 'x'}), 'WaveLog-main.zip', 'tester', base)
rec('ZIP から版を置ける（頭の WaveLog-main/ を外す）', out.get('ok') and out.get('version') == '9.1.0', str(out))
vdir = base / 'versions' / '9.1.0'
tops = sorted(p.name for p in vdir.iterdir())
rec('置いたのは PAYLOAD の項目と目録だけ（db・config・tests・docs は入らない）',
    tops == sorted(list(app_update.PAYLOAD) + ['manifest.json']), str(tops))
rec('PAYLOAD に db と config は無い（各PCのデータを上書きしない）',
    'db' not in app_update.PAYLOAD and 'config' not in app_update.PAYLOAD)
rec('__pycache__ は入れない（版ごとに作り直せる物）', not list(vdir.rglob('__pycache__')))
rec('危ない道（..）は置き場の外へ書かない', not (base / 'evil.txt').exists() and not (base.parent / 'evil2.txt').exists()
    and not list(base.rglob('evil*')))

# ---- 2) 断るもの ----
r = app_update.publish_zip(make_zip(), 'again.zip', 'tester', base)
rec('同じ版はもう一度置けない（置いた PC と中身が食い違う）', not r.get('ok') and 'もう置いて' in r.get('error', ''), r.get('error'))
r = app_update.publish_zip(b'not a zip', 'x.zip', 't', base)
rec('ZIP でない物は理由を言って断る', not r.get('ok') and 'ZIP' in r.get('error', ''), r.get('error'))
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as z:
    z.writestr('other/readme.txt', 'x')
r = app_update.publish_zip(buf.getvalue(), 'x.zip', 't', base)
rec('アプリの物でない ZIP は断る', not r.get('ok') and 'changelog_data' in r.get('error', ''), r.get('error'))
r = app_update.publish_zip(make_zip('9.2.0', drop=('program/WaveLog.exe',)), 'x.zip', 't', base)
rec('欠かせない物（exe）が無い ZIP は断る', not r.get('ok') and 'WaveLog.exe' in r.get('error', ''), r.get('error'))
r = app_update.publish_zip(make_zip('../9'), 'x.zip', 't', base)
rec('版の字が道に使えない物は断る', not r.get('ok'), r.get('error'))
rec('断ったあとに書きかけのフォルダを残さない', not [p for p in (base / 'versions').iterdir() if p.name.startswith('.')])

# ---- 3) 目録は中身と合う ----
man = json.loads((vdir / 'manifest.json').read_text(encoding='utf-8'))
bad = [f['path'] for f in man['files']
       if hashlib.sha256((vdir / f['path']).read_bytes()).hexdigest() != f['sha256'] or (vdir / f['path']).stat().st_size != f['size']]
rec('目録の大きさと sha256 が置いた中身と合う', man['files'] and not bad, str(bad[:3]))
rec('目録は入れ替える項目・置いた人・元の ZIP・コミットを持つ',
    man['payload'] == list(app_update.PAYLOAD) and man['placedBy'] == 'tester' and man['source'] == 'WaveLog-main.zip'
    and man['commit'] == 'abcdef1234', str({k: man[k] for k in ('placedBy', 'source', 'commit')}))

# ---- 4) 配る版 ----
rec('配る版を決める前は「決めていない」', app_update.release(base) is None)
r = app_update.set_release('9.9.9', 'tester', base)
rec('置いていない版は配れない', not r.get('ok') and '置き場にありません' in r.get('error', ''), r.get('error'))
r = app_update.set_release('9.1.0', 'tester', base)
rec('置いた版を配る版にできる', r.get('ok') and app_update.release(base)['version'] == '9.1.0', str(r))
app_update.publish_zip(make_zip('9.10.0'), 'b.zip', 'tester', base)
app_update.set_release('9.10.0', 'tester', base)
rel = app_update.release(base)
rec('前に配った版を控える（戻すときの手がかり）', rel['previous'] == '9.1.0', str(rel))
rec('版は数として新しい順（9.10.0 > 9.1.0）', [v['version'] for v in app_update.versions(base)] == ['9.10.0', '9.1.0'])
r = app_update.set_release('9.1.0', 'tester', base)
rec('前の版へ戻すのは選び直すだけ', r.get('ok') and app_update.release(base)['version'] == '9.1.0')

# ---- 5) 窓（update.rs）と同じ字 ----
RS = (ROOT / 'desktop' / 'src' / 'update.rs').read_text(encoding='utf-8')
rs_dir = re.search(r'pub const DEFAULT_DIR: &str = r"([^"]+)";', RS)
rec('既定の置き場は窓と同じ字（利用者の指定した共有）',
    rs_dir and rs_dir.group(1) == app_update.DEFAULT_DIR
    and app_update.DEFAULT_DIR == r'\\nlmsrvngy03\工場内共有\検査データ\Records\アプリメンテナンス\WaveLog',
    rs_dir.group(1) if rs_dir else '窓に無い')
rec('置き場を変える鍵は窓と同じ（config/local.json の update_dir）',
    f'pub const CONFIG_KEY: &str = "{app_update.CONFIG_KEY}";' in RS)
rec('版の読み方は窓と同じ（changelog_data.py の APP_VERSION）',
    app_update.version_in((ROOT / 'backend' / 'changelog_data.py').read_text(encoding='utf-8')) == app_update.APP_VERSION
    and 'strip_prefix("APP_VERSION")' in RS)
rec('窓は目録の項目だけを入れ替え、db・config を項目として受けない',
    'man["payload"]' in RS and 'p == "db" || p == "config"' in RS)
# 届かない置き場では待たせない（窓は3秒・こちらも同じ長さで打ち切る）
r_ok, why = app_update.reachable(Path(tempfile.mkdtemp()) / 'x', wait=1)
rec('届く置き場は届くと言う', r_ok, why)

# ---- 6) 権限 ----
can = {r: role_can(r, 'app:release') for r in ROLES}
rec('置く・配るのは開発者・メンテナンス者だけ',
    can[ROLE_DEVELOPER] and can[ROLE_MAINTAINER] and sum(can.values()) == 2, str(can))

ok = sum(1 for _, x in R if x)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
