"""master_share.py: master.sqlite3 を共有に置くための書込サイクル（§9.263）。

============================================================
なぜ要るか
------------------------------------------------------------
測定データは設備ごとに分けて「1ファイル1書き手」を構造として満たした
（§9.258）。作業予定は共有の1ファイルだが、**ロック→取り直し→当てる→
改訂番号→丸ごと置換**という書込サイクルを持っている（§4・schedule_sync）。

マスタだけが取り残されていた——全端末が同じ `master.sqlite3` へ直に書き、
読むときも共有を直接開いていた。SQLite自身が「ネットワークファイル
システム上での使用は避けること」と明言しており、SMB越しではロックが
当てにならない。列幅のドラッグや選択肢の使用回数など**書込頻度は高い**
ので、衝突は現実的な危険だった。

ここは作業予定と**同じ形**を持ち込む。実装を1つにまとめず別モジュール
にしてあるのは、対象ファイルもロック名も改訂番号の置き場も違うため
——共通化すると引数だらけの関数になり、どちらの都合で分岐しているのか
読めなくなる（§9.163の「1箇所が答える」は"同じ問い"に対しての話）。

  読み: **手元の写し**から（共有を直接読まない）
  書き: ロック → 写しを取り直す → 当てる → 改訂番号 → 丸ごと置換 → 解放

**既定は「共有に置いていなければ何もしない」。** 手元の `db/` に置いて
いる端末の動きは1バイトも変わらない（§9.251と同じ作法）。
============================================================
"""
import json
import threading
import time
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from . import atomic_io, paths
from .logging_setup import app_logger

LOCK_FILENAME = 'master.lock.json'
META_TABLE = '共有メタ'
REVISION_KEY = 'master_revision'
# ロックの既定。作業予定と同じ考え方だが、**マスタの書込は短い**
# （1リクエスト＝数百ms）ので、待たせすぎないよう短めに置く。
LOCK_TTL_SEC_DEFAULT = 20
# 取ったロックを読み直して確かめるまでの待ち。**置き場の種類で変える**——
# クラウド同期（Box等）は結果整合性なので待たないと確かめにならないが、
# ファイルサーバー（SMB）は書いた直後に読み返せる。一律1.5秒にすると、
# **書込のたびに1.5秒待たされる**（測定の保存が体感で遅くなる）。
LOCK_VERIFY_DELAY_CLOUD_SEC = 1.5
LOCK_VERIFY_DELAY_NETWORK_SEC = 0.3

# この段（Blueprint）の非GETはマスタを書きうる、という一覧（§9.263）。
# **載せ忘れると書込サイクルを通らない**ので、`tests/test_mastershare.py`が
# 「マスタへ書いているBlueprintが全部載っているか」を機械で数える
# （`access_mode._WRITE_ALLOWED_MODES`の宣言漏れを見張るのと同じ作法）。
WRITING_BLUEPRINTS = {'masters', 'path_config', 'master_tables', 'schedule', 'measurement'}

# 上の段に居るが**マスタは書かない**非GET（§9.267）。置き場を作る・
# config/local.json を書くのはファイルシステムへの操作で、master.sqlite3 は
# 1バイトも触らない。ここに載せないと、押すたびに共有のロックを取りに行き、
# **他の端末の保存を待たせる**（しかも押し直せる操作なので409が出やすい）。
# `access_mode._READ_ONLY_POST_ENDPOINTS` と同じ作法で、鍵は
# `Blueprint名.関数名`——**エンドポイントを別のBlueprintへ移すと黙って
# 意味が変わる**ので、移すときは必ずここも直す。
NON_MASTER_ENDPOINTS = {
    'path_config.storage_layout_prepare',
    'path_config.storage_layout_local_config',
}


class MasterLockHeld(Exception):
    def __init__(self, holder_login, holder_pc, remaining):
        self.holder_login = holder_login
        self.holder_pc = holder_pc
        self.remaining = remaining
        super().__init__(f'他の端末がマスタを更新中です（{holder_login or "不明"}／'
                         f'{holder_pc or "不明"}、あと約{remaining}秒）。')


