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

def resolve_shift_label(specific_shift_rows,global_shift_rows,dt):
 """§5.5の勤務形態マスタ。dt(datetime)の時刻(時分のみ、日付は見ない)が
 該当する勤務名称を返す(該当が無ければNone)。優先順位は稼働カレンダー
 マスタと同じ(設備別行があればそちらを優先、無ければ全設備既定)。
 終了時刻<=開始時刻は日跨ぎ勤務として扱う(例: 23:00〜07:00の3直、
 t>=23:00またはt<07:00で該当)。"""
 if dt is None:return None
 rows=specific_shift_rows if specific_shift_rows else global_shift_rows
 if not rows:return None
 t=dt.time()
 for r in rows:
  # r: 勤務ID,設備名,名称,開始時刻,終了時刻,表示順,有効
  sh,sm=_parse_hm(r[3]);eh,em=_parse_hm(r[4])
  start_t=time(sh%24,sm);end_t=time(eh%24,em)
  if (eh*60+em)<=(sh*60+sm):
   if t>=start_t or t<end_t:return r[2]
  else:
   if start_t<=t<end_t:return r[2]
 return None

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
  # equipment/basicも持たせるのは§9.33(計画外実績の合成)のため。実績突合
  # (§7.4)自体はstartAt/endAtしか見ないので、既存の判定には影響しない。
  settings=payload.get('settings') or {}
  index[key]={'id':row.get('id',''),'startAt':work_time.get('startAt') or None,
              'endAt':work_time.get('endAt') or None,'updatedAt':updated_at,
              'equipment':str(settings.get('registeredEquipment') or payload.get('registeredEquipment')
                              or row.get('equipment') or '').strip(),
              'status':str(row.get('status') or payload.get('status') or '').strip(),
              'basic':basic,'key':key,
              # 「誰が・どの端末で入力を始めたか」(§9.180)。**レコード自身が
              # 持つ値を優先し、無ければバックアップの行**——別のPCで続きを
              # 開いた場合でも、始めた端末が残っているのはレコード側。
              'createdBy':str(payload.get('createdBy') or row.get('created_by') or '').strip(),
              'createdPc':str(payload.get('createdPc') or row.get('created_pc') or '').strip(),
              'updatedBy':str(row.get('updated_by') or '').strip(),
              'updatedPc':str(row.get('updated_pc') or '').strip(),
              'createdAt':str(payload.get('createdAt') or row.get('created_at') or '').strip()}
 return index

def match_actual(index,lot_no,casting_no,mfg_material):
 lot=str(lot_no or '').strip();casting=str(casting_no or '').strip();material=str(mfg_material or '').strip()
 if not (lot and casting and material):return None
 return index.get((normalize_match_key(lot),normalize_match_key(casting),normalize_match_key(material)))

# ========================================================================
# 計画外実績の合成(§9.33)
# ========================================================================
# 予定に載っていないのに実績が上がっているケース(仕掛一覧から直接測定を
# 開始した/予定を立てずに作業した)を、作業スケジュール上でも「実施中」
# 「実績」として見えるようにするための合成エントリ。
#
# 重要: 合成エントリはDBに存在しないため、並べ替え・削除・固定開始の対象に
# してはいけない(idは'actual:<記録ID>'で、共有DBのどの行にも一致しない)。
# 状態は必ず着手/完了のどちらかなので、既存の
# reorderable=(state=='予定') / 削除可否=(state=='予定') の判定に素直に乗り、
# 特別扱いを増やさずに読み取り専用へ倒れる。
UNPLANNED_ID_PREFIX='actual:'

def _unplanned_detail(basic):
 """合成エントリのdetail。「内容」欄(§9.28)と換算係数モデル(§6)が参照する
 alias名のキーだけを、測定データのbasicから拾って作る。"""
 keys=('lotNo','castingNo','inspectionNo','mfgMaterial','mfgTemper','purposeName',
       'customer','delivery','orderNo','equipment')
 detail={}
 for k in keys:
  v=basic.get(k)
  if v is not None and str(v).strip()!='':detail[k]=v
 return detail

