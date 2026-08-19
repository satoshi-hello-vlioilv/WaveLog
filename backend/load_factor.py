"""load_factor.py: 負荷率(換算係数)モデル(docs/SCHEDULE_MODE_DESIGN.md §6)。

対数線形(乗法)モデル: 見積分(設備E,ロットL) = T0(E) × Π_j f_j(水準_j(L))。
実績の完了レコード(§6.4)から設備ごとに反復推定する(§6.5)。Flask非依存。

因子は仕掛スナップショット(明細JSON)・実績のbasic{}が共有する`aliases`の
キー空間で扱う(§6.2)。数値因子はビン(帯)へ落とし、ビン境界は算出のたびに
確定させて応答に含める(§6.3)。設備は因子にしない(設備ごとに別モデル)。
"""
import math
import statistics
import threading
import time
from datetime import datetime

from .config import LOAD_FACTOR_CACHE_TTL_SEC, MIN_SAMPLES
from .db_access import MEAS_DB, RECORDS_BACKUP_EXPORT_PATH, merged_backup_rows
from .repositories import schedule_repo as sr
from .repositories.master_repo import normalize_equipment_name, read_equipment_standard_minutes

FACTOR_KEYS=('purposeName','mfgMaterial','mfgTemper','mfgThickness','mfgWidth','mfgLength','boxHorizontalCount','boxVerticalCount','crewSize')
NUMERIC_FACTORS={'mfgThickness','mfgWidth','mfgLength','boxHorizontalCount','boxVerticalCount'}
K_SHRINK=5
CLIP_LOW=math.log(0.5)
CLIP_HIGH=math.log(2.0)
ITERATIONS=3
DEFAULT_ESTIMATE_MINUTES=120.0

# ========================================================================
# 実績データの読込・特徴量化(§6.2・§6.4)
# ========================================================================
def _numeric(v):
 try:
  s=str(v).strip()
  if s=='':return None
  return float(s)
 except Exception:
  return None

def _decode_payload(row):
 import json
 try:
  return json.loads(row.get('payload') or '{}')
 except Exception:
  return None

def _record_equipment(payload):
 settings=payload.get('settings') or {}
 return str(settings.get('registeredEquipment') or payload.get('registeredEquipment') or (payload.get('basic') or {}).get('equipment') or '').strip()

def completed_training_rows(equipment=None):
 """§6.4の対象実績を集める: status=='完了'・workTime両方あり差が正・設備が空でない。
 equipment指定時はその設備のみ(正規化一致)、Noneなら全設備プール。"""
 out=[]
 for row in merged_backup_rows():
  payload=_decode_payload(row)
  if not payload or payload.get('status')!='完了':continue
  wt=payload.get('workTime') or {}
  start,end=wt.get('startAt'),wt.get('endAt')
  if not start or not end:continue
  try:
   s=datetime.fromisoformat(start);e=datetime.fromisoformat(end)
  except Exception:continue
  minutes=(e-s).total_seconds()/60.0
  if minutes<=0:continue
  eq=_record_equipment(payload)
  if not eq:continue
  if equipment and normalize_equipment_name(eq)!=normalize_equipment_name(equipment):continue
  basic=payload.get('basic') or {}
  settings=payload.get('settings') or {}
  out.append({'minutes':minutes,'equipment':eq,'basic':basic,'crewSize':settings.get('crewSize')})
 return out

def _record_raw_value(row,key):
 if key=='crewSize':return row.get('crewSize')
 return row.get('basic',{}).get(key)

# ========================================================================
# ビン化(§6.3): 相異なる値が4種以下ならそのまま水準に、それ以外は四分位境界
# ========================================================================
def _fmt_num(v):
 if float(v).is_integer():return str(int(v))
 return f'{v:.3g}'

