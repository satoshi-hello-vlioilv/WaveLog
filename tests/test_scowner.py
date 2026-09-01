#!/usr/bin/env python3
"""test_scowner.py: 共有スケジュールの「持ち主」(§9.192)

共有(Box等)のschedule.sqlite3へ**実際に書く役を1台に絞る**仕掛け。
他の端末は書き込みだけをその1台へHTTPで頼み、読みは今までどおり手元の
写しから読む。ここで固定するのは、崩れると**黙って壊れる**次の点。

 1. 既定はoff（現場の端末をいきなりLANへ開かない）
 2. 最初に入った1台が持ち主になり、2台目は名乗り出ない
 3. 期限(TTL)が切れたら別の端末が引き継げる
 4. 受け口は**合言葉**と**決められたパス**しか受けない
    （/api/shutdown のようなアプリ全体の操作をLANから触らせない）
 5. 中継された書き込みは**持ち主のモードで二重に弾かれない**
    （持ち主はたいていeditモード。判定は頼んだ端末で済んでいる）
 6. **誰が・どの端末で・どのモードで**が持ち主まで運ばれる
    （運ばないと、監査列も設備単位の排他も全部「持ち主PCの人」になる）
 7. 中継されてきたものを**中継し返さない**（往復し続けない）
 8. 持ち主へ届かなければ**今までどおり自分で書く**（仕事を止めない）
 9. 読み(GET)・設定系マスタ・編集セッションは中継しない
"""
import json
from http.server import ThreadingHTTPServer
import threading
import os
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

from backend import schedule_owner as so

R=[]
def rec(name,ok,detail=''):
 R.append(bool(ok))
 print(('PASS: ' if ok else 'FAIL: ')+name+((' -- '+str(detail)) if detail else ''))

def free_port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p

def post(url,payload,token=None,timeout=20):
 """(status, body dict) を返す。4xxも例外にしない。"""
 hdr={'Content-Type':'application/json'}
 if token is not None:hdr[so.HDR_TOKEN]=token
 req=urllib.request.Request(url,data=json.dumps(payload).encode('utf-8'),headers=hdr)
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 try:
  with opener.open(req,timeout=timeout) as r:
   return r.status,json.loads(r.read().decode('utf-8','replace') or '{}')
 except urllib.error.HTTPError as e:
  try:return e.code,json.loads(e.read().decode('utf-8','replace') or '{}')
  except Exception:return e.code,{}
 except Exception as e:
  return 0,{'error':str(e)}