def unplanned_entries(actual_index,equipment,matched_keys,now,history_hours=None):
 """予定行に紐づかない実績から合成エントリを作る。
 matched_keys: すでに予定行が突合に使ったキーの集合(二重に出さないため)。
 history_hours: 完了済みをさかのぼる時間。Noneなら完了分は作らない。"""
 target=normalize_equipment_name(equipment)
 cutoff=None
 if history_hours is not None:
  try:cutoff=now-timedelta(hours=float(history_hours))
  except Exception:cutoff=None
 running,done=[],[]
 for key,a in actual_index.items():
  if key in matched_keys:continue
  if not a.get('startAt'):continue
  if normalize_equipment_name(a.get('equipment') or '')!=target:continue
  basic=a.get('basic') or {}
  entry={'id':UNPLANNED_ID_PREFIX+str(a.get('id') or ''),'order':None,'kind':'作業',
         'lotNo':str(basic.get('lotNo') or ''),'inspectionNo':str(basic.get('inspectionNo') or ''),
         'castingNo':str(basic.get('castingNo') or ''),'title':'','detail':_unplanned_detail(basic),
         'fixedStart':None,'estimateMinutes':None,'storedState':None,
         'actualRecordId':a.get('id'),'remark':'','unplanned':True,'actual':a,
         # 計画外実績は予定の行が無い(§9.33)ので、入れた人も端末も無い。
         # **測定データ側の「入力を始めた人・端末」を持ってくる**(§9.180)——
         # 空欄にすると「誰も触っていない実績」に見える。
         'createdBy':str(a.get('createdBy') or ''),'createdPc':str(a.get('createdPc') or ''),
         'updatedBy':str(a.get('updatedBy') or ''),'updatedPc':str(a.get('updatedPc') or ''),
         'createdAt':a.get('createdAt') or '','updatedAt':a.get('updatedAt') or ''}
  # 終了時刻が無くても状態が完了なら「実施中」には出さない(§9.52)。
  # 終了時刻が無い完了は履歴の並び順に使う時刻が無いので、開始時刻で並べる。
  if record_finished(a):
   if cutoff is None:continue
   ended=_parse_dt(a.get('endAt') or '') or _parse_dt(a.get('startAt') or '')
   if ended is None or ended<cutoff:continue
   entry['state']='完了'
   done.append((ended,entry))
  else:
   entry['state']='着手'
   running.append((_parse_dt(a['startAt']) or now,entry))
 running.sort(key=lambda x:x[0])
 done.sort(key=lambda x:x[0])
 return [e for _,e in running],[e for _,e in done]

# 測定データ側で「もう終わっている」ことを示す状態(§9.52)。
# 完了登録は作業終了時刻の打刻を必須にしていない(未記録でも確認のうえ完了
# できる)。そのため終了時刻の有無だけで判定すると、データ一覧では「完了」
# なのに作業スケジュールでは「作業中」のまま、という食い違いが起きる。
# 実際に「開始時刻だけで終了時刻が無い作業途中データ」として報告された。
RECORD_FINISHED_STATUSES={'完了','測定値NG'}

def record_finished(actual):
 """この実績はもう終わっているか。終了時刻が無くても状態が完了なら終わり。"""
 if not actual:return False
 if actual.get('endAt'):return True
 return str(actual.get('status') or '').strip() in RECORD_FINISHED_STATUSES

def derive_state(stored_state,actual):
 """§7.4。計画者が明示的に確定した完了/取消は実績突合より優先する。"""
 if stored_state in PLAN_TERMINAL_STATES:return stored_state
 if actual is None:return stored_state or sr.PLAN_REORDERABLE_STATE
 if record_finished(actual):return '完了'
 if actual.get('startAt'):return '着手'
 return stored_state or sr.PLAN_REORDERABLE_STATE

