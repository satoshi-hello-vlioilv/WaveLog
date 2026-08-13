"""paths.py: アプリ本体と「実行中に変化するファイル」の置き場所を分ける。

ログ・実行時情報・キャッシュ等は、アプリ本体と同じ場所ではなくユーザー別の
ローカル領域(Windowsでは %LOCALAPPDATA%\\WaveLog)へ置く。アプリ本体を共有
フォルダーに置いた場合でも、端末ごとの実行状態が衝突せず、共有側へログや
キャッシュを大量生成しないようにするため。

配布形態(端末ごとのコピー / 共有フォルダー)がどちらでも破綻しないよう、
実行時ファイルは常にローカル領域へ置く。

**作り直せるファイルは、置き場が手元でなければ自動で手元へ逃がす**(§9.109)。
DBファイル(db/)そのものは既存データの移動を伴うため場所を維持するが、
「共有から写しただけ」「共有から取り直せる」ものは別で、共有・クラウド同期
フォルダーの上に置くと**Windowsでは置き換えが拒まれて更新できなくなる**
(§9.108)。利用者に設定を求めるのではなく、`work_dir()`が置き場を決める。

  db_dir が手元          → そのまま db_dir を使う(今までどおり)
  db_dir が共有/クラウド → %LOCALAPPDATA%\\WaveLog\\work\\<識別子>

**本物のデータ(master.sqlite3 / records.sqlite3)は動かさない。** 黙って
別の場所へ移すと、クラウドで同期されているつもりのデータが同期対象から
外れる。動かしてよいのは「消えても取り直せるもの」だけ。
"""
from pathlib import Path
import ctypes
import hashlib
import json
import os
import sys

from .config import LOCAL_DIR_NAME

APP_ROOT=Path(__file__).resolve().parent.parent

# ========================================================================
# 任意の設定ファイル(config/local.json)によるブートストラップ設定の上書き
#  - マスタDB(db/master.sqlite3)自体の置き場所を決める3項目
#    (db_dir/master_db_path/records_db_path)専用。この3つは、値をマスタDBの
#    中に保存すると「読みに行く先が分からないまま読みに行く」鶏と卵になる
#    ため、config/local.jsonでの上書きが唯一の設定手段として残る
#    (ブートストラップ専用の最小限のファイル)。
#  - それ以外(仕掛/品質データの読み込み先・共有パス・各種間隔設定)は
#    db/master.sqlite3側のパス設定マスタ(backend/db_access.pyの
#    PATH_CONFIG_TABLE)へ移行済みで、マスタ管理画面から編集する。
#    config/local.jsonに残っていた値は初回起動時に一度だけパス設定マスタへ
#    自動移行される(db_access.py の _migrate_legacy_path_config)。
#  - ファイルが無い/壊れている場合は空の設定として扱い、既存データの場所に
#    一切影響しない。
# ========================================================================
def load_local_config():
 path=APP_ROOT/'config'/'local.json'
 if not path.exists():
  return {}
 try:
  data=json.loads(path.read_text(encoding='utf-8'))
  return data if isinstance(data,dict) else {}
 except Exception:
  return {}

def configured_path(key):
 """config/local.jsonでのパス上書き値(db_dir/master_db_path/records_db_path
 専用)。未設定/該当なしはNone。"""
 value=load_local_config().get(key)
 return Path(value) if value else None

def local_root():
 """ユーザー別ローカル領域のルート。存在しなくてもパスだけ返す。"""
 base=os.environ.get('LOCALAPPDATA')          # Windows
 if not base:
  base=os.environ.get('XDG_DATA_HOME')        # Linux(サンドボックス等)
 if not base:
  return Path.home()/'.local'/'share'/LOCAL_DIR_NAME
 return Path(base)/LOCAL_DIR_NAME

def ensure_local_dirs():
 """ローカル領域の各フォルダを作成し、辞書で返す。"""
 root=local_root()
 dirs={name:root/name for name in ('runtime','logs','pycache','cache','work','backup')}
 for path in dirs.values():
  path.mkdir(parents=True,exist_ok=True)
 return dirs

def logs_dir():
 path=local_root()/'logs'; path.mkdir(parents=True,exist_ok=True); return path

def runtime_dir():
 path=local_root()/'runtime'; path.mkdir(parents=True,exist_ok=True); return path

def instance_file():
 """起動中のプロセス情報(PID・URL・アプリ配置場所)を書き出す先。"""
 return runtime_dir()/'instance.json'

