"""schedule_owner.py: 共有スケジュールの「持ち主」(§9.192)

利用者の構想: 「1台を持ち主にしてHTTPで話す。最初に入った1台を持ち主に。
ただしBOX上の同じ起動ファイルから数人が起動して同時利用する。ブラウザの
URLはみな http://127.0.0.1:5029/ になると思うが実現可能か」。

**実現できる。ただし『ブラウザが持ち主へ直接つなぐ』のではない。**
各PCは今までどおり自分のFlask(127.0.0.1:5029)を開き、画面もそのまま。
変えるのは**共有ファイルへ実際に書く役を1台に絞る**ことだけで、持ち主以外の
サーバーは「書き込みの依頼」だけを持ち主へHTTPで転送する。

  ブラウザ(PC-B) → 127.0.0.1:5029(PC-BのWaveLog) ─HTTP→ PC-A(持ち主) → 共有DB
                                （画面のURLは変わらない）

なぜこの形か:
 ・**読みは中継しない。** 予定の一覧は「共有の予定＋その端末のローカルの実績」
   の混成で、中継すると測定端末の実績が消える。持ち主が落ちても読めなく
   なるのも困る（今は手元の写しで読める）。
 ・**書きだけ中継する。** 共有DBへ書くのは`with_write()`1本(§4.2)なので、
   絞る場所も1箇所で済む。
 ・**持ち主が居なくても止まらない。** 転送に失敗したら今までどおり自分で
   共有ファイルを掴んで書く（ロック＋改訂番号の砦はそのまま残す）。

持ち主の決め方は、既にある短命ロック(schedule.lock.json)と編集セッション
(schedule.sessions.json)の作法をそのまま借りる——共有フォルダへ目印
(schedule.owner.json)を置き、**書く→少し待つ→読み直して自分か確かめる**。
BOXの結果整合性では完全な排他にならないので、**二重に立ちうる前提**で
`with_write()`のロックと改訂番号は絶対に外さないこと（最後の砦）。

安全面: 持ち主だけが**専用の小さな受け口**をLANへ開く（本体のFlaskは
127.0.0.1のまま）。受け口が受けるのは、目印ファイルの合言葉(token)を持つ
相手の、**決められたパスへの書き込みだけ**。合言葉は共有フォルダを読める
端末しか知りようがない。`/api/shutdown`や`/api/access-mode`のような
アプリ全体の操作はこの受け口には無いので、LANからは触れない。
"""
import json
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import atomic_io
from .config import APP_ID, SCHEDULE_OWNER_PORT_DEFAULT, SCHEDULE_OWNER_TTL_SEC_DEFAULT
from .db_access import SCHEDULE_SHARE_PATH, path_config_value
from .logging_setup import app_logger
from .quiet import quiet

MARKER_FILENAME='schedule.owner.json'
# 転送してよいパス。**共有スケジュールDB(schedule.sqlite3)へ書く5本だけ**。
# これらは routes/schedule.py の `_write_response()` を通る＝
# `schedule_sync.with_write()`(§4.2)で共有ファイルを掴む唯一の道で、
# 差し込む場所も1箇所で済む。
#
# 入れていないもの:
#  ・**読み(GET)**……予定の一覧は「共有の予定＋その端末のローカルの実績」の
#    混成なので、中継すると測定端末の実績が消える。持ち主が落ちても読めなく
#    なるのも困る（今は手元の写しで読める）。
#  ・**設定系マスタ**(稼働カレンダー・設備停止・勤務形態・換算係数上書き)
#    ……保存先はその端末のmaster.sqlite3で、共有ファイルではない(§9.27)。
#  ・**編集セッション/ロック**(`/api/schedule/session/*`、schedule.lock.json)
#    ……こちらは小さなJSONを「書く→待つ→読み直す」で確かめる別の仕組みで、
#    **持ち主が二重に立った場合の最後の砦**でもある。持ち主に依存させると、
#    持ち主が落ちている間だけ砦が無くなる。各端末が自分で書き続ける。
RELAY_PATHS=(
 '/api/schedule/plan/add','/api/schedule/plan/update','/api/schedule/plan/delete',
 '/api/schedule/plan/reorder','/api/schedule/plan/batch',
)
# 中継されてきたことを示すヘッダ。**誰が・どの端末で・どのモードで**操作
# したかを運ぶ。
#  ・誰が/どの端末で……運ばないと、ロックの保持者も編集セッションも全部
#    「持ち主PCの人」になり、設備単位の排他が全端末で自分扱いになる。
#  ・どのモードで……設備の編集セッション(§9.11)を要求するのはscheduleモード
#    だけ。持ち主はたいていeditモードなので、持ち主のモードで判定すると
#    **持ち主を経由した書き込みだけ排他が外れる**（同じ設備を2人が同時に
#    触れてしまう）。頼んだ端末のモードで判定する。
HDR_TOKEN='X-Wavelog-Owner-Token'
HDR_LOGIN='X-Wavelog-Login'
HDR_PC='X-Wavelog-Pc'
HDR_MODE='X-Wavelog-Mode'
# 受け口が受け取る依頼の上限。まとめ書込(§9.45)でも数十KBなので十分広い。
MAX_RELAY_BYTES=8*1024*1024
# 受け口の1接続あたりの読み待ち上限(§9.269)。**依頼側の12秒より短くする**
# ——長くしても、頼んだ側はもう諦めて自分で書いているので誰も待っていない。
RELAY_SOCKET_TIMEOUT_SEC=10
# 届かなかった書込役を信じない時間（§9.301 ①）。**目印の期限より短くする**
# ——長くすると、相手が戻ってきても中継へ帰れない時間が伸びる。
RELAY_DOWN_SEC=30

