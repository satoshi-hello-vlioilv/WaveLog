"""filter_sql.py: 一覧の絞り込みの条件 → SQL の WHERE（§9.628 で routes/tables.py から切り出した）。

**答えはここ1箇所**——一覧（`/api/table`）・スライサー・色付けの数・ダッシュボードの集計（`backend/dashboard/pivot.py`）が
同じ読み方・同じ SQL を使う（同じ条件で一覧と集計の件数が食い違わない）。

条件は `[{column, op, value}]`。op:
    字   … contains・not_contains・eq・neq・starts・starts_any（先頭のどれか・`,`区切り）・ends・empty・not_empty
    数   … gt・gte・lt・lte（`NumOf()`＝`sort_order.num_of()`で読む・§9.581）
    値   … in・not_in（値の並び。`key`＝date/month/year なら日付と読める値をその形にそろえて比べる）
    日付 … within_days・within_weeks・within_months・within_years（今日から N 単位以内）・date_range（'YYYY-MM-DD..YYYY-MM-DD'）
    組   … tuple_in（計算列のスライサー: 式が読む列の値の組のどれか）
計算列（ダッシュボード）は `exprs`（列の名前 → SQL の式）で渡す。式は呼ぶ側が接続へ登録してある（`dashboard/formula.register()`）。
"""
import json
import re
from datetime import date, timedelta

from .sqlite_io import qi
from .sort_order import num_of
from .quiet import quiet

IN_MAX=1000         # 「どれかと同じ」の値の数の上限（スライサー・値の一覧・ダッシュボードのパネルのスライサー）
FILTERS_MAX=60      # 1回の問い合わせで当てる条件の数の上限。越えたぶんは`ignored_filter_columns()`が名乗る（§9.614）
TUPLE_COLUMNS_MAX=4 # 計算列のスライサーが渡す列の数の上限
SLICE_KEYS=('date','month','year')
RELATIVE_OPS={'within_days':'days','within_weeks':'weeks','within_months':'months','within_years':'years'}
ALLOWED_OPS={'contains','not_contains','eq','neq','starts','starts_any','ends','gt','gte','lt','lte','empty','not_empty','in','not_in',
             'date_range','tuple_in',*RELATIVE_OPS}


def _items(text):
 if not text:return []
 if isinstance(text,list):return text
 try:items=json.loads(text)
 except (TypeError,ValueError) as _e:quiet('保存された値を読めない（既定で続ける）',_e);return []
 return items if isinstance(items,list) else []


def safe_filters(text,columns,calc=()):
 """画面から来た条件（JSON の字か並び）→ 当てられる条件の並び。列が表に無い条件は落とす（落とした列は`ignored_filter_columns()`が言う）。
    calc … 計算列の名前（ダッシュボード。式は`build_filter_where()`の`exprs`で渡す）。"""
 known=set(columns)|set(calc or ())
 out=[]
 for item in _items(text)[:FILTERS_MAX]:
  if not isinstance(item,dict):continue
  col=str(item.get('column') or '').strip();op=str(item.get('op') or 'contains').strip()
  raw=item.get('value')
  if op=='tuple_in':
   cols=[str(x) for x in item.get('columns')] if isinstance(item.get('columns'),list) else []
   if 1<=len(cols)<=TUPLE_COLUMNS_MAX and len(set(cols))==len(cols) and all(c in known for c in cols):
    out.append({'column':col,'op':op,'value':raw if isinstance(raw,str) else json.dumps(raw if isinstance(raw,list) else [],ensure_ascii=False),'columns':cols})
   continue
  # 「どれかと同じ」（`in`・§9.591 スライサー）は値の並び。字で来ても並びで来ても受け、JSONの字にそろえる。
  value=json.dumps([str(x) for x in raw][:IN_MAX],ensure_ascii=False) if op in ('in','not_in') and isinstance(raw,list) else str(raw if raw is not None else '').strip()
  if col in known and op in ALLOWED_OPS:
   f={'column':col,'op':op,'value':value}
   if op in ('in','not_in') and item.get('key') in SLICE_KEYS:f['key']=item['key']
   out.append(f)
 return out


