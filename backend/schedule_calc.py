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
import threading
from time import perf_counter as _perf   # `from datetime import time` と衝突するので別名
from datetime import date, datetime, time, timedelta

from . import actual_match
from . import load_factor
from . import schedule_sync
from .repositories import schedule_repo as sr
from .repositories.master_repo import normalize_equipment_name
from .db_access import merged_backup_rows, connect as _sqlite_connect
from .quiet import quiet

# 稼働カレンダーを**最初に**組み立てる日数。ここで足りなければ
# `SlotTimeline`が伸ばす（§9.291 ②、利用者の指示「枠いっぱいになったら、
# それ以上のロットを受け付けてくれない。制限なく、スケジュールを作成できる
# ようにしてください」）。
#
# 以前はこれが**上限そのもの**で、60日ぶんの稼働帯を1回組んだら終わりだった。
# 予定がそこを超えると`snap_to_working()`／`consume_minutes()`が`None`を返し、
# その予定から先は`plannedStart=None`（＝画面では「未定」）になる——**行は
# 足せているのに時刻が付かない**ので、利用者からは「受け付けてくれない」と
# しか見えない。
MAX_HORIZON_DAYS=60
# 伸ばすときの倍率と、これ以上は伸ばさない上限。**上限は残す**——稼働帯が
# 1つも無いカレンダー（全部休みなど）では、いくら伸ばしても置き場所は
# 見つからないので、際限なく組み立て続けると応答が返らなくなる。
# 5年ぶんあれば「制限なく」と実質同じで、しかも組み立ては1日ぶんずつの
# 積み上げなので、伸びた回数だけ線形にしか増えない。
HORIZON_GROW_FACTOR=4
HORIZON_CAP_DAYS=1830
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

def resolve_shift_info(specific_shift_rows,global_shift_rows,dt):
 """§5.5の勤務形態マスタ。dt(datetime)の時刻(時分のみ、日付は見ない)が
 該当する勤務の (名称, 日付補正) を返す(該当が無ければ (None,0))。
 優先順位は稼働カレンダーマスタと同じ(設備別行があればそちらを優先、
 無ければ全設備既定)。終了時刻<=開始時刻は日跨ぎ勤務として扱う
 (例: 23:00〜07:00の3直、t>=23:00またはt<07:00で該当)。

 **日付補正は「跨いだ後の時間帯」にだけ当てる**(§9.195の現場歴)。
 3直 23:00〜翌7:00 なら、23:00〜24:00は補正0・0:00〜7:00は補正-1
 ——こうすると1回の3直が暦をまたいでも同じ日付になり、「日付＋勤務」で
 まとめたときに1つの塊になる。**補正の値はマスタが決める**(既定は-1)ので、
 ここに日付の演算を埋め込まないこと。"""
 if dt is None:return (None,0)
 rows=specific_shift_rows if specific_shift_rows else global_shift_rows
 if not rows:return (None,0)
 t=dt.time()
 for r in rows:
  # r: 勤務ID,設備名,名称,開始時刻,終了時刻,表示順,有効,日付補正
  sh,sm=_parse_hm(r[3]);eh,em=_parse_hm(r[4])
  start_t=time(sh%24,sm);end_t=time(eh%24,em)
  off=int(r[7]) if len(r)>7 and r[7] is not None else sr.SHIFT_DAYOFF_DEFAULT
  if (eh*60+em)<=(sh*60+sm):
   if t>=start_t:return (r[2],0)
   if t<end_t:return (r[2],off)
  else:
   if start_t<=t<end_t:return (r[2],0)
 return (None,0)

def resolve_shift_label(specific_shift_rows,global_shift_rows,dt):
 """該当する勤務名称だけを返す（判定は resolve_shift_info の1箇所）。"""
 return resolve_shift_info(specific_shift_rows,global_shift_rows,dt)[0]

# ========================================================================
# 空の日付・直の枠(§9.238 ②)
# ========================================================================
def frame_target(detail,specific_shift_rows,global_shift_rows):
 """枠(kind='枠')の行き先を実時刻へ解く。戻り値: (datetime or None, 理由)。

 **保存されているのは日付と直の名称だけ**で、実時刻はここで毎回引き直す
 (schedule_repo.normalize_frame のコメント参照)。直の開始時刻をマスタで
 直したら、置いてある枠も一緒に動いてほしいため。

 直を選んでいない枠は「その日の頭から」＝0:00。展開側が snap_to_working で
 その日の最初の稼働開始まで繰り上げるので、休みの日を指しても壊れない。

 **直の名前が見つからないときは0:00へ落とし、理由を返す**——黙って
 その日の頭にすると、「2直と書いてあるのに朝から空いている」ことになる。
 """
 d=str((detail or {}).get('frameDate') or '').strip()
 if not d:return (None,'枠に日付が入っていません。')
 try:day=date.fromisoformat(d)
 except Exception as _e:quiet('日時として読めない（無いものとして続ける）',_e);return (None,f'枠の日付「{d}」を読めません。')
 name=str((detail or {}).get('frameShift') or '').strip()
 if not name:return (datetime.combine(day,time(0,0)),'')
 rows=specific_shift_rows if specific_shift_rows else global_shift_rows
 for r in (rows or []):
  # r: 勤務ID,設備名,名称,開始時刻,終了時刻,表示順,有効,日付補正
  if str(r[2] or '').strip()==name:
   # 日を跨ぐ直(23:00〜翌7:00)でも、**開始は現場日そのもの**の側にある
   # (§9.195の日付補正は「跨いだ後の時間帯」にだけ当たるので、開始時刻は
   #  補正0＝暦の日付と現場日が一致する側)。だから素直に組み立ててよい。
   return (_to_dt(day,r[3]),'')
 return (datetime.combine(day,time(0,0)),f'勤務「{name}」が勤務形態マスタにありません。その日の頭として扱いました。')

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