_state={
 'id':uuid.uuid4().hex,      # このプロセスの札
 'token':uuid.uuid4().hex,   # 受け口の合言葉(持ち主になったときに配る)
 'owner':False,              # 自分が持ち主か
 'marker':None,              # 最後に読んだ目印
 'url':'',                   # 持ち主の受け口(自分が持ち主なら自分のURL)
 'last_error':'',
 'checked_at':0.0,
 'relays':0,'relay_fail':0,
 # **届かなかった書込役を、しばらく信じない**（§9.301 ①）。この時刻までは
 # `should_relay()`が偽になり、書き込みは即座に自分で書く道へ落ちる
 # ——目印は期限（既定90秒）まで「生きている」ままなので、これが無いと
 # **その90秒のあいだ、書き込みのたびに12秒×URLの数だけ待たされる**
 # （実測の最悪で36秒。利用者の報告「書き込み失敗するような場合」の正体）。
 'relay_down_until':0.0,
 'relay_down_why':'',
 'server':None,
 'bound_port':0,            # 受け口が実際に掴んでいるポート(設定変更に追従する)
 'running':False,
}
_lock=threading.Lock()


# ------------------------------------------------------------------
# 設定
# ------------------------------------------------------------------
def enabled():
 """**既定は on**（§9.269、利用者の指示「常にそれを正にしてください」）。

 §9.192では「現場の端末をいきなりLANへ開かない」として既定offにしていたが、
 **共有へ書くのを1台に絞るのが正しい形**という判断になった。切るための
 スイッチは残す——**listenポートを開けない現場がある**（社内規程・
 ファイアウォール）ので、規程に合わせる道を塞がない。

 **切ってあっても壊れない。** 持ち主になれない／頼めない端末は今までどおり
 自分で共有へ書く（ロックと改訂番号の砦はどちらの道でも同じ）。
 """
 v=str(path_config_value('schedule_owner_enabled','on') or 'on').strip().lower()
 return v not in ('off','no','false','0')


def relay_port():
 try:n=int(path_config_value('schedule_owner_port',SCHEDULE_OWNER_PORT_DEFAULT))
 except (TypeError,ValueError):n=SCHEDULE_OWNER_PORT_DEFAULT
 return n if 1024<n<65536 else SCHEDULE_OWNER_PORT_DEFAULT


def ttl_sec():
 try:n=int(path_config_value('schedule_owner_ttl_sec',SCHEDULE_OWNER_TTL_SEC_DEFAULT))
 except (TypeError,ValueError):n=SCHEDULE_OWNER_TTL_SEC_DEFAULT
 return max(30,n)


def marker_path():
 return SCHEDULE_SHARE_PATH.parent/MARKER_FILENAME if SCHEDULE_SHARE_PATH else None


# ------------------------------------------------------------------
# 目印（誰が持ち主か）
# ------------------------------------------------------------------
def _now():return time.time()


