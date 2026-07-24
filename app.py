from flask import Flask, render_template, request, jsonify
from pathlib import Path
import json, os, pyodbc, subprocess

app=Flask(__name__); BASE=Path(__file__).resolve().parent

from changelog_data import APP_VERSION, CHANGELOG
from db_access import DBS, MEAS_DB, DRIVER, qi, connect, cols, tables, cfg, ensure_audit_columns, request_user_id, ensure_backup_table
from masters import bp as masters_bp, hidden_columns_for_db, read_operator_names, read_spool_names, read_inner_names, read_device_names, ensure_operator_master, ensure_spool_master, ensure_inner_master, ensure_device_master, ensure_operator_equipment, OPERATOR_MASTER_TABLE, SPOOL_MASTER_TABLE, INNER_MASTER_TABLE, DEVICE_MASTER_TABLE
app.register_blueprint(masters_bp)


def _git_version():
 # 参考情報(ツールチップ用)。git非対応の配布環境では取得できないため
 # 失敗しても画面表示自体には影響しないようベストエフォートにする。
 try:
  rev=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  when=subprocess.check_output(['git','log','-1','--format=%cI'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip())
  return {'commit':rev,'commit_at':when,'dirty':dirty}
 except Exception:
  return {'commit':'','commit_at':'','dirty':False}
GIT_VERSION=_git_version()

@app.after_request
def no_cache(response):
 response.headers['Cache-Control']='no-store, no-cache, must-revalidate, max-age=0'
 response.headers['Pragma']='no-cache'
 response.headers['Expires']='0'
 return response

@app.get('/')
def home():
 asset_files=list((BASE/'static'/'js').glob('*.js'))+[BASE/'static'/'app.css']
 token=str(max(f.stat().st_mtime_ns for f in asset_files))
 return render_template('index.html', build='current', asset_token=token)
@app.get('/api/build')
def build(): return jsonify(build='current', version=APP_VERSION, feature='measurement-workflow-current', port=5029, **GIT_VERSION)
@app.get('/api/whoami')
def whoami():
 # この端末(各測定端末)で実行しているアプリのOSログインユーザー名を返す。
 # マスタ更新記録(登録者ID)に、手入力させず自動で使うためのもの。
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return jsonify(username=str(username or '').strip())
@app.get('/api/changelog')
def changelog(): return jsonify(version=APP_VERSION, entries=CHANGELOG)
@app.get('/api/catalog')
def catalog(): return jsonify(databases=[{"key":k,"label":v['label'],"file_name":v['path'].name,"role":v['role']} for k,v in DBS.items()])
@app.get('/api/tables')
def api_tables():
 try:
  k=request.args['db'];cf=cfg(k)
  with connect(cf['path'],cf['role']=='readonly') as c: a=tables(c)
  if cf['preferred'] in a:a=[cf['preferred']]+[x for x in a if x!=cf['preferred']]
  return jsonify(tables=a)
 except Exception as e:return jsonify(error=str(e)),500
@app.get('/api/table')
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
     parts.append(f'Val(CStr({col})) {sign} ?');params.append(value)
   return parts,params
  with connect(cf['path'],cf['role']=='readonly') as c:
   cs=cols(c,t);where_parts=[];params=[]
   if q:
    where_parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params += [f'%{q}%']*len(cs)
   filters=safe_filters(filter_payload,cs);fp,filter_params=build_filter_where(filters);where_parts += fp;params += filter_params
   where=(' WHERE '+' AND '.join(where_parts)) if where_parts else ''
   sort_col=request.args.get('sort','').strip();sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
   order=f' ORDER BY {qi(sort_col)} {sort_dir}' if sort_col in cs else ''
   cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {qi(t)}'+where,params);count=int(cur.fetchone()[0]);top=page*size;cur.execute(f'SELECT TOP {top} * FROM {qi(t)}'+where+order,params);rows=cur.fetchmany(top);start=(page-1)*size;rows=rows[start:start+size]
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
  return jsonify(columns=visible_cs,rows=row_dicts,count=count,filters_applied=len(filters))
 except Exception as e:return jsonify(error=str(e)),500

def first_existing(columns, names):
 for name in names:
  if name in columns:return name
 return None

@app.get('/api/measurement/context')
def measurement_context():
 try:
  lot=request.args.get('lot','').strip();equipment=request.args.get('equipment','').strip()
  result={'quality':[],'operators':[],'inspectors':[],'packers':[],'thickness_gauges':[],'width_gauges':[],'inner_diameters':[],'spools':[],'diagnostics':{'master_path':str(DBS['MASTER']['path']),'master_exists':DBS['MASTER']['path'].exists(),'tables':[],'matches':{}}}
  def norm(v):return str(v or '').strip()
  def matching_table(ts,aliases):
   for a in aliases:
    if a in ts:return a
   for t in ts:
    if any(a.lower() in t.lower() for a in aliases):return t
   return None
  def matching_col(cs,aliases):
   for a in aliases:
    if a in cs:return a
   for c in cs:
    if any(a.lower() in c.lower() for a in aliases):return c
   return None
  if lot and DBS['SIKALOTDEF']['path'].exists():
   with connect(DBS['SIKALOTDEF']['path'],True) as c:
    ts=tables(c);t=matching_table(ts,['仕掛','品質情報','品質','保留'])
    if t:
     cs=cols(c,t);lot_col=matching_col(cs,['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'])
     if lot_col:
      cur=c.cursor();cur.execute(f'SELECT TOP 50 * FROM {qi(t)} WHERE CStr({qi(lot_col)})=?',[lot]);rows=cur.fetchall()
      for row in rows:
       d=dict(zip(cs,row));result['quality'].append({k:norm(d.get(matching_col(cs,[k]) or k)) for k in ['発生設備','登録日時','異常内容','コメント','最終処置','保留設定日','保留解除']})
  master=DBS['MASTER']['path']
  if master.exists():
   # オペレータマスタの存在を保証してから読み取る。
   try:
    created=ensure_operator_master(master);result['diagnostics']['operator_master']={'created':created}
   except Exception as _e:result['diagnostics']['operator_master_error']=str(_e)
   # オペレータ設備マスタ（オペレータ×設備の割当）の存在を保証してから読み取る。
   try:
    oe_created=ensure_operator_equipment(master);result['diagnostics']['operator_equipment_master']={'created':oe_created}
   except Exception as _e:result['diagnostics']['operator_equipment_master_error']=str(_e)
   # スプール種別マスタの存在を保証してから読み取る。
   try:
    s_created=ensure_spool_master(master);result['diagnostics']['spool_master']={'created':s_created}
   except Exception as _e:result['diagnostics']['spool_master_error']=str(_e)
   # 内径種別マスタの存在を保証してから読み取る。
   try:
    i_created=ensure_inner_master(master);result['diagnostics']['inner_master']={'created':i_created}
   except Exception as _e:result['diagnostics']['inner_master_error']=str(_e)
   # 機器マスタの存在を保証してから読み取る。
   try:
    d_created=ensure_device_master(master);result['diagnostics']['device_master']={'created':d_created}
   except Exception as _e:result['diagnostics']['device_master_error']=str(_e)
   with connect(master,True) as c:
    ts=tables(c);result['diagnostics']['tables']=ts
    def read_values(table_aliases,col_aliases,extra=None):
     table=matching_table(ts,table_aliases)
     if not table:return []
     cs=cols(c,table);column=matching_col(cs,col_aliases)
     result['diagnostics']['matches']['/'.join(table_aliases)]={'table':table,'column':column,'columns':cs}
     if not column:return []
     sql=f'SELECT DISTINCT {qi(column)} FROM {qi(table)}';params=[];where=[]
     # VBAは設備=FaciNameだが、Webでは仕掛の設備文字列が複合値の場合があるため、完全一致で0件なら全件へフォールバック
     if equipment:
      equip_col=matching_col(cs,['設備','設備名','対象設備'])
      if equip_col:where.append(f'(CStr({qi(equip_col)})=? OR CStr({qi(equip_col)}) LIKE ?)');params += [equipment,f'%{equipment}%']
     if extra:
      for aliases,value in extra:
       col=matching_col(cs,aliases)
       if col:where.append(f'CStr({qi(col)})=?');params.append(value)
     cur=c.cursor()
     query=sql+(' WHERE '+' AND '.join(where) if where else '')
     cur.execute(query,params);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     if not values and where:cur.execute(sql);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     return sorted(set(values),key=str.casefold)
    # 読み取りはオペレータマスタ（有効・表示順）から行う。
    # オペレータ欄のみ、対象設備（equipment）で作業可能設備によるフィルタをかける。
    # 割当が1件もないオペレータは常に表示対象（互換ポリシー）。検査員・梱包員は従来通り全件。
    people=read_operator_names(c)
    people_for_equipment=read_operator_names(c,equipment=equipment) if equipment else people
    result['diagnostics']['matches']['オペレータマスタ']={'table':OPERATOR_MASTER_TABLE,'column':'氏名','count':len(people),'filtered_by_equipment':equipment or '','filtered_count':len(people_for_equipment)}
    result['operators']=people_for_equipment;result['inspectors']=people;result['packers']=people
    # 読み取りは機器マスタ（測定区分・有効・表示順）から行う。
    thickness_gauges=read_device_names(c,'板厚');width_gauges=read_device_names(c,'板幅')
    result['diagnostics']['matches']['機器マスタ']={'table':DEVICE_MASTER_TABLE,'column':'機器名','板厚':len(thickness_gauges),'板幅':len(width_gauges)}
    result['thickness_gauges']=thickness_gauges;result['width_gauges']=width_gauges
    # 読み取りは内径種別マスタ（有効・表示順）から行う。
    inners=read_inner_names(c)
    result['diagnostics']['matches']['内径種別マスタ']={'table':INNER_MASTER_TABLE,'column':'内径種別','count':len(inners)}
    result['inner_diameters']=inners
    # 読み取りはスプール種別マスタ（有効・表示順）から行う。
    spools=read_spool_names(c)
    result['diagnostics']['matches']['スプール種別マスタ']={'table':SPOOL_MASTER_TABLE,'column':'種別名','count':len(spools)}
    result['spools']=spools
  return jsonify(result)
 except Exception as e:return jsonify(error=str(e)),500

@app.get('/api/measurement/master-diagnostics')
def master_diagnostics():
 try:
  p=DBS['MASTER']['path'];out={'path':str(p),'exists':p.exists(),'size':p.stat().st_size if p.exists() else 0,'tables':{}}
  if p.exists():
   with connect(p,True) as c:
    for t in tables(c):out['tables'][t]=cols(c,t)
  return jsonify(out)
 except Exception as e:return jsonify(error=str(e)),500

@app.post('/api/measurement/backup')
def backup():
 try:
  x=request.get_json(force=True);required=['id','lotNo','payload'];missing=[k for k in required if not x.get(k)]
  if missing:return jsonify(error='必須項目不足: '+','.join(missing)),400
  with connect(MEAS_DB) as c:
   ensure_backup_table(c);cur=c.cursor();cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']]);cur.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,Now(),?,?)',[x['id'],x.get('equipment',''),x.get('lotNo',''),x.get('inspectionNo',''),x.get('castingNo',''),x.get('status','編集中'),x.get('codec','delimiter-v1'),x['payload']]);c.commit()
  return jsonify(ok=True,direction='IndexedDB -> 測定データ.sqlite3')
 except Exception as e:return jsonify(error=str(e)),500

