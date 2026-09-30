"""sort_order.py: 列ごとの並べ替えの決まり(§9.187)

見出しをクリックしたときの並びは、ふだんはSQLのORDER BYで足りる。
足りないのは次の2つで、どちらも**列の設定パネルで列ごとに決められる**。

 ① 種類が混ざる列の並び。実データの同じ項目には '' / '3' / '10' /
    '2026/08/01' / 'A2' が混ざる。SQLiteの既定は「値の型(ストレージクラス)
    優先＋文字列は辞書順」なので、'10' が '3' より前に来たり、日付の
    区切りが揺れていると年月日の順にならなかったりする。空欄・数値・日付・
    文字列を**塊(bucket)**として扱い、塊の順番を利用者が決められるように
    する（利用者の言葉で「null→昇順(数値or日付)→文字列」）。
 ② **変換後の文字で並べる**。読み替え(表示ルール)を当てた列は、画面に
    出ているのは言い換えた文字なのに、並ぶのは生の値だった。表示のとおりに
    並べたいときのために「読み替え→書式→並べ替え」の順にもできる
    （既定は今までどおり「生の値で並べる→表示のときに整える」）。

**SQLでは書けないので、Pythonで並べてからページを切り出す。**
1回で全部の行を運ばないのが要点で、
  1. 並べ替えに要る列だけ(＋ROWID)を引く
  2. Pythonで並べる
  3. そのページのROWIDだけを本体のSELECTで引き直す
の2段にする。214列×2万行を丸ごとPythonへ運ぶと数十MBになるが、この形なら
数列ぶんで足りる。**素の並び（指定なし）のときはこの経路を通らない**
——今までどおりSQLのORDER BYなので、遅くなる場面を増やさない。

向き(昇順/降順)は**塊の中の値だけ**を反転する。塊の順番は利用者が明示的に
決めたものなので、向きを変えても動かさない（空欄が行き先を変えると、
「空欄は最後」と決めた意味が無くなる。Excelの空白と同じ考え方）。

画面側にも同じ判定がある(`static/js/core/base.js`の`WL.sortSpec`)。**2つあるのは
役目が違うから**で、こちらは並べるため、あちらは設定パネルで「この列は
数値と文字列が混ざっています」と言うため。食い違わないように
`tests/fixtures/sort_cases.json`の同じ例で両方を突き合わせている
(`tests/test_sortpipe.py` と `tests/test_colsort.js`)。**どちらかだけを
直さないこと**——直したら例を足して両方で通す。
"""
import json
import re

# 塊の呼び名。画面(WL.sortSpec.KINDS)と同じ順・同じ綴りにしてある。
KINDS=('empty','num','date','text')
KIND_LABEL={'empty':'空欄','num':'数値','date':'日付','text':'文字列'}

_NUM_RE=re.compile(r'^[-+]?(\d+\.?\d*|\.\d+)$')
_DATE_RE=re.compile(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})'
                    r'(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$')
_DATE_PACKED_RE=re.compile(r'^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$')
_DIGITS_RE=re.compile(r'\d+')


def num_of(v):
 """数値として読める値なら float。読めなければ None。
    桁区切りのカンマは落とす（実データに '1,200' が混ざる）。"""
 if isinstance(v,bool):return None
 if isinstance(v,(int,float)):return float(v)
 t=str('' if v is None else v).strip().replace(',','')
 if not t or not _NUM_RE.match(t):return None
 try:return float(t)
 except ValueError:return None


def date_key(v):
 """日付として読める値なら 'YYYYMMDDHHMMSS'。読めなければ None。

 **8桁の数字は日付として読まない**——製造番号・コードが日付に化けると、
 数値の列が黙って日付の塊へ移る。区切りのある形('2026/08/01')と、
 時刻まで続く形('20260801 0930')だけを日付として扱う。"""
 t=str('' if v is None else v).strip()
 if not t:return None
 m=_DATE_RE.match(t)
 if not m:
  m2=_DATE_PACKED_RE.match(t)
  # 区切り無しは時刻が続いているときだけ(=日付として書かれたと分かるとき)
  if not m2 or not m2.group(4):return None
  m=m2
 y,mo,d=int(m.group(1)),int(m.group(2)),int(m.group(3))
 if not (1<=mo<=12 and 1<=d<=31):return None
 hh=int(m.group(4) or 0);mi=int(m.group(5) or 0);ss=int(m.group(6) or 0)
 if hh>23 or mi>59 or ss>59:return None
 return f'{y:04d}{mo:02d}{d:02d}{hh:02d}{mi:02d}{ss:02d}'


