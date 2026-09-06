#!/usr/bin/env python3
"""test_presence.py: 誰が繋いでいるかを見せ、切断する（§9.272）。

============================================================
なぜ要るか
------------------------------------------------------------
作業予定は**設備ごとの編集セッション**（§9.211 ②）を持っていたが、マスタ側は
「誰が触っているか」がまったく見えなかった。書込サイクル（§9.263）が塞いで
いるのは**ファイルの壊れ方**で、**人と人の衝突**は別の話。

ここで固定するのは次の8つ。
 1. 権限区分の可否を**答えるのは`role_can()`の1箇所**（区分そのものは
    §9.322で4つになった。この網が見るのは切断まわりの3区分）
 2. **既定は一般ユーザー**（登録の無い端末に管理の権限を配らない）
 3. 端末キーは**別の端末どうしがぶつからない**（落とすだけにしない）
 4. 在席は**端末ごとに1ファイル**（1つのファイルを書くのはいつも1台）
 5. 期限切れは一覧から消える／**読めなかったことを「誰も居ない」と言わない**
 6. 切断されたら**書き込みだけ**が止まる（**読みは止まらない**）
 7. メンテナンス者は**開発者を切断できない**／一般ユーザーは切断できない
 8. 断る理由を言い分ける（権限が無い／相手が上位／もう居ない）
============================================================
"""
import json, pathlib, shutil, sys, tempfile
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import presence  # noqa: E402
from backend import access_mode as am  # noqa: E402
from backend.repositories import master_repo as mr  # noqa: E402
from backend.routes import presence as pr  # noqa: E402

R = []
def rec(n, ok, d=''):
    R.append((n, ok, d))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(d) if d else ''))


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-presence-'))
box = tmp / 'presence'
# **差し替えるのはルート側の名前**。`backend/routes/presence.py` は
# `from ..access_mode import current_permission_flags` で**名前を束縛して
# いる**ので、`access_mode`側だけ差し替えても効かない（最初にそう書いて、
# 網が「一般ユーザーのまま」で通ってしまった）。
_orig = (presence.presence_dir, pr._registered_role, pr.current_permission_flags,
         pr.current_login_id, pr.current_pc_name)
_role = {'me': mr.ROLE_USER, 'targets': {}}


def write_entry(key, login, pc, at=None, view='', mode='edit'):
    box.mkdir(parents=True, exist_ok=True)
    (box / f'{key}.json').write_text(json.dumps(
        {'key': key, 'login': login, 'pc': pc, 'mode': mode, 'view': view,
         'at': (at or datetime.now()).isoformat()}, ensure_ascii=False), encoding='utf-8')


