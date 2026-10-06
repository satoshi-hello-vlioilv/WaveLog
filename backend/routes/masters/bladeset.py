"""masters/bladeset.py: 刃組の**設備の諸元と記録**（§9.377）。

  `GET  /api/bladeset/context`          … 刃組ガイダンス1画面ぶんを**1往復で**返す
  `POST /api/bladeset/seed`             … 図面どおりの初期セットを登録する
  `/api/bladeset-standard-master`       … 刃組基準値（1設備1行）の4本セット
  `/api/bladeset/history`               … 刃組を終えた記録（台車差分の材料）
  `/api/bladeset/blade-pick`            … 刃のカテゴリ・刃厚を選ぶ2つの判定表（読む・表ごとに丸ごと保存）
  `/api/bladeset/hold-pick`             … フィンガー／ゴムリングを選ぶ条件表（読む・丸ごと保存）
  `/api/bladeset/blade-sets`            … 刃セット（作る・字を変える・消す・カテゴリと使用状態の切り替え）

**部材（刃・スペーサー・ゴムリング・フィンガー）は `bladeset_parts.py`**。
分ける境目は「このラインはどういう機械か／いつ何を組んだか」と
「何を何枚持っているか」で、1段20ルートの約束（`test_routesplit`）もここで守る。

**Blueprintは`_base.py`の1つ**（§9.333）——URLも権限表の鍵
（`masters.<関数名>`）も段を分けて1つも変わらない。データの読み書きは
`repositories/bladeset_repo.py` が持ち、ここは受付と整形だけ。

履歴だけは**現場の端末からも書ける**（`access_mode._ENDPOINT_EXTRA_MODES`）
——刃組を終えた記録は、ラインに居る人がその場で押すものだからだ。
"""
from flask import request, jsonify
from ..common import api_guard
from ...flags import flag_of, text_or
from ...access_mode import request_user_id
from ...repositories import bladeset_repo as bs
from ..body import body, any_
from ._base import bp, _op_read


def _eq():
 return str(request.args.get('equipment') or '').strip()


def _rid(x, key='id'):
 v = x.get(key)
 return None if v in (None, '') else int(v)


def _enabled(x):
 """「有効」は呼び名で来る。読み方は`flags.flag_of`の1箇所（§9.324 R4）。"""
 return flag_of(text_or(x, 'enabled'))


# =========================================================================
# 1画面ぶんの材料（§9.163: 語彙も判定もサーバーが持つ）
# =========================================================================
@bp.get('/api/bladeset/context')
@api_guard('刃組マスタの読込に失敗しました')
def bladeset_context():
 eq = _eq()
 return jsonify(ok=True, **_op_read(lambda c: bs.context(c, eq)))


@bp.post('/api/bladeset/seed')
@api_guard('初期セットの登録に失敗しました', bad=ValueError)
def bladeset_seed():
 """図面どおりの1式を登録する（`replace`で入れ替え）。

 **既に1件でもあれば足さない**のが既定——押し間違いで在庫が倍にならない
 ようにしてある。何が起きるかは画面が押す前に言う（§CLAUDE 4）。"""
 # 呼び名（`<鍵>Text`）も宣言する——`flags.text_or()`が両方を読むので、
 # 片方だけ宣言すると`body(spec)`が「知らない鍵」として弾く（§9.330）。
 x = body({'equipment': any_, 'replace': any_, 'replaceText': any_})
 uid = request_user_id(x)
 made = _op_read(lambda c: bs.seed_standard_parts(
     c, uid, x.get('equipment'), replace=bool(flag_of(text_or(x, 'replace')))))
 n = sum(made.values())
 return jsonify(ok=True, made=made,
                message=('初期セットを登録しました（刃 %d・スペーサー %d・'
                         'ゴムリング %d・フィンガー %d・台車 %d）。'
                         % (made['blade'], made['spacer'], made['ring'],
                            made['finger'], made['carriage'])) if n
                else '既に登録があるため、何も足しませんでした。')


# =========================================================================
# 刃組基準値マスタ
# =========================================================================
# 1行＝1設備。**既定はコード側**（`STANDARD_DEFAULTS`）なので、登録が無くても
# 画面は開ける。一覧には「いま効いている値」と「登録によるものか」を返す。
@bp.get('/api/bladeset-standard-master')
@api_guard('刃組基準値マスタの読込に失敗しました')
def bladeset_standard_list():
 eq = _eq()

 def fn(c):
  return {'items': bs.standard_rows(c, True, eq or None),
          'standardDefaults': dict(bs.STANDARD_DEFAULTS),
          'equipments': bs.equipments(c)}
 return jsonify(ok=True, equipment=eq, **_op_read(fn))


