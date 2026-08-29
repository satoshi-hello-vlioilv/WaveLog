"""書込まわりの固定費が減っていることの検証。
サンドボックスはローカルSSDなので、ここで測っているのは
「アプリが意図的に入れている待ち時間」そのもの。"""
import sys,json,time,urllib.request
R=[]
def rec(n,ok,d=''):
    R.append(ok);print(('PASS' if ok else 'FAIL')+': '+n+((' -- '+str(d)) if d else ''))
def post(path,body):
    t=time.perf_counter()
    r=urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:5029'+path,
      data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}))
    return (time.perf_counter()-t)*1000,json.loads(r.read())

post('/api/access-mode',{'mode':'schedule'})
eq='テスト設備A'
# 解放してから、新規取得と延長を比べる
try:post('/api/schedule/session/release',{'equipment':eq})
except Exception:pass
first,_=post('/api/schedule/session/acquire',{'equipment':eq})
second,_=post('/api/schedule/session/acquire',{'equipment':eq})
third,_=post('/api/schedule/session/heartbeat',{'equipment':eq})
rec('新規のセッション取得では検証待ちを維持する(>=250ms)',first>=250,'%.0fms'%first)
rec('自分のセッション延長では待たない(<100ms)',second<100 and third<100,'2回目=%.0fms 3回目=%.0fms'%(second,third))

# まとめ書込: 12件を1リクエストで
ops=[{'op':'add','equipment':eq,'kind':'作業','position':'end','lotNo':'B%04d'%i,
      'castingNo':'Z%03d'%i,'detail':{'ロット番号':'B%04d'%i,'lotNo':'B%04d'%i,
      'castingNo':'Z%03d'%i,'mfgMaterial':'A5052'}} for i in range(1,13)]
batch_ms,r=post('/api/schedule/plan/batch',{'user_id':'test','ops':ops})
ok=r.get('ok') and len(r.get('results',[]))==12 and all(x.get('ok') for x in r['results'])
rec('12件のまとめ書込が全件成功する',ok,'%.0fms'%batch_ms)
rec('まとめ書込の所要が1件ぶんの固定費に収まる(<3秒)',batch_ms<3000,'%.0fms'%batch_ms)
# 個別に12件やった場合との比較
single_total=0
for i in range(13,16):
    ms,_=post('/api/schedule/plan/add',{'equipment':eq,'kind':'作業','position':'end',
      'lotNo':'S%04d'%i,'castingNo':'Y%03d'%i,'user_id':'test','detail':{'lotNo':'S%04d'%i}})
    single_total+=ms
per=single_total/3
# **物差しは「いま効いている確認待ち」**（§9.267の追補）。1000msの決め打ちは
# 「待ちは常に1.5秒」という前提に寄りかかっていたが、置き場の種類で変わる
# ようになった（クラウド同期1.5秒／ファイルサーバー0.3秒）。見たいのは
# 「排他制御を通っているか」であって秒数そのものではないので、**設定された
# 待ちを下回らないこと**で見る（通っていなければ待ちより速く終わる）。
import sys as _sys, pathlib as _pl
_sys.path.insert(0, str(_pl.Path(__file__).resolve().parent.parent))
from backend import schedule_sync as _ss                      # noqa: E402
_wait_ms = _ss._lock_verify_delay_sec() * 1000
rec('個別書込1件あたりの固定費は変わらない(排他制御は維持)',
    per > _wait_ms * 0.9,
    '1件 %.0fms (確認待ち %.0fms)' % (per, _wait_ms))
print('\n  参考: まとめ12件 %.0fms  /  個別なら 12x%.0fms = %.0fms'%(batch_ms,per,per*12))
# 後片付け
ids=[x['id'] for x in r['results'] if x.get('id')]
if ids:
    post('/api/schedule/plan/batch',{'user_id':'test','ops':[{'op':'delete','id':i} for i in ids]})
print('\n=== SUMMARY ===');print('%d/%d passed'%(sum(R),len(R)))
sys.exit(0 if all(R) else 1)
