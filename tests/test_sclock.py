"""ロック(固定開始)と「現在時刻に追随して流れる」の検証。
時間の経過を扱うのでブラウザではなくexpand_plan()を直接呼ぶ。"""
import os,sys
sys.path.insert(0,os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime,timedelta
from backend import schedule_calc, schedule_sync
from backend.db_access import connect as _c
import backend.repositories.schedule_repo as sr

R=[]
def rec(n,ok,d=''):
    R.append(ok);print(('PASS' if ok else 'FAIL')+': '+n+((' -- '+str(d)) if d else ''))

local,_=schedule_sync.fetch_snapshot()
c=_c(local,False,'sqlite')
t0=datetime.now()
base=schedule_calc.expand_plan(c,'テスト設備A',now=t0)
planned=[e for e in base['entries'] if e['state']=='予定' and e.get('plannedStart')]
target=planned[2]
sr.plan_update(c,target['id'],'test',fixedStart=target['plannedStart']);c.commit()
try:
    snaps={}
    for h in (0,2,6):
        r=schedule_calc.expand_plan(c,'テスト設備A',now=t0+timedelta(hours=h))
        snaps[h]={e['id']:e for e in r['entries']}
    lk=[snaps[h][target['id']] for h in (0,2,6)]
    rec('ロックした予定は時間が経っても同じ日時に留まる',
        lk[0]['plannedStart']==lk[1]['plannedStart']==lk[2]['plannedStart'],
        ' / '.join(str(x['plannedStart'])[11:16] for x in lk))
    rec('ロック行は前工程が押した分をoverdueで知らせる',
        lk[0]['overdueMinutes']==0 and lk[2]['overdueMinutes']>lk[1]['overdueMinutes']>0,
        [x['overdueMinutes'] for x in lk])
    rec('ロック行は並べ替え対象から外れない(状態は予定のまま)',lk[0]['state']=='予定')

    def free_first(h):
        rows=[e for e in snaps[h].values() if e['state']=='予定' and not e.get('fixedStart') and e.get('plannedStart')]
        rows.sort(key=lambda e:e['plannedStart'])
        return rows[0]
    f=[free_first(h) for h in (0,2,6)]
    rec('ロックしていない予定は現在時刻に追随して後ろへずれる',
        f[0]['plannedStart']<f[1]['plannedStart']<f[2]['plannedStart'],
        ' / '.join(str(x['plannedStart'])[11:16] for x in f))
    shift=(datetime.fromisoformat(f[1]['plannedStart'])-datetime.fromisoformat(f[0]['plannedStart'])).total_seconds()/3600
    rec('ずれ幅が経過時間とほぼ一致する(2時間経過→約2時間)',1.9<=shift<=2.1,'%.2f時間'%shift)

    # 作業中の予定終了 = 現在時刻、直後の予定開始と一致
    for h in (0,2):
        m=snaps[h]
        ong=[e for e in m.values() if e.get('ongoing')]
        if not ong:continue
        o=ong[0]
        # ロック(固定開始)した行は現在時刻に追随せずその日時に留まるので、
        # 作業中の直後に来るのは「ロックしていない予定」のうち最も早いもの。
        # 除かないと、このテスト自身がロックした行を掴んで落ちる。
        nxt=sorted([e for e in m.values() if e['state']=='予定'
                    and e.get('plannedStart') and not e.get('fixedStart')],
                   key=lambda e:e['plannedStart'])
        exp=(t0+timedelta(hours=h)).isoformat()
        rec('now+%dh: 作業中の予定終了が現在時刻'%h,o['plannedEnd']==exp,o['plannedEnd'])
        rec('now+%dh: 直後の予定開始が作業中の終了と一致'%h,
            bool(nxt) and nxt[0]['plannedStart']==o['plannedEnd'],
            '%s / %s'%(o['plannedEnd'],nxt[0]['plannedStart'] if nxt else '-'))
finally:
    sr.plan_update(c,target['id'],'test',fixedStart='');c.commit();c.close()

print('\n=== SUMMARY ===')
print('%d/%d passed'%(sum(R),len(R)))
sys.exit(0 if all(R) else 1)
