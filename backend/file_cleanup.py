"""file_cleanup.py: 作り直せるファイルの掃除(§9.249 ①、利用者の指示)

  「溜まってくると問題なので、不要なキャッシュファイルや不要なバックアップ
   ファイルを削除する機能を実装してください。いらないものや世代の古いものは
   定期的に削除するような機能も欲しいです。」

**触ってよいのは「消えても取り直せるもの」だけ**(§9.109と同じ線引き)。
master.sqlite3 / records.sqlite3 / 共有スケジュール / 仕掛・品質の原本は
このモジュールから一切見えないところに置いてある——「掃除」が本物のデータを
消し得る作りにすると、押す前に毎回怖くなる道具になる。

判定は**このファイルの1箇所**が持つ(§9.163)。画面は`survey()`が返した
一覧をそのまま出すだけで、どのファイルが要る・要らないの規則を持たない。

  ・`CATEGORIES`  … 何が溜まるのか(種別・説明・自動で消してよいか)
  ・`survey()`    … 今どれだけ溜まっているか(件数・容量・最古/最新)
  ・`run()`       … 実際に消す(`dry_run=True`なら数えるだけ)
  ・`start()`     … 定期実行(パス設定マスタの`cleanup_*`で入切・間隔)

**「消せなかった」は失敗にしない**(§9.108)。Windowsでは誰かが開いている
ファイルを消せないが、それは待てば消せるものなので、次の周回へ回すだけで
実害が無い。件数だけ返して理由を添える。
"""
from pathlib import Path
import shutil
import threading
import time

from . import atomic_io, path_config
from .logging_setup import app_logger
from .paths import browser_dir, db_dir, runtime_dir
from .quiet import quiet

# ------------------------------------------------------------------
# 決まり(パス設定マスタ。呼び出しのたびに読み直すので再起動は要らない)
# ------------------------------------------------------------------
AUTO_DEFAULT = 'on'          # 既定は入。消すのは作り直せるものだけなので
INTERVAL_DEFAULT_SEC = 21600  # 6時間。溜まる速さに対して十分な粗さ
INTERVAL_MIN_SEC = 300
KEEP_DAYS_DEFAULT = 14
KEEP_GENERATIONS_DEFAULT = 3
# **一時ファイルは若いうちは触らない。** いま書いている最中のものを消すと、
# 書き手が「書けたはずのものが無い」という直しようのない壊れ方をする。
TMP_MIN_AGE_SEC = 3600

_state = {'lastRunAt': None, 'lastRemoved': 0, 'lastFreed': 0, 'lastError': '',
          'running': False, 'lastKept': 0}
_lock = threading.Lock()
_thread = None
_wake = threading.Event()


def _cfg(key, default):
 """パス設定マスタの1件。**読めなければ既定**(掃除の設定が読めないことを
 理由に掃除そのものを止めない)。読むのは`path_config`——**`db_access`を読み込まない**。
 読み込むと共有に置いたマスタの写しを錠なしで作り直し、update.bat が起動中のアプリの
 書込と競っていた(§9.497の追補3。追補1・2は画面に出る記録を塞いだだけだった)。"""
 try:
  raw = path_config.value(key, default)
 except Exception as _e:
  quiet('設定を読めない（既定で続ける）',_e)
  raw = default
 return raw


def _cfg_int(key, default, minimum):
 try:
  n = int(str(_cfg(key, default)).strip() or default)
 except Exception as _e:
  quiet('数として読めない（既定で続ける）',_e)
  n = default
 return max(minimum, n)


def auto_enabled():
 return str(_cfg('cleanup_auto_enabled', AUTO_DEFAULT)).strip().lower() != 'off'


def interval_sec():
 return _cfg_int('cleanup_interval_sec', INTERVAL_DEFAULT_SEC, INTERVAL_MIN_SEC)


def keep_days():
 return _cfg_int('cleanup_keep_days', KEEP_DAYS_DEFAULT, 1)


def keep_generations():
 return _cfg_int('cleanup_keep_generations', KEEP_GENERATIONS_DEFAULT, 1)


