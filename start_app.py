"""start_app.py: Python側の起動開始点。

アプリ本体(app.py)を読み込む前に実行環境を整え、起動状況を記録する。
Start.vbs(通常起動)と start_app.bat(診断起動)は、どちらも最終的にこの
ファイルを呼ぶ。起動経路を1本に揃えることで、「通常起動では失敗するが
診断起動では再現しない」という状況を避ける。

処理の順序:
  1. ログを初期化し、実行環境(Python・配置場所・PID)を記録する
  2. 起動待機画面をブラウザで開く  ← 早い段階で開く
  3. 既に同じアプリが起動していれば、新たに起動せず終了する
  4. 不足パッケージの導入 / 旧配置のDBファイルの取り込み
  5. Webサーバーを起動する

2を先に行うのは、以降のどの段階で失敗しても利用者の画面には必ず待機画面が
表示され、規定時間後に「起動できません」と確認手順まで案内されるため。
また多重起動時は、待機画面が既存インスタンスを検出して即座にアプリへ
遷移するので、「既存の画面を開く」動作(仕様書2.4)がそのまま実現される。
"""
import _pycache_bootstrap  # 他のimportより前に。必ず1行目のimportにすること

from pathlib import Path
import importlib.util
import subprocess
import sys
import threading
import time
import webbrowser

import launch_guard
from backend import boot_status
from backend.config import APP_NAME, PORT, REQUIRED_PACKAGES, app_url
from backend.logging_setup import launcher_logger, log_environment
from backend.paths import APP_ROOT, configured_path, ensure_local_dirs, is_network_path

# 旧配置(リポジトリ直下 / data フォルダ)に残っているDBファイルの取り込み先。
# 取り込み先に同名ファイルが既にある場合は上書きしない(繰り返し起動しても安全)。
_LEGACY_DB=(
 ('マスタ.sqlite3','db/master.sqlite3'),
 ('測定データ.sqlite3','db/records.sqlite3'),
 ('data/マスタ.sqlite3','db/master.sqlite3'),
 ('data/測定データ.sqlite3','db/records.sqlite3'),
)


def _no_window():
 """pythonw(コンソール非表示)から子プロセスを起動しても黒い画面を出さない。"""
 if sys.platform=='win32':
  return {'creationflags':getattr(subprocess,'CREATE_NO_WINDOW',0)}
 return {}


def open_waiting_screen(log):
 page=APP_ROOT/'loading.html'
 if not page.exists():
  log.error('待機画面 %s が見つかりません。アプリURLを直接開きます',page)
  webbrowser.open(app_url()); return
 log.info('待機画面を開きます: %s',page)
 try:
  if sys.platform=='win32':
   import os
   os.startfile(str(page))               # 既定のブラウザで開く
  else:
   webbrowser.open(page.as_uri())
 except Exception as e:
  log.error('待機画面を開けませんでした: %s',e)


def ensure_packages(log):
 missing=[name for name in REQUIRED_PACKAGES if importlib.util.find_spec(name) is None]
 if not missing:
  log.info('必須パッケージ: 揃っています (%s)',', '.join(REQUIRED_PACKAGES))
  return True
 log.info('必須パッケージ: %s が不足しています。導入を試みます',', '.join(missing))
 try:
  result=subprocess.run(
   [sys.executable,'-m','pip','install','-r',str(APP_ROOT/'requirements.txt')],
   capture_output=True,text=True,**_no_window())
 except Exception as e:
  log.error('必須パッケージ: 導入を実行できませんでした: %s',e); return False
 if result.returncode!=0:
  log.error('必須パッケージ: 導入に失敗しました\n%s',(result.stderr or '').strip()[:2000])
  return False
 log.info('必須パッケージ: 導入しました')
 return True


def adopt_legacy_databases(log):
 """旧バージョンの置き場所に残っているDBファイルを db/ へ取り込む。"""
 (APP_ROOT/'db').mkdir(exist_ok=True)
 for old_name,new_name in _LEGACY_DB:
  old=APP_ROOT/old_name; new=APP_ROOT/new_name
  if old.exists() and not new.exists():
   try:
    old.rename(new)
    log.info('旧DBを取り込みました: %s -> %s',old_name,new_name)
   except Exception as e:
    log.error('旧DBを取り込めませんでした(%s): %s',old_name,e)


