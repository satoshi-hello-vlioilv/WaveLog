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

接続の記録（§9.513、利用者の指示「接続ユーザー、接続PC、接続時刻、接続時間、
接続したアプリのVER情報、ユーザー別累計接続回数などわかるように」「ユーザーが
古いバージョンで使用していないか、誰に新しいバージョンファイルを配布すれば
よいか判断する」）
------------------------------------------------------------
在席（上）は**いま**しか持たない（TTLの4倍で消える）。版の配布を決めるには
「**しばらく繋いでいない端末が、どの版のまま止まっているか**」が要るので、
端末ごとに**消えない記録**を1つ持つ。書くのは在席と同じく**その端末だけ**。

  <共有>\\presence\\history\\<端末キー>.json
     … 版・最初と最後に使った時刻・累計の接続回数と接続時間・使った版の履歴

**運用中の最新版は記録の中の最大の版**（`fleet_summary()`の1箇所）——
配布した版がどこまで届いているかを、この一覧だけで言えるようにする。

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
import re
import threading
import time
from datetime import datetime
from pathlib import Path

from . import atomic_io, paths
from .changelog_data import APP_VERSION
from .logging_setup import app_logger
from .quiet import quiet

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
# 接続の記録（§9.513）。在席の隣のフォルダに端末ごと1ファイル。
HISTORY_DIR = 'history'
# 記録を書き直す間隔。在席（20秒）より長くてよい——接続の始まり・終わりは
# その場で書くので、ここで遅れるのは累計の接続時間だけ（最大この秒数）。
HISTORY_WRITE_SEC = 60
# 1つの記録に残す「使った版」の数（新しい順）。
HISTORY_VERSIONS = 10
# この版から版と記録を書く。これより前の版の端末は**版が空**で届く（画面は
# 「VER2.400.0より前」と言い、最新ではないと数える）。
HISTORY_SINCE = '2.400.0'

_BAD_CHARS = set('<>:"/\\|?*')

_lock = threading.Lock()
_state = {'wrote_at': 0.0, 'swept_at': 0.0, 'revoked': None, 'revoked_at': 0.0}
# このプロセスのいまの接続（§9.513）。**TTLより長く途切れたら新しい接続**
# として数える（タブを閉じて開き直した・PCが眠っていた）。
_session = {'key': '', 'since': '', 'last': 0.0}
_hist = {'key': '', 'data': None, 'wrote': 0.0}


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
    except Exception as _e:
        quiet('マスタ側の共有の置き場を引けない（次の候補を試す）',_e)
    try:
        from .db_access import SCHEDULE_SHARE_PATH
        if SCHEDULE_SHARE_PATH:
            return Path(SCHEDULE_SHARE_PATH).parent / DIR_NAME, 'schedule'
    except Exception as _e:
        quiet('作業予定側の共有の置き場を引けない（次の候補を試す）',_e)
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
    except Exception as _e:
        quiet('保存された値を読めない（既定で続ける）',_e)
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
    except Exception as _e:
        quiet('日時として読めない（無いものとして続ける）',_e)
        return None


# ---- 版 --------------------------------------------------------------------
def app_version():
    """この端末で動いているアプリの版。"""
    return str(APP_VERSION or '')


def version_key(v):
    """版の並べ方（`2.10.0` > `2.9.3`。文字の順で比べない）。空は最も古い。"""
    return tuple(int(x) for x in re.findall(r'\d+', str(v or '')))


# ---- 接続の記録（§9.513） ---------------------------------------------------
def _history_path(key):
    return presence_dir()[0] / HISTORY_DIR / f'{key}{SUFFIX}'