def policy():
 """いま効いている決まり。画面がそのまま出す(§CLAUDE 6「根拠を画面に出す」)。"""
 return {'auto': auto_enabled(), 'intervalSec': interval_sec(),
         'keepDays': keep_days(), 'keepGenerations': keep_generations(),
         'tmpMinAgeSec': TMP_MIN_AGE_SEC}


# ------------------------------------------------------------------
# 置き場所(**読めなくても落ちない**。共有が不調でも掃除の画面は開く)
# ------------------------------------------------------------------
def _safe(fn, fallback=None):
 try:
  return fn()
 except Exception as _e:
  quiet('数えられない（この項目は既定の値で出す）',_e)
  return fallback


def _cache_dir():
 from . import db_mirror
 return _safe(db_mirror.cache_dir)


def _logs_dir():
 from .paths import logs_dir
 return _safe(logs_dir)


def _local_root():
 from .paths import local_root
 return _safe(local_root)


def _work_dir():
 from .paths import work_dir
 return _safe(work_dir)


def _db_dir():
 # 置き場の答えは`paths.db_dir()`の1箇所（`db_access.DB_DIR`もこれ）。**`db_access`を読み込まない**
 # ——読み込むとデータソースの設定を読み、役割が無い環境では時刻つきの警告を出すので、
 # update.bat の画面へ記録が混ざる（§9.497の追補。CIのまっさらな環境で踏んだ）。
 return _safe(lambda: Path(db_dir()))


def _rne_backup_dir():
 root = _local_root()
 return (root / 'backup' / 'rne_extract') if root else None


def _pycache_dir():
 root = _local_root()
 return (root / 'pycache') if root else None


def _runtime_dirs():
 """起動の部品の置き場（§9.497）。`runtime_dir()`と、ほかのプログラムからも見える置き場
 （`browser_dir()`・§9.496）。**同じなら1つ**（ふつうの端末は同じ）。"""
 out = []
 for fn in (runtime_dir, browser_dir):
  d = _safe(fn)
  if d and str(d) not in [str(x) for x in out]:
   out.append(d)
 return out


# ------------------------------------------------------------------
# 1件ぶんの見立て
# ------------------------------------------------------------------
def _item(path, keep='', **extra):
 """掃除の対象1件。`keep`が空でなければ**残す理由**(＝消さない)。"""
 try:
  st = path.stat()
  size, mtime = st.st_size, st.st_mtime
 except OSError:
  size, mtime = 0, 0.0
 d = {'path': str(path), 'name': path.name, 'size': size, 'mtime': mtime, 'keep': keep}
 d.update(extra)
 return d


def _dir_item(path, keep=''):
 """フォルダ1つぶん(中身の合計)。"""
 total = 0
 files = 0
 newest = 0.0
 try:
  for p in path.rglob('*'):
   if p.is_file():
    try:
     st = p.stat()
    except OSError:
     continue
    total += st.st_size
    files += 1
    newest = max(newest, st.st_mtime)
 except OSError:
  pass
 return {'path': str(path), 'name': path.name, 'size': total, 'mtime': newest,
         'keep': keep, 'dir': True, 'files': files}


def _older_than(item, days):
 if not item.get('mtime'):
  return True
 return (time.time() - item['mtime']) > days * 86400


