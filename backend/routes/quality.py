"""quality.py: 品質データ分析API。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, request, jsonify

from ..db_access import DBS, cfg, connect, tables, cols, qi

bp=Blueprint('quality',__name__)

def first_existing(columns, names):
 for name in names:
  if name in columns:return name
 return None

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

@bp.get('/api/quality/analysis')
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
   cs=cols(c,table,source=cf['path'])
   if group_col not in cs:group_col=first_existing(cs,['発生設備','異常内容','登録日時']) or (cs[0] if cs else '')
   if value_col not in cs:value_col=first_existing(cs,['廃棄重量','廃却重量','ｽｸﾗｯﾌﾟ重量','スクラップ重量']) or ''
   if stack_col not in cs:stack_col=''
   if date_col not in cs:date_col=first_existing(cs,['登録日時','発生日','発生日時','保留設定日']) or ''
   cur=c.cursor()
   # SELECT TOP N はAccess専用構文でSQLiteでは構文エラーになる(engine='sqlite'は
   # sikalot_source=localやsikalotdef_pathで品質データをSQLiteへ切り替えた場合に
   # 発生する。tables.pyの/api/tableと同じくエンジンに応じて出し分ける)。
   if cf['engine']=='sqlite':cur.execute(f'SELECT * FROM {qi(table)} LIMIT {max_rows}')
   else:cur.execute(f'SELECT TOP {max_rows} * FROM {qi(table)}')
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
   stack_keys=[x['label'] for x in sorted(stack_totals.values(),key=lambda x:x[metric_key],reverse=True)[:8]]
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
