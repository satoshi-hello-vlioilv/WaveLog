#!/usr/bin/env python3
"""test_scsession.py: 作業スケジュールの編集権（編集セッション）§9.11 / §9.211 ②

**設備ごとに編集できるのは1人**という約束を機械で固定する。ここが崩れると
2台が同時に同じ設備を並べ替え、あとから来た書込が黙って前の並びを踏む
（データ本体は`with_write()`のロックが守るが、**利用者から見た結果**は
「並べ替えたのに戻る」になる）。

以前はこの仕組みを固定するテストが**1本も無かった**（`tests/test_sclock.py`は
固定開始日時、`tests/test_scperm.js`は現場段取り権限の網で、どちらも
セッションを見ていない）。

ここで固定すること:
 1. 誰も持っていなければ取れる／自分の分は延長できる
 2. **他端末が持っていれば取れない**（SessionHeldError）
 3. 期限(TTL)が切れたら別の端末が取れる
 4. 返せば空く（返せるのは自分の分だけ）
 5. `require_session` は「自分が持っている」「誰も持っていない」を通し、
    **他端末が持っているときだけ**弾く
 6. **在席一覧**は生きているセッションだけを返し、`mine`を正しく答える
 7. **強制的に奪える**（§9.211 ②）。奪った側が持ち主になり、
    **奪われた側は延長できなくなる**（＝次のハートビートで読み取り専用へ落ちる）
 8. 素性を名乗れない端末（ログインIDもPC名も空）でも、自分の分は自分のものと
    分かる（`mine`の判定が`acquire`と1つにそろっている）

**専用の設備名を使い、finallyで必ず返すこと**——掴んだまま落ちると、
後続のスケジュール系テストが全部「編集中です」で落ちる（§CLAUDE）。
"""
import os
import sys
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from backend import schedule_sync as ss

R=[]
def rec(name,ok,detail=''):
 R.append(bool(ok))
 print(('PASS: ' if ok else 'FAIL: ')+name+((' -- '+str(detail)) if detail else ''))

EQ='__編集権テスト設備__'
A=('userA','PC-A')
B=('userB','PC-B')

def held(equipment,who):
 return ss.session_status(equipment,who[0],who[1])

