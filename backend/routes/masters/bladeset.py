"""masters/bladeset.py: 刃組の**設備の諸元と記録**（§9.377）。

  `GET  /api/bladeset/context`          … 刃組ガイダンス1画面ぶんを**1往復で**返す
  `POST /api/bladeset/seed`             … 図面どおりの初期セットを登録する
  `/api/bladeset-standard-master`       … 刃組基準値（1設備1行）の4本セット
  `/api/bladeset/history`               … 刃組を終えた記録（台車差分の材料）

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
                         'ゴムリング %d・フィンガー %d）。'
                         % (made['blade'], made['spacer'], made['ring'],
                            made['finger'])) if n
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
# 刃組履歴（台車差分の材料）
# =========================================================================
@bp.get('/api/bladeset/history')
@api_guard('刃組履歴の読込に失敗しました')
def bladeset_history_list():
 eq = _eq()
 return jsonify(ok=True, equipment=eq,
                items=_op_read(lambda c: bs.history_rows(c, False, eq or None)))


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
