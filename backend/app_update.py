"""app_update.py: アプリの版を共有の置き場に残し、配る版を決める（§9.555）。

===========================================================================
利用者の指示（§9.555）
  「更新の仕組みを作りたいです。ファイルの置き場は（サーバー nlmsrvngy03 の 工場内共有 > 検査データ >
    Records > アプリメンテナンス > WaveLog）にして、バージョンごとのデータをこの場所に保存し、
    アップデートを行う機能を組み込みたいです。」（置き場の正確な字は`DEFAULT_DIR`）
  選んだ形: ①各PCは手元へ写して動かす ②ZIP を選んで置く ③配る版を指定→起動時に自動

置き場（`update_dir()`）の中身:
  versions/<版>/          … 版ごとの中身（`PAYLOAD`の項目だけ）と`manifest.json`（全ファイルの大きさと sha256）
  release.json            … **配る版**（全PCが起動時にそろえる版・前の版も控える）

役目の分け方:
  ・ここ（Python）… ZIP を検めて版を置く・配る版を決める・状態を答える（メンテナンス者の画面）
  ・窓（Rust・`desktop/src/update.rs`）… 起動画面の中で、中身（Python）を起こす**前に**`release.json`を読み、
    手元の版と違えば版のフォルダを写して sha256 を確かめ、項目ごとに入れ替える。動いている Python の
    ファイルを入れ替えないために、入れ替えは Python を起こす前の窓の役目にした。
**データ（`db`・`config`）は版に入れない**——各PCのアプリのフォルダに残り、入れ替えで触らない。
===========================================================================
"""
import hashlib
import io
import json
import os
import re
import shutil
import threading
import time
import zipfile
from pathlib import Path

from .changelog_data import APP_VERSION
from .paths import load_local_config
from .quiet import quiet

# 置き場の既定（利用者の指定）。`config/local.json`の`update_dir`で変えられる（窓も同じ鍵を読む）。
DEFAULT_DIR = r'\\nlmsrvngy03\工場内共有\検査データ\Records\アプリメンテナンス\WaveLog'
CONFIG_KEY = 'update_dir'
# 版に入れる物（アプリのフォルダの最上位の名前）。**データ（db・config）と開発の物（tests・docs・desktop）は入れない**。
# 窓（update.rs）はこの並びを manifest から読むので、ここを変えれば入れ替える範囲も変わる。
PAYLOAD = ('backend', 'static', 'templates', 'program', 'Start.vbs', 'README.md')
# 版に欠かせない物（無い ZIP は断る）。
REQUIRED = ('backend/changelog_data.py', 'program/sidecar.py', 'program/WaveLog.exe')
MANIFEST = 'manifest.json'
RELEASE = 'release.json'
VERSIONS = 'versions'
# 共有に届くかを確かめる長さ。届かない UNC は OS が数十秒待たせることがある（画面を止めない）。
REACH_SEC = 3.0
# 置いている最中に終わった書きかけを片付けるまでの長さ（別の PC がいま置いている物を消さない）。
STALE_SEC = 3600
_VERSION_RE = re.compile(r"^APP_VERSION\s*=\s*['\"]([0-9][0-9A-Za-z.\-]*)['\"]", re.M)
# 窓（update.rs）と同じ読み方: 版の字は数字で始まり、英数字・点・ハイフンだけ。
_SAFE_VERSION = re.compile(r'^[0-9][0-9A-Za-z.\-]{0,40}$')


def update_dir():
    """置き場。`config/local.json`の`update_dir`（環境変数を展開）→ 既定。"""
    given = str((load_local_config() or {}).get(CONFIG_KEY) or '').strip()
    return Path(os.path.expandvars(given)) if given else Path(DEFAULT_DIR)