class SlotTimeline:
 """稼働帯の並び。**足りなくなったら自分で伸びる**（§9.291 ②）。

    `build_slot_timeline()`はそのまま残してある（1回ぶんを組む道具）。
    ここはそれを持ち、`grow()`で日数を増やして組み直すだけの薄い器。
    **並びとしても振る舞う**ので、`for s,e in timeline`と書いている
    既存の呼び出しは1行も変えなくてよい。

    伸ばすのは`snap_to_working()`／`consume_minutes()`の中——「この先に
    稼働帯が無い」と分かるのはそこだけで、呼ぶ側は伸びたことを知らなくてよい。
    **上限に達したら伸ばさない**（`grow()`がFalse）ので、そのときは今までと
    同じ「打ち切り」になる。"""
 def __init__(self,specific_rows,global_rows,from_date,
              horizon_days=MAX_HORIZON_DAYS,cap_days=HORIZON_CAP_DAYS):
  self._specific=specific_rows;self._global=global_rows;self._from=from_date
  self.cap_days=max(int(horizon_days or 0),int(cap_days or 0))
  self.days=max(1,int(horizon_days or MAX_HORIZON_DAYS))
  self.grown=0
  self.slots=build_slot_timeline(specific_rows,global_rows,from_date,self.days)
 def grow(self):
  """日数を増やして組み直す。伸ばせたらTrue。"""
  if self.days>=self.cap_days:return False
  self.days=min(self.cap_days,max(self.days+1,self.days*HORIZON_GROW_FACTOR))
  self.slots=build_slot_timeline(self._specific,self._global,self._from,self.days)
  self.grown+=1
  return True
 def __iter__(self):return iter(self.slots)
 def __len__(self):return len(self.slots)
 def __bool__(self):return True

def _grow(slots):
 """渡された並びが伸びられるなら伸ばす（素のlistならFalse）。"""
 g=getattr(slots,'grow',None)
 return bool(g and g())

# 予定の起点を丸める単位(分)。§9.198。**0や負にしないこと**——`_round_up`が
# そのまま返すだけになる(丸めない、と同じ)。
ANCHOR_ROUND_MIN=5

def _round_up(dt,minutes):
 """dtを`minutes`分の刻みへ切り上げる。ちょうど刻みの上ならそのまま。"""
 step=int(minutes or 0)
 if step<=0:return dt
 base=dt.replace(second=0,microsecond=0)
 over=(dt-base).total_seconds()
 rem=base.minute%step
 if rem==0 and over<=0:return base
 return base+timedelta(minutes=(step-rem)%step or step)

def snap_to_working(cursor,slots):
 """cursorが稼働帯の中ならそのまま、非稼働ならその時点以降で最も早い稼働
 開始時刻へ繰り上げる。戻り値: (新cursor or None(打ち切り), 待ちが発生したか)。

 **並びの終わりまで来たら伸ばして探し直す**（§9.291 ②）——`SlotTimeline`を
 渡したときだけ。素のlistなら今までどおり`None`（打ち切り）。"""
 while True:
  for s,e in slots:
   if s<=cursor<e:return cursor,False
   if s>cursor:return s,True
  if not _grow(slots):return None,True

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
  if slot is None:
   # 伸ばせるなら伸ばして探し直す（§9.291 ②）。
   if _grow(slots):continue
   return None,spans,True
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

_actual_index_cache={'rows':None,'index':None}
_actual_index_lock=threading.Lock()

