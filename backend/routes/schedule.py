"""schedule.py: スケジュール機能のBlueprint(docs/SCHEDULE_MODE_DESIGN.md §8)。

排他制御基盤(backend/schedule_sync.py、§4)の上に、作業予定・稼働カレンダー
マスタ・設備停止マスタ・負荷率上書きマスタのCRUD(backend/repositories/
schedule_repo.py、§5)と、時刻展開・実績突合(backend/schedule_calc.py、
§7)・負荷率モデル(backend/load_factor.py、§6)を配線する。
`GET /api/schedule/plan` は展開済み(estimate/plannedStart/plannedEnd/
actual等を含む)のentriesを返す。種別='作業'の見積分は負荷率モデル
(§6)による対数線形推定(フェーズ5)。

非GETは `_WRITE_ALLOWED_MODES` によりscheduleモードのみ許可されるが、
`plan_reorder` だけは `_ENDPOINT_EXTRA_MODES` によりeditモード(現場段取り
可否を持つ端末)にも開かれる(§3.1.1・§3.3・§7.5)。その等値端末が自分の
現場段取り対象設備以外を並べ替えようとしていないかは、access_mode.pyの
before_requestでは判定できない(設備名はリクエストボディの中)ため、この
ハンドラ内で追加チェックする。
"""
import json

from flask import Blueprint, request, jsonify

from .. import schedule_sync
from .. import schedule_calc
from .. import load_factor
from ..repositories import schedule_repo as sr
from ..repositories.master_repo import normalize_equipment_name
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
@bp.get('/api/schedule/plan')
def plan_list():
 # §7.3・§8.1。schedule_calc.expand_plan()が稼働カレンダーの展開・実績突合
 # (状態の動的導出)まで行った完成形を返す(DBへは書き戻さない)。
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください(equipment)。'),400
 result,stale,err=_read(lambda c:schedule_calc.expand_plan(c,equipment))
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,entries=[],anchor=None,warnings=[])
 if err:return jsonify(error=err),503
 warnings=list(result.get('warnings') or [])
 if stale:warnings.append('スケジュールデータの取得に失敗したため、直前のローカルキャッシュを表示しています。')
 return jsonify(ok=True,configured=True,equipment=equipment,entries=result['entries'],anchor=result.get('anchor'),
                loadFactor=result.get('loadFactor'),warnings=warnings)

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
  if not flags['canFieldReorder'] or normalize_equipment_name(flags['fieldReorderEquipment'])!=normalize_equipment_name(equipment):
   return jsonify(error='この端末には、この設備の現場段取り(並べ替え)権限がありません。'),403
 ordered_ids=x.get('orderedIds') or x.get('planIds') or []
 def fn(c):
  # §7.5手順1〜2: 実績突合込みで導出した状態から「実質的に予定」なIDだけを
  # 並べ替え対象にする(DBの[状態]列だけを見ると、実績突合で既に着手/完了
  # 相当になっている予定を誤って動かせてしまう)。
  expanded=schedule_calc.expand_plan(c,equipment)
  reorderable_ids={e['id'] for e in expanded['entries'] if e.get('reorderable')}
  n=sr.plan_reorder(c,equipment,ordered_ids,request_user_id(x),reorderable_ids=reorderable_ids)
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

# ========================================================================
# 負荷率モデル(§6、フェーズ5)
# ========================================================================
def _override_entry(r):
 # r: 上書きID,設備名,因子,水準,係数,理由,有効,更新日時,更新者ID
 return {'id':r[0],'equipment':r[1],'factor':r[2],'level':r[3],'coefficient':r[4],'reason':str(r[5] or ''),
         'updatedAt':r[7].isoformat() if r[7] else None,'updatedBy':str(r[8] or '')}

def _load_factor_summary(model,overrides_rows):
 # モデル辞書(backend/load_factor.py `_fit`/`_compute_model`の戻り値)を
 # §6.6「係数・N数・σ・ビン境界・除外件数」のAPI応答形へ整形する。
 if model is None:return None
 factors=[]
 counts=model.get('counts') or {}
 for key,levels in (model.get('factors') or {}).items():
  for level,value in levels.items():
   factors.append({'key':key,'level':level,'value':round(value,3),'n':counts.get(key,{}).get(level,0)})
 boundaries={k:(list(v) if v else None) for k,v in (model.get('boundaries') or {}).items()}
 return {'basis':model.get('basis'),'equipment':model.get('equipment'),'n':model.get('n'),
         'excluded':model.get('excluded'),'T0':round(model.get('T0') or 0.0,1),
         'sigmaLog':round(model.get('sigmaLog') or 0.0,3),'calculatedAt':model.get('calculatedAt'),
         'boundaries':boundaries,'factors':factors,
         'overrides':[_override_entry(r) for r in overrides_rows]}