def read_marker():
 """目印を読む。**読めない＝居ないではない**(共有越しでは読みだけ失敗する
 ことがある)ので、失敗はNoneで返して呼び出し側で「分からない」と扱う。"""
 p=marker_path()
 if not p:return None
 try:
  return json.loads(p.read_text(encoding='utf-8'))
 except FileNotFoundError:
  return {}
 except Exception as e:
  with _lock:_state['last_error']=f'目印を読めません: {e}'
  return None


def _write_marker(data):
 p=marker_path()
 if not p:return False
 try:
  p.parent.mkdir(parents=True,exist_ok=True)
  tmp=p.with_suffix(f'.{uuid.uuid4().hex}.tmp')
  tmp.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
  atomic_io.replace(tmp,p,label='schedule.owner')
  return True
 except Exception as e:
  with _lock:_state['last_error']=f'目印を書けません: {e}'
  return False


def _alive(marker):
 """目印が生きているか（期限内か）。"""
 if not isinstance(marker,dict) or not marker.get('id'):return False
 try:beat=float(marker.get('beat') or 0)
 except (TypeError,ValueError):return False
 return (_now()-beat)<ttl_sec()


_urls_cache={'at':0.0,'port':0,'urls':[]}


def local_urls():
 """他のPCから届きうる自分のURLの候補。**1つに決めない**——複数NIC・VPNでは
 「自分から見える自分のIP」と「相手から届くIP」が違う。ホスト名を先に置く
 （社内LANでは名前で引けるほうが安定する）。

 **60秒だけ覚える。** 名前解決(gethostbyname_ex)はDNSの調子で待たされる
 ことがあり、状態表示は10秒ごとに来る——毎回引くと、その待ちがそのまま
 画面の待ちになる。持ち場が変わる（無線↔有線）ことはあるので永久には
 覚えない。"""
 port=relay_port()
 now=_now()
 if _urls_cache['urls'] and _urls_cache['port']==port and (now-_urls_cache['at'])<60:
  return list(_urls_cache['urls'])
 out=[]
 try:
  host=socket.gethostname()
  if host:out.append(f'http://{host}:{port}')
  try:
   _n,_a,ips=socket.gethostbyname_ex(host)
  except Exception as _e:
   quiet('IPを引けない（名前だけで頼む）',_e)
   ips=[]
  for ip in ips:
   if ip.startswith('127.'):continue
   u=f'http://{ip}:{port}'
   if u not in out:out.append(u)
 except Exception as _e:quiet('自分のURLを組み立てられない（残りの候補で頼む）',_e)
 if not out:out.append(f'http://127.0.0.1:{port}')
 _urls_cache.update({'at':now,'port':port,'urls':list(out)})
 return out


def _me(extra=None):
 from .access_mode import current_login_id, current_pc_name
 data={'id':_state['id'],'app_id':APP_ID,'token':_state['token'],
       'urls':local_urls(),'port':relay_port(),
       'login':current_login_id(),'pc':current_pc_name(),
       'beat':_now(),'since':(extra or {}).get('since') or _now()}
 return data


def claim(force=False):
 """持ち主になろうとする。戻り値: 自分が持ち主なら True。

 手順は短命ロック(§4.1)と同じ「書く→少し待つ→読み直す」。**待つのは
 新しく名乗るときだけ**で、延長のときは待たない（毎回待つと共有を
 掴む時間が伸びる。編集セッションと同じ作法）。"""
 if not enabled() or not SCHEDULE_SHARE_PATH:return False
 cur=read_marker()
 if cur is None:return False                       # 読めない＝分からない。何もしない
 mine=bool(cur) and cur.get('id')==_state['id']
 if not mine and _alive(cur) and not force:
  with _lock:_state['owner']=False;_state['marker']=cur;_state['checked_at']=_now()
  return False
 data=_me(cur if mine else None)
 if not _write_marker(data):return False
 if not mine:
  # BOXの結果整合性ゆえ、書いた直後は他端末の書き込みが見えていないことが
  # ある。少し待ってから読み直し、**自分の札が残っていること**を確かめる。
  time.sleep(1.5)
  again=read_marker()
  if not isinstance(again,dict) or again.get('id')!=_state['id']:
   with _lock:_state['owner']=False;_state['marker']=again;_state['checked_at']=_now()
   return False
 with _lock:
  _state['owner']=True;_state['marker']=data;_state['checked_at']=_now()
  _state['url']=(data.get('urls') or [''])[0]
 return True