def build_actual_index(backup_rows=None):
 """(ロット番号,鋳造番号,製造材質)の正規化キー -> 最新実績dict、の索引を作る。
 §7.4のとおり3項目のいずれかが欠けている行は突合対象にしない。

 **同じ行なら作り直さない**（§9.198）。材料の`merged_backup_rows()`は
 中身が変わらないかぎり**同じリストを返す**（db_access側でキャッシュ済み）
 ので、その同一性で判定できる。ここを毎回作り直すと、予定を1回読むたびに
 **測定データ全件のJSONを解き直す**ことになり、実績が溜まるほど遅くなる
 （記録が増えるほど遅くなる、という一番たちの悪い形で出る）。
 **戻り値を書き換えないこと**——写しを配っているので、書き換えると次の
 呼び出しへ持ち越される。"""
 rows=backup_rows if backup_rows is not None else merged_backup_rows()
 with _actual_index_lock:
  if _actual_index_cache['rows'] is rows and _actual_index_cache['index'] is not None:
   return _actual_index_cache['index']
 index=_build_actual_index(rows)
 with _actual_index_lock:
  _actual_index_cache['rows']=rows;_actual_index_cache['index']=index
 return index

def _build_actual_index(rows):
 index={}
 for row in rows:
  try:
   payload=json.loads(row.get('payload') or '{}')
  except Exception as _e:
   quiet('保存された値を読めない（既定で続ける）',_e)
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

_lot_index_cache={'index':None,'lots':None}

def _lot_index(index):
 """ロット番号だけ -> 実績の並び。**3項目の突合(§7.4)で当たらなかった理由**を
 言うためだけに使う（判定そのものは変えない）。実績索引と同じ寿命で控える。"""
 with _actual_index_lock:
  if _lot_index_cache['index'] is index and _lot_index_cache['lots'] is not None:
   return _lot_index_cache['lots']
 lots={}
 for key,a in (index or {}).items():
  lots.setdefault(key[0],[]).append(a)
 with _actual_index_lock:
  _lot_index_cache['index']=index;_lot_index_cache['lots']=lots
 return lots

_MATCH_LABEL={'castingNo':'鋳造番号','mfgMaterial':'製造材質'}

def advance_note(entry,detail,lots):
 """**完了にならない（繰り上がらない）理由**(§9.462、利用者の報告「ロットが
 完了している場合にスケジュールを繰り上げてほしいが、うまく機能していないか、
 元データが思うように突合せできていない可能性」)。

 繰り上がるのは状態が完了（または着手）になった行だけ。「予定」のまま残る行の
 うち、**直せば完了になるもの**に理由を付ける。答えるのはこの1箇所で、画面は
 `label`（行の印）と`text`（その本文）を出すだけ:
  ・測定データは完了しているが、3項目（ロット番号・鋳造番号・製造材質）の
    どれかが予定と合わない → 突き合わせの問題
  ・仕掛から消えたかを判定できない（予定の側に突合キーが無い・読めない）
 完了突合が1件も無いことは全行に共通なので、行ではなく`warnings`で1回言う。"""
 if entry['kind']!='作業' or entry.get('parentId') is not None:return None
 if entry['state']!=sr.PLAN_REORDERABLE_STATE or entry.get('unplanned'):return None
 lot=normalize_match_key(detail.get('lotNo') or entry.get('lotNo'))
 done=[a for a in (lots.get(lot) or []) if record_finished(a)] if lot else []
 if done:
  a=max(done,key=lambda x:x.get('updatedAt') or '')
  basic=a.get('basic') or {}
  plan={'castingNo':detail.get('castingNo') or entry.get('castingNo'),'mfgMaterial':detail.get('mfgMaterial')}
  bad=[]
  for k,label in _MATCH_LABEL.items():
   pv=str(plan.get(k) or '').strip();av=str(basic.get(k) or '').strip()
   if normalize_match_key(pv)!=normalize_match_key(av) or not pv:
    bad.append(f"{label}（予定: {pv or '空'}／測定: {av or '空'}）")
  if bad:
   return {'code':'recordMismatch','label':'測定済み・不一致',
           'text':'このロットの測定データは完了していますが、'+'・'.join(bad)
                  +'が予定と一致しないため完了にできません。'
                  '予定は「ロット番号・鋳造番号・製造材質」の3つが測定データとそろって一致したときに完了になります。'}
 reason=str(entry.get('missingReason') or '')
 if entry.get('missingFromWork') is None and reason and '完了突合の設定がありません' not in reason:
  return {'code':'finishUnknown','label':'完了判定できず',
          'text':'仕掛から消えたかどうかを判定できません: '+reason}
 return None

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
  except Exception as _e:quiet('数として読めない（既定で続ける）',_e);cutoff=None
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

def saved_actual_source(stored_actual_json):
 """予定に保存した完了突合（`[実績JSON]`・§9.364/§9.365）を読む。**読むのはここ1箇所**。

 戻り値: {'values': 突合した行, 'finishedAt': 完了日時 or None, 'joinName': 定義名} か None。
 保存の形は2つある(§9.365): 素の行そのもの（§9.364で保存したぶん）と、完了時刻・定義名を
 添えた入れ物。**古い形も読めること**——読めないと保存済みの完了が「予定」に戻って見える。"""
 if not stored_actual_json:return None
 try:saved=json.loads(stored_actual_json)
 except Exception as _e:
  quiet('保存した実績を読めない（突合し直す）',_e);return None
 if not (isinstance(saved,dict) and saved):return None
 values=saved.get('values') if isinstance(saved.get('values'),dict) else saved
 return {'values':values,'finishedAt':str(saved.get('finishedAt') or '') or None,
         'joinName':str(saved.get('joinName') or '')}