def _record(key, login_id, pc_name, version, now, new_session, final=False):
    """自分の記録を1つ進める。**書くのはこの端末だけ**（在席と同じ理由）。

    `new_session`＝接続の始まり（回数を1つ足してその場で書く）。それ以外は
    前回からの経過を累計の接続時間へ足す（**TTLで頭打ち**——途切れていた
    あいだを接続時間に数えない）。"""
    iso = datetime.fromtimestamp(now).isoformat(timespec='seconds')
    with _lock:
        if _hist['key'] != key or _hist['data'] is None:
            _hist['key'] = key
            _hist['data'] = _read_json(_history_path(key)) or {}
            _hist['wrote'] = 0.0
        h = _hist['data']
        h.setdefault('firstAt', iso)
        h['key'] = key
        h['login'] = str(login_id or '')
        h['pc'] = str(pc_name or '')
        if new_session:
            h['sessions'] = int(h.get('sessions') or 0) + 1
            h['sessionAt'] = iso
        else:
            gap = max(0.0, now - float(_session.get('prev') or now))
            h['totalSec'] = int(h.get('totalSec') or 0) + int(min(gap, TTL_SEC))
        h.setdefault('sessions', 1)
        h.setdefault('totalSec', 0)
        h['lastAt'] = iso
        if version:
            h['version'] = version
            vers = dict(h.get('versions') or {})
            vers[version] = iso
            keep = sorted(vers.items(), key=lambda kv: kv[1], reverse=True)[:HISTORY_VERSIONS]
            h['versions'] = dict(keep)
        due = new_session or final or (now - _hist['wrote']) >= HISTORY_WRITE_SEC
        if due:
            _hist['wrote'] = now
        snapshot = dict(h)
    if due:
        _write_json(_history_path(key), snapshot)


def history_entries():
    """これまでに繋いだ端末の記録（読めなければNone）。"""
    d = presence_dir()[0] / HISTORY_DIR
    try:
        if not d.exists():
            return []
        names = sorted(d.glob('*' + SUFFIX))
    except Exception as _e:
        quiet('接続の記録を辿れない（読めなかったので「記録が無い」とは言わない）',_e)
        return None
    out = []
    for p in names:
        h = _read_json(p)
        if not h:
            continue
        out.append({'key': str(h.get('key') or p.stem), 'login': str(h.get('login') or ''),
                    'pc': str(h.get('pc') or ''), 'version': str(h.get('version') or ''),
                    'firstAt': str(h.get('firstAt') or ''), 'lastAt': str(h.get('lastAt') or ''),
                    'sessionAt': str(h.get('sessionAt') or ''),
                    'sessions': int(h.get('sessions') or 0), 'totalSec': int(h.get('totalSec') or 0),
                    'versions': dict(h.get('versions') or {})})
    return out


def forget_history(key):
    """使わなくなった端末の記録を消す（§9.513）。権限の判定はルートがする。"""
    return atomic_io.unlink(_history_path(str(key)), budget_sec=0.5, label='presence.history.forget')


