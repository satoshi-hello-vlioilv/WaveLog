"""boot_status.py: 起動待機画面(loading.html)へ「今どの段階か」を伝える。

待機画面はブラウザが file:// で開く静的ページで、Webサーバーがまだ
立ち上がっていない間は当然どのAPIも叩けない。そのため以前は
**経過秒数だけ**で段階表示を切り替えていた(2秒未満→実行環境、5秒未満→
アプリを準備中、それ以降は全部「接続を確認中」)。実際の進捗ではないので、
共有の応答が遅くて時間がかかる場合は「接続を確認中」に延々留まり、
どこで待たされているのか利用者にも管理者にも分からなかった。

ここでは起動処理が段階ごとにアプリ直下へ小さなJSファイルを書き出し、
待機画面がそれを <script src> で読み込む(file:// 同士なのでfetchは使えない)。
Webサーバーの起動前から実際の進捗を出せる。

書き込みに失敗しても起動そのものは続ける(表示の都合で起動を止めない)。
"""
from pathlib import Path
import json
import time

from .paths import APP_ROOT

STATUS_FILENAME='boot_status.js'
# 待機画面の一覧と対応させる。増減させるときは loading.html の steps も合わせる。
STEPS=(
 ('env','実行環境を確認'),
 ('instance','起動中のアプリを確認'),
 ('packages','必要な部品を確認'),
 ('data','データの置き場所を確認'),
 ('app','アプリを読み込み'),
 ('server','Webサーバーを起動'),
)
_STEP_INDEX={key:i for i,(key,_label) in enumerate(STEPS)}
_started=time.time()


def _path():
 return APP_ROOT/STATUS_FILENAME


def report(step,detail='',failed=False):
 """現在の段階を書き出す。step は STEPS のキー。"""
 index=_STEP_INDEX.get(step)
 if index is None:return
 payload={'step':step,'index':index,'total':len(STEPS),
          'label':STEPS[index][1],'detail':str(detail or ''),
          'failed':bool(failed),'at':time.time(),'elapsed':round(time.time()-_started,1)}
 try:
  _path().write_text('window.wavelogBootStatus&&window.wavelogBootStatus('
                     +json.dumps(payload,ensure_ascii=False)+');\n',encoding='utf-8')
 except Exception:
  pass  # 表示の都合で起動を止めない


def clear():
 """起動完了後に消す(次回起動時に前回の内容が一瞬見えるのを防ぐ)。"""
 try:_path().unlink(missing_ok=True)
 except Exception:pass
