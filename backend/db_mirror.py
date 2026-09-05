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

_lock = threading.RLock()
_state: dict[str, dict] = {}      # キー -> 直近の結果(画面へ出す診断用)
_thread = None
_wake = threading.Event()


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
 sig = _remote_signature(remote)
 if sig is None and not local.exists():
  result['reason'] = '共有の元ファイルへ到達できず、写しもまだありません'
  _record(key, result)
  return result
 if sig is not None and not force and _signature_of(key) == sig and local.exists():
  result['reason'] = '元ファイルは変わっていません'
  result['skipped'] = True
  # 変わっていない周回でも、前に消し損ねた世代があれば片付ける。
  _sweep_old_generations(key, local)
  _record(key, result)
  return result
 if sig is None:
  result['reason'] = '共有の元ファイルへ到達できないため、前の写しを使い続けます'
  _record(key, result)
  return result

 cache_dir().mkdir(parents=True, exist_ok=True)
 # **今と違う名前**へ書く。上書きしないので、読み手が今の写しを開いていても
 # ぶつからない(§9.108)。
 target = _generation_path(key, _next_generation(key))
 tmp = target.with_suffix('.sqlite3.tmp')
 atomic_io.unlink(tmp, budget_sec=1.0, label='mirror.tmp')
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
 result.update(updated=True, how=how,
               reason=f'写しを更新しました({"バックアップAPI" if how=="backup" else "コピー"})')
 app_logger().info('%s: 共有から手元へ写しました(%s, %d bytes, %s)',
                   key, how, sig.get('size', 0), target.name)
 _sweep_old_generations(key, target)
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
 from .db_access import DBS, PURPOSE_SCHEDULE
 out = []
 for key, cfg in DBS.items():
  if (cfg or {}).get('role') != 'readonly':
   continue
  if (cfg or {}).get('purpose') == PURPOSE_SCHEDULE:
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
 entry = _entry(key) or {}
 sig = entry.get('signature') or {}
 if sig.get('source') and str(sig['source']) != str(remote):
  return Path(remote)
 local = mirror_path(key)
 try:
  if not local.exists():
   return Path(remote)
 except OSError:
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
 # 置き場が手元へ移っていたら、前の置き場の残骸を1度だけ片付ける
 # (背景スレッドの中で行う。共有・クラウドへ触る可能性があるため)。
 try:
  sweep_former_cache()
 except Exception as e:
  app_logger().debug('前の置き場の片付けに失敗しました: %s', e)
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