@app.get('/api/measurement/backup/list')
def backup_list():
 # PC引継ぎ等でIndexedDBが空の端末へ、測定データ.sqlite3(Web測定バックアップ)から
 # インポートするための読み取り専用API。書き込みはせず、行をそのまま返す。
 # 実際のIndexedDBへの反映(JSON解凍・idbPut)はブラウザ側で行う。
 try:
  if not MEAS_DB.exists():return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(MEAS_DB))
  with connect(MEAS_DB,True) as c:
   if 'Web測定バックアップ' not in tables(c):
    return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(MEAS_DB))
   cur=c.cursor()
   cur.execute('SELECT [記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード] FROM [Web測定バックアップ] ORDER BY [更新日時] DESC')
   rows=cur.fetchall()
  items=[{'id':str(r[0] or ''),'equipment':str(r[1] or ''),'lotNo':str(r[2] or ''),'inspectionNo':str(r[3] or ''),'castingNo':str(r[4] or ''),'status':str(r[5] or ''),'updated_at':r[6].isoformat() if r[6] else None,'codec':str(r[7] or ''),'payload':str(r[8] or '')} for r in rows]
  return jsonify(ok=True,items=items,count=len(items),table_exists=True,meas_path=str(MEAS_DB))
 except Exception as e:return jsonify(error=f'測定データ読込失敗: {e}',meas_path=str(MEAS_DB)),500