def compute_bin_boundaries(values):
 """4種超の数値群から四分位境界(昇順・重複除去)を返す。4種以下ならNone
 (呼び出し側はNoneを「値そのものを水準にする」の合図として扱う)。"""
 uniq=sorted(set(values))
 if len(uniq)<=4:return None
 n=len(values);sorted_vals=sorted(values)
 def pct(p):
  idx=(n-1)*p;lo=int(math.floor(idx));hi=int(math.ceil(idx))
  if lo==hi:return sorted_vals[lo]
  frac=idx-lo
  return sorted_vals[lo]*(1-frac)+sorted_vals[hi]*frac
 boundaries=sorted({pct(0.25),pct(0.5),pct(0.75)})
 return boundaries or None

def bin_label(value,boundaries):
 if boundaries is None:return _fmt_num(value)
 edges=[None]+list(boundaries)+[None]
 for i in range(len(edges)-1):
  lo,hi=edges[i],edges[i+1]
  if hi is not None and value>hi and i<len(edges)-2:continue
  if hi is None or value<=hi:
   lo_s='' if lo is None else _fmt_num(lo)
   hi_s='' if hi is None else _fmt_num(hi)
   if lo is None:return f'〜{hi_s}'
   if hi is None:return f'{lo_s}〜'
   return f'{lo_s}〜{hi_s}'
 return _fmt_num(value)

def level_for(key,raw,boundaries_map):
 if key in NUMERIC_FACTORS:
  num=_numeric(raw)
  if num is None:return None
  boundaries=boundaries_map.get(key)
  return bin_label(num,boundaries)
 s=str(raw or '').strip()
 return s or None

# ========================================================================
# 推定(§6.5)
# ========================================================================
def _fit(rows):
 """外れ値除去(§6.4)・反復推定(§6.5)を行い、モデル辞書を返す。rowsが空ならNone。"""
 if not rows:return None
 logs=[math.log(r['minutes']) for r in rows]
 med=statistics.median(logs)
 mad=statistics.median([abs(x-med) for x in logs])
 threshold=3*1.4826*mad if mad>0 else None
 kept=[];excluded=0
 for r,y in zip(rows,logs):
  if threshold is not None and abs(y-med)>threshold:
   excluded+=1;continue
  kept.append((r,y))
 if not kept:return None

 boundaries={}
 for key in NUMERIC_FACTORS:
  vals=[v for v in (_numeric(_record_raw_value(r,key)) for r,_ in kept) if v is not None]
  boundaries[key]=compute_bin_boundaries(vals) if vals else None

 levels=[];ys=[]
 for r,y in kept:
  lv={key:level_for(key,_record_raw_value(r,key),boundaries) for key in FACTOR_KEYS}
  levels.append(lv);ys.append(y)

 n=len(ys)
 ln_t0=statistics.median(ys)
 ln_f={key:{} for key in FACTOR_KEYS}
 counts={key:{} for key in FACTOR_KEYS}
 for key in FACTOR_KEYS:
  for lv in levels:
   v=lv.get(key)
   if v is not None:counts[key][v]=counts[key].get(v,0)+1

 def other_sum(lv,skip=None):
  return sum(ln_f[k].get(lv.get(k),0.0) for k in FACTOR_KEYS if k!=skip and lv.get(k) is not None)

 for _ in range(ITERATIONS):
  for key in FACTOR_KEYS:
   sums={};cnts={}
   for lv,y in zip(levels,ys):
    v=lv.get(key)
    if v is None:continue
    resid=y-ln_t0-other_sum(lv,skip=key)
    sums[v]=sums.get(v,0.0)+resid;cnts[v]=cnts.get(v,0)+1
   for v,total in sums.items():
    n_v=cnts[v];r_mean=total/n_v
    shrunk=r_mean*n_v/(n_v+K_SHRINK)
    ln_f[key][v]=max(CLIP_LOW,min(CLIP_HIGH,shrunk))
  resid_all=[y-other_sum(lv) for lv,y in zip(levels,ys)]
  ln_t0=statistics.median(resid_all)

 resids=[y-ln_t0-other_sum(lv) for lv,y in zip(levels,ys)]
 sigma_log=statistics.pstdev(resids) if len(resids)>1 else 0.0

 crew_values=[lv.get('crewSize') for lv in levels if lv.get('crewSize')]
 crew_mode=None
 if crew_values:
  try:crew_mode=statistics.mode(crew_values)
  except statistics.StatisticsError:crew_mode=crew_values[0]

 return {'n':n,'excluded':excluded,'T0':math.exp(ln_t0),
         'factors':{key:{v:math.exp(lf) for v,lf in d.items()} for key,d in ln_f.items()},
         'counts':counts,'boundaries':boundaries,'sigmaLog':sigma_log,
         'crewSizeMode':crew_mode,'calculatedAt':datetime.now().isoformat()}