# ------------------------------------------------------------------
# 種別ごとの見立て(scan)
# ------------------------------------------------------------------
def _scan_mirror():
 """共有DBの写し。**今の世代は必ず残す**——読み手が開いているし、消すと
 次の1回だけ共有を直接読みに行く(共有が不調だと画面が固まる)。"""
 out = []
 d = _cache_dir()
 if not d or not _safe(d.is_dir, False):
  return out
 from . import db_mirror
 current = set()
 for key in _safe(lambda: list((db_mirror._load_ledger() or {}).keys()), []) or []:
  p = _safe(lambda k=key: db_mirror.mirror_path(k))
  if p:
   current.add(p.name)
 for p in sorted(_safe(lambda: [x for x in d.iterdir() if x.is_file()], []) or []):
  if p.suffix != '.sqlite3':
   continue
  it = _item(p)
  if p.name in current:
   it['keep'] = 'いま読んでいる世代です'
  else:
   # **世代を切り替えた直後は触らない。** 台帳が次の世代を指した後も、
   # 開いたまま読み終えていない画面がある(§9.108の「読み手は開いた世代を
   # 最後まで読み切れる」)。`db_mirror`自身も毎周回で片付けを試みるので、
   # ここが急ぐ理由は無い——古くなったものだけを引き受ける。
   age = time.time() - (it['mtime'] or 0)
   if age < TMP_MIN_AGE_SEC:
    it['keep'] = '切り替えたばかりです（まだ読んでいる画面があるかもしれません）'
  out.append(it)
 return out


def _scan_tmp():
 """置き去りの一時ファイル。**若いものは触らない**(書いている最中かもしれない)。"""
 out = []
 seen = set()
 for d in (_cache_dir(), _work_dir(), _db_dir()):
  if not d or not _safe(d.is_dir, False) or str(d) in seen:
   continue
  seen.add(str(d))
  for p in _safe(lambda dd=d: [x for x in dd.iterdir() if x.is_file()], []) or []:
   n = p.name
   if not (n.endswith('.tmp') or n.endswith('.incoming') or '.incoming' in n
           or n.endswith('.part')):
    continue
   it = _item(p)
   age = time.time() - (it['mtime'] or 0)
   if age < TMP_MIN_AGE_SEC:
    it['keep'] = 'まだ書いている途中かもしれません（%d分）' % int(age / 60)
   out.append(it)
 return out


def _scan_logs():
 """世代送りしたログ。**いま書いているログ(`*.log`)は残す。**"""
 out = []
 d = _logs_dir()
 if not d or not _safe(d.is_dir, False):
  return out
 groups = {}
 for p in _safe(lambda: [x for x in d.iterdir() if x.is_file()], []) or []:
  if '.log' not in p.name:
   continue
  if p.name.endswith('.log'):
   out.append(_item(p, keep='いま書いているログです'))
   continue
  groups.setdefault(p.name.rsplit('.', 1)[0], []).append(p)
 gens = keep_generations()
 for stem, files in groups.items():
  files.sort(key=lambda x: _safe(lambda: x.stat().st_mtime, 0.0) or 0.0, reverse=True)
  for i, p in enumerate(files):
   it = _item(p)
   if i < gens and not _older_than(it, keep_days()):
    it['keep'] = '新しい%d世代のうちです' % gens
   out.append(it)
 return out


def _scan_rne_backup():
 """RNE抽出の世代バックアップ。**新しい数世代は残す**(取り直せない抽出結果の
 控えなので、写しやログより慎重にする)。"""
 out = []
 d = _rne_backup_dir()
 if not d or not _safe(d.is_dir, False):
  return out
 gens = keep_generations()
 for sub in _safe(lambda: [x for x in d.iterdir() if x.is_dir()], []) or []:
  files = _safe(lambda s=sub: [x for x in s.iterdir() if x.is_file()], []) or []
  files.sort(key=lambda x: _safe(lambda: x.stat().st_mtime, 0.0) or 0.0, reverse=True)
  for i, p in enumerate(files):
   it = _item(p, group=sub.name)
   if i < gens:
    it['keep'] = '新しい%d世代のうちです' % gens
   elif not _older_than(it, keep_days()):
    it['keep'] = '%d日以内です' % keep_days()
   out.append(it)
 return out


def _scan_pending():
 """公開できずに保留したRNEの抽出結果。適用されれば消えるものなので、
 **長く残っているものだけ**が掃除の対象。"""
 out = []
 for d in (_db_dir(), _work_dir()):
  if not d or not _safe(d.is_dir, False):
   continue
  for p in _safe(lambda dd=d: [x for x in dd.glob('*.pending_*') if x.is_file()], []) or []:
   it = _item(p)
   if not _older_than(it, keep_days()):
    it['keep'] = '%d日以内です（次の抽出で適用されます）' % keep_days()
   out.append(it)
 return out


