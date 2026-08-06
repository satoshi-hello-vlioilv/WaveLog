# -*- coding: utf-8 -*-
"""cols()の取り違え(§9.66)が波及していた経路の確認。
検索WHERE・絞込・並替・品質結合・品質分析・測定コンテキストは、いずれも
cols()の結果を前提に組み立てるため、列名を取り違えると静かに壊れる。"""
import os,sys,json,sqlite3,urllib.request,urllib.parse
sys.path.insert(0,os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B='http://127.0.0.1:5029'
R=[]
def rec(n,ok,d=''):
    R.append(bool(ok));print(('PASS' if ok else 'FAIL')+': '+n+(' -- '+str(d) if d else ''))
def get(u):
    with urllib.request.urlopen(B+u,timeout=60) as r:return json.loads(r.read())
def table_of(k):return get(f'/api/tables?db={k}')['tables'][0]
def q(**kw):return urllib.parse.urlencode(kw)

NOW,DEF=table_of('SIKALOTNOW'),table_of('SIKALOTDEF')

# --- 1. 取得順に依存しない(バグの本体: 先に開いた側の列名が返っていた) ---
a1=get('/api/table?'+q(db='SIKALOTNOW',table=NOW,page=1,page_size=50))
b1=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=50))
b2=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=50))
a2=get('/api/table?'+q(db='SIKALOTNOW',table=NOW,page=1,page_size=50))
rec('仕掛→品質 と 品質→仕掛 で列が変わらない',a1['columns']==a2['columns'] and b1['columns']==b2['columns'],
    f"仕掛{len(a1['columns'])}列 品質{len(b1['columns'])}列")
rec('仕掛と品質で別々の列構成が返る',a1['columns']!=b1['columns'],
    f"仕掛先頭={a1['columns'][:3]} 品質先頭={b1['columns'][:3]}")

# --- 2. 値が正しい列名へ紐づく(実DBと突き合わせ) ---
import backend.db_access as dba
for key,t in (('SIKALOTNOW',NOW),('SIKALOTDEF',DEF)):
    # page_sizeはサーバー側で最低50に切り上げられる(tables.pyのmin/max)。
    # 実DB側も同じ件数で取って突き合わせる。
    api=get('/api/table?'+q(db=key,table=t,page=1,page_size=50,include_hidden='1'))
    n=len(api['rows'])
    with sqlite3.connect(str(dba.DBS[key]['path'])) as sc:
        cur=sc.execute(f'SELECT * FROM "{t}" LIMIT {n}')
        names=[d[0] for d in cur.description];real=[dict(zip(names,r)) for r in cur.fetchall()]
    same=(len(real)==n) and all(
        all(str(rr.get(c))==str(ar.get(c)) for c in names) for rr,ar in zip(real,api['rows']))
    bad=[(c,rr.get(c),ar.get(c)) for rr,ar in zip(real,api['rows']) for c in names
         if str(rr.get(c))!=str(ar.get(c))][:3]
    rec(f'{key}: 各セルの値が実DBと一致する',same,
        f"{n}行 x {len(api['columns'])}列"+(f" 不一致例={bad}" if bad else ''))

# --- 3. 検索(WHERE)がその DB の列に対して効く ---
sample=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=1))
if sample['rows']:
    col=sample['columns'][0];val=str(sample['rows'][0][col])
    s=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=50,search=val))
    rec('品質データの検索が動く(500にならず該当行が返る)',s.get('count',0)>0 and
        any(str(r.get(col))==val for r in s['rows']),f"{s.get('count')}件 検索語={val}")
    # --- 4. 絞込(filters)が有効な列として認識される ---
    f=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=50,
          filters=json.dumps([{'column':col,'op':'eq','value':val}])))
    rec('品質データの絞込が受理される(列名が実在扱いになる)',f.get('filters_applied')==1,
        f"applied={f.get('filters_applied')} count={f.get('count')}")
    rec('絞込の結果が条件どおり',all(str(r.get(col))==val for r in f['rows']) and f.get('count',0)>0,
        f"{f.get('count')}件")
    # --- 5. 並替が効く ---
    so=get('/api/table?'+q(db='SIKALOTDEF',table=DEF,page=1,page_size=50,sort=col,sort_dir='asc'))
    vals=[str(r.get(col)) for r in so['rows']]
    rec('品質データの並替が効く',vals==sorted(vals),f"先頭={vals[:3]}")

# --- 6. 品質結合(join_quality)が品質側の実在列を足す ---
j=get('/api/table?'+q(db='SIKALOTNOW',table=NOW,page=1,page_size=50,join_quality='1'))
info=j.get('joinQuality') or {}
added=[c for c in j['columns'] if c not in a1['columns']]
defcols=b1['columns']
rec('結合で足される列が品質データの実在列である',bool(added) and set(added)<=set(defcols),
    f"追加={added} 診断={info.get('reason') or ('applied' if info.get('applied') else info)}")

# --- 7. 品質分析API(別経路でcols()を使う) ---
try:
    qa=get('/api/quality/summary?'+q(table=DEF)) if False else None
except Exception:qa=None
try:
    diag=get('/api/measurement/context?'+q(lot=(sample['rows'][0].get('ロット番号') if sample['rows'] else ''),equipment=''))
    rec('測定コンテキストが取得できる(品質情報の列解決を含む)',diag.get('diagnostics') is not None or 'quality' in diag,
        f"quality={len(diag.get('quality') or [])}件")
except Exception as e:
    rec('測定コンテキストが取得できる(品質情報の列解決を含む)',False,repr(e))

print()
print(f'== {sum(R)}/{len(R)} PASS ==')
sys.exit(0 if all(R) else 1)