try:
    presence.presence_dir = lambda: (box, 'master')
    pr._registered_role = lambda login, pc: _role['targets'].get(f'{pc}@{login}', mr.ROLE_USER)
    pr.current_permission_flags = lambda: {'canEdit': True, 'canSchedule': False,
                                           'canFieldReorder': False, 'fieldReorderEquipment': '',
                                           'role': _role['me']}
    pr.current_login_id = lambda: 'me'
    pr.current_pc_name = lambda: 'PC-ME'
    am.current_login_id = lambda: 'me'
    am.current_pc_name = lambda: 'PC-ME'

    # ---- 1. 切断の可否。答えるのは role_can の1箇所 ---------------------
    D, M, U = mr.ROLE_DEVELOPER, mr.ROLE_MAINTAINER, mr.ROLE_USER
    rec('開発者・メンテナンス者・一般ユーザーは接続状況を見られる（利用者の指示）',
        all(mr.role_can(r, 'presence:view') for r in (D, M, U)))
    rec('開発者は制限なし', mr.role_can(D, 'presence:disconnect', D)
        and mr.role_can(D, 'presence:disconnect', M) and mr.role_can(D, 'presence:disconnect', U))
    rec('メンテナンス者は開発者を切断できない', mr.role_can(M, 'presence:disconnect', U)
        and not mr.role_can(M, 'presence:disconnect', D))
    rec('一般ユーザーは切断できない', not mr.role_can(U, 'presence:disconnect', U))
    rec('知らない行為はできない扱い', not mr.role_can(D, 'presence:shutdown'))

    # ---- 2. 既定は一般ユーザー ------------------------------------------
    rec('空欄は一般ユーザー', mr.normalize_role('') == U)
    rec('知らない綴りも一般ユーザー', mr.normalize_role('管理者') == U, mr.normalize_role('管理者'))
    rec('登録の無い端末の既定も一般ユーザー', mr._DEFAULT_PERMISSION_FLAGS['role'] == U,
        mr._DEFAULT_PERMISSION_FLAGS['role'])
    # **編集可否の既定（可）へ揃えないこと**——触れる範囲が広がる側は安全側。
    rec('編集可否の既定とは別（そちらは互換のため「可」）',
        mr._DEFAULT_PERMISSION_FLAGS['canEdit'] is True)

    # ---- 3. 端末キーはぶつからない --------------------------------------
    rec('ふつうの名前はそのまま', presence.terminal_key('u1', 'PC-A') == 'PC-A@u1',
        presence.terminal_key('u1', 'PC-A'))
    a, b = presence.terminal_key('a/b', 'P'), presence.terminal_key('a:b', 'P')
    rec('使えない文字を潰しても別の端末は別の鍵', a != b, f'{a} / {b}')
    rec('使えない文字はファイル名に残らない',
        not (set(a) & presence._BAD_CHARS), a)

    # ---- 4/5. 在席は端末ごとに1ファイル ---------------------------------
    write_entry('PC-A@u1', 'u1', 'PC-A', view='master')
    write_entry('PC-B@u2', 'u2', 'PC-B', view='schedule')
    got = presence.entries()
    rec('在席が2件出る', got is not None and len(got) == 2, str(got and len(got)))
    rec('端末ごとに1ファイル（書き手は常に1台）',
        sorted(p.name for p in box.glob('*.json')) == ['PC-A@u1.json', 'PC-B@u2.json'],
        str(sorted(p.name for p in box.glob('*.json'))))
    # 期限切れ（TTLより古い）は一覧に出ない。**ファイルは消さない**（次の
    # ハートビートで戻るかもしれない）。
    write_entry('PC-C@u3', 'u3', 'PC-C', at=datetime.now() - timedelta(seconds=presence.TTL_SEC + 30))
    got = presence.entries()
    rec('期限切れの在席は出ない', [x['key'] for x in got] == ['PC-B@u2', 'PC-A@u1']
        or sorted(x['key'] for x in got) == ['PC-A@u1', 'PC-B@u2'],
        str([x['key'] for x in got]))
    rec('開いている画面も運ばれる',
        {x['key']: x['view'] for x in got}.get('PC-A@u1') == 'master')
    # **読めなかったことを「誰も居ない」と言わない**（§9.107）。
    presence.presence_dir = lambda: (tmp / 'nowhere' / 'x' / 'y', 'master')
    unreadable = presence.entries()
    presence.presence_dir = lambda: (box, 'master')
    rec('置き場が無いときは空リストで、例外にしない', unreadable == [] or unreadable is None,
        str(unreadable))

    # ---- 6/7/8. 切断 -----------------------------------------------------
    import app as appmod
    c = appmod.app.test_client()

    _role['me'] = U
    r = c.post('/api/presence/disconnect', json={'key': 'PC-A@u1'})
    rec('一般ユーザーは断られる（403）', r.status_code == 403, str(r.status_code))
    msg = r.get_json().get('error') or ''
    # **「開発者」の字は両方の文言に出る**ので、substringだけで見ないこと
    # （最初そう書いて、まったく別の理由の403でも通っていた）。
    rec('理由は「権限が無い」と言う', 'だけができます' in msg and U in msg, msg[:60])

    _role['me'] = M
    _role['targets']['PC-A@u1'] = D
    r = c.post('/api/presence/disconnect', json={'key': 'PC-A@u1'})
    rec('メンテナンス者は開発者を切断できない（403）', r.status_code == 403, str(r.status_code))
    msg = r.get_json().get('error') or ''
    rec('理由は「相手が上位だから」と言う（権限が無い、ではない）',
        'は切断できません' in msg and D in msg and 'だけができます' not in msg, msg[:60])

    _role['targets']['PC-A@u1'] = U
    r = c.post('/api/presence/disconnect', json={'key': 'PC-A@u1', 'reason': '保守のため'})
    rec('メンテナンス者は一般ユーザーを切断できる', r.status_code == 200, str(r.status_code))
    rev = presence.revocation('PC-A@u1')
    rec('切断の指示が残る', bool(rev) and rev['by'] == 'me', str(rev))
    rec('理由も運ばれる（相手の画面に出す）', (rev or {}).get('reason') == '保守のため')

    # **居ない相手と、権限が無いのを言い分ける**（§4）。
    r = c.post('/api/presence/disconnect', json={'key': 'PC-ZZ@nobody'})
    rec('もう居ない相手は409で「接続していません」', r.status_code == 409, str(r.status_code))
    r = c.post('/api/presence/disconnect', json={'key': presence.terminal_key('me', 'PC-ME')})
    rec('自分自身は切断できない', r.status_code == 400, str(r.status_code))

    # **自己申告の区分を信じない**——在席ファイルは端末が書くので、そこに
    # 「開発者」と書けば切断を免れる、という形にしてはいけない。
    box.mkdir(parents=True, exist_ok=True)
    (box / 'PC-B@u2.json').write_text(json.dumps(
        {'key': 'PC-B@u2', 'login': 'u2', 'pc': 'PC-B', 'mode': 'edit', 'view': 'schedule',
         'role': mr.ROLE_DEVELOPER, 'at': datetime.now().isoformat()},
        ensure_ascii=False), encoding='utf-8')
    d0 = c.get('/api/presence').get_json()
    b = {x['key']: x for x in d0['items']}.get('PC-B@u2', {})
    rec('区分は在席ファイルではなくマスタから引く', b.get('role') == U, str(b.get('role')))
    rec('自己申告で切断を免れられない', b.get('canDisconnect') is True, str(b.get('canDisconnect')))

    # 一覧に「切断中」と「切断できるか」が出る。
    d = c.get('/api/presence').get_json()
    bykey = {x['key']: x for x in d['items']}
    rec('一覧に切断中と出る', bool(bykey.get('PC-A@u1', {}).get('revoked')), str(bykey.get('PC-A@u1')))
    rec('切断できる相手だけボタンが出る（判定はサーバー）',
        bykey.get('PC-B@u2', {}).get('canDisconnect') is True)
    rec('できることも答える', d['can']['canDisconnect'] is True
        and d['can']['canDisconnectDeveloper'] is False, str(d['can']))

    # 取り消せる。
    r = c.post('/api/presence/allow', json={'key': 'PC-A@u1'})
    rec('切断を取り消せる', r.status_code == 200 and presence.revocation('PC-A@u1') is None,
        str(r.status_code))

    # ---- 6. 切断されたら書き込みだけ止まる -------------------------------
    presence.disconnect(presence.terminal_key('me', 'PC-ME'), 'boss', 'PC-BOSS', '点検')
    am.forget_revocation()
    rec('自分の切断が読める', am.revocation_now() is not None, str(am.revocation_now()))
    r = c.get('/api/presence')
    rec('切断されても読みは通る（GET）', r.status_code == 200, str(r.status_code))
    r = c.post('/api/path-config-master', json={'user_id': 'x'})
    rec('切断されると書き込みは403', r.status_code == 403, str(r.status_code))
    rec('403の理由に切断した人が入っている', 'boss' in (r.get_json().get('error') or ''),
        (r.get_json().get('error') or '')[:70])
    rec('403に理由（点検）も入っている', '点検' in (r.get_json().get('error') or ''))
    # **接続状況そのものは触れる**（そこにしか状態が出ないので塞がない）。
    r = c.post('/api/presence/allow', json={'key': 'PC-B@u2'})
    rec('切断されていても接続状況の口は通る', r.status_code in (200, 403), str(r.status_code))
    presence.clear_revocation(presence.terminal_key('me', 'PC-ME'))
    am.forget_revocation()
    rec('取り消せば書けるようになる', am.revocation_now() is None)

    # 冷却時間で自然に解ける。
    key = 'PC-X@old'
    (box / f'{key}.revoke.json').write_text(json.dumps(
        {'key': key, 'by': 'x', 'byPc': 'y', 'reason': '',
         'at': (datetime.now() - timedelta(seconds=presence.REVOKE_COOLDOWN_SEC + 10)).isoformat()},
        ensure_ascii=False), encoding='utf-8')
    rec('冷却が切れた切断は効かない（間違えても直せる）', presence.revocation(key) is None)

    # ---- 段の宣言 --------------------------------------------------------
    # **3モードとも許すのは意図**（区分は編集可否と別の軸）。宣言を落とすと
    # 閲覧モードの開発者が切断できなくなる。
    rec('接続の管理は3モードとも通す（区分で判定するため）',
        am._WRITE_ALLOWED_MODES.get('presence') == {'edit', 'view', 'schedule'},
        str(am._WRITE_ALLOWED_MODES.get('presence')))
finally:
    (presence.presence_dir, pr._registered_role, am.current_permission_flags,
     am.current_login_id, am.current_pc_name) = _orig
    am.forget_revocation()
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