def _scan_pycache():
 """Pythonのバイトコード。**丸ごと作り直せる**が、消すと次の起動が一度だけ
 遅くなる——だから自動では消さない(`auto=False`)。

 置き場は2つある。ふつうは`_pycache_bootstrap`が`sys.pycache_prefix`で
 ローカル領域へ逃がすが、**それが効いていない経路**(テストを直に
 `python3 tests/....py`で走らせた等)では**ソースの隣に`__pycache__`が
 生える**。どちらも同じもの＝作り直せる中間ファイルなので、両方数える。"""
 out = []
 d = _pycache_dir()
 if d and _safe(d.is_dir, False):
  out += [_dir_item(s) for s in (_safe(lambda: [x for x in d.iterdir() if x.is_dir()], []) or [])]
 # ソースの隣に生えたぶん。**アプリの置き場の中だけ**を見る(利用者の
 # フォルダを歩き回らない)。
 from .paths import APP_ROOT
 for p in _safe(lambda: sorted(Path(APP_ROOT).rglob('__pycache__')), []) or []:
  if _safe(p.is_dir, False):
   out.append(_dir_item(p))
 return out


def _scan_work():
 """別のインストールが残した作業フォルダ。**今使っているものは残す。**"""
 root = _local_root()
 if not root:
  return []
 base = root / 'work'
 if not _safe(base.is_dir, False):
  return []
 cur = str(_work_dir() or '')
 out = []
 for s in _safe(lambda: [x for x in base.iterdir() if x.is_dir()], []) or []:
  out.append(_dir_item(s, keep='いま使っている作業フォルダです' if str(s) == cur else ''))
 return out


# 作り直せる起動の部品（§9.497）。**名前で選ぶ**（置き場には残す物も同居しているため）。
# 入れない物: 起動前確認の刻印（ready.json）・ショートカットの絵（wavelog.ico——デスクトップの
# ショートカットが指しており、作り直すのは作るときだけ。消すと絵が白紙になる）。
# ブラウザ版だけが使っていた物（待機画面の写し・進捗・起動中の印）は§9.548で外し、
# 片付けは`setup_check.RETIRED_LOCAL`が持つ。
RUNTIME_REGENERABLE = ('make_shortcut.vbs',)


def _scan_runtime():
 """作り直せる起動の部品。書きかけ（`.tmp`）は**若いうちは触らない**。"""
 out = []
 for d in _runtime_dirs():
  if not _safe(d.is_dir, False):
   continue
  for p in _safe(lambda dd=d: [x for x in dd.iterdir() if x.is_file()], []) or []:
   if p.name in RUNTIME_REGENERABLE:
    out.append(_item(p))
   elif p.name.endswith('.tmp'):
    it = _item(p)
    if time.time() - (it['mtime'] or 0) < TMP_MIN_AGE_SEC:
     it['keep'] = 'まだ書いている途中かもしれません'
    out.append(it)
 return out


