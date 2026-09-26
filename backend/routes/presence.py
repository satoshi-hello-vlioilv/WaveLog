"""presence.py（ルート）: 接続状況を見る／切断する（§9.272）。

**権限の判定は`master_repo.role_can()`の1箇所**（§9.163）。ここにも画面にも
書き写さない——写すと「画面には切断ボタンが出るのにサーバーが断る」、逆に
「画面には出ないのに口は開いている」が作れる。

**モードでは塞がない。** 区分（開発者／メンテナンス者／一般ユーザー）は
編集可否とは別の軸なので、閲覧モードの端末でも開発者なら切断できる
（`access_mode._WRITE_ALLOWED_MODES`でこの段に3モードとも許してある）。
"""
from flask import Blueprint, jsonify

from .. import presence
from ..access_mode import current_login_id, current_pc_name, current_permission_flags, get_mode
from ..repositories.master_repo import ROLE_DEFAULT, ROLES, role_can, role_capabilities
from .body import body

bp = Blueprint('presence', __name__)


def _registered_role(login_id, pc_name):
    """その端末の**登録上の**区分。

    在席ファイルに書かれている区分は端末の自己申告なので、切断してよいかの
    判定には使わない（古い版の端末は区分を書かない）。**マスタが正**。
    引き方は`presence.registered_roles()`の1箇所（一覧と同じ答え・§9.516）。
    """
    key = presence.terminal_key(login_id, pc_name)
    got = presence.registered_roles([{'key': key, 'login': login_id, 'pc': pc_name}])
    return (got or {}).get(key) or ROLE_DEFAULT


def _me():
    flags = current_permission_flags()
    login, pc = current_login_id(), current_pc_name()
    return {'login': login, 'pc': pc, 'key': presence.terminal_key(login, pc),
            'role': flags.get('role') or ROLE_DEFAULT, 'mode': get_mode()}


@bp.get('/api/presence')
def presence_list():
    me = _me()
    # **見られない区分は断る**（§9.322）——設備作業者は「マスタ類は表示せず
    # 触れない」で、接続状況は管理のタブ。画面は`can.canView`で入口を消すが、
    # 消えているだけで読めるのは合図が嘘をつくのと同じ（§3）。
    if not role_can(me['role'], 'presence:view'):
        return jsonify(error=f'この端末の権限区分（{me["role"]}）では接続状況を見られません。',
                       me=me, can=role_capabilities(me['role'])), 403
    rows = presence.entries()
    hist = presence.history_entries()
    d, source = presence.presence_dir()
    # **区分はマスタから引き直す**（自己申告を信じない）。在席と記録と自分の分を
    # まとめて1回で引く（§9.516——最新版の判定から開発者を除くのにも使う）。
    mine = {'key': me['key'], 'login': me['login'], 'pc': me['pc']}
    roles = presence.registered_roles((rows or []) + (hist or []) + [mine]) or {}
    out = []
    if rows is not None:
        for x in rows:
            role = roles.get(x['key']) or ROLE_DEFAULT
            out.append(dict(x, role=role, isMe=(x['key'] == me['key']),
                            canDisconnect=(x['key'] != me['key']
                                           and role_can(me['role'], 'presence:disconnect', role))))
    # 版の配布の答え（§9.513）。**運用中の最新版・古い版の端末・利用者ごとの合計**は
    # `presence.fleet_summary()`の1箇所が作る——画面は並べるだけ。
    fleet = presence.fleet_summary(out, hist, presence.app_version(), roles=roles, my_key=me['key'])
    by_key = {t['key']: t for t in fleet['terminals']}
    for x in out:
        t = by_key.get(x['key']) or {}
        x['outdated'] = bool(t.get('outdated'))
        x['counted'] = t.get('counted', True)
    return jsonify(ok=True,
                   items=out,
                   fleet=fleet,
                   historyReadable=hist is not None,
                   # **読めなかったことを「誰も居ない」と言わない**（§9.107）。
                   readable=rows is not None,
                   shared=presence.shared(), source=source, dir=str(d),
                   me=me, can=role_capabilities(me['role']), roles=list(ROLES),
                   ttlSec=presence.TTL_SEC, cooldownSec=presence.REVOKE_COOLDOWN_SEC,
                   revoked=presence.my_revocation(me['login'], me['pc']))


@bp.post('/api/presence/disconnect')
def presence_disconnect():
    x = body({'key': str, 'reason': str}, strict=True)
    key = x.text('key')
    if not key:
        return jsonify(error='切断する端末を選んでください。'), 400
    me = _me()
    if key == me['key']:
        return jsonify(error='自分自身は切断できません。'), 400
    # **権限が無いことを先に言う**（§4）。相手が居るかどうかより先に決まる
    # 話なので、後ろに置くと「もう接続していません」と、打つ手の違う理由が返る。
    if not role_can(me['role'], 'presence:disconnect'):
        return jsonify(error=f'接続の管理は開発者・メンテナンス者だけができます'
                             f'（この端末は「{me["role"]}」です）。'), 403
    target = None
    rows = presence.entries()
    for r in (rows or []):
        if r['key'] == key:
            target = r
            break
    if target is None:
        return jsonify(error='その端末はもう接続していません（一覧を読み直してください）。'), 409
    target_role = _registered_role(target['login'], target['pc'])
    if not role_can(me['role'], 'presence:disconnect', target_role):
        # ここまで来たら「区分そのものは切断できるが、相手が上位」の場合だけ。
        return jsonify(error=f'「{target_role}」の端末は切断できません'
                             f'（この端末は「{me["role"]}」です）。'), 403
    if not presence.disconnect(key, me['login'], me['pc'], x.text('reason')):
        return jsonify(error='切断の指示を書けませんでした（共有の置き場を確認してください）。'), 503
    return jsonify(ok=True, key=key, cooldownSec=presence.REVOKE_COOLDOWN_SEC)


@bp.post('/api/presence/allow')
def presence_allow():
    """切断を取り消す。**同じ権限で判定する**——切れる相手は戻せる。"""
    x = body({'key': str}, strict=True)
    key = x.text('key')
    if not key:
        return jsonify(error='対象の端末を選んでください。'), 400
    me = _me()
    target = None
    for r in (presence.entries() or []):
        if r['key'] == key:
            target = r
            break
    target_role = _registered_role(target['login'], target['pc']) if target else ROLE_DEFAULT
    if not role_can(me['role'], 'presence:disconnect', target_role):
        return jsonify(error='この端末には接続の管理の権限がありません。'), 403
    presence.clear_revocation(key)
    return jsonify(ok=True, key=key)


@bp.post('/api/presence/forget')
def presence_forget():
    """使わなくなった端末の接続の記録を消す（§9.513）。

    **接続中の端末は消さない**——次の在席で記録がすぐ作り直され、回数と
    時間だけが0に戻る（消したつもりが、数字を壊しただけになる）。"""
    me = _me()
    if not role_can(me['role'], 'presence:forget'):
        return jsonify(error=f'記録を消せるのは開発者・メンテナンス者だけです（この端末は{me["role"]}）。'), 403
    key = str(body({'key': str}, silent=True).text('key') or '').strip()
    if not key:
        return jsonify(error='どの端末の記録かを指定してください。'), 400
    if any(x['key'] == key for x in (presence.entries() or [])):
        return jsonify(error='いま接続している端末の記録は消せません（切断されてから消してください）。'), 409
    presence.forget_history(key)
    return jsonify(ok=True, key=key)