# ========================================================================
# キャッシュ(§6.6): TTL + ソースファイルのmtime変化で無効化
# ========================================================================
_cache={}
_cache_lock=threading.Lock()

def _source_mtime():
 mtimes=[]
 for p in (MEAS_DB,RECORDS_BACKUP_EXPORT_PATH):
  try:
   if p and p.exists():mtimes.append(p.stat().st_mtime)
  except Exception:pass
 return max(mtimes) if mtimes else 0.0

def _compute_model(equipment):
 own=_fit(completed_training_rows(equipment))
 if own is not None and own['n']>=MIN_SAMPLES:
  own['basis']='equipment';own['equipment']=equipment
  return own
 pooled=_fit(completed_training_rows(None))
 if pooled is None:
  return None
 model=dict(pooled)
 model['equipment']=equipment
 if own is not None and own['n']>0:
  model['T0']=own['T0']
 model['basis']='pooled'
 return model

def get_model(equipment,force=False):
 key=normalize_equipment_name(equipment) if equipment else ''
 now=time.time();mtime=_source_mtime()
 with _cache_lock:
  entry=_cache.get(key)
  if not force and entry and (now-entry['ts']<LOAD_FACTOR_CACHE_TTL_SEC) and entry['mtime']==mtime:
   return entry['model']
 model=_compute_model(equipment)
 with _cache_lock:
  _cache[key]={'model':model,'ts':now,'mtime':mtime}
 return model

def invalidate_cache(equipment=None):
 with _cache_lock:
  if equipment is None:_cache.clear()
  else:_cache.pop(normalize_equipment_name(equipment),None)

# ========================================================================
# 予測(§6.7・§6.8)
# ========================================================================
def resolve_overrides(c,equipment):
 """(因子,水準)->係数 の辞書。設備別優先、無ければ全設備共通([設備名]='')。
 因子='BASE'は[水準]=''固定(T0の上書き)。"""
 rows=sr.load_factor_override_rows(c)
 specific={};global_={}
 for r in rows:
  eq,factor,level,coeff=str(r[1] or '').strip(),str(r[2] or '').strip(),str(r[3] or '').strip(),r[4]
  if coeff is None:continue
  target=specific if normalize_equipment_name(eq)==normalize_equipment_name(equipment) and eq else (global_ if not eq else None)
  if target is None:continue
  target[(factor,level)]=coeff
 merged=dict(global_);merged.update(specific)
 return merged

