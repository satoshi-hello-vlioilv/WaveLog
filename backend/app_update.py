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

from . import path_config
from .changelog_data import APP_VERSION
from .paths import APP_ROOT, load_local_config
from .quiet import quiet

# 置き場の既定（利用者の指定・§9.557で Records\アプリメンテナンス から Apps へ移した）。
DEFAULT_DIR = r'\\nlmsrvngy03\工場内共有\検査データ\Apps\WaveLog'
# 置き場を変える鍵。決める順は`update_dir()`（窓の`update.rs`も同じ順）:
#   ① この PC の`config/local.json`（この PC だけの上書き）
#   ② 共有の設定（パス設定マスタ・画面「アプリの更新」で変える。全 PC が同じ値を見る）
#   ③ 既定（`DEFAULT_DIR`）
CONFIG_KEY = 'update_dir'
# ② の控え（`config/update.json`）。窓は Python を起こす前に置き場を知る必要があり、マスタ（SQLite）は
# 読まないので、Python が写しておく（`remember()`）。`config`は版に入れない（入れ替えで消えない）。
MIRROR = 'update.json'
# 控えを確かめ直す間隔（ハートビートから呼ぶ・マスタを開くのはこの間隔に1回だけ）。
REMEMBER_SEC = 600
# 版に入れる物（アプリのフォルダの最上位の名前）。**データ（db・config）と開発の物（tests・docs・desktop）は入れない**。
# 窓（update.rs）はこの並びを manifest から読むので、ここを変えれば入れ替える範囲も変わる。
PAYLOAD = ('backend', 'static', 'templates', 'program', 'README.md')
# 版に欠かせない物（無い ZIP は断る）。
REQUIRED = ('backend/changelog_data.py', 'program/sidecar.py', 'program/WaveLog.exe')
MANIFEST = 'manifest.json'
RELEASE = 'release.json'
VERSIONS = 'versions'
# **配る入口**（§9.559、利用者の指示「初回に配布する際に、ショートカット(アドレス)だけ渡す」）。配る版を決めると、
# その版の exe を置き場の直下へ写す。新しい PC にはこの exe へのアドレスだけを渡し、初回の起動で窓（`desktop/src/install.rs`）が
# 配る版をこの PC へ写す。名前は窓の`install::ENTRY`と同じ字。
ENTRY_EXE = 'WaveLog.exe'
# 新しい PC へ渡す最初の設定（`config/local.json`の種）。配る版を決めた PC の値を控える（利用者の選択）。
# 渡すのは**共有のマスタの置き場**だけ——`db_dir`・`records_db_path`はその PC の物で、全 PC へ配る値ではない。
SEED = 'install.json'
SEED_KEYS = ('master_db_path', 'master_share_mode')
# 共有に届くかを確かめる長さ。届かない UNC は OS が数十秒待たせることがある（画面を止めない）。
REACH_SEC = 3.0
# 置いている最中に終わった書きかけを片付けるまでの長さ（別の PC がいま置いている物を消さない）。
STALE_SEC = 3600
_VERSION_RE = re.compile(r"^APP_VERSION\s*=\s*['\"]([0-9][0-9A-Za-z.\-]*)['\"]", re.M)
# 窓（update.rs）と同じ読み方: 版の字は数字で始まり、英数字・点・ハイフンだけ。
_SAFE_VERSION = re.compile(r'^[0-9][0-9A-Za-z.\-]{0,40}$')


def _shared_value():
    """共有の設定（パス設定マスタの`update_dir`）。無ければ空。"""
    return str(path_config.value(CONFIG_KEY, '') or '').strip()


def dir_choice():
    """→ (置き場, 出どころ)。出どころは `local`（この PC の config/local.json）／`shared`（共有の設定）／`default`。"""
    local = str((load_local_config() or {}).get(CONFIG_KEY) or '').strip()
    if local:
        return Path(os.path.expandvars(local)), 'local'
    shared = _shared_value()
    if shared:
        return Path(os.path.expandvars(shared)), 'shared'
    return Path(DEFAULT_DIR), 'default'


def update_dir():
    """置き場（決める順は`dir_choice()`・窓の`update.rs`と同じ）。"""
    return dir_choice()[0]


def mirror_path():
    return APP_ROOT / 'config' / MIRROR


def remember(path=None):
    """共有の設定を窓の読む控え（`config/update.json`）へ写す。**変わったときだけ書く**（中身を比べる）。
    窓は次の起動からこの値を読む。→ 書いたか。"""
    target = Path(path) if path else mirror_path()
    shared = _shared_value()
    text = json.dumps({CONFIG_KEY: shared}, ensure_ascii=False)
    try:
        if target.exists() and target.read_text(encoding='utf-8') == text:
            return False
        if not shared and not target.exists():
            return False                          # 覚えることが無い（窓は既定を読む）——空の控えを作らない
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + '.%d.tmp' % os.getpid())
        tmp.write_text(text, encoding='utf-8')
        os.replace(tmp, target)
        return True
    except OSError as _e:
        quiet('置き場の控えを書けない（窓は前の控えか既定を読む）', _e)
        return False


_REMEMBERED_AT = [0.0]


def remember_soon():
    """ハートビートから呼ぶ。`REMEMBER_SEC`に1回だけ、裏で`remember()`する（開いたままの PC も
    共有の設定の変更を拾い、次の起動から新しい置き場を見る）。"""
    now = time.time()
    if now - _REMEMBERED_AT[0] < REMEMBER_SEC:
        return
    _REMEMBERED_AT[0] = now
    threading.Thread(target=remember, name='update-remember', daemon=True).start()


