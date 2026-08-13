"""atomic_io.py: 置き換え(os.replace)が拒まれたときに、少し待ってやり直す(§9.108)。

なぜ要るか
------------------------------------------------------------
POSIXの`rename(2)`は、**置き換え先を誰が開いていても成功する**。開いたままの
ファイルはinodeとして生き残り、名前だけが差し替わる。Linuxでこの仕組みを
書いてテストすると、何も起きない。

**Windowsは違う。** `MoveFileEx(..., MOVEFILE_REPLACE_EXISTING)`は、置き換え
先に`FILE_SHARE_DELETE`無しで開かれたハンドルが1つでもあると
`ERROR_ACCESS_DENIED`(WinError 5)で失敗する。そしてSQLiteはWindowsで
`FILE_SHARE_READ|FILE_SHARE_WRITE`しか指定しない(`FILE_SHARE_DELETE`は
付けない)。つまり——

  **こちらが写しを1件読んでいる間、その写しは置き換えられない。**

これは回線の不調ではなく、**通常運転で当たる**。実機のログに出た2件は
どちらもこれだった:

  ・`schedule.sessions.json` … 別のPCが同じJSONを読んでいる最中に置き換えた
  ・`db/cache/SIKALOT.sqlite3` … 自分が読んでいる最中/Box Driveが同期中

同じ理由で`unlink`も拒まれる(削除も「開いている間はできない」)。

何を「一時的」とみなすか
------------------------------------------------------------
待てば直るものだけを再試行する。**恒久的な失敗まで再試行すると、間違いに
気づくのが遅れるだけ**なので、印のはっきりしたものに限る。

  WinError 5    アクセスが拒否されました(開いているハンドルがある)
  WinError 32   別のプロセスが使用中(共有違反)
  WinError 33   別のプロセスがロックしている
  WinError 1224 要求された操作は、ファイルをユーザーマップされた
                セクションが開いている状態では実行できません

POSIX側は`EBUSY`/`ETXTBSY`だけ。`EACCES`は本物の権限の問題であることが
ほとんどなので**再試行しない**(Windowsでは`winerror`が付くので上の表で拾える)。

**根本の対処と併用すること。** 再試行は「掴まれている時間が短い」ときにしか
効かない。長く掴む相手(クラウド同期フォルダ)に対しては、そもそも
**上書きしない置き方**(db_mirror.pyの世代名)か、置き場を実ローカルへ
移すほうが正しい。
"""
from __future__ import annotations

import errno
import os
import random
import threading
import time
from pathlib import Path

from .logging_setup import app_logger

# 待てば直る見込みのあるWindowsのエラー番号。
TRANSIENT_WINERRORS = frozenset({5, 32, 33, 1224})
# POSIX側。EACCESは入れない(本物の権限エラーを隠すため)。
TRANSIENT_ERRNOS = frozenset({errno.EBUSY, errno.ETXTBSY})

# 既定の粘り。長すぎるとリクエストが詰まり、短すぎると意味が無い。
# 読み手が掴んでいる時間は数十〜数百msなので、5秒あれば通常は足りる。
DEFAULT_BUDGET_SEC = 5.0
_FIRST_DELAY_SEC = 0.05
_MAX_DELAY_SEC = 0.5

_stats_lock = threading.Lock()
_stats: dict[str, dict] = {}


def is_transient(exc):
 """待てば直る見込みのある失敗か。"""
 if not isinstance(exc, OSError):
  return False
 win = getattr(exc, 'winerror', None)
 if win is not None:
  return win in TRANSIENT_WINERRORS
 return exc.errno in TRANSIENT_ERRNOS


def _note(label, *, retried=0, failed=False, error=''):
 if not label:
  return
 with _stats_lock:
  s = _stats.setdefault(label, {'calls': 0, 'retried': 0, 'retries': 0,
                                'failed': 0, 'last_error': '', 'last_at': 0.0})
  s['calls'] += 1
  if retried:
   s['retried'] += 1
   s['retries'] += retried
  if failed:
   s['failed'] += 1
  if error:
   s['last_error'] = error
   s['last_at'] = time.time()


def stats():
 """診断用。ラベルごとの再試行・失敗の回数。

 **「たまに」なのか「毎回」なのかを数字で見分けるため**にある。回線の
 揺らぎなら再試行で吸収されて`failed`は増えず、構造的な問題なら`failed`が
 積み上がる。"""
 with _stats_lock:
  return {k: dict(v) for k, v in _stats.items()}


