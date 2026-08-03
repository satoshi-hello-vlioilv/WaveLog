"""schedule_calc.py: スケジュールの時刻展開・実績突合(docs/SCHEDULE_MODE_DESIGN.md §6.6・§7)。

Flask非依存。backend/repositories/schedule_repo.pyが持つ生データ(表示順・
種別・見積分・状態等)を受け取り、稼働カレンダーマスタから実時刻(予定開始/
予定終了)を計算し、測定データバックアップとの実績突合で状態を動的に導出
する。結果はDBへ書き戻さない(§7.4、単一書き込み者モデルを崩さないため)。

見積分の解決(§6・§7.6):
  - [見積分]が明示的に設定されていればそれをそのまま使う(source='override')
  - 種別='設備停止'でNULLなら、設備停止マスタの現在の標準所要分を
    (設備名,予定名称)で引き直す(source='stop-reason-master'、§5.1の
    「スナップショットしない」方針どおり、マスタの現在値を都度反映する)
  - 種別='作業'でNULLなら、換算係数モデル(load_factor.py、§6)による
    対数線形推定を使う(source='model')。実績が無くモデル自体が
    算出できない場合のみDEFAULT_ESTIMATE_MINUTES(source='default')
"""
import json
from datetime import date, datetime, time, timedelta

from . import load_factor
from . import schedule_sync
from .repositories import schedule_repo as sr
from .repositories.master_repo import normalize_equipment_name
from .db_access import merged_backup_rows, connect as _sqlite_connect

MIN_REMAIN_MINUTES=5
MAX_HORIZON_DAYS=60
DEFAULT_ESTIMATE_MINUTES=120.0
PLAN_TERMINAL_STATES=('完了','取消')

# ========================================================================
# 稼働カレンダー: 優先順位の解決(§5.2)
# ========================================================================
def _parse_hm(s):
 h,m=str(s or '00:00').split(':');return int(h),int(m)

def _to_dt(d,hm):
 h,m=_parse_hm(hm)
 if h>=24:return datetime.combine(d+timedelta(days=1),time(h-24,m))
 return datetime.combine(d,time(h,m))

def _rows_by_kind(rows):
 # rows: schedule_repo.calendar_rows()のタプル列
 # (カレンダーID,設備名,区分,曜日,日付,稼働,開始時刻,終了時刻,表示順,有効)
 weekday=[r for r in rows if r[2]=='曜日']
 dated=[r for r in rows if r[2]=='特異日']
 return weekday,dated

def working_slots_for_date(specific_rows,global_rows,d):
 """§5.2の優先順位(特異日>設備別の曜日>全設備既定の曜日)で、日付dの
 稼働帯を[(開始HH:MM,終了HH:MM),...]で返す。稼働カレンダーが設備・全体
 とも1件も無ければ24時間稼働とみなす([('00:00','24:00')])。設定はある
 がその日に該当する行が無ければ空リスト(休業)。"""
 if not specific_rows and not global_rows:
  return [('00:00','24:00')]
 date_str=d.isoformat()
 db_weekday=(d.weekday()+1)%7  # Python: 月=0..日=6 -> DB: 日=0..土=6
 spec_w,spec_d=_rows_by_kind(specific_rows)
 glob_w,glob_d=_rows_by_kind(global_rows)
 hit=[r for r in spec_d if r[4]==date_str] or [r for r in glob_d if r[4]==date_str]
 if hit:return [(r[6],r[7]) for r in hit if (True if r[5] is None else bool(r[5]))]
 hit=[r for r in spec_w if r[3]==db_weekday] or [r for r in glob_w if r[3]==db_weekday]
 if hit:return [(r[6],r[7]) for r in hit if (True if r[5] is None else bool(r[5]))]
 return []

def slots_for_date_abs(specific_rows,global_rows,d):
 out=[]
 for start_s,end_s in working_slots_for_date(specific_rows,global_rows,d):
  start_dt=_to_dt(d,start_s);end_dt=_to_dt(d,end_s)
  if end_dt<=start_dt:end_dt+=timedelta(days=1)  # 開始>終了は翌日跨ぎ
  out.append((start_dt,end_dt))
 return out

def build_slot_timeline(specific_rows,global_rows,from_date,horizon_days=MAX_HORIZON_DAYS):
 """from_dateの前日からfrom_date+horizon_days+1日までの稼働帯を集めて時系列
 ソート・隣接マージした(開始,終了)の絶対時刻リストにする(§7.3の展開が
 この上をカーソルで前進する)。前日分も含めるのは、夜間跨ぎの稼働帯が
 from_dateへ食い込むケースに対応するため。"""
 out=[]
 d=from_date-timedelta(days=1)
 end_d=from_date+timedelta(days=horizon_days+1)
 while d<=end_d:
  out.extend(slots_for_date_abs(specific_rows,global_rows,d))
  d+=timedelta(days=1)
 out.sort()
 merged=[]
 for s,e in out:
  if merged and s<=merged[-1][1]:
   merged[-1]=(merged[-1][0],max(merged[-1][1],e))
  else:
   merged.append((s,e))
 return merged