def resign():
 """持ち主をやめる（目印を消す）。落ちるときに呼べるとは限らないので、
 **期限切れでも引き継げる**ようにしてある（これは念のため）。"""
 if not _state['owner']:return
 cur=read_marker()
 if isinstance(cur,dict) and cur.get('id')==_state['id']:
  p=marker_path()
  try:atomic_io.unlink(p,label='schedule.owner')
  except Exception as _e:quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
 with _lock:_state['owner']=False


# ------------------------------------------------------------------
# 持ち主かどうか／どこへ話すか
# ------------------------------------------------------------------
def is_owner():
 return bool(_state['owner'])


def owner_marker():
 return _state['marker']


def status():
 """画面へ出す状態。**どのURLで話しているかまで書く**(出どころを書く)。"""
 with _lock:
  st=dict(_state)
 m=st.get('marker') or {}
 on=enabled()
 # **切っているときは名前解決へ行かない**(§9.198)。`myUrls`は書込役の受け口を
 # 伝えるためのもので、機能が切ってあれば誰も見ない。ところがこの状態は
 # 10秒ごとに聞かれるため、DNSの調子が悪い端末では**使っていない機能のために
 # 定期的に待たされる**（切ってある現場が該当する）。
 return {
  'enabled':on,'configured':bool(SCHEDULE_SHARE_PATH),
  'running':st['running'],
  'isOwner':st['owner'],
  'ownerPc':m.get('pc') or '','ownerLogin':m.get('login') or '',
  'ownerUrl':st.get('url') or '',
  'ownerAliveSec':(round(_now()-float(m.get('beat') or 0),1) if m.get('beat') else None),
  'ttlSec':ttl_sec(),'port':relay_port(),
  'relays':st['relays'],'relayFail':st['relay_fail'],
  'lastError':st['last_error'],
  # **いま中継を休んでいるか**（§9.301 ①）。休んでいるあいだは自分で書くので、
  # 「書込役が居るのに自分で書いている」理由を画面が言えるようにする（§4）。
  'relayDownSec':(round(st.get('relay_down_until',0.0)-_now(),1)
                  if st.get('relay_down_until',0.0)>_now() else 0),
  'relayDownWhy':st.get('relay_down_why') or '',
  'takenFrom':(m.get('taken_from') or None),
  'myUrls':local_urls() if on else [],
 }


# ------------------------------------------------------------------
# 受け口（持ち主だけが開く小さなHTTPサーバー）
# ------------------------------------------------------------------
class _Handler(BaseHTTPRequestHandler):
 server_version='WaveLogOwner/1'
 # **繋いだまま黙っている相手にスレッドを握らせない**（§9.269、利用者の指示）。
 # `ThreadingHTTPServer`は接続ごとにスレッドを作り、既定では
 # `timeout=None`（＝無期限）。合言葉を確かめるのは本文を読んだ後なので、
 # **認証の前に1スレッド確保される**——繋ぐだけで何も送らない相手が並ぶと、
 # そのぶんスレッドが解放されないまま積み上がる。
 # 中継の依頼は数十KB（`MAX_RELAY_BYTES`は上限8MB）で、依頼側は12秒で
 # 諦めて自分で書く道へ落ちるので、**受ける側がそれより長く待つ意味は無い**。
 timeout=RELAY_SOCKET_TIMEOUT_SEC

 # **`handle_one_request`は上書きしない。** 最初は「時間切れを握りつぶす」
 # 上書きを足したが、網（実際に繋いで黙る）は**外しても通った**——
 # `BaseHTTPRequestHandler`が`socket.timeout`を自分で拾って
 # `close_connection`を立てるので、`timeout`を宣言するだけで足りる。
 # 動かして確かめられないコードは残さない。

 def log_message(self,fmt,*args):     # 既定の標準エラー出力を止める
  pass

 def _send(self,code,body):
  raw=json.dumps(body,ensure_ascii=False).encode('utf-8')
  self.send_response(code)
  self.send_header('Content-Type','application/json; charset=utf-8')
  self.send_header('Content-Length',str(len(raw)))
  self.end_headers()
  self.wfile.write(raw)

 def do_GET(self):
  # 生存確認だけ。**中身は返さない**(誰でも叩ける想定なので最小限)。
  if self.path=='/owner/ping':
   return self._send(200,{'ok':True,'app_id':APP_ID,'id':_state['id'],
                          'pc':(_state['marker'] or {}).get('pc','')})
  return self._send(404,{'error':'not found'})

 def do_POST(self):
  # **断るときも本文は読み切る。** 読まずに応答を書くと、送信中の相手には
  # 接続を切られたようにしか見えず（403ではなく通信エラーになる）、
  # 「持ち主へ届かない」のか「断られた」のかが切り分けられなくなる。
  try:
   n=int(self.headers.get('Content-Length') or 0)
  except (TypeError,ValueError):
   n=0
  if n>MAX_RELAY_BYTES:
   self.rfile.read(min(n,MAX_RELAY_BYTES))
   return self._send(413,{'error':'依頼が大きすぎます'})
  raw=self.rfile.read(n) if n>0 else b''
  if self.path!='/owner/relay':
   return self._send(404,{'error':'not found'})
  if self.headers.get(HDR_TOKEN)!=_state['token']:
   return self._send(403,{'error':'合言葉が違います'})
  try:
   payload=json.loads(raw.decode('utf-8')) if raw else {}
  except Exception as e:
   return self._send(400,{'error':f'読めません: {e}'})
  path=str(payload.get('path') or '')
  if path not in RELAY_PATHS:
   return self._send(403,{'error':f'この操作は受け付けません: {path}'})
  body=payload.get('body')
  headers={'Content-Type':'application/json',
           HDR_TOKEN:_state['token'],
           HDR_LOGIN:str(payload.get('login') or ''),
           HDR_PC:str(payload.get('pc') or ''),
           HDR_MODE:str(payload.get('mode') or '')}
  try:
   from app import app as flask_app
   # **自分のFlaskへ入れ直す**。routes/schedule.py の処理をそのまま通すので、
   # ロック・改訂番号・編集セッションの決まりは1本のまま(書き写さない)。
   with flask_app.test_client() as c:
    r=c.post(path,data=json.dumps(body or {}),headers=headers)
    try:out=r.get_json()
    except Exception as _e:quiet('本文をJSONとして読めない（空として断る）',_e);out=None
    return self._send(r.status_code,out if out is not None else {'ok':r.status_code<400})
  except Exception as e:
   app_logger().exception('持ち主の受け口で失敗しました: %s',path)
   return self._send(500,{'error':str(e)})


