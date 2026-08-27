"""start_app.py: Python側の起動開始点。

アプリ本体(app.py)を読み込む前に実行環境を整え、起動状況を記録する。
Start.vbs(通常起動)と start_app.bat(診断起動)は、どちらも最終的にこの
ファイルを呼ぶ。起動経路を1本に揃えることで、「通常起動では失敗するが
診断起動では再現しない」という状況を避ける。

処理の順序:
  1. ログを初期化し、実行環境(Python・配置場所・PID)を記録する
  2. 起動待機画面をブラウザで開く  ← 早い段階で開く
  3. 既に同じアプリが起動していれば、新たに起動せず終了する
  4. **確認済みの刻印があれば飛ばす**(§9.225)。無い/合わないときだけ、
     不足パッケージの導入・バイトコードの事前コンパイル・旧配置DBの
     取り込みをその場で行う
  5. Webサーバーを起動する

4の確認は`setup.bat`(→`setup_app.py`)が受け持ち、済むと端末ごとの刻印
(`%LOCALAPPDATA%\\WaveLog\\runtime\\ready.json`)が残る。**刻印は速さの
ための門であって正しさの門ではない**ので、食い違ったときは止めずに
その場で同じ確認をやり直す(利用者の指示①)。実処理は
`backend/launcher/setup_check.py`の1箇所で、setup.batと共有する。

2を先に行うのは、以降のどの段階で失敗しても利用者の画面には必ず待機画面が
表示され、規定時間後に「起動できません」と確認手順まで案内されるため。
また多重起動時は、待機画面が既存インスタンスを検出して即座にアプリへ
遷移するので、「既存の画面を開く」動作(仕様書2.4)がそのまま実現される。
"""
import _pycache_bootstrap  # 他のimportより前に。必ず1行目のimportにすること

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

from backend.launcher import guard as launch_guard
from backend.launcher import ready, setup_check
from backend import boot_status
from backend.config import PORT, app_url
from backend.logging_setup import launcher_logger, log_environment
from backend.paths import APP_ROOT, configured_path, ensure_local_dirs, is_network_path


# ============================================================================
# 起動待機画面(モーダル)を「必ず・手元から・継ぎ目なく」開く
# ----------------------------------------------------------------------------
# 以前ここは3つの弱点を持っていた(別端末で「モーダルが出ずエラー画面。
# loading.html を手で開くと起動する」の原因):
#   ① `page.exists()` を本体(APP_ROOT=Box)に対して呼んでいた。共有・クラウド
#      越しの `Path.exists()` は WinError 59(予期しないネットワークエラー)等を
#      **False ではなく例外で**返すことがあり(§9.108/DB章と同じ理由)、待機画面
#      を開く処理そのものが落ちていた。
#   ② 最後のフォールバックが `webbrowser.open(app_url())`——サーバーがまだ
#      listen していない時点で `http://127.0.0.1` を開くため、ブラウザは
#      **接続拒否のエラー画面**を出す(まさに「エラーのような画面」)。数秒後に
#      サーバーが立ち上がるので、利用者が手で loading.html を開くと起動する。
#   ③ Box 上の loading.html が未ハイドレート(オンライン専用)だと写しも作れず、
#      開ける待機画面が1つも無くなる。
#
# 方針(§9.225「開けないより遅いほうがまし」を、別端末でも成立させる):
#   1. 置き場所の特定・存在確認は**例外を送出しない**(`_exists_safe`)。
#   2. まず本来の写し(`setup_check`。意匠の唯一の出どころ)を使う/作る。
#   3. Box が届かず写しも作れないときだけ、**手元へ書き出す組み込みの簡易待機
#      画面**を最後の砦にする。これは loading.html と同じ深い紺・同じ
#      `/api/ready.js` ポーリングで、サーバーが立ったら本体へ遷移する。
#      →**サーバー未起動の http:// を直接開かない**ので、白い接続拒否画面が
#        出ない(①の失敗経路も継ぎ目なく直る)。
#   4. どの経路でも開くのは file:// のローカルページだけ。
# 固定の観点は tests/test_faststart.py(刻印を消して「起動できること」まで見る)。
# ============================================================================

