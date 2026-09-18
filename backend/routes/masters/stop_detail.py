"""masters/stop_detail.py: 設備停止の**内訳（サブカテゴリ）**と**時間の選択肢**
（§9.389、利用者の指示）。

  設備停止サブカテゴリマスタ … 刃組待ち → ゴムリング／フィンガー／刃出し
  設備停止時間マスタ         … 予定へ入れるときに選ばせる分の一覧（全設備共通）

**なぜ`routes/schedule.py`ではなくここか。** 設備停止まわりのAPIはあちらに
あるが、あちらは**41ルートで上限に張り付いている**（§9.333 の `PINNED`、
`tests/test_routesplit.py`。上げる更新はできない）。マスタのCRUDは
`masters/`の段が受け持つ、というのが§9.333の分け方そのものなので、
新しいマスタ2枚はここへ置く。

**Blueprintは`_base.py`の1つ（`masters`）**なので、書込ガードの鍵は
`masters.<関数名>`になる。設備停止マスタと同じく**スケジュールモードからも
書ける**必要があるため、`access_mode._ENDPOINT_EXTRA_MODES`へ8本とも
載せてある——載せ忘れると「マスタ管理から押しても403で黙って弾かれる」
（§CLAUDE 4）。

保存先は`db/master.sqlite3`で、開き方は`routes/common.py`の
`cfg_read`／`cfg_write_response`の1箇所（設備停止マスタと同じサイクル）。
"""
from flask import jsonify, request
from ..common import api_guard, cfg_read, cfg_write_response
from ...access_mode import request_user_id
from ..body import body, any_
from ...repositories import schedule_repo as sr
from ... import flags
from ._base import bp


# =====================================================================
# 設備停止サブカテゴリマスタ
# =====================================================================
def _sub_entry(r, parents):
 # r: サブカテゴリID,停止理由ID,名称,標準所要分,表示順,有効,更新日時,更新者ID,親サブカテゴリID,既定
 pid = int(r[1] or 0)
 p = parents.get(pid) or {}
 return {'id': r[0], 'stopReasonId': pid,
         # **親の名前も返す**（§9.163）——一覧は「どの設備停止の内訳か」を
         # 出す必要があり、画面が停止マスタを別に引いて突き合わせると
         # 「片方だけ古い」が起きる。
         'stopReasonName': p.get('name', ''),
         'stopReasonLabel': p.get('label', ''),
         # もう1階層（§9.390）。`parentSubId`が0なら1段目。
         # **深さも返す**——画面が0かどうかを数え直さずに段を描ける。
         'parentSubId': int(r[8] or 0),
         'depth': 2 if int(r[8] or 0) else 1,
         # 既定の内訳の印（§9.397）。**「1つしかないから既定」は含めない**——
         # ここは登録された印そのもので、当たる内訳は`defaults`が答える
         # （2つを混ぜると、印を外したのに既定のままに見える）。
         'isDefault': bool(r[9]) if len(r) > 9 else False,
         'name': r[2], 'standardMinutes': r[3], 'order': r[4],
         'updatedAt': r[6].isoformat() if r[6] else None,
         'updatedBy': str(r[7] or '')}


def _parents(mc):
 """{停止理由ID: {name,label,equipment,standardMinutes}}。"""
 out = {}
 for r in sr.stop_reason_rows(mc):
  out[int(r[0])] = {'name': str(r[3] or ''),
                    'equipment': str(r[1] or ''),
                    'equipmentLabel': sr.stop_equipment_label(r[1]),
                    'standardMinutes': r[4],
                    # 一覧の1行に出す文字。**設備が違えば同じ名前の停止が
                    # 並ぶ**ので、名前だけでは選べない（§CLAUDE 6）。
                    'label': f'{r[3] or ""}（{sr.stop_equipment_label(r[1])}）'}
 return out


@bp.get('/api/schedule/stop-sub-master')
@api_guard('設備停止サブカテゴリマスタの読込に失敗しました')
def stop_sub_list():
 pid = str(request.args.get('stopReasonId') or '').strip()

 def fn(mc):
  parents = _parents(mc)
  rows = sr.stop_sub_rows(mc, pid or None)
  return ([_sub_entry(r, parents) for r in rows],
          [dict(v, id=k) for k, v in sorted(parents.items(), key=lambda kv: kv[1]['label'])],
          sr.stop_default_sub_map(mc))
 items, parents, defaults = cfg_read(fn)
 # **選べる親はサーバーが答える**（§9.163）。盤は返ってきた一覧を並べるだけ。
 # `maxDepth`＝内訳の段の上限（§9.390）。画面へ数を書き写さない。
 # `defaults`＝最初から選ばれている内訳（§9.397）。鍵は`停止理由ID:親ID`。
 # **「1つしかない」も含めた答え**なので、画面は数え直さない（§9.163）
 # ——予定の登録画面とマスタ管理が別々に数えると、「既定」と出ている内訳と
 # 実際に選ばれる内訳が食い違う。
 return jsonify(ok=True, configured=True, items=items, stale=False, parents=parents,
                maxDepth=2, defaults=defaults)