def main():
 tmp=Path(tempfile.mkdtemp())
 port=free_port()
 # 共有スケジュールの置き場は**この場で決め直す**——`db_access`はプロセス
 # 起動時に1回だけ決めるので、前のテストがパス設定マスタを書き換えていると
 # 未設定のまま入ってくる（通しで実際に踏んだ。単独では通るので気づけない）。
 # 検証用の作業コピーはランナーが`WAVELOG_FIXTURE_SHARE`で渡してくる。
 from backend import schedule_sync
 fixture_share=os.environ.get('WAVELOG_FIXTURE_SHARE') or ''
 if fixture_share:
  schedule_sync.SCHEDULE_SHARE_PATH=Path(fixture_share)
 if not schedule_sync.SCHEDULE_SHARE_PATH:
  rec('共有スケジュールの置き場が分かる（中継の検証に要る）',False,
      'WAVELOG_FIXTURE_SHARE も パス設定マスタ も空です')
 conf={'schedule_owner_enabled':'on','schedule_owner_port':str(port),'schedule_owner_ttl_sec':'60'}
 # 受け口の読み待ちに上限があること（§9.269、利用者の指示）。
 # `ThreadingHTTPServer`は接続ごとにスレッドを作り、既定は無期限——
 # **合言葉を確かめるのは本文を読んだ後**なので、繋いで黙っている相手が
 # 並ぶと認証の前にスレッドが積み上がる。依頼側の12秒より短いこと。
 rec('受け口の読み待ちに上限がある（繋いで黙る相手にスレッドを握らせない）',
     isinstance(so._Handler.timeout,(int,float)) and 0<so._Handler.timeout<12,
     f'timeout={so._Handler.timeout}')
 # **属性を見るだけで終わらせない**——`timeout`を持っていても、拾い方を
 # 間違えれば接続は解放されない。実際に繋いで黙り、閉じられるまでを見る。
 # **上限が無いときは繋ぎに行かない**（`None+6`で落ちると、以降の網が
 # 1件も動かなくなる。落ちるより「試せなかった」と報告するほうがよい）。
 _lim=so._Handler.timeout if isinstance(so._Handler.timeout,(int,float)) else None
 if _lim is None:
  rec('繋いで黙る相手は時間切れで閉じられる',False,'読み待ちの上限が無いので試せません')
  rec('そのスレッドが解放される（積み上がらない）',False,'同上')
 else:
  _probe_srv=ThreadingHTTPServer(('127.0.0.1',0),so._Handler)
  _probe_srv.daemon_threads=True
  threading.Thread(target=_probe_srv.serve_forever,daemon=True).start()
  try:
   _before=threading.active_count()
   _sock=socket.create_connection(('127.0.0.1',_probe_srv.server_address[1]))
   time.sleep(0.4)
   _during=threading.active_count()
   _sock.settimeout(_lim+6)
   _t0=time.time()
   try:
    _sock.recv(16)
    _closed=time.time()-_t0
   except socket.timeout:
    _closed=None
   _sock.close()
   time.sleep(0.4)
   _after=threading.active_count()
   rec('繋いで黙る相手は時間切れで閉じられる',
       _closed is not None and _closed<_lim+3,
       f'{_closed:.1f}秒後に閉じられた' if _closed is not None else '閉じられなかった')
   rec('そのスレッドが解放される（積み上がらない）',
       _after<=_before and _during>_before,
       f'接続前={_before} 接続中={_during} 解放後={_after}')
  finally:
   _probe_srv.shutdown()
 so.SCHEDULE_SHARE_PATH=tmp/'schedule.sqlite3'
 so.path_config_value=lambda k,d=None:conf.get(k,d)
 added=[]
 try:
  # 1) 既定はon（§9.269、利用者の指示「常にそれを正にしてください」）。
  #    **設定が無いときの答え**を見る（空文字＝未設定を渡す）。
  conf.pop('schedule_owner_enabled',None)
  rec('既定は on（設定していなければ書き込み役を立てる）',so.enabled(),
      'path_config に行が無いとき')
  conf['schedule_owner_enabled']=''
  rec('空欄も既定（on）として読む',so.enabled(),'空文字')
  # **切る道は残す**——受け口のポートを開けない現場があるので、規程に
  # 合わせる道を塞がない。切っても壊れない（各PCが自分で共有へ書く）。
  conf['schedule_owner_enabled']='off'
  rec('offにすれば持ち主にならない',not so.enabled() and so.claim() is False)
  conf['schedule_owner_enabled']='on'

  # 2) 最初に入った1台が持ち主
  rec('最初の1台が持ち主になる',so.claim() is True and so.is_owner())
  marker=json.loads((tmp/so.MARKER_FILENAME).read_text(encoding='utf-8'))
  rec('目印に合言葉と受け口が載る',bool(marker.get('token')) and bool(marker.get('urls')),
      f"port={marker.get('port')}")

  # 3) 2台目は名乗り出ない（別プロセスの札に化けて確かめる）
  first_id=so._state['id']
  so._state['id']='another-instance'
  so._state['owner']=False
  second=so.claim()
  rec('2台目は名乗り出ない',second is False and not so.is_owner(),
      f'owner={so._state["marker"].get("id")}')

  # 4) 期限が切れたら引き継げる
  stale=dict(marker);stale['beat']=time.time()-99999
  (tmp/so.MARKER_FILENAME).write_text(json.dumps(stale),encoding='utf-8')
  took=so.claim()
  rec('期限切れの持ち主は引き継げる',took is True and so.is_owner())
  so._state['id']=first_id
  so.claim(force=True)

  # ---- 受け口を開く（ここから実際にHTTPで話す） ----
  so._start_server()
  time.sleep(0.3)
  base=f'http://127.0.0.1:{port}'
  token=so._state['token']

  opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
  with opener.open(base+'/owner/ping',timeout=10) as r:
   ping=json.loads(r.read().decode('utf-8'))
  rec('生存確認に答える',ping.get('ok') and ping.get('app_id')=='wavelog',ping)

  st,_b=post(base+'/owner/relay',{'path':'/api/schedule/plan/add','body':{}},token='wrong-token')
  rec('合言葉が違えば断る（通信エラーではなく403で答える）',st==403,f'status={st} {_b}')

  for bad in ('/api/shutdown','/api/schedule/calendar','/api/schedule/session/acquire','/api/access-mode'):
   st,_b=post(base+'/owner/relay',{'path':bad,'body':{}},token=token)
   if st!=403:
    rec(f'決められたパス以外は断る({bad})',False,st);break
  else:
   rec('決められたパス以外は断る（停止・設定系マスタ・編集セッション）',True)

  # 5)6) 中継された書き込みは持ち主のモードで弾かれず、素性がそのまま残る
  # **他のテストと設備を共有しない**——設備の編集セッションは設備ごとなので、
  # 共有すると前のテストの掴みっぱなしで結果が変わる(§9.121)。
  from backend.access_mode import get_mode
  eq='__持ち主テスト設備__'
  st,body=post(base+'/owner/relay',{'path':'/api/schedule/plan/add',
    'body':{'equipment':eq,'kind':'コメント','title':'持ち主テスト','user_id':'owner_test_uid'},
    'login':'relay_login','pc':'RELAY-PC','mode':'edit'},token=token)
  ok=(st==200 and body.get('id') is not None)
  if ok:added.append(body['id'])
  rec('中継された書き込みが通る（持ち主のモードで二重に弾かれない）',ok,
      f'持ち主のモード={get_mode()} status={st} {body}')

  if ok:
   from backend.repositories import schedule_repo as sr
   from backend import schedule_sync
   local,_stale=schedule_sync.fetch_snapshot(force=True)
   from backend.db_access import connect
   c=connect(local,True,'sqlite')
   try:
    cur=c.cursor()
    cur.execute('SELECT [登録者ID],[登録端末名] FROM [作業予定] WHERE [予定ID]=?',(body['id'],))
    row=cur.fetchone()
   finally:c.close()
   rec('頼んだ端末の利用者IDと端末名が残る',
       bool(row) and row[0]=='owner_test_uid' and row[1]=='RELAY-PC',row)

  if ok:
   # 消す側も同じ道を通る（入れたものはここで片付ける。§9.121）
   st,dbody=post(base+'/owner/relay',{'path':'/api/schedule/plan/delete',
     'body':{'id':added[0],'user_id':'owner_test_uid'},
     'login':'relay_login','pc':'RELAY-PC','mode':'schedule'},token=token)
   gone=False
   if st==200:
    from backend import schedule_sync
    from backend.db_access import connect
    local,_s2=schedule_sync.fetch_snapshot(force=True)
    c=connect(local,True,'sqlite')
    try:
     # 削除は[有効]=0の論理削除(schedule_repo.plan_delete)
     cur=c.cursor();cur.execute('SELECT COUNT(*) FROM [作業予定] WHERE [予定ID]=? AND ([有効] IS NULL OR [有効]<>0)',(added[0],))
     gone=(cur.fetchone()[0]==0)
    finally:c.close()
   if gone:added.clear()
   rec('中継で消せる（入れたものが残らない）',st==200 and gone,f'status={st} {dbody}')

  # 6c) **モードも運ぶ**。scheduleモードの端末の書き込みは、持ち主(edit)側でも
  #     設備の編集セッション(§9.11)を要求する——運ばないと、持ち主を経由した
  #     書き込みだけ設備の排他が外れる。
  from backend import schedule_sync
  held=False
  try:
   schedule_sync.acquire_session(eq,'別の人','OTHER-PC');held=True
  except Exception as e:
   print('（セッションを取れませんでした:',e,'）')
  if held:
   # **既定では止めない**（§9.291 ③、利用者との確認）。編集セッションは
   # 「主担当は誰か」を見せるだけになったので、他の人が編集中でも通る。
   st,sbody=post(base+'/owner/relay',{'path':'/api/schedule/plan/add',
     'body':{'equipment':eq,'kind':'コメント','title':'排他テスト','user_id':'owner_test_uid'},
     'login':'relay_login','pc':'RELAY-PC','mode':'schedule'},token=token)
   if st==200 and sbody.get('id') is not None:added.append(sbody['id'])
   rec('既定では他の人が編集中でも中継の書き込みは通る（§9.291 ③）',
       st==200,f'status={st} {sbody}')
   # **`on`にすれば今までどおり止まる**。ここで確かめるのは
   # 「**頼んだ端末のモードで判定している**」こと——運ばないと、持ち主
   # （たいていedit）のモードで判定され、**持ち主を経由した書き込みだけ
   # 排他が外れる**。設定を戻すのは`finally`で必ず。
   from backend.db_access import DBS, connect as _conn
   def _set_block(v):
    c=_conn(DBS['MASTER']['path'],False)
    try:
     cur=c.cursor()
     cur.execute('DELETE FROM [パス設定マスタ] WHERE [設定キー]=?',['schedule_session_block'])
     if v:cur.execute('INSERT INTO [パス設定マスタ] ([設定キー],[設定値]) VALUES (?,?)',
                      ['schedule_session_block',v])
     c.commit()
    finally:c.close()
   try:
    _set_block('on')
    st2,sbody2=post(base+'/owner/relay',{'path':'/api/schedule/plan/add',
      'body':{'equipment':eq,'kind':'コメント','title':'排他テスト2','user_id':'owner_test_uid'},
      'login':'relay_login','pc':'RELAY-PC','mode':'schedule'},token=token)
    if st2==200 and sbody2.get('id') is not None:added.append(sbody2['id'])
    rec('onにすると頼んだ端末のモードで判定して断る（持ち主のモードで判定しない）',
        st2==423,f'status={st2} {sbody2}')
   finally:
    _set_block(None)
   try:schedule_sync.release_session(eq,'別の人','OTHER-PC')
   except Exception:pass

  # 6d) 合言葉が合わないときは**自分で書く道へ落とす**（画面へ「合言葉が
  #     違います」と出しても、利用者には打つ手が無い）。持ち主が入れ替わった
  #     直後は手元の目印が古いので、読み直して1回だけやり直す。
  saved_marker=dict(so._state['marker'] or {})
  stale={**saved_marker,'token':'stale-token',
         'urls':[f'http://127.0.0.1:{port}']}
  # (a) 手元の目印が古いだけなら、読み直して1回だけやり直す
  so._state['marker']=stale
  st,out=so.relay('/api/schedule/plan/add',
                  {'equipment':eq,'kind':'コメント','title':'合言葉テスト',
                   'user_id':'owner_test_uid'},'relay_login','RELAY-PC','edit')
  if st==200 and isinstance(out,dict) and out.get('id') is not None:added.append(out['id'])
  rec('手元の目印が古いだけなら、読み直してやり直す',st==200,f'{st} {out}')
  # (b) 読み直しても合わなければ、断り文句ではなく自力へ落とす
  so._write_marker({k:v for k,v in stale.items() if k!='urls'} | {'urls':stale['urls']})
  so._state['marker']=stale
  st2,why=so.relay('/api/schedule/plan/add',{'equipment':eq,'kind':'コメント'},
                   'relay_login','RELAY-PC','edit')
  rec('合言葉が合わなければ、断り文句ではなく自力へ落とす',st2 is None,f'{st2} {why}')
  so._write_marker(saved_marker);so._state['marker']=saved_marker

  # 7) 中継されてきたものを中継し返さない
  from app import app as flask_app
  from backend.routes import schedule as sched_routes
  hdr={so.HDR_TOKEN:token,so.HDR_LOGIN:'relay_login',so.HDR_PC:'RELAY-PC',so.HDR_MODE:'schedule'}
  real_should=so.should_relay
  so.should_relay=lambda:True                     # 「持ち主が別に居る」ことにする
  try:
   with flask_app.test_request_context('/api/schedule/plan/add',method='POST',
                                       json={},headers=hdr):
    again=sched_routes._relay_write({})
   rec('中継されてきたものを中継し返さない',again is None)
   # 8) 持ち主へ届かないときは自分で書く（＝Noneを返して呼び出し元へ委ねる）
   so._state['owner']=False
   so._state['marker']={'id':'x','token':'t','beat':time.time(),
                        'urls':[f'http://127.0.0.1:{free_port()}']}   # 誰も居ないポート
   with flask_app.test_request_context('/api/schedule/plan/add',method='POST',json={}):
    fell=sched_routes._relay_write({})
   rec('持ち主へ届かなければ自分で書く',fell is None,so._state['last_error'])
  finally:
   so.should_relay=real_should
   so._state['owner']=True

  # 6b) モードは合言葉を確かめてからでないと信じない
  rec('合言葉なしのヘッダは信じない',
      so.relayed_mode({so.HDR_TOKEN:'にせ',so.HDR_MODE:'schedule'}) is None
      and so.relayed_identity({so.HDR_LOGIN:'誰か'}) is None)
  rec('合言葉つきならモードを返す',so.relayed_mode(hdr)=='schedule')

  # 8b) 受け口が通さない書込は**そもそも頼まない**（頼むと持ち主の
  #     「受け付けません」がそのまま画面へ出る。自分で書けば済む場面）。
  so._state['owner']=False
  so._state['marker']={**saved_marker,'urls':[f'http://127.0.0.1:{port}']}
  real_should2=so.should_relay
  so.should_relay=lambda:True
  try:
   with flask_app.test_request_context('/api/schedule/calendar',method='POST',json={}):
    other=sched_routes._relay_write({})
   rec('受け口が通さない書込は頼まない',other is None)
  finally:
   so.should_relay=real_should2
   so._state['owner']=True

  # ==================================================================
  # §9.301 ① 書込役が応答しないときの切り分けと引き取り
  # ------------------------------------------------------------------
  # 利用者の指示「書き込み役が自分ではない場合に、書き込み失敗するような
  # 場合、相手のPCが落ちている可能性があります…PC落ちか、スリープ中？
  # サーバー落ちを判断して書き込み権限を執行する機能などを実装しておく
  # 必要もありそうです」。
  #
  # **こちらから見分けられるのはTCPが届くかどうかまで**なので、それ以上
  # （電源断かスリープか）は「見分けられません」と書く（§3・§4）。
  # ==================================================================
  # 10a) 自分が書込役なら引き取る必要は無い
  so._state['owner']=True
  p=so.probe_owner()
  rec('自分が書込役なら「引き取る必要はありません」',
      p['state']==so.PROBE_SELF and p['canTake'] is False,json.dumps(p,ensure_ascii=False)[:120])
  # 10b) 書込役が居ない（目印が無い）なら、引き取りではなく巡回に任せる
  so._state['owner']=False
  so._state['marker']=None
  mk=so.marker_path()
  bak=mk.read_text(encoding='utf-8') if mk.exists() else None
  try:
   if mk.exists():mk.unlink()
   p=so.probe_owner()
   rec('書込役が居なければ引き取らせない（巡回で決まる）',
       p['state']==so.PROBE_NONE and p['canTake'] is False,json.dumps(p,ensure_ascii=False)[:120])
   # 10c) **応答しない書込役は引き取れる。** 期限内（目印は生きている）でも、
   #      受け口が居ないなら待っても無駄——ここが「執行」の入口。
   dead=free_port()          # 掴まずに使う＝接続は即座に拒否される
   so._write_marker({'id':'ghost','app_id':'x','token':'t','pc':'GHOST-PC',
                     'login':'ghost','urls':[f'http://127.0.0.1:{dead}'],
                     'beat':time.time(),'since':time.time()})
   so._state['marker']=so.read_marker()
   p=so.probe_owner(timeout=1.5)
   rec('応答しない書込役は理由つきで「引き取れる」と答える',
       p['canTake'] is True and p['state'] in (so.PROBE_REFUSED,so.PROBE_TIMEOUT,
                                               so.PROBE_UNREACHABLE),
       f"{p['state']} / {p['label']}")
   # **文言もサーバーが持つ**（§9.163）——画面はこれをそのまま出す。
   rec('「PCは動いているがアプリが落ちた」を言い分ける',
       p['state']!=so.PROBE_REFUSED or 'アプリ' in p['note'],p['note'])
   rec('見分けられないことは見分けられないと書く（§3）',
       p['state']!=so.PROBE_TIMEOUT or '見分けられません' in p['note'],p['note'])
   # 10d) **応答する書込役からは引き取らせない。** 相手はまだ書けるので、
   #      二重に書ける状態をわざわざ作らない。
   live=ThreadingHTTPServer(('127.0.0.1',0),so._Handler)
   live.daemon_threads=True
   threading.Thread(target=live.serve_forever,daemon=True).start()
   try:
    so._write_marker({'id':'other','app_id':'x','token':'t','pc':'LIVE-PC',
                      'login':'live','urls':[f'http://127.0.0.1:{live.server_address[1]}'],
                      'beat':time.time(),'since':time.time()})
    so._state['marker']=so.read_marker()
    p=so.probe_owner(timeout=2.0)
    rec('応答する書込役は「引き取れません」',
        p['state']==so.PROBE_OK and p['canTake'] is False,f"{p['state']} / {p['label']}")
    ok,_p=so.take_over('tester','TEST-PC')
    rec('応答する書込役からは引き取らない（口も断る）',ok is False,str(ok))
   finally:
    live.shutdown()
   # 10e) **届かなかった書込役をしばらく信じない。** 目印は期限まで生きて
   #      いるので、これが無いと**書き込みのたびに届かない相手を待つ**
   #      （実測の最悪で12秒×URLの数）。利用者の言う「書き込み失敗するような
   #      場合」の待ち時間そのもの。
   so._state['relay_down_until']=0.0
   so._write_marker({'id':'ghost2','app_id':'x','token':'t','pc':'GHOST-PC',
                     'login':'ghost','urls':[f'http://127.0.0.1:{dead}'],
                     'beat':time.time(),'since':time.time()})
   so._state['marker']=so.read_marker()
   rec('前提: 目印は生きているので、ふだんなら中継する',so.should_relay() is True,
       f"alive={so._alive(so._state['marker'])}")
   st,_out=so.relay('/api/schedule/plan/add',{},'tester','TEST-PC','schedule',timeout=1.5)
   rec('届かなければ中継は失敗を返す（握り潰さない）',st is None,str(st))
   rec('届かなかった書込役はしばらく信じない（次の書き込みを待たせない）',
       so.should_relay() is False,
       f"down={so.status().get('relayDownSec')}秒 why={so.status().get('relayDownWhy')}")
   rec('休んでいることを画面へ出せる（理由つき）',
       float(so.status().get('relayDownSec') or 0)>0 and bool(so.status().get('relayDownWhy')),
       json.dumps({k:so.status().get(k) for k in ('relayDownSec','relayDownWhy')},ensure_ascii=False))
   # 10f) **応答しない書込役は本当に引き取れる**（口まで通す）。
   so._state['relay_down_until']=0.0
   ok,p=so.take_over('tester','TEST-PC')
   rec('応答しない書込役は引き取れる（このPCが書込役になる）',
       ok is True and so.is_owner() is True,f'ok={ok} owner={so.is_owner()}')
   m=so.read_marker() or {}
   rec('誰から引き取ったかを目印に残す（理由の分からない入れ替わりを作らない）',
       isinstance(m.get('taken_from'),dict) and m['taken_from'].get('pc')=='GHOST-PC',
       json.dumps(m.get('taken_from'),ensure_ascii=False))
  finally:
   so._state['owner']=True
   if bak is not None:
    try:mk.write_text(bak,encoding='utf-8')
    except Exception:pass
  # 10g) **切り分けの語彙は全部が文言を持つ**（§9.163・§4）——1つ足して
  #      文言を書き忘れると、画面には空の帯が出る。
  states=[v for k,v in vars(so).items() if k.startswith('PROBE_') and isinstance(v,str)]
  rec('切り分けの語彙は全部が文言を持つ',
      all(x in so._PROBE_TEXT for x in states),
      str([x for x in states if x not in so._PROBE_TEXT]))

  # ==================================================================
  # §9.301 ② 終わる前の片付け
  # ------------------------------------------------------------------
  # 利用者の指示「そういう意味で安全なアプリの終了ボタンも欲しいです」。
  # 「安全」の中身は**片付け**——共有の目印を残したまま落ちると、他の端末が
  # 期限（既定90秒）まで待たされる（それが§9.301 ①の待ち時間の元）。
  # **`_exit()`から呼ぶ1箇所**なので、タブを閉じたときも`stop.bat`のときも
  # 終了ボタンのときも同じ片付けが走る。
  # ==================================================================
  from backend import watchdog, schedule_sync as _ss
  so._state['owner']=True
  so._write_marker(so._me())
  so._state['marker']=so.read_marker()
  rec('前提: このPCが書込役の目印を持っている',bool(so.read_marker() or {}),'')
  # 編集セッションは**別の一時ファイル**で試す（フィクスチャの共有を汚さない）。
  _share_bak=_ss.SCHEDULE_SHARE_PATH
  _ss.SCHEDULE_SHARE_PATH=tmp/'schedule.sqlite3'
  try:
   from backend.access_mode import current_login_id,current_pc_name
   _ss.acquire_session('片付け設備',current_login_id(),current_pc_name())
   held=[x['equipment'] for x in (_ss.sessions_all(current_login_id(),current_pc_name())
                                  .get('sessions') or []) if x.get('mine')]
   rec('前提: 編集セッションを持っている','片付け設備' in held,str(held))
   done=watchdog.teardown()
   rec('終わる前に書込役をやめる（次のPCが期限を待たずに引き継げる）',
       done.get('owner') is True and not (so.read_marker() or {}).get('id'),
       json.dumps(done,ensure_ascii=False)[:160])
   rec('終わる前に編集セッションを手放す（他のPCを読み取り専用のままにしない）',
       '片付け設備' in (done.get('sessions') or []),str(done.get('sessions')))
   left=[x['equipment'] for x in (_ss.sessions_all(current_login_id(),current_pc_name())
                                  .get('sessions') or []) if x.get('mine')]
   rec('手放したセッションは共有からも消えている','片付け設備' not in left,str(left))
   rec('片付けの結果を返す（終了ボタンが何をしたか書ける・§4）',
       set(['owner','sessions','presence','errors'])<=set(done.keys()),str(sorted(done.keys())))
   # **`teardown()`を直に呼ぶ網では足りない**——`_exit()`が通していなくても
   # 通る（§9.290「説明だけが先にあって実物が無い」と同じ形）。終了そのものを
   # 差し替えて、**落ちる道が本当に片付けを通るか**を見る。
   called={'n':0}
   real_td,real_exit=watchdog.teardown,os._exit
   watchdog.teardown=lambda:(called.__setitem__('n',called['n']+1),{'owner':False,
     'sessions':[],'presence':False,'errors':[]})[1]
   os._exit=lambda code=0:None
   try:
    watchdog._exit('検証: 片付けを通るか')
   finally:
    watchdog.teardown,os._exit=real_td,real_exit
   rec('終了する道は必ず片付けを通る（タブを閉じても stop.bat でも同じ）',
       called['n']==1,f"teardown={called['n']}回")
  finally:
   _ss.SCHEDULE_SHARE_PATH=_share_bak

  # 9) 中継するのは共有DBを書く5本だけ
  rec('中継するのは共有DBを書く5本だけ',
      set(so.RELAY_PATHS)=={'/api/schedule/plan/add','/api/schedule/plan/update',
                            '/api/schedule/plan/delete','/api/schedule/plan/reorder',
                            '/api/schedule/plan/batch'},so.RELAY_PATHS)
 finally:
  # 後始末: 入れた予定を消す(§9.121。置き土産は遠いテストを落とす)
  try:
   from app import app as flask_app
   with flask_app.test_client() as c:
    for pid in added:
     c.post('/api/schedule/plan/delete',json={'id':pid,'user_id':'owner_test_uid'},
            headers={so.HDR_TOKEN:so._state['token'],so.HDR_LOGIN:'relay_login',
                     so.HDR_PC:'RELAY-PC',so.HDR_MODE:'schedule'})
  except Exception as e:
   print('後始末に失敗:',e)
  try:so._stop_server()
  except Exception:pass
  try:so.resign()
  except Exception:pass
 ng=[i for i,ok in enumerate(R) if not ok]
 print(f'\n{len(R)-len(ng)}/{len(R)} PASS')
 return 1 if ng else 0

if __name__=='__main__':
 sys.exit(main())
