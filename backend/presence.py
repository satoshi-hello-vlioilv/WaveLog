"""presence.py: 誰がいま繋いでいるかを見える化し、切断できるようにする（§9.272）。

============================================================
なぜ要るか
------------------------------------------------------------
作業予定は**設備ごとの編集セッション**（§9.211 ②）を持ち、誰が編集中かが
画面に出て、必要なら奪える。マスタ側はそこが空いていた——書込サイクル
（§9.263）が**ファイルの壊れ方**は塞いでいるが、それは1リクエストぶんの
直列化であって、**人と人の衝突**は見えないままだった。2人が同じマスタを
開いて別々に直せば、後から保存したほうが黙って勝つ。

ここで足すのは「**誰が居るか**」と「**出てもらう**」の2つだけ。

置き方
------------------------------------------------------------
**端末ごとに1ファイル**（`presence/<端末キー>.json`）。1つのファイルを書くのは
いつも1台だけ、が**構造として**成り立つ（§9.258で測定データに対してやったのと
同じ理由）。全端末が1つのJSONを取り合う形にすると、在席を書くこと自体が
共有への競合になり、**競合を減らすために作った仕組みが競合を増やす**。

  <共有>\\presence\\
  ├─ <端末キー>.json          … その端末だけが書く（在席）
  └─ <端末キー>.revoke.json   … 切断の指示（管理する側が書き、対象が読む）

切断の意味
------------------------------------------------------------
別のPCのプロセスを外から殺すことはできないし、やるべきでもない
（書きかけの測定が消える）。**切断＝その端末を閲覧モードへ落とし、理由を
画面に出す**こと。書き込みは止まるが、開いている画面は消えない。

**冷却時間つき**（既定5分）。すぐ繋ぎ直せるなら切断の意味が無く、恒久的に
締め出すと**間違えたときに直せない**。時間で自然に解けるようにしてある。
============================================================
"""
from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime
from pathlib import Path

from . import atomic_io, paths
from .logging_setup import app_logger

DIR_NAME = 'presence'
SUFFIX = '.json'
REVOKE_SUFFIX = '.revoke.json'

# 在席とみなす時間。ハートビートは15秒間隔なので、数回落としても消えない長さ。
TTL_SEC = 75
# 自分の在席を書き直す間隔。毎ハートビート（15秒）で共有へ書くと往復が増える。
WRITE_INTERVAL_SEC = 20
# 切断されたあと、繋ぎ直せるようになるまで。
REVOKE_COOLDOWN_SEC = 300
# 期限切れの在席ファイルを片付ける間隔。
SWEEP_INTERVAL_SEC = 300

_BAD_CHARS = set('<>:"/\\|?*')

_lock = threading.Lock()
_state = {'wrote_at': 0.0, 'swept_at': 0.0, 'revoked': None, 'revoked_at': 0.0}


# ---- 置き場 --------------------------------------------------------------
def presence_dir():
    """在席ファイルの置き場。→ (Path, どこから決まったか)

    **共有に置くのが本来の姿**（他の端末から見えないと意味が無い）。
    共有のマスタ・作業予定のどちらも無い端末では、**この端末だけ**が見える
    手元の置き場へ落とす——見えないことを黙るのではなく、そう名乗る。
    """
    try:
        from . import master_share
        if master_share.is_shared():
            src = master_share.source_path()
            if src is not None:
                return Path(src).parent / DIR_NAME, 'master'
    except Exception:
        pass
    try:
        from .db_access import SCHEDULE_SHARE_PATH
        if SCHEDULE_SHARE_PATH:
            return Path(SCHEDULE_SHARE_PATH).parent / DIR_NAME, 'schedule'
    except Exception:
        pass
    return paths.work_dir() / DIR_NAME, 'local'


def shared():
    """在席が他の端末から見えるか。"""
    return presence_dir()[1] != 'local'


# ---- 端末キー ------------------------------------------------------------
def terminal_key(login_id, pc_name):
    """(ログインID, PC名) -> ファイル名に使える1つの鍵。

    **落とすだけにしないこと**（§9.258の`records_dir_name`と同じ罠）——
    使えない文字を`_`へ潰すだけだと、別の人が同じファイルを書く形が作れる。
    落としたときだけ短い識別子を足す。
    """
    ident = f"{str(pc_name or '').strip()}@{str(login_id or '').strip()}"
    safe = ''.join(('_' if (ch in _BAD_CHARS or ord(ch) < 32) else ch) for ch in ident)
    safe = safe.rstrip(' .')
    if safe != ident or not safe:
        safe = (safe or 'x') + '-' + hashlib.sha1(ident.encode('utf-8')).hexdigest()[:6]
    return safe[:120]


def _entry_path(key):
    return presence_dir()[0] / f'{key}{SUFFIX}'


def _revoke_path(key):
    return presence_dir()[0] / f'{key}{REVOKE_SUFFIX}'


