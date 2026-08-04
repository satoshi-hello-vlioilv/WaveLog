"""paths.py: アプリ本体と「実行中に変化するファイル」の置き場所を分ける。

ログ・実行時情報・キャッシュ等は、アプリ本体と同じ場所ではなくユーザー別の
ローカル領域(Windowsでは %LOCALAPPDATA%\\WaveLog)へ置く。アプリ本体を共有
フォルダーに置いた場合でも、端末ごとの実行状態が衝突せず、共有側へログや
キャッシュを大量生成しないようにするため。

配布形態(端末ごとのコピー / 共有フォルダー)がどちらでも破綻しないよう、
実行時ファイルは常にローカル領域へ置く。一方DBファイル(db/)は既存データの
移動を伴うため現状の場所を維持し、共有配置を検出した場合に警告だけ出す。
"""
from pathlib import Path
import ctypes
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
 """パスがUNCまたはネットワークドライブ上にあればTrue。"""
 text=str(Path(path).resolve())
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
