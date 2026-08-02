"""schedule.py: スケジュール機能のBlueprint(docs/SCHEDULE_MODE_DESIGN.md §8)。

排他制御基盤(backend/schedule_sync.py、§4)の上に、作業予定・稼働カレンダー
マスタ・設備停止マスタのCRUD(backend/repositories/schedule_repo.py、§5)を
配線する。**時刻展開(稼働カレンダーからのETA計算・実績突合、§7)はまだ実装
していない**ため、`GET /api/schedule/plan` は展開前の生データ(順序・種別・
明細等)のみを返す。フェーズ3で `estimate`/`plannedStart`/`actual` 等の
フィールドをこのレスポンスへ追加する予定だが、`entries[].id/order/kind/...`
の形は変えない(URLも変えない)。

非GETは `_WRITE_ALLOWED_MODES` によりscheduleモードのみ許可されるが、
`plan_reorder` だけは `_ENDPOINT_EXTRA_MODES` によりeditモード(現場段取り
可否を持つ端末)にも開かれる(§3.1.1・§3.3・§7.5)。その等値端末が自分の
現場段取り対象設備以外を並べ替えようとしていないかは、access_mode.pyの
before_requestでは判定できない(設備名はリクエストボディの中)ため、この
ハンドラ内で追加チェックする。
"""
from flask import Blueprint, request, jsonify

from .. import schedule_sync
from ..repositories import schedule_repo as sr
from ..db_access import connect, request_user_id
from ..access_mode import current_login_id, current_pc_name, get_mode, current_permission_flags

bp=Blueprint('schedule',__name__)

@bp.get('/api/schedule/lock-status')
def lock_status():
 try:
  return jsonify(ok=True,**schedule_sync.lock_status())
 except Exception as e:
  return jsonify(error=str(e)),500

def _read(fn):
 """GET系共通。ロックを取らず、共有ファイルをローカルへ取得して読むだけ
 (§4.2の「取得」のみを行い、適用・反映はしない)。
 戻り値: (fn(c)の結果 or None, stale:bool, エラー種別 or None)"""
 try:
  local_path,stale=schedule_sync.fetch_snapshot()
 except schedule_sync.ScheduleNotConfigured:
  return None,False,'not_configured'
 except schedule_sync.ScheduleUnavailableError as e:
  return None,False,str(e)
 c=connect(local_path,False,'sqlite')
 try:
  result=fn(c)
 finally:
  c.close()
 return result,stale,None

def _write_response(apply_fn):
 """POST系共通。schedule_sync.with_write()の例外を§8.0のエラー応答形式へ
 変換する。apply_fn(c)の戻り値(dict)をそのまま応答へマージする。"""
 x=request.get_json(force=True) or {}
 uid=request_user_id(x)
 try:
  result=schedule_sync.with_write(current_login_id(),current_pc_name(),uid,apply_fn)
  return jsonify(ok=True,**(result or {}))
 except schedule_sync.ScheduleNotConfigured as e:
  return jsonify(error=str(e)),400
 except schedule_sync.LockHeldError as e:
  return jsonify(error=str(e),lockedBy={'loginId':e.holder_login,'pcName':e.holder_pc},retryAfterSec=e.retry_after_sec),423
 except schedule_sync.RevisionConflictError as e:
  return jsonify(error=str(e),revision=e.revision),409
 except schedule_sync.ScheduleUnavailableError as e:
  return jsonify(error=str(e)),503
 except ValueError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  return jsonify(error=str(e)),500

# ========================================================================
# 作業予定
# ========================================================================
def _plan_entry(r):
 # sr.plan_rows()/plan_row()の列順: 予定ID,設備名,表示順,種別,ロット番号,
 # 検査番号,鋳造番号,予定名称,明細JSON,固定開始日時,見積分,状態,実績測定ID,
 # 備考,有効,登録日時,更新日時,更新者ID
 import json as _json
 detail={}
 if r[8]:
  try:detail=_json.loads(r[8])
  except Exception:detail={}
 return {'id':r[0],'equipment':r[1],'order':r[2],'kind':r[3],
         'lotNo':r[4],'inspectionNo':r[5],'castingNo':r[6],
         'title':r[7],'detail':detail,'fixedStart':r[9],'estimateMinutes':r[10],
         'state':r[11],'actualRecordId':r[12],'remark':r[13],
         'reorderable':(r[11] or sr.PLAN_REORDERABLE_STATE)==sr.PLAN_REORDERABLE_STATE,
         'updatedAt':r[16].isoformat() if r[16] else None,'updatedBy':str(r[17] or '')}

@bp.get('/api/schedule/plan')
def plan_list():
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください(equipment)。'),400
 result,stale,err=_read(lambda c:[_plan_entry(r) for r in sr.plan_rows(c,equipment)])
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,entries=[])
 if err:return jsonify(error=err),503
 warnings=['スケジュールデータの取得に失敗したため、直前のローカルキャッシュを表示しています。'] if stale else []
 return jsonify(ok=True,configured=True,equipment=equipment,entries=result,warnings=warnings)

