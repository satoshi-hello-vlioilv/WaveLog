"""tables.py: 汎用DB一覧API — カタログ/テーブル一覧/データ取得(フィルタ・検索・並替)。

app.pyから移設(Phase 3)。移設後、db=MASTER(SQLite)に対してのみ以下を修正した
(db=SIKALOTNOW/SIKALOTDEF(Access)側の挙動は変更していない):
  - 一覧取得(SELECT TOP N)がAccess専用構文でSQLiteでは構文エラーになる
    不具合。エンジンに応じてLIMITへ出し分けるようにした。
  - 検索・フィルタで使うCStr()/Val()がAccess専用のSQL関数で、SQLite
    接続には存在せず"no such function"で失敗する不具合。db_access.pyへ
    ユーザー定義関数として登録し吸収した。
  - 上記Val()経由の数値範囲フィルタ(gt/gte/lt/lte)で、SQLiteは値の
    ストレージクラス優先で比較するため、Val()が返す数値と文字列
    パラメータを比べると常に不成立になる不具合。SQLite接続時のみ
    パラメータ側もPython側で数値化してから渡すようにした。
"""
import json, re
from flask import Blueprint, request, jsonify

from ..db_access import DBS, qi, connect, cols, tables, cfg
from ..repositories.master_repo import hidden_columns_for_db

bp=Blueprint('tables',__name__)

def _numeric_value(value):
 # SQLiteのVal(?)相当。先頭の数値部分を取り出す(見つからなければ0)。
 m=re.match(r'^\s*[+-]?\d+(\.\d+)?',str(value or ''))
 return float(m.group(0)) if m else 0.0

# ========================================================================
# 品質データの結合表示(§9.21新設): スケジュールモードの仕掛一覧(分割/
# ポップアップ表示)だけで、ロット番号+鋳造番号+製造材質をキーに品質データ
# (SIKALOTDEF)を突合し、列をアプリ側でマージする。SIKALOTNOWとSIKALOTDEFは
# 別々のAccess/SQLite接続先(CLAUDE.mdのDBエンジン使い分け参照)のため、単一
# のSQL JOINでは書けず、ここでPython側で結合する。既定のSIKALOTNOW単独表示
# には一切影響しないよう、明示的なjoin_quality=1指定時のみ動く(オプトイン)。
# ========================================================================
_JOIN_KEY_ALIASES={
 'lotNo':['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'],
 'castingNo':['鋳造番号','CYNO'],
 'mfgMaterial':['製造材質','LTA'],
}
def _find_column(columns,aliases):
 for a in aliases:
  if a in columns:return a
 for c in columns:
  if any(a.lower() in c.lower() for a in aliases):return c
 return None

def _join_quality_data(sikalotnow_cols,row_dicts):
 """戻り値: (結合後の列名リスト, 結合後の行dictリスト)。重複する列名は
 仕掛(SIKALOTNOW)側の値を優先する(現在値としての信頼度が高い運用のため)。
 品質データ側が未接続・キー列が見つからない・接続に失敗した場合は何も
 せず素通しする(fail-open、通常の仕掛一覧表示自体は壊さない)。"""
 lot_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['lotNo'])
 cast_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['castingNo'])
 mat_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['mfgMaterial'])
 if not (lot_col and cast_col and mat_col):return sikalotnow_cols,row_dicts
 def key_of(d):
  return (str(d.get(lot_col) or '').strip(),str(d.get(cast_col) or '').strip(),str(d.get(mat_col) or '').strip())
 keys=[key_of(d) for d in row_dicts]
 lot_values=sorted({k[0] for k in keys if all(k)})
 if not lot_values:return sikalotnow_cols,row_dicts
 try:
  def_cfg=DBS['SIKALOTDEF']
  if not def_cfg['path'].exists():return sikalotnow_cols,row_dicts
  with connect(def_cfg['path'],True) as c:
   def_tables=tables(c)
   t=def_cfg['preferred'] if def_cfg['preferred'] in def_tables else (def_tables[0] if def_tables else None)
   if not t:return sikalotnow_cols,row_dicts
   def_cols=cols(c,t)
   d_lot=_find_column(def_cols,_JOIN_KEY_ALIASES['lotNo'])
   d_cast=_find_column(def_cols,_JOIN_KEY_ALIASES['castingNo'])
   d_mat=_find_column(def_cols,_JOIN_KEY_ALIASES['mfgMaterial'])
   if not (d_lot and d_cast and d_mat):return sikalotnow_cols,row_dicts
   # ロット番号だけでSQL側を軽く絞り、鋳造番号・製造材質の正確な一致は
   # Python側で行う(複合IN条件はAccess/SQLite両対応で書きにくいため)。
   placeholders=','.join('?' for _ in lot_values)
   cur=c.cursor()
   cur.execute(f'SELECT * FROM {qi(t)} WHERE CStr({qi(d_lot)}) IN ({placeholders})',lot_values)
   quality_index={}
   for row in cur.fetchall():
    dd=dict(zip(def_cols,row))
    qkey=(str(dd.get(d_lot) or '').strip(),str(dd.get(d_cast) or '').strip(),str(dd.get(d_mat) or '').strip())
    if qkey in quality_index:continue  # 同一キーが複数行あれば最初の1件のみ使う
    quality_index[qkey]=dd
 except Exception:
  return sikalotnow_cols,row_dicts
 extra_cols=[c for c in def_cols if c not in sikalotnow_cols]
 merged_rows=[]
 for d,key in zip(row_dicts,keys):
  qd=quality_index.get(key)
  merged=dict(qd) if qd else {}
  merged.update(d)  # 重複列は仕掛(SIKALOTNOW)側を優先
  merged_rows.append(merged)
 return sikalotnow_cols+extra_cols,merged_rows