# ========================================================================
# 品質データ分析 API
# - 任意カラムの件数集計
# - 文字列化された重量列の数値変換合計
# - 対象データのリスト返却
# ========================================================================
def _quality_to_text(value):
 if value is None:return ''
 try:
  if hasattr(value,'isoformat'):return value.isoformat(sep=' ')
 except TypeError:
  pass
 return str(value)

def _quality_parse_number(value):
 import re
 s=_quality_to_text(value).strip()
 if not s:return None
 s=s.translate(str.maketrans('０１２３４５６７８９．，－＋','0123456789.,-+'))
 s=s.replace(',','')
 m=re.search(r'[-+]?\d+(?:\.\d+)?',s)
 if not m:return None
 try:return float(m.group(0))
 except Exception:return None

def _quality_parse_datetime(value):
 from datetime import datetime
 s=_quality_to_text(value).strip()
 if not s:return None
 s=s.replace('T',' ').replace('/','-')
 s=s.translate(str.maketrans('０１２３４５６７８９：－／','0123456789:-/'))
 formats=('%Y-%m-%d %H:%M:%S','%Y-%m-%d %H:%M','%Y-%m-%d','%Y%m%d%H%M%S','%Y%m%d')
 for fmt in formats:
  try:return datetime.strptime(s[:len(datetime.now().strftime(fmt))],fmt)
  except Exception:pass
 return None