@api_guard('刃組基準値の保存に失敗しました', bad=ValueError)
def _standard_save(x):
 uid = request_user_id(x)
 # 値は**渡した鍵だけ**を書く（§9.212 ②）。マスタ管理のフォームは全部を
 # 渡すが、画面の一部だけを直す経路でも設定が消えないようにしておく。
 # **呼び名（`<鍵>Text`）も受ける**——汎用フォームの選択欄は「できる/できない」
 # のような呼び名で送る（`flags.text_or`の1箇所が読み分ける・§9.320-E）。
 values = {k: text_or(x, k) for k in bs.STANDARD_DEFAULTS
           if k in x or (k + 'Text') in x}

 def fn(c):
  return bs.standard_upsert(c, uid, equipment=x.get('equipment'),
                            values=values, note=x.get('note'),
                            standard_id=_rid(x))[0]
 return jsonify(ok=True, id=_op_read(fn), message='刃組基準値を保存しました。')


def _standard_spec():
 spec = {'id': any_, 'equipment': any_, 'note': any_, 'order': any_,
         'enabled': any_, 'enabledText': any_}
 for k in bs.STANDARD_DEFAULTS:
  spec[k] = any_
  spec[k + 'Text'] = any_
 return spec


@bp.post('/api/bladeset-standard-master')
def bladeset_standard_register():
 return _standard_save(body(_standard_spec()))


@bp.post('/api/bladeset-standard-master/update')
def bladeset_standard_update():
 x = body(_standard_spec())
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _standard_save(x)


@bp.post('/api/bladeset-standard-master/delete')
@api_guard('刃組基準値の削除に失敗しました')
def bladeset_standard_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.standard_delete(c, int(x['id'])))
 # 消しても画面は開ける（既定値へ戻るだけ）ので、そのことを言う（§CLAUDE 6）。
 return jsonify(ok=True, message='刃組基準値の登録を消しました（既定値に戻ります）。')


# =========================================================================
# 条の設計（測定より前に決めておく・§9.378）
# =========================================================================
# 読むのは**測定と刃組の両方**なので GET は誰でも通す（見るだけで壊れない）。
# 書くのは段取りをする人なので `access_mode` で段（`schedule`）を要求する。
@bp.get('/api/bladeset/strip-design')
@api_guard('条の設計の読込に失敗しました')
def bladeset_design_list():
 eq = _eq()
 lot = str(request.args.get('lot') or '').strip()
 if lot:
  hit = _op_read(lambda c: bs.design_for(c, eq, lot))
  return jsonify(ok=True, equipment=eq, lot=lot, item=hit)
 return jsonify(ok=True, equipment=eq,
                items=_op_read(lambda c: bs.design_rows(c, False, eq or None)))


@bp.post('/api/bladeset/strip-design')
@api_guard('条の設計の保存に失敗しました', bad=ValueError)
def bladeset_design_save():
 x = body({'equipment': any_, 'lot': any_, 'strips': any_, 'coilWidth': any_,
           'thickness': any_, 'groups': any_, 'note': any_, 'at': any_})
 uid = request_user_id(x)
 new_id, made = _op_read(lambda c: bs.design_upsert(
     c, uid, equipment=x.get('equipment'), lot=x.get('lot'),
     strips=x.get('strips'), coil_width=x.get('coilWidth'),
     thickness=x.get('thickness'), groups=x.get('groups'),
     note=x.get('note'), at=x.get('at')))
 return jsonify(ok=True, id=new_id, created=made,
                message='条の設計を記録しました。' if made else '条の設計を上書きしました。')


@bp.post('/api/bladeset/strip-design/delete')
@api_guard('条の設計の削除に失敗しました')
def bladeset_design_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.design_delete(c, int(x['id'])))
 return jsonify(ok=True, message='条の設計を消しました。')