def reachable(path=None, wait=REACH_SEC):
    """置き場に届くか（`wait`秒で打ち切る）。戻り値は（届いたか, 理由）。"""
    path = Path(path or update_dir())
    out = {}

    def look():
        # **作らない**（見るだけ）。まだ無ければ、親に届くなら「届く」と答える——置き場は版を置くときに作る
        # （`publish_zip()`）。見るだけで作ると、Windows 以外では UNC の字がただのフォルダ名になり、
        # 動いている場所に字のとおりのフォルダが生まれる（網で踏んだ・§9.557）。
        try:
            out['ok'] = path.is_dir() or path.parent.is_dir()
            if not out['ok']:
                out['why'] = '置き場もその親のフォルダも見つかりません'
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


def _replace_file(src_bytes_or_path, dst):
    """途中のファイルへ書いてから名前を変える（読む側が半端な物を見ない）。"""
    tmp = dst.with_name(dst.name + '.%d.tmp' % os.getpid())
    try:
        if isinstance(src_bytes_or_path, Path):
            shutil.copyfile(src_bytes_or_path, tmp)
        else:
            tmp.write_bytes(src_bytes_or_path)
        os.replace(tmp, dst)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError as _e:
                quiet('途中のファイルを消せない（次に置くときに上書きする）', _e)


def place_entry(version, base=None):
    """配る入口（置き場の直下の exe）を、その版の exe にする。→ 置けなかった理由（置けたら空）。
    入口から起こされた exe はすぐこの PC へ写して終わる（§9.554）ので、掴まれている時間は短い。"""
    base = Path(base or update_dir())
    src = base / VERSIONS / version / 'program' / ENTRY_EXE
    dst = base / ENTRY_EXE
    try:
        if dst.is_file() and dst.stat().st_size == src.stat().st_size and _sha256(dst) == _sha256(src):
            return ''
        _replace_file(src, dst)
        return ''
    except OSError as e:
        return '配る入口（%s）を置き換えられませんでした: %s。どこかの PC が入口を開いている最中かもしれません。もう一度「この版を配る」を押してください。' % (dst, e)


def seed_values():
    """この PC の`config/local.json`のうち、新しい PC へ渡す値（書いたまま・環境変数も展開しない）。"""
    local = load_local_config() or {}
    return {k: str(local[k]).strip() for k in SEED_KEYS if str(local.get(k) or '').strip()}


def place_seed(base=None):
    """新しい PC へ渡す最初の設定（`install.json`）を、この PC の値で書く。→ (書いた値, 理由)。
    **この PC が共有のマスタの置き場を持たないときは書かない**（ほかの PC が控えた値を空で消さない）。"""
    base = Path(base or update_dir())
    vals = seed_values()
    if not vals.get('master_db_path'):
        if (base / SEED).is_file():
            return {}, 'この PC の config/local.json に master_db_path が無いので、新しい PC へ渡す設定は前の控えのままにしました'
        return {}, ('新しい PC へ共有のマスタの置き場を渡せません（この PC の config/local.json に master_db_path がありません）。'
                    'master_db_path を持つ PC で「この版を配る」を押してください')
    try:
        _replace_file(json.dumps(vals, ensure_ascii=False, indent=1).encode('utf-8'), base / SEED)
        return vals, ''
    except OSError as e:
        return {}, '新しい PC へ渡す設定を書けませんでした（%s）: %s' % (base / SEED, e)


def _sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def set_release(version, uid='', base=None):
    """配る版を決める（前の版も控える）。**置いてある版だけ**選べる。書くのは途中のファイル→名前を変える。
    あわせて配る入口（`place_entry()`）と新しい PC へ渡す設定（`place_seed()`）を置く（§9.559）。
    この2つが置けなくても、配る版は決まっている（各 PC の更新は進む）——理由は`notes`で言う。"""
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
    notes = [x for x in (place_entry(version, base),) if x]
    _vals, why = place_seed(base)
    if why:
        notes.append(why)
    return {'ok': True, **doc, 'notes': notes}


def entry_info(base):
    """新しい PC へ渡すもの（入口のアドレスと、渡す設定）。画面はこれを出すだけ。"""
    entry = Path(base) / ENTRY_EXE
    seed = _read_json(Path(base) / SEED) or {}
    return {'path': str(entry), 'exists': entry.is_file(),
            'seed': {k: str(seed.get(k) or '') for k in SEED_KEYS if seed.get(k)}}


def status():
    """画面へ渡す形（判定はここ・画面は読むだけ）。"""
    base, source = dir_choice()
    remember()
    ok, why = reachable(base)
    if ok:
        sweep_partial(base)
    rel = release(base) if ok else None
    vs = versions(base) if ok else []
    return {'dir': str(base), 'dirSource': source, 'shared': _shared_value(), 'defaultDir': DEFAULT_DIR,
            'reachable': ok, 'why': why, 'local': APP_VERSION,
            'release': rel, 'versions': vs,
            # この PC が次の起動でそろえるか（窓が同じ比べ方をする）
            'pending': bool(rel and rel['version'] != APP_VERSION),
            'payload': list(PAYLOAD), 'publishing': progress().get('state') == 'running',
            'entry': entry_info(base) if ok else None}