def classify(v):
 """その値がどの塊か。空欄→数値→日付→文字列の順に見る。"""
 t=str('' if v is None else v).strip()
 if not t:return 'empty'
 if num_of(t) is not None:return 'num'
 if date_key(t) is not None:return 'date'
 return 'text'


def natural_key(s):
 """数字混じりの文字列を人の読む順にする鍵('A2' < 'A10')。

 **文字列で返す**——(str,int)の組にすると、他の塊の鍵と比べたときに
 型が混ざって比較できなくなる。数字の並びを20桁へ0埋めして揃える。"""
 return _DIGITS_RE.sub(lambda m:m.group(0).rjust(20,'0'),str(s or ''))


def normalize_spec(x):
 """保存された/画面から来た並べ替え設定を正す。**何も指定が無ければNone**
    （＝今までどおりSQLのORDER BY。既定の挙動を変えない）。"""
 if x in (None,'',{}):return None
 if isinstance(x,str):
  try:x=json.loads(x)
  except (TypeError,ValueError):return None
 if not isinstance(x,dict):return None
 buckets=[]
 for k in (x.get('buckets') or []):
  k=str(k or '').strip()
  if k in KINDS and k not in buckets:buckets.append(k)
 if buckets:
  # 書き漏らした塊は末尾へ(既定の順で)。落とすと行が消えたように見える。
  buckets+=[k for k in KINDS if k not in buckets]
 on='display' if str(x.get('on') or '')=='display' else 'raw'
 natural=bool(x.get('natural'))
 if not buckets and on=='raw' and not natural:return None
 return {'buckets':buckets,'on':on,'natural':natural}


def spec_json(spec):
 """マスタへ入れる文字列。指定なしは空文字（行を汚さない）。"""
 spec=normalize_spec(spec)
 return json.dumps(spec,ensure_ascii=False,sort_keys=True) if spec else ''


def bucket_rank(spec,value):
 """塊の順番。指定が無ければ全部同じ(=塊で分けない)。"""
 buckets=(spec or {}).get('buckets') or []
 if not buckets:return 0
 kind=classify(value)
 try:return buckets.index(kind)
 except ValueError:return len(buckets)


def value_key(spec,value):
 """塊の中の並び。**どの塊とも比べられる形**(3つ組)で返す
    ——値の並べ替えは塊をまたいで1回で行うため、型が混ざると比較できない。"""
 t=str('' if value is None else value).strip()
 if not t:return (0,0.0,'')
 n=num_of(t)
 if n is not None:return (0,n,'')
 d=date_key(t)
 if d is not None:return (1,0.0,d)
 return (1,0.0,natural_key(t) if (spec or {}).get('natural') else t)


# ========================================================================
# 変換後の文字（読み替え→書式）—— `on:'display'` のときだけ使う
# ========================================================================
# **画面(`static/js/core/base.js`の`WL.displayRules`/`WL.cellFormat`)と同じ順序**を
# 並べ替えのためにサーバー側でも持つ。順序は設計どおり
#   生の値 → 読み替えが当たればその言葉で確定(整形しない)
#          → 当たらなければ書式で整形 → 整形できなければ生の値
# で、読み替えが先なのは読み替えが生の値を見て判断するものだから
# ('00'を'0'へ整形してから読み替えると当たらない)。
#
# **整形できなかったら生の値**にするのも同じ（空欄にしない）。ここが違うと
# 「画面では読める並びなのに、並べ替えだけ別の値で並ぶ」ことになる。
# 突き合わせは tests/fixtures/sort_cases.json（画面側と同じ例）。
# ========================================================================
_WEEK=('日','月','火','水','木','金','土')
_TOKEN_RE=re.compile(r"yyyy|yy|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt|'[^']*'")


def _parts(v):
 """日付時刻の部品。取れなければNone。時刻だけの値も受ける。"""
 t=str('' if v is None else v).strip()
 if not t:return None
 m=_DATE_RE.match(t) or _DATE_PACKED_RE.match(t)
 if m:
  y,mo,d=int(m.group(1)),int(m.group(2)),int(m.group(3))
  if not (1<=mo<=12 and 1<=d<=31):return None
  hh=int(m.group(4) or 0);mi=int(m.group(5) or 0);ss=int(m.group(6) or 0)
  if hh>23 or mi>59 or ss>59:return None
  return {'y':y,'M':mo,'d':d,'H':hh,'mi':mi,'s':ss}
 m=re.match(r'^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$',t)
 if m:
  hh=int(m.group(1));mi=int(m.group(2));ss=int(m.group(3) or 0)
  if hh>23 or mi>59 or ss>59:return None
  return {'y':None,'M':None,'d':None,'H':hh,'mi':mi,'s':ss}
 return None