def _start_server():
 if _state['server']:return
 try:
  srv=ThreadingHTTPServer(('0.0.0.0',relay_port()),_Handler)
 except OSError as e:
  with _lock:_state['last_error']=f'受け口を開けません({relay_port()}): {e}'
  app_logger().warning('持ち主の受け口を開けませんでした: %s',e)
  return
 srv.daemon_threads=True
 t=threading.Thread(target=srv.serve_forever,name='schedule-owner',daemon=True)
 t.start()
 with _lock:_state['server']=srv;_state['bound_port']=relay_port()
 app_logger().info('共有スケジュールの持ち主になりました（受け口 %s）',
                   ', '.join(local_urls()))


def _stop_server():
 srv=_state['server']
 if not srv:return
 try:srv.shutdown()
 except Exception as _e:quiet('受け口を止められない（プロセスの終了で閉じる）',_e)
 try:srv.server_close()
 except Exception as _e:quiet('受け口を閉じられない（プロセスの終了で閉じる）',_e)
 with _lock:_state['server']=None;_state['bound_port']=0


# ------------------------------------------------------------------
# 転送（持ち主でない端末が書くとき）
# ------------------------------------------------------------------
_OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _candidate_urls(marker):
 urls=[u for u in (marker.get('urls') or []) if u]
 if not urls and marker.get('url'):urls=[marker['url']]
 return urls