def estimate_work(c,equipment,detail,crew_size=None,memo=None):
 """§6.7の種別='作業'見積。detail: 明細JSON相当のdict(aliasesキー空間)。
 戻り値は§6.8のentries[].estimate相当(minutes/low/high/sigmaLog/basis/base/factors)。

 memo: **1回の展開の中で使い回す控え**(§9.198)。設備マスタの標準時間と
 換算係数上書きは**設備が同じなら同じ値**なのに、以前は予定1本ごとに
 引き直していた——1本あたり「表の一覧→列の一覧→設備マスタ全走査→
 上書きマスタ全走査」で、200本の設備では800回の問い合わせになる。
 渡さなければ今までどおり毎回引く(単発のプレビューはそれでよい)。"""
 model=get_model(equipment)
 # 設備マスタの「1ロットあたり標準時間」(§9.114)。**その設備の実績が
 # 足りないとき**の保険で、優先順位は次のとおり。
 #
 #   ① その設備自身の実績モデル (basis='equipment')
 #   ② 設備マスタの1ロットあたり標準時間 (basis='equipment-standard')
 #   ③ 全設備をまとめたモデル (basis='pooled')
 #   ④ 全体の暫定既定値 120分 (basis='default')
 #
 # **②が③より先**なのが要点。'pooled'は他の設備の実績まで混ぜた統計で、
 # 設備ごとの差をならした値になる——1ロットの所要が設備でまるで違うから
 # こそ「設備単位で持たせたい」という要望なので、そこへ他設備の平均を
 # 当てるとこの設定の意味が無くなる。逆に**その設備自身の実績が溜まったら
 # ①が勝つ**(標準時間で実績を上書きしない。上書きすると実績が集まっても
 # 精度が上がらない)。
 if memo is None:
  std=read_equipment_standard_minutes(c,equipment) if c is not None else None
 elif 'std' in memo:
  std=memo['std']
 else:
  std=read_equipment_standard_minutes(c,equipment) if c is not None else None
  memo['std']=std
 if model is None or (std is not None and model.get('basis')!='equipment'):
  if std is not None:
   return {'minutes':round(float(std),1),'low':None,'high':None,'sigmaLog':None,
           'basis':'equipment-standard','base':None,'factors':[]}
  if model is None:
   return {'minutes':DEFAULT_ESTIMATE_MINUTES,'low':None,'high':None,'sigmaLog':None,
           'basis':'default','base':None,'factors':[]}
 if memo is None:
  overrides=resolve_overrides(c,equipment)
 else:
  overrides=memo.get('overrides')
  if overrides is None:
   overrides=resolve_overrides(c,equipment);memo['overrides']=overrides
 base_override=overrides.get(('BASE',''))
 t0=base_override if base_override is not None else model['T0']
 ln_total=0.0
 factors_out=[]
 boundaries=model['boundaries']
 for key in FACTOR_KEYS:
  raw=crew_size if key=='crewSize' else detail.get(key)
  if key=='crewSize' and (raw is None or str(raw).strip() in ('','-')):
   raw=model.get('crewSizeMode')
  level=level_for(key,raw,boundaries)
  if level is None:continue
  override_val=overrides.get((key,level))
  auto_val=model['factors'].get(key,{}).get(level)
  n=model['counts'].get(key,{}).get(level,0)
  if override_val is not None:
   value=override_val;source='override'
  elif auto_val is not None:
   value=auto_val;source='auto'
  else:
   value=1.0;source='unknown'
  ln_total+=math.log(value)
  factors_out.append({'key':key,'level':level,'value':round(value,3),'n':n,'source':source})
 minutes=t0*math.exp(ln_total)
 sigma=model.get('sigmaLog') or 0.0
 low=minutes*math.exp(-1.96*sigma) if sigma else minutes
 high=minutes*math.exp(1.96*sigma) if sigma else minutes
 return {'minutes':round(minutes,1),'low':round(low,1),'high':round(high,1),
         'sigmaLog':round(sigma,3),'basis':model['basis'],
         'base':{'T0':round(t0,1),'n':model['n']},'factors':factors_out}

def accuracy(equipment):
 """§6.9。完了実績のうち、見積が算出できる(=モデルがある)ものについて
 ln(実測/見積)の中央値バイアスとMAPE相当を返す。見積分自体は明細が無いと
 出せないため、ここでは実績側の対数所要時間と同モデルのT0(基準時間)だけを
 使った粗い代理指標とする(因子別の細かい突合はUI側でentries[].actualと
 estimateを直接比較する、§8.1)。"""
 model=get_model(equipment)
 if model is None:
  return {'n':0,'medianLogBias':None,'mape':None}
 rows=completed_training_rows(equipment)
 if not rows:
  return {'n':0,'medianLogBias':None,'mape':None}
 log_biases=[];ape=[]
 for r in rows:
  est=model['T0']
  actual=r['minutes']
  log_biases.append(math.log(actual/est))
  ape.append(abs(actual-est)/actual)
 return {'n':len(rows),'medianLogBias':round(statistics.median(log_biases),3),
         'mape':round(statistics.median(ape),3)}