def _apply_actual_source(entry,detail,stored_actual_json):
 """仕掛から消えたロットを「完了」または「着手」として扱う(§9.364)。

 利用者の指示:「作業スケジュール表に組んだロットが、仕掛データから消えた
 場合は、作業完了または作業開始したものとして扱いたい」——実績にHITすれば
 **完了**、HITしなければ（実績が未設定のときも含めて）**着手**。

 **保存済みの実績が最優先。** 実績データは次の抽出で消える（前工程が
 終わった行は落ちる）ので、一度HITしたら共有スケジュールへ写しを残す
 （書くのは書込役だけ・§4.2）。ここは読むだけ。

 触るのは**親の作業行で、まだ「予定」のもの**だけ:
  ・計画者が確定した完了／取消（`PLAN_TERMINAL_STATES`）は動かさない
  ・測定データと突合できた行（`actual`）はそちらが正
  ・子ロットは親にぶら下がる明細行なので、単独で状態を持たせない
 """
 entry['missingFromWork']=None
 entry['missingReason']=''
 entry['actualSource']=None
 entry['actualSourceSaved']=False
 # 突合で分かった完了時刻(§9.365)。**測定データの実績とは別の欄**——出どころが
 # 違うものを同じ欄に入れると、どちらの根拠で完了したのか言えなくなる。
 entry['finishedAt']=None
 entry['finishedBy']=''
 if entry['kind']!='作業' or entry.get('parentId') is not None:return
 if entry['state'] in PLAN_TERMINAL_STATES or entry.get('actual') is not None:return
 saved=saved_actual_source(stored_actual_json)
 if saved:
  # **一度突き合わせたものは、相手から消えても保持する**（利用者の指示）。
  entry['state']='完了'
  entry['missingFromWork']=True
  entry['actualSource']=saved['values']
  entry['actualSourceSaved']=True
  entry['finishedAt']=saved['finishedAt']
  entry['finishedBy']=saved['joinName']
  entry['missingReason']='仕掛から消えており、突合で確認済みです（この予定に保存してあります）。'
  return
 hit=actual_match.lookup(detail,entry)
 entry['missingReason']=hit.get('reason') or ''
 if hit.get('missing') is not True:
  # False（仕掛にある）／None（判定できない）はどちらも状態を動かさない。
  entry['missingFromWork']=hit.get('missing')
  return
 entry['missingFromWork']=True
 if hit.get('actual'):
  entry['state']='完了'
  entry['actualSource']=hit['actual']
  # **完了日時が読めなくても完了にする**（利用者の指示）。時刻が無い行は
  # さかのぼりで隠さない側へ倒す——隠すと「完了にしたはずの行がどこにも
  # 無い」になる。
  entry['finishedAt']=str(hit.get('finishedAt') or '') or None
  entry['finishedBy']=str(hit.get('joinName') or '')
 else:
  # **消えた＝少なくとも着手はしている**（利用者の指示）。突合先が未設定でも
  # 「予定のまま」にはしない——現場は既に手を付けている。
  entry['state']='着手'

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

def resolve_estimate(c,equipment,plan_row_dict,memo=None):
 """c: 設定系マスタ(master.sqlite3)への接続。設備停止マスタの標準時間と
 換算係数上書きマスタしか読まないため、共有schedule.sqlite3ではなくこちらを渡す。
 plan_row_dict: {'kind','title','estimateMinutes','detail'}を持つdict
 (expand_plan()内のentry辞書と同じキー)。戻り値: §6.8のentries[].estimate
 相当のdict(minutes/source/low/high/sigmaLog/base/factors)。
 memo: 1回の展開で使い回す控え(§9.198)。設備が同じあいだ変わらない値
 (設備停止マスタ・設備の標準時間・換算係数の上書き)を引き直さないための
 もので、渡さなければ今までどおり毎回引く。"""
 if plan_row_dict.get('estimateMinutes') is not None:
  return {'minutes':float(plan_row_dict['estimateMinutes']),'source':'override',**_EMPTY_ESTIMATE_EXTRAS}
 # コメント(§9.189)は時間を持たない申し送り。見積は常に0分。
 if plan_row_dict.get('kind')=='コメント':
  return {'minutes':0.0,'source':'comment',**_EMPTY_ESTIMATE_EXTRAS}
 # 枠(§9.238 ②)も**自分では時間を使わない**。効くのは「後続の起点を
 # その日・その直まで進める」ことだけなので、見積は常に0分。
 if plan_row_dict.get('kind')=='枠':
  return {'minutes':0.0,'source':'frame',**_EMPTY_ESTIMATE_EXTRAS}
 if plan_row_dict.get('kind')=='設備停止':
  title=plan_row_dict.get('title') or ''
  stops=None if memo is None else memo.setdefault('stopMinutes',{})
  if stops is not None and title in stops:
   minutes=stops[title]
  else:
   minutes=sr.stop_reason_standard_minutes(c,equipment,title)
   if stops is not None:stops[title]=minutes
  if minutes is not None:
   return {'minutes':float(minutes),'source':'stop-reason-master',**_EMPTY_ESTIMATE_EXTRAS}
  return {'minutes':DEFAULT_ESTIMATE_MINUTES,'source':'default',**_EMPTY_ESTIMATE_EXTRAS}
 # 種別='作業': 換算係数モデル(§6)による見積。basisがequipment/pooledなら
 # 実績由来のsource='model'、モデル自体が無ければsource='default'。
 result=load_factor.estimate_work(c,equipment,plan_row_dict.get('detail') or {},memo=memo)
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