# ========================================================================
# 共有フォルダー(ネットワーク)配置の検出
# SQLiteファイルをSMB共有上に置いて複数端末から書き込むと、ロックが正しく
# 効かず破損し得る。配置形態が未確定のため、検出したら警告をログへ残す。
# ========================================================================
_DRIVE_REMOTE=4

def is_network_path(path):
 """パスがUNCまたはネットワークドライブ上にあればTrue。

 **UNCの判定は resolve() の前に、渡された文字列そのもので行う。**
 resolve()は共有が落ちていると失敗し得るし、Linuxでは`\\\\server\\share`が
 ただのファイル名、`//server/share`が`/server/share`へ潰れてしまい、
 判定そのものが消える(この関数の要の分岐がテストで踏めなくなる)。"""
 raw=str(path)
 if raw.startswith('\\\\') or raw.startswith('//'):
  return True
 try:
  text=str(Path(path).resolve())
 except OSError:
  # 共有が落ちていると resolve() 自体が失敗する。**そのときは「手元ではない」**
  # と読む(確かめられないものを手元とみなすと、まさに壊れる場所へ写しに行く)。
  return True
 if text.startswith('\\\\') or text.startswith('//'):
  return True
 if sys.platform!='win32':
  return False
 drive=os.path.splitdrive(text)[0]
 if not drive:
  return False
 try:
  return ctypes.windll.kernel32.GetDriveTypeW(f'{drive}\\')==_DRIVE_REMOTE
 except Exception:
  return False

# ------------------------------------------------------------------------
# クラウド同期フォルダーの見分け(§9.108)
# Box Drive・OneDrive等は同期のあいだファイルを掴む。掴む時間が数秒〜数分と
# 桁違いに長いため、置き換えの再試行では吸収できない。名前で見分ける。
# **名前だけなので確証ではない**——だから「置けない」ではなく「置かない」
# 判断に使い、理由を添えて記録する。
# ------------------------------------------------------------------------
_CLOUD_MARKERS=(
 ('boxdrive','Box Drive'),('/box/','Box'),('\\box\\','Box'),
 ('onedrive','OneDrive'),('dropbox','Dropbox'),
 ('google drive','Google ドライブ'),('googledrive','Google ドライブ'),
 ('icloud','iCloud'),('nextcloud','Nextcloud'),
)

def cloud_sync_hint(path):
 """そのパスがクラウド同期フォルダーの中に見えるなら、その名前を返す。"""
 s=str(path or '').lower()
 if not s:
  return ''
 for marker,name in _CLOUD_MARKERS:
  if marker in s:
   return name
 return ''

# ========================================================================
# 「作り直せるファイル」の置き場(§9.109)
# ========================================================================
def db_dir():
 """DBの置き場所。config/local.jsonの"db_dir"で上書き可能。"""
 return configured_path('db_dir') or APP_ROOT/'db'

def _install_id():
 """同じPCに複数のインストールがあっても混ざらないための短い印。"""
 return hashlib.sha1(str(db_dir()).encode('utf-8',errors='replace')).hexdigest()[:8]

def _decide_work_dir():
 """作り直せるファイルをどこへ置くかを決める。→ (置き場, 理由)

 **判定は1回だけ**(work_dir()が覚える)。is_network_path()はresolve()を
 伴うので、リクエストのたびに呼ぶと共有が不調なときにそれ自体が詰まる
 原因になる(CLAUDE.md「共有DBを開く前にstatを置かない」と同じ理由)。"""
 base=db_dir()
 cloud=cloud_sync_hint(base)
 if cloud:
  return local_root()/'work'/_install_id(),f'{cloud}の中のため手元へ移しました'
 try:
  remote=is_network_path(base)
 except Exception:
  remote=False
 if remote:
  return local_root()/'work'/_install_id(),'ネットワーク上のため手元へ移しました'
 return base,''

_work_dir=None

def work_dir():
 """写し・作業コピーなど**作り直せるファイル**の置き場。

 置き場が手元なら`db_dir()`そのもの(今までどおり)。共有・クラウド同期
 フォルダーの上なら、ユーザー別のローカル領域へ自動で逃がす。"""
 global _work_dir
 if _work_dir is None:
  _work_dir=_decide_work_dir()
 path=_work_dir[0]
 try:
  path.mkdir(parents=True,exist_ok=True)
 except OSError:
  pass
 return path

def work_dir_reason():
 """手元へ逃がした理由(逃がしていなければ空文字)。画面・ログの説明用。"""
 if _work_dir is None:
  work_dir()
 return _work_dir[1]

def work_dir_relocated():
 return bool(work_dir_reason())

def reset_work_dir_cache():
 """検証用。判定をやり直させる。"""
 global _work_dir
 _work_dir=None