# ------------------------------------------------------------------
# 種別の一覧。**画面はこの並びをそのまま出す**(判定を画面に持たない)
# ------------------------------------------------------------------
CATEGORIES = [
 {'key': 'mirror', 'label': '共有DBの写し（古い世代）', 'icon': '写',
  'note': '仕掛・品質データを手元へ写したファイルです。読むたびに作り直せます。',
  'why': 'いま読んでいる世代と、切り替えたばかりの世代を残します（%d分より古いものだけ消します）。' % int(TMP_MIN_AGE_SEC / 60),
  'auto': True, 'scan': _scan_mirror},
 {'key': 'tmp', 'label': '置き去りの一時ファイル', 'icon': '仮',
  'note': '書き換えの途中で作られる `.tmp` / `.incoming` です。正常に終われば自分で消えます。',
  'why': '%d分より古いものだけを消します（書いている最中のものには触りません）。' % int(TMP_MIN_AGE_SEC / 60),
  'auto': True, 'scan': _scan_tmp},
 {'key': 'logs', 'label': '古いログ（世代送りしたもの）', 'icon': '録',
  'note': 'app.log / launcher.log の1つ前より古い世代です。いま書いているログは残ります。',
  'why': '新しい世代と、決めた日数以内のものを残します。',
  'auto': True, 'scan': _scan_logs},
 {'key': 'rneBackup', 'label': 'RNE抽出のバックアップ（古い世代）', 'icon': '控',
  'note': 'RNEから抽出したデータを差し替える前の控えです。',
  'why': '新しい世代と、決めた日数以内のものを残します。',
  'auto': True, 'scan': _scan_rne_backup},
 {'key': 'pending', 'label': '適用されないまま残った抽出結果', 'icon': '保',
  'note': '公開先が使用中で保留になったファイルです。次の抽出で適用されると消えます。',
  'why': '決めた日数より古いものだけを消します。',
  'auto': True, 'scan': _scan_pending},
 {'key': 'work', 'label': '使われていない作業フォルダ', 'icon': '旧',
  'note': '置き場所を変える前のインストールが残した作業用の写しです。',
  'why': 'いま使っているフォルダ以外を消します。',
  'auto': False, 'scan': _scan_work},
 {'key': 'runtime', 'label': '起動の部品（作り直せるもの）', 'icon': '起',
  'note': 'ショートカットを作る補助スクリプトです。使うときに作り直されます。',
  'why': '**自動では消しません。** 押したときと、update.bat で更新したときだけ消します（起動前確認の刻印・ショートカットの絵は残します）。',
  'auto': False, 'scan': _scan_runtime},
 {'key': 'pycache', 'label': 'Pythonのバイトコード', 'icon': '速',
  'note': '起動を速くするための中間ファイルです（手元の置き場と、ソースの隣の `__pycache__`）。消しても動きますが、次の起動が一度だけ遅くなります。',
  'why': '**自動では消しません。** 押したときだけ消します。',
  'auto': False, 'scan': _scan_pycache},
]

_BY_KEY = {c['key']: c for c in CATEGORIES}


def _summarize(cat):
 items = _safe(cat['scan'], []) or []
 gone = [i for i in items if not i.get('keep')]
 kept = [i for i in items if i.get('keep')]
 def _oldest(rows):
  vals = [r['mtime'] for r in rows if r.get('mtime')]
  return min(vals) if vals else None
 return {'key': cat['key'], 'label': cat['label'], 'icon': cat['icon'],
         'note': cat['note'], 'why': cat['why'], 'auto': cat['auto'],
         'files': len(items), 'bytes': sum(i['size'] for i in items),
         'removable': len(gone), 'removableBytes': sum(i['size'] for i in gone),
         'kept': len(kept), 'oldest': _oldest(gone),
         # 何が消えるのかを**実物の名前で**見せる(推測させない・§CLAUDE 6)。
         'examples': [{'name': i['name'], 'size': i['size'], 'mtime': i['mtime'],
                       'dir': bool(i.get('dir'))}
                      for i in sorted(gone, key=lambda x: -x['size'])[:6]],
         'keptExamples': [{'name': i['name'], 'why': i['keep']}
                          for i in kept[:4]]}


def survey():
 """いま何がどれだけ溜まっているか。**失敗しても例外を投げない**——
 掃除の画面が開けなくなるほうが困る。"""
 cats = [_summarize(c) for c in CATEGORIES]
 with _lock:
  st = dict(_state)
 return {'categories': cats,
         'total': {'files': sum(c['files'] for c in cats),
                   'bytes': sum(c['bytes'] for c in cats),
                   'removable': sum(c['removable'] for c in cats),
                   'removableBytes': sum(c['removableBytes'] for c in cats)},
         'policy': policy(), 'state': st,
         'places': {'cache': str(_cache_dir() or ''), 'logs': str(_logs_dir() or ''),
                    'backup': str(_rne_backup_dir() or ''), 'work': str(_work_dir() or '')}}