def _in_values(value):
 try:vals=[str(x) for x in json.loads(value)][:IN_MAX] if value else []
 except (TypeError,ValueError):vals=[]
 return vals


def slice_key(col,key=''):
 """値を選ぶ条件の比べる形。日付・年月・年で見せている列は日付と読める値をその形に（読めない値はそのまま）。"""
 if key not in SLICE_KEYS:return f'CStr({col})'
 head={'date':f'ToDate({col})','month':f'SUBSTR(ToDate({col}),1,7)','year':f'SUBSTR(ToDate({col}),1,4)'}[key]
 return f'COALESCE({head},CStr({col}))'


def _in_where(col,op,value,key=''):
 """「どれかと同じ」（`in`）と「どれか以外」（`not_in`・§9.614）。空の字は「空欄」（NULL も''も）。"""
 vals=_in_values(value)
 words=[v for v in vals if v!='']
 k=slice_key(col,key)
 alts=[f'{k} IN ('+','.join('?'*len(words))+')'] if words else []
 if '' in vals:alts.append(f'({col} IS NULL OR CStr({col})=\'\')')
 hit='('+' OR '.join(alts)+')' if alts else '0=1'
 if op=='in':return hit,words
 if not alts:return '1=1',words             # 何も外していない＝全部に当たる
 if '' in vals:return f'NOT {hit}',words    # 空欄も外した
 return f'(NOT {hit} OR {col} IS NULL)',words   # NULL の NOT IN は不明になるので、空欄は残すと書く


def date_range(value):
 """date_range の値（'YYYY-MM-DD..YYYY-MM-DD'。片側は空でもよい）→ (始め, 終わり)。読めない側は None（その側は限らない）。"""
 def one(x):
  x=x.strip()
  if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}',x):return None
  try:return date.fromisoformat(x).isoformat()
  except ValueError:return None
 head,_,tail=str(value or '').partition('..')
 return one(head),one(tail)


def cutoff_date(op,value,today=None):
 """「今日から N 単位前」の日付（'YYYY-MM-DD'）。N は 0 以上の整数（0＝今日から）。"""
 today=today or date.today()
 try:n=max(0,int(float(str(value).strip())))
 except ValueError:n=0
 unit=RELATIVE_OPS[op]
 if unit=='days':return (today-timedelta(days=n)).isoformat()
 if unit=='weeks':return (today-timedelta(weeks=n)).isoformat()
 months=n*(12 if unit=='years' else 1)
 y,m=divmod(today.year*12+today.month-1-months,12);m+=1
 last=(date(y+(m==12),m%12+1,1)-timedelta(days=1)).day
 return date(y,m,min(today.day,last)).isoformat()


def _tuple_where(f):
 """値の組のどれか（IS で比べる＝空の組も当たる）。"""
 cols=[qi(x) for x in f['columns']]
 try:items=json.loads(f['value']) if f['value'] else []
 except (TypeError,ValueError):items=[]
 ok=(str,int,float,type(None))
 tuples=[t for t in (items if isinstance(items,list) else []) if isinstance(t,list) and len(t)==len(cols)
         and all(isinstance(x,ok) and not isinstance(x,bool) for x in t)][:IN_MAX]
 one='('+' AND '.join(f'{x} IS ?' for x in cols)+')'
 return ('('+' OR '.join([one]*len(tuples))+')' if tuples else '0=1'),[v for t in tuples for v in t]


def _starts_any(col,value):
 # 「この先頭のどれかで始まる」(§9.94)。1ページに数十の先頭が並ぶので、まとめて1回で引く。
 vals=[x for x in (value.split(',') if value else []) if x][:60]
 if not vals:return '0=1',[]
 return '('+' OR '.join(f'CStr({col}) LIKE ?' for _ in vals)+')',[f'{v}%' for v in vals]


