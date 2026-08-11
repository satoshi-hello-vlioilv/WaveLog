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

写しの作り方(この順に試す)
------------------------------------------------------------
1. **SQLiteのバックアップAPI**(`Connection.backup()`)。SQLite自身の
   読み手として一貫したスナップショットを作る。書き手が動いていても
   ページ単位で整合の取れた写しになるので、**これが第一候補**。
2. 失敗したらバイト単位のコピー。共有側がファイルごと置き換える運用だと
   1が使えないことがある(開いた瞬間に別のファイルへ差し替わる等)。

どちらで作っても、**採用する前に必ず検査する**(`PRAGMA quick_check`)。
壊れていたら捨てて、前の写しをそのまま使い続ける。**採用は
os.replace() の1手**(同じフォルダー内の置き換えは不可分)なので、
画面が中途半端な写しを開くことはない。

置き換えのポリシー
------------------------------------------------------------
・写す判断は元ファイルの更新時刻とサイズで行う(変わっていなければ写さない)。
・**この判断は背景スレッドの中だけで行う**。画面のリクエストの中で共有へ
  stat を掛けない(CLAUDE.md「共有DBを開く前にPath.exists()/stat()を
  置かないこと」。共有が不調なとき、確認の1行が唯一の失敗原因になる)。
・写しがまだ1つも無いときは、従来どおり共有を直接読む(fail-open)。
  写しが出来た時点から手元を読むようになる。
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import threading
import time
from pathlib import Path

from .logging_setup import app_logger

# 写しの置き場。db/cache/<キー>.sqlite3
_CACHE_DIRNAME = 'cache'
# 元ファイルの更新時刻・サイズを覚えておく台帳(写す必要があるかの判断に使う)。
_SIGNATURE_FILE = '_mirror.json'

# 既定の写し直し間隔。短くしても共有への負荷は「statを1回」なので軽い。
DEFAULT_INTERVAL_SEC = 60
MIN_INTERVAL_SEC = 10

_lock = threading.RLock()
_state: dict[str, dict] = {}      # キー -> 直近の結果(画面へ出す診断用)
_thread = None
_wake = threading.Event()


# ------------------------------------------------------------------
# 置き場所
# ------------------------------------------------------------------
def cache_dir():
 from .db_access import DB_DIR
 return Path(DB_DIR) / _CACHE_DIRNAME


def mirror_path(key):
 """そのデータソースの写しの置き場所。"""
 safe = ''.join(ch if (ch.isalnum() or ch in '-_') else '_' for ch in str(key or 'db'))
 return cache_dir() / f'{safe}.sqlite3'


def _signature_path():
 return cache_dir() / _SIGNATURE_FILE


def _load_signatures():
 try:
  return json.loads(_signature_path().read_text(encoding='utf-8'))
 except Exception:
  return {}


def _save_signatures(sig):
 try:
  cache_dir().mkdir(parents=True, exist_ok=True)
  _signature_path().write_text(json.dumps(sig, ensure_ascii=False, indent=1), encoding='utf-8')
 except Exception as e:
  app_logger().warning('写しの台帳を書けませんでした: %s', e)


def _remote_signature(remote):
 """元ファイルの「変わったか」を見分ける印。取れなければNone。

 **共有へ触るのはここだけ**で、しかも背景スレッドからしか呼ばない。"""
 try:
  st = os.stat(remote)
  # **元のパスも印に含める**。パス設定を変えた/検証用へ差し替えたときに、
  # 前の元ファイルから作った写しをそのまま読み続けてしまうため
  # (キーは同じでも中身は別物)。
  return {'source': str(remote), 'size': st.st_size, 'mtime_ns': st.st_mtime_ns}
 except OSError as e:
  app_logger().debug('元ファイルの状態を取得できませんでした(%s): %s', remote, e)
  return None


# ------------------------------------------------------------------
# 写しを作る
# ------------------------------------------------------------------
def _snapshot_via_backup(remote, tmp):
 """SQLiteのバックアップAPIで一貫した写しを作る。"""
 from .db_access import _sqlite_ro_uri
 src = sqlite3.connect(_sqlite_ro_uri(remote), uri=True, timeout=15)
 try:
  dst = sqlite3.connect(str(tmp))
  try:
   # 書き手が動いていても取れるよう、少しずつ写して衝突時は待つ。
   src.backup(dst, pages=256, sleep=0.05)
  finally:
   dst.close()
 finally:
  src.close()


def _snapshot_via_copy(remote, tmp):
 """バイト単位のコピー。バックアップAPIが使えないときの控え。"""
 shutil.copyfile(remote, tmp)


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


