"""rne_scheduler.py: RNEからSQLite3を定期的に抽出・更新する背景スレッド。

**抽出は取得元(sikalot_source)と独立して実行できる。** 抽出の成果物を
仕掛一覧が読むかどうか(sikalot_source)と、抽出を回すかどうかは別の関心事で、
共有から読みつつローカルの複製を作っておきたい/設定を試したい、という
運用があるため。定期実行の可否はパス設定マスタの"rne_extract_enabled"
('auto'=localのときだけ / 'on' / 'off')で決め、毎周回で読み直す。
手動の「今すぐ抽出」は、資材(RNE・symnavim.conf)が置いてあればいつでも動く。

SIKALOTNOW/SIKALOTDEFの2ジョブを毎回並列(サブプロセス)で実行する。Navigator
API/COMセッションはプロセス間で安全に共有できないため、ジョブごとに独立した
Pythonプロセス(backend.rne_worker)を起動する(rne_extract.extract_one参照)。
ジョブ数が2件と少ないため、キュー/スロット管理は行わず、ジョブ数と同じ数の
スレッドを起動しそれぞれがサブプロセスの完了をブロック待ちする単純な形にした。

抽出間隔はパス設定マスタ(db/master.sqlite3、マスタ管理画面から編集)の
"rne_extract_interval_sec"で変更できる(現場ごとに負荷/鮮度要件が異なる
ため)。ループの毎周回で読み直すので、次の周回から反映される(反映に
アプリの再起動は不要)。
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid

from pathlib import Path

from .config import RNE_EXTRACT_INTERVAL_SEC_DEFAULT
from .db_access import DATA_SOURCES, DB_DIR, SIKALOT_SOURCE, path_config_value
from .logging_setup import app_logger
from .paths import APP_ROOT, ensure_local_dirs
from .quiet import quiet

_DEFAULT_ASSETS_DIR=APP_ROOT/'config'/'rne_extract'
_MIN_INTERVAL_SEC=60
_WORKER_TIMEOUT_SEC=600

def assets_dir():
 """RNE資材(RNEファイル・symnavim.conf)の置き場。パス設定マスタの
 "rne_assets_dir"で変更できる。共有フォルダに1式だけ置いて全端末から
 参照する運用があるため、端末ごとのコピーを強制しない(§9.79)。"""
 v=path_config_value('rne_assets_dir')
 return Path(v) if v else _DEFAULT_ASSETS_DIR

def conf_path():
 """接続情報 symnavim.conf の場所。"rne_conf_path"で個別に指定できる
 (資材置き場とは別の場所に、認証情報だけを置きたい運用があるため)。
 未指定なら資材置き場の直下。"""
 v=path_config_value('rne_conf_path')
 return Path(v) if v else assets_dir()/'symnavim.conf'

def rne_path(name):
 """RNEファイルの場所。マスタに絶対パスを入れてあればそれを使い、
 ファイル名だけならば資材置き場の rne/ 配下として解決する。"""
 p=Path(name)
 return p if p.is_absolute() else assets_dir()/'rne'/name

def _output_path(entry):
 p=Path(entry.get('output') or f"{entry['key'].lower()}.sqlite3")
 return p if p.is_absolute() else DB_DIR/p

def jobs():
 """抽出ジョブの一覧。**データソースマスタが唯一の定義場所**(§9.79)。
 以前はここに2件を直接書いており、参照データを増やすたびに
 db_access.DBS とここの両方を直す必要があった(しかも別々に書けるため
 「抽出しているのに読まない」状態が作れた)。"""
 from .db_access import _read_mode_value,READ_MODE_SHARE
 out=[]
 for s in DATA_SOURCES:
  if not s.get('rne'):continue         # RNEが未設定＝抽出対象ではない
  # **「共有を読む」と明に決めたソースは抽出しない**(§9.168)。出力ファイルは
  # 誰も読まないので、毎回作るのは時間と資材の無駄（RNEの無い端末では失敗
  # ログだけが積み上がる）。**読み方が空欄のものは今までどおり対象**にする
  # ——空欄＝「全体設定に従う」で、回すかどうかは`rne_extract_enabled`
  # (auto/on/off)が決める。ここで全体設定まで見て絞ると、network運用の端末で
  # 「今すぐ抽出」が1件も動かなくなる（実際にtest_datasourceが落ちた）。
  if _read_mode_value(s.get('mode'),s.get('key',''))==READ_MODE_SHARE:continue
  out.append({'name':s['key'],'rne':s['rne'],'table':s.get('table') or '仕掛',
              'output':str(_output_path(s))})
 return out

# 旧来の参照名(モジュール読み込み時点の一覧)。**新しいコードは jobs() を使う**
# ——マスタを編集したら次の呼び出しから反映されるのはjobs()の側だけ。
JOBS=tuple(jobs())


def _no_window():
 """pythonw(コンソール非表示)から子プロセスを起動しても黒い画面を出さない。"""
 if sys.platform=='win32':
  return {'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}
 return {}


def _conf():
 dirs=ensure_local_dirs()
 return {
  'rne_dir':str(assets_dir()/'rne'),
  'symnavim_conf':str(conf_path()),
  'backup_dir':str(dirs['backup']/'rne_extract'),
  'base_dir':str(APP_ROOT),
 }


def _run_job(job,conf):
 """1ジョブをサブプロセス(backend.rne_worker)で実行する。例外は投げない。"""
 dirs=ensure_local_dirs()
 token=f"{job['name']}_{os.getpid()}_{uuid.uuid4().hex[:8]}"
 work_root=dirs['work']/'rne_extract'
 payload_path=work_root/f'{token}.payload.json'
 result_path=work_root/f'{token}.result.json'
 work_dir=work_root/token
 payload={'job':job,'conf':conf,'work_dir':str(work_dir)}
 env=dict(os.environ,NAVI_WORKER_TIMEOUT_SEC=str(_WORKER_TIMEOUT_SEC))
 try:
  work_root.mkdir(parents=True,exist_ok=True)
  payload_path.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
  proc=subprocess.run(
   [sys.executable,'-m','backend.rne_worker',str(payload_path),str(result_path)],
   cwd=str(APP_ROOT),capture_output=True,text=True,timeout=_WORKER_TIMEOUT_SEC,env=env,**_no_window())
  if result_path.exists():
   return json.loads(result_path.read_text(encoding='utf-8'))
  return {'ok':False,'job':job['name'],'error':f"ワーカーが結果を返しませんでした(exit={proc.returncode}): {proc.stderr[-2000:]}"}
 except subprocess.TimeoutExpired:
  return {'ok':False,'job':job['name'],'error':'抽出がタイムアウトしました'}
 except Exception as e:
  return {'ok':False,'job':job['name'],'error':str(e)}
 finally:
  for p in (payload_path,result_path):
   try:p.unlink()
   except OSError:pass
  # ワーカーがタイムアウトでkillされた場合、その場のfinally(rne_extract側の
  # 作業フォルダ削除)は実行されない。呼び出し元(ここ)からも念のため
  # 掃除しておき、繰り返しのタイムアウトでディスクを圧迫しないようにする。
  try:shutil.rmtree(work_dir,ignore_errors=True)
  except Exception as _e:quiet('作業フォルダを片付けられない（次の掃除で消える）',_e)


# 直近の実行結果。画面(マスタ管理 > パス設定)へ「動いているか」を出すために持つ。
# 以前は成否がアプリログにしか出ず、抽出が回っているのかを画面から確認できなかった。
_last={'startedAt':None,'finishedAt':None,'running':False,'trigger':'','jobs':[]}
_last_lock=threading.Lock()
_run_lock=threading.Lock()   # 手動実行と定期実行が重ならないようにする

def last_status():
 """直近の抽出結果のスナップショット。sikalot_source=local以外でも呼べる。"""
 with _last_lock:
  snapshot=dict(_last);snapshot['jobs']=list(_last['jobs'])
 snapshot['source']=SIKALOT_SOURCE
 snapshot['scheduleMode']=str(path_config_value('rne_extract_enabled','auto') or 'auto')
 snapshot['enabled']=schedule_enabled()        # 定期実行が回るか
 snapshot['canRun']=extract_possible()          # 手動実行できるか(資材の有無)
 snapshot['intervalSec']=_interval_sec()
 snapshot['assetsDir']=str(assets_dir())
 snapshot['confPath']=str(conf_path())
 snapshot['sources']=[{'key':s['key'],'label':s['label'],'rne':s.get('rne',''),
                       'output':str(_output_path(s))} for s in DATA_SOURCES]
 # 抽出資材が置かれているか(未配置なら「起動しない」理由がこれ)。
 snapshot['assets']={
  'symnavimConf':conf_path().exists(),
  'rne':[j['rne'] for j in jobs() if rne_path(j['rne']).exists()],
  'rneMissing':[j['rne'] for j in jobs() if not rne_path(j['rne']).exists()],
 }
 outputs=[]
 for job in jobs():
  p=job['output']
  try:
   from pathlib import Path as _P
   st=_P(p).stat()
   outputs.append({'name':job['name'],'path':p,'exists':True,'mtime':st.st_mtime,'size':st.st_size})
  except OSError:
   outputs.append({'name':job['name'],'path':p,'exists':False,'mtime':None,'size':None})
 snapshot['outputs']=outputs
 return snapshot


def run_batch(trigger='schedule'):
 """全ジョブを並列に1回実行し、結果のdictリストを返す(手動実行にも使う)。
 triggerは'schedule'(定期)か'manual'(画面のボタン)で、状態表示に出す。"""
 if not _run_lock.acquire(blocking=False):
  raise RuntimeError('抽出が既に実行中です。完了までお待ちください。')
 try:
  with _last_lock:
   _last.update({'startedAt':time.time(),'finishedAt':None,'running':True,'trigger':trigger})
  try:
   return _run_batch_inner()
  finally:
   with _last_lock:
    _last['running']=False;_last['finishedAt']=time.time()
 finally:
  _run_lock.release()


def _run_batch_inner():
 conf=_conf()
 active=jobs()
 results=[None]*len(active)
 # 実行中の進み具合を**途中でも**見せる(§9.78)。以前は全ジョブが終わって
 # から一度に jobs を差し替えていたため、画面からは「動いているらしい」
 # としか分からず、あと何割で終わるのかが出せなかった。開始時に全ジョブを
 # 'running' で並べ、終わったものから書き換える。
 with _last_lock:
  _last['jobs']=[{'name':j['name'],'running':True,'ok':None,'rows':None,
                  'columns':None,'elapsed':None,'error':''} for j in active]
 def _worker(i,job):
  results[i]=_run_job(job,conf)
  r=results[i] or {}
  with _last_lock:
   if i<len(_last['jobs']):
    _last['jobs'][i]={'name':job['name'],'running':False,'ok':bool(r.get('ok')),
                      'rows':r.get('rows'),'columns':r.get('columns'),
                      'elapsed':r.get('elapsed'),'error':str(r.get('error') or '')}
 threads=[threading.Thread(target=_worker,args=(i,job),name=f"rne-extract-{job['name']}") for i,job in enumerate(active)]
 for t in threads:t.start()
 for t in threads:t.join()
 # **この変数を jobs という名前にしないこと。** モジュール直下の jobs()
 # を隠してしまい、同じ関数の先頭にある active=jobs() が
 # UnboundLocalError になる(Pythonは関数内のどこかで代入があれば
 # その名前を最初からローカル扱いにする)。
 done=[]
 for job,result in zip(active,results):
  if result.get('ok'):
   app_logger().info('RNE抽出成功: %s (%s行 %s列 %.1f秒)',job['name'],result.get('rows'),result.get('columns'),result.get('elapsed') or 0)
  else:
   app_logger().warning('RNE抽出失敗: %s: %s',job['name'],result.get('error'))
  done.append({'name':job['name'],'running':False,'ok':bool(result.get('ok')),'rows':result.get('rows'),
               'columns':result.get('columns'),'elapsed':result.get('elapsed'),
               'error':str(result.get('error') or '')})
 with _last_lock:_last['jobs']=done
 return results


def _interval_sec():
 try:
  return max(_MIN_INTERVAL_SEC,int(path_config_value('rne_extract_interval_sec',RNE_EXTRACT_INTERVAL_SEC_DEFAULT)))
 except (TypeError,ValueError):
  return RNE_EXTRACT_INTERVAL_SEC_DEFAULT


def _loop():
 while True:
  # 定期実行の可否・間隔は毎周回で読み直す(設定変更に再起動を要らなくする)。
  if schedule_enabled() and extract_possible():
   # 手動実行と重なったときは今回の周回を飛ばす(次の周回で追いつく)
   try:run_batch('schedule')
   except RuntimeError:pass
   except Exception as e:app_logger().warning('RNE抽出の周回で例外: %s',e)
  time.sleep(_interval_sec())


def extract_possible():
 """抽出を実行できる状態か(資材が置いてあるか)。取得元(sikalot_source)とは
 独立。共有から読む運用でも、ローカルの複製を作る・設定を試す目的で
 実行できてよいため、実行可否は資材の有無だけで決める。"""
 if not conf_path().exists():return False
 active=jobs()
 return bool(active) and all(rne_path(j['rne']).exists() for j in active)

def schedule_enabled():
 """定期実行を回すか。パス設定マスタの rne_extract_enabled で決める。
    'auto'(既定): sikalot_source=='local' のときだけ(従来の挙動)
    'on'  : 取得元に関わらず回す / 'off': 回さない
    いずれの設定でも「今すぐ抽出」は資材があれば実行できる。"""
 mode=str(path_config_value('rne_extract_enabled','auto') or 'auto').strip().lower()
 if mode=='on':return True
 if mode=='off':return False
 return SIKALOT_SOURCE=='local'

def start():
 """抽出の背景スレッドを開始する(デーモンスレッド)。
    定期実行の可否は毎周回で読み直すため、ここでは常にスレッドを立てる
    (設定を'on'へ変えたら再起動なしで回り始める)。"""
 threading.Thread(target=_loop,daemon=True,name='rne-scheduler').start()
