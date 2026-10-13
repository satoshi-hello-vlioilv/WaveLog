"""db_mirror.py: 共有上の読み取り専用DBを、手元へ写してから読む(§9.89)。

なぜ要るか
------------------------------------------------------------
仕掛・品質データの .sqlite3 は**別のPCの別のアプリが更新している**。
その更新と読み取りが重なると、正しく読めないことがある。

理由は2つある。

1. **SQLiteのロックはネットワーク共有では当てにならない。**
   SQLite自身が「ネットワークファイルシステム上での使用は避けること」と
   明言している。SMB越しではロックの取得・解放がファイルシステム任せに
   なり、書き手と読み手が互いを認識できない。
2. **書き手がファイルごと置き換えている場合、ロック以前の問題になる。**
   途中まで書かれたファイルをこちらが読むと、中途半端な状態を読む。

したがって「読む側で頑張る」のではなく、**読む対象を共有から切り離す**。
共有のファイルを手元へ写し、**写しが正しいと確かめてから**切り替えて、
画面はいつも手元の写しだけを読む。これで:

  ・読み取りが共有の更新を妨げない(共有を開きっぱなしにしない)
  ・共有が一時的に不調でも、直前の写しで画面は動き続ける
  ・書き手の更新中に読んでも、壊れた状態が画面へ出ない

写し方は「共有の写し方の約束」(docs/SHARED_READ.md・§9.582)
------------------------------------------------------------
Quality-Analysis・DataRelay（ビュワー）と**同じ文の約束**に従う（3つのリポジトリに同じ文を置く）。
共有の元は DataRelay が丸ごと置き換えて出す。Windowsでは、こちらが開いている一瞬に置き換えが
当たると書き手が待たされ（最大20秒）、待ちきれなければ15分後まで保留になる。そこで:

1. 写す前に書き手の作業中の印（`.<名前>.*.incoming`・`-journal`・`-wal`）を見る。あれば写さない（R3）
2. SQLiteとしては開かず、**置き換えを許す開き方**（`atomic_io.open_shared_read`）で、休まず丸ごと
   1回で写してすぐ閉じる（R4。以前はSQLiteのバックアップAPIで、SQLiteとして開いて少しずつ写していた）
3. 写し終えたら大きさ・更新時刻と印をもう一度見る。違えば捨てる（R5）
4. **採用する前に必ず検査する**(`PRAGMA quick_check`)。壊れていたら捨てて、前の写しを使い続ける（R6）。
   **採用はos.replace()の1手**なので、画面が中途半端な写しを開くことはない。
1・3で見送ったときは`RETRY_AFTER_BUSY_SEC`だけ空けて確かめ直す。

**写しは世代名で置く**(§9.108)
------------------------------------------------------------
以前は`db/cache/<キー>.sqlite3`という決まった名前へ毎回上書きしていた。
Linuxではこれで何も起きないが、**Windowsでは置き換え先が開かれていると
置き換えられない**(`MoveFileEx`が`ERROR_ACCESS_DENIED`。SQLiteは
`FILE_SHARE_DELETE`を付けずに開くため、**こちらが1件読んでいる間その写しは
置き換えられない**)。実機で毎分のように失敗していた:

    SIKALOT の写しを置き換えられませんでした: [WinError 5] アクセスが
    拒否されました。: '...\\db\\cache\\SIKALOT.sqlite3.tmp'
      -> '...\\db\\cache\\SIKALOT.sqlite3'

**上書きしなければ起きない。** 写しは`<キー>.g<世代>.sqlite3`という
**毎回新しい名前**で作り、台帳(`_mirror.json`)の`file`が今読むべき世代を
指す。読み手は開いた世代を最後まで読み切れ、書き手は誰も開いていない
新しい名前へ書くので、両者がぶつからない。古い世代は**消せたときに消す**
(消せなくても次の周回でまた試す。消せないのは誰かが読んでいるときだけで、
放っておけばいずれ消える)。

置き換えのポリシー
------------------------------------------------------------
・写す判断は元ファイルの更新時刻とサイズで行う(変わっていなければ写さない)。
  **「再読込」も同じ**（R2）——今すぐ確かめるだけで、変わっていない元は写し直さない。変わっていない元を
  写しても中身は同じで、共有を開く回数だけが端末の台数に比例して増え、置き換えとぶつかる見込みを上げる。
・**この判断は背景スレッドの中だけで行う**。画面のリクエストの中で共有へ
  stat を掛けない(CLAUDE.md「共有DBを開く前にPath.exists()/stat()を
  置かないこと」。共有が不調なとき、確認の1行が唯一の失敗原因になる)。
・**共有を直接読まない**（R8・§9.582。以前は写しが無いと共有を直接読んでいた）。写しがまだ無いときは
  `NotCopiedYet`で「まだ写せていません（理由）」と言い、画面は写し終えたら読み直す。背景の係が
  動いていない呼び出し（網・単発のスクリプト）だけは、その場で1回、同じ作法で写してから読む。
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path

from . import atomic_io
from .logging_setup import app_logger
from .quiet import quiet

# 写しの置き場。db/cache/<キー>.sqlite3
_CACHE_DIRNAME = 'cache'
# 元ファイルの更新時刻・サイズを覚えておく台帳(写す必要があるかの判断に使う)。
_SIGNATURE_FILE = '_mirror.json'

# 既定の写し直し間隔。短くしても共有への負荷は「statを1回」なので軽い。
DEFAULT_INTERVAL_SEC = 60
MIN_INTERVAL_SEC = 10
# 従っている「共有の写し方の約束」の版（docs/SHARED_READ.md の題。Quality-Analysis・DataRelay と同じ文）。
CONTRACT_VERSION = 1
# 書き手が作業中・写す間に元が変わったときは、少し空けて確かめ直す（約束の R3・R5）。
RETRY_AFTER_BUSY_SEC = 5
# 休まず一気に写す（開いている時間を短くする・R4）。
COPY_CHUNK = 4 * 1024 * 1024


class NotCopiedYet(RuntimeError):
 """共有の元を、まだ手元へ写せていない（共有は直接読まない・R8）。文はそのまま画面へ出す。"""

_lock = threading.RLock()
_state: dict[str, dict] = {}      # キー -> 直近の結果(画面へ出す診断用)
_thread = None
_wake = threading.Event()
# **写し直しは1本ずつ**（§9.463）。背景の周回と「再読込」（要求の中で待つ）が
# 同時に走ると、同じ世代番号・同じ`.tmp`へ2本が書き、片方が相手の書きかけを
# 消したり検査に落ちたりする（実測: 2本並べて20回中5〜13回が失敗か古いまま）。
_refresh_lock = threading.Lock()
# 起動して最初の周回が済んだか（§9.463）。済むまでは読む側が待つ——前回の起動の
# 写しを出してしまうと、利用者は「起動したのに古い」を見る（実測: 起動後3.0秒）。
_first = threading.Event()
FIRST_WAIT_SEC = 30
# 届かなかったので早めに取り直す時刻（§9.495）。「再読込」（要求の中）で届かなかったときも、
# 背景の周回がこれを見て早める。
_retry_at = 0.0


# ------------------------------------------------------------------
# 置き場所
# ------------------------------------------------------------------
def cache_dir():
 """写しの置き場。**db/ とは限らない**(§9.109)。

 `db_dir`が共有・クラウド同期フォルダーの上だと、Windowsでは置き換えを
 拒まれて写しが更新できなくなる(§9.108)。その場合だけ`paths.work_dir()`が
 ユーザー別のローカル領域を返すので、こちらは黙ってそれに従う
 (利用者に設定を求めない)。"""
 from . import paths
 return Path(paths.work_dir()) / _CACHE_DIRNAME


def _former_cache_dir():
 """手元へ逃がす前に使っていた置き場(逃がしていなければNone)。"""
 from . import paths
 from .db_access import DB_DIR
 if not paths.work_dir_relocated():
  return None
 return Path(DB_DIR) / _CACHE_DIRNAME


def sweep_former_cache():
 """前の置き場に残った**自分の生成物だけ**を片付ける。

 写しは作り直せるので運ぶ必要が無い(運ぶほうが遅く、しかも運ぶ先が
 掴まれていたら失敗する)。**消せなくてよい**——共有やクラウドの上なので
 消せないことがあるし、消せなくても実害は「置きっぱなし」だけ。
 **自分が作った名前しか触らない**こと(利用者のファイルを消さない)。"""
 old = _former_cache_dir()
 if old is None:
  return 0
 try:
  if not old.is_dir() or old.resolve() == cache_dir().resolve():
   return 0
  victims = [p for p in old.iterdir()
             if p.is_file() and (p.name == _SIGNATURE_FILE
                                 or p.suffix == '.sqlite3'
                                 or p.name.endswith('.sqlite3.tmp'))]
 except OSError:
  return 0
 gone = 0
 for p in victims:
  if atomic_io.unlink(p, budget_sec=0.2, label='mirror.former'):
   gone += 1
 if gone:
  app_logger().info('前の置き場に残っていた写しを%d件片付けました(%s)', gone, old)
 return gone


def _safe_key(key):
 return ''.join(ch if (ch.isalnum() or ch in '-_') else '_' for ch in str(key or 'db'))


def _generation_path(key, gen):
 """世代付きの写しの置き場所。**毎回新しい名前**なので上書きが起きない。"""
 return cache_dir() / f'{_safe_key(key)}.g{int(gen)}.sqlite3'


def _legacy_path(key):
 """世代を導入する前の決まった名前。既にある端末のために読むだけ読む。"""
 return cache_dir() / f'{_safe_key(key)}.sqlite3'


def mirror_path(key):
 """そのデータソースの**今の**写しの置き場所。

 台帳が世代を指していればその世代、まだ無ければ旧来の決まった名前。"""
 entry = _entry(key)
 name = (entry or {}).get('file')
 if name:
  return cache_dir() / str(name)
 return _legacy_path(key)


def _signature_path():
 return cache_dir() / _SIGNATURE_FILE


def _load_ledger():
 try:
  data = json.loads(_signature_path().read_text(encoding='utf-8'))
  return data if isinstance(data, dict) else {}
 except Exception as _e:
  quiet('保存された値を読めない（既定で続ける）',_e)
  return {}


def _entry(key):
 """台帳の1件を、旧い形(印だけの平らな辞書)も含めて読む。

 **古い台帳をそのまま読めること**が要点——読めないと、世代を入れた版へ
 上げた瞬間に全データソースを写し直すことになる(共有越しに数十MB)。"""
 raw = _load_ledger().get(key)
 if not isinstance(raw, dict):
  return None
 if 'signature' in raw:
  return raw
 # 旧い形: {'source':..,'size':..,'mtime_ns':..} がそのまま入っていた。
 return {'signature': raw, 'file': _legacy_path(key).name}


def _signature_of(key):
 return (_entry(key) or {}).get('signature')


def _save_entry(key, signature, filename):
 """台帳を書き換える。**台帳自体も一時ファイル経由で置き換える**——
 直接書くと、読み手が書きかけのJSONを読んで「写しが無い」と判断し、
 その1回だけ共有を直接読みに行く(共有が不調だと画面が固まる)。"""
 led = _load_ledger()
 led[key] = {'signature': signature, 'file': str(filename)}
 try:
  cache_dir().mkdir(parents=True, exist_ok=True)
  path = _signature_path()
  tmp = path.with_suffix('.json.tmp')
  tmp.write_text(json.dumps(led, ensure_ascii=False, indent=1), encoding='utf-8')
  atomic_io.replace(tmp, path, label='mirror.ledger')
 except Exception as e:
  app_logger().warning('写しの台帳を書けませんでした: %s', e)


# 元ファイルの**一瞬の不在は待って取り直す**（§9.495、利用者の報告「仕掛情報の最新版が取れない」）。
# 元は別のアプリがこまめに書き直している（実機の元は 12:45 に書き換わり、12:45:25 に写せていた）。
# 書き直しの最中は Windows でファイルが一瞬「無い／アクセスが拒否される」ので、1回の stat で
# 「届かない」と決めると、押した「再読込」がちょうどそこへ当たって外れる。合計2.5秒まで待つ。
STAT_RETRY_SEC = (0.3, 0.7, 1.5)
# 届かなかった周回のあとは**通常の間隔を待たずに**取り直す（§9.495）。
RETRY_AFTER_UNREACHABLE_SEC = 10


def _os_error_text(e):
 """OSの答えを1行で（`WinError 2 指定されたファイルが見つかりません。`）。"""
 if e is None:
  return ''
 win = getattr(e, 'winerror', None)
 code = f'WinError {win}' if win else (f'Errno {e.errno}' if getattr(e, 'errno', None) else '')
 msg = getattr(e, 'strerror', None) or str(e)
 return f'{code} {msg}'.strip()


def _known_good(key, remote):
 """待って取り直す値打ちがあるか——**この元がこのプロセスで前に届いていた**とき（§9.495の追補）。
 待つのは写しの錠を持ったままなので、一度も届いていない元・続けて届かない元で毎回2.5秒待つと、
 起動の最初の周回（済むまで一覧が開かない）が 2.5秒×件数 遅れる。一瞬の不在（書き直しの最中）は
 「前は届いていた元」に起きることなので、それだけを待つ。一度も届いていない元は早めの周回が拾う。"""
 with _lock:
  prev = _state.get(key)
 return bool(prev) and prev.get('remote') == str(remote) and not prev.get('unreachable')


def _remote_stat(remote, retry=True):
 """元ファイルの「変わったか」を見分ける印と、取れなかった理由。 -> (印 or None, 理由)

 **共有へ触るのはここだけ**。取れなければ`STAT_RETRY_SEC`だけ待って取り直す（`retry`が真のとき）。"""
 err = None
 for wait in ((0,) + STAT_RETRY_SEC if retry else (0,)):
  if wait:
   time.sleep(wait)
  try:
   st = os.stat(remote)
   # **元のパスも印に含める**。パス設定を変えた/検証用へ差し替えたときに、
   # 前の元ファイルから作った写しをそのまま読み続けてしまうため
   # (キーは同じでも中身は別物)。
   return {'source': str(remote), 'size': st.st_size, 'mtime_ns': st.st_mtime_ns}, ''
  except OSError as e:
   err = e
 return None, _os_error_text(err)


def _unreachable(key, remote, result, head, err):
 """届かなかったことを、**どの元へ・OSが何と答えたか**まで残す（§9.495）。
 以前は`debug`でしか書かず、実機のログから原因を絞れなかった。同じ理由が続くあいだは
 ログを重ねない（60秒ごとに同じ行が積もると、本当に見たい行が埋もれる）。
 **続けて届かない回数**（`fails`）も持つ——早めに取り直すのは届かなくなった最初の1回だけ（§9.495の追補）。"""
 with _lock:
  prev = _state.get(key) or {}
 same = bool(prev.get('unreachable')) and prev.get('remote') == str(remote)
 result['fails'] = (int(prev.get('fails') or 1) + 1) if same else 1
 result['reason'] = f'{head}（{Path(remote).name}: {err or "理由が分かりません"}）'
 # **次に何が起きるかも言う**（押し直すかどうかを推測させない）。
 if update_mode() == 'auto':
  result['reason'] += (f'。{RETRY_AFTER_UNREACHABLE_SEC}秒後に自動でもう一度取りに行きます' if result['fails'] == 1
                       else f'。{interval_sec()}秒ごとに確かめています')
 result['unreachable'] = True
 result['error'] = err
 if not (same and prev.get('error') == err):
  app_logger().warning('%s: %s — 元: %s', key, result['reason'], remote)
 if result['fails'] == 1:
  _note_retry()


def _note_retry():
 """次の周回を早める（自動のときだけ・§9.495）。"""
 global _retry_at
 if update_mode() == 'auto':
  _retry_at = time.time() + RETRY_AFTER_UNREACHABLE_SEC


def next_wait_sec(results=None):
 """次の周回まで何秒待つか。**届かなくなったばかりの元が1つでもあれば早める**（§9.495）。
 早めるのは自動のときだけ・届かなくなった最初の1回だけ（§9.495の追補）——手動は意図して止めており、
 続けて届かない元（消えた・設定だけ残った）を10秒ごとに見に行き続けても写しの錠を取り合うだけ。
 `results`を渡さなければ、いまの結果（`_state`）から決める。"""
 if results is None:
  with _lock:
   results = list(_state.values())
 base = interval_sec()
 if update_mode() != 'auto':
  return base
 if any((r or {}).get('busy') for r in results):
  return min(base, RETRY_AFTER_BUSY_SEC)
 if any((r or {}).get('unreachable') and int((r or {}).get('fails') or 1) == 1 for r in results):
  return min(base, RETRY_AFTER_UNREACHABLE_SEC)
 return base


# ------------------------------------------------------------------
# 写しを作る
# ------------------------------------------------------------------
def writer_marks(remote):
 """書き手が作業中の印（元ファイルと同じフォルダ）。あれば名前の並び、無ければ []（約束の R3）。
 DataRelay の公開の書きかけ（`.<名前>.<番号>.incoming`）と、SQLite の中を書き換える書き手
 （ほかの端末の測定データ）の`-journal`・`-wal`。Quality-Analysis の`writer_marks`と同じ。"""
 p = Path(remote)
 name, low = p.name, p.name.lower()
 if not name:
  return []
 try:
  with os.scandir(p.parent) as it:
   names = [e.name for e in it]
 except OSError:
  return []
 return sorted(n for n in names if (n.lower().startswith(f'.{low}.') and n.lower().endswith('.incoming'))
               or n.lower() in (f'{low}-journal', f'{low}-wal'))


def _copy_shared(remote, tmp):
 """元をファイルとして丸ごと写す（SQLiteとして開かない・置き換えを許す開き方・休まない。R4）。"""
 with atomic_io.open_shared_read(remote) as src, open(tmp, 'wb') as dst:
  shutil.copyfileobj(src, dst, COPY_CHUNK)


def _settled(remote, sig):
 """写し終えた後も、元が写す前と同じで、書き手の印も無いか（R5）。ダメなら見送る理由、良ければNone。"""
 after, _ = _remote_stat(remote, retry=False)
 if after != sig:
  return '写しているあいだに元ファイルが入れ替わったため、見送りました。少し空けて写し直します'
 marks = writer_marks(remote)
 if marks:
  return f'写しているあいだに書き手が書き始めたため、見送りました（{marks[0]}）。少し空けて写し直します'
 return None


def _verify(tmp):
 """採用してよい写しかを確かめる。だめなら理由を返す(OKならNone)。"""
 try:
  c = sqlite3.connect(f'file:{Path(tmp).as_posix()}?mode=ro', uri=True, timeout=10)
 except sqlite3.Error as e:
  return f'開けません: {e}'
 try:
  cur = c.cursor()
  # quick_check は integrity_check より軽く、壊れたページを見つけるには十分。
  row = cur.execute('PRAGMA quick_check(1)').fetchone()
  if not row or str(row[0]).lower() != 'ok':
   return f'整合性検査に通りません: {row[0] if row else "(応答なし)"}'
  n = cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
  if not int(n or 0):
   return 'テーブルが1つもありません(まだ書き込み中の可能性)'
 except sqlite3.Error as e:
  return f'読めません: {e}'
 finally:
  c.close()
 return None


def refresh_one(key, remote):
 """1つのデータソースを確かめ、元が変わっていれば写し直す（「再読込」も同じ道・約束の R2）。

 戻り値: {'updated':bool,'reason':str,...}。**例外は投げない**——
 写せなくても画面は前の写しで動き続けるほうがよい。"""
 remote = Path(remote)
 local = mirror_path(key)
 result = {'key': key, 'remote': str(remote), 'local': str(local),
           'updated': False, 'reason': '', 'at': time.time()}
 sig, err = _remote_stat(remote, retry=_known_good(key, remote))
 # 元に**写していない新しい版があるか**（§9.463）。写せたら下で False に戻す。
 result['newer'] = bool(sig is not None and _signature_of(key) != sig)
 if sig is None and not local.exists():
  _unreachable(key, remote, result, '共有の元ファイルへ到達できず、写しもまだありません', err)
  _record(key, result)
  return result
 if sig is not None and _signature_of(key) == sig and local.exists():
  result['reason'] = '元ファイルは変わっていません'
  result['skipped'] = True
  result['newer'] = False
  # 変わっていない周回でも、前に消し損ねた世代があれば片付ける。
  _sweep_old_generations(key, local)
  _record(key, result)
  return result
 if sig is None:
  _unreachable(key, remote, result, '共有の元ファイルへ到達できないため、前の写しを使い続けます', err)
  _record(key, result)
  return result
 marks = writer_marks(remote)
 if marks:
  return _busy(key, result, f'書き手が公開している途中のため、写すのを見送りました（{marks[0]}）。少し空けて写し直します')

 cache_dir().mkdir(parents=True, exist_ok=True)
 # **今と違う名前**へ書く。上書きしないので、読み手が今の写しを開いていても
 # ぶつからない(§9.108)。
 target = _generation_path(key, _next_generation(key))
 tmp = target.with_suffix('.sqlite3.tmp')
 atomic_io.unlink(tmp, budget_sec=1.0, label='mirror.tmp')
 try:
  _copy_shared(remote, tmp)
 except Exception as e:
  result['reason'] = f'写せませんでした: {e}'
  app_logger().warning('%s の写しを作れませんでした: %s', key, e)
  _cleanup(tmp)
  _record(key, result)
  return result
 moved = _settled(remote, sig)
 if moved:
  _cleanup(tmp)
  return _busy(key, result, moved)

 bad = _verify(tmp)
 if bad:
  # **壊れた写しは採用しない。** 前の写しをそのまま使い続ける。
  result['reason'] = f'写しが正しくないため見送りました({bad})'
  app_logger().warning('%s の写しを見送りました: %s', key, bad)
  _cleanup(tmp)
  _record(key, result)
  return result

 try:
  # targetはまだ存在しない新しい名前なので、ここで置き換え先を掴まれている
  # ことは無い。それでも同じフォルダー内の1手にするために replace を使う
  # (書きかけの .tmp を読み手に見せないため)。
  atomic_io.replace(tmp, target, label='mirror.swap')
 except OSError as e:
  hint = atomic_io.cloud_sync_hint(cache_dir())
  result['reason'] = f'写しを置き換えられませんでした: {e}'
  if hint:
   result['reason'] += f'（写しの置き場が{hint}の中にあります。同期中は掴まれるため、db_dirを実ローカルへ移してください）'
  app_logger().warning('%s の写しを置き換えられませんでした: %s', key, e)
  _cleanup(tmp)
  _record(key, result)
  return result

 _save_entry(key, sig, target.name)
 result['local'] = str(target)
 result.update(updated=True, how='copy', newer=False, reason='写しを更新しました')
 app_logger().info('%s: 共有から手元へ写しました(%d bytes, %s)', key, sig.get('size', 0), target.name)
 _sweep_old_generations(key, target)
 _record(key, result)
 return result


def _busy(key, result, reason):
 """書き手が作業中・写す間に元が変わった（R3・R5）。今回は見送り、少し空けて確かめ直す（自動のとき）。"""
 global _retry_at
 result.update(busy=True, reason=reason)
 if update_mode() == 'auto':
  _retry_at = time.time() + RETRY_AFTER_BUSY_SEC
 _record(key, result)
 return result


def _next_generation(key):
 """次の世代番号。今ある世代の最大+1(台帳が消えても衝突しない)。"""
 top = 0
 prefix = f'{_safe_key(key)}.g'
 try:
  for p in cache_dir().glob(f'{prefix}*.sqlite3'):
   try:
    top = max(top, int(p.name[len(prefix):-len('.sqlite3')]))
   except ValueError:
    continue
 except OSError:
  pass
 return top + 1


def _sweep_old_generations(key, keep):
 """今の世代以外を片付ける。**消せなくてよい**——読み手が開いている間は
 Windowsで消せないので、次の周回でまた試す。"""
 keep = Path(keep).name
 prefix = f'{_safe_key(key)}.g'
 try:
  olds = [p for p in cache_dir().glob(f'{prefix}*.sqlite3') if p.name != keep]
 except OSError:
  return
 # 世代を入れる前の決まった名前も、もう誰も読まないので片付ける。
 legacy = _legacy_path(key)
 if keep != legacy.name and legacy.exists():
  olds.append(legacy)
 for p in olds:
  atomic_io.unlink(p, budget_sec=0.2, label='mirror.sweep')


def _cleanup(tmp):
 atomic_io.unlink(tmp, budget_sec=1.0, label='mirror.tmp')


def _record(key, result):
 with _lock:
  _state[key] = result


def source_info(key, path=None):
 """その一覧が読んでいるデータは「いつのものか」（§9.286 ④、利用者の指示
 「今見ているのがいつのデータかわかるような表示も一覧表確認時に見えるように」）。

 **共有をここでstatしない。** 写しの仕組みは「共有へ触るのは背景スレッドだけ」
 という約束の上に立っている（§9.89）ので、一覧を出すリクエストから共有を
 見に行くと、共有が不調なときに**一覧そのものが止まる**——鮮度を出すために
 一覧が出なくなるのでは本末転倒。元ファイルの更新時刻は、写しを作ったときに
 台帳へ控えてある印（`signature.mtime_ns`）から読む。

 戻り値:
   at        … その中身がいつのものか（元ファイルの更新時刻。epoch秒）
   mirrored  … 手元の写しを読んでいるか
   copiedAt  … その写しをいつ取り込んだか（写しファイル自身の更新時刻）
   checkedAt … 最後に共有を確かめたのはいつか（背景スレッドの周回）
   **取れないものはNone**——「分からない」を0や「たった今」にしない（§3）。
 """
 out = {'at': None, 'mirrored': False, 'copiedAt': None, 'checkedAt': None}
 key = str(key or '')
 entry = _entry(key) or {}
 sig = entry.get('signature') or {}
 local = mirror_path(key)
 try:
  mirrored = bool(entry.get('file')) and local.exists()
 except OSError:
  mirrored = False
 out['mirrored'] = mirrored
 if mirrored:
  ns = sig.get('mtime_ns')
  if isinstance(ns, (int, float)):
   out['at'] = float(ns) / 1e9
  try:
   out['copiedAt'] = local.stat().st_mtime
  except OSError:
   pass
 elif path:
  # 写していない置き場（手元のファイル）。こちらは手元なのでstatしてよい。
  try:
   out['at'] = Path(path).stat().st_mtime
  except OSError:
   pass
 with _lock:
  st = _state.get(key)
 if st and isinstance(st.get('at'), (int, float)):
  out['checkedAt'] = float(st['at'])
 # 写していない新しい版があるか（§9.463）。**確かめたのは背景の周回**——
 # ここで共有を見に行かない（§9.89）。確かめていなければ None（分からない）。
 out['newer'] = (bool(st.get('newer')) if st and 'newer' in st else None)
 out['mode'] = update_mode()
 return out


def status():
 """画面・診断用。キーごとの直近の結果。"""
 with _lock:
  return {k: dict(v) for k, v in _state.items()}


# ------------------------------------------------------------------
# 対象と設定
# ------------------------------------------------------------------
RECORDS_KEY_PREFIX = 'records:'


def records_targets():
 """共有の測定データのうち、**この端末が書かないファイル**(§9.268)。

 測定データは設備ごとに1ファイルで、書くのはその設備の測定端末1台だけ
 (§9.258)。ところが**閲覧は全設備を読む**ので、閲覧端末が増えるほど
 共有のファイルを直接開く回数が増える——SQLiteの読み手は読んでいるあいだ
 SHAREDロックを持つので、測定端末の書込(EXCLUSIVEが要る)がそのぶん
 待たされる。SMB越しのロックは元々当てにならないので、閲覧が増えるほど
 書込が不利になる(利用者の指摘)。

 作業予定・仕掛/品質・マスタは既に「手元の写しから読む」形になっていて、
 **測定データだけが取り残されていた**。ここで同じ形へ揃える。

 **自分が書いたファイルは写さない**——写しから読むと自分の書込が写しの
 間隔ぶん見えない。判定は`db_access.records_written_here()`の1箇所。
 """
 from .db_access import (RECORDS_SHARE_DIR, RECORDS_BACKUP_EXPORT_PATH,
                         records_share_files, records_written_here)
 if RECORDS_SHARE_DIR is None and RECORDS_BACKUP_EXPORT_PATH is None:
  return []
 mine = records_written_here()
 out = []
 for path in records_share_files():
  if str(path) in mine:
   continue
  # 鍵は**フォルダ名**から作る(`records_dir_name`が使えない文字と
  # ぶつかりを既に片付けている)。設備名から直に作ると、使えない文字を
  # 落としたときに別の設備の写しが1つの鍵へ潰れうる。
  out.append((RECORDS_KEY_PREFIX + path.parent.name, path))
 if RECORDS_BACKUP_EXPORT_PATH is not None and str(RECORDS_BACKUP_EXPORT_PATH) not in mine:
  out.append((RECORDS_KEY_PREFIX + '_export', Path(RECORDS_BACKUP_EXPORT_PATH)))
 return out


def targets():
 """写す対象。**読み取り専用のデータソースと、他の端末が書く測定データ**。

 マスタDB(自分が書く)と共有スケジュールDB(ロック手順付きで自分が書く)は
 対象外。書くものを写すと、写しへ書いて共有へ反映されない事故になる。

 **役割「スケジュール」のデータソースも対象外**(§9.193)。あれは一覧として
 見られるように登録するものだが、中身は自分が書く共有スケジュールDBそのもの
 ——写しを読ませると、他端末の予定が写しの間隔ぶん古いまま見え続ける。

 測定データは§9.268で足した(`records_targets`)。**自分が書くぶんは入らない。**"""
 from .db_access import DBS, PURPOSE_SCHEDULE, pattern_files, pattern_mirror_key
 out = []
 for key, cfg in DBS.items():
  if (cfg or {}).get('role') != 'readonly':
   continue
  if (cfg or {}).get('purpose') == PURPOSE_SCHEDULE:
   continue
  if (cfg or {}).get('pattern'):
   # 設備ごとのファイル(§9.595)。**フォルダそのものは写さない**——型に合う
   # 1ファイルずつを、設備名の鍵(`<鍵>@<設備>`)で写す。読む側は`cfg_for()`。
   for equip, path in pattern_files(key).values():
    out.append((pattern_mirror_key(key, equip), path))
   continue
  out.append((key, Path(cfg['path'])))
 try:
  out.extend(records_targets())
 except Exception as e:
  # **写せなくても画面は動く**(§9.89)。測定データの置き場が未設定・
  # 共有が不調でも、ここで送出して他のデータソースの写しまで止めない。
  app_logger().warning('測定データの写す対象を作れませんでした: %s', e)
 return out


def enabled():
 """写して読むかどうか。既定は有効(auto)。"""
 from .db_access import path_config_value
 v = str(path_config_value('db_mirror_enabled', 'auto') or 'auto').strip().lower()
 return v not in ('off', 'no', 'false', '0')


UPDATE_MODES = ('auto', 'manual')


def update_mode():
 """写しを**自分で更新するか**（§9.463、利用者の指示「更新機能の手動自動を実装した
 うえで、デフォルトは今まで通り自動に」）。
   auto   … 元が変われば直ちに写し直す（周回ごと・起動時も）。既定
   manual … 自分では写し直さない。元が変わったことだけ確かめて「新しい版あり」と
            言い、写し直すのは「再読込」を押したとき（意図して止める）
 `db_mirror_enabled`（写して読むか）とは別の軸——こちらは「写しをいつ新しくするか」。"""
 from .db_access import path_config_value  # 遅延: db_access は起動時に db_mirror を読む（循環を避ける）
 v = str(path_config_value('db_mirror_update', 'auto') or 'auto').strip().lower()
 return v if v in UPDATE_MODES else 'auto'


def check_one(key, remote):
 """写さずに、元に新しい版があるかだけ確かめる（手動のとき・§9.463）。"""
 remote = Path(remote)
 sig, err = _remote_stat(remote, retry=_known_good(key, remote))
 prev = status().get(key) or {}
 result = dict(prev, key=key, remote=str(remote), at=time.time(), unreachable=False, error='')
 if sig is None:
  _unreachable(key, remote, result, '共有の元ファイルへ到達できません（前の写しを使い続けます）', err)
 else:
  result['newer'] = _signature_of(key) != sig
  result['reason'] = ('元に新しい版があります（手動のため写していません）' if result['newer']
                      else '元ファイルは変わっていません')
 _record(key, result)
 return result


def check_all():
 with _refresh_lock:
  return [check_one(key, remote) for key, remote in targets()]


def interval_sec():
 from .db_access import path_config_value
 try:
  n = int(float(path_config_value('db_mirror_interval_sec', DEFAULT_INTERVAL_SEC)))
 except (TypeError, ValueError):
  n = DEFAULT_INTERVAL_SEC
 return max(MIN_INTERVAL_SEC, n)


def _copied(key, remote):
 """その元ファイルから作った写し（無ければNone）。元のパスまで照合する——読み込み先を切り替えた
 直後は、写しの中身がまだ前のファイルのものなので使ってはいけない。"""
 entry = _entry(key) or {}
 sig = entry.get('signature') or {}
 if sig.get('source') and str(sig['source']) != str(remote):
  return None
 local = mirror_path(key)
 try:
  return local if local.exists() else None
 except OSError:
  return None


def read_path(key, remote):
 """実際に読む場所＝**その元ファイルから作った写し**。まだ無ければNone（**共有は直接読まない**・約束の R8）。

 背景の係が動いていない呼び出し（網・単発のスクリプト）だけは、読むたびにその場で同じ作法で確かめ、
 変わっていれば写してから答える（写す係がいないので、待っても写しは出来ず、古い写しのままになる。
 変わっていなければ stat 1回だけで共有は開かない＝R2）。写して読むのを切った端末（`db_mirror_enabled`）は元。"""
 if not enabled():
  return Path(remote)
 running = _thread is not None and _thread.is_alive()
 # **起動して最初の周回が済むまでは待つ**（§9.463）。前回の起動の写しを出さない。
 if not _first.is_set() and running:
  _first.wait(FIRST_WAIT_SEC)
 # 手動（§9.463）は写しを自分では新しくしない——写しが1つも無いときだけ写す。
 if not running and (_copied(key, remote) is None or update_mode() == 'auto'):
  with _refresh_lock:
   refresh_one(key, remote)
 return _copied(key, remote)


def not_ready_text(key):
 """写しがまだ無いときに画面へ出す文（なぜ無いか＋写し終えたら出ること）。Quality-Analysis と同じ文。"""
 with _lock:
  why = str((_state.get(key) or {}).get('reason') or '')
 return '共有の元ファイルを、まだ手元へ写せていません' + (f'（{why}）' if why else '') + '。写し終えると一覧が出ます。'


def error_status(e):
 """ルートが例外を返すときの (足す鍵, 状態コード)。まだ写せていないなら 503 と`kind:'copying'`（画面は写し
 終えたら読み直す）。それ以外は 500。"""
 return ({'kind': 'copying'}, 503) if isinstance(e, NotCopiedYet) else ({}, 500)


def refresh_all():
 out = []
 with _refresh_lock:
  for key, remote in targets():
   out.append(refresh_one(key, remote))
 return out


# ------------------------------------------------------------------
# 背景スレッド
# ------------------------------------------------------------------
def _cycle():
 """1周ぶん。自動なら写し直し、手動なら新しい版があるかだけ確かめる（§9.463）。"""
 global _retry_at
 _retry_at = 0.0
 if not enabled():
  return []
 if update_mode() == 'manual':
  return check_all()
 return refresh_all()


def _sleep_until_next(results):
 """次の周回まで待つ。起こされたら（`wake()`）すぐ戻る。届かなかった元があれば
 早める（`next_wait_sec()`）——「再読込」の中で届かなかったとき（`_retry_at`）も同じ。
 1秒刻みで見るのは手元の値だけ（共有へは触らない）。"""
 deadline = time.time() + next_wait_sec(results)
 while True:
  due = min(deadline, _retry_at) if _retry_at else deadline
  left = due - time.time()
  if left <= 0:
   return
  if _wake.wait(min(left, 1.0)):
   return


def _loop():
 # **最初の周回は待たずに回す**（§9.463、利用者の指示「少なくとも起動時は確実に
 # 最新のファイルに更新し、古い手元のファイルを見ているような状態にならない
 # ように」）。以前は起動処理と重ねないため3秒待っていたが、その間は前回の写しを
 # 出していた。済むまでは`read_path()`が待つ。
 last = []
 try:
  last = _cycle()
 except Exception as e:
  app_logger().warning('写しの更新に失敗しました: %s', e)
 finally:
  _first.set()
 # 置き場が手元へ移っていたら、前の置き場の残骸を1度だけ片付ける
 # (背景スレッドの中で行う。共有・クラウドへ触る可能性があるため)。
 try:
  sweep_former_cache()
 except Exception as e:
  app_logger().debug('前の置き場の片付けに失敗しました: %s', e)
 while True:
  _wake.clear()
  _sleep_until_next(last)
  try:
   last = _cycle()
  except Exception as e:
   last = []
   app_logger().warning('写しの更新に失敗しました: %s', e)


def start():
 """背景での写し直しを開始する。多重起動しない。"""
 global _thread
 with _lock:
  if _thread and _thread.is_alive():
   return False
  _thread = threading.Thread(target=_loop, name='db-mirror', daemon=True)
  _thread.start()
  return True


def wake():
 """次の周回をすぐ回す(「再読込」から呼ぶ)。"""
 _wake.set()