# ========================================================================
# さかのぼり(§9.366、利用者の指示)
# ------------------------------------------------------------------------
# 「作業スケジュールの一覧からは、切り替えて見えないようにする機能(表示の
# さかのぼり)をもっと使いやすく改良し、指定できるパターンも増やしつつ
# 選びやすくわかりやすく改良してください。」
#
# 以前は`[2,4,8,24,72]`時間の5つだけで、しかも**時間でしか言えなかった**
# ——現場が実際に言うのは「今日ぶん」「今の直から」で、それを時間へ翻訳
# するのは人の側の仕事になっていた。
#
# **起点を答えるのはここの1箇所**。画面は返ってきた日時で絞るだけにする
# ——画面にも同じ計算を置くと、勤務区分マスタを直した端末だけ境目が違う、
# という状態が作れる（§9.163と同じ理由）。
#
# 群は5つ。**一度に見る数を5つ以下に保つ**ため、画面は「種類→量」の2段で
# 選ばせる（§9.366）。
HISTORY_GROUPS=[
 {'key':'off','label':'出さない'},
 {'key':'hours','label':'時間で'},
 {'key':'days','label':'日で'},
 {'key':'field','label':'現場の区切りで'},
 {'key':'all','label':'すべて'},
]
HISTORY_MODES=[
 {'key':'none','group':'off','label':'済んだ行を出さない','hours':0.0,
  'note':'完了・取消の行を1件も出しません。これからの予定だけになります。'},
 {'key':'h1','group':'hours','label':'1時間','hours':1.0},
 {'key':'h2','group':'hours','label':'2時間','hours':2.0},
 {'key':'h4','group':'hours','label':'4時間','hours':4.0},
 {'key':'h8','group':'hours','label':'8時間','hours':8.0},
 {'key':'h12','group':'hours','label':'12時間','hours':12.0},
 {'key':'h24','group':'hours','label':'24時間','hours':24.0},
 {'key':'d3','group':'days','label':'3日','hours':72.0},
 {'key':'d7','group':'days','label':'7日','hours':168.0},
 {'key':'d30','group':'days','label':'30日','hours':720.0},
 {'key':'today','group':'field','label':'今日ぶん（現場歴）','hours':None,
  'note':'勤務の日付補正を当てた「現場の1日」の始まりから。暦の0時ではありません。'},
 {'key':'shift','group':'field','label':'今の直から','hours':None,
  'note':'いま動いている勤務が始まった時刻から。'},
 {'key':'all','group':'all','label':'すべて残す','hours':None,
  'note':'完了・取消をすべて出します（計画外の実績は最大90日ぶん）。'},
]
HISTORY_DEFAULT='h8'
_HISTORY_BY_KEY={m['key']:m for m in HISTORY_MODES}
# 「すべて」で計画外実績をさかのぼる上限。**青天井にしない**——測定データを
# 全件突き合わせることになり、開くたびに数十秒かかる（§9.198）。
HISTORY_ALL_HOURS=24.0*90


def history_mode(key):
 """さかのぼりの1件。知らない値・未設定は既定（いまから過去8時間）。"""
 return _HISTORY_BY_KEY.get(str(key or '')) or _HISTORY_BY_KEY[HISTORY_DEFAULT]


def _shift_starts(specific_shift,global_shift,now):
 """いまの前後にある「直の始まり」を、古い順に返す。

 直の始まりは**時刻だけ**がマスタにあるので、前日・当日・翌日の3日ぶんに
 当てはめて実際の日時にする（日跨ぎの直があるため前後1日を見る）。"""
 rows=specific_shift if specific_shift else global_shift
 out=[]
 for r in (rows or []):
  try:sh,sm=_parse_hm(r[3])
  except Exception as _e:
   quiet('直の開始時刻を読めない（この段は飛ばす）',_e);continue
  for d in (-1,0,1):
   base=(now+timedelta(days=d)).date()
   out.append(datetime.combine(base,time(sh%24,sm)))
 return sorted(set(out))