class _Missing(Exception):
 """書式が求めた部分がその値に無い（時刻だけの値に yyyy を求めた等）。"""


def _stamp(p,pattern):
 def need(k):
  if p.get(k) is None:raise _Missing()
  return p[k]
 def h12():
  h=need('H')%12
  return 12 if h==0 else h
 def one(tok):
  if tok=='yyyy':return f"{abs(need('y')):04d}"
  if tok=='yy':return f"{abs(need('y'))%100:02d}"
  if tok=='MM':return f"{abs(need('M')):02d}"
  if tok=='M':return str(need('M'))
  if tok in ('dddd','ddd'):
   import datetime
   w=_WEEK[datetime.date(need('y'),need('M'),need('d')).isoweekday()%7]
   return w+'曜日' if tok=='dddd' else w
  if tok=='dd':return f"{abs(need('d')):02d}"
  if tok=='d':return str(need('d'))
  if tok=='HH':return f"{abs(need('H')):02d}"
  if tok=='H':return str(need('H'))
  if tok=='hh':return f'{h12():02d}'
  if tok=='h':return str(h12())
  if tok=='mm':return f"{abs(need('mi')):02d}"
  if tok=='m':return str(need('mi'))
  if tok=='ss':return f"{abs(need('s')):02d}"
  if tok=='s':return str(need('s'))
  if tok=='tt':return '午前' if need('H')<12 else '午後'
  return tok[1:-1]
 return _TOKEN_RE.sub(lambda m:one(m.group(0)),str(pattern))


def _group_thousands(s):
 m=re.match(r'^(-?)(\d+)(\.\d+)?$',s)
 if not m:return s
 head=m.group(2)
 out=''
 while len(head)>3:
  out=','+head[-3:]+out;head=head[:-3]
 return m.group(1)+head+out+(m.group(3) or '')


def format_value(spec,raw):
 """書式を1つ当てる。整形できなければ生の値の文字列。空欄は空欄のまま。"""
 t='' if raw is None else str(raw)
 if not t.strip():return ''
 out=_run_format(spec,raw)
 return t if out is None else out


def _run_format(spec,raw):
 if not spec:return None
 kind=str(spec.get('kind') or '')
 if kind=='number':
  n=num_of(raw)
  if n is None:return None
  dec=spec.get('decimals')
  if dec in (None,''):
   s=('%g'%n) if n!=int(n) else str(int(n))
  else:
   try:s=f'{n:.{int(dec)}f}'
   except (TypeError,ValueError):s=str(n)
  if spec.get('thousands'):s=_group_thousands(s)
  return str(spec.get('prefix') or '')+s+str(spec.get('suffix') or '')
 if kind=='datetime':
  p=_parts(raw)
  if not p:return None
  try:return _stamp(p,spec.get('pattern') or 'yyyy/MM/dd')
  except _Missing:return None
 if kind=='text':
  return str(spec.get('prefix') or '')+str('' if raw is None else raw).strip()+str(spec.get('suffix') or '')
 return None


def _operand(side,row,self_col):
 if not side:return ''
 kind=str(side.get('kind') or '')
 if kind=='self':return (row or {}).get(self_col,'')
 if kind=='column':return (row or {}).get(side.get('column'),'')
 return side.get('value')


def _cmp(a,b):
 x,y=num_of(a),num_of(b)
 if x is not None and y is not None:return -1 if x<y else (1 if x>y else 0)
 s='' if a is None else str(a);t='' if b is None else str(b)
 return -1 if s<t else (1 if s>t else 0)