def refresh_one(key, remote, force=False):
 """1つのデータソースの写しを作り直す。

 戻り値: {'updated':bool,'reason':str,...}。**例外は投げない**——
 写せなくても画面は前の写し(または共有)で動き続けるほうがよい。"""
 remote = Path(remote)
 local = mirror_path(key)
 result = {'key': key, 'remote': str(remote), 'local': str(local),
           'updated': False, 'reason': '', 'at': time.time()}
 sigs = _load_signatures()
 sig = _remote_signature(remote)
 if sig is None and not local.exists():
  result['reason'] = '共有の元ファイルへ到達できず、写しもまだありません'
  _record(key, result)
  return result
 if sig is not None and not force and sigs.get(key) == sig and local.exists():
  result['reason'] = '元ファイルは変わっていません'
  result['skipped'] = True
  _record(key, result)
  return result
 if sig is None:
  result['reason'] = '共有の元ファイルへ到達できないため、前の写しを使い続けます'
  _record(key, result)
  return result

 cache_dir().mkdir(parents=True, exist_ok=True)
 tmp = local.with_suffix('.sqlite3.tmp')
 try:
  tmp.unlink()
 except OSError:
  pass
 how = ''
 try:
  try:
   _snapshot_via_backup(remote, tmp)
   how = 'backup'
  except Exception as e:
   app_logger().info('%s: バックアップAPIで写せなかったのでコピーします: %s', key, e)
   _snapshot_via_copy(remote, tmp)
   how = 'copy'
 except Exception as e:
  result['reason'] = f'写せませんでした: {e}'
  app_logger().warning('%s の写しを作れませんでした: %s', key, e)
  _cleanup(tmp)
  _record(key, result)
  return result

 bad = _verify(tmp)
 if bad:
  # **壊れた写しは採用しない。** 前の写しをそのまま使い続ける。
  result['reason'] = f'写しが正しくないため見送りました({bad})'
  app_logger().warning('%s の写しを見送りました: %s', key, bad)
  _cleanup(tmp)
  _record(key, result)
  return result

 try:
  os.replace(tmp, local)          # 同じフォルダー内の置き換えは不可分
 except OSError as e:
  result['reason'] = f'写しを置き換えられませんでした: {e}'
  app_logger().warning('%s の写しを置き換えられませんでした: %s', key, e)
  _cleanup(tmp)
  _record(key, result)
  return result

 sigs[key] = sig
 _save_signatures(sigs)
 result.update(updated=True, how=how,
               reason=f'写しを更新しました({"バックアップAPI" if how=="backup" else "コピー"})')
 app_logger().info('%s: 共有から手元へ写しました(%s, %d bytes)', key, how, sig.get('size', 0))
 _record(key, result)
 return result


def _cleanup(tmp):
 try:
  Path(tmp).unlink()
 except OSError:
  pass


def _record(key, result):
 with _lock:
  _state[key] = result


def status():
 """画面・診断用。キーごとの直近の結果。"""
 with _lock:
  return {k: dict(v) for k, v in _state.items()}


# ------------------------------------------------------------------
# 対象と設定
# ------------------------------------------------------------------
def targets():
 """写す対象。**読み取り専用のデータソースだけ**。

 マスタDB(自分が書く)と共有スケジュールDB(ロック手順付きで自分が書く)は
 対象外。書くものを写すと、写しへ書いて共有へ反映されない事故になる。"""
 from .db_access import DBS
 out = []
 for key, cfg in DBS.items():
  if (cfg or {}).get('role') != 'readonly':
   continue
  out.append((key, Path(cfg['path'])))
 return out


def enabled():
 """写して読むかどうか。既定は有効(auto)。"""
 from .db_access import path_config_value
 v = str(path_config_value('db_mirror_enabled', 'auto') or 'auto').strip().lower()
 return v not in ('off', 'no', 'false', '0')


def interval_sec():
 from .db_access import path_config_value
 try:
  n = int(float(path_config_value('db_mirror_interval_sec', DEFAULT_INTERVAL_SEC)))
 except (TypeError, ValueError):
  n = DEFAULT_INTERVAL_SEC
 return max(MIN_INTERVAL_SEC, n)


def read_path(key, remote):
 """実際に読む場所。**その元ファイルから作った写し**があればそれ、
 無ければ元(fail-open)。

 元のパスまで照合するのが要点。読み込み先を切り替えた直後は、写しの中身が
 まだ前のファイルのものなので使ってはいけない(背景スレッドが写し直すまでは
 元を直接読む)。"""
 if not enabled():
  return Path(remote)
 local = mirror_path(key)
 try:
  if not local.exists():
   return Path(remote)
 except OSError:
  return Path(remote)
 sig = _load_signatures().get(key) or {}
 if sig.get('source') and str(sig['source']) != str(remote):
  return Path(remote)
 return local


def refresh_all(force=False):
 out = []
 for key, remote in targets():
  out.append(refresh_one(key, remote, force=force))
 return out


# ------------------------------------------------------------------
# 背景スレッド
# ------------------------------------------------------------------
def _loop():
 # 起動直後は少し待つ(起動処理と共有I/Oを重ねない)。
 _wake.wait(3)
 while True:
  try:
   if enabled():
    refresh_all()
  except Exception as e:
   app_logger().warning('写しの更新に失敗しました: %s', e)
  _wake.clear()
  _wake.wait(interval_sec())


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
