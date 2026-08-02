"""access_mode.py: 編集可能モード/閲覧モード/スケジュールモードの判定・切替・書込ガード。

複数の設備でこのアプリをローカル運用しており、通常は測定データの書き込みが
1台に閉じている想定(config/local.jsonのrecords_backup_export_pathで、その
1台が測定データバックアップをBox等へ複製し、他端末はそれを閲覧するだけ、
という運用を想定している)。

このモジュールは、この端末のログインID+PC名の組み合わせをアクセス権限
マスタ(backend/repositories/master_repo.py)と照合し、起動時の初期モードを
決める。該当行が無ければ「編集可能」を既定とする(既存の単一書き込みPC
運用を壊さないため。閲覧専用/スケジュール専用にしたい端末だけ明示的に登録する)。

3モード(docs/SCHEDULE_MODE_DESIGN.md §3.1):
  edit     編集可能モード   測定データ・マスタへ書込可、作業予定へは読み取りのみ
  view     閲覧モード       すべて読み取りのみ
  schedule スケジュールモード 作業予定へ書込可、測定データ・マスタは読み取りのみ
             (閲覧モードの上位互換ではない。測定データ・マスタは閲覧モードと
              同じく禁止で、作業予定という別ドメインの書込だけが開く)

現場段取り(§3.1.1)はモードとは別軸の真偽値(現場段取り可否)で、editモードの
端末に限り「作業予定の並べ替えAPIだけ」を追加で許可する権限。モードを増やす
のではなく書込1操作だけを許可する権限として設計している。

起動後は、権限のあるモードへPOST /api/access-modeで切り替えられる(切替可能な
モードの組み合わせは§3.2の表を参照)。権限は呼び出しのたびにマスタを読み直して
判定するため、権限側の変更(マスタ編集)が次回の切替から即座に反映される
(再起動不要)。

モードはこのFlaskプロセス(=この端末)のメモリ上の状態であり、同じ端末で
開いている複数タブ間で共有される(単一端末単一サーバーの前提のため)。
"""
from flask import request, jsonify
import os
import socket
import threading

from .db_access import DBS, connect
from .repositories.master_repo import permission_flags

_lock=threading.Lock()
_mode='edit'  # 'edit' | 'view' | 'schedule'

# Blueprint名 -> 非GETを許可するモードの集合。未宣言のBlueprintは従来どおり
# 素通しにする(tables/quality/core等の読み取り専用Blueprintは非GETを持たない)。
# 新しい書込系Blueprintを追加する場合は必ずここへ追記すること(書き漏れは
# 「どのモードでも通らない」側に倒れる安全側の既定)。
_WRITE_ALLOWED_MODES={
 'measurement':{'edit'},
 'masters':{'edit'},
 'schedule':{'schedule'},
}
# 上の表より広く許可する例外(エンドポイント名 -> 追加で許可するモード)。
# 現場段取り: 並べ替えAPI(schedule.plan_reorder)だけをeditにも開ける。
# 新しい書込系エンドポイントをここへ追記する際は、権限の絞り込みを
# ハンドラ側(_field_reorder_permitted等)で必ず二重に行うこと。
_ENDPOINT_EXTRA_MODES={
 'schedule.plan_reorder':{'edit'},
}

def current_login_id():
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return str(username or '').strip()

def current_pc_name():
 try:return str(socket.gethostname() or '').strip()
 except Exception:return ''

def _permission_flags():
 # マスタ未整備/未接続でも既定(編集可・スケジュール不可・現場段取り不可)を
 # 維持する(安全側・互換ポリシー。master_repo.permission_flagsの既定と同じ)。
 path=DBS['MASTER']['path']
 if not path.exists():
  return {'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':''}
 try:
  with connect(path,True) as c:
   return permission_flags(c,current_login_id(),current_pc_name())
 except Exception:
  return {'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':''}

def _permitted():
 return _permission_flags()['canEdit']

def _field_reorder_permitted():
 return _permission_flags()['canFieldReorder']

def _initial_mode(flags):
 # docs/SCHEDULE_MODE_DESIGN.md §3.2の表のとおり。
 if flags['canEdit']:return 'edit'
 if flags['canSchedule']:return 'schedule'
 return 'view'

def _allowed_modes(flags):
 modes={'view'}
 if flags['canEdit']:modes.add('edit')
 if flags['canSchedule']:modes.add('schedule')
 return modes

def get_mode():
 with _lock:
  return _mode

def install(app):
 global _mode
 with _lock:
  _mode=_initial_mode(_permission_flags())

 @app.get('/api/access-mode')
 def access_mode_get():
  flags=_permission_flags()
  return jsonify(ok=True,mode=get_mode(),canEdit=flags['canEdit'],canSchedule=flags['canSchedule'],
                 canFieldReorder=flags['canFieldReorder'],fieldReorderEquipment=flags['fieldReorderEquipment'],
                 loginId=current_login_id(),pcName=current_pc_name())

 @app.post('/api/access-mode')
 def access_mode_set():
  global _mode
  x=request.get_json(force=True) or {}
  mode=str(x.get('mode') or '').strip()
  if mode not in ('edit','view','schedule'):return jsonify(error='modeはedit・view・scheduleのいずれかを指定してください。'),400
  flags=_permission_flags()
  if mode not in _allowed_modes(flags):
   return jsonify(error='この端末はそのモードへ切り替える権限がありません。'),403
  with _lock:
   _mode=mode
  return jsonify(ok=True,mode=get_mode())

 @app.before_request
 def _guard_write():
  if request.method=='GET':return None
  bp=request.blueprint
  if bp is None:return None            # app直付け(モード切替API・shutdown等)は対象外
  allowed=_WRITE_ALLOWED_MODES.get(bp)
  if allowed is None:return None       # 未宣言のBlueprintは従来どおり素通し
  mode=get_mode()
  if mode in allowed:return None
  extra=_ENDPOINT_EXTRA_MODES.get(request.endpoint)
  if extra and mode in extra:
   if mode=='edit' and not _field_reorder_permitted():
    return jsonify(error='この端末には現場段取り(並べ替え)の権限がありません。'),403
   return None                         # schedule.plan_reorder自身はequipment一致
                                        # チェックをハンドラ側で行う(§7.5)
  return jsonify(error='現在のモードでは、この操作は実行できません。'),403

 return app
