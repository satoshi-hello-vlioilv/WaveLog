"""rne_scheduler.py: 仕掛/品質データのローカル運用(sikalot_source=local)時に、
RNEからSQLite3を定期的に抽出・更新する背景スレッド。

SIKALOTNOW/SIKALOTDEFの2ジョブを毎回並列(サブプロセス)で実行する。Navigator
API/COMセッションはプロセス間で安全に共有できないため、ジョブごとに独立した
Pythonプロセス(backend.rne_worker)を起動する(rne_extract.extract_one参照)。
ジョブ数が2件と少ないため、キュー/スロット管理は行わず、ジョブ数と同じ数の
スレッドを起動しそれぞれがサブプロセスの完了をブロック待ちする単純な形にした。

抽出間隔はconfig/local.jsonの"rne_extract_interval_sec"で変更できる(現場ごとに
負荷/鮮度要件が異なるため)。ループの毎周回で読み直すので、次の周回から反映
される(反映にアプリの再起動は不要)。
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import threading
import time
import uuid

from .config import RNE_EXTRACT_INTERVAL_SEC_DEFAULT
from .db_access import SIKALOT_SOURCE, SIKALOTDEF_LOCAL_PATH, SIKALOTNOW_LOCAL_PATH
from .logging_setup import app_logger
from .paths import APP_ROOT, configured_value, ensure_local_dirs

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
 try:
  work_root.mkdir(parents=True,exist_ok=True)
  payload_path.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
  proc=subprocess.run(
   [sys.executable,'-m','backend.rne_worker',str(payload_path),str(result_path)],
   cwd=str(APP_ROOT),capture_output=True,text=True,timeout=_WORKER_TIMEOUT_SEC,**_no_window())
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


def run_batch():
 """全ジョブを並列に1回実行し、結果のdictリストを返す(app.py等からの手動実行にも使う)。"""
 conf=_conf()
 results=[None]*len(JOBS)
 def _worker(i,job):
  results[i]=_run_job(job,conf)
 threads=[threading.Thread(target=_worker,args=(i,job),name=f"rne-extract-{job['name']}") for i,job in enumerate(JOBS)]
 for t in threads:t.start()
 for t in threads:t.join()
 for job,result in zip(JOBS,results):
  if result.get('ok'):
   app_logger().info('RNE抽出成功: %s (%s行 %s列 %.1f秒)',job['name'],result.get('rows'),result.get('columns'),result.get('elapsed') or 0)
  else:
   app_logger().warning('RNE抽出失敗: %s: %s',job['name'],result.get('error'))
 return results


def _interval_sec():
 try:
  return max(_MIN_INTERVAL_SEC,int(configured_value('rne_extract_interval_sec',RNE_EXTRACT_INTERVAL_SEC_DEFAULT)))
 except (TypeError,ValueError):
  return RNE_EXTRACT_INTERVAL_SEC_DEFAULT


def _loop():
 run_batch()
 while True:
  time.sleep(_interval_sec())
  run_batch()


def start():
 """抽出の背景スレッドを開始する(デーモンスレッド)。
    sikalot_source=local以外(既定はnetwork)なら何もしない。"""
 if SIKALOT_SOURCE!='local':return
 threading.Thread(target=_loop,daemon=True,name='rne-scheduler').start()