# =========================================================================
# 刃選択（刃のカテゴリと刃厚を選ぶ2つの判定表・§9.529）
# =========================================================================
# 表は1枚として編集するので**丸ごと置き換える**（保持方式と同じ）。語彙（表ごとに使える項目・
# 比べ方）も返す——画面は書き写さない（§9.163）。
@bp.get('/api/bladeset/blade-pick')
@api_guard('刃選択マスタの読込に失敗しました')
def bladeset_pick_list():
 eq = _eq()
 return jsonify(ok=True, equipment=eq,
                tables=_op_read(lambda c: bs.pick_tables(c, eq)) if eq else {},
                defs=[{'key': k, 'label': l, 'order': o, 'fields': bs.pick_fields_for(o)}
                      for k, l, o in bs.PICK_TABLES],
                groups=[{'key': k, 'label': l} for k, l in bs.PICK_GROUPS],
                ops=[{'op': o, 'label': l, 'two': o in bs.BLADEPICK_OPS_2}
                     for o, l in bs.BLADEPICK_OPS])


@bp.post('/api/bladeset/blade-pick')
@api_guard('刃選択の保存に失敗しました', bad=ValueError)
def bladeset_pick_save():
 x = body({'equipment': any_, 'table': any_, 'rows': any_, 'cols': any_, 'reset': any_})
 table = x.text('table')
 label = dict((k, l) for k, l, _o in bs.PICK_TABLES).get(table, table)
 if x.get('reset') is True:
  n = _op_read(lambda c: bs.pick_reset(c, x.get('equipment'), table))
  return jsonify(ok=True, removed=n, message=f'「{label}」の表を未登録へ戻しました（今までの選び方で決めます）。')
 rows = x.get('rows')
 if not isinstance(rows, list):
  return jsonify(error='表の行（rows）がありません。'), 400
 n = _op_read(lambda c: bs.pick_replace(c, request_user_id(x), x.get('equipment'), table, rows, x.get('cols')))
 return jsonify(ok=True, rows=n, message=f'「{label}」の表を保存しました（{n}行）。')


# =========================================================================
# 刃セット（カテゴリ・使用状態・§9.526）
# =========================================================================
# セット＝設備＋組。**切り替えはその場で1項目ずつ書く**（盤の札を押すたび）。
@bp.get('/api/bladeset/blade-sets')
@api_guard('刃セットの読込に失敗しました')
def bladeset_sets_list():
 eq = _eq()
 # 径ゲージの物差し（§9.536）: 使用限界径・研磨周期・新品径は刃組基準値の1箇所から（画面へ書き写さない）。
 got = _op_read(lambda c: {'items': bs.blade_sets(c, eq), 'wear': bs.blade_wear_scale(c, eq)}) if eq \
  else {'items': [], 'wear': None}
 return jsonify(ok=True, equipment=eq, items=got['items'], wear=got['wear'],
                categories=list(bs.BLADE_CATEGORIES), uses=list(bs.BLADE_USES),
                setNames=list(bs.BLADE_SET_NAMES))


@bp.post('/api/bladeset/blade-sets')
@api_guard('刃セットの保存に失敗しました', bad=ValueError)
def bladeset_sets_save():
 """セット1つへの操作。`create`（刃厚の行ごと作る）／`rename`（字を変える）／`delete`（行ごと消す）／
 `reset`（カテゴリ・使用状態の登録を消す）／どれでもなければカテゴリ・使用状態を送った項目だけ書く。"""
 x = body({'equipment': any_, 'group': any_, 'category': any_, 'use': any_, 'reset': any_,
           'create': any_, 'blades': any_, 'rename': any_, 'delete': any_})
 eq, g, uid = x.get('equipment'), x.get('group'), request_user_id(x)
 if x.get('reset'):   # 登録を消して初期値へ（刃の「状態」から起こした値）
  n = _op_read(lambda c: bs.blade_set_reset(c, eq, g))
  return jsonify(ok=True, removed=n, message='刃セットを初期値へ戻しました。')
 if x.get('create'):
  got = _op_read(lambda c: bs.blade_set_create(c, uid, eq, g, x.get('category'), x.get('use'), x.get('blades')))
  return jsonify(ok=True, set=got, message=f'セット {bs.blade_set_name(g)} を登録しました。')
 if x.get('rename') not in (None, ''):
  n = _op_read(lambda c: bs.blade_set_rename(c, uid, eq, g, x.get('rename')))
  return jsonify(ok=True, rows=n, message=f'セット {g} を {bs.blade_set_name(x.get("rename"))} に変えました（刃 {n}行）。')
 if x.get('delete'):
  n = _op_read(lambda c: bs.blade_set_delete(c, eq, g))
  return jsonify(ok=True, removed=n, message=f'セット {g} を消しました（刃 {n}行）。')
 got = _op_read(lambda c: bs.blade_set_update(c, uid, eq, g, category=x.get('category'), use=x.get('use')))
 return jsonify(ok=True, set=got, message=f'セット {x.text("group") or "（組なし）"}を{got["category"]}・{got["use"]}にしました。')