def history_from(key,now,specific_shift=None,global_shift=None):
 """さかのぼりの起点（この日時より後の済んだ行だけを出す）。

 戻り値: (起点のdatetime or None, 計画外実績をさかのぼる時間, 但し書き)。
 起点が None なら「制限しない」。**起点を決めるのはここだけ**（§9.366）。"""
 m=history_mode(key)
 if m['key']=='all':
  return None,HISTORY_ALL_HOURS,''
 if m['hours'] is not None:
  return now-timedelta(hours=m['hours']),m['hours'],''
 starts=[s for s in _shift_starts(specific_shift,global_shift,now) if s<=now]
 if not starts:
  # 勤務区分マスタが無い現場では「現場の区切り」を言えない。**黙って
  # 別の意味へ倒さない**——暦の0時で代用すると、3直の現場で夜勤の途中に
  # 境目が来る。既定（8時間）へ戻し、そのことを但し書きで言う。
  d=_HISTORY_BY_KEY[HISTORY_DEFAULT]['hours']
  return (now-timedelta(hours=d),d,
          '勤務区分マスタが無いため、いまから過去%d時間で出しています。'%int(d))
 if m['key']=='shift':
  at=starts[-1]
 else:
  # 今日ぶん＝**いまと同じ現場歴の日付**になる直のうち、いちばん古い始まり。
  _n,off=resolve_shift_info(specific_shift,global_shift,now)
  today=(now+timedelta(days=off)).date()
  same=[s for s in starts
        if (s+timedelta(days=resolve_shift_info(specific_shift,global_shift,s)[1])).date()==today]
  at=min(same) if same else starts[-1]
 hours=max(0.0,(now-at).total_seconds()/3600.0)
 return at,hours,''

def _iso(v):
 """DATETIME列をISO文字列へ。**読めない値で落ちないこと**——監査の表示のために
 一覧そのものが開けなくなるのは本末転倒(§9.180)。"""
 if not v:return ''
 try:return v.isoformat()
 except Exception:return str(v)

def expand_plan(c,equipment,now=None,history_hours=DEFAULT_HISTORY_HOURS,include_unplanned=True,actual_index=None,history=None):
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
 # 内訳(§9.198)。「読み込みが遅い」ときに**どこが遅いのか**を画面から
 # 見えるようにするための計測。数字は応答に載せるだけで、判断は変えない。
 timings={}
 t0=_perf()
 raw_rows=sr.plan_rows(c,equipment)
 timings['rows']=round((_perf()-t0)*1000,1)
 # 設定系マスタ(稼働カレンダー・勤務形態・換算係数上書き)はmaster.sqlite3側。
 # 接続を1回だけ開いて、この展開処理の間ずっと使い回す(見積計算のために
 # 1予定ごとに開き直すと、行数分の接続オープンが発生してしまう)。
 sr.migrate_config_masters_from_shared()
 mc=sr.config_master_conn()
 try:
  out=_expand_plan_with(c,mc,equipment,now,raw_rows,history_hours,include_unplanned,actual_index,timings,history)
 finally:
  mc.close()
 timings['expand']=round((_perf()-t0)*1000,1)
 out['timings']=timings
 return out

