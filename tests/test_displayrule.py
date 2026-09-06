#!/usr/bin/env python3
"""test_displayrule.py: 表示ルールマスタ(§9.88 段4)のサーバ側

読み替えの**保存の仕方**を固定する。判定そのものは画面側なので
(tests/test_colrule.js が見る)、ここは「壊れた入力で何が起きるか」に絞る。

ここで固定するのは、崩れると設定が黙って消える次の点。
 1. ルール名でまとめて全置換する(行の順序=評価順)
 2. **壊れた条件は1件だけ落とす**——1つの入力ミスでルール全体が消えると、
    利用者からは「保存したのに戻っている」としか見えない
 3. 空の行(条件も表示値も色も無い)は捨てる(評価順を乱さないため)
 4. 列レイアウトマスタの[読み替えルール]と往復する
 5. ルールを消しても列側の参照は残せる(無いルール名＝読み替えなし)
 6. 消す前に「どこで使っていたか」が分かる
"""
import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend.db_access import connect
from backend.repositories import master_repo as mr

R=[]
def rec(name,ok,detail=''):
 R.append((name,ok,detail))
 print(('PASS: ' if ok else 'FAIL: ')+name+((' -- '+str(detail)) if detail else ''))

def main():
 path=Path(tempfile.mkdtemp())/'t.sqlite3'
 with connect(path,False) as c:
  mr.ensure_display_rule_table(c)
  mr.ensure_column_layout_table(c)

  cond=lambda op,val:{'left':{'kind':'self'},'op':op,'right':{'kind':'value','value':val}}

  # ---- 1) 全置換と評価順 ----
  n=mr.set_display_rule(c,'有無',[
   {'conditions':[cond('eq','00')],'text':'なし','color':''},
   {'conditions':[cond('eq','01')],'text':'あり','color':'ok'},
  ],'t')
  rec('ルールを保存できる',n==2,n)
  rules=mr.display_rules(c)
  rec('保存した順に読み出せる',[r['text'] for r in rules['有無']]==['なし','あり'],
      [r['text'] for r in rules['有無']])
  rec('色も残る',rules['有無'][1]['color']=='ok')

  # 全置換: 入れ直すと前の行は残らない
  mr.set_display_rule(c,'有無',[{'conditions':[cond('eq','9')],'text':'不明','color':''}],'t')
  rules=mr.display_rules(c)
  rec('全置換(前の行は残らない)',[r['text'] for r in rules['有無']]==['不明'],
      [r['text'] for r in rules['有無']])

  # ---- 2) 壊れた条件は1件だけ落とす ----
  mr.set_display_rule(c,'混在',[
   {'conditions':[cond('eq','A'),
                  {'left':{'kind':'self'},'op':'そんな演算子は無い','right':{'kind':'value','value':'B'}},
                  {'op':'eq','right':{'kind':'value','value':'C'}},          # leftが無い
                  {'left':{'kind':'column','column':''},'op':'eq','right':{'kind':'value','value':'D'}}],
    'text':'残る','color':''},
  ],'t')
  got=mr.display_rules(c)['混在'][0]
  rec('壊れた条件だけを落とす',len(got['conditions'])==1,len(got['conditions']))
  rec('残った条件は正しい',got['conditions'][0]['right']['value']=='A')
  rec('行そのものは捨てない',got['text']=='残る')

  # 色が選択肢に無ければ「色なし」へ倒す(保存を失敗させない)
  mr.set_display_rule(c,'色',[{'conditions':[cond('eq','X')],'text':'x','color':'まぶしい'}],'t')
  rec('知らない色は色なしへ倒す',mr.display_rules(c)['色'][0]['color']=='')

  # ---- 3) 空の行は捨てる ----
  n=mr.set_display_rule(c,'空',[
   {'conditions':[cond('eq','1')],'text':'A','color':''},
   {'conditions':[],'text':'','color':''},            # 完全に空 → 捨てる
   {'conditions':[],'text':'','color':'muted'},       # 既定行(色だけ) → 残す
   {'conditions':[],'text':'その他','color':''},      # 既定行(表示値だけ) → 残す
  ],'t')
  rec('空の行だけを捨てる',n==3,n)
  rows=mr.display_rules(c)['空']
  rec('条件が空の既定行は残る',[r['text'] for r in rows]==['A','','その他'],[r['text'] for r in rows])

  # ---- 4) 列レイアウトマスタとの往復 ----
  mr.set_column_layout(c,'list:X:T',['ロット番号','区分'],{},'t',
                       rules={'区分':'有無'})
  layout=mr.column_layout_for(c,'list:X:T')
  rec('列に読み替えルールを紐づけられる',layout['rules'].get('区分')=='有無',layout['rules'])
  rec('紐づけていない列は入らない','ロット番号' not in layout['rules'])

  # **要点**: 並びだけを送っても読み替えの指定は消えない(全置換の落とし穴)
  mr.set_column_layout(c,'list:X:T',['区分','ロット番号'],{},'t',
                       rules=layout['rules'])
  rec('並べ替えても読み替えの指定が残る',
      mr.column_layout_for(c,'list:X:T')['rules'].get('区分')=='有無')

  # ---- 5) 削除 ----
  used=mr.display_rule_usage(c,'有無')
  rec('どこで使っているかが分かる',
      len(used)==1 and used[0]['column']=='区分' and used[0]['target']=='list:X:T',used)
  deleted=mr.delete_display_rule(c,'有無')
  rec('ルールを消せる',deleted==1,deleted)
  rec('消したルールは読み出されない','有無' not in mr.display_rules(c))
  # **要点**: 参照が残っていても壊れない(無いルール名＝読み替えなし)
  rec('列側の参照は残る(一覧は出せる)',
      mr.column_layout_for(c,'list:X:T')['rules'].get('区分')=='有無')

  # ---- 6) 名前まわり ----
  try:
   mr.set_display_rule(c,'   ',[{'conditions':[],'text':'x','color':''}],'t')
   rec('空のルール名は弾く',False,'例外が出なかった')
  except ValueError:
   rec('空のルール名は弾く',True)
  rec('無いルールを消してもエラーにしない',mr.delete_display_rule(c,'存在しない')==0)

 bad=[r for r in R if not r[1]]
 print('\n=== SUMMARY ===')
 print(f'{len(R)-len(bad)}/{len(R)} passed')
 for n,_ok,d in bad:print(' -',n,d)
 return 1 if bad else 0

if __name__=='__main__':
 sys.exit(main())