def reachable(path=None, wait=REACH_SEC):
    """置き場に届くか（`wait`秒で打ち切る）。戻り値は（届いたか, 理由）。"""
    path = Path(path or update_dir())
    out = {}

    def look():
        try:
            path.mkdir(parents=True, exist_ok=True)
            out['ok'] = path.is_dir()
        except OSError as e:
            out['why'] = str(e)
    t = threading.Thread(target=look, name='update-reach', daemon=True)
    t.start()
    t.join(wait)
    if t.is_alive():
        return False, '%d秒待っても置き場に届きません（%s）' % (wait, path)
    if out.get('ok'):
        return True, ''
    return False, '置き場を開けません（%s）: %s' % (path, out.get('why') or '不明')


def version_in(text):
    """`changelog_data.py`の中身から版の字を読む（ZIP の中身は import しない）。"""
    m = _VERSION_RE.search(text or '')
    return m.group(1) if m else ''


def _zip_root(names):
    """ZIP の中でアプリのフォルダにあたる頭（GitHub の ZIP は`WaveLog-main/`が付く）。無ければ None。"""
    for n in names:
        if n.endswith('backend/changelog_data.py'):
            return n[:-len('backend/changelog_data.py')]
    return None


def _payload_name(rel):
    """ZIP の中の道（頭を外したもの）が版に入れる物か。危ない道（`..`・絶対）は入れない。"""
    parts = rel.split('/')
    if not rel or rel.startswith('/') or '..' in parts or ':' in parts[0]:
        return False
    return parts[0] in PAYLOAD and not any(p == '__pycache__' for p in parts)


def _manifest(version, files, extra=None):
    """目録の形（窓の`update.rs`が読む）。`files`は道（`/`区切り）・大きさ・sha256。"""
    files = sorted(files, key=lambda f: f['path'])
    out = {'version': version, 'payload': list(PAYLOAD), 'files': files,
           'bytes': sum(f['size'] for f in files)}
    out.update(extra or {})
    return out


def _quiet_tick(**_kw):
    """進み具合を受け取らない呼び手の既定。"""


def sweep_partial(base=None, older=STALE_SEC):
    """置いている最中に終わった（窓を閉じた・落ちた）書きかけ（`versions/.<版>.<pid>.tmp`）を片付ける。

    **`older`秒より古い物だけ**——別の PC がいま置いている最中の物を消さない。書きかけは点で始まるので
    `versions()`はもともと数えない（配られることは無い）。片付けは置き場を散らかさないため。"""
    root = Path(base or update_dir()) / VERSIONS
    gone = 0
    try:
        dirs = [d for d in root.iterdir() if d.is_dir() and d.name.startswith('.') and d.name.endswith('.tmp')]
    except OSError as _e:
        quiet('置き場の書きかけを数えられない（片付けない）', _e)
        return 0
    for d in dirs:
        try:
            if time.time() - d.stat().st_mtime < older:
                continue
            shutil.rmtree(d)
            gone += 1
        except OSError as _e:
            quiet('書きかけを片付けられない（次に開いたときにもう一度）', _e)
    return gone


