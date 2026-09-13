"""masters/bladeset_parts.py: 刃組の**部材**マスタ（§9.377）。

刃・スペーサー・ゴムリング・フィンガーの4つ。どれも**マスタ管理の汎用CRUDの
4本セット**（一覧・登録・更新・削除）で、`master-defs.js` の定義がそのまま載る。

**設備の諸元（刃組基準値）と記録（刃組履歴）は `bladeset.py`** に置いてある
——あちらは「このラインはどういう機械か」「いつ何を組んだか」で、こちらは
「何を何枚持っているか」。分ける境目はそこ（`test_routesplit` の1段20ルート）。

**Blueprintは`_base.py`の1つのまま**（§9.333）なので、権限表の鍵
（`masters.<関数名>`）は段を分けても1つも変わらない。
"""
from flask import jsonify
from ..common import api_guard
from ...access_mode import request_user_id
from ...repositories import bladeset_repo as bs
from ..body import body, any_
from ._base import bp, _op_read
# 受け取り方の小道具は`bladeset.py`と**同じものを使う**（設備の読み方・IDの読み方・
# 「有効」の読み方を段ごとに書き写さない）。
from .bladeset import _eq, _rid, _enabled


# =========================================================================
# 刃マスタ
# =========================================================================
@bp.get('/api/bladeset-blade-master')
@api_guard('刃マスタの読込に失敗しました')
def bladeset_blade_list():
 eq = _eq()

 def fn(c):
  return {'items': bs.blade_rows(c, True, eq or None),
          'bladeStatus': list(bs.BLADE_STATUS),
          'equipments': bs.equipments(c)}
 return jsonify(ok=True, equipment=eq, **_op_read(fn))


@api_guard('刃マスタの保存に失敗しました', bad=ValueError)
def _blade_save(x):
 uid = request_user_id(x)

 def fn(c):
  return bs.blade_upsert(c, uid, equipment=x.get('equipment'),
                         name=x.get('name'), group=x.get('group'),
                         thickness=x.get('thickness'),
                         current_dia=x.get('currentDia'),
                         qty=x.get('qty'), min_qty=x.get('minQty'),
                         last_grind=x.get('lastGrind'),
                         grind_count=x.get('grindCount'),
                         status=x.get('status'), note=x.get('note'),
                         order=x.get('order'), enabled=_enabled(x),
                         blade_id=_rid(x))[0]
 return jsonify(ok=True, id=_op_read(fn), message='刃を保存しました。')


_BLADE_SPEC = {'id': any_, 'equipment': any_, 'name': any_, 'group': any_,
               'thickness': any_, 'currentDia': any_, 'qty': any_,
               'minQty': any_, 'lastGrind': any_, 'grindCount': any_,
               'status': any_, 'note': any_, 'order': any_,
               'enabled': any_, 'enabledText': any_}


@bp.post('/api/bladeset-blade-master')
def bladeset_blade_register():
 return _blade_save(body(_BLADE_SPEC))


@bp.post('/api/bladeset-blade-master/update')
def bladeset_blade_update():
 x = body(_BLADE_SPEC)
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _blade_save(x)


@bp.post('/api/bladeset-blade-master/delete')
@api_guard('刃マスタの削除に失敗しました')
def bladeset_blade_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.blade_delete(c, int(x['id'])))
 return jsonify(ok=True, message='刃を削除しました。')


# =========================================================================
# スペーサーマスタ
# =========================================================================
@bp.get('/api/bladeset-spacer-master')
@api_guard('スペーサーマスタの読込に失敗しました')
def bladeset_spacer_list():
 eq = _eq()

 def fn(c):
  return {'items': bs.spacer_rows(c, True, eq or None),
          'spacerUses': list(bs.SPACER_USES),
          'equipments': bs.equipments(c)}
 return jsonify(ok=True, equipment=eq, **_op_read(fn))


@api_guard('スペーサーマスタの保存に失敗しました', bad=ValueError)
def _spacer_save(x):
 uid = request_user_id(x)

 def fn(c):
  return bs.spacer_upsert(c, uid, equipment=x.get('equipment'),
                          size=x.get('size'), qty=x.get('qty'),
                          min_qty=x.get('minQty'), use=x.get('use'),
                          note=x.get('note'), order=x.get('order'),
                          enabled=_enabled(x), spacer_id=_rid(x))[0]
 return jsonify(ok=True, id=_op_read(fn), message='スペーサーを保存しました。')


_SPACER_SPEC = {'id': any_, 'equipment': any_, 'size': any_, 'qty': any_,
                'minQty': any_, 'use': any_, 'note': any_, 'order': any_,
                'enabled': any_, 'enabledText': any_}


@bp.post('/api/bladeset-spacer-master')
def bladeset_spacer_register():
 return _spacer_save(body(_SPACER_SPEC))