def relay(path,body,login,pc,mode='',timeout=12.0,_retry=True):
 """持ち主へ書き込みを頼む。戻り値 (status, json) / 失敗は (None, 理由)。

 **失敗を握り潰さない。** 呼び出し側は今までどおり自分で書く道へ落ちる
 （持ち主が落ちていても仕事が止まらないことのほうが大事）。"""
 marker=_state['marker'] or read_marker()
 if not isinstance(marker,dict) or not marker.get('token'):
  return None,'持ち主が分かりません'
 payload=json.dumps({'path':path,'body':body,'login':login,'pc':pc,'mode':mode},
                    ensure_ascii=False).encode('utf-8')
 last=''
 for base in _candidate_urls(marker):
  req=urllib.request.Request(base.rstrip('/')+'/owner/relay',data=payload,
                             headers={'Content-Type':'application/json',
                                      HDR_TOKEN:str(marker.get('token') or '')})
  try:
   with _OPENER.open(req,timeout=timeout) as r:
    out=json.loads(r.read().decode('utf-8','replace') or '{}')
   with _lock:_state['relays']+=1;_state['url']=base
   return r.status,out
  except urllib.error.HTTPError as e:
   try:out=json.loads(e.read().decode('utf-8','replace') or '{}')
   except Exception:out={'error':str(e)}
   if e.code==403:
    # **合言葉違いは「持ち主の返事」ではない。** 持ち主が入れ替わった直後は
    # 手元の目印が古く、新しい持ち主に断られる。目印を読み直して1回だけ
    # やり直し、それでも駄目なら**自分で書く道へ落とす**（合言葉の話を
    # 画面へ出しても、利用者には打つ手が無い）。
    fresh=read_marker()
    if _retry and isinstance(fresh,dict) and fresh.get('token') and fresh.get('token')!=marker.get('token'):
     with _lock:_state['marker']=fresh
     return relay(path,body,login,pc,mode,timeout,_retry=False)
    with _lock:_state['relay_fail']+=1;_state['last_error']='持ち主の合言葉が合いません'
    return None,'持ち主の合言葉が合いません'
   # 持ち主が「できません」と答えた場合はそのまま返す(423/409…)。
   with _lock:_state['relays']+=1;_state['url']=base
   return e.code,out
  except Exception as e:
   last=f'{base}: {e}'
 why=last or '持ち主へ届きません'
 with _lock:
  _state['relay_fail']+=1;_state['last_error']=why
  # **次の書き込みは待たせない**（§9.301 ①）。届かないことが分かったので、
  # しばらくは自分で書く（ロックと改訂番号の砦はそのまま・§9.192）。
  _state['relay_down_until']=_now()+RELAY_DOWN_SEC
  _state['relay_down_why']=why
 _wake.set()   # 見張りを起こす（期限切れならすぐ引き継げる）
 return None,why


# ------------------------------------------------------------------
# 書込役が応答しないときの切り分け（§9.301 ①、利用者の指示「書き込み役が
# 自分ではない場合に、書き込み失敗するような場合、相手のPCが落ちている
# 可能性があります…PC落ちか、スリープ中？サーバー落ちを判断して書き込み権限を
# 執行する機能などを実装しておく必要もありそうです」）
# ------------------------------------------------------------------
# **こちらから見分けられるのはTCPが届くかどうかまで。** それ以上（電源断か
# スリープか無線が切れたか）は**分からない**ので、分からないと書く（§3・§4。
# 「スリープです」と言い切ると、電源が落ちている端末を待たせることになる）。
#  ・つながって受け口が答えた            → 生きている（引き取らせない）
#  ・つながるが受け口が居ない(refused)    → **PCは動いていてアプリだけ落ちた**
#  ・そのポートに別のものが居る           → アプリは居ない
#  ・返事が無い(timeout)/経路が無い/名前が引けない
#                                        → PCが落ちている・スリープ・網が届かない
PROBE_SELF='self'
PROBE_NONE='none'
PROBE_OK='ok'
PROBE_REFUSED='refused'
PROBE_OTHER_APP='other-app'
PROBE_TIMEOUT='timeout'
PROBE_UNREACHABLE='unreachable'
PROBE_UNKNOWN_HOST='unknown-host'
PROBE_ERROR='error'
PROBE_NO_URL='no-url'
# **文言もここが持つ**（§9.163）——画面へ書き写すと、切り分けを1つ足したときに
# 直す場所が2つになる。`take`＝引き取ってよいか。
_PROBE_TEXT={
 PROBE_SELF:('このPCが書込役です','引き取る必要はありません',False),
 PROBE_NONE:('書込役はまだ決まっていません',
             '次の巡回（最大%d秒）でどれかの端末が名乗り出ます',False),
 PROBE_OK:('書込役は動いています','応答があるので引き取れません',False),
 PROBE_REFUSED:('書込役のPCは動いていますが、アプリが終了しています',
                'アプリだけが落ちた（または閉じられた）状態です。引き取れます',True),
 PROBE_OTHER_APP:('書込役の受け口に別のものが応答しています',
                  'WaveLogの受け口ではありません。引き取れます',True),
 PROBE_TIMEOUT:('書込役から返事がありません',
                'PCが落ちているか、スリープ中か、ネットワークが届いていません'
                '（こちらからは見分けられません）。引き取れます',True),
 PROBE_UNREACHABLE:('書込役への経路がありません',
                    'PCが落ちているか、ネットワークが切れています。引き取れます',True),
 PROBE_UNKNOWN_HOST:('書込役の名前が引けません',
                     'その端末がネットワークに居ません。引き取れます',True),
 PROBE_ERROR:('書込役へ届きません','理由は下に出ています。引き取れます',True),
 PROBE_NO_URL:('書込役の受け口が分かりません',
               '目印に受け口のURLが入っていません。引き取れます',True),
}


