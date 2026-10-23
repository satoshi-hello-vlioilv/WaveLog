"""masters/dashboard.py: ダッシュボード（§9.628。LotScope のグリッドのパネルの移植）の API。

組み（ダッシュボード）・セット・外した組み込み・設備グループは master.sqlite3（`backend/dashboard/store.py`）。パネルの数は
`backend/dashboard/answer.py`（集計）と`ops.py`（稼働・ABC 分析）。ここは受け付けて形を返すだけ。

書いてよいか:
    組み・セット … 「見せ方」の保存（一覧の列・フィルタと同じ）なのでマスタ編集の段は掛けない（`MASTER_EDIT_EXEMPT_ENDPOINTS`）。
                    置き場ごとの門は`store.Who.gate()`（共通デフォルト＝開発者・共通＝現場のマスタを書ける端末・自分だけ＝本人）
    設備グループ … 現場のマスタ（マスタ編集の段が掛かる）
読むだけの POST（パネルの数・列の札）は`_READ_ONLY_POST_ENDPOINTS`・`NON_MASTER_ENDPOINTS`に載せる（錠を取らない・どのモードでも）。
"""
from datetime import datetime

from flask import current_app, jsonify, request

from ...access_mode import current_login_id, current_permission_flags, revocation_now
from ...db_access import DBS, connect
from ...quiet import quiet
from ...repositories import dashboard_repo as repo
from ...repositories.master_repo import ROLE_DEVELOPER, master_edit_capabilities, normalize_role
from ...dashboard import answer, equip_groups, layout, ops, pivot, sources, store
from ..body import any_, body
from ._base import bp


def _who():
 try:
  flags = current_permission_flags()
  role = flags.get('role', '')
  common = master_edit_capabilities(role, flags.get('masterEditStored', '')).get('canEditFieldMaster')
  return store.Who(current_login_id(), common, normalize_role(role) == ROLE_DEVELOPER, revocation_now())
 except Exception as e:
  quiet('権限を読めない（自分だけの保存だけ許す）', e)
  return store.Who(current_login_id(), False, False)


def _read(fn):
 with connect(DBS['MASTER']['path'], False) as c:
  return fn(c)


def _call(fn, ok_status=200, after=None):
 """書く口の共通: 決まりに合わなければ 400・権限が無ければ 403・ほかの PC が先に直したら 409（今の行）・見つからなければ 404。
    after(書いた答え) … 確定して接続を閉じてから作る答え（数えるために別の接続を開くもの。書いている最中に開くと錠を待つ）"""
 try:
  with connect(DBS['MASTER']['path'], False) as c:
   out = fn(c)
  answer.forget()
  return jsonify(after(out) if after else out), ok_status
 except store.Forbidden as e:
  return jsonify(error=str(e)), 403
 except repo.Conflict as e:
  return jsonify(error=str(e), current=e.row), 409
 except repo.NotFound as e:
  return jsonify(error=str(e)), 404
 except (layout.LayoutError, equip_groups.GroupError, ValueError) as e:
  return jsonify(error=str(e)), 400


def _base_rev(x):
 v = x.get('base_rev') if x.get('base_rev') is not None else request.args.get('base_rev')
 try:
  return int(v) if v not in (None, '') else None
 except (TypeError, ValueError):
  return None


_LAYOUT_SPEC = {'name': any_, 'scope': any_, 'standard': any_, 'body': any_, 'note': any_, 'base_rev': any_}


# ---------------------------------------------------------------- ダッシュボードの組み
@bp.get('/api/dashboards')
def dashboards_list():
 """並び（自分の ID → 共通 → 共通デフォルト〈置いた物 → 組み込み〉）・いま開く標準・書ける置き場"""
 return jsonify(_read(lambda c: store.layouts(c, _who())))


@bp.post('/api/dashboards')
def dashboards_create():
 """{name, scope: default|all|me, standard, body: {rows, panels}, note} を新しいダッシュボードとして置く"""
 x = body(_LAYOUT_SPEC)
 return _call(lambda c: store.layout_create(c, _who(), dict(x.raw)), 201)


@bp.put('/api/dashboards/<int:item_id>')
def dashboards_update(item_id):
 """名前・中身（上書き）・標準・備考を直す。base_rev が今の版と違えば 409（ほかの PC が先に直した）"""
 x = body(_LAYOUT_SPEC)
 return _call(lambda c: store.layout_update(c, _who(), item_id, {k: v for k, v in x.raw.items() if k != 'base_rev'}, _base_rev(x)))


@bp.delete('/api/dashboards/<int:item_id>')
def dashboards_delete(item_id):
 x = body({'base_rev': any_}, silent=True)
 return _call(lambda c: store.remove(c, _who(), item_id, _base_rev(x), layout.LAYOUT_SOURCE))


@bp.put('/api/dashboards-hidden')
def dashboards_hidden():
 """組み込みのダッシュボードを外す・戻す。{scope: default|me, keys: [外す組み込みの鍵]}（空なら全部戻す）"""
 x = body({'scope': any_, 'keys': any_})
 return _call(lambda c: store.hide_builtins(c, _who(), x.get('scope'), x.get('keys') if isinstance(x.get('keys'), list) else []))


# ---------------------------------------------------------------- セット
@bp.get('/api/dashboard-sets')
def dashboard_sets_list():
 return jsonify(_read(lambda c: store.sets(c, _who())))


@bp.post('/api/dashboard-sets')
def dashboard_sets_create():
 x = body(_LAYOUT_SPEC)
 return _call(lambda c: store.set_create(c, _who(), dict(x.raw)), 201)