@bp.get('/api/schedule/load-factors')
def load_factor_list():
 # §6.6・§8.3。係数・N数・σ・ビン境界・除外件数と、この設備+全設備共通の
 # 手動上書き一覧を返す。モデル自体はload_factor.py側でプロセス内キャッシュ
 # 済み(§6.6)。上書き一覧だけスケジュール共有DBから都度取得する。
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の負荷率か指定してください(equipment)。'),400
 def fn(c):
  rows=sr.load_factor_override_rows(c)
  return [r for r in rows if not r[1] or normalize_equipment_name(r[1])==normalize_equipment_name(equipment)]
 overrides_rows,stale,err=_read(fn)
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,model=None)
 if err:return jsonify(error=err),503
 model=load_factor.get_model(equipment)
 return jsonify(ok=True,configured=True,equipment=equipment,
                model=_load_factor_summary(model,overrides_rows),stale=stale)

@bp.post('/api/schedule/load-factors/override')
def load_factor_override_save():
 # §6.7「係数 = 上書きマスタに行があればその値」の上書きマスタ本体を保存/
 # 解除する。因子='BASE'は水準=''固定でT0(基準時間)自体を上書きする。
 # 上書きはestimate_work()が呼び出しのたびに読み直す(§6.7)ため、モデルの
 # プロセス内キャッシュ(get_model)は無効化不要。
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 factor=str(x.get('factor') or '').strip()
 level='' if factor=='BASE' else str(x.get('level') or '').strip()
 coefficient=x.get('coefficient')
 if not factor:return jsonify(error='因子を指定してください。'),400
 def fn(c):
  if coefficient is None:
   rows=sr.load_factor_override_rows(c,equipment)
   target=next((r for r in rows if str(r[2] or '')==factor and str(r[3] or '')==level),None)
   if target is None:raise ValueError('解除対象の上書きが見つかりません。')
   sr.load_factor_override_delete(c,target[0],request_user_id(x))
   return {'equipment':equipment,'factor':factor,'level':level,'cleared':True}
  oid,created=sr.load_factor_override_upsert(c,equipment,factor,level,request_user_id(x),
                                              coefficient=float(coefficient),reason=str(x.get('reason') or ''))
  return {'id':oid,'created':created}
 return _write_response(fn)

@bp.post('/api/schedule/load-factors/recalc')
def load_factor_recalc():
 # §6.6「POST /api/schedule/load-factors/recalc でキャッシュ破棄・再計算」。
 # 実績データ(共有測定バックアップ)はこのアプリの書込対象外のため、
 # 共有スケジュールDBのロック/改訂番号は使わない(プロセス内キャッシュの
 # 破棄のみ)。
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備を再計算するか指定してください(equipment)。'),400
 load_factor.invalidate_cache(equipment)
 model=load_factor.get_model(equipment,force=True)
 return jsonify(ok=True,equipment=equipment,model=_load_factor_summary(model,[]) if model else None)

@bp.get('/api/schedule/estimate')
def estimate_preview():
 # §6.7・§6.8・§8「単一ロットの見積(内訳付き)」。明細(detail)はフロントが
 # 仕掛一覧の行からaliases(static/js/base.js)で作って渡す
 # (§5.1と同じ規約。サーバー側でSIKALOTNOWのエイリアス解決を再実装しない)。
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の見積か指定してください(equipment)。'),400
 detail_raw=request.args.get('detail') or '{}'
 try:
  detail=json.loads(detail_raw)
  if not isinstance(detail,dict):detail=None
 except Exception:
  detail=None
 if detail is None:return jsonify(error='detail(明細JSON)の形式が不正です。'),400
 def fn(c):
  return load_factor.estimate_work(c,equipment,detail)
 result,stale,err=_read(fn)
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,estimate=None)
 if err:return jsonify(error=err),503
 return jsonify(ok=True,configured=True,equipment=equipment,lot=str(request.args.get('lot') or ''),
                estimate=result,stale=stale)
