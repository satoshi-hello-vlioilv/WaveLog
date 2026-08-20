# -*- coding: utf-8 -*-
"""列レイアウトマスタの保存は「送った項目だけ書く」(§9.212 ②)。

利用者の指示は「操作した内容がスムーズに反映され、待たされず、**修正した
内容が戻されたりしない**ために、より良い方法があれば提案していただきたい」。

以前は常に**全置換**で、対象の行を全部消してから入れ直していた。そのため
**呼ぶ側が1項目でも渡し忘れると、その設定だけが黙って消えた**——実際に
3回起きている:

  - 見出しを1回ドラッグしただけで計算式の列が全部消える(§9.113)
  - 列幅を保存すると列ごとの並べ替えが消える(§9.211 ①)
  - 幅固定が解ける(§9.119)

呼ぶ側は十数箇所に散っているので、「全部渡す」を各所で守らせるのは無理筋。
**入口(POST /api/column-layout-master)で安全側に倒す**——JSONにキーが
あるものだけを書き換え、無いものは今の値を残す。

**空と省略は別のこと。** `hidden:[]`は「隠す列は無い」、`hidden`が無いのは
「触っていない」。ここを一緒にすると「全部消す」ができなくなる。
"""
import os,sys,json,urllib.request,urllib.parse
sys.path.insert(0,os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B='http://127.0.0.1:5029'
TARGET='list:TESTCOLSAVE:%d' % os.getpid()

R=[]
def rec(n,ok,d=''):
    R.append(bool(ok));print(('PASS' if ok else 'FAIL')+': '+n+(' -- '+str(d) if d else ''))

def post(body):
    req=urllib.request.Request(B+'/api/column-layout-master',
        data=json.dumps(body,ensure_ascii=False).encode(),
        headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as r:return json.loads(r.read())

def get():
    with urllib.request.urlopen(B+'/api/column-layout-master?target='
                                +urllib.parse.quote(TARGET),timeout=30) as r:
        return json.loads(r.read())


FULL={'target':TARGET,'user_id':'tests',
      'order':['A','B','C'],
      'widths':{'A':120,'B':80},
      'hidden':['C'],
      'names':{'A':'エー'},
      'formats':{'B':{'kind':'number','decimals':1}},
      'rules':{'A':'ルール1'},
      'formulas':{'C':'[A]+[B]'},
      'locks':['A'],
      'sorts':{'B':{'buckets':['empty','number','text'],'desc':False}}}

try:
    post(FULL)
    base=get()
    rec('まず全部を保存できる',
        base.get('order')==['A','B','C'] and base.get('formulas',{}).get('C')=='[A]+[B]'
        and base.get('locks')==['A'] and bool(base.get('sorts',{}).get('B')),
        json.dumps({k:base.get(k) for k in ('order','locks','formulas')},ensure_ascii=False))

    # ---- 1) 幅だけ送る（列幅を引いたときの保存に相当） ----
    post({'target':TARGET,'user_id':'tests','order':['A','B','C'],'widths':{'A':200,'B':80}})
    a=get()
    rec('幅だけ送っても計算式は残る',a.get('formulas',{}).get('C')=='[A]+[B]',
        json.dumps(a.get('formulas'),ensure_ascii=False))
    rec('幅だけ送っても並べ替えの決まりは残る',bool(a.get('sorts',{}).get('B')),
        json.dumps(a.get('sorts'),ensure_ascii=False))
    rec('幅だけ送っても幅固定は残る',a.get('locks')==['A'],json.dumps(a.get('locks')))
    rec('幅だけ送っても表示名は残る',a.get('names',{}).get('A')=='エー',
        json.dumps(a.get('names'),ensure_ascii=False))
    rec('幅だけ送っても非表示は残る',a.get('hidden')==['C'],json.dumps(a.get('hidden'),ensure_ascii=False))
    rec('幅だけ送っても書式は残る',bool(a.get('formats',{}).get('B')),
        json.dumps(a.get('formats'),ensure_ascii=False))
    rec('送った幅はちゃんと変わる',a.get('widths',{}).get('A')==200,json.dumps(a.get('widths')))

    # ---- 2) 並びだけ送る（見出しのD&Dに相当） ----
    post({'target':TARGET,'user_id':'tests','order':['C','B','A']})
    b=get()
    rec('並びだけ送っても幅は残る',b.get('widths',{}).get('A')==200,json.dumps(b.get('widths')))
    rec('並びだけ送っても計算式は残る',b.get('formulas',{}).get('C')=='[A]+[B]',
        json.dumps(b.get('formulas'),ensure_ascii=False))
    rec('送った並びはちゃんと変わる',b.get('order')==['C','B','A'],json.dumps(b.get('order')))

    # ---- 3) 「空」は省略と別のこと（消せなくならない） ----
    post({'target':TARGET,'user_id':'tests','formulas':{}})
    c=get()
    rec('空を送れば消える（省略と区別する）',not c.get('formulas'),
        json.dumps(c.get('formulas'),ensure_ascii=False))
    rec('空を送っても他は残る',c.get('widths',{}).get('A')==200 and c.get('locks')==['A'],
        json.dumps({'widths':c.get('widths'),'locks':c.get('locks')}))

    # ---- 4) 全部送れば今までどおり全部が入れ替わる（設定パネルの保存） ----
    post({'target':TARGET,'user_id':'tests','order':['A'],'widths':{'A':60},'hidden':[],
          'names':{},'formats':{},'rules':{},'formulas':{},'locks':[],'sorts':{}})
    d=get()
    rec('全部送れば全部入れ替わる（設定パネルの保存）',
        d.get('order')==['A'] and d.get('widths',{}).get('A')==60
        and not d.get('names') and not d.get('locks') and not d.get('hidden'),
        json.dumps({k:d.get(k) for k in ('order','widths','names','locks','hidden')},ensure_ascii=False))
    # ---- 5) まっさらに戻す（clear:true） ----
    post(FULL)
    post({'target':TARGET,'user_id':'tests','clear':True,'order':[],'widths':{},'hidden':[],
          'names':{},'formats':{},'rules':{},'formulas':{},'locks':[],'sorts':{}})
    e=get()
    rec('clear:true で全部消える（後片付けが消し残らない）',
        not e.get('order') and not e.get('widths') and not e.get('formulas')
        and not e.get('sorts') and not e.get('locks') and not e.get('names'),
        json.dumps({k:e.get(k) for k in ('order','widths','formulas','sorts','locks','names')},
                   ensure_ascii=False))
    # **clearを付けないと消し残る**ことも見る（この口が要る理由そのもの）。
    post(FULL)
    post({'target':TARGET,'user_id':'tests','order':[],'widths':{}})
    f=get()
    rec('clearを付けなければ送っていない設定は残る',
        bool(f.get('formulas')) and bool(f.get('sorts')),
        json.dumps({'formulas':f.get('formulas'),'sorts':f.get('sorts')},ensure_ascii=False))
finally:
    # **後始末**。残すと`db/master.sqlite3`は実行をまたいで生き延びる(§9.121)。
    try:
        post({'target':TARGET,'user_id':'tests','clear':True,'order':[],'widths':{},'hidden':[],
              'names':{},'formats':{},'rules':{},'formulas':{},'locks':[],'sorts':{}})
    except Exception:
        pass

print('\n== %d/%d PASS ==' % (sum(1 for x in R if x),len(R)))
sys.exit(0 if all(R) else 1)
