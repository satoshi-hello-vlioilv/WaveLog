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

_MAX_BYTES=1_000_000
_BACKUP_COUNT=3
_FORMAT='%(asctime)s %(levelname)-7s [%(name)s] %(message)s'

def get_logger(name,filename,to_console=True):
 """名前付きロガーを返す。二重に呼んでもハンドラは重複追加しない。"""
 logger=logging.getLogger(name)
 if logger.handlers:
  return logger
 logger.setLevel(logging.INFO)
 logger.propagate=False
 try:
  handler=logging.handlers.RotatingFileHandler(
   logs_dir()/filename,maxBytes=_MAX_BYTES,backupCount=_BACKUP_COUNT,encoding='utf-8')
  handler.setFormatter(logging.Formatter(_FORMAT))
  logger.addHandler(handler)
 except Exception:
  # ログを書けないこと自体でアプリを止めない(共有側が読み取り専用等)。
  pass
 # pythonw(コンソール非表示)では標準出力が無いためStreamHandlerを付けない。
 if to_console and sys.stdout is not None:
  console=logging.StreamHandler(sys.stdout)
  console.setFormatter(logging.Formatter(_FORMAT))
  logger.addHandler(console)
 return logger

def launcher_logger():
 return get_logger('launcher','launcher.log')

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