def reset_stats():
 with _stats_lock:
  _stats.clear()


def _sleep_delays(budget_sec):
 """0.05→0.1→0.2→0.4→0.5…と伸ばしながら、予算を使い切るまで待つ。

 少し散らす(jitter)のは、複数のPCが同じJSONを同時に置き換えようとして
 いるとき、揃って再試行して揃って失敗するのを避けるため。"""
 waited = 0.0
 delay = _FIRST_DELAY_SEC
 while waited < budget_sec:
  d = min(delay, _MAX_DELAY_SEC, budget_sec - waited)
  d += random.uniform(0, d * 0.25)
  yield d
  waited += d
  delay *= 2


def replace(src, dst, *, budget_sec=DEFAULT_BUDGET_SEC, label=''):
 """`os.replace(src, dst)`。一時的な失敗なら予算いっぱいまでやり直す。

 成功したら「何回目で通ったか」(0=1回目)を返す。予算を使い切っても
 だめなら**最後の例外をそのまま送出する**——握り潰すと、呼び出し側が
 「置き換えたつもり」で先へ進んでしまう。"""
 src = os.fspath(src)
 dst = os.fspath(dst)
 attempt = 0
 for delay in _sleep_delays(budget_sec):
  try:
   os.replace(src, dst)
   _note(label, retried=attempt)
   if attempt:
    app_logger().info('%s: %d回目で置き換えられました(%s)', label or dst, attempt + 1, dst)
   return attempt
  except OSError as e:
   if not is_transient(e):
    _note(label, retried=attempt, failed=True, error=str(e))
    raise
   attempt += 1
  time.sleep(delay)
 # 予算切れ。最後にもう1回だけ試す(待ち終わった直後に空いていることがある)。
 try:
  os.replace(src, dst)
  _note(label, retried=attempt)
  return attempt
 except OSError as e:
  _note(label, retried=attempt, failed=True, error=str(e))
  raise


def unlink(path, *, budget_sec=DEFAULT_BUDGET_SEC, label='', missing_ok=True):
 """`Path.unlink()`。置き換えと同じ理由で、削除も開いている間は拒まれる。

 戻り値: 消せたらTrue。消せなくてもFalseを返すだけで**例外は投げない**——
 呼び出し側はどれも後始末で、消せないこと自体で処理を止める意味が無い
 (次の周回でもう一度試せばよい)。"""
 p = Path(path)
 attempt = 0
 for delay in _sleep_delays(budget_sec):
  try:
   p.unlink()
   _note(label, retried=attempt)
   return True
  except FileNotFoundError:
   return bool(missing_ok)
  except OSError as e:
   if not is_transient(e):
    _note(label, retried=attempt, failed=True, error=str(e))
    return False
   attempt += 1
  time.sleep(delay)
 try:
  p.unlink()
  _note(label, retried=attempt)
  return True
 except FileNotFoundError:
  return bool(missing_ok)
 except OSError as e:
  _note(label, retried=attempt, failed=True, error=str(e))
  return False


# ------------------------------------------------------------------
# クラウド同期フォルダの見分け
# ------------------------------------------------------------------
# 実機の写しの置き場は C:\boxdrive\Box\...\WaveLog_v1\db\cache だった。
# Box Drive・OneDrive等は同期のあいだファイルを掴むため、**掴む時間が
# 桁違いに長い**(数秒〜数分)。再試行では吸収しきれないので、置き場を
# 実ローカルへ移してもらうしかない。名前で見分けて案内する。
_CLOUD_MARKERS = (
 ('boxdrive', 'Box Drive'), ('/box/', 'Box'), ('\\box\\', 'Box'),
 ('onedrive', 'OneDrive'), ('dropbox', 'Dropbox'),
 ('google drive', 'Google ドライブ'), ('googledrive', 'Google ドライブ'),
 ('icloud', 'iCloud'), ('nextcloud', 'Nextcloud'),
)


def cloud_sync_hint(path):
 """そのパスがクラウド同期フォルダの中に見えるなら、その名前を返す。

 見分けは名前だけなので**確証ではない**。だから止めるのではなく、
 「置き換えに失敗したときの心当たり」として添えるに留める。"""
 s = str(path or '').lower()
 if not s:
  return ''
 for marker, name in _CLOUD_MARKERS:
  if marker in s:
   return name
 return ''
