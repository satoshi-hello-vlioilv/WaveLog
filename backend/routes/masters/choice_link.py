"""masters/choice_link.py: 選択肢リンクマスタ。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from flask import jsonify
from ..common import api_guard
from ...flags import flag_of, text_or
from ...access_mode import request_user_id
from ..body import body, any_
from ._base import bp, _op_read


# ---------------------------------------------------------------------
# 選択肢リンクマスタ（§9.306）。汎用CRUDの4本セット。
# **語彙（まとまりの一覧）と判定はサーバーが答える**（§9.163）——盤は
# 返ってきた木を描くだけで、1段だけの規則を画面に書き写さない。
# ---------------------------------------------------------------------
@bp.get('/api/choice-link-master')
@api_guard('選択肢リンクマスタの読込に失敗しました')
def choice_link_list():
 from ...repositories import operation_repo as op
 def fn(c):
  links=op.choice_links(c,True)
  names=op.choice_names(c)
  child_of={x['child'] for x in links}
  parent_of={x['parent'] for x in links}
  rows=[]
  for x in links:
   rows.append({**x,
                # **件数はサーバーが数える**（盤で数え直さない）。
                'parentCount':len(op.choice_values(c,x['parent'])),
                'childCount':len(op.choice_values(c,x['child']))})
  return {'items':rows,'names':names,
          # **繋げるかどうかもサーバーが答える**——1段だけの規則は
          # `choice_link_upsert()`が持っているので、盤は理由を出すだけ。
          'groups':[{'name':n,'isChild':n in child_of,'isParent':n in parent_of,
                     'count':len(op.choice_values(c,n))} for n in names]}
 return jsonify(ok=True,**_op_read(fn))

@api_guard('選択肢リンクマスタの保存に失敗しました',bad=ValueError)
def _choice_link_save(x):
 from ...repositories import operation_repo as op
 uid=request_user_id(x)
 def fn(c):
  return op.choice_link_upsert(c,x.get('parent'),x.get('child'),uid,
                               note=x.get('note'),
                               enabled=flag_of(text_or(x,'enabled')),
                               link_id=(int(x['id']) if x.get('id') not in (None,'') else None))
 return jsonify(ok=True,id=_op_read(fn),message='親子を保存しました。')

@bp.post('/api/choice-link-master')
def choice_link_register():
 return _choice_link_save(body({'child': any_, 'enabled': any_, 'enabledText': any_, 'id': any_, 'note': any_, 'parent': any_}))

@bp.post('/api/choice-link-master/update')
def choice_link_update():
 x=body({'child': any_, 'enabled': any_, 'enabledText': any_, 'id': any_, 'note': any_, 'parent': any_})
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _choice_link_save(x)

@bp.post('/api/choice-link-master/delete')
@api_guard('選択肢リンクマスタの削除に失敗しました')
def choice_link_delete_route():
 from ...repositories import operation_repo as op
 x=body({'id': any_})
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 def fn(c):
  op.choice_link_delete(c,int(x['id']));return True
 _op_read(fn)
 # **値の`[親の値]`は消さない**（また繋げば続きから使える）ので、そのことを言う。
 return jsonify(ok=True,message='親子を外しました（値に入れた「親の値」は残しています）。')