class MasterShareUnavailable(Exception):
    """共有のマスタへ到達できない。**読みは写しで続けられる**ので、
    この例外は書込のときだけ投げる。"""


_state = {'shared': False, 'src': None, 'mirror': None, 'revision': 0}
_lock = threading.RLock()
_write_lock = threading.RLock()   # この端末の中で書込を1本にまとめる


# ---- 共有かどうかの判定 --------------------------------------------------
def _mode_setting():
    """'auto'（既定）／'on'／'off'。パス設定マスタから読むが、**マスタ自身の
    置き場を決める設定なので鶏と卵**——`config/local.json` の
    `master_share_mode` だけで上書きできる。"""
    try:
        v = str(paths.load_local_config().get('master_share_mode') or '').strip().lower()
    except Exception:
        v = ''
    return v if v in ('auto', 'on', 'off') else 'auto'


def _looks_shared(path):
    """置き場が共有か。**綴りとドライブ種別だけ**で決める（§9.262と同じ理由
    ——共有越しでは stat だけ失敗することがあり、確認そのものが失敗原因に
    なるのを避ける）。"""
    try:
        if paths.is_network_path(str(path)):
            return True
    except Exception:
        pass
    try:
        return bool(paths.cloud_sync_hint(Path(path)))
    except Exception:
        return False


def configure(master_path):
    """起動時に1回だけ呼ぶ。実際に開くべきパスを返す。

    共有に置かれていれば**手元の写し**のパスを返し、そうでなければ
    渡されたパスをそのまま返す（＝今までどおり）。
    """
    src = Path(master_path)
    mode = _mode_setting()
    shared = (mode == 'on') or (mode == 'auto' and _looks_shared(src))
    with _lock:
        _state['shared'] = shared
        _state['src'] = src
        _state['mirror'] = None
    if not shared:
        return src
    mirror = paths.work_dir() / 'master.local.sqlite3'
    with _lock:
        _state['mirror'] = mirror
    try:
        _pull(force=True)
    except Exception as e:
        # **共有へ届かなくても起動は止めない**——前に落とした写しがあれば
        # それで読める（§9.89の「元へ到達できなくても前の写しで読み続ける」）。
        app_logger().warning('共有マスタを取り込めませんでした（写しで続けます）: %s', e)
    return mirror


def is_shared():
    with _lock:
        return bool(_state['shared'])


def source_path():
    with _lock:
        return _state['src']


def local_path():
    """実際に開くファイル。共有でなければ元のパスそのもの。"""
    with _lock:
        return _state['mirror'] if _state['shared'] else _state['src']


def status():
    """画面へ出す状態。**読めなかったことを「共有していない」と混同しない。**"""
    with _lock:
        st = dict(_state)
    out = {'shared': bool(st['shared']), 'mode': _mode_setting(),
           'source': str(st['src'] or ''), 'mirror': str(st['mirror'] or ''),
           'revision': st['revision']}
    if st['shared']:
        out['lock'] = lock_status()
    return out


# ---- 改訂番号 ------------------------------------------------------------
def _ensure_meta(c):
    cur = c.cursor()
    cur.execute(f'CREATE TABLE IF NOT EXISTS [{META_TABLE}] ([キー] TEXT PRIMARY KEY, [値] TEXT)')
    c.commit()


def _read_revision(path):
    from .db_access import connect, tables
    try:
        with connect(path, True) as c:
            if META_TABLE not in tables(c):
                return 0
            row = c.cursor().execute(
                f'SELECT [値] FROM [{META_TABLE}] WHERE [キー]=?', [REVISION_KEY]).fetchone()
            return int((row or [0])[0] or 0)
    except Exception:
        return 0


