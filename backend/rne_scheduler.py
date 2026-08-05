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

from .config import RNE_EXTRACT_INTERVAL_SEC_DEFAULT
from .db_access import SIKALOT_SOURCE, SIKALOTDEF_LOCAL_PATH, SIKALOTNOW_LOCAL_PATH, path_config_value
from .logging_setup import app_logger
from .paths import APP_ROOT, ensure_local_dirs

RNE_ASSETS_DIR=APP_ROOT/'config'/'rne_extract'
_MIN_INTERVAL_SEC=60
_WORKER_TIMEOUT_SEC=600

# 2ジョブとも表定義(RNE)側のテーブル名は「仕掛」。抽出先はdb_access.pyが
# sikalot_source=localのときに読みに行くパスと同じにする(単一の情報源)。
JOBS=(
 {'name':'SIKALOTNOW','rne':'SIKALOTNOW.RNE','table':'仕掛','output':str(SIKALOTNOW_LOCAL_PATH)},
 {'name':'SIKALOTDEF','rne':'SIKALOTDEF.RNE','table':'仕掛','output':str(SIKALOTDEF_LOCAL_PATH)},
)


def _no_window():
 """pythonw(コンソール非表示)から子プロセスを起動しても黒い画面を出さない。"""
 if sys.platform=='win32':
  return {'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}
 return {}


def _conf():
 dirs=ensure_local_dirs()
 return {
  'rne_dir':str(RNE_ASSETS_DIR/'rne'),
  'symnavim_conf':str(RNE_ASSETS_DIR/'symnavim.conf'),
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
  except Exception:pass


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
 snapshot['assetsDir']=str(RNE_ASSETS_DIR)
 # 抽出資材が置かれているか(未配置なら「起動しない」理由がこれ)。
 snapshot['assets']={
  'symnavimConf':(RNE_ASSETS_DIR/'symnavim.conf').exists(),
  'rne':[j['rne'] for j in JOBS if (RNE_ASSETS_DIR/'rne'/j['rne']).exists()],
  'rneMissing':[j['rne'] for j in JOBS if not (RNE_ASSETS_DIR/'rne'/j['rne']).exists()],
 }
 outputs=[]
 for job in JOBS:
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
 results=[None]*len(JOBS)
 def _worker(i,job):
  results[i]=_run_job(job,conf)
 threads=[threading.Thread(target=_worker,args=(i,job),name=f"rne-extract-{job['name']}") for i,job in enumerate(JOBS)]
 for t in threads:t.start()
 for t in threads:t.join()
 jobs=[]
 for job,result in zip(JOBS,results):
  if result.get('ok'):
   app_logger().info('RNE抽出成功: %s (%s行 %s列 %.1f秒)',job['name'],result.get('rows'),result.get('columns'),result.get('elapsed') or 0)
  else:
   app_logger().warning('RNE抽出失敗: %s: %s',job['name'],result.get('error'))
  jobs.append({'name':job['name'],'ok':bool(result.get('ok')),'rows':result.get('rows'),
               'columns':result.get('columns'),'elapsed':result.get('elapsed'),
               'error':str(result.get('error') or '')})
 with _last_lock:_last['jobs']=jobs
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
 if not (RNE_ASSETS_DIR/'symnavim.conf').exists():return False
 return all((RNE_ASSETS_DIR/'rne'/j['rne']).exists() for j in JOBS)

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