# 組み込みの簡易待機画面(最後の砦)。**意匠の本体は loading.html 側**であり、
# これは Box が届かない初回起動で「開ける画面が1つも無い」を避けるためだけの
# 最小版。深い紺(#0d2029)は index.html / loading.html と同じ起点で、遷移時に
# 白く光らせない(§9.92)。{PORT}/{APP_URL} は起動時に差し込む。
_EMERGENCY_WAITING_HTML = r"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>測定伝送システム を起動しています</title>
<link rel="preconnect" href="http://127.0.0.1:__PORT__">
<style>
 html,body{height:100%;margin:0}
 body{display:flex;align-items:center;justify-content:center;color:#eaf3f5;
  font-family:"Segoe UI","Meiryo",system-ui,sans-serif;font-size:14px;
  background:linear-gradient(158deg,#0d2029 0%,#12313a 46%,#0b1a21 100%);
  background-attachment:fixed}
 .card{width:min(92vw,420px);padding:28px 30px;border-radius:18px;text-align:center;
  background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.115);
  box-shadow:0 18px 44px rgba(0,0,0,.30)}
 h1{margin:0 0 4px;font-size:16px;font-weight:650}
 .sub{margin:0 0 20px;font-size:11px;letter-spacing:.22em;color:#6f8c95}
 .ring{width:38px;height:38px;margin:6px auto 16px;border-radius:50%;
  border:3px solid rgba(46,201,192,.20);border-top-color:#2ec9c0;
  animation:spin 1s linear infinite}
 @keyframes spin{to{transform:rotate(360deg)}}
 .msg{font-size:13px;color:#9fb9c0}
 .err{display:none;margin-top:14px;font-size:12.5px;color:#ff6b6b}
 body.failed .ring{display:none}
 body.failed .err{display:block}
 @media (prefers-reduced-motion:reduce){.ring{animation:none}}
</style></head><body>
<div class="card">
 <h1>測定伝送システム</h1><p class="sub">STARTING UP</p>
 <div class="ring"></div>
 <div class="msg" id="msg">サーバーの準備を待っています…</div>
 <div class="err">時間内に起動できませんでした。start_app.bat を実行し、黒い画面の内容を確認してください。</div>
</div>
<script>
"use strict";
(function(){
 var PORT=__PORT__,APP_ID="wavelog",APP_URL="__APP_URL__",started=Date.now(),TIMEOUT=90000,go=true;
 window.wavelogReady=function(info){
  if(!go||!info||info.app!==APP_ID||!info.ready)return; // 別アプリが同じポートなら無視して待つ
  go=false; location.replace(info.url||APP_URL);
 };
 function probe(){
  if(!go)return;
  var s=document.createElement("script");
  s.src="http://127.0.0.1:"+PORT+"/api/ready.js?cb=wavelogReady&t="+Date.now();
  s.onerror=s.onload=function(){s.remove()};
  document.head.appendChild(s);
  if(Date.now()-started>TIMEOUT){go=false;document.body.className="failed";return;}
  setTimeout(probe,(Date.now()-started<5000)?150:500);
 }
 probe();
})();
</script></body></html>
"""


def _exists_safe(path):
 """`Path.exists()` を**例外を送出せず**に確かめる。共有・クラウド(Box)越しの
    存在確認は WinError 59 等を送出し得るため、待機画面を開く処理を巻き添えに
    しない。確かめられない場合は False を返す——ここでの帰結は「作り直す」で
    あって「無いから諦める」ではないので、不明を False として安全(§9.108の
    path_exists_safe とは用途が違い、Noneを区別する必要がない)。"""
 if path is None:
  return False
 try:
  return Path(path).exists()
 except Exception:
  return False


def _local_runtime_dir():
 """手元(ユーザー別ローカル)の runtime 置き場。`_pycache_bootstrap` と同じ
    基準で `%LOCALAPPDATA%\\WaveLog\\runtime` を解決する。`ensure_local_dirs()`
    が main() 冒頭で作成済みの想定だが、無ければここでも作る。"""
 base=os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_DATA_HOME')
 if not base:
  base=os.path.join(os.path.expanduser('~'),'.local','share')
 d=Path(base)/'WaveLog'/'runtime'
 try:
  d.mkdir(parents=True,exist_ok=True)
 except Exception:
  pass
 return d


def _write_emergency_waiting_page(log,target):
 """組み込みの簡易待機画面を**必ず手元(ローカル)へ**書き出す。既に手元に
    何か開ける画面があるときは呼ばない(上書きしない=開いている写しを掴んで
    WinError 5 にしない、§9.108)。書き出せたらそのパスを、失敗したら None。
    候補は「渡された置き場 → 確実に手元の runtime」の順で試す——渡された置き場が
    共有/Box を指していると書けないため、手元へ必ず1つ用意できるようにする。"""
 html=(_EMERGENCY_WAITING_HTML
       .replace('__PORT__',str(PORT))
       .replace('__APP_URL__',app_url()))
 candidates=[]
 if target is not None:
  candidates.append(Path(target))
 local=_local_runtime_dir()/'loading.html'
 if not candidates or candidates[0]!=local:
  candidates.append(local)
 last_err=None
 for dest in candidates:
  try:
   dest.parent.mkdir(parents=True,exist_ok=True)
   # 新規パスへの書き出し(掴んでいる者はいない)。念のため一時ファイル→置換で。
   tmp=dest.with_suffix(dest.suffix+'.tmp')
   tmp.write_text(html,encoding='utf-8')
   os.replace(str(tmp),str(dest))
   log.info('待機画面: 本来の写しを用意できなかったため、組み込みの簡易画面を手元へ書き出しました: %s',dest)
   return dest
  except Exception as e:
   last_err=e
   continue
 log.error('待機画面: 組み込みの簡易画面も書き出せませんでした: %s',last_err)
 return None


def _ensure_local_waiting_page(log):
 """**手元から開ける待機画面のパスを必ず1つ返す**(用意できなければ None)。
    ① 既にある手元の写し → ② 本来の写しを作る(setup_check、意匠の唯一の
    出どころ) → ③ 組み込みの簡易画面、の順に降りる。どの存在確認も例外を
    送出しない。Box(APP_ROOT)の loading.html は**存在確認せず**、届かない
    前提で扱う(届くなら②の写し作成が成功する)。"""
 # ① setup_check が指す手元の写しが既にあるか
 local=None
 try:
  local=setup_check.waiting_page()
 except Exception as e:
  log.warning('待機画面: 写しの置き場所を特定できませんでした(%s)',e)
 if _exists_safe(local):
  return local
 # ② 本来の loading.html から手元へ写す(Box が届くならここで成功する)
 try:
  made=setup_check.copy_waiting_page()
  if _exists_safe(made):
   return made
 except Exception as e:
  log.warning('待機画面: 本来の写しを作成できませんでした(%s)。組み込みの簡易画面へ切り替えます',e)
 # ③ Box が届かない/未ハイドレート。手元へ簡易画面を書き出す
 return _write_emergency_waiting_page(log,local)


def open_waiting_screen(log):
 """起動待機画面(モーダル)を開く。**必ず手元の file:// ページを開き、
    サーバー未起動の http:// は絶対に開かない**(接続拒否の白い画面を出さない
    ため)。別端末で開けなかった過去の不具合(冒頭の解説)を根本から断つ。"""
 page=_ensure_local_waiting_page(log)
 if page is None:
  # 手元に開ける画面を1つも用意できなかった(ローカル書き出しすら失敗)。
  # ここで app_url() を直接開かないこと——サーバーはまだ listen しておらず、
  # 接続拒否の画面を見せるだけになる。サーバーは後段で起動するので、利用者は
  # 起動後にブラウザから開ける。自動では何も開かず、理由をログに残す。
  log.error('待機画面: 手元に開ける画面を用意できませんでした。ブラウザは自動で開きません('
            'サーバー起動後に %s を開いてください)',app_url())
  return
 log.info('待機画面を開きます: %s',page)
 uri=Path(page).as_uri()
 # 既定ブラウザで file:// を開く。失敗(.html の関連付け無し・権限)しても
 # 握り潰さず、webbrowser 経由へ切り替える(「1つもブラウザが開かない」を残さない)。
 if sys.platform=='win32':
  try:
   os.startfile(str(page))               # 既定のブラウザで開く
   return
  except Exception as e:
   log.warning('待機画面: 既定の方法で開けませんでした(%s)。別の方法を試します',e)
 try:
  webbrowser.open(uri)
 except Exception as e:
  log.error('待機画面を開けませんでした: %s',e)


def run_full_check(log,why):
 """刻印が無い/合わないときの完全な確認(§9.225)。**setup.batと同じ処理を
    同じ場所から呼ぶ**——2つ持つと「setup.batでは通るのに起動では失敗する」
    が作れる。"""
 log.info('起動前の確認: %s。この起動でまとめて確かめます（setup.batを実行しておくと次回から速くなります）',
          ' / '.join(why) if why else '刻印がありません')
 def say(message,bad=False):
  (log.warning if bad else log.info)('起動前の確認: %s',message)
 ok,_reason=setup_check.run(say)
 return ok


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

 # 確認済みの刻印があれば、ここは飛ばす(§9.225)。**刻印は速さのための門で
 # あって正しさの門ではない**——バイトコードが古いかどうかはPython自身が
 # 判定するので、飛ばして困るのは「速くならない」ことだけ。
 why=ready.mismatch()
 if why:
  boot_status.report('packages','必要な部品が揃っているか確認しています')
  if not run_full_check(log,why):
   boot_status.report('packages','必要な部品を用意できませんでした',failed=True)
   log.error('起動中止: 必須パッケージが揃いませんでした')
   return 1
 else:
  boot_status.report('packages','確認済みです（setup.batで確認しました）')
  log.info('起動前の確認: 済んでいます。飛ばします')

 boot_status.report('data','データの置き場所を確認しています')
 # 共有配置の確認はネットワーク越しのファイル存在確認を伴い、共有の応答が
 # 遅いと起動そのものが止まる。記録のための警告でしかないので、起動の
 # 直列路から外して裏で確認する(§9.47)。
 threading.Thread(target=warn_if_shared,args=(log,),daemon=True,name='warn-if-shared').start()
 launch_guard.write_instance()
 log.info('起動準備: 完了 (%.2f秒)',time.monotonic()-started)

 try:
  boot_status.report('app','アプリを読み込んでいます')
  try:
   from backend.launcher import server
  except ImportError as e:
   # 刻印はあるのに部品が消えている(誰かがアンインストールした・別の
   # Pythonを指している)。**刻印を信じ切って落ちない**——その場で確認し直し、
   # 1回だけやり直す(利用者の指示①の自己修復)。
   log.warning('アプリを読み込めませんでした(%s)。確認をやり直します',e)
   ready.clear()
   if not run_full_check(log,['読み込みに失敗しました']):
    boot_status.report('app','アプリを読み込めませんでした',failed=True)
    log.error('起動中止: 確認をやり直しても読み込めませんでした')
    return 1
   from backend.launcher import server
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