@bp.post('/api/bladeset-spacer-master/update')
def bladeset_spacer_update():
 x = body(_SPACER_SPEC)
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _spacer_save(x)


@bp.post('/api/bladeset-spacer-master/delete')
@api_guard('スペーサーマスタの削除に失敗しました')
def bladeset_spacer_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.spacer_delete(c, int(x['id'])))
 return jsonify(ok=True, message='スペーサーを削除しました。')


# =========================================================================
# ゴムリングマスタ
# =========================================================================
@bp.get('/api/bladeset-ring-master')
@api_guard('ゴムリングマスタの読込に失敗しました')
def bladeset_ring_list():
 eq = _eq()

 def fn(c):
  return {'items': bs.ring_rows(c, True, eq or None),
          # 色と外径の対応は**サーバーが持つ**（§9.163）。画面はこの一覧を
          # 候補として出すだけで、周期の計算を書き写さない。
          'ringColors': [{'color': n, 'hex': h,
                          'od': float(bs.RING_COLOR_TOP_OD - i)}
                         for i, (n, h) in enumerate(bs.RING_COLOR_CYCLE)],
          'equipments': bs.equipments(c)}
 return jsonify(ok=True, equipment=eq, **_op_read(fn))


@api_guard('ゴムリングマスタの保存に失敗しました', bad=ValueError)
def _ring_save(x):
 uid = request_user_id(x)

 def fn(c):
  rid, _created, aligned = bs.ring_upsert(
      c, uid, equipment=x.get('equipment'),
      color=x.get('color'), hex_code=x.get('hex'),
      od=x.get('od'), bore=x.get('bore'),
      width=x.get('width'), qty=x.get('qty'),
      min_qty=x.get('minQty'), note=x.get('note'),
      order=x.get('order'), enabled=_enabled(x), ring_id=_rid(x))
  return rid, aligned
 rid, aligned = _op_read(fn)
 # **そろえた行があったら言う**（§CLAUDE 6。黙って他の行を書き換えない）。
 return jsonify(ok=True, id=rid, aligned=aligned,
                message=('ゴムリングを保存しました（同じ色の %d 行も外径をそろえました）。'
                         % aligned) if aligned else 'ゴムリングを保存しました。')


_RING_SPEC = {'id': any_, 'equipment': any_, 'color': any_, 'hex': any_,
              'od': any_, 'bore': any_, 'width': any_, 'qty': any_,
              'minQty': any_, 'note': any_, 'order': any_,
              'enabled': any_, 'enabledText': any_}


@bp.post('/api/bladeset-ring-master')
def bladeset_ring_register():
 return _ring_save(body(_RING_SPEC))


@bp.post('/api/bladeset-ring-master/update')
def bladeset_ring_update():
 x = body(_RING_SPEC)
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _ring_save(x)


@bp.post('/api/bladeset-ring-master/delete')
@api_guard('ゴムリングマスタの削除に失敗しました')
def bladeset_ring_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.ring_delete(c, int(x['id'])))
 return jsonify(ok=True, message='ゴムリングを削除しました。')


# =========================================================================
# フィンガーマスタ
# =========================================================================
@bp.get('/api/bladeset-finger-master')
@api_guard('フィンガーマスタの読込に失敗しました')
def bladeset_finger_list():
 eq = _eq()

 def fn(c):
  return {'items': bs.finger_rows(c, True, eq or None),
          'equipments': bs.equipments(c)}
 return jsonify(ok=True, equipment=eq, **_op_read(fn))


@api_guard('フィンガーマスタの保存に失敗しました', bad=ValueError)
def _finger_save(x):
 uid = request_user_id(x)

 def fn(c):
  return bs.finger_upsert(c, uid, equipment=x.get('equipment'),
                          name=x.get('name'), width=x.get('width'),
                          qty=x.get('qty'), min_qty=x.get('minQty'),
                          max_thickness=x.get('maxThickness'),
                          note=x.get('note'), order=x.get('order'),
                          enabled=_enabled(x), finger_id=_rid(x))[0]
 return jsonify(ok=True, id=_op_read(fn), message='フィンガーを保存しました。')


_FINGER_SPEC = {'id': any_, 'equipment': any_, 'name': any_, 'width': any_,
                'qty': any_, 'minQty': any_, 'maxThickness': any_,
                'note': any_, 'order': any_, 'enabled': any_,
                'enabledText': any_}


@bp.post('/api/bladeset-finger-master')
def bladeset_finger_register():
 return _finger_save(body(_FINGER_SPEC))


@bp.post('/api/bladeset-finger-master/update')
def bladeset_finger_update():
 x = body(_FINGER_SPEC)
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _finger_save(x)


@bp.post('/api/bladeset-finger-master/delete')
@api_guard('フィンガーマスタの削除に失敗しました')
def bladeset_finger_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.finger_delete(c, int(x['id'])))
 return jsonify(ok=True, message='フィンガーを削除しました。')