# ========================================================================
# 見積分の解決(§6.1、一律見積(係数1.0)段階)
# ========================================================================
_EMPTY_ESTIMATE_EXTRAS={'low':None,'high':None,'sigmaLog':None,'base':None,'factors':[]}

def resolve_estimate(c,equipment,plan_row_dict):
 """c: 設定系マスタ(master.sqlite3)への接続。設備停止マスタの標準時間と
 換算係数上書きマスタしか読まないため、共有schedule.sqlite3ではなくこちらを渡す。
 plan_row_dict: {'kind','title','estimateMinutes','detail'}を持つdict
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
 # 見積の出どころは画面へそのまま出す(§9.114)。「実績から出したのか、
 # 設備の標準時間なのか、何も無いので暫定なのか」で読み手の受け取り方が
 # 変わるため、`default`とひとまとめにしないこと。
 basis=result.get('basis')
 source=('model' if basis in ('equipment','pooled')
         else 'equipment-standard' if basis=='equipment-standard' else 'default')
 return {'minutes':result['minutes'],'source':source,'low':result.get('low'),'high':result.get('high'),
         'sigmaLog':result.get('sigmaLog'),'base':result.get('base'),'factors':result.get('factors') or []}

# ========================================================================
# 展開の本体(§7.2・§7.3)
# ========================================================================
def _minutes_between(a,b):
 return (b-a).total_seconds()/60.0

def _parse_dt(value):
 """実績(workTime.startAt/endAt)・固定開始日時など、ブラウザ側が
 `Date.toISOString()`(UTC、'Z'終端)で送ってくるISO文字列を、このモジュール
 内で終始使っているnaiveなローカル時刻のdatetimeへ正規化する。tzinfo付き
 のままdatetime.now()由来のnaive値と比較・減算するとTypeErrorになるため、
 ここで一本化して吸収する(§7、CLAUDE.mdの「関数の定義は1箇所」)。
 パース不可ならNoneを返す(呼び出し側は既存どおりtry/exceptで拾う)。"""
 if not value:return None
 dt=datetime.fromisoformat(value)
 if dt.tzinfo is not None:dt=dt.astimezone().replace(tzinfo=None)
 return dt

DEFAULT_HISTORY_HOURS=8.0

def _iso(v):
 """DATETIME列をISO文字列へ。**読めない値で落ちないこと**——監査の表示のために
 一覧そのものが開けなくなるのは本末転倒(§9.180)。"""
 if not v:return ''
 try:return v.isoformat()
 except Exception:return str(v)

def expand_plan(c,equipment,now=None,history_hours=DEFAULT_HISTORY_HOURS,include_unplanned=True,actual_index=None):
 """GET /api/schedule/planの本体。生のplan_rows・稼働カレンダー・実績突合を
 合成し、§8.1のentries形状(id/order/kind/estimate/plannedStart/plannedEnd/
 startsInMinutes/actual/reorderable等)を返す。DBへは一切書き戻さない。
 history_hours: 計画外実績(§9.33)の完了分をさかのぼる時間。Noneで完了分なし。
 include_unplanned: 計画外実績の合成そのものを行うか。設備削除の参照件数
 (equipment_reference_counts)のように「共有DBに実在する行数」を数えたい
 呼び出しはFalseにする(合成分を数えると実在しない予定を数えてしまう)。
 actual_index: build_actual_index()の結果。設備ごとにこの関数を回す
 呼び出し(俯瞰ボード)は、**必ず1回だけ作って渡すこと**(§9.41)。
 渡さないと設備数ぶん実績バックアップを読み直し、共有越しではそのまま
 待ち時間になる。"""
 now=now or datetime.now()
 raw_rows=sr.plan_rows(c,equipment)
 # 設定系マスタ(稼働カレンダー・勤務形態・換算係数上書き)はmaster.sqlite3側。
 # 接続を1回だけ開いて、この展開処理の間ずっと使い回す(見積計算のために
 # 1予定ごとに開き直すと、行数分の接続オープンが発生してしまう)。
 sr.migrate_config_masters_from_shared()
 mc=sr.config_master_conn()
 try:
  return _expand_plan_with(c,mc,equipment,now,raw_rows,history_hours,include_unplanned,actual_index)
 finally:
  mc.close()

def _expand_plan_with(c,mc,equipment,now,raw_rows,history_hours=DEFAULT_HISTORY_HOURS,include_unplanned=True,actual_index=None):
 specific_cal=sr.calendar_rows(mc,equipment)
 global_cal=sr.calendar_rows(mc,'')
 specific_shift=sr.shift_rows(mc,equipment)
 global_shift=sr.shift_rows(mc,'')
 if actual_index is None:actual_index=build_actual_index()
 warnings=[]

 entries=[]
 matched_keys=set()
 for r in raw_rows:
  detail={}
  if r[8]:
   try:detail=json.loads(r[8])
   except Exception:detail={}
  entry={'id':r[0],'order':r[2],'kind':r[3],'lotNo':r[4],'inspectionNo':r[5],'castingNo':r[6],
         'title':r[7],'detail':detail,'fixedStart':r[9],'estimateMinutes':r[10],
         'storedState':r[11],'actualRecordId':r[12],'remark':r[13],
         # 分割ありの親ロットにぶら下がる子ロット(§9.83)。時間を持たない
         # 明細行なので、下の時刻展開ループでは飛ばす。
         'parentId':r[18],
         # 「誰が・どの端末で予定へ入れたか」(§9.180)。登録側は入れた人と
         # 端末で、更新側は最後に動かした人と端末。**混ぜないこと**——
         # 並べ替えただけの人が「入れた人」に見えると責任の所在が変わる。
         'createdBy':str(r[19] or ''),'createdPc':str(r[20] or ''),
         'updatedBy':str(r[17] or ''),'updatedPc':str(r[21] or ''),
         'createdAt':_iso(r[15]),'updatedAt':_iso(r[16])}
  actual=match_actual(actual_index,detail.get('lotNo') or r[4],detail.get('castingNo') or r[6],detail.get('mfgMaterial')) if entry['kind']=='作業' else None
  entry['state']=derive_state(entry['storedState'],actual)
  entry['actual']=actual
  entry['unplanned']=False
  if actual is not None:matched_keys.add(actual['key'])
  entries.append(entry)

 # 計画外実績(§9.33)を合成する。実施中の分は先頭へ入れて、この直後の
 # アンカー決定にそのまま乗せる(設備が実際に塞がっている時間を、予定を
 # 立てていたかどうかに関わらず反映するため)。完了分は展開ループが
 # 終端状態として読み飛ばすので末尾でよい。
 if include_unplanned:
  unplanned_running,unplanned_done=unplanned_entries(actual_index,equipment,matched_keys,now,history_hours)
  entries=unplanned_running+entries+unplanned_done

 # アンカー決定(§7.2): 展開対象(完了/取消を除く)の先頭を見る
 active=[e for e in entries if e['state'] not in PLAN_TERMINAL_STATES]
 timeline=build_slot_timeline(specific_cal,global_cal,now.date())
 # 着手中(§9.37): まだ終わっていない作業。予定終了は「現在時刻」とし、
 # 後続の予定はそこから並べる。以前は「残り見積(見積-経過、下限5分)」を
 # 足した時刻を予定終了にしていたが、見積を超過した瞬間から
 #   - 予定終了が下限5分で頭打ちになり実態と合わない
 #   - 後続の予定開始が「もう過ぎているのに未来」の値になる
 # という食い違いが出ていた。現在時刻で切れば、時間が経つほど後続も
 # 自然に後ろへずれ、常に整合が取れる(§9.38の「現在時刻に追随して流れる」)。
 ongoing_ids=set()
 ongoing_starts=[]
 for e in active:
  if e['state']=='着手' and e.get('actual') and e['actual'].get('startAt'):
   started=_parse_dt(e['actual']['startAt'])
   if started is not None:
    ongoing_ids.add(id(e));ongoing_starts.append(started)
 if ongoing_starts:
  anchor=min(ongoing_starts)
 else:
  anchor,_waited=snap_to_working(now,timeline)
  if anchor is None:
   anchor=now
   warnings.append('稼働カレンダー上、直近の稼働開始時刻を特定できませんでした。')

 cursor=anchor
 truncated=False
 # 子ロット(§9.83)は親の予定時刻をそのまま借りる。展開が終わってから
 # 親の値を写すため、ここでIDから引けるようにしておく。
 parent_of={e['id']:e.get('parentId') for e in entries if e.get('parentId') is not None}
 for idx,e in enumerate(entries):
  if e.get('parentId') is not None:
   # **カーソルを進めない**。親ロット1本をスリットする1回の作業なので、
   # タイムラインの長さを決めるのは親の見積だけ(子に時間を持たせると、
   # 分割ありのロットだけ予定終了が子の数だけ後ろへ伸びる)。
   e['plannedStart']=None;e['plannedEnd']=None;e['startsInMinutes']=None
   e['estimate']=None;e['reorderable']=False;e['spansNonWorking']=False
   e['overdueMinutes']=0;e['shift']=None
   continue
  if e['state'] in PLAN_TERMINAL_STATES:
   e['plannedStart']=None;e['plannedEnd']=None;e['startsInMinutes']=None
   e['estimate']=None;e['reorderable']=False;e['spansNonWorking']=False;e['overdueMinutes']=0;e['shift']=None
   continue
  est=resolve_estimate(mc,equipment,e)
  minutes=est['minutes']
  if id(e) in ongoing_ids:
   # 実績の開始時刻から「現在時刻まで」。終わっていないので予定終了は
   # 常に現在時刻(継続中)。見積を超えている分はoverdueMinutesで示す。
   started=_parse_dt(e['actual']['startAt']) or now
   elapsed=max(0.0,_minutes_between(started,now))
   e['plannedStart']=started.isoformat()
   e['plannedEnd']=now.isoformat()
   e['ongoing']=True
   e['startsInMinutes']=round(_minutes_between(now,started),1)
   e['estimate']=dict(est,minutes=round(est['minutes'],1))
   e['reorderable']=False
   e['spansNonWorking']=False
   e['overdueMinutes']=round(max(0.0,elapsed-est['minutes']),1)
   e['shift']=resolve_shift_label(specific_shift,global_shift,started)
   # 後続はすべて現在時刻から並べ直す(着手中が複数あっても基準は1つ)
   next_cursor,_w=snap_to_working(now,timeline)
   cursor=next_cursor if next_cursor is not None else now
   continue
  fixed_start=None
  if e.get('fixedStart'):
   try:fixed_start=_parse_dt(e['fixedStart'])
   except Exception:fixed_start=None
  overdue=0.0
  resume_from=None
  if fixed_start:
   # ロック(§9.38): 固定した日時からは動かさない。以前は前工程が押して
   # カーソルが固定時刻を過ぎていると、その分だけ後ろへずらして配置して
   # いた(遅れの記録は残るが位置は動く)。それでは「鍵をかけたのに
   # 時間が経つとずれていく」ことになり、日付を決めて置いた意味が無い。
   # 表示位置は必ず固定時刻に据え置き、ぶつかっている分はoverdueで知らせる。
   if fixed_start<cursor:
    overdue=_minutes_between(fixed_start,cursor)
    # 後続の予定はカーソルを巻き戻さない(過去へ置いてしまうため)。
    resume_from=cursor
   cursor=fixed_start
  cursor,_waited=snap_to_working(cursor,timeline)
  if cursor is None:
   truncated=True
  if truncated:
   e['plannedStart']=None;e['plannedEnd']=None;e['startsInMinutes']=None
   e['estimate']=dict(est,minutes=minutes)
   e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
   e['spansNonWorking']=False;e['overdueMinutes']=0;e['shift']=None
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
   e['shift']=resolve_shift_label(specific_shift,global_shift,planned_start)
   warnings.append(f"予定ID {e['id']} は稼働カレンダー上、{MAX_HORIZON_DAYS}日以内に収まりません。")
   continue
  # この予定自身の終了はend_cursor。後続を進めるカーソルだけ、ロックで
  # 巻き戻した分(resume_from)まで戻す(この行のplannedEndには混ぜない)。
  e['plannedStart']=planned_start.isoformat();e['plannedEnd']=end_cursor.isoformat()
  cursor=end_cursor
  if resume_from is not None and resume_from>cursor:cursor=resume_from
  e['startsInMinutes']=round(_minutes_between(now,planned_start),1)
  e['estimate']=dict(est,minutes=round(minutes,1))
  e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE) and not e.get('unplanned')
  e['spansNonWorking']=bool(spans)
  e['overdueMinutes']=round(overdue,1)
  e['shift']=resolve_shift_label(specific_shift,global_shift,planned_start)

 # 子ロットへ親の予定時刻を写す(§9.83)。画面は子を親の下に畳んで出すので、
 # 時刻そのものは親と同じで構わない。持たせておくと、日付・勤務でまとめる
 # 表示(§9.39)でも親と同じ束へ入る。
 if parent_of:
  by_id={e['id']:e for e in entries}
  for e in entries:
   p=by_id.get(e.get('parentId'))
   if p is None:continue
   e['plannedStart']=p.get('plannedStart');e['plannedEnd']=p.get('plannedEnd')
   e['startsInMinutes']=p.get('startsInMinutes');e['shift']=p.get('shift')

 for e in entries:
  actual=e.pop('actual')
  e.pop('storedState')
  if e['state']=='着手' and actual and actual.get('startAt'):
   try:
    started=_parse_dt(actual['startAt'])
    e['actual']={'startAt':actual['startAt'],'endAt':None,'elapsedMinutes':round(max(0.0,_minutes_between(started,now)),1)}
   except Exception:
    e['actual']={'startAt':actual.get('startAt'),'endAt':None,'elapsedMinutes':None}
  elif e['state']=='完了' and actual and actual.get('startAt') and actual.get('endAt'):
   try:
    started=_parse_dt(actual['startAt']);ended=_parse_dt(actual['endAt'])
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
  # 合成した計画外実績(§9.33)は共有DBに行が無いため数えない。
  expanded=expand_plan(c,equipment,include_unplanned=False)
  pending=sum(1 for e in expanded['entries'] if e['state']==sr.PLAN_REORDERABLE_STATE)
  in_progress=sum(1 for e in expanded['entries'] if e['state']=='着手')
  completed=sum(1 for e in expanded['entries'] if e['state']=='完了')
 finally:
  c.close()
 # 設定系マスタの参照件数はmaster.sqlite3側から数える。
 mc=sr.config_master_conn()
 try:
  calendar_rows=len(sr.calendar_rows(mc,equipment))
  # 設備停止マスタは1行が複数設備・全設備を指せる(§9.81)。ここで数えたいのは
  # 「この設備を消したら宛先を失う登録」なので、名指しの行だけを数える
  # (全設備('*')の行は1台消えても意味を失わないため対象外)。
  stop_reason_rows=sum(1 for r in sr.stop_reason_rows(mc) if sr.stop_equipment_named(r[1],equipment))
  target=normalize_equipment_name(equipment)
  override_rows=sum(1 for r in sr.load_factor_override_rows(mc) if normalize_equipment_name(r[1])==target)
 finally:
  mc.close()
 return {'pendingPlans':pending,'inProgressPlans':in_progress,'completedPlans':completed,
         'calendarRows':calendar_rows,'stopReasonRows':stop_reason_rows,'loadFactorOverrideRows':override_rows}