def rule_test(cond,row,self_col):
 """条件1つ。画面(`WL.displayRules.test`)と同じ判定。"""
 L=_operand(cond.get('left'),row,self_col)
 ls='' if L is None else str(L)
 op=str(cond.get('op') or '')
 if op=='empty':return ls.strip()==''
 if op=='notEmpty':return ls.strip()!=''
 R=_operand(cond.get('right'),row,self_col)
 rs='' if R is None else str(R)
 if op=='eq':return ls==rs or _cmp(L,R)==0
 if op=='ne':return not (ls==rs or _cmp(L,R)==0)
 if op=='contains':return rs!='' and rs in ls
 if op=='startsWith':return rs!='' and ls.startswith(rs)
 if op=='endsWith':return rs!='' and ls.endswith(rs)
 if op=='gt':return _cmp(L,R)>0
 if op=='ge':return _cmp(L,R)>=0
 if op=='lt':return _cmp(L,R)<0
 if op=='le':return _cmp(L,R)<=0
 if op=='between':
  R2=_operand(cond.get('right2'),row,self_col)
  return _cmp(L,R)>=0 and _cmp(L,R2)<=0
 if op=='regex':
  # 書き間違いで並びが壊れないように、不正な正規表現は「当たらない」。
  try:return re.search(rs,ls) is not None
  except re.error:return False
 return False


def rule_groups(conds):
 """行の中の条件を「または」で区切った群へ。`join:'or'`の条件から新しい群。
 画面（`WL.displayRules.groupsOf`）と同じ区切り方——**「かつ」を先にまとめる**。"""
 out=[]
 for i,cd in enumerate(conds or []):
  if not i or (isinstance(cd,dict) and cd.get('join')=='or'):out.append([])
  out[-1].append(cd)
 return out


def is_rule_group(cd):
 """かっこの組（`{'kind':'group','conditions':[…]}`）か。"""
 return isinstance(cd,dict) and cd.get('kind')=='group'


def rule_conds_true(conds,row,self_col):
 """どれか1つの群の条件がすべて当たるか。**かっこの組はその中を同じ決まりで見る**
 （画面の`condsTrue()`と同じ）。空の組は当たらない。"""
 return any(all(rule_conds_true(cd.get('conditions') or [],row,self_col) if is_rule_group(cd)
                else rule_test(cd,row,self_col) for cd in g)
            for g in rule_groups(conds))


def rule_leaves(conds):
 """かっこの組の中まで降りて、条件（葉）だけを並べる（見る列を集めるのに使う）。"""
 out=[]
 for cd in conds or []:
  out.extend(rule_leaves(cd.get('conditions')) if is_rule_group(cd) else [cd])
 return out


def rule_match(rows,row,self_col):
 """当たった行。**条件が空の行＝どれにも当てはまらなかったときの既定**。
 行が当たるのは、どれか1つの群（`rule_groups()`）の条件がすべて当たるとき。"""
 for r in rows or []:
  conds=r.get('conditions') or []
  if not conds:return r
  if rule_conds_true(conds,row,self_col):return r
 return None


def display_text(raw,fmt=None,rule_rows=None,row=None,column=''):
 """1つのセルが画面に出す文字。画面の`WL.cellFormat.cell`と同じ順序。"""
 if rule_rows:
  hit=rule_match(rule_rows,row,column)
  if hit is not None:
   text=hit.get('text')
   if text not in (None,''):return str(text)
   return format_value(fmt,raw)
 return format_value(fmt,raw)


def order_rows(rows,keys,value_of):
 """keysの順に並べる。value_of(row,key)が「その列の並べ替えに使う値」。

 **安定ソートを重ねる**——最後のキーから順に並べ替えると、先のキーが
 優先される（Pythonのsortは安定）。1つのキーの中では
   ①値で並べる（向きはここだけに効く） → ②塊で並べ直す（常に昇順）
 の順。塊が値より優先されるので、あとから当てる。"""
 out=list(rows)
 for k in reversed(list(keys)):
  spec=k.get('spec') or {}
  desc=str(k.get('dir') or '').lower()=='desc'
  out.sort(key=lambda r,k=k,spec=spec:value_key(spec,value_of(r,k)),reverse=desc)
  if spec.get('buckets'):
   out.sort(key=lambda r,k=k,spec=spec:bucket_rank(spec,value_of(r,k)))
 return out


def describe(spec):
 """設定を1行の日本語で。画面にも同じ言い方で出す(§9.187)。"""
 spec=normalize_spec(spec)
 if not spec:return '既定（種類で分けない）'
 out=[]
 if spec['buckets']:out.append(' → '.join(KIND_LABEL[k] for k in spec['buckets']))
 if spec['natural']:out.append('数字混じりは人の読む順')
 out.append('変換後の文字で並べる' if spec['on']=='display' else '生の値で並べる')
 return '／'.join(out)
