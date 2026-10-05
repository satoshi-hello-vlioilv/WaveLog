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
  8. 置き場を変える（§9.557）: この PC の local.json → 共有の設定（パス設定マスタ）→ 既定 の順。
     共有の設定は窓の読む控え（config/update.json）へ**変わったときだけ**写す。窓も同じ順・同じ控えの名を読む
  7. 置いている間の進み具合（§9.556）: 確かめる→写す n/N（量）→仕上げ を順に言う・同時に2本は置かない・
     途中で終わった書きかけは**1時間より古い物だけ**片付ける（別の PC がいま置いている物を消さない）
"""
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import app_update, paths  # noqa: E402
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
    and app_update.DEFAULT_DIR == r'\\nlmsrvngy03\工場内共有\検査データ\Apps\WaveLog',
    rs_dir.group(1) if rs_dir else '窓に無い')
rec('置き場を変える鍵は窓と同じ（config/local.json の update_dir）',
    f'pub const CONFIG_KEY: &str = "{app_update.CONFIG_KEY}";' in RS)
rec('版の読み方は窓と同じ（changelog_data.py の APP_VERSION）',
    app_update.version_in((ROOT / 'backend' / 'changelog_data.py').read_text(encoding='utf-8')) == app_update.APP_VERSION
    and 'strip_prefix("APP_VERSION")' in RS)
rec('窓は目録の項目だけを入れ替え、db・config を項目として受けない',
    'man["payload"]' in RS and 'p == "db" || p == "config"' in RS)
# 届かない置き場では待たせない（窓は3秒・こちらも同じ長さで打ち切る）
probe = Path(tempfile.mkdtemp()) / 'x'
r_ok, why = app_update.reachable(probe, wait=1)
rec('届く置き場は届くと言う（まだ無くても親に届けば届く）', r_ok, why)
rec('届くかを見るだけで置き場を作らない（Windows 以外では UNC の字がフォルダ名になる・§9.557）', not probe.exists())

# ---- 6) 権限 ----
can = {r: role_can(r, 'app:release') for r in ROLES}
rec('置く・配るのは開発者・メンテナンス者だけ',
    can[ROLE_DEVELOPER] and can[ROLE_MAINTAINER] and sum(can.values()) == 2, str(can))

# ---- 7) 置いている間の進み具合・同時に2本・書きかけの片付け（§9.556） ----
base7 = Path(tempfile.mkdtemp()) / 'share'
ticks = []
out = app_update.publish_zip(make_zip('9.3.0'), 'p.zip', 'tester', base7, tick=lambda **kw: ticks.append(kw))
stages = [t.get('stage') for t in ticks]
order = [s0 for i, s0 in enumerate(stages) if i == 0 or stages[i - 1] != s0]
rec('進み具合は 確かめる→写す→仕上げ の順に言う', out.get('ok') and order == ['check', 'copy', 'finish'], str(order))
copies = [t for t in ticks if t.get('stage') == 'copy' and t.get('done')]
rec('写す段は1ファイルごとに n/N と量を言い、最後は全部',
    copies and copies[-1]['done'] == copies[-1]['total'] == out['files']
    and copies[-1]['bytes'] == copies[-1]['totalBytes'] == out['bytes']
    and [c['done'] for c in copies] == list(range(1, len(copies) + 1)),
    str(copies[-1] if copies else None))
orig_dir = app_update.update_dir
app_update.update_dir = lambda: base7   # 本物の置き場（既定の UNC）へ書かない（§9.504・§9.557 で踏んだ）
gate = threading.Event()
slow = lambda **kw: gate.wait(5)   # noqa: E731  1本目を写す段で止めておく
orig = app_update.publish_zip
app_update.publish_zip = lambda *a, **k: orig(*a, **dict(k, tick=slow))
first = {}
th = threading.Thread(target=lambda: first.update(app_update.run_publish(make_zip('9.4.0'), 'a.zip', 't')))
th.start()
deadline = time.time() + 5
while app_update.progress().get('state') != 'running' and time.time() < deadline:
    time.sleep(0.01)
second = app_update.run_publish(make_zip('9.5.0'), 'b.zip', 't')
gate.set()
th.join(10)
app_update.publish_zip = orig
app_update.update_dir = orig_dir
rec('この PC で同時に2本は置かない（2本目は理由を返す）', second.get('busy') and 'いま別の版' in second.get('error', ''),
    str(second))
rec('置き終わると進み具合は「終わった」と結果を言う',
    app_update.progress().get('state') in ('done', 'failed') and 'elapsed' in app_update.progress(),
    str({k: app_update.progress().get(k) for k in ('state', 'elapsed')}))
vd = base7 / 'versions'
old_tmp, new_tmp = vd / '.8.0.0.111.tmp', vd / '.8.0.1.222.tmp'
for d in (old_tmp, new_tmp):
    (d / 'backend').mkdir(parents=True)
t0 = time.time() - 2 * app_update.STALE_SEC
os.utime(old_tmp, (t0, t0))
gone = app_update.sweep_partial(base7)
rec('途中で終わった書きかけは片付ける（古い物だけ・いま置いている物は残す）',
    gone == 1 and not old_tmp.exists() and new_tmp.exists(), str(sorted(p.name for p in vd.iterdir())))
rec('書きかけは配る版の候補に数えない', all(not v['version'].startswith('.') for v in app_update.versions(base7)))

# ---- 8) 置き場を変える（§9.557） ----
orig_local, orig_shared = app_update.load_local_config, app_update._shared_value
try:
    app_update.load_local_config = lambda: {}
    app_update._shared_value = lambda: ''
    d0 = app_update.dir_choice()
    app_update._shared_value = lambda: r'\\srv\Apps2\WaveLog'
    d1 = app_update.dir_choice()
    app_update.load_local_config = lambda: {'update_dir': r'D:\local\share'}
    d2 = app_update.dir_choice()
finally:
    app_update.load_local_config, app_update._shared_value = orig_local, orig_shared
rec('置き場の順は この PC の local.json → 共有の設定 → 既定',
    d0 == (Path(app_update.DEFAULT_DIR), 'default') and d1[1] == 'shared' and str(d1[0]).endswith('Apps2\\WaveLog')
    and d2 == (Path(r'D:\local\share'), 'local'), str([d0, d1, d2]))
mirror = Path(tempfile.mkdtemp()) / 'config' / 'update.json'
try:
    app_update._shared_value = lambda: r'\\srv\Apps2\WaveLog'
    w1 = app_update.remember(mirror)
    w2 = app_update.remember(mirror)
    app_update._shared_value = lambda: ''
    w3 = app_update.remember(mirror)
finally:
    app_update._shared_value = orig_shared
rec('共有の設定を窓の控えへ写す（変わったときだけ書く・空に戻せば空）',
    w1 and not w2 and w3 and json.loads(mirror.read_text(encoding='utf-8')) == {'update_dir': ''}, str([w1, w2, w3]))
rec('窓は同じ控えの名・同じ順で読む（local.json → update.json → 既定）',
    f'pub const MIRROR: &str = "{app_update.MIRROR}";' in RS and '["local.json", MIRROR]' in RS)
# db_access を読み込むと共有マスタの写しを作り直す（§9.497）ので、ここ（1段目）は字で確かめる
DBA = (ROOT / 'backend' / 'db_access.py').read_text(encoding='utf-8')
PCR = (ROOT / 'backend' / 'routes' / 'path_config.py').read_text(encoding='utf-8')
live = DBA[DBA.index('PATH_CONFIG_LIVE_KEYS='):DBA.index('PATH_CONFIG_KEYS=PATH_CONFIG_STATIC_KEYS')]
text = PCR[PCR.index('_PATH_CONFIG_TEXT_FIELDS='):]
text = text[:text.index('\n\n')]
rec('置き場は共通設定の保存に載る（パス設定マスタの鍵・受け側の鍵）',
    f"'{app_update.CONFIG_KEY}'" in live and f"'{app_update.CONFIG_KEY}'" in text)

none = Path(tempfile.mkdtemp()) / 'config' / 'update.json'
try:
    app_update._shared_value = lambda: ''
    w0 = app_update.remember(none)
finally:
    app_update._shared_value = orig_shared
rec('覚えることが無ければ控えを作らない（窓は既定を読む）', not w0 and not none.exists())

# 共有の入口から入れた PC（§9.559）は、窓が「どこから来たか」を控えに書く（印 from=install）。共有の設定が空でも
# Python はこれを消さない——消すと次の起動で既定の置き場を見に行き、配る版へそろわない（CI の4回目で見つけた・§9.561）
origin = Path(tempfile.mkdtemp()) / 'config' / 'update.json'
origin.parent.mkdir(parents=True)
origin.write_text(json.dumps({'update_dir': r'D:\share\WaveLog', 'from': 'install'}), encoding='utf-8')
orig_mirror = app_update.mirror_path
try:
    app_update._shared_value = lambda: ''
    app_update.load_local_config = lambda: {}
    app_update.mirror_path = lambda: origin
    k1 = app_update.remember(origin)
    kept = json.loads(origin.read_text(encoding='utf-8'))
    c1 = app_update.dir_choice()
    app_update._shared_value = lambda: r'\\srv\Apps2\WaveLog'
    k2 = app_update.remember(origin)
    c2 = app_update.dir_choice()
    over = json.loads(origin.read_text(encoding='utf-8'))
finally:
    app_update._shared_value, app_update.load_local_config, app_update.mirror_path = orig_shared, orig_local, orig_mirror
rec('入れた元の置き場は、共有の設定が空でも消さない（Python も窓と同じ置き場を答える）',
    not k1 and kept.get('from') == 'install' and c1 == (Path(r'D:\share\WaveLog'), 'install'), str([k1, kept, c1]))
rec('共有の設定が決まれば、そちらが勝つ（入れた元の控えを上書きする）',
    k2 and c2[1] == 'shared' and over == {'update_dir': r'\\srv\Apps2\WaveLog'}, str([k2, c2, over]))
INS = (ROOT / 'desktop' / 'src' / 'install.rs').read_text(encoding='utf-8')
rec('窓は入れた元の置き場に印（from=install）を付けて控える',
    f'"{app_update.ORIGIN_KEY}": "{app_update.ORIGIN_INSTALL}"' in INS if hasattr(app_update, 'ORIGIN_KEY') else False)
stray = [str(d) for base in (ROOT, ROOT / 'tests') for d in base.iterdir() if d.name.startswith('\\\\')]
rec('この網を回しても、UNC の字のフォルダが作業フォルダに生まれない', not stray, str(stray))

# ---- 9) 新しい PC へ渡すもの（§9.559、利用者の指示「初回に配布する際に、ショットカット(アドレス)だけ渡す」） ----
base9 = Path(tempfile.mkdtemp()) / 'share'
app_update.publish_zip(make_zip('9.20.0', extra={'program/WaveLog.exe': 'MZ v20'}), 'a.zip', 't', base9)
app_update.publish_zip(make_zip('9.21.0', extra={'program/WaveLog.exe': 'MZ v21'}), 'b.zip', 't', base9)
orig_local, orig_plocal = app_update.load_local_config, paths.load_local_config


def _local(d):
    # この PC の設定は`paths.setting()`の1か所が読む（§9.568）。どちらの読み口も同じ値にする
    app_update.load_local_config = paths.load_local_config = (lambda: dict(d))


try:
    _local({})
    r = app_update.set_release('9.20.0', 't', base9)
    entry = base9 / app_update.ENTRY_EXE
    rec('配る版を決めると、置き場の直下にその版の exe（配る入口）を置く',
        r.get('ok') and entry.read_text(encoding='utf-8') == 'MZ v20', entry.read_text(encoding='utf-8') if entry.exists() else '無い')
    rec('この PC が共有のマスタの置き場を持たないときは、渡す設定を書かずに理由を言う',
        not (base9 / app_update.SEED).exists() and any('master_db_path' in x for x in r.get('notes', [])), str(r.get('notes')))
    _local({'master_db_path': r'\\srv\Records\master.sqlite3', 'master_share_mode': 'auto',
            'db_dir': r'D:\mine', 'records_db_path': r'D:\mine\r.sqlite3'})
    r = app_update.set_release('9.21.0', 't', base9)
    seed = json.loads((base9 / app_update.SEED).read_text(encoding='utf-8'))
    rec('配る版を選び直すと入口もその版になる', entry.read_text(encoding='utf-8') == 'MZ v21')
    rec('渡す設定は共有のマスタの置き場だけ（db_dir・records_db_path はその PC の物）',
        seed == {'master_db_path': r'\\srv\Records\master.sqlite3', 'master_share_mode': 'auto'}, str(seed))
    rec('置けたら注意は無い', r.get('notes') == [], str(r.get('notes')))
    _local({})
    app_update.set_release('9.20.0', 't', base9)
    rec('共有のマスタの置き場を持たない PC が配っても、前の控えを空で消さない',
        json.loads((base9 / app_update.SEED).read_text(encoding='utf-8')).get('master_db_path') == r'\\srv\Records\master.sqlite3')
    info = app_update.entry_info(base9)
    rec('画面へ渡す形: 入口のアドレスと渡す設定', info['exists'] and info['path'] == str(entry)
        and info['seed'].get('master_db_path'), str(info))
finally:
    app_update.load_local_config, paths.load_local_config = orig_local, orig_plocal

# ---- 9b) 初回起動でマスタを掴む（§9.568、利用者の報告「初回起動時にマスタをつかみに行ってくれないので、
#      まっさらな状態になってしまいます」）。決め方は paths.setting() の1か所 ----
SHARED_M = r'\\nlmsrvngy03\工場内共有\検査データ\Masters\master.sqlite3'
rec('既定の共有のマスタの置き場は利用者の指定どおり', paths.DEFAULT_MASTER_PATH == SHARED_M, paths.DEFAULT_MASTER_PATH)
_root9 = Path(tempfile.mkdtemp())
(_root9 / 'config').mkdir()
_keep_root, _keep_lcp = paths.APP_ROOT, paths.local_config_path


def _master(local=None, seed='none'):
    """local=その PC の local.json（None=無い）・seed=窓が写した install.json（'none'=写しが無い＝共有から入れていない）"""
    for f in ('local.json', 'install.json'):
        (_root9 / 'config' / f).unlink(missing_ok=True)
    if local is not None:
        (_root9 / 'config' / 'local.json').write_text(json.dumps(local), encoding='utf-8')
    if seed != 'none':
        (_root9 / 'config' / 'install.json').write_text(json.dumps(seed), encoding='utf-8')
    return paths.setting('master_db_path')


try:
    paths.APP_ROOT, paths.local_config_path = _root9, (lambda: _root9 / 'config' / 'local.json')
    rec('共有から入れた PC: 置き場から渡された値を使う', _master(seed={'master_db_path': r'\\srv\m.sqlite3'}) == (r'\\srv\m.sqlite3', 'seed'))
    rec('配る人が渡す設定を置き忘れても、既定の共有の置き場を使う（まっさらで始めない）', _master(seed={}) == (SHARED_M, 'default'))
    rec('local.json があってもマスタの置き場が無ければ、渡された値を使う（前は local.json が在ると写さなかった）',
        _master(local={'db_dir': 'C:\\x'}, seed={'master_db_path': r'\\srv\m.sqlite3'})[0] == r'\\srv\m.sqlite3')
    rec('その PC で決めた置き場が先', _master(local={'master_db_path': 'D:\\own.sqlite3'}, seed={'master_db_path': r'\\srv\m.sqlite3'})
        == ('D:\\own.sqlite3', 'local'))
    rec('共有から入れていない（開発・網）PC は既定へ倒さない（手元の db のまま）', _master() == (None, ''))
    rec('書込サイクルも渡された値を読む', (_master(seed={'master_share_mode': 'on'}) and paths.setting('master_share_mode')) == ('on', 'seed'))
finally:
    paths.APP_ROOT, paths.local_config_path = _keep_root, _keep_lcp
rec('渡す鍵の顔ぶれは paths の1か所（配る側も同じ定義を読む）', app_update.SEED_KEYS is paths.SEED_KEYS)
_INS = (ROOT / 'desktop' / 'src' / 'install.rs').read_text(encoding='utf-8')
rec('窓は local.json を書かない（書き手は Python・渡す設定は config/install.json へ写す）',
    'join("local.json")' not in _INS.split('#[cfg(test)]')[0], 'install.rs に local.json を書く所が残っている')
rec('置き場に届いた起動のたびに写し直す（update::peek）・共有の入口からは Python の前に写す',
    'install::mirror_seed(' in (ROOT / 'desktop' / 'src' / 'update.rs').read_text(encoding='utf-8')
    and 'mirror_seed(&app.join("config"), from)' in _INS)
INS =(ROOT / 'desktop' / 'src' / 'install.rs').read_text(encoding='utf-8')
rec('入口と渡す設定の名前・鍵は窓（install.rs）と同じ字',
    f'pub const ENTRY: &str = "{app_update.ENTRY_EXE}";' in INS and f'pub const SEED: &str = "{app_update.SEED}";' in INS
    and 'pub const SEED_KEYS: [&str; 2] = [%s];' % ', '.join('"%s"' % k for k in app_update.SEED_KEYS) in INS)
rec('Start.vbs は版に入れない（§9.559で外した）', 'Start.vbs' not in app_update.PAYLOAD)
# ---- 10) 版の確かめと Python の起動を同時に進める（§9.561、利用者の承認） ----
MAIN = (ROOT / 'desktop' / 'src' / 'main.rs').read_text(encoding='utf-8')
UPD = (ROOT / 'desktop' / 'src' / 'update.rs').read_text(encoding='utf-8')
i_peek, i_get = MAIN.find('peek_in_background(&root)'), MAIN.find('let started = sup.get();')
rec('版の確かめを裏で始めてから Python を起こす（起動＝長いほう）', 0 < i_peek < i_get, f'{i_peek} < {i_get}')
body = MAIN[MAIN.find('fn settle_update('):]
rec('違えば写しを手放してから Python を止め、入れ替え、起こし直す',
    0 < body.find('drop(started);') < body.find('sup.stop();') < body.find('update::apply(') < body.find('Some(sup.get())'))
rec('更新は「読むだけ」と「入れ替える」に分かれ、続けて呼ぶ口も残る',
    'pub fn peek(' in UPD and 'pub fn apply(' in UPD and 'pub fn check_and_apply(' in UPD)

ok = sum(1 for _, x in R if x)
print(f'\n== {ok}/{len(R)} PASS ==')
sys.exit(0 if ok == len(R) else 1)
