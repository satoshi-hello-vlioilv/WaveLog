"""schedule_watch.py: 共有スケジュールの見張り(§9.188)

共有(Box等)に1つだけ置いた schedule.sqlite3 を、**変わったときだけ**手元へ
写す背景スレッド。読み書きの決まりは`schedule_sync.py`が持っており、
ここが持つのは「いつ確かめるか」だけ。

なぜ要るか: 以前はGETのたびに`fetch_snapshot()`を呼んでいた。1画面を開く
だけで共有ファイル全体の`backup()`が何度も走り、共有越しでは1回が数百ms
かかる。しかもそのあいだ共有ファイルを掴むので、他の端末の書込と競合する。

決まりごと(利用者の指示):
 ・**更新チェックはバックグラウンド**で行い、変化を見つけたら取り込む
 ・**1度取り込んだら休む**(既定30秒)。更新が続いているときに毎回写すと、
   こちらが共有を掴み続けて全員が遅くなる
 ・間隔・休みはマスタ(パス設定)で変えられる。**再起動は要らない**
   (`path_config_value`は呼ぶたびに読み直す)

**画面は待たせない。** 読みは手元の写しをそのまま使い、見張りが遅れて
いても止まらない(fail-open)。見張りが止まっているときは、読みが自分で
写す従来の動きへ落ちる(`_snapshot_is_fresh()`が偽になる)。

停止は`db_mirror`と同じで**用意しない**——プロセスと寿命を同じにする
デーモンスレッド1本だけなので、終わらせる仕掛けを持つほうが事故になる。
"""
import threading
import time

from . import schedule_sync
from .logging_setup import app_logger

_thread=None
_wake=threading.Event()
_start_lock=threading.Lock()


def _loop():
 # 起動直後は他の初期化と重ならないよう少し待つ(db_mirrorと同じ作法)。
 _wake.wait(3)
 while True:
  wait=schedule_sync.watch_interval_sec()
  try:
   result=schedule_watch_once()
   if result=='paused':
    # 休み中。**休みが明けるまで待つ**(細かく起きても何もしない)。
    st=schedule_sync.watch_status()
    wait=max(1,int(st.get('pausedForSec') or wait))
   elif result=='fetched':
    # 取り込んだ直後は休む(schedule_syncが休みの終わりを持っている)。
    wait=max(1,schedule_sync.watch_pause_sec() or wait)
   elif result=='off':
    # 見張らない設定。**やめずに間隔で見に来る**——設定は再起動なしで
    # 変わるので、ここで抜けると戻したときに効かない。
    wait=max(30,wait)
  except Exception as e:
   # 見張りが転んでも画面は動く。次の周回で再挑戦する。
   app_logger().warning('共有スケジュールの見張りで例外: %s',e)
  _wake.clear()
  _wake.wait(wait)


def schedule_watch_once():
 """1回ぶん。テストと「今すぐ取り込む」から直接呼べるようにしてある。"""
 return schedule_sync.watch_check()


def start():
 global _thread
 with _start_lock:
  if _thread and _thread.is_alive():return
  _thread=threading.Thread(target=_loop,name='schedule-watch',daemon=True)
  _thread.start()
  schedule_sync._watch['running']=True


def wake():
 """次の周回をすぐ始めさせる(書込のあと・利用者が「今すぐ」を押したとき)。"""
 _wake.set()