@bp.put('/api/dashboard-sets/<int:item_id>')
def dashboard_sets_update(item_id):
 x = body(_LAYOUT_SPEC)
 return _call(lambda c: store.set_update(c, _who(), item_id, {k: v for k, v in x.raw.items() if k != 'base_rev'}, _base_rev(x)))


@bp.delete('/api/dashboard-sets/<int:item_id>')
def dashboard_sets_delete(item_id):
 x = body({'base_rev': any_}, silent=True)
 return _call(lambda c: store.remove(c, _who(), item_id, _base_rev(x), layout.SET_SOURCE))


# ---------------------------------------------------------------- パネルの数・列の札・元の並び
def _ctx():
 """いま（網は DASHBOARD_NOW で検証用のデータの日に合わせる）と設備グループの行"""
 return answer.Context(current_app.config.get('DASHBOARD_NOW') or datetime.now(), _read(store.group_rows))


@bp.post('/api/dashboard/query')
def dashboard_query():
 """1枚のパネルの数（本文 {panel}）。答えは集計表と同じ形。合わせた表は {groups, equipOrder, now}・稼働と ABC は設備ごとの答え"""
 x = body({'panel': any_}, silent=True)
 try:
  p = layout.clean_panel(x.get('panel') or {}, 0, layout.ROWS_MAX)
 except layout.LayoutError as e:
  return jsonify(error=str(e)), 400
 ctx = _ctx()
 if p['visual'] == 'board':
  return jsonify(answer.board_answer(p, ctx))
 a = (ops.ops_answer(p, ctx) if p['visual'] in layout.OPS_VISUALS else answer.link_answer(p, ctx) if p.get('link')
      else answer.split_answer(p, ctx))
 if 'status' in a and 'cells' not in a and 'equips' not in a:
  return jsonify(error=a['error'], kind=a.get('kind') or 'error'), a['status']
 return jsonify(a)


@bp.post('/api/dashboard/fields')
def dashboard_fields():
 """パネルを組む所の左のカラムの札（source・equips・calc）: 列ごとの手がかりと特別な段（設備・設備グループ・作業日・直）"""
 x = body({'source': any_, 'equips': any_, 'calc': any_}, silent=True)
 try:
  return jsonify(answer.fields(str(x.get('source') or ''), x.get('equips') if isinstance(x.get('equips'), list) else None,
                               layout.clean_calc(x.get('calc'))))
 except sources.SourceFail as f:
  return jsonify(error=f.error, kind=f.kind), f.status


@bp.get('/api/dashboard/sources')
def dashboard_sources():
 """パネルに使える元の並び・期間の種類・設備グループのまとめ方・役割 → 元の鍵（組み込みの role: を名前で言うため）"""
 rows = _read(store.group_rows)
 return jsonify(items=sources.source_items(), periods=pivot.PERIODS, egroupSets=equip_groups.sets(rows), roles=sources.role_sources(),
                mine=layout.MINE)


@bp.get('/api/dashboard/equip-tree')
def dashboard_equip_tree():
 """スライサーの設備: 実際に出てくる設備と、設備グループのまとめ方ごとの入り方"""
 ctx = _ctx()
 names = [x['name'] for x in answer.equipment_seen(ctx)]
 return jsonify(names=names, sets=answer.equip_tree(names, ctx.group_rows))


# ---------------------------------------------------------------- 設備グループ（現場のマスタ）
def _group_listing(extra=None):
 """設備グループの一覧（実際に出てくる設備を数えるので、書き込みの接続の外で作る）"""
 rows = _read(store.group_rows)
 seen = answer.equipment_seen(answer.Context(datetime.now(), rows))
 return {**_read(lambda c: store.group_listing(c, seen)), **(extra or {})}


_GROUP_SPEC = {'id': any_, 'user_id': any_, 'name': any_, 'set': any_, 'equipment': any_, 'rules': any_, 'rulesText': any_, 'except': any_,
               'order': any_, 'note': any_, 'base_rev': any_}
_GROUP_META = ('id', 'user_id', 'base_rev')


def _group_id(x):
 try:
  return int(x.get('id'))
 except (TypeError, ValueError):
  raise ValueError('直す・消す設備グループ（id）がありません。') from None


@bp.get('/api/masters/equipgroups')
def equipgroups_list():
 """設備グループの一覧（まとめ方ごと）・選べる設備"""
 return jsonify(_group_listing())


@bp.post('/api/masters/equipgroups')
def equipgroups_create():
 x = body(_GROUP_SPEC)
 return _call(lambda c: store.group_create(c, current_login_id(), {k: v for k, v in x.raw.items() if k not in _GROUP_META}), 201, after=lambda new: _group_listing({'created': new}))


@bp.post('/api/masters/equipgroups/update')
def equipgroups_update():
 """マスタ管理の約束（§9.82: 直すのは /update・id は本文）"""
 x = body(_GROUP_SPEC)
 return _call(lambda c: store.group_update(c, current_login_id(), _group_id(x), {k: v for k, v in x.raw.items() if k not in _GROUP_META}, _base_rev(x)),
              after=lambda _: _group_listing())


@bp.post('/api/masters/equipgroups/delete')
def equipgroups_delete():
 x = body({'id': any_, 'user_id': any_, 'base_rev': any_})
 return _call(lambda c: repo.delete(c, repo.EQUIP_GROUP, _group_id(x), _base_rev(x)), after=lambda _: _group_listing())