@bp.post('/api/schedule/plan/add')
def plan_add():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 kind=str(x.get('kind') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください。'),400
 def fn(c):
  pid=sr.plan_add(c,equipment,kind,request_user_id(x),position=str(x.get('position') or 'end'),
                   lot_no=str(x.get('lotNo') or ''),inspection_no=str(x.get('inspectionNo') or ''),
                   casting_no=str(x.get('castingNo') or ''),title=str(x.get('title') or ''),
                   detail=x.get('detail') or {},stop_reason_id=x.get('stopReasonId'),
                   estimate_minutes=x.get('estimateMinutes'),fixed_start=x.get('fixedStart'),
                   remark=str(x.get('remark') or ''))
  return {'id':pid}
 return _write_response(fn)

@bp.post('/api/schedule/plan/update')
def plan_update():
 x=request.get_json(force=True) or {}
 plan_id=x.get('id')
 if plan_id is None:return jsonify(error='更新対象の予定IDがありません。'),400
 fields={k:x[k] for k in ('estimateMinutes','fixedStart','remark','state') if k in x}
 def fn(c):
  n=sr.plan_update(c,plan_id,request_user_id(x),**fields)
  if n==0:raise ValueError('指定の予定が見つからないか、更新項目がありません。')
  return {'id':plan_id}
 return _write_response(fn)

@bp.post('/api/schedule/plan/delete')
def plan_delete():
 x=request.get_json(force=True) or {}
 plan_id=x.get('id')
 if plan_id is None:return jsonify(error='削除対象の予定IDがありません。'),400
 def fn(c):
  n=sr.plan_delete(c,plan_id,request_user_id(x))
  if n==0:raise ValueError('指定の予定が見つかりません。')
  return {'id':plan_id}
 return _write_response(fn)

@bp.post('/api/schedule/plan/reorder')
def plan_reorder():
 # §3.3・§7.5。editモード(現場段取り可否)経由の呼び出しは、before_requestの
 # _ENDPOINT_EXTRA_MODESで「並べ替え権限があるか」までは確認済みだが、
 # 「この端末の現場段取り対象設備と、リクエストのequipmentが一致するか」は
 # 設備名がリクエストボディの中にしか無いため、ここで追加チェックする。
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の並べ替えか指定してください。'),400
 if get_mode()=='edit':
  flags=current_permission_flags()
  from ..repositories.master_repo import normalize_equipment_name
  if not flags['canFieldReorder'] or normalize_equipment_name(flags['fieldReorderEquipment'])!=normalize_equipment_name(equipment):
   return jsonify(error='この端末には、この設備の現場段取り(並べ替え)権限がありません。'),403
 ordered_ids=x.get('orderedIds') or x.get('planIds') or []
 def fn(c):
  n=sr.plan_reorder(c,equipment,ordered_ids,request_user_id(x))
  return {'equipment':equipment,'reordered':n}
 return _write_response(fn)

# ========================================================================
# 稼働カレンダーマスタ
# ========================================================================
def _calendar_entry(r):
 # r: カレンダーID,設備名,区分,曜日,日付,稼働,開始時刻,終了時刻,表示順,有効
 return {'id':r[0],'equipment':r[1],'kind':r[2],'weekday':r[3],'date':r[4],
         'active':bool(r[5]),'start':r[6],'end':r[7]}

@bp.get('/api/schedule/calendar')
def calendar_list():
 equipment=str(request.args.get('equipment') or '').strip()
 result,stale,err=_read(lambda c:[_calendar_entry(r) for r in sr.calendar_rows(c,equipment)])
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,entries=[])
 if err:return jsonify(error=err),503
 return jsonify(ok=True,configured=True,equipment=equipment,entries=result,stale=stale)

@bp.post('/api/schedule/calendar')
def calendar_save():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 entries=x.get('entries') or []
 def fn(c):
  n=sr.calendar_sync(c,equipment,entries,request_user_id(x))
  return {'equipment':equipment,'saved':n}
 return _write_response(fn)

# ========================================================================
# 設備停止マスタ
# ========================================================================
def _stop_reason_entry(r):
 # r: 停止理由ID,設備名,分類,名称,標準所要分,色キー,表示順,有効,更新日時,更新者ID
 return {'id':r[0],'equipment':r[1],'category':r[2],'name':r[3],
         'standardMinutes':r[4],'colorKey':r[5],
         'updatedAt':r[8].isoformat() if r[8] else None,'updatedBy':str(r[9] or '')}

@bp.get('/api/schedule/stop-reason-master')
def stop_reason_list():
 equipment=str(request.args.get('equipment') or '').strip()
 result,stale,err=_read(lambda c:[_stop_reason_entry(r) for r in sr.stop_reason_rows(c,equipment or None)])
 if err=='not_configured':return jsonify(ok=True,configured=False,items=[])
 if err:return jsonify(error=err),503
 return jsonify(ok=True,configured=True,items=result,stale=stale)

@bp.post('/api/schedule/stop-reason-master')
def stop_reason_register():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 name=str(x.get('name') or '').strip()
 def fn(c):
  sid,created=sr.stop_reason_upsert(c,equipment,name,request_user_id(x),
                                     category=str(x.get('category') or ''),
                                     standard_minutes=x.get('standardMinutes'),
                                     color_key=str(x.get('colorKey') or ''))
  return {'id':sid,'created':created}
 return _write_response(fn)

@bp.post('/api/schedule/stop-reason-master/delete')
def stop_reason_delete():
 x=request.get_json(force=True) or {}
 sid=x.get('id')
 if sid is None:return jsonify(error='削除対象IDがありません。'),400
 def fn(c):
  n=sr.stop_reason_delete(c,sid,request_user_id(x))
  if n==0:raise ValueError('指定の設備停止理由が見つかりません。')
  return {'id':sid}
 return _write_response(fn)