def warn_if_shared(log):
 """共有フォルダー配置を検出したら記録する(SQLiteの同時書込は破損し得る)。
    config/local.jsonでrecords_db_pathが上書きされていれば、その実際の
    置き場所を確認する(既定はAPP_ROOT/db/records.sqlite3)。"""
 records=configured_path('records_db_path') or APP_ROOT/'db'/'records.sqlite3'
 if is_network_path(APP_ROOT):
  log.warning('アプリ本体がネットワーク上に配置されています: %s',APP_ROOT)
 if is_network_path(records) and records.exists():
  log.warning('測定データバックアップ(%s)が共有上にあります。複数端末から'
              '同時に使用するとSQLiteが破損する恐れがあります',records)


def main():
 ensure_local_dirs()
 log=launcher_logger()
 started=time.monotonic()
 # 段階表示(boot_status)は待機画面を開く前に1件書いておく。開いた直後の
 # ポーリングで「まだ何も無い」状態を見せないため。
 boot_status.report('env','ログと実行環境を準備しています')
 log_environment(log)

 # 以降どこで失敗しても利用者の画面に状況が出るよう、先に待機画面を開く。
 open_waiting_screen(log)

 boot_status.report('instance',f'ポート {PORT} を確認しています')
 state,info=launch_guard.probe()
 if state==launch_guard.OURS:
  log.info('多重起動: 既に起動しています (バージョン %s)。新たに起動しません',
           (info or {}).get('version','?'))
  log.info('--- 終了 --- (既存インスタンスへ委譲)')
  return 0
 if state==launch_guard.FOREIGN:
  log.error('多重起動: ポート %s を別のアプリが使用しています。起動を中止します',PORT)
  log.info('--- 終了 --- (ポート使用中)')
  return 1
 if state==launch_guard.UNRESPONSIVE:
  # このアプリの前回のプロセスがネットワーク共有I/O等で応答不能に陥って
  # いる可能性がある(別アプリと決め付けて起動を諦めるとFOREIGNと同じ
  # 見た目になり、stop.batも使えば直せることが伝わらない)。ここで自動的に
  # 強制終了はしない(本当に別アプリの可能性がまだ残るため)。対処方法を
  # 明示して起動を中止する。
  log.error('多重起動: ポート %s は使用中ですが応答がありません(WaveLogが重い処理でブロックされている可能性があります)。'
            'stop.bat(python process_manager.py stop)で停止してから再度起動してください',PORT)
  log.info('--- 終了 --- (ポート使用中・応答無し)')
  return 1

 boot_status.report('packages','必要な部品が揃っているか確認しています')
 if not ensure_packages(log):
  boot_status.report('packages','必要な部品を用意できませんでした',failed=True)
  log.error('起動中止: 必須パッケージが揃いませんでした')
  return 1

 boot_status.report('data','データの置き場所を確認しています')
 adopt_legacy_databases(log)
 # 共有配置の確認はネットワーク越しのファイル存在確認を伴い、共有の応答が
 # 遅いと起動そのものが止まる。記録のための警告でしかないので、起動の
 # 直列路から外して裏で確認する(§9.47)。
 threading.Thread(target=warn_if_shared,args=(log,),daemon=True,name='warn-if-shared').start()
 launch_guard.write_instance()
 log.info('起動準備: 完了 (%.2f秒)',time.monotonic()-started)

 try:
  boot_status.report('app','アプリを読み込んでいます')
  import server
  boot_status.report('server',f'ポート {PORT} で待ち受けを開始します')
  server.run()
 except Exception as e:
  log.exception('起動失敗: %s',e)
  return 1
 finally:
  # ウォッチドッグ経由の終了は os._exit() のためここを通らない。その場合
  # instance.json は残るが、起動判定はポートの実応答で行うため支障はない。
  launch_guard.clear_instance()
 log.info('--- 終了 --- (Webサーバーが停止)')
 return 0


if __name__=='__main__':
 sys.exit(main())
