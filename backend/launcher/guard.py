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
from ..quiet import quiet

# 既存インスタンスの判定結果
OURS='ours'                # 同じアプリが起動中
FOREIGN='foreign'          # 別のアプリがポートを使用中(HTTP応答はあるが別物と確認できた)
UNRESPONSIVE='unresponsive'# ポートは使用中だがHTTPが応答しない(自分自身が重い処理でブロックされている可能性を含む)
FREE='free'                # 誰も使っていない

# ローカルホストへの問い合わせは**絶対にプロキシを経由させない**。
# urllib は既定でプロキシ設定を見る。Windowsでは環境変数だけでなく
# **レジストリのIE/Edgeのプロキシ設定まで読む**ため、社内プロキシが
# 設定された端末では 127.0.0.1 宛ての確認まで社内プロキシへ送られ、
# 認証が通らず 407 Proxy Authentication Required が返る。probe()は
# 「HTTPで何かが応答した=別のアプリ」と解釈するので、**自分自身が
# 起動しているのに「別のアプリが使用しています」と誤判定して
# stop.batが停止できなくなる**(実際に起きた。タスクマネージャーから
# 落とすしかない状態になっていた)。ProxyHandler({})でプロキシを
# 明示的に空にした専用のopenerを使い、この経路を断つ。
_LOCAL_OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))

# プロキシが返す典型的なステータス。これらは「ポートの向こうに別のアプリが
# いる」証拠ではなく、**そもそも問い合わせが目的地へ届いていない**印。
_PROXY_STATUSES=(407,502,503,504)


def urlopen_local(url,timeout=2.0,**kw):
 """このPC自身(127.0.0.1)への問い合わせ。プロキシを経由しない。"""
 return _LOCAL_OPENER.open(url,timeout=timeout,**kw)


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
  with urlopen_local(f'http://{HOST}:{PORT}/api/build',timeout=timeout) as r:
   info=json.loads(r.read().decode('utf-8','replace'))
 except urllib.error.HTTPError as e:
  # 何かが応答している=このアプリではない……とは限らない。プロキシ由来の
  # ステータス(407等)は「届いていない」印なので、別アプリと決めつけずに
  # UNRESPONSIVE(応答なし)として扱う。**こちらなら停止は記録済みPIDの
  # 経路へ進める**(force_stop()がinstance.jsonのapp_rootを照合するので、
  # 別フォルダーのアプリを巻き添えにすることはない)。
  if e.code in _PROXY_STATUSES:
   return UNRESPONSIVE,{'http_status':e.code,'note':'プロキシ経由の応答の可能性'}
  # 原因調査のため、返ってきたステータスだけでも記録しておく。
  return FOREIGN,{'http_status':e.code}
 except Exception as _e:
  # bindはされているがHTTPとして応答しない(タイムアウト・接続断など)。
  # 以前はここも一律FOREIGN扱いだったが、ネットワーク共有I/Oのブロックで
  # 自分自身(WaveLog)が一時的に応答不能になっているだけのケースと区別が
  # つかず、stop.batが「別のアプリが使用しています」と誤判定して停止不能に
  # なる実例があった。ここでは即断せずUNRESPONSIVEを返し、呼び出し側で
  # instance.json(このフォルダーのアプリとして記録されたPIDか)による
  # 最終判定に委ねる(process_manager.force_stop()が行う照合と同じ考え方)。
  quiet('生存確認に答えない（届いていないものとして扱う）',_e)
  return UNRESPONSIVE,None
 if isinstance(info,dict) and info.get('app_id')==APP_ID:
  return OURS,info
 return FOREIGN,info


def write_instance():
 """起動中のプロセス情報を記録する。stop.batや調査で使う。"""
 data={'app_id':APP_ID,'pid':os.getpid(),'url':app_url(),
       'app_root':str(APP_ROOT),'started_at':datetime.now().isoformat(timespec='seconds')}
 try:
  instance_file().write_text(json.dumps(data,ensure_ascii=False,indent=1),encoding='utf-8')
 except Exception as _e:
  quiet('起動の記録を書けない（停止は生存確認から進む）',_e)
 return data


def read_instance():
 """記録済みのインスタンス情報。無ければNone。"""
 try:
  return json.loads(Path(instance_file()).read_text(encoding='utf-8'))
 except Exception as _e:
  quiet('保存された値を読めない（既定で続ける）',_e)
  return None


def clear_instance():
 try:
  instance_file().unlink()
 except Exception as _e:
  quiet('いらないファイルを消せない（次の掃除で片付く）',_e)
