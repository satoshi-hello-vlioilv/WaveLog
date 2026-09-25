"""logging_setup.py: ログの初期化。

「起動しない」「画面が開かない」「処理が止まった」という現象を、利用者の
説明だけに頼らず調査できるようにするための記録。目的別に2系統へ分ける。

  launcher.log : 起動入口の記録(Python環境・多重起動判定・サーバー起動可否・
                 終了理由)。「Webサーバーに到達する前に失敗したのか」を判定する
  app.log      : アプリ本体の記録(リクエスト処理中のエラー等)

ログはアプリ本体ではなくユーザー別ローカル領域(%LOCALAPPDATA%\\WaveLog\\logs)
へ置く。共有フォルダー配置でも端末間で衝突せず、共有側を汚さないため。

通常起動(Start.vbs)はコンソールを持たないため、標準出力が使えない場合が
ある。その場合はファイルのみへ出力する。
"""
import logging
import logging.handlers
import os
import sys

from .paths import APP_ROOT, logs_dir
from .quiet import quiet

_MAX_BYTES=1_000_000
_BACKUP_COUNT=3
_FORMAT='%(asctime)s %(levelname)-7s [%(name)s] %(message)s'

# 画面へ記録を出してよいか（`console_off()`が下ろす）。**答えはここ1箇所**。
_CONSOLE=True

def console_off():
 """この処理のあいだ、**どの記録も画面へ出さない**（ファイルへは残す）。

 `update.bat`（`program/setup_app.py`）の画面は「結果」と「次にすること」だけ（§9.431）。
 `launcher_logger(to_console=False)` だけでは足りなかった——片付けなどが途中で
 `db_access` を読み込むと、読み込んだだけで `app_logger()` が警告を出し、時刻つきの行が
 画面へ混ざる（§9.497の追補。CIのまっさらな環境で踏んだ）。どの道から読み込まれても
 漏れないよう、**記録を画面へ出すかをロガーの側で1回決める**。付いている画面向けの
 出口も外し、これから作るロガーにも付けない。"""
 global _CONSOLE
 _CONSOLE=False
 for lg in [logging.getLogger(n) for n in list(logging.root.manager.loggerDict)]:
  for h in list(getattr(lg,'handlers',[])):
   if isinstance(h,logging.StreamHandler) and not isinstance(h,logging.FileHandler):
    lg.removeHandler(h)

def get_logger(name,filename,to_console=True):
 """名前付きロガーを返す。二重に呼んでもハンドラは重複追加しない。

 **「既にハンドラが1つでも付いていたら何もしない」にしないこと。**
 Flaskは`app.logger`へ初めて触れたときに、ハンドラが無ければ既定の
 StreamHandler(標準エラー)を自分で付ける。`Flask(__name__)`のnameは`app`
 なので、これは`app_logger()`と**同じロガー**である。先にFlask側が付けて
 しまうと、後から`app_logger()`を呼んでも「もうハンドラがある」と判断して
 ファイルへの出力を足さず、以後アプリ本体のログが app.log へ一切
 残らなくなる。しかも通常起動(Start.vbs)はコンソールを持たないため、
 標準エラーへ出した内容はどこにも残らない——**未処理例外のtracebackが
 消える**。実際に別端末の「Internal Server Error」を調べようとして、
 app.log に何も無く追えなかった(§9.77)。

 そのため、自分が付けたハンドラかどうかを目印で判定し、無ければ足す。
 """
 logger=logging.getLogger(name)
 logger.setLevel(logging.INFO)
 logger.propagate=False
 mark='_wavelog_'+filename
 if any(getattr(h,mark,False) for h in logger.handlers):
  return logger
 try:
  handler=logging.handlers.RotatingFileHandler(
   logs_dir()/filename,maxBytes=_MAX_BYTES,backupCount=_BACKUP_COUNT,encoding='utf-8')
  handler.setFormatter(logging.Formatter(_FORMAT))
  setattr(handler,mark,True)
  logger.addHandler(handler)
 except Exception as _e:
  # ログを書けないこと自体でアプリを止めない(共有側が読み取り専用等)。
  quiet('ログファイルを開けない（画面へは出したまま続ける）',_e)
 # pythonw(コンソール非表示)では標準出力が無いためStreamHandlerを付けない。
 if to_console and _CONSOLE and sys.stdout is not None:
  console=logging.StreamHandler(sys.stdout)
  console.setFormatter(logging.Formatter(_FORMAT))
  setattr(console,mark,True)
  logger.addHandler(console)
 return logger

def launcher_logger(to_console=True):
 """起動まわりの記録。

 **`to_console=False` は画面に出さない**（§9.431）。`update.bat` の画面は
 「結果」と「次にすること」だけにしたいので、時刻つきの記録が混ざると
 読むものが増える——利用者の指摘「一般的には不要な情報が多い」はここが
 いちばん大きかった（`log_environment()` だけで6行出る）。
 **記録そのものは launcher.log に残る**ので、調べる材料は減らない。"""
 return get_logger('launcher','launcher.log',to_console)

def app_logger():
 return get_logger('app','app.log')

def log_environment(logger):
 """調査の起点になる基本情報。起動のたびに必ず残す(仕様書2.6)。"""
 logger.info('--- 起動 ---')
 logger.info('Python      : %s',sys.executable or '(不明)')
 logger.info('バージョン  : %s',sys.version.replace('\n',' '))
 logger.info('アプリ配置  : %s',APP_ROOT)
 logger.info('プロセスID  : %s',os.getpid())
 logger.info('ログ出力先  : %s',logs_dir())