# =========================================================================
# 保持方式（フィンガー／ゴムリングを選ぶ条件表・§9.524）
# =========================================================================
# 表は1枚として編集するので**丸ごと置き換える**（1行ずつの登録・削除の口は持たない）。
# 登録の無い設備は今までの決め方の「種」を返す（`stored:false`）。
@bp.get('/api/bladeset/hold-pick')
@api_guard('保持方式マスタの読込に失敗しました')
def bladeset_hold_list():
 eq = _eq()
 got = _op_read(lambda c: bs.hold_rows(c, eq)) if eq else {'rows': [], 'stored': False, 'cols': []}
 return jsonify(ok=True, equipment=eq, rows=got['rows'], stored=got['stored'], cols=got['cols'],
                methods=list(bs.HOLD_METHODS), fingerMaterials=list(bs.FINGER_MATERIALS),
                fields=bs.pick_fields_for(bs.HOLD_ORDER), groups=[{'key': k, 'label': l} for k, l in bs.PICK_GROUPS],
                ops=[{'op': o, 'label': l, 'two': o in bs.BLADEPICK_OPS_2}
                     for o, l in bs.BLADEPICK_OPS])


@bp.post('/api/bladeset/hold-pick')
@api_guard('保持方式マスタの保存に失敗しました', bad=ValueError)
def bladeset_hold_save():
 x = body({'equipment': any_, 'rows': any_, 'cols': any_, 'reset': any_})
 if x.get('reset') is True:
  n = _op_read(lambda c: bs.hold_reset(c, x.get('equipment')))
  return jsonify(ok=True, rows=0, removed=n,
                 message='保持方式の表を未登録へ戻しました（表は空です。どの作業もゴムリングになります）。')
 rows = x.get('rows')
 if not isinstance(rows, list):
  return jsonify(error='表の行（rows）がありません。'), 400
 n = _op_read(lambda c: bs.hold_replace(c, request_user_id(x), x.get('equipment'), rows, x.get('cols')))
 return jsonify(ok=True, rows=n, message=f'保持方式の条件表を保存しました（{n}行）。')


# =========================================================================
# 刃組履歴（台車差分の材料）
# =========================================================================
@bp.get('/api/bladeset/history')
@api_guard('刃組履歴の読込に失敗しました')
def bladeset_history_list():
 eq = _eq()
 return jsonify(ok=True, equipment=eq,
                items=_op_read(lambda c: bs.history_rows(c, False, eq or None)))


@bp.get('/api/bladeset/carriage-state')
@api_guard('台車の刃組状態の読込に失敗しました')
def bladeset_carriage_state():
 """台車がどの刃組で組まれているか。**作業スケジュールが見に来る口**（§9.378）。"""
 eq = _eq()
 return jsonify(ok=True, equipment=eq,
                items=_op_read(lambda c: bs.carriage_state(c, eq or None)))


@bp.post('/api/bladeset/history')
@api_guard('刃組履歴の保存に失敗しました', bad=ValueError)
def bladeset_history_add():
 x = body({'equipment': any_, 'carriage': any_, 'at': any_, 'note': any_,
           'detail': any_})
 uid = request_user_id(x)
 new_id = _op_read(lambda c: bs.history_add(
     c, uid, equipment=x.get('equipment'), carriage=x.get('carriage'),
     at=x.get('at'), note=x.get('note'), detail=x.get('detail')))
 return jsonify(ok=True, id=new_id, message='刃組の記録を残しました。')


@bp.post('/api/bladeset/history/delete')
@api_guard('刃組履歴の削除に失敗しました')
def bladeset_history_delete():
 x = body({'id': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='削除対象IDがありません。'), 400
 _op_read(lambda c: bs.history_delete(c, int(x['id'])))
 return jsonify(ok=True, message='刃組の記録を消しました。')
