"""launch_guard.py: 多重起動の防止と、起動中インスタンスの記録。

同じアプリが複数起動するとポート競合・二重処理・設定ファイル競合を起こす。
既に起動している場合は新しいサーバーを起動せず、既存の画面を開く動作へ
切り替える(待機画面が既存インスタンスを検出して即座に遷移する)。

判定は「ポートが塞がっているか」だけでは足りない。同じポートを別のアプリが
使っている場合に誤って起動成功と判断しないよう、/api/build が返す
アプリ識別情報(app_id)まで照合する(仕様書2.3/2.4)。
"""
from datetime import datetime
from pathlib import Path
import json
import os
import socket
import urllib.error
import urllib.request

from backend.config import APP_ID, HOST, PORT, app_url
from backend.paths import APP_ROOT, instance_file

# 既存インスタンスの判定結果
OURS='ours'          # 同じアプリが起動中
FOREIGN='foreign'    # 別のアプリがポートを使用中
FREE='free'          # 誰も使っていない


def port_in_use(timeout=0.4):
 """ポートに誰かがbindしているか(HTTPかどうかは問わない)。"""
 with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s:
  s.settimeout(timeout)
  return s.connect_ex((HOST,PORT))==0


def probe(timeout=2.0):
 """ポートの使用状況を調べ、(状態, 情報) を返す。"""
 if not port_in_use():
  return FREE,None
 try:
  with urllib.request.urlopen(f'http://{HOST}:{PORT}/api/build',timeout=timeout) as r:
   info=json.loads(r.read().decode('utf-8','replace'))
 except urllib.error.HTTPError:
  return FOREIGN,None            # 何かが応答している=このアプリではない
 except Exception:
  # bindはされているがHTTPとして応答しない。別のアプリとみなす。
  return FOREIGN,None
 if isinstance(info,dict) and info.get('app_id')==APP_ID:
  return OURS,info
 return FOREIGN,info


def write_instance():
 """起動中のプロセス情報を記録する。stop.batや調査で使う。"""
 data={'app_id':APP_ID,'pid':os.getpid(),'url':app_url(),
       'app_root':str(APP_ROOT),'started_at':datetime.now().isoformat(timespec='seconds')}
 try:
  instance_file().write_text(json.dumps(data,ensure_ascii=False,indent=1),encoding='utf-8')
 except Exception:
  pass                            # 記録できなくても起動自体は続行する
 return data


def read_instance():
 """記録済みのインスタンス情報。無ければNone。"""
 try:
  return json.loads(Path(instance_file()).read_text(encoding='utf-8'))
 except Exception:
  return None


def clear_instance():
 try:
  instance_file().unlink()
 except Exception:
  pass