@bp.get('/api/catalog')
def catalog(): return jsonify(databases=[{"key":k,"label":v['label'],"file_name":v['path'].name,"role":v['role']} for k,v in DBS.items()])
@bp.get('/api/tables')
def api_tables():
 try:
  k=request.args['db'];cf=cfg(k)
  with connect(cf['path'],cf['role']=='readonly') as c: a=tables(c)
  if cf['preferred'] in a:a=[cf['preferred']]+[x for x in a if x!=cf['preferred']]
  return jsonify(tables=a)
 except Exception as e:return jsonify(error=str(e)),500
@bp.get('/api/table')
def api_table():
 try:
  k=request.args['db'];t=request.args['table'];page=max(1,int(request.args.get('page',1)));size=min(500,max(50,int(request.args.get('page_size',200))));q=request.args.get('search','').strip();cf=cfg(k)
  filter_payload=request.args.get('filters','').strip()
  def safe_filters(text,columns):
   if not text:return []
   try:items=json.loads(text)
   except Exception:return []
   if not isinstance(items,list):return []
   allowed_ops={'contains','not_contains','eq','neq','starts','ends','gt','gte','lt','lte','empty','not_empty'}
   out=[]
   for item in items[:20]:
    if not isinstance(item,dict):continue
    col=str(item.get('column') or '').strip();op=str(item.get('op') or 'contains').strip();value=str(item.get('value') or '').strip()
    if col in columns and op in allowed_ops:out.append({'column':col,'op':op,'value':value})
   return out
  def build_filter_where(filters):
   parts=[];params=[]
   for f in filters:
    col=qi(f['column']);op=f['op'];value=f['value']
    if op=='contains':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}%')
    elif op=='not_contains':parts.append(f'(CStr({col}) NOT LIKE ? OR {col} IS NULL)');params.append(f'%{value}%')
    elif op=='eq':parts.append(f'CStr({col})=?');params.append(value)
    elif op=='neq':parts.append(f'(CStr({col})<>? OR {col} IS NULL)');params.append(value)
    elif op=='starts':parts.append(f'CStr({col}) LIKE ?');params.append(f'{value}%')
    elif op=='ends':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}')
    elif op=='empty':parts.append(f'({col} IS NULL OR CStr({col})=\'\')')
    elif op=='not_empty':parts.append(f'({col} IS NOT NULL AND CStr({col})<>\'\')')
    elif op in ('gt','gte','lt','lte'):
     sign={"gt":'>',"gte":'>=',"lt":'<',"lte":'<='}[op]
     parts.append(f'Val(CStr({col})) {sign} ?')
     # SQLiteは値の型(ストレージクラス)優先で比較するため、REALを返す
     # Val()の結果と文字列パラメータを比べると常にREAL<TEXT扱いで不成立に
     # なる。SQLite接続時のみパラメータ側もこちらで数値化してから渡す
     # (Access接続は元々パラメータの型に関わらず数値として比較されるため、
     # 挙動を変えないよう文字列のまま渡す)。
     params.append(_numeric_value(value) if cf['engine']=='sqlite' else value)
   return parts,params
  with connect(cf['path'],cf['role']=='readonly') as c:
   cs=cols(c,t);where_parts=[];params=[]
   if q:
    where_parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params += [f'%{q}%']*len(cs)
   filters=safe_filters(filter_payload,cs);fp,filter_params=build_filter_where(filters);where_parts += fp;params += filter_params
   where=(' WHERE '+' AND '.join(where_parts)) if where_parts else ''
   sort_col=request.args.get('sort','').strip();sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
   order=f' ORDER BY {qi(sort_col)} {sort_dir}' if sort_col in cs else ''
   cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {qi(t)}'+where,params);count=int(cur.fetchone()[0]);top=page*size
   # TOP N はAccess専用構文でSQLite(マスタ)には無いため、接続先エンジンで
   # 出し分ける。件数の頭からtop件を取り、Python側でページ分だけ切り出す
   # 挙動(rows[start:start+size])はどちらのエンジンでも同じにする。
   if cf['engine']=='sqlite':
    cur.execute(f'SELECT * FROM {qi(t)}'+where+order+f' LIMIT {top}',params)
   else:
    cur.execute(f'SELECT TOP {top} * FROM {qi(t)}'+where+order,params)
   rows=cur.fetchmany(top);start=(page-1)*size;rows=rows[start:start+size]
  # 表示マスタで非表示指定された列は、検索/絞込/並替の対象(cs)には残しつつ、
  # 返却するcolumns/rowsからのみ除外する(生の行タプルはcs全体の順序と対応するため、
  # zip自体はcs全体で行い、その後に非表示列をdictから取り除く)。
  # include_hidden=1が指定された場合は除外しない。一覧の表示設定はあくまで
  # 画面上の見た目の好みであり、条割(分割)機能など内部計算が特定の列の
  # 実データに依存する場面では、非表示設定によってデータ自体が欠落しては
  # ならないため(一覧を出す通常のリクエストでは指定しない)。
  hidden=set() if request.args.get('include_hidden')=='1' else hidden_columns_for_db(k)
  row_dicts=[dict(zip(cs,r)) for r in rows]
  visible_cs=[x for x in cs if x not in hidden] if hidden else cs
  if hidden:row_dicts=[{col:v for col,v in d.items() if col not in hidden} for d in row_dicts]
  if k=='SIKALOTNOW' and request.args.get('join_quality')=='1':
   visible_cs,row_dicts=_join_quality_data(visible_cs,row_dicts)
  return jsonify(columns=visible_cs,rows=row_dicts,count=count,filters_applied=len(filters))
 except Exception as e:return jsonify(error=str(e)),500
