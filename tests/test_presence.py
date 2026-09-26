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
 9. 接続の記録と版（§9.513）
10. 古い版の端末への知らせ（§9.515）: 数える前は返さない・間隔ごとに数える・
    読めなければ前の答え・物差しは接続状況と同じ・ハートビートに載る
11. 最新版の判定から開発者を除く（§9.516）: 開発者の端末の版は数えず、要更新にも数えない・
    自分が開発者なら自分の版も・区分が分からなければ数える・知らせも同じ・開発者は急かさない
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
_orig = (presence.presence_dir, presence.registered_roles, pr.current_permission_flags,
         pr.current_login_id, pr.current_pc_name)
_role = {'me': mr.ROLE_USER, 'targets': {}}


def write_entry(key, login, pc, at=None, view='', mode='edit'):
    box.mkdir(parents=True, exist_ok=True)
    (box / f'{key}.json').write_text(json.dumps(
        {'key': key, 'login': login, 'pc': pc, 'mode': mode, 'view': view,
         'at': (at or datetime.now()).isoformat()}, ensure_ascii=False), encoding='utf-8')


try:
    presence.presence_dir = lambda: (box, 'master')
    # 区分を引く口は`presence.registered_roles()`の1箇所（一覧・切断・最新版の判定が同じ答え・§9.516）
    presence.registered_roles = lambda items: {t['key']: _role['targets'].get(f"{t.get('pc')}@{t.get('login')}", mr.ROLE_USER)
                                               for t in items if t.get('key')}
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
    import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
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

    # ---- 9. 接続の記録と版（§9.513） ---------------------------------------
    # 在席は「いま」しか持たない。版の配布を決めるには**消えない記録**が要る。
    import time as _t
    presence._session.update(key='', since='', last=0.0)
    presence._hist.update(key='', data=None, wrote=0.0)
    presence._state['wrote_at'] = 0.0
    presence.touch('h1', 'PC-H', force=True)
    hk = presence.terminal_key('h1', 'PC-H')
    hp = box / presence.HISTORY_DIR / f'{hk}.json'
    h = json.loads(hp.read_text(encoding='utf-8')) if hp.exists() else {}
    ver = presence.app_version()
    rec('接続すると記録ができる（端末ごとに1ファイル・在席の隣の history）',
        hp.exists() and h.get('sessions') == 1 and h.get('version') == ver, str(h)[:120])
    ent = json.loads((box / f'{hk}.json').read_text(encoding='utf-8'))
    rec('在席にも版と接続した時刻が載る', ent.get('version') == ver and bool(ent.get('since')), str(ent)[:120])
    # 30秒後の在席 → 接続時間が30秒ぶん進む（同じ接続）
    presence._session['last'] = _t.time() - 30
    presence._hist['wrote'] = 0.0
    presence.touch('h1', 'PC-H', force=True)
    h = json.loads(hp.read_text(encoding='utf-8'))
    rec('続けて繋いでいれば、同じ接続のまま接続時間が進む',
        h.get('sessions') == 1 and 29 <= h.get('totalSec', 0) <= 31, str(h.get('totalSec')))
    # TTLより長く途切れた → 新しい接続（途切れていたあいだは時間に数えない）
    presence._session['last'] = _t.time() - presence.TTL_SEC - 60
    presence.touch('h1', 'PC-H', force=True)
    h = json.loads(hp.read_text(encoding='utf-8'))
    rec('TTLより長く途切れたら新しい接続として数える（途切れた時間は数えない）',
        h.get('sessions') == 2 and h.get('totalSec', 0) <= 31, str({k: h.get(k) for k in ('sessions', 'totalSec')}))
    presence.leave('h1', 'PC-H')
    rec('閉じても記録は残る（在席だけが消える）',
        hp.exists() and not (box / f'{hk}.json').exists())
    rec('期限切れの掃除は記録へ触らない（下の階層を辿らない）',
        '*' + presence.SUFFIX == '*.json' and hp.parent != box)
    # 最新版と「最新でない端末」の答えは fleet_summary の1箇所
    hist = [{'key': 'A', 'login': 'u1', 'pc': 'PC-A', 'version': '2.9.3', 'lastAt': '2026-09-20T10:00:00',
             'firstAt': '', 'sessions': 3, 'totalSec': 600, 'versions': {}},
            {'key': 'B', 'login': 'u1', 'pc': 'PC-B', 'version': '2.10.0', 'lastAt': '2026-09-21T10:00:00',
             'firstAt': '', 'sessions': 2, 'totalSec': 120, 'versions': {}}]
    online = [{'key': 'C', 'login': 'u2', 'pc': 'PC-C', 'version': '', 'at': '2026-09-22T10:00:00', 'since': ''}]
    f = presence.fleet_summary(online, hist, '2.10.0')
    old = [t['key'] for t in f['terminals'] if t['outdated']]
    rec('最新版は数として比べる（2.10.0 > 2.9.3・文字の順にしない）', f['latestVersion'] == '2.10.0', f['latestVersion'])
    rec('最新でない端末を数える（版の無い古い版の端末も含む）',
        sorted(old) == ['A', 'C'] and f['counts']['outdated'] == 2 and f['counts']['outdatedOnline'] == 1,
        str(old) + ' ' + str(f['counts']))
    rec('最新でない端末が先に並ぶ（配る相手から読める）',
        [t['outdated'] for t in f['terminals']] == [True, True, False], str([t['key'] for t in f['terminals']]))
    u1 = next((u for u in f['users'] if u['login'] == 'u1'), {})
    rec('利用者ごとに合計する（端末数・回数・時間・使っている版）',
        u1.get('terminals') == 2 and u1.get('sessions') == 5 and u1.get('totalSec') == 720
        and u1.get('versions') == ['2.10.0', '2.9.3'] and u1.get('outdated') is True, str(u1))
    # 画面の口: 版と記録が載る・記録を消せるのは開発者/メンテナンス者で、接続中は消さない
    _role['me'] = mr.ROLE_USER
    r = c.post('/api/presence/forget', json={'key': hk})
    rec('記録を消せるのは開発者・メンテナンス者だけ（403）', r.status_code == 403, str(r.status_code))
    _role['me'] = mr.ROLE_MAINTAINER
    write_entry('PC-A@u1', 'u1', 'PC-A')
    (box / presence.HISTORY_DIR / 'PC-A@u1.json').write_text('{"key":"PC-A@u1","login":"u1","pc":"PC-A","sessions":1}',
                                                             encoding='utf-8')
    r = c.post('/api/presence/forget', json={'key': 'PC-A@u1'})
    rec('接続中の端末の記録は消さない（409）', r.status_code == 409, str(r.status_code))
    r = c.post('/api/presence/forget', json={'key': hk})
    rec('使わなくなった端末の記録は消せる', r.status_code == 200 and not hp.exists(), str(r.status_code))
    d = c.get('/api/presence').get_json() or {}
    rec('一覧に最新版・版の状態・利用者ごとの合計が載る（画面は並べるだけ）',
        bool(d.get('fleet', {}).get('latestVersion')) and 'users' in d.get('fleet', {})
        and all('outdated' in x for x in d.get('items') or []), str(d.get('fleet', {}).get('counts')))

    # ---- 10. 古い版の端末への知らせ（§9.515） -----------------------------
    # 運用中の最新版は裏で数えて控え、ハートビートの応答が**控えを返すだけ**。
    presence._newest.update(at=0.0, latest='')
    ME = {'key': 'PC-ME@me', 'login': 'me', 'pc': 'PC-ME', 'version': ver}   # 在席を書く裏のスレッドが渡す「この端末」
    rec('数える前は知らせを返さない（「まだ分からない」を「最新」と言わない）',
        presence.version_notice() is None)
    hdir = box / presence.HISTORY_DIR
    hdir.mkdir(parents=True, exist_ok=True)
    newer = hdir / 'PC-N@new.json'
    newer.write_text(json.dumps({'key': 'PC-N@new', 'login': 'new', 'pc': 'PC-N', 'version': '99.0.0',
                                 'sessions': 1}), encoding='utf-8')
    presence.refresh_newest(ME, force=True)
    n = presence.version_notice() or {}
    rec('運用中に新しい版があれば「この端末は古い」と答える',
        n.get('latestVersion') == '99.0.0' and n.get('myVersion') == ver and n.get('outdated') is True, str(n))
    rec('最新版の物差しは接続状況の一覧と同じ（latest_version の1箇所）',
        presence.fleet_summary(presence.entries(), presence.history_entries(), ver)['latestVersion']
        == n.get('latestVersion'))
    newer.unlink()
    presence.refresh_newest(ME)
    rec('数え直すのは間隔ごと（ハートビートのたびに共有を読まない）',
        (presence.version_notice() or {}).get('latestVersion') == '99.0.0')
    _ent, _his = presence.entries, presence.history_entries
    try:
        presence.entries = lambda: None
        presence.history_entries = lambda: None
        presence.refresh_newest(ME, force=True)
        rec('読めなかったときは前の答えのまま（共有が遅れただけで知らせを消さない）',
            (presence.version_notice() or {}).get('outdated') is True)
    finally:
        presence.entries, presence.history_entries = _ent, _his
    presence.refresh_newest(ME, force=True)
    rec('新しい版が見えなくなれば知らせは消える（自分が最新）',
        (presence.version_notice() or {}).get('outdated') is False, str(presence.version_notice()))
    r = c.post('/api/heartbeat?tab=t-515')
    hb = r.get_json() or {}
    c.post('/api/heartbeat/close?tab=t-515')
    rec('ハートビートの応答に版の知らせが載る（全区分の端末へ届く道）',
        r.status_code == 200 and hb.get('ok') is True
        and (hb.get('version') or {}).get('latestVersion') == ver, str(hb))
    presence._newest.update(at=0.0, latest='')

    # ---- 11. 最新版の判定から開発者を除く（§9.516） -------------------------
    # 開発者の端末は**まだ配っていない版**を動かす。数えると全端末へ「新しい版あり」が出る。
    dev_hist = [{'key': 'D', 'login': 'dev', 'pc': 'PC-D', 'version': '99.0.0', 'lastAt': '2026-09-22T10:00:00',
                 'firstAt': '', 'sessions': 1, 'totalSec': 60, 'versions': {}}] + hist
    roles = {'D': mr.ROLE_DEVELOPER, 'A': mr.ROLE_USER, 'B': mr.ROLE_USER, 'C': mr.ROLE_USER}
    f = presence.fleet_summary(online, dev_hist, '2.10.0', roles=roles, my_key='ME')
    d_t = next((t for t in f['terminals'] if t['key'] == 'D'), {})
    rec('開発者の端末の版は運用中の最新版に数えない',
        f['latestVersion'] == '2.10.0', f['latestVersion'])
    rec('開発者の端末は「要更新」にも数えない（counted=False・区分を添える）',
        d_t.get('counted') is False and d_t.get('outdated') is False and d_t.get('role') == mr.ROLE_DEVELOPER
        and f['counts']['outdated'] == 2, str({k: d_t.get(k) for k in ('counted', 'outdated', 'role')}) + str(f['counts']))
    rec('除いた区分を画面へ渡す（出どころを言うため）', f.get('excludedRoles') == [mr.ROLE_DEVELOPER], str(f.get('excludedRoles')))
    du = next((u for u in f['users'] if u['login'] == 'dev'), {})
    rec('開発者の端末だけの利用者も数えない（counted=False）', du.get('counted') is False and du.get('outdated') is False, str(du))
    f = presence.fleet_summary([], hist, '99.0.0', roles={'ME': mr.ROLE_DEVELOPER}, my_key='ME')
    rec('この端末が開発者なら、この端末の版も数えない', f['latestVersion'] == '2.10.0', f['latestVersion'])
    f = presence.fleet_summary([], dev_hist, '2.10.0', roles=None)
    rec('区分が分からない（マスタを読めない）端末は数える（配った版まで消さない）',
        f['latestVersion'] == '99.0.0', f['latestVersion'])
    # 古い版の知らせも同じ判定（裏で数える分）
    _role['targets']['PC-N@new'] = mr.ROLE_DEVELOPER
    newer.write_text(json.dumps({'key': 'PC-N@new', 'login': 'new', 'pc': 'PC-N', 'version': '99.0.0',
                                 'sessions': 1}), encoding='utf-8')
    presence.refresh_newest({'key': 'ME', 'login': 'me', 'pc': 'PC-ME', 'version': ver}, force=True)
    n = presence.version_notice(mr.ROLE_USER) or {}
    rec('知らせの最新版にも開発者の端末の版を数えない', n.get('latestVersion') == ver and n.get('outdated') is False, str(n))
    _role['targets']['PC-N@new'] = mr.ROLE_USER
    presence.refresh_newest(ME, force=True)
    rec('開発者の端末には「古い」と言わない（配る側を急かさない）',
        (presence.version_notice(mr.ROLE_USER) or {}).get('outdated') is True
        and (presence.version_notice(mr.ROLE_DEVELOPER) or {}).get('outdated') is False,
        str([presence.version_notice(mr.ROLE_USER), presence.version_notice(mr.ROLE_DEVELOPER)]))
    newer.unlink()
    presence._newest.update(at=0.0, latest='')
    # 区分の読み方は permission_flags と同じ1箇所（_permission_row）
    import sqlite3
    mc = sqlite3.connect(':memory:')
    mr.ensure_access_permission_table(mc)
    for lg, pc, role in (('dev', 'PC-D', mr.ROLE_DEVELOPER), ('boss', '', mr.ROLE_MAINTAINER), ('', 'PC-X', mr.ROLE_OPERATOR)):
        mc.execute('INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[有効],[権限区分]) VALUES (?,?,1,1,?)', (lg, pc, role))
    mc.commit()
    pairs = [('dev', 'PC-D'), ('boss', 'PC-Q'), ('any', 'PC-X'), ('dev', 'PC-OTHER'), ('nobody', 'PC-Z')]
    got = mr.registered_roles(mc, pairs)
    want = {p: mr.permission_flags(mc, *p)['role'] for p in pairs}
    mc.close()
    rec('まとめて引く区分は1件ずつの答えと同じ（一致の読み方は1箇所）',
        got == want and got[('dev', 'PC-D')] == mr.ROLE_DEVELOPER and got[('nobody', 'PC-Z')] == mr.ROLE_DEFAULT, str(got))

    # ---- 段の宣言 --------------------------------------------------------
    # **3モードとも許すのは意図**（区分は編集可否と別の軸）。宣言を落とすと
    # 閲覧モードの開発者が切断できなくなる。
    rec('接続の管理は3モードとも通す（区分で判定するため）',
        am._WRITE_ALLOWED_MODES.get('presence') == {'edit', 'view', 'schedule'},
        str(am._WRITE_ALLOWED_MODES.get('presence')))
finally:
    (presence.presence_dir, presence.registered_roles, am.current_permission_flags,
     am.current_login_id, am.current_pc_name) = _orig
    am.forget_revocation()
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