# ---- 読み書き ------------------------------------------------------------
def _read_json(path):
    try:
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _write_json(path, payload):
    """一時ファイル→置き換え。**自分のファイルしか書かない**ので、
    置き換え先を他の端末が掴んでいることは無い（読むだけの相手は掴まない）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f'.{int(time.time()*1000)%100000}.tmp')
    try:
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        atomic_io.replace(tmp, path, label='presence')
        return True
    except Exception as e:
        app_logger().warning('在席を書けませんでした: %s (%s)', path, e)
        atomic_io.unlink(tmp, budget_sec=0.5, label='presence.tmp')
        return False


def _age_sec(entry):
    try:
        return max(0.0, (datetime.now() - datetime.fromisoformat(entry['at'])).total_seconds())
    except Exception:
        return None


def touch(login_id, pc_name, mode='', role='', view='', force=False):
    """自分の在席を書く。ハートビートから呼ぶ。

    **間隔を空ける**（既定20秒）——15秒ごとに共有へ書くと、在席を出すこと
    自体が共有への往復になる。`force=True`は画面を切り替えた直後など、
    すぐ反映したいときだけ。
    """
    now = time.time()
    with _lock:
        if not force and (now - _state['wrote_at']) < WRITE_INTERVAL_SEC:
            return False
        _state['wrote_at'] = now
    key = terminal_key(login_id, pc_name)
    payload = {'key': key, 'login': str(login_id or ''), 'pc': str(pc_name or ''),
               'mode': str(mode or ''), 'role': str(role or ''), 'view': str(view or ''),
               'at': datetime.now().isoformat()}
    ok = _write_json(_entry_path(key), payload)
    _sweep()
    return ok


_writer = {'busy': False}


def touch_async(login_id, pc_name, mode='', role='', view=''):
    """在席を**裏で**書く。ハートビートはこれを呼ぶ。

    共有が遅いときに、在席を書くことがハートビートを待たせては本末転倒
    （ハートビートはアプリの生存そのものを支えている・§9.98）。
    **同時に1本だけ**走らせ、走っている間の依頼は捨てる（次の15秒後に来る）。
    """
    now = time.time()
    with _lock:
        if _writer['busy'] or (now - _state['wrote_at']) < WRITE_INTERVAL_SEC:
            return False
        _writer['busy'] = True

    def run():
        try:
            touch(login_id, pc_name, mode, role, view, force=True)
        except Exception as e:
            app_logger().debug('在席を書けませんでした: %s', e)
        finally:
            with _lock:
                _writer['busy'] = False
    threading.Thread(target=run, name='presence', daemon=True).start()
    return True


def leave(login_id, pc_name):
    """自分の在席を消す（タブを閉じたとき）。消せなくてもTTLで消える。"""
    atomic_io.unlink(_entry_path(terminal_key(login_id, pc_name)),
                     budget_sec=0.5, label='presence.leave')


def _sweep():
    """期限切れの在席・冷却の切れた切断指示を片付ける。**失敗しても続ける**
    （片付けは目的ではないので、消せないことで在席が出せなくなっては困る）。"""
    now = time.time()
    with _lock:
        if (now - _state['swept_at']) < SWEEP_INTERVAL_SEC:
            return
        _state['swept_at'] = now
    d, _ = presence_dir()
    try:
        names = list(d.glob('*' + SUFFIX))
    except Exception:
        return
    for p in names:
        entry = _read_json(p)
        age = _age_sec(entry) if entry else None
        limit = REVOKE_COOLDOWN_SEC if p.name.endswith(REVOKE_SUFFIX) else TTL_SEC
        # **読めなかったものは消さない**（書いている最中かもしれない）。
        if age is not None and age > limit * 4:
            atomic_io.unlink(p, budget_sec=0.5, label='presence.sweep')


def entries():
    """いま繋いでいる端末の一覧（新しい順）。

    **読めなかったことを「誰も居ない」と言わない**——呼び出し側が
    区別できるよう、置き場が読めなければ例外ではなくNoneを返す。
    """
    d, _ = presence_dir()
    try:
        names = sorted(d.glob('*' + SUFFIX))
    except Exception:
        return None
    out = []
    for p in names:
        if p.name.endswith(REVOKE_SUFFIX):
            continue
        entry = _read_json(p)
        if not entry:
            continue
        age = _age_sec(entry)
        if age is None or age > TTL_SEC:
            continue
        rev = revocation(entry.get('key') or p.stem)
        out.append({'key': entry.get('key') or p.stem,
                    'login': str(entry.get('login') or ''),
                    'pc': str(entry.get('pc') or ''),
                    'mode': str(entry.get('mode') or ''),
                    'role': str(entry.get('role') or ''),
                    'view': str(entry.get('view') or ''),
                    'at': str(entry.get('at') or ''),
                    'idleSec': int(age),
                    'revoked': rev})
    out.sort(key=lambda x: x['at'], reverse=True)
    return out


# ---- 切断 ----------------------------------------------------------------
def revocation(key):
    """その端末に効いている切断の指示（無ければNone）。冷却が切れたら効かない。"""
    data = _read_json(_revoke_path(key))
    if not data:
        return None
    age = _age_sec(data)
    if age is None or age > REVOKE_COOLDOWN_SEC:
        return None
    return {'by': str(data.get('by') or ''), 'byPc': str(data.get('byPc') or ''),
            'reason': str(data.get('reason') or ''), 'at': str(data.get('at') or ''),
            'remainingSec': max(0, int(REVOKE_COOLDOWN_SEC - age))}


def disconnect(key, by_login='', by_pc='', reason=''):
    """対象の端末を切断する。**権限の判定はここではしない**（呼ぶ側＝ルートが
    `master_repo.role_can()`の1箇所で判定する）。"""
    payload = {'key': str(key), 'by': str(by_login or ''), 'byPc': str(by_pc or ''),
               'reason': str(reason or '')[:200], 'at': datetime.now().isoformat()}
    return _write_json(_revoke_path(str(key)), payload)


def clear_revocation(key):
    """切断を解く（本人の再接続・管理する側の取り消し、どちらも同じ）。"""
    atomic_io.unlink(_revoke_path(str(key)), budget_sec=0.5, label='presence.revoke.clear')


def my_revocation(login_id, pc_name):
    return revocation(terminal_key(login_id, pc_name))