@app.get('/api/quality/analysis')
def quality_analysis():
 try:
  table=request.args.get('table','').strip() or DBS['SIKALOTDEF']['preferred']
  group_col=request.args.get('group_col','').strip()
  value_col=request.args.get('value_col','').strip()
  stack_col=request.args.get('stack_col','').strip()
  metric=request.args.get('metric','count').strip()
  date_col=request.args.get('date_col','').strip()
  start=request.args.get('start','').strip()
  end=request.args.get('end','').strip()
  q=request.args.get('search','').strip().casefold()
  bucket=request.args.get('bucket','day').strip() or 'day'
  dimension=request.args.get('dimension','category').strip() or 'category'
  max_rows=min(30000,max(100,int(request.args.get('max_rows',10000))))
  cf=cfg('SIKALOTDEF')
  start_dt=_quality_parse_datetime(start) if start else None
  end_dt=_quality_parse_datetime(end) if end else None
  def bucket_label(dt):
   if not dt:return '日付不明'
   if bucket=='year':return dt.strftime('%Y')
   if bucket=='month':return dt.strftime('%Y-%m')
   return dt.strftime('%Y-%m-%d')
  with connect(cf['path'],True) as c:
   available=tables(c)
   if table not in available:
    table=cf['preferred'] if cf['preferred'] in available else (available[0] if available else '')
   if not table:return jsonify(error='品質データのテーブルがありません。'),404
   cs=cols(c,table)
   if group_col not in cs:group_col=first_existing(cs,['発生設備','異常内容','登録日時']) or (cs[0] if cs else '')
   if value_col not in cs:value_col=first_existing(cs,['廃棄重量','廃却重量','ｽｸﾗｯﾌﾟ重量','スクラップ重量']) or ''
   if stack_col not in cs:stack_col=''
   if date_col not in cs:date_col=first_existing(cs,['登録日時','発生日','発生日時','保留設定日']) or ''
   cur=c.cursor();cur.execute(f'SELECT TOP {max_rows} * FROM {qi(table)}')
   raw=[dict(zip(cs,row)) for row in cur.fetchall()]
  filtered=[]
  for row in raw:
   if q and q not in ' '.join(_quality_to_text(row.get(c)).casefold() for c in cs):continue
   if date_col and (start_dt or end_dt):
    dt=_quality_parse_datetime(row.get(date_col))
    if start_dt and (not dt or dt<start_dt):continue
    if end_dt and (not dt or dt>end_dt):continue
   filtered.append(row)
  metric_key='sum' if metric=='sum' else 'count'
  agg={}; stack_map={}; stack_totals={}; series={}
  for row in filtered:
   dt=_quality_parse_datetime(row.get(date_col)) if date_col else None
   main_key=bucket_label(dt) if dimension=='time' else (_quality_to_text(row.get(group_col)).strip() or '未設定')
   num=_quality_parse_number(row.get(value_col)) if value_col else None
   item=agg.setdefault(main_key,{'label':main_key,'count':0,'sum':0.0})
   item['count']+=1
   if num is not None:item['sum']+=num
   if date_col:
    tkey=bucket_label(dt)
    s=series.setdefault(tkey,{'label':tkey,'count':0,'sum':0.0})
    s['count']+=1
    if num is not None:s['sum']+=num
   if stack_col:
    s_key=_quality_to_text(row.get(stack_col)).strip() or '未設定'
    cell=stack_map.setdefault(main_key,{}).setdefault(s_key,{'count':0,'sum':0.0})
    cell['count']+=1
    if num is not None:cell['sum']+=num
    total=stack_totals.setdefault(s_key,{'label':s_key,'count':0,'sum':0.0})
    total['count']+=1
    if num is not None:total['sum']+=num
  items=list(agg.values())
  if dimension=='time':items=sorted(items,key=lambda x:x['label'])
  else:items=sorted(items,key=lambda x:x[metric_key],reverse=True)
  stack_keys=[]
  if stack_col:
   stack_keys=[x['label'] for x in sorted(stack_totals.values(),key=lambda x:x[metric_key],reverse=True)[:12]]
   for item in items:
    raw_stacks=stack_map.get(item['label'],{})
    stacks={}; other={'count':0,'sum':0.0}
    for key,val in raw_stacks.items():
     if key in stack_keys:stacks[key]=val
     else:
      other['count']+=val.get('count',0);other['sum']+=val.get('sum',0.0)
    if other['count'] or other['sum']:
     stacks['その他']=other
     if 'その他' not in stack_keys:stack_keys.append('その他')
    item['stacks']=stacks
  preferred=['登録日時','発生設備','異常内容','廃棄重量','コメント','最終処置','保留設定日','保留解除']
  list_cols=[c for c in preferred if c in cs]
  if not list_cols:list_cols=cs[:8]
  rows=[{c:_quality_to_text(row.get(c)) for c in list_cols} for row in filtered[:1500]]
  return jsonify(ok=True,table=table,columns=cs,group_col=group_col,value_col=value_col,stack_col=stack_col,date_col=date_col,metric=metric_key,total=len(filtered),items=items[:200],series=sorted(series.values(),key=lambda x:x['label'])[:200],stack_keys=stack_keys,list_columns=list_cols,rows=rows,source_rows=len(raw),max_rows=max_rows,bucket=bucket,dimension=dimension)
 except Exception as e:return jsonify(error=f'品質データ分析失敗: {str(e)}'),500

if __name__=='__main__': app.run(host='127.0.0.1',port=5029,debug=False)