def _date_where(col,op,value,today):
 if op=='date_range':
  # 日付と読める値だけが当たる（両側とも読めなければ、日付と読める行すべて）
  lo,hi=date_range(value)
  return '('+' AND '.join([f'ToDate({col}) IS NOT NULL']+[f'ToDate({col}) {s} ?' for s,v in (('>=',lo),('<=',hi)) if v])+')',[v for v in (lo,hi) if v]
 return f'ToDate({col}) >= ?',[cutoff_date(op,value,today)]


_TEXT_SQL={'contains':('CStr({c}) LIKE ?','%{v}%'),'not_contains':('(CStr({c}) NOT LIKE ? OR {c} IS NULL)','%{v}%'),
           'eq':('CStr({c})=?','{v}'),'neq':('(CStr({c})<>? OR {c} IS NULL)','{v}'),
           'starts':('CStr({c}) LIKE ?','{v}%'),'ends':('CStr({c}) LIKE ?','%{v}')}


def _one_where(f,col,today):
 """条件1つ → (WHERE の式, 値の並び)。"""
 op,value=f['op'],f['value']
 if op in _TEXT_SQL:
  sql,pat=_TEXT_SQL[op];return sql.format(c=col),[pat.format(v=value)]
 if op=='starts_any':return _starts_any(col,value)
 if op in ('in','not_in'):return _in_where(col,op,value,f.get('key',''))
 if op=='empty':return f'({col} IS NULL OR CStr({col})=\'\')',[]
 if op=='not_empty':return f'({col} IS NOT NULL AND CStr({col})<>\'\')',[]
 if op=='tuple_in':return _tuple_where(f)
 if op=='date_range' or op in RELATIVE_OPS:return _date_where(col,op,value,today)
 # 大小（gt・gte・lt・lte）。数の読み方は`sort_order.num_of()`の1箇所（§9.581・画面の式と同じ決まり）。読めない値（空欄・
 # '12A'・日付）は NULL＝当たらない。打った境の値も同じ読み方で、読めなければ何にも当たらない。
 # パラメータは数値で渡す（SQLiteは型優先で比べるので、文字列だと常に REAL<TEXT で不成立）。
 sign={'gt':'>','gte':'>=','lt':'<','lte':'<='}[op]
 lim=num_of(value)
 if lim is None:return '0=1',[]
 return f'NumOf({col}) {sign} ?',[lim]


def build_filter_where(filters,today=None,exprs=None):
 """条件の並び（`safe_filters()`の答え）→ (WHERE の式の並び, 値の並び)。exprs … 計算列の名前 → SQL の式。"""
 parts=[];params=[]
 exprs=exprs or {}
 for f in filters:
  sql,ps=_one_where(f,exprs.get(f['column']) or qi(f['column']),today)
  parts.append(sql);params+=ps
 return parts,params


def search_filter_where(cs,search='',filters='',today=None,exprs=None):
 """検索の字（表の列のどれかに含む）＋条件 → (WHERE の式の並び, 値の並び)。一覧（`_table_where`）とダッシュボードが同じ答え。"""
 parts=[];params=[]
 q=str(search or '').strip()
 if q:
  parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params+=[f'%{q}%']*len(cs)
 fp,fpp=build_filter_where(safe_filters(filters,cs,tuple(exprs or ())),today,exprs)
 return parts+fp,params+fpp


def ignored_filter_columns(filter_payload,cs,calc=()):
 """条件のうち、この表に無い列（結合で足した品質データの列など）。**黙って捨てない**——画面が「効いていない」と言う（§9.612）。"""
 items=_items(filter_payload)
 known=set(cs)|set(calc or ())
 out=[]
 for it in items:
  col=str((it or {}).get('column') or '').strip() if isinstance(it,dict) else ''
  if isinstance(it,dict) and it.get('op')=='tuple_in':continue
  if col and col not in known and col not in out:out.append(col)
 # 上限を越えた条件も黙って捨てない（§9.614。前は20件目より後ろを何も言わずに落としていた）。
 if len(items)>FILTERS_MAX:out.append(f'（{FILTERS_MAX}件を越えた{len(items)-FILTERS_MAX}件の条件）')
 return out