def main():
 # 共有スケジュールの置き場は**この場で決め直す**（test_scowner.pyと同じ理由。
 # db_accessはプロセス起動時に1回だけ決めるので、前のテストがパス設定マスタを
 # 書き換えていると未設定のまま入ってくる）。
 fixture=os.environ.get('WAVELOG_FIXTURE_SHARE') or ''
 if fixture:
  ss.SCHEDULE_SHARE_PATH=Path(fixture)
 if not ss.SCHEDULE_SHARE_PATH:
  rec('共有スケジュールの置き場が分かる',False,'WAVELOG_FIXTURE_SHARE も パス設定マスタ も空です')
  print(f'\n0/{len(R)} PASS');return 1
 try:
  ss.release_session(EQ,*A);ss.release_session(EQ,*B)
 except Exception:pass

 try:
  # ---- 1) 取れる／延長できる ----
  exp1=ss.acquire_session(EQ,*A)
  st=held(EQ,A)
  rec('誰も持っていなければ取れる',bool(exp1) and st.get('held') and st.get('mine') is True,st)
  exp2=ss.acquire_session(EQ,*A)
  rec('自分の分は延長できる（ハートビート）',bool(exp2),f'{exp1} -> {exp2}')

  # ---- 2) 他端末は取れない ----
  try:
   ss.acquire_session(EQ,*B)
   rec('他端末が持っていれば取れない',False,'例外が出ませんでした')
  except ss.SessionHeldError as e:
   rec('他端末が持っていれば取れない',
       e.holder_login==A[0] and e.holder_pc==A[1],f'{e.holder_login}@{e.holder_pc}')
  stB=held(EQ,B)
  rec('他端末から見ると mine=False',stB.get('held') is True and stB.get('mine') is False,stB)

  # ---- 5) require_session の3態 ----
  ok_self=True
  try:ss.require_session(EQ,*A)
  except Exception as e:ok_self=False
  rec('自分が持っていれば書ける（require_session）',ok_self)
  blocked=False
  try:ss.require_session(EQ,*B)
  except ss.SessionHeldError:blocked=True
  rec('他端末が持っていれば書けない（require_session）',blocked)

  # ---- 6) 在席一覧 ----
  allA=ss.sessions_all(*A)
  mineRow=[x for x in allA.get('sessions',[]) if x['equipment']==EQ]
  rec('在席一覧に出る',len(mineRow)==1 and mineRow[0]['holderLogin']==A[0],mineRow)
  rec('在席一覧の mine は見る人によって変わる',
      mineRow[0]['mine'] is True
      and [x for x in ss.sessions_all(*B).get('sessions',[]) if x['equipment']==EQ][0]['mine'] is False)
  rec('在席一覧は自分が誰かも返す（画面が「自分」と書けるように）',
      allA.get('me',{}).get('loginId')==A[0] and allA.get('me',{}).get('pcName')==A[1],
      allA.get('me'))

  # ---- 7) 強制的に奪う（§9.211 ②） ----
  took=ss.take_over_session(EQ,*B)
  rec('編集権を奪える',bool(took.get('expiresAt')))
  rec('誰から奪ったかを残す（黙って入れ替えない）',
      (took.get('takenFrom') or {}).get('login')==A[0],took.get('takenFrom'))
  rec('奪ったあとは奪った側が持ち主',held(EQ,B).get('mine') is True)
  # **奪われた側は延長できない**＝次のハートビートで読み取り専用へ落ちる。
  lost=False
  try:ss.acquire_session(EQ,*A)
  except ss.SessionHeldError:lost=True
  rec('奪われた側は延長できなくなる（気づかないまま書き続けない）',lost)
  denied=False
  try:ss.require_session(EQ,*A)
  except ss.SessionHeldError:denied=True
  rec('奪われた側の書込は弾かれる',denied)

  # ---- 4) 返せば空く／返せるのは自分の分だけ ----
  ss.release_session(EQ,*A)          # 持っていないほうが返しても何も起きない
  rec('他端末の分は返せない（横取りの解放をしない）',held(EQ,B).get('held') is True)
  ss.release_session(EQ,*B)
  rec('返せば空く',held(EQ,B).get('held') is False)

  # ---- 3) 期限切れなら別の端末が取れる ----
  ss.acquire_session(EQ,*A,ttl_sec=1)
  time.sleep(1.2)
  after=held(EQ,A)
  rec('期限が切れたら在席から消える',after.get('held') is False,after)
  exp3=ss.acquire_session(EQ,*B)
  rec('期限切れなら別の端末が取れる',bool(exp3))
  ss.release_session(EQ,*B)

  # ---- 8) 素性を名乗れない端末でも自分の分は自分のもの ----
  # 以前は `mine` が「login も pc も空なら必ず False」で、**自分が取った
  # セッションで自分の書込を423にしていた**（acquire は通るのに
  # require_session だけが弾く、という分かりにくい形）。
  ss.acquire_session(EQ,'','')
  anon=ss.session_status(EQ,'','')
  rec('素性が空の端末でも自分のセッションと分かる',anon.get('mine') is True,anon)
  anon_ok=True
  try:ss.require_session(EQ,'','')
  except Exception:anon_ok=False
  rec('素性が空の端末でも自分の書込は通る',anon_ok)
  ss.release_session(EQ,'','')

  # ---- 誰も居なければ素通し ----
  free=True
  try:ss.require_session(EQ,*A)
  except Exception:free=False
  rec('誰も持っていなければ書ける（fail-open）',free)

 except Exception as e:
  rec('FATAL',False,f'{type(e).__name__}: {e}')
 finally:
  # **掴んだまま終わらない**（§CLAUDE。残すと後続のスケジュール系テストが
  # 全部「編集中です」で落ちる）。
  for who in (A,B,('','')):
   try:ss.release_session(EQ,*who)
   except Exception:pass

 ng=[i for i,ok in enumerate(R) if not ok]
 print(f'\n{len(R)-len(ng)}/{len(R)} PASS')
 return 1 if ng else 0

if __name__=='__main__':
 sys.exit(main())