def _sub_save(x, sub_id=None):

 def fn(mc):
  gid, created = sr.stop_sub_upsert(mc, x.get('stopReasonId'), x.get('name'),
                                    request_user_id(x),
                                    standard_minutes=x.get('standardMinutes'),
                                    sub_id=sub_id,
                                    parent_sub_id=x.get('parentSubId'),
                                    # **鍵が来ていないときは`None`**＝触らない
                                    # （§9.212 ②。名前を直しただけで既定が
                                    #  落ちると、直した人は何が起きたか分からない）。
                                    is_default=flags.flag_of(x.get('isDefault'))
                                    if x.sent('isDefault') else None)
  return {'id': gid, 'created': created}
 return cfg_write_response(fn)


@bp.post('/api/schedule/stop-sub-master')
def stop_sub_register():
 return _sub_save(body({'id': any_, 'stopReasonId': any_, 'name': str,
                        'standardMinutes': any_, 'parentSubId': any_,
                        'isDefault': any_}))


@bp.post('/api/schedule/stop-sub-master/update')
def stop_sub_update():
 x = body({'id': any_, 'stopReasonId': any_, 'name': str,
           'standardMinutes': any_, 'parentSubId': any_, 'isDefault': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _sub_save(x, sub_id=x.get('id'))


@bp.post('/api/schedule/stop-sub-master/delete')
def stop_sub_delete_route():
 x = body({'id': any_})
 sid = x.get('id')
 if sid is None:
  return jsonify(error='削除対象IDがありません。'), 400

 def fn(mc):
  if not sr.stop_sub_delete(mc, sid, request_user_id(x)):
   raise ValueError('指定のサブカテゴリが見つかりません。')
  return {'id': sid}
 return cfg_write_response(fn)


# =====================================================================
# 設備停止時間マスタ
# =====================================================================
def _minutes_entry(r):
 # r: 時間ID,分,表示順,有効,更新日時,更新者ID
 return {'id': r[0], 'minutes': r[1],
         'updatedAt': r[4].isoformat() if r[4] else None,
         'updatedBy': str(r[5] or '')}


@bp.get('/api/schedule/stop-minutes-master')
@api_guard('設備停止時間マスタの読込に失敗しました')
def stop_minutes_list():

 def fn(mc):
  return ([_minutes_entry(r) for r in sr.stop_minutes_rows(mc)], sr.stop_minutes_slider(mc))
 items, slider = cfg_read(fn)
 # スライダーの範囲は**選択肢そのものから**作る（§9.389）。別の設定値に
 # すると「選択肢には240分があるのにスライダーは120分で止まる」が起きる。
 # **書式（「1時間30分」）は返さない**——所要時間の書き方は`WL.duration`の
 # 1箇所が答える（§9.341）。
 return jsonify(ok=True, configured=True, items=items, stale=False, slider=slider)


def _minutes_save(x, minutes_id=None):

 def fn(mc):
  gid, created = sr.stop_minutes_upsert(mc, x.get('minutes'), request_user_id(x),
                                        minutes_id=minutes_id)
  return {'id': gid, 'created': created}
 return cfg_write_response(fn)


@bp.post('/api/schedule/stop-minutes-master')
def stop_minutes_register():
 return _minutes_save(body({'id': any_, 'minutes': any_}))


@bp.post('/api/schedule/stop-minutes-master/update')
def stop_minutes_update():
 x = body({'id': any_, 'minutes': any_})
 if x.get('id') in (None, ''):
  return jsonify(error='更新対象IDがありません。'), 400
 return _minutes_save(x, minutes_id=x.get('id'))


@bp.post('/api/schedule/stop-minutes-master/delete')
def stop_minutes_delete_route():
 x = body({'id': any_})
 mid = x.get('id')
 if mid is None:
  return jsonify(error='削除対象IDがありません。'), 400

 def fn(mc):
  if not sr.stop_minutes_delete(mc, mid, request_user_id(x)):
   raise ValueError('指定の時間が見つかりません。')
  return {'id': mid}
 return cfg_write_response(fn)