def _expand_plan_with(c,mc,equipment,now,raw_rows,history_hours=DEFAULT_HISTORY_HOURS,include_unplanned=True,actual_index=None,timings=None,history=None):
 if timings is None:timings={}
 specific_cal=sr.calendar_rows(mc,equipment)
 global_cal=sr.calendar_rows(mc,'')
 specific_shift=sr.shift_rows(mc,equipment)
 global_shift=sr.shift_rows(mc,'')
 # さかのぼりの起点(§9.366)。**画面ではなくここが答える**——勤務区分マスタを
 # 読めるのはサーバーだけなので、「今日ぶん」「今の直から」は画面では出せない。
 history_from_at=None
 history_note=''
 if history is not None:
  history_from_at,history_hours,history_note=history_from(history,now,specific_shift,global_shift)
 if actual_index is None:
  t=_perf()
  actual_index=build_actual_index()
  timings['actual']=round((_perf()-t)*1000,1)
 warnings=[]

 entries=[]
 matched_keys=set()
 lots=_lot_index(actual_index)
 for r in raw_rows:
  detail={}
  if r[8]:
   try:detail=json.loads(r[8])
   except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);detail={}
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
  # ---- 仕掛から消えたロットの扱い(§9.364) ----
  # **測定データとの突合(§7.4)が先。** あちらで着手／完了になっている行は
  # ここで触らない——同じ状態を2つの根拠で決めると、食い違ったときに
  # どちらが正しいか言えなくなる。
  _apply_actual_source(entry,detail,r[22])
  if actual is not None:matched_keys.add(actual['key'])
  entry['advanceNote']=advance_note(entry,detail,lots)
  entries.append(entry)
 # 完了突合が無いことは全行に共通(§9.462)。**行ではなくここで1回**言う——
 # 無いと「仕掛から消えたロット」を完了にできず、測定データだけが頼りになる。
 if any(e['kind']=='作業' and e['state']==sr.PLAN_REORDERABLE_STATE and e.get('parentId') is None
        and '完了突合の設定がありません' in str(e.get('missingReason') or '') for e in entries):
  warnings.append('完了突合が登録されていないため、仕掛から消えたロットを完了にできません'
                  '（測定データで完了したロットだけが繰り上がります）。'
                  '「マスタ管理 > クエリ結合」で用途「完了突合」を1件登録すると、消えたロットも完了になります。')

 # 計画外実績(§9.33)を合成する。実施中の分は先頭へ入れて、この直後の
 # アンカー決定にそのまま乗せる(設備が実際に塞がっている時間を、予定を
 # 立てていたかどうかに関わらず反映するため)。完了分は展開ループが
 # 終端状態として読み飛ばすので末尾でよい。
 if include_unplanned:
  unplanned_running,unplanned_done=unplanned_entries(actual_index,equipment,matched_keys,now,history_hours)
  entries=unplanned_running+entries+unplanned_done

 # 見積を引くための控え(§9.198)。設備が同じあいだ変わらないもの
 # (設備の標準時間・換算係数の上書き・設備停止の標準所要分)を、
 # 予定1本ごとに引き直さないための入れ物。
 est_memo={}
 # アンカー決定(§7.2): 展開対象(完了/取消を除く)の先頭を見る
 active=[e for e in entries if e['state'] not in PLAN_TERMINAL_STATES]
 # **足りなくなったら伸びる**（§9.291 ②）。60日ぶんで組んで、予定が
 # そこを超えたら`snap_to_working()`／`consume_minutes()`が伸ばす。
 timeline=SlotTimeline(specific_cal,global_cal,now.date())
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
  elif e['state']=='着手' and e.get('missingFromWork') is True and not e.get('actual'):
   # **仕掛から消えて突合先に見つからない行も作業中として扱う**(§9.462)。
   # 以前は開始時刻を持たないので普通の予定と同じく「いまから見積ぶん」の
   # 場所に置かれ、**毎回そこに居座って後ろの予定を押し続けて**いた
   # (時間が流れないので、いつまでも繰り上がらない)。開始時刻は分からない
   # ので起点(アンカー)には使わず、予定の終わりを現在時刻にするだけ。
   ongoing_ids.add(id(e))
 anchor_note=None
 if ongoing_starts:
  anchor=min(ongoing_starts)
 else:
  anchor,_waited=snap_to_working(now,timeline)
  if anchor is None:
   anchor=now
   warnings.append('稼働カレンダー上、直近の稼働開始時刻を特定できませんでした。')
  else:
   # **起点は5分刻みへ切り上げる**(§9.198、利用者の指示)。現在時刻をそのまま
   # 起点にすると「10:23開始・11:47終了」のような読みにくい時刻が延々と続く。
   # **切り上げ**なのは、切り下げると既に過ぎた時刻から始まる予定になるため。
   # 着手中の作業があるときは丸めない——そちらは実績の開始時刻＝記録された
   # 事実で、見栄えのために動かしてよい値ではない。
   snapped=_round_up(anchor,ANCHOR_ROUND_MIN)
   if snapped!=anchor:
    # 丸めた先が稼働帯から出てしまうなら丸めない(勤務終わり際に起点だけが
    # 翌日へ飛ぶのを避ける)。
    back,_w=snap_to_working(snapped,timeline)
    if back==snapped:
     anchor_note={'from':anchor.isoformat(),'to':snapped.isoformat(),'unitMinutes':ANCHOR_ROUND_MIN}
     anchor=snapped

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
  est=resolve_estimate(mc,equipment,e,memo=est_memo)
  minutes=est['minutes']
  if e['kind']=='枠':
   # 空の日付・直の枠(§9.238 ②)。**カーソルを「進める」だけ**——
   # 自分は時間を使わない(見積0分)。
   #  ・起点が枠の時刻より前なら、そこまで飛ばす（空きができる）
   #  ・起点が既に過ぎていたら**何もしない**——手前の予定が押してきて
   #    埋まった、ということ。利用者の言う「押し出してくる際は連動して
   #    ロットが自然にその設定枠に入る」がこれ。
   # **後ろへ戻さないこと**。戻すと、既に始まっている予定より前の時刻へ
   # 後続を置くことになる。
   target,note=frame_target(e.get('detail'),specific_shift,global_shift)
   at=cursor
   if target is not None and target>cursor:
    snapped,_w=snap_to_working(target,timeline)
    if snapped is None:
     # 稼働カレンダーの見える範囲(MAX_HORIZON_DAYS)より先。**打ち切らず
     # そのまま置く**——後続は次の周回で truncated として理由が出る。
     at=target
     warnings.append(f"予定ID {e['id']} の枠は稼働カレンダー上、{timeline.days}日先までに置ける稼働帯がありません。")
    else:
     at=snapped
   gap=max(0.0,_minutes_between(cursor,at))
   e['plannedStart']=at.isoformat()
   e['plannedEnd']=e['plannedStart']
   e['startsInMinutes']=round(_minutes_between(now,at),1)
   e['estimate']=dict(est,minutes=0.0)
   e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
   e['spansNonWorking']=False;e['overdueMinutes']=0
   e['shift']=resolve_shift_label(specific_shift,global_shift,at)
   # 画面が「いま何が起きているか」を書けるだけの材料を渡す(§6)。
   #  reached=True … 起点が既にこの枠を過ぎている＝もう埋まった
   #  gapMinutes  … この枠が作っている空き時間
   e['frame']={'date':str((e.get('detail') or {}).get('frameDate') or ''),
               'shift':str((e.get('detail') or {}).get('frameShift') or ''),
               'note':str((e.get('detail') or {}).get('frameNote') or ''),
               'target':target.isoformat() if target is not None else None,
               'gapMinutes':round(gap,1),'reached':gap<=0,
               'warning':note}
   if note:warnings.append(f"予定ID {e['id']}: {note}")
   cursor=at
   continue
  if e['kind']=='コメント':
   # 申し送り(§9.189)。**カーソルを進めない**——時間を持たせると、
   # メモを1行挟むたびに後ろの予定が動くことになる。位置だけ持つ。
   at=cursor
   e['plannedStart']=at.isoformat() if at is not None else None
   e['plannedEnd']=e['plannedStart']
   e['startsInMinutes']=round(_minutes_between(now,at),1) if at is not None else None
   e['estimate']=dict(est,minutes=0.0)
   e['reorderable']=(e['state']==sr.PLAN_REORDERABLE_STATE)
   e['spansNonWorking']=False;e['overdueMinutes']=0
   e['shift']=resolve_shift_label(specific_shift,global_shift,at) if at is not None else None
   continue
  if id(e) in ongoing_ids:
   # 実績の開始時刻から「現在時刻まで」。終わっていないので予定終了は
   # 常に現在時刻(継続中)。見積を超えている分はoverdueMinutesで示す。
   # 開始の分からない行(仕掛落ち・§9.462)は現在時刻から現在時刻まで。
   started=_parse_dt(((e.get('actual') or {}).get('startAt')) or '') or now
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
   except Exception as _e:quiet('固定開始日時を読めない（固定なしとして並べる）',_e);fixed_start=None
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
   warnings.append(f"予定ID {e['id']} は稼働カレンダー上、{timeline.days}日先までに置ける稼働帯がありません。")
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
   warnings.append(f"予定ID {e['id']} は稼働カレンダー上、{timeline.days}日先までに置ける稼働帯がありません。")
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

 # 現場歴の日付(§9.195)。**1箇所でまとめて決める**——予定・着手中・完了で
 # 代表となる時刻が違うので、各所で計算すると「まとめた見出しと行の日付が
 # 食い違う」形の食い違いが必ず起きる。行の代表時刻の決め方は画面の
 # rowTimeOf() と同じ（完了・取消は実績、それ以外は予定開始）。
 for e in entries:
  ref=e.get('plannedStart')
  if e['state'] in PLAN_TERMINAL_STATES:
   a=e.get('actual') or {}
   # 突合で完了した行は実績を持たないので、突合で分かった完了時刻を使う
   # (§9.365)。**代表時刻の決め方は画面の rowTimeOf() と必ず同じ**——
   # 違うと「まとめた見出しと行の日付が食い違う」が必ず起きる。
   ref=a.get('startAt') or a.get('endAt') or e.get('finishedAt') or None
  dt=_parse_dt(ref) if ref else None
  if dt is None:
   e['shiftDayOffset']=0;e['workDate']=None;continue
  _name,off=resolve_shift_info(specific_shift,global_shift,dt)
  e['shiftDayOffset']=off
  e['workDate']=(dt+timedelta(days=off)).date().isoformat()

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
   e['workDate']=p.get('workDate');e['shiftDayOffset']=p.get('shiftDayOffset') or 0

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
   except Exception as _e:
    quiet('実績の時刻を読めない（実績なしとして出す）',_e)
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
 if history_note:warnings.append(history_note)
 return {'entries':entries,'warnings':warnings,'anchor':anchor.isoformat() if anchor else None,
         'anchorRounded':anchor_note,'loadFactor':load_factor_info,
         # さかのぼり(§9.366)。`historyFrom`が None なら「制限しない」。
         'historyKey':(history_mode(history)['key'] if history is not None else None),
         'historyFrom':history_from_at.isoformat() if history_from_at else None,
         'historyHours':history_hours}

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