def _bump_revision(path, uid=''):
    from .db_access import connect
    with connect(path, False) as c:
        _ensure_meta(c)
        cur = c.cursor()
        row = cur.execute(f'SELECT [値] FROM [{META_TABLE}] WHERE [キー]=?', [REVISION_KEY]).fetchone()
        nxt = int((row or [0])[0] or 0) + 1
        cur.execute(f'INSERT OR REPLACE INTO [{META_TABLE}] ([キー],[値]) VALUES (?,?)',
                    [REVISION_KEY, str(nxt)])
        cur.execute(f'INSERT OR REPLACE INTO [{META_TABLE}] ([キー],[値]) VALUES (?,?)',
                    ['master_updated_by', str(uid or '')[:50]])
        cur.execute(f'INSERT OR REPLACE INTO [{META_TABLE}] ([キー],[値]) VALUES (?,?)',
                    ['master_updated_at', datetime.now().isoformat()])
        c.commit()
    with _lock:
        _state['revision'] = nxt
    return nxt


# ---- ロック（作業予定と同じ二段構え: ロックが一次、改訂番号が二次） -------
def _lock_path():
    src = source_path()
    return src.parent / LOCK_FILENAME if src else None


def _read_lock():
    p = _lock_path()
    if p is None:
        return None
    try:
        if not p.exists():
            return None
        data = json.loads(p.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _expired(lock):
    if not lock or not lock.get('expires_at'):
        return True
    try:
        return datetime.fromisoformat(lock['expires_at']) <= datetime.now()
    except Exception:
        return True


def lock_status():
    lock = _read_lock()
    if lock is None or _expired(lock):
        return {'locked': False}
    return {'locked': True, 'holderLogin': lock.get('holder_login', ''),
            'holderPc': lock.get('holder_pc', ''), 'expiresAt': lock.get('expires_at')}


def _verify_delay_sec():
    src = source_path()
    try:
        if src is not None and paths.cloud_sync_hint(Path(src)):
            return LOCK_VERIFY_DELAY_CLOUD_SEC
    except Exception:
        pass
    return LOCK_VERIFY_DELAY_NETWORK_SEC


def writes_master(blueprint, method, endpoint=''):
    """このリクエストはマスタを書きうるか。**共有でなければ常にFalse**。"""
    if not is_shared():
        return False
    if str(method or '').upper() == 'GET':
        return False
    if str(endpoint or '') in NON_MASTER_ENDPOINTS:
        return False
    return str(blueprint or '') in WRITING_BLUEPRINTS


def acquire_lock(login_id='', pc_name='', ttl_sec=None):
    p = _lock_path()
    if p is None:
        raise MasterShareUnavailable('共有マスタの置き場が決まっていません。')
    ttl = LOCK_TTL_SEC_DEFAULT if ttl_sec is None else ttl_sec
    cur = _read_lock()
    if cur and not _expired(cur):
        remaining = 1
        try:
            remaining = max(1, int((datetime.fromisoformat(cur['expires_at']) - datetime.now()).total_seconds()))
        except Exception:
            pass
        raise MasterLockHeld(cur.get('holder_login', ''), cur.get('holder_pc', ''), remaining)
    token = uuid.uuid4().hex
    now = datetime.now()
    payload = {'token': token, 'holder_login': login_id, 'holder_pc': pc_name,
               'acquired_at': now.isoformat(),
               'expires_at': (now + timedelta(seconds=ttl)).isoformat()}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    # 読み直して確かめる。**クラウド同期では完全な排他は原理的に作れない**
    # ので、ここは一次防御にすぎない（最後は改訂番号が弾く）。
    delay = _verify_delay_sec()
    if delay > 0:
        time.sleep(delay)
    check = _read_lock()
    if not check or check.get('token') != token:
        raise MasterLockHeld((check or {}).get('holder_login', ''),
                             (check or {}).get('holder_pc', ''), 5)
    return token


def release_lock(token):
    if not token:
        return
    p = _lock_path()
    if p is None:
        return
    cur = _read_lock()
    if cur and cur.get('token') == token:
        if not atomic_io.unlink(p, label='master.lock'):
            app_logger().warning('マスタのロックを解放できませんでした（TTLで自動的に切れます）: %s', p)


# ---- 取り込み / 押し出し -------------------------------------------------
def _verify(path):
    from .db_access import connect
    try:
        with connect(path, True) as c:
            row = c.cursor().execute('PRAGMA integrity_check').fetchone()
            return bool(row) and str(row[0]).lower() == 'ok'
    except Exception:
        return False


def _pull(force=False):
    """共有 → 手元の写し。**改訂番号が変わっていなければ写さない**
    （§9.188と同じ考え方。読むたびに共有を掴まない）。"""
    src, mirror = source_path(), local_path()
    if not is_shared() or src is None or mirror is None:
        return False
    if not force:
        try:
            if _read_revision(src) == _read_revision(mirror):
                return False
        except Exception:
            pass
    mirror.parent.mkdir(parents=True, exist_ok=True)
    if not src.exists():
        # 共有にまだ無い（初回）。**手元の写しをそのまま正とする**——
        # 次の書込で共有へ出る。
        return False
    tmp = mirror.with_suffix(f'.pull.{uuid.uuid4().hex}.tmp')
    from .db_access import connect
    try:
        s = connect(src, True)
        try:
            d = connect(tmp, False)
            try:
                s.backup(d)
            finally:
                d.close()
        finally:
            s.close()
        if not _verify(tmp):
            raise MasterShareUnavailable('取り込んだマスタが壊れていました（整合性チェック失敗）。')
        atomic_io.replace(tmp, mirror, label='master.mirror')
        with _lock:
            _state['revision'] = _read_revision(mirror)
        return True
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


def _push():
    """手元の写し → 共有（丸ごと置換）。"""
    src, mirror = source_path(), local_path()
    if not is_shared() or src is None or mirror is None:
        return False
    src.parent.mkdir(parents=True, exist_ok=True)
    tmp = src.with_suffix(f'.push.{uuid.uuid4().hex}.tmp')
    from .db_access import connect
    try:
        s = connect(mirror, True)
        try:
            d = connect(tmp, False)
            try:
                s.backup(d)
            finally:
                d.close()
        finally:
            s.close()
        if not _verify(tmp):
            raise MasterShareUnavailable('書き出すマスタが壊れていました（整合性チェック失敗）。')
        atomic_io.replace(tmp, src, label='master.share')
        return True
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass


def refresh(force=False):
    """読む前に呼ぶ。共有でなければ何もしない。**失敗しても投げない**
    ——読みは前の写しで続けられることが最優先（§9.89）。"""
    if not is_shared():
        return False
    try:
        return _pull(force=force)
    except Exception as e:
        app_logger().warning('共有マスタの取り込みに失敗しました（写しで続けます）: %s', e)
        return False


def signature():
    """写しの署名（更新時刻＋大きさ）。書込の前後で比べて
    「本当に変わったか」を見る。"""
    p = local_path()
    try:
        st = p.stat()
        return (st.st_mtime_ns, st.st_size)
    except Exception:
        return None


class _Cycle:
    """1回ぶんの書込サイクル。`begin()` で掴み、`end(changed)` で返す。"""

    def __init__(self, login_id='', pc_name=''):
        self.login = login_id
        self.pc = pc_name
        self.token = None
        self.sig = None

    def begin(self):
        _write_lock.acquire()
        try:
            self.token = acquire_lock(self.login, self.pc)
            # **当てる前に取り直す**——間隔を信用して書くと、そのあいだに
            # 他端末が書いた変更を踏み潰す（§9.188の「書込は必ずforce」）。
            _pull(force=True)
            self.sig = signature()
        except Exception:
            self._unwind()
            raise
        return self

    def end(self, uid=''):
        try:
            if self.sig is not None and signature() == self.sig:
                return False        # 何も変わっていない＝押し出さない
            _bump_revision(local_path(), uid)
            _push()
            return True
        finally:
            self._unwind()

    def _unwind(self):
        try:
            release_lock(self.token)
        finally:
            self.token = None
            try:
                _write_lock.release()
            except RuntimeError:
                pass


def begin_write(login_id='', pc_name=''):
    """共有でなければ None。呼び出し側は None を「何もしなくてよい」と読む。"""
    if not is_shared():
        return None
    return _Cycle(login_id, pc_name).begin()
