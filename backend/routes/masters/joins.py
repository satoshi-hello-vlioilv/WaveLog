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
 # `useInSchedule`は**渡されなければ「使う」**(§9.365)。古い画面・古い網が
 # 送ってこなくても、既存の行の見え方が黙って変わらないようにする。
 sched=x.get('useInSchedule')
 return {'name':x.get('name'),'left':x.get('left'),'leftTable':x.get('leftTable'),
         'right':x.get('right'),'rightTable':x.get('rightTable'),
         'keys':x.get('keys'),'columns':x.get('columns'),'prefix':x.get('prefix'),
         'multi':x.get('multi'),'kind':x.get('kind'),'purpose':x.get('purpose'),
         'finishColumn':x.get('finishColumn'),
         'useInSchedule':True if sched is None else bool(sched),
         'order':x.get('order'),'enabled':x.get('enabled')}

# 受け取る鍵は3つのルートで同じ（§9.330。鍵は必ず宣言する）。
_JOIN_BODY={'columns': any_, 'enabled': any_, 'finishColumn': any_, 'keys': any_,
            'kind': any_, 'left': any_, 'leftTable': any_, 'multi': any_, 'name': any_,
            'order': any_, 'prefix': any_, 'purpose': any_, 'right': any_,
            'rightTable': any_, 'useInSchedule': any_}

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
 # 完了突合の既定の1件(§9.365)。データソースマスタの[突合キー]から名乗る
 # ので、**利用者が1件も登録していないときだけ**効いている。
 finish=query_join.builtin_finish_def()
 def _b(x):
  if not x:return None
  return {'name':x['name'],'left':x['left'],'right':x['right'],
          'leftTable':x.get('leftTable') or '','rightTable':x.get('rightTable') or '',
          'kind':x.get('kind') or query_join.JOIN_KIND_DEFAULT,
          'purpose':x.get('purpose') or query_join.PURPOSE_LIST,
          'finishColumn':x.get('finishColumn') or '',
          'multi':x.get('multi') or 'first','keys':x['keys']}
 return jsonify(ok=True,items=items,sources=sources,multiModes=list(QUERY_JOIN_MULTI),
                kinds=query_join.JOIN_KINDS,kindDefault=query_join.JOIN_KIND_DEFAULT,
                purposes=query_join.PURPOSES,purposeDefault=query_join.PURPOSE_LIST,
                builtinEnabled=query_join.builtin_quality_enabled(),
                builtin=_b(builtin),
                builtinFinish=_b(finish),
                # 既定の完了突合が「いま効いているか」。**有効な登録が1件でも
                # あれば効かない**（同じロットを2つの定義で探すと、当たった順で
                # 完了時刻が変わる）。判定は`finish_definitions()`と同じ線引き。
                builtinFinishActive=bool(finish) and not any(
                 d.get('purpose')==query_join.PURPOSE_FINISH and d.get('active')
                 for d in items))

@bp.post('/api/query-join-master')
@api_guard('クエリ結合の登録に失敗しました',bad=ValueError)
def query_join_master_register():
 x=body(_JOIN_BODY);uid=request_user_id(x)
 with connect(DBS['MASTER']['path'],False) as c:
  jid=query_join_save(c,_join_payload(x),uid)
 return jsonify(ok=True,id=jid,updated_by=uid,message='結合を登録しました。')

@bp.post('/api/query-join-master/update')
@api_guard('クエリ結合の保存に失敗しました',bad=ValueError)
def query_join_master_update():
 x=body(dict(_JOIN_BODY,id=any_));uid=request_user_id(x)
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
 x=body(dict(_JOIN_BODY,id=any_))
 # 用途の読み取りは`purpose_of()`の1箇所（知らない値は「一覧に列を足す」）。
 purpose=query_join.purpose_of({'purpose':x.get('purpose')})['key']
 d={'id':x.get('id'),'name':str(x.get('name') or '(下見)'),
    'left':str(x.get('left') or ''),'leftTable':str(x.get('leftTable') or ''),
    'right':str(x.get('right') or ''),'rightTable':str(x.get('rightTable') or ''),
    'keys':normalize_join_keys(x.get('keys')),
    'columns':normalize_join_columns(x.get('columns')),
    'prefix':str(x.get('prefix') or ''),'multi':str(x.get('multi') or 'first'),
    'kind':str(x.get('kind') or query_join.JOIN_KIND_DEFAULT),
    'purpose':purpose,'finishColumn':str(x.get('finishColumn') or ''),
    'active':True}
 if not d['keys']:
  return jsonify(ok=True,result={'ok':False,'reason':'突合キーを1組入れると、ここで結果を確かめられます。',
                                 'sampled':0,'matched':0,'ambiguous':0,'addedColumns':0,
                                 'addedColumnNames':[],'table':'','examples':[]}),200
 # **用途で見る場所が変わる**(§9.365)。完了突合が探すのは「仕掛から消えた」
 # ロットなので、いま仕掛にある行へ当てても0件にしかならない（相手の側を見る）。
 if d['purpose']==query_join.PURPOSE_FINISH:
  return jsonify(ok=True,result=query_join.probe_finish(d))
 return jsonify(ok=True,result=query_join.probe(d))
