#!/usr/bin/env python3
"""test_sortpipe.py: 列ごとの並べ替え(§9.187)のサーバ側

見出しのクリックはふだんSQLのORDER BYで足りる。足りないのは
「種類が混ざる列の並び」と「変換後の文字で並べる」の2つで、そこだけを
Pythonで並べてからページを切り出す。ここで固定するのは、崩れると
**並びが黙って別物になる**次の点。

 1. 塊(空欄/数値/日付/文字列)の判定。**8桁の数字を日付として読まないこと**
    ——製造番号が日付の塊へ移ると、数値の列の並びが理由なく変わる。
 2. 塊の順は利用者の指定どおり。向き(昇順/降順)は**塊の中の値だけ**を
    反転する(空欄の行き先が向きで変わらない)。
 3. 変換後の文字は**画面と同じ順序**で作る(読み替え→書式→整形できなければ
    生の値)。ここが違うと「画面の並びと違う並びで並ぶ」ことになる。
 4. 指定が無ければNone＝今までどおりSQLの並び(既定の挙動を変えない)。

判定は画面側(`static/js/base.js`の`WL.sortSpec`/`WL.cellFormat`)にも
あるので、**同じ例**(tests/fixtures/sort_cases.json)で両方を確かめる。
画面側は tests/test_colsort.js。**片方だけ直さないこと。**
"""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import sort_order as so

R=[]
def rec(name,ok,detail=''):
 R.append((name,ok,detail))
 print(('PASS: ' if ok else 'FAIL: ')+name+((' -- '+str(detail)) if detail else ''))

def main():
 cases=json.loads((Path(__file__).parent/'fixtures'/'sort_cases.json').read_text(encoding='utf-8'))

 # 1) 塊の判定
 bad=[c for c in cases['classify'] if so.classify(c['v'])!=c['kind']]
 rec('塊の判定が例のとおり',not bad,
     '；'.join(f"{c['v']!r}→{so.classify(c['v'])}(期待{c['kind']})" for c in bad))

 # 2) 並び
 for i,c in enumerate(cases['order']):
  spec=so.normalize_spec(c['spec'])
  keys=[{'column':'v','dir':c['dir'],'spec':spec}]
  rows=[{'v':v} for v in c['values']]
  got=[r['v'] for r in so.order_rows(rows,keys,lambda r,k:r['v'])]
  rec(f"並びが例のとおり({c.get('why') or i})",got==c['expect'],
      f'got={got} expect={c["expect"]}')

 # 3) 変換後の文字
 bad=[]
 for c in cases['display']:
  got=so.display_text(c['raw'],c.get('fmt'),c.get('rule'),{'v':c['raw']},'v')
  if got!=c['expect']:bad.append(f"{c['raw']!r}→{got!r}(期待{c['expect']!r})")
 rec('変換後の文字が例のとおり',not bad,'；'.join(bad))

 # 4) 指定なしはNone(＝今までどおりSQLで並べる)
 rec('指定なしは「決まりなし」',
     so.normalize_spec(None) is None and so.normalize_spec({}) is None
     and so.normalize_spec({'on':'raw','natural':False,'buckets':[]}) is None
     and so.normalize_spec('こわれたJSON') is None)

 # 5) 書き漏らした塊は落とさず末尾へ(行が消えたように見えないこと)
 spec=so.normalize_spec({'buckets':['text']})
 rec('書き漏らした塊は末尾へ回る',spec['buckets']==['text','empty','num','date'],spec)

 # 6) 保存する形へ往復できる
 j=so.spec_json({'buckets':['empty','num'],'on':'display','natural':True})
 back=so.normalize_spec(j)
 rec('マスタへ入れる形と往復できる',
     back=={'buckets':['empty','num','date','text'],'on':'display','natural':True},
     f'{j} -> {back}')
 rec('指定なしは空文字で入れる(行を汚さない)',so.spec_json({})=='' and so.spec_json(None)=='')

 # 7) 日付は区切りの揺れをまたいで年月日の順になる
 keys=[{'column':'v','dir':'asc','spec':so.normalize_spec({'buckets':['date']})}]
 vals=['2026/12/01','2026-2-3 09:00','2026.7.4']
 got=[r['v'] for r in so.order_rows([{'v':v} for v in vals],keys,lambda r,k:r['v'])]
 rec('日付は区切りが揺れても年月日の順',got==['2026-2-3 09:00','2026.7.4','2026/12/01'],got)

 # 8) 壊れた正規表現の読み替えは「当たらない」で済ませる(並びが壊れない)
 rows=[{'conditions':[{'op':'regex','left':{'kind':'self'},'right':{'kind':'value','value':'[('}}],
        'text':'ヒット'}]
 rec('壊れた正規表現は当たらないで済む',
     so.display_text('abc',None,rows,{'v':'abc'},'v')=='abc')

 ng=[n for n,ok,_ in R if not ok]
 print(f'\n=== SUMMARY ===\n{len(R)-len(ng)}/{len(R)} passed')
 return 1 if ng else 0

if __name__=='__main__':sys.exit(main())