def _probe_one(base,timeout):
 """1つのURLを試して (状態, 詳細) を返す。**接続と`/owner/ping`まで**——
 書き込みは投げない（確かめるだけの操作で共有を触らない）。"""
 url=str(base or '').rstrip('/')+'/owner/ping'
 try:
  req=urllib.request.Request(url,method='GET')
  with _OPENER.open(req,timeout=timeout) as r:
   body=json.loads(r.read().decode('utf-8','replace') or '{}')
  if str(body.get('app_id') or '')==APP_ID:
   return PROBE_OK,f'{base}: 応答あり'
  return PROBE_OTHER_APP,f'{base}: 別のものが応答しました'
 except urllib.error.HTTPError:
  # 何かが答えている＝待ち受けは居る。受け口の版が違うだけかもしれない。
  return PROBE_OTHER_APP,f'{base}: HTTPで応答（受け口ではありません）'
 except urllib.error.URLError as e:
  err=e.reason
 except Exception as e:
  err=e
 if isinstance(err,socket.gaierror):return PROBE_UNKNOWN_HOST,f'{base}: {err}'
 if isinstance(err,ConnectionRefusedError):return PROBE_REFUSED,f'{base}: {err}'
 if isinstance(err,(socket.timeout,TimeoutError)):return PROBE_TIMEOUT,f'{base}: 時間切れ'
 if isinstance(err,OSError):
  import errno as _errno
  # WindowsのWSAEHOSTUNREACH/WSAENETUNREACHもここへ来る。
  if err.errno in (_errno.EHOSTUNREACH,_errno.ENETUNREACH,10065,10051):
   return PROBE_UNREACHABLE,f'{base}: {err}'
  if err.errno in (_errno.ECONNREFUSED,10061):
   return PROBE_REFUSED,f'{base}: {err}'
  if err.errno in (_errno.ETIMEDOUT,10060):
   return PROBE_TIMEOUT,f'{base}: 時間切れ'
 return PROBE_ERROR,f'{base}: {err}'


# 悪いほうを採る順（**1つでも「生きている」が出たら生きている**）。
_PROBE_RANK=(PROBE_OK,PROBE_OTHER_APP,PROBE_REFUSED,PROBE_UNREACHABLE,
             PROBE_UNKNOWN_HOST,PROBE_TIMEOUT,PROBE_ERROR)


def probe_owner(timeout=2.5):
 """書込役が応答するか、しないなら**なぜか**。

 **判定と文言はここ1箇所**（§9.163）——画面はこの答えをそのまま出す。
 **短く試す**（既定2.5秒×URLの数）——これは「確かめる」ための操作なので、
 書き込みの12秒とは別。落ちているPCなら数秒で分かる。
 """
 if not enabled() or not SCHEDULE_SHARE_PATH:
  return {'state':PROBE_NONE,'label':'書込役を使わない設定です',
          'note':'マスタ管理 > 共通設定で入れられます','canTake':False,'tried':[]}
 if _state['owner']:
  return _probe_result(PROBE_SELF,[])
 marker=read_marker()
 if isinstance(marker,dict) and marker:
  with _lock:_state['marker']=marker
 if not isinstance(marker,dict) or not marker.get('id'):
  return _probe_result(PROBE_NONE,[])
 urls=_candidate_urls(marker)
 if not urls:
  return _probe_result(PROBE_NO_URL,[],marker)
 tried=[];worst=PROBE_OK
 for base in urls:
  st,detail=_probe_one(base,timeout)
  tried.append({'url':base,'state':st,'detail':detail})
  if st==PROBE_OK:
   worst=PROBE_OK
   break
  if _PROBE_RANK.index(st)>_PROBE_RANK.index(worst) or worst==PROBE_OK:
   worst=st
 return _probe_result(worst,tried,marker)