def _remove(item):
 """1件消す。**消せなくても失敗にしない**(§9.108)——待てば消せるものなので
 次の周回へ回す。戻り値は消せたかどうか。"""
 p = Path(item['path'])
 if item.get('dir'):
  try:
   shutil.rmtree(p)
   return True
  except OSError:
   return False
 return bool(atomic_io.unlink(p, budget_sec=0.3, label='cleanup'))


def run(keys=None, dry_run=False, auto_only=False, log=True):
 """掃除する。`keys`が空なら全部の種別。戻り値は種別ごとの結果。

 `auto_only=True`は定期実行から呼ぶときで、**自動で消してよい種別だけ**に
 絞る(バイトコードのように「消すと遅くなる」ものを勝手に消さない)。"""
 want = set(keys or [])
 results = []
 removed = freed = failed = 0
 for cat in CATEGORIES:
  if want and cat['key'] not in want:
   continue
  if auto_only and not cat['auto']:
   continue
  items = [i for i in (_safe(cat['scan'], []) or []) if not i.get('keep')]
  n = b = ng = 0
  for it in items:
   if dry_run or _remove(it):
    n += 1
    b += it['size']
   else:
    ng += 1
  removed += n
  freed += b
  failed += ng
  results.append({'key': cat['key'], 'label': cat['label'], 'removed': n,
                  'bytes': b, 'failed': ng})
 if not dry_run:
  with _lock:
   _state['lastRunAt'] = time.time()
   _state['lastRemoved'] = removed
   _state['lastFreed'] = freed
   _state['lastError'] = failed_note({'results': results, 'failed': failed})
  if log and (removed or failed):
   app_logger().info('不要ファイルの掃除: %d件 %.1fMB を削除（消せなかったもの %d件）',
                     removed, freed / 1048576.0, failed)
 return {'results': results, 'removed': removed, 'bytes': freed, 'failed': failed,
         'dryRun': bool(dry_run)}


def failed_note(got):
 """消せなかった物の1文（無ければ空）。**次に何が起きるかは種別の決まりどおりに言う**——定期の掃除で
 消すのは`auto`の種別だけなので、作業フォルダ・起動の部品・バイトコードを含むのに「次の掃除で消えます」とは
 言わない（§9.497の追補3）。update.bat の画面と掃除の画面が同じ1文を使う。"""
 failed = int((got or {}).get('failed') or 0)
 if not failed:
  return ''
 auto = {c['key'] for c in CATEGORIES if c['auto']}
 manual = any(r.get('failed') and r.get('key') not in auto for r in (got or {}).get('results') or [])
 when = ('次の update.bat か、不要ファイルの掃除の「選んだものを掃除する」で消えます' if manual else '次の掃除で消えます')
 return '%d件は使用中のため消せませんでした（%s）' % (failed, when)


def run_for_update():
 """update.bat で更新したときの片付け（§9.497、利用者の指示「古いデータ(一時ファイルたち)を
 アップデートで一旦消して、作り直した方が良い」）。**全種別**——自動では消さないもの
 （バイトコード・使われていない作業フォルダ・起動の部品）も含める。どれも update.bat が
 直後に作り直すか、使うときに作り直される。残す物の決まり（`keep`）は種別ごとのまま。
 **ここではログへ書かない**——update.bat の画面は結果だけ（§9.431）で、記録は呼ぶ側の`say`が持つ。"""
 return run(log=False)


# ------------------------------------------------------------------
# 定期実行
# ------------------------------------------------------------------
def _loop():
 # 起動直後には走らせない。起動の忙しい時間に共有・ディスクを触らせない。
 _wake.wait(120)
 while True:
  try:
   if auto_enabled():
    run(auto_only=True)
  except Exception as e:
   with _lock:
    _state['lastError'] = str(e)
   app_logger().warning('不要ファイルの掃除に失敗しました: %s', e)
  _wake.clear()
  _wake.wait(interval_sec())


def start():
 global _thread
 if _thread is not None:
  return
 _thread = threading.Thread(target=_loop, name='file-cleanup', daemon=True)
 _thread.start()


def wake():
 """設定を変えたときに次の周回を早める。"""
 _wake.set()
