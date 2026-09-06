"""masters/joins.py: クエリ結合マスタ。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from flask import jsonify
from ..common import api_guard
from ...db_access import DBS, connect
from ...access_mode import request_user_id
from ..body import body, any_
from ._base import bp
from ...repositories.master_repo import (
 QUERY_JOIN_MULTI,
 ensure_query_join_table,
 query_joins,
 query_join_save,
 query_join_delete,
)


# ========================================================================
# クエリ結合マスタ(§9.193): データソース同士を突合キーでつなぐ
# ------------------------------------------------------------------------
# 実際の突合は backend/query_join.py の1箇所。ここは受付と、**保存する前に
# 確かめる**(probe)だけを持つ。読み込み先は起動時に1回だけ決まるので、
# 下見が無いと打ち間違いに気づけるのが再起動のあとになる(§9.168と同じ作法)。
# ========================================================================
def _join_payload(x):
 return {'name':x.get('name'),'left':x.get('left'),'leftTable':x.get('leftTable'),
         'right':x.get('right'),'rightTable':x.get('rightTable'),
         'keys':x.get('keys'),'columns':x.get('columns'),'prefix':x.get('prefix'),
         'multi':x.get('multi'),'kind':x.get('kind'),
         'order':x.get('order'),'enabled':x.get('enabled')}

@bp.get('/api/query-join-master')
@api_guard('クエリ結合マスタ読込失敗')
def query_join_master_list():
 from ... import query_join
 from ...db_access import DBS as _DBS
 path=DBS['MASTER']['path']
 items=[]
 if path.exists():
  with connect(path,False) as c:
   ensure_query_join_table(c)
   items=query_joins(c,include_disabled=True)
 # 選べる相手は**データ接続に登録済みのものだけ**(§9.193、利用者の指示)。
 # 画面が別に一覧を作ると、消したデータソースが選択肢に残る。
 sources=[{'key':k,'label':v.get('label') or k,'purpose':v.get('purpose') or '',
           'listed':bool(v.get('listed',True)),'preferred':v.get('preferred') or ''}
          for k,v in _DBS.items() if v.get('role')=='readonly']
 # 既定の品質データ結合は**解除していても内容を返す**(§9.194)。
 # 「どうつないでいるのか」を見て真似できることが値打ちなので、
 # 解除＝見えなくする、にはしない（利用者の指示）。
 builtin=query_join.builtin_quality_def()
 return jsonify(ok=True,items=items,sources=sources,multiModes=list(QUERY_JOIN_MULTI),
                kinds=query_join.JOIN_KINDS,kindDefault=query_join.JOIN_KIND_DEFAULT,
                builtinEnabled=query_join.builtin_quality_enabled(),
                builtin=({'name':builtin['name'],'left':builtin['left'],'right':builtin['right'],
                          'leftTable':builtin.get('leftTable') or '',
                          'rightTable':builtin.get('rightTable') or '',
                          'kind':builtin.get('kind') or query_join.JOIN_KIND_DEFAULT,
                          'multi':builtin.get('multi') or 'first',
                          'keys':builtin['keys']} if builtin else None))

@bp.post('/api/query-join-master')
@api_guard('クエリ結合の登録に失敗しました',bad=ValueError)
def query_join_master_register():
 x=body({'columns': any_, 'enabled': any_, 'keys': any_, 'kind': any_, 'left': any_, 
          'leftTable': any_, 'multi': any_, 'name': any_, 'order': any_, 
          'prefix': any_, 'right': any_, 'rightTable': any_});uid=request_user_id(x)
 with connect(DBS['MASTER']['path'],False) as c:
  jid=query_join_save(c,_join_payload(x),uid)
 return jsonify(ok=True,id=jid,updated_by=uid,message='結合を登録しました。')

@bp.post('/api/query-join-master/update')
@api_guard('クエリ結合の保存に失敗しました',bad=ValueError)
def query_join_master_update():
 x=body({'columns': any_, 'enabled': any_, 'id': any_, 'keys': any_, 'kind': any_, 
          'left': any_, 'leftTable': any_, 'multi': any_, 'name': any_, 
          'order': any_, 'prefix': any_, 'right': any_, 'rightTable': any_});uid=request_user_id(x)
 jid=x.get('id')
 if jid is None or str(jid).strip()=='':return jsonify(error='更新対象IDがありません。'),400
 with connect(DBS['MASTER']['path'],False) as c:
  query_join_save(c,_join_payload(x),uid,jid=int(jid))
 return jsonify(ok=True,id=int(jid),updated_by=uid,message='結合を保存しました。')

@bp.post('/api/query-join-master/delete')
@api_guard('クエリ結合の削除に失敗しました')
def query_join_master_delete():
 x=body({'id': any_});uid=request_user_id(x)
 jid=x.get('id')
 if jid is None or str(jid).strip()=='':return jsonify(error='削除対象IDがありません。'),400
 with connect(DBS['MASTER']['path'],False) as c:
  n=query_join_delete(c,int(jid))
 return jsonify(ok=True,deleted=n,updated_by=uid,
                message='結合を削除しました。' if n else '対象が見つかりませんでした。')

@bp.post('/api/query-join-master/builtin')
@api_guard('既定の結合を切り替えられませんでした')
def query_join_master_builtin():
 """既定の品質データ結合を使う／使わない(§9.194、利用者の指示)。

 **解除してもエラーにしない**——足していた列が出なくなるだけで、その列を
 参照していた設定（列レイアウト・フィルタ）は「無い列」として静かに落ちる。
 保存先はパス設定マスタの1行なので、**再起動は要らない**。"""
 from ... import query_join
 from ...db_access import set_path_config
 x=body({'enabled': any_});uid=request_user_id(x)
 on=x.get('enabled')
 on=(str(on).strip().lower() not in ('0','false','off','no','無効')) if on is not None else True
 with connect(DBS['MASTER']['path'],False) as c:
  set_path_config(c,query_join.BUILTIN_QUALITY_SWITCH_KEY,'' if on else 'off',uid)
 return jsonify(ok=True,enabled=on,updated_by=uid,
                message='既定の品質データ結合を使います。' if on
                        else '既定の品質データ結合を解除しました。品質の列は一覧に出なくなります。')

@bp.post('/api/query-join-master/probe')
@api_guard('下見に失敗しました')
def query_join_master_probe():
 """保存する前に、いまのデータで実際に当ててみる。**読むだけ**。"""
 from ... import query_join
 from ...repositories.master_repo import normalize_join_keys, normalize_join_columns
 x=body({'columns': any_, 'id': any_, 'keys': any_, 'kind': any_, 'left': any_, 
          'leftTable': any_, 'multi': any_, 'name': any_, 'prefix': any_, 
          'right': any_, 'rightTable': any_})
 d={'id':x.get('id'),'name':str(x.get('name') or '(下見)'),
    'left':str(x.get('left') or ''),'leftTable':str(x.get('leftTable') or ''),
    'right':str(x.get('right') or ''),'rightTable':str(x.get('rightTable') or ''),
    'keys':normalize_join_keys(x.get('keys')),
    'columns':normalize_join_columns(x.get('columns')),
    'prefix':str(x.get('prefix') or ''),'multi':str(x.get('multi') or 'first'),
    'kind':str(x.get('kind') or query_join.JOIN_KIND_DEFAULT),
    'active':True}
 if not d['keys']:
  return jsonify(ok=True,result={'ok':False,'reason':'突合キーを1組入れると、ここで結果を確かめられます。',
                                 'sampled':0,'matched':0,'ambiguous':0,'addedColumns':0,
                                 'addedColumnNames':[],'table':'','examples':[]}),200
 return jsonify(ok=True,result=query_join.probe(d))