def _probe_result(state,tried,marker=None):
 label,note,take=_PROBE_TEXT.get(state,_PROBE_TEXT[PROBE_ERROR])
 if state==PROBE_NONE and '%d' in note:
  note=note % max(10,ttl_sec()//3)
 m=marker if isinstance(marker,dict) else (_state.get('marker') or {})
 beat=m.get('beat')
 return {'state':state,'label':label,'note':note,'canTake':bool(take),
         'ownerPc':m.get('pc') or '','ownerLogin':m.get('login') or '',
         'aliveSec':(round(_now()-float(beat),1) if beat else None),
         'ttlSec':ttl_sec(),'tried':tried}


def take_over(login='',pc=''):
 """書込役を引き取る（§9.301 ①）。**応答しないときだけ**。

 生きている相手から奪う意味は無い（相手はまだ書けるので、二重に書ける状態を
 わざわざ作ることになる）。`probe_owner()`が「引き取れる」と言ったときだけ
 進み、**誰から引き取ったかを目印に残す**（§9.211 ②の`taken_from`と同じ作法
 ——理由の分からない入れ替わりを作らない）。
 """
 p=probe_owner()
 if not p.get('canTake'):
  return False,p
 prev=dict(_state.get('marker') or {})
 with _lock:
  _state['relay_down_until']=0.0;_state['relay_down_why']=''
 ok=claim(force=True)
 if ok:
  data=dict(_state.get('marker') or {})
  data['taken_from']={'pc':prev.get('pc') or '','login':prev.get('login') or '',
                      'state':p.get('state'),'by_login':login,'by_pc':pc,'at':_now()}
  _write_marker(data)
  with _lock:_state['marker']=data
  _wake.set()
  app_logger().info('書込役を引き取りました（%s → このPC / 理由: %s）',
                    prev.get('pc') or '不明',p.get('state'))
 return bool(ok),p


def should_relay():
 """書き込みを転送すべきか。**持ち主が生きているときだけ**。"""
 if not enabled() or not SCHEDULE_SHARE_PATH:return False
 if _state['owner']:return False
 # **届かなかった書込役をしばらく信じない**（§9.301 ①）。目印は期限まで
 # 「生きている」ままなので、これが無いとその間ずっと、書き込みのたびに
 # 届かない相手を待つことになる。期限が切れれば`claim()`が引き継ぐので、
 # 待たない時間は短くてよい。
 if _now()<_state.get('relay_down_until',0.0):return False
 m=_state['marker']
 return isinstance(m,dict) and bool(m.get('token')) and _alive(m)


def relayed_identity(headers):
 """中継されてきたリクエストか。そうなら (login, pc) を返す。

 **合言葉を確かめてから**信じること——ヘッダは誰でも付けられる。"""
 if not headers:return None
 if headers.get(HDR_TOKEN)!=_state['token']:return None
 return (str(headers.get(HDR_LOGIN) or ''),str(headers.get(HDR_PC) or ''))


def relayed_mode(headers):
 """中継されてきたリクエストなら、**頼んだ端末の**モード。そうでなければ None。"""
 if relayed_identity(headers) is None:return None
 m=str((headers.get(HDR_MODE) if headers else '') or '').strip()
 return m or None


# ------------------------------------------------------------------
# 見張り（持ち主で居続ける／持ち主が消えたら名乗り出る）
# ------------------------------------------------------------------
_wake=threading.Event()


def _loop():
 _wake.wait(2)
 while True:
  wait=max(10,ttl_sec()//3)
  try:
   if enabled() and SCHEDULE_SHARE_PATH:
    was=_state['owner']
    claim()
    # ポートを変えたら掴み直す（設定を直したのに古いポートのまま、を作らない）
    if _state['server'] and _state['bound_port']!=relay_port():_stop_server()
    if _state['owner'] and not _state['server']:_start_server()
    if not _state['owner'] and was:_stop_server()
   else:
    # 切ってあるときも見張りは回り続ける（入れ切りを再起動なしで効かせる。
    # 1分ごとに設定だけ見る＝共有には一切触らない）。
    if _state['server']:_stop_server()
    if _state['owner']:
     with _lock:_state['owner']=False
    wait=60
  except Exception as e:
   app_logger().warning('持ち主の見張りで例外: %s',e)
  _wake.clear()
  _wake.wait(wait)


def start():
 if _state['running']:return
 with _lock:_state['running']=True
 threading.Thread(target=_loop,name='schedule-owner-watch',daemon=True).start()


def wake():
 _wake.set()
