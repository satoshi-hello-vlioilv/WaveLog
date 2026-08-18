#!/usr/bin/env python3
"""test_scwatch.py: 共有スケジュールの見張り(§9.188)

以前は**GETのたびに**共有ファイル全体のbackup()が走っていた。共有(Box等)
越しでは1回が数百msかかり、そのあいだ共有を掴むので他の端末の書込と
ぶつかる。改訂番号だけを見て、変わったときだけ写すようにした。

ここで固定するのは、崩れると**古い予定を見せ続ける**か**共有を掴み続ける**
ことになる次の点。
 1. 間隔の内側なら共有へ触らない(＝写しをそのまま使う)
 2. **共有ファイルの見かけが変わったら、間隔の内側でも写し直す**
    ——アプリの外から差し替えられることがある(検証用の種入れ・別ツール)。
    ここを時間だけで判断すると、テストの種入れが効かず、実機では
    「他のPCの変更が最大15秒来ない」ことになる
 3. 写した直後は休む(利用者の指示。更新が続くときに写し続けない)
 4. 見張らない設定では従来どおり毎回写す
 5. 共有が読めないときは**写しを使い続ける**(fail-open。画面を止めない)
"""
import sys,tempfile,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from backend import schedule_sync as ss
from backend.db_access import connect

R=[]
def rec(name,ok,detail=''):
 R.append((name,ok,detail))
 print(('PASS: ' if ok else 'FAIL: ')+name+((' -- '+str(detail)) if detail else ''))

def main():
 tmp=Path(tempfile.mkdtemp())
 share=tmp/'schedule.sqlite3';cache=tmp/'work'/'schedule.sqlite3'
 cache.parent.mkdir(parents=True,exist_ok=True)
 # 共有を1つ作る(改訂番号0)
 c=connect(share,False,'sqlite');ss.ensure_meta_table(c);c.close()
 ss.SCHEDULE_SHARE_PATH=share
 ss.SCHEDULE_CACHE_PATH=cache
 conf={'schedule_watch_enabled':'auto','schedule_watch_interval_sec':'60',
       'schedule_watch_pause_sec':'30'}
 ss.path_config_value=lambda k,d=None:conf.get(k,d)
 # 数えるために本物のコピーを包む
 calls={'n':0}
 real_connect=ss.connect
 def counting(path,ro=False,kind='sqlite'):
  if Path(path)==share:calls['n']+=1
  return real_connect(path,ro,kind)
 ss.connect=counting
 try:
  ss._watch.update({'verified_at':0.0,'signature':None,'snapshot_at':0.0,'revision':None,
                    'paused_until':0.0,'last_error':''})
  p,stale=ss.fetch_snapshot()
  rec('1回目は共有から写す',p==cache and not stale and calls['n']>0,f'共有を開いた回数={calls["n"]}')

  before=calls['n']
  for _ in range(5):ss.fetch_snapshot()
  rec('間隔の内側では共有へ触らない',calls['n']==before,f'{before}→{calls["n"]}')

  # 2) 外から共有を差し替えたら写し直す
  time.sleep(0.01)
  c=real_connect(share,False,'sqlite');ss.bump_revision(c,'other');c.close()
  before=calls['n']
  ss.fetch_snapshot()
  rec('共有が差し替わったら間隔の内側でも写し直す',calls['n']>before,f'{before}→{calls["n"]}')
  rec('写し直した内容が新しい',ss.local_revision()==1,ss.local_revision())

  # 3) 写した直後は休む
  st=ss.watch_status()
  rec('写した直後は休みに入る',(st['pausedForSec'] or 0)>0,st['pausedForSec'])
  rec('休み中の見張りは何もしない',ss.watch_check()=='paused')

  # 4) 見張らない設定では毎回写す
  conf['schedule_watch_enabled']='off'
  before=calls['n']
  ss.fetch_snapshot();ss.fetch_snapshot()
  rec('見張らない設定では毎回写す',calls['n']>=before+2,f'{before}→{calls["n"]}')
  conf['schedule_watch_enabled']='auto'

  # 5) 変化がなければ「same」で、写さない
  ss._watch['paused_until']=0
  before=calls['n']
  r=ss.watch_check()
  rec('変化がなければ写さない',r=='same' and calls['n']==before+1,f'{r} / {before}→{calls["n"]}')

  # 5b) **改訂番号を上げずに中身が差し替わっても気づく**
  #     (検証用の種入れ・別のツールがこの形。ここを見落とすと、以後の読みは
  #      古い写しを最新だと思い込む)
  ss._watch['paused_until']=0
  time.sleep(0.01)
  c=real_connect(share,False,'sqlite')
  c.execute(f'UPDATE [{ss.META_TABLE}] SET [最終更新者ID]=?',['外から'])
  c.commit();c.close()
  before=calls['n']
  r=ss.watch_check()
  rec('改訂番号が同じでも見かけが変われば取り込む',r=='fetched',f'{r} / {before}→{calls["n"]}')

  # 6) 共有が読めなくても写しは使える
  ss.SCHEDULE_SHARE_PATH=tmp/'nope'/'schedule.sqlite3'
  ss._watch['paused_until']=0
  rec('共有が読めないときは分からないと答える',ss.watch_check()=='unknown')
  ss.SCHEDULE_SHARE_PATH=share

  # 7) 間隔・休みはマスタで変えられる(再起動不要)
  conf['schedule_watch_interval_sec']='7';conf['schedule_watch_pause_sec']='0'
  rec('間隔と休みはマスタの値を読み直す',
      ss.watch_interval_sec()==7 and ss.watch_pause_sec()==0)
  conf['schedule_watch_interval_sec']='1'
  rec('短すぎる間隔は下限へ丸める',ss.watch_interval_sec()==5)
 finally:
  ss.connect=real_connect
 ng=[n for n,ok,_ in R if not ok]
 print(f'\n=== SUMMARY ===\n{len(R)-len(ng)}/{len(R)} passed')
 return 1 if ng else 0

if __name__=='__main__':sys.exit(main())
