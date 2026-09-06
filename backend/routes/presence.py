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
from ..db_access import DBS, connect
from ..repositories.master_repo import (ROLE_DEFAULT, ROLES, permission_flags,
                                        role_can, role_capabilities)
from ..quiet import quiet
from .body import body

bp = Blueprint('presence', __name__)


def _registered_role(login_id, pc_name):
    """その端末の**登録上の**区分。

    在席ファイルに書かれている区分は端末の自己申告なので、切断してよいかの
    判定には使わない（古い版の端末は区分を書かない）。**マスタが正**。
    """
    try:
        with connect(DBS['MASTER']['path'], True) as c:
            return permission_flags(c, login_id, pc_name).get('role') or ROLE_DEFAULT
    except Exception as _e:
        quiet('区分を引けない（既定の区分で扱う）',_e)
        return ROLE_DEFAULT


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
    d, source = presence.presence_dir()
    out = []
    if rows is not None:
        for x in rows:
            # **区分はマスタから引き直す**（自己申告を信じない）。
            role = _registered_role(x['login'], x['pc'])
            out.append(dict(x, role=role, isMe=(x['key'] == me['key']),
                            canDisconnect=(x['key'] != me['key']
                                           and role_can(me['role'], 'presence:disconnect', role))))
    return jsonify(ok=True,
                   items=out,
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
