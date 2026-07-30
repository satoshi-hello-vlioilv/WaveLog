"""access_mode.py: 編集可能モード/閲覧モードの判定・切替・書込ガード。

複数の設備でこのアプリをローカル運用しており、通常は測定データの書き込みが
1台に閉じている想定(config/local.jsonのrecords_backup_export_pathで、その
1台が測定データバックアップをBox等へ複製し、他端末はそれを閲覧するだけ、
という運用を想定している)。

このモジュールは、この端末のログインID+PC名の組み合わせをアクセス権限
マスタ(backend/repositories/master_repo.py)と照合し、起動時の初期モードを
決める。該当行が無ければ「編集可能」を既定とする(既存の単一書き込みPC
運用を壊さないため。閲覧専用にしたい端末だけ明示的に登録する)。

起動後は、編集権限を持つ組み合わせに限りPOST /api/access-modeでモードを
切り替えられる(閲覧のみに固定された端末は自分で編集可能へは切り替えられ
ない)。権限は呼び出しのたびにマスタを読み直して判定するため、権限側の
変更(マスタ編集)が次回の切替から即座に反映される(再起動不要)。

モードはこのFlaskプロセス(=この端末)のメモリ上の状態であり、同じ端末で
開いている複数タブ間で共有される(単一端末単一サーバーの前提のため)。
"""
from flask import request, jsonify
import os
import socket
import threading

from .db_access import DBS, connect
from .repositories.master_repo import has_edit_permission

_lock=threading.Lock()
_mode='edit'  # 'edit' | 'view'

# 書込みを閲覧モードでブロックする対象Blueprint。読み取り専用API
# (tables/quality/core)やheartbeat等の生存監視、モード切替API自体
# (Blueprintに属さずapp直付けのため対象外)はここに含めない。
_GUARDED_BLUEPRINTS=('measurement','masters')

def current_login_id():
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return str(username or '').strip()

def current_pc_name():
 try:return str(socket.gethostname() or '').strip()
 except Exception:return ''

def _permitted():
 # マスタ未整備/未接続でも既定(編集可能)を維持する(安全側・互換ポリシー)。
 path=DBS['MASTER']['path']
 if not path.exists():return True
 try:
  with connect(path,True) as c:
   return has_edit_permission(c,current_login_id(),current_pc_name())
 except Exception:
  return True

def get_mode():
 with _lock:
  return _mode

def install(app):
 global _mode
 with _lock:
  _mode='edit' if _permitted() else 'view'

 @app.get('/api/access-mode')
 def access_mode_get():
  return jsonify(ok=True,mode=get_mode(),canEdit=_permitted(),loginId=current_login_id(),pcName=current_pc_name())

 @app.post('/api/access-mode')
 def access_mode_set():
  global _mode
  x=request.get_json(force=True) or {}
  mode=str(x.get('mode') or '').strip()
  if mode not in ('edit','view'):return jsonify(error='modeはeditまたはviewを指定してください。'),400
  if mode=='edit' and not _permitted():
   return jsonify(error='この端末は編集モードへ切り替える権限がありません。'),403
  with _lock:
   _mode=mode
  return jsonify(ok=True,mode=get_mode())

 @app.before_request
 def _guard_write():
  if get_mode()!='view':return None
  if request.blueprint not in _GUARDED_BLUEPRINTS:return None
  if request.method=='GET':return None
  return jsonify(error='閲覧モードのため、この操作は実行できません。編集モードへ切り替えてください。'),403

 return app