def fleet_summary(online, history, my_version):
    """接続中と記録を合わせて「版の配布」の答えを作る。**ここ1箇所**（§9.163）。

    ・運用中の最新版＝**見えているすべての版の最大**（この端末の版も含む）
    ・版が空＝**記録を書かない古い版**（§9.513より前）なので、最新ではないと数える
    ・利用者ごと＝ログインIDでまとめる（1人が複数のPCを使うことがある）
    """
    online = list(online or [])
    history = list(history or [])
    seen = [my_version] + [h.get('version') for h in history] + [o.get('version') for o in online]
    latest = max((v for v in seen if v), key=version_key, default='')
    lk = version_key(latest)
    by = {h['key']: dict(h, online=False) for h in history}
    for o in online:
        t = by.setdefault(o['key'], {'key': o['key'], 'login': o.get('login', ''), 'pc': o.get('pc', ''),
                                     'version': '', 'firstAt': '', 'lastAt': o.get('at', ''),
                                     'sessionAt': o.get('since', ''), 'sessions': 0, 'totalSec': 0,
                                     'versions': {}})
        t['online'] = True
        # いま動いている版は在席のほうが新しい（記録は最大60秒遅れる）
        if o.get('version'):
            t['version'] = o['version']
    terms = []
    for t in by.values():
        t['outdated'] = bool(latest) and version_key(t.get('version')) < lk
        terms.append(t)
    # **古い版が先**・その中は最後に使った順（配る相手から読めるように）
    terms.sort(key=lambda t: t.get('lastAt') or '', reverse=True)
    terms.sort(key=lambda t: not t['outdated'])
    users = {}
    for t in terms:
        u = users.setdefault(t.get('login') or '', {'login': t.get('login') or '', 'terminals': 0, 'pcs': [],
                                                    'sessions': 0, 'totalSec': 0, 'lastAt': '',
                                                    'versions': [], 'online': False, 'outdated': False})
        u['terminals'] += 1
        u['pcs'].append(t.get('pc') or '')
        u['sessions'] += int(t.get('sessions') or 0)
        u['totalSec'] += int(t.get('totalSec') or 0)
        u['lastAt'] = max(u['lastAt'], t.get('lastAt') or '')
        v = t.get('version') or ''
        if v not in u['versions']:
            u['versions'].append(v)
        u['online'] = u['online'] or bool(t.get('online'))
        u['outdated'] = u['outdated'] or bool(t.get('outdated'))
    ul = sorted(users.values(), key=lambda u: u['lastAt'], reverse=True)
    ul.sort(key=lambda u: not u['outdated'])
    for u in ul:
        u['versions'].sort(key=version_key, reverse=True)
    return {'latestVersion': latest, 'myVersion': my_version, 'recordingSince': HISTORY_SINCE,
            'terminals': terms, 'users': ul,
            'counts': {'terminals': len(terms), 'users': len(ul),
                       'online': sum(1 for t in terms if t.get('online')),
                       'outdated': sum(1 for t in terms if t['outdated']),
                       'outdatedOnline': sum(1 for t in terms if t['outdated'] and t.get('online'))}}


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
    with _lock:
        # **TTLより長く途切れたら新しい接続**（§9.513）。
        new_session = _session['key'] != key or (now - _session['last']) > TTL_SEC
        if new_session:
            _session['key'] = key
            _session['since'] = datetime.fromtimestamp(now).isoformat(timespec='seconds')
        _session['prev'] = _session['last'] if not new_session else now
        _session['last'] = now
        since = _session['since']
    version = app_version()
    payload = {'key': key, 'login': str(login_id or ''), 'pc': str(pc_name or ''),
               'mode': str(mode or ''), 'role': str(role or ''), 'view': str(view or ''),
               'version': version, 'since': since,
               'at': datetime.now().isoformat()}
    ok = _write_json(_entry_path(key), payload)
    try:
        _record(key, login_id, pc_name, version, now, new_session)
    except Exception as e:
        # 記録が書けなくても在席は出す（記録は運用のための副産物）
        app_logger().warning('接続の記録を書けませんでした: %s', e)
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
    """自分の在席を消す（タブを閉じたとき）。消せなくてもTTLで消える。

    接続の記録には**終わりまでの接続時間**を書き足し、次に繋いだときは
    新しい接続として数える（§9.513）。"""
    key = terminal_key(login_id, pc_name)
    atomic_io.unlink(_entry_path(key), budget_sec=0.5, label='presence.leave')
    now = time.time()
    with _lock:
        mine = _session['key'] == key and _session['last'] > 0
        if mine:
            _session['prev'] = _session['last']
            _session['last'] = now
    if mine:
        try:
            _record(key, login_id, pc_name, app_version(), now, False, final=True)
        except Exception as e:
            app_logger().warning('接続の記録を書けませんでした: %s', e)
        with _lock:
            _session['key'] = ''


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
    except Exception as _e:
        quiet('在席ファイルの一覧を辿れない（掃除は次の機会に）',_e)
        return
    for p in names:
        entry = _read_json(p)
        age = _age_sec(entry) if entry else None
        limit = REVOKE_COOLDOWN_SEC if p.name.endswith(REVOKE_SUFFIX) else TTL_SEC
        # **読めなかったものは消さない**（書いている最中かもしれない）。
        if age is not None and age > limit * 4:
            atomic_io.unlink(p, budget_sec=0.5, label='presence.sweep')


def _since_sec(since):
    if not since:
        return None
    try:
        return max(0, int((datetime.now() - datetime.fromisoformat(str(since))).total_seconds()))
    except Exception as _e:
        quiet('接続した時刻を読めない（接続時間は出さない）',_e)
        return None


def entries():
    """いま繋いでいる端末の一覧（新しい順）。

    **読めなかったことを「誰も居ない」と言わない**——呼び出し側が
    区別できるよう、置き場が読めなければ例外ではなくNoneを返す。
    """
    d, _ = presence_dir()
    try:
        names = sorted(d.glob('*' + SUFFIX))
    except Exception as _e:
        quiet('在席ファイルの一覧を辿れない（読めなかったので「誰も居ない」とは言わない）',_e)
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
                    # 版と接続した時刻（§9.513）。**古い版は書かない**ので空のまま運ぶ
                    'version': str(entry.get('version') or ''),
                    'since': str(entry.get('since') or ''),
                    'durationSec': _since_sec(entry.get('since')),
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