def snap_to_working(cursor,slots):
 """cursorが稼働帯の中ならそのまま、非稼働ならその時点以降で最も早い稼働
 開始時刻へ繰り上げる。戻り値: (新cursor or None(打ち切り), 待ちが発生したか)。"""
 for s,e in slots:
  if s<=cursor<e:return cursor,False
  if s>cursor:return s,True
 return None,True

def consume_minutes(cursor,minutes,slots):
 """cursorからminutes分の稼働時間を消費して進める(§7.3のwhileループに相当)。
 戻り値: (終了cursor or None(打ち切り), 非稼働帯を跨いだか, 打ち切られたか)。"""
 spans=False
 remaining=max(0.0,float(minutes or 0))
 cur=cursor
 while True:
  cur2,waited=snap_to_working(cur,slots)
  if cur2 is None:return None,True,True
  if waited:spans=True
  cur=cur2
  slot=next(((s,e) for s,e in slots if s<=cur<e),None)
  if slot is None:return None,spans,True
  s,e=slot
  avail=(e-cur).total_seconds()/60.0
  if remaining<=avail+1e-9:
   return cur+timedelta(minutes=remaining),spans,False
  cur=e;remaining-=avail;spans=True

# ========================================================================
# 実績突合(§7.4)
# ========================================================================
def normalize_match_key(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def build_actual_index(backup_rows=None):
 """(ロット番号,鋳造番号,製造材質)の正規化キー -> 最新実績dict、の索引を作る。
 §7.4のとおり3項目のいずれかが欠けている行は突合対象にしない。"""
 index={}
 for row in (backup_rows if backup_rows is not None else merged_backup_rows()):
  try:
   payload=json.loads(row.get('payload') or '{}')
  except Exception:
   continue
  basic=payload.get('basic') or {}
  lot=str(basic.get('lotNo') or '').strip()
  casting=str(basic.get('castingNo') or '').strip()
  material=str(basic.get('mfgMaterial') or '').strip()
  if not (lot and casting and material):continue
  key=(normalize_match_key(lot),normalize_match_key(casting),normalize_match_key(material))
  updated_at=row.get('updated_at') or ''
  existing=index.get(key)
  if existing is not None and existing['updatedAt']>=updated_at:continue
  work_time=payload.get('workTime') or {}
  index[key]={'id':row.get('id',''),'startAt':work_time.get('startAt') or None,
              'endAt':work_time.get('endAt') or None,'updatedAt':updated_at}
 return index

def match_actual(index,lot_no,casting_no,mfg_material):
 lot=str(lot_no or '').strip();casting=str(casting_no or '').strip();material=str(mfg_material or '').strip()
 if not (lot and casting and material):return None
 return index.get((normalize_match_key(lot),normalize_match_key(casting),normalize_match_key(material)))

def derive_state(stored_state,actual):
 """§7.4。計画者が明示的に確定した完了/取消は実績突合より優先する。"""
 if stored_state in PLAN_TERMINAL_STATES:return stored_state
 if actual is None:return stored_state or sr.PLAN_REORDERABLE_STATE
 if actual.get('endAt'):return '完了'
 if actual.get('startAt'):return '着手'
 return stored_state or sr.PLAN_REORDERABLE_STATE

# ========================================================================
# 見積分の解決(§6.1、一律見積(係数1.0)段階)
# ========================================================================
_EMPTY_ESTIMATE_EXTRAS={'low':None,'high':None,'sigmaLog':None,'base':None,'factors':[]}

def resolve_estimate(c,equipment,plan_row_dict):
 """plan_row_dict: {'kind','title','estimateMinutes','detail'}を持つdict
 (expand_plan()内のentry辞書と同じキー)。戻り値: §6.8のentries[].estimate
 相当のdict(minutes/source/low/high/sigmaLog/base/factors)。"""
 if plan_row_dict.get('estimateMinutes') is not None:
  return {'minutes':float(plan_row_dict['estimateMinutes']),'source':'override',**_EMPTY_ESTIMATE_EXTRAS}
 if plan_row_dict.get('kind')=='設備停止':
  minutes=sr.stop_reason_standard_minutes(c,equipment,plan_row_dict.get('title') or '')
  if minutes is not None:
   return {'minutes':float(minutes),'source':'stop-reason-master',**_EMPTY_ESTIMATE_EXTRAS}
  return {'minutes':DEFAULT_ESTIMATE_MINUTES,'source':'default',**_EMPTY_ESTIMATE_EXTRAS}
 # 種別='作業': 換算係数モデル(§6)による見積。basisがequipment/pooledなら
 # 実績由来のsource='model'、モデル自体が無ければsource='default'。
 result=load_factor.estimate_work(c,equipment,plan_row_dict.get('detail') or {})
 source='model' if result.get('basis') in ('equipment','pooled') else 'default'
 return {'minutes':result['minutes'],'source':source,'low':result.get('low'),'high':result.get('high'),
         'sigmaLog':result.get('sigmaLog'),'base':result.get('base'),'factors':result.get('factors') or []}

# ========================================================================
# 展開の本体(§7.2・§7.3)
# ========================================================================
def _minutes_between(a,b):
 return (b-a).total_seconds()/60.0

def expand_plan(c,equipment,now=None):
 """GET /api/schedule/planの本体。生のplan_rows・稼働カレンダー・実績突合を
 合成し、§8.1のentries形状(id/order/kind/estimate/plannedStart/plannedEnd/
 startsInMinutes/actual/reorderable等)を返す。DBへは一切書き戻さない。"""
 now=now or datetime.now()
 raw_rows=sr.plan_rows(c,equipment)
 specific_cal=sr.calendar_rows(c,equipment)
 global_cal=sr.calendar_rows(c,'')
 actual_index=build_actual_index()
 warnings=[]

 entries=[]
 for r in raw_rows:
  detail={}
  if r[8]:
   try:detail=json.loads(r[8])
   except Exception:detail={}
  entry={'id':r[0],'order':r[2],'kind':r[3],'lotNo':r[4],'inspectionNo':r[5],'castingNo':r[6],
         'title':r[7],'detail':detail,'fixedStart':r[9],'estimateMinutes':r[10],
         'storedState':r[11],'actualRecordId':r[12],'remark':r[13]}
  actual=match_actual(actual_index,detail.get('lotNo') or r[4],detail.get('castingNo') or r[6],detail.get('mfgMaterial')) if entry['kind']=='作業' else None
  entry['state']=derive_state(entry['storedState'],actual)
  entry['actual']=actual
  entries.append(entry)

 # アンカー決定(§7.2): 展開対象(完了/取消を除く)の先頭を見る
 active=[e for e in entries if e['state'] not in PLAN_TERMINAL_STATES]
 timeline=build_slot_timeline(specific_cal,global_cal,now.date())
 first_remaining_override=None
 if active and active[0]['state']=='着手' and active[0]['actual'] and active[0]['actual'].get('startAt'):
  try:
   anchor=datetime.fromisoformat(active[0]['actual']['startAt'])
  except Exception:
   anchor=now
  est0=resolve_estimate(c,equipment,active[0])
  elapsed=max(0.0,_minutes_between(anchor,now))
  first_remaining_override=max(est0['minutes']-elapsed,MIN_REMAIN_MINUTES)
 else:
  anchor,_waited=snap_to_working(now,timeline)
  if anchor is None:
   anchor=now
   warnings.append('稼働カレンダー上、直近の稼働開始時刻を特定できませんでした。')

 cursor=anchor
 truncated=False
 for idx,e in enumerate(entries):
  if e['state'] in PLAN_TERMINAL_STATES:
   e['plannedStart']=None;e['plannedEnd']=None;e['startsInMinutes']=None
   e['estimate']=None;e['reorderable']=False;e['spansNonWorking']=False;e['overdueMinutes']=0
   continue
  est=resolve_estimate(c,equipment,e)
  minutes=est['minutes']
  if e is active[0] and first_remaining_override is not None:
   minutes=first_remaining_override
   est=dict(est,minutes=minutes,source='remaining')
  fixed_start=None
  if e.get('fixedStart'):
   try:fixed_start=datetime.fromisoformat(e['fixedStart'])
   except Exception:fixed_start=None
  waited_minutes=0.0
  if fixed_start and fixed_start>cursor:
   waited_minutes=_minutes_between(cursor,fixed_start)
   cursor=fixed_start
  overdue=0.0
  if fixed_start and fixed_start<cursor:
   overdue=_minutes_between(fixed_start,cursor)
  cursor,_waited=snap_to_working(cursor,timeline)
  if cursor is None:
   truncated=True
  if truncated:
   e['plannedStart']=None;e['plannedEnd']=None;e['startsInMinutes']=None
   e['estimate']=dict(est,minutes=minutes)
   e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
   e['spansNonWorking']=False;e['overdueMinutes']=0
   warnings.append(f"予定ID {e['id']} は稼働カレンダー上、{MAX_HORIZON_DAYS}日以内に収まりません。")
   continue
  planned_start=cursor
  end_cursor,spans,trunc=consume_minutes(cursor,minutes,timeline)
  if end_cursor is None:
   truncated=True
   e['plannedStart']=planned_start.isoformat();e['plannedEnd']=None;e['startsInMinutes']=round(_minutes_between(now,planned_start),1)
   e['estimate']=dict(est,minutes=minutes)
   e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
   e['spansNonWorking']=spans;e['overdueMinutes']=round(overdue,1)
   warnings.append(f"予定ID {e['id']} は稼働カレンダー上、{MAX_HORIZON_DAYS}日以内に収まりません。")
   continue
  cursor=end_cursor
  e['plannedStart']=planned_start.isoformat();e['plannedEnd']=cursor.isoformat()
  e['startsInMinutes']=round(_minutes_between(now,planned_start),1)
  e['estimate']=dict(est,minutes=round(minutes,1))
  e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
  e['spansNonWorking']=bool(spans)
  e['overdueMinutes']=round(overdue,1)

 for e in entries:
  actual=e.pop('actual')
  e.pop('storedState')
  if e['state']=='着手' and actual and actual.get('startAt'):
   try:
    started=datetime.fromisoformat(actual['startAt'])
    e['actual']={'startAt':actual['startAt'],'endAt':None,'elapsedMinutes':round(max(0.0,_minutes_between(started,now)),1)}
   except Exception:
    e['actual']={'startAt':actual.get('startAt'),'endAt':None,'elapsedMinutes':None}
  elif e['state']=='完了' and actual and actual.get('startAt') and actual.get('endAt'):
   try:
    started=datetime.fromisoformat(actual['startAt']);ended=datetime.fromisoformat(actual['endAt'])
    actual_minutes=max(0.0,_minutes_between(started,ended))
    est=(e.get('estimate') or {}).get('minutes')
    variance=round(actual_minutes-est,1) if est is not None else None
    e['actual']={'startAt':actual['startAt'],'endAt':actual['endAt'],'minutes':round(actual_minutes,1),'varianceMinutes':variance}
   except Exception:
    e['actual']=None
  else:
   e['actual']=None
  e['actualRecordId']=(actual or {}).get('id') or e.get('actualRecordId')

 lf_model=load_factor.get_model(equipment)
 load_factor_info=None
 if lf_model is not None:
  load_factor_info={'basis':lf_model.get('basis'),'n':lf_model.get('n'),
                     'sigmaLog':round(lf_model.get('sigmaLog') or 0.0,3),
                     'calculatedAt':lf_model.get('calculatedAt')}
 return {'entries':entries,'warnings':warnings,'anchor':anchor.isoformat() if anchor else None,
         'loadFactor':load_factor_info}

# ========================================================================
# 設備削除時の参照件数(§5.0.1)
# ========================================================================
def equipment_reference_counts(equipment):
 """設備マスタの削除確認(§5.0.1)が使う、指定設備に紐づくスケジュール側
 データの参照件数。共有DBの読み取り専用スナップショットを使う(ロック不要、
 §4.2の「取得」のみ)。schedule_share_path未設定ならそもそもスケジュール
 機能を使っていないため全件0を返す。共有ファイルの取得自体に失敗した
 場合はNoneを返す(呼び出し側は「確認できませんでした」の警告付きで
 削除をブロックしない、§5.0.1の方針どおり)。pendingPlans/inProgressPlans/
 completedPlansは実績突合込みの導出状態(expand_plan()、§7.4と同じ)で
 数える(「状態が実質的に」の要件どおり、DBの生の[状態]列では数えない)。"""
 try:
  local_path,_stale=schedule_sync.fetch_snapshot()
 except schedule_sync.ScheduleNotConfigured:
  return {'pendingPlans':0,'inProgressPlans':0,'completedPlans':0,
          'calendarRows':0,'stopReasonRows':0,'loadFactorOverrideRows':0}
 except schedule_sync.ScheduleUnavailableError:
  return None
 c=_sqlite_connect(local_path,False,'sqlite')
 try:
  expanded=expand_plan(c,equipment)
  pending=sum(1 for e in expanded['entries'] if e['state']==sr.PLAN_REORDERABLE_STATE)
  in_progress=sum(1 for e in expanded['entries'] if e['state']=='着手')
  completed=sum(1 for e in expanded['entries'] if e['state']=='完了')
  calendar_rows=len(sr.calendar_rows(c,equipment))
  stop_reason_rows=len(sr.stop_reason_rows(c,equipment))
  target=normalize_equipment_name(equipment)
  override_rows=sum(1 for r in sr.load_factor_override_rows(c) if normalize_equipment_name(r[1])==target)
 finally:
  c.close()
 return {'pendingPlans':pending,'inProgressPlans':in_progress,'completedPlans':completed,
         'calendarRows':calendar_rows,'stopReasonRows':stop_reason_rows,'loadFactorOverrideRows':override_rows}