def _open_zip(data):
    """ZIP を検める。→ (ZipFile, 頭を外した道→ZIPの名前, 版, None) か (None, None, None, 断る理由)。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return None, None, None, 'ZIP ファイルとして読めません（GitHub の「Download ZIP」で落とした物を選んでください）。'
    names = zf.namelist()
    head = _zip_root(names)
    if head is None:
        zf.close()
        return None, None, None, 'アプリの ZIP ではありません（backend/changelog_data.py が入っていません）。'
    rel = {n[len(head):]: n for n in names if n.startswith(head) and not n.endswith('/')}
    lack = [r for r in REQUIRED if r not in rel]
    version = version_in(zf.read(rel['backend/changelog_data.py']).decode('utf-8', 'replace')) if not lack else ''
    why = ('欠かせない物が入っていません: ' + '・'.join(lack) if lack
           else '' if _SAFE_VERSION.match(version or '') else '版を読めません（APP_VERSION）: %r' % version)
    if why:
        zf.close()
        return None, None, None, why
    return zf, {r: n for r, n in rel.items() if _payload_name(r)}, version, None


def _copy_payload(zf, rel, tmp, tick):
    """版に入れる物を`tmp`へ写す。**写しながら sha256 を数える**（置き場から読み直さない——
    共有は遅いので、読み直すと同じ時間がもう1回かかる）。→ 目録の`files`。"""
    total = len(rel)
    total_bytes = sum(zf.getinfo(n).file_size for n in rel.values())
    files, done_bytes = [], 0
    for i, (r, n) in enumerate(sorted(rel.items()), 1):
        target = tmp / r
        target.parent.mkdir(parents=True, exist_ok=True)
        h, size = hashlib.sha256(), 0
        with zf.open(n) as src, open(target, 'wb') as out:
            for chunk in iter(lambda: src.read(1 << 20), b''):
                h.update(chunk)
                out.write(chunk)
                size += len(chunk)
        files.append({'path': r, 'size': size, 'sha256': h.hexdigest()})
        done_bytes += size
        tick(stage='copy', done=i, total=total, bytes=done_bytes, totalBytes=total_bytes)
    return files


def _build_commit(tmp):
    """exe を作ったコミット（`WaveLog.build.json`）。無ければ空。"""
    try:
        return str(json.loads((tmp / 'program' / 'WaveLog.build.json').read_text(encoding='utf-8')).get('commit') or '')
    except (OSError, ValueError) as _e:
        quiet('ZIP に exe の名乗り（WaveLog.build.json）が無い（コミットを残さない）', _e)
        return ''


def publish_zip(data, source='', uid='', base=None, tick=_quiet_tick):
    """ZIP（GitHub の main を落とした物）を検めて、`versions/<版>/`として置く。

    断る: ZIP でない・アプリの物でない・欠かせない物が無い・**同じ版がもう在る**（版を上げずに置き直すと、
    もうその版を写した PC と中身が食い違う）。置くときは途中のフォルダへ書いてから名前を変える（半端な版を残さない）。
    `tick(stage=…, …)`へ進み具合を渡す（`check`→`copy`（done/total・bytes/totalBytes）→`finish`）。"""
    base = Path(base or update_dir())
    tick(stage='check')
    sweep_partial(base)
    zf, rel, version, why = _open_zip(data)
    if why:
        return {'ok': False, 'error': why}
    with zf:
        dest = base / VERSIONS / version
        if dest.exists():
            return {'ok': False, 'error': '版 %s はもう置いてあります。版を上げた ZIP を選んでください。' % version,
                    'version': version}
        tick(stage='copy', version=version, done=0, total=len(rel), bytes=0,
             totalBytes=sum(zf.getinfo(n).file_size for n in rel.values()))
        tmp = base / VERSIONS / ('.%s.%d.tmp' % (version, os.getpid()))
        try:
            shutil.rmtree(tmp, ignore_errors=True)
            files = _copy_payload(zf, rel, tmp, tick)
            tick(stage='finish')
            man = _manifest(version, files, {'placedAt': time.strftime('%Y-%m-%d %H:%M'), 'placedBy': uid or '',
                                             'source': source or '', 'commit': _build_commit(tmp)})
            (tmp / MANIFEST).write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding='utf-8')
            os.replace(tmp, dest)
        except OSError as e:
            shutil.rmtree(tmp, ignore_errors=True)
            return {'ok': False, 'error': '置き場へ書けません（%s）: %s' % (base, e)}
    return {'ok': True, 'version': version, 'files': len(man['files']), 'bytes': man['bytes']}


# ---- いま置いている版の進み具合（この PC の1本だけ・画面が問い合わせて描く） ----
_RUN_LOCK = threading.Lock()
_STATE_LOCK = threading.Lock()
_PROGRESS = {'state': 'idle'}


def _set_progress(**kw):
    with _STATE_LOCK:
        _PROGRESS.update(kw)


def progress():
    """いま置いている版の進み具合（`state`: idle／running／done／failed）。経過秒も添える。"""
    with _STATE_LOCK:
        out = dict(_PROGRESS)
    if out.get('startedAt'):
        out['elapsed'] = round((out.get('endedAt') or time.time()) - out['startedAt'], 1)
    return out


def run_publish(data, source='', uid=''):
    """画面の「ZIP から版を置く」の1本。**この PC で同時に置けるのは1本だけ**（2本目は理由を返す）。
    進み具合は`progress()`が答える（画面は置き終わるまで問い合わせて描く）。"""
    if not _RUN_LOCK.acquire(blocking=False):
        return {'ok': False, 'busy': True, 'error': 'いま別の版を置いています。置き終わってから選んでください。'}
    try:
        with _STATE_LOCK:
            _PROGRESS.clear()
            _PROGRESS.update(state='running', stage='check', source=source or '', startedAt=time.time())
        out = publish_zip(data, source, uid, tick=_set_progress)
        _set_progress(state='done' if out.get('ok') else 'failed', endedAt=time.time(),
                      result=out, error=out.get('error', ''))
        return out
    finally:
        _RUN_LOCK.release()


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as _e:
        quiet('置き場の JSON を読めない（無いものとして扱う）', _e)
        return None


def versions(base=None):
    """置いてある版（新しい順）。manifest の無いフォルダ（書きかけ・手で置いた物）は数えない。"""
    base = Path(base or update_dir())
    out = []
    try:
        dirs = [d for d in (base / VERSIONS).iterdir() if d.is_dir() and not d.name.startswith('.')]
    except OSError as _e:
        quiet('置き場の版を数えられない（置いていないとして扱う）', _e)
        return out
    for d in dirs:
        m = _read_json(d / MANIFEST)
        if not isinstance(m, dict) or m.get('version') != d.name:
            continue
        out.append({'version': d.name, 'placedAt': m.get('placedAt', ''), 'placedBy': m.get('placedBy', ''),
                    'source': m.get('source', ''), 'commit': str(m.get('commit') or '')[:7],
                    'files': len(m.get('files') or []), 'bytes': m.get('bytes', 0)})
    return sorted(out, key=lambda v: version_key(v['version']), reverse=True)


def version_key(v):
    """版を数として比べる（`2.10.0` > `2.9.0`）。数でない欠片は0。"""
    return tuple(int(x) if x.isdigit() else 0 for x in re.split(r'[.\-]', str(v or '')))


def release(base=None):
    """配る版（`release.json`）。決めていなければ None。"""
    r = _read_json(Path(base or update_dir()) / RELEASE)
    return r if isinstance(r, dict) and r.get('version') else None


def set_release(version, uid='', base=None):
    """配る版を決める（前の版も控える）。**置いてある版だけ**選べる。書くのは途中のファイル→名前を変える。"""
    base = Path(base or update_dir())
    have = {v['version'] for v in versions(base)}
    if version not in have:
        return {'ok': False, 'error': '版 %s は置き場にありません。先に ZIP から置いてください。' % version}
    prev = release(base)
    doc = {'version': version, 'setAt': time.strftime('%Y-%m-%d %H:%M'), 'setBy': uid or '',
           'previous': (prev or {}).get('version', '')}
    tmp = base / (RELEASE + '.%d.tmp' % os.getpid())
    try:
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
        os.replace(tmp, base / RELEASE)
    except OSError as e:
        return {'ok': False, 'error': '配る版を書けません（%s）: %s' % (base, e)}
    return {'ok': True, **doc}


def status():
    """画面へ渡す形（判定はここ・画面は読むだけ）。"""
    base = update_dir()
    ok, why = reachable(base)
    if ok:
        sweep_partial(base)
    rel = release(base) if ok else None
    vs = versions(base) if ok else []
    return {'dir': str(base), 'reachable': ok, 'why': why, 'local': APP_VERSION,
            'release': rel, 'versions': vs,
            # この PC が次の起動でそろえるか（窓が同じ比べ方をする）
            'pending': bool(rel and rel['version'] != APP_VERSION),
            'payload': list(PAYLOAD), 'publishing': progress().get('state') == 'running'}
