"""schedule.py: スケジュール機能のBlueprint(docs/SCHEDULE_MODE_DESIGN.md §8)。

排他制御基盤(backend/schedule_sync.py、§4)の上に、作業予定・稼働カレンダー
マスタ・設備停止マスタ・換算係数上書きマスタ(DBテーブル名は既存互換の
ため`負荷率上書きマスタ`のまま)のCRUD(backend/repositories/
schedule_repo.py、§5)と、時刻展開・実績突合(backend/schedule_calc.py、
§7)・換算係数モデル(backend/load_factor.py、§6)を配線する。
`GET /api/schedule/plan` は展開済み(estimate/plannedStart/plannedEnd/
actual等を含む)のentriesを返す。種別='作業'の見積分は換算係数モデル
(§6)による対数線形推定(フェーズ5)。

非GETは `_WRITE_ALLOWED_MODES` によりscheduleモードのみ許可されるが、
`plan_reorder` だけは `_ENDPOINT_EXTRA_MODES` によりeditモード(現場段取り
可否を持つ端末)にも開かれる(§3.1.1・§3.3・§7.5)。その等値端末が自分の
現場段取り対象設備以外を並べ替えようとしていないかは、access_mode.pyの
before_requestでは判定できない(設備名はリクエストボディの中)ため、この
ハンドラ内で追加チェックする。
"""
import json
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify

from .. import schedule_sync
from .. import schedule_calc
from .. import load_factor
from ..repositories import schedule_repo as sr
from ..repositories.master_repo import normalize_equipment_name, equipment_master_rows
from ..db_access import connect, request_user_id, DBS
from ..access_mode import current_login_id, current_pc_name, get_mode, current_permission_flags

bp=Blueprint('schedule',__name__)

@bp.get('/api/schedule/lock-status')
def lock_status():
 try:
  return jsonify(ok=True,**schedule_sync.lock_status())
 except Exception as e:
  return jsonify(error=str(e)),500

# ========================================================================
# 編集セッション(§9.11新設): 設備単位の排他(schedule_sync.pyのSession系関数)
# ========================================================================
@bp.get('/api/schedule/session-status')
def session_status_get():
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備か指定してください(equipment)。'),400
 try:
  return jsonify(ok=True,**schedule_sync.session_status(equipment,current_login_id(),current_pc_name()))
 except Exception as e:
  return jsonify(error=str(e)),500

@bp.post('/api/schedule/session/acquire')
def session_acquire():
 # ハートビートも同じ実装(自分の分は延長、他端末保持中は弾く。§9.11)。
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備か指定してください(equipment)。'),400
 try:
  expires_at=schedule_sync.acquire_session(equipment,current_login_id(),current_pc_name())
  return jsonify(ok=True,equipment=equipment,expiresAt=expires_at)
 except schedule_sync.SessionHeldError as e:
  return jsonify(error=str(e),sessionLockedBy={'loginId':e.holder_login,'pcName':e.holder_pc},retryAfterSec=e.retry_after_sec),423
 except schedule_sync.ScheduleNotConfigured as e:
  return jsonify(error=str(e)),400
 except ValueError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  return jsonify(error=str(e)),500

@bp.post('/api/schedule/session/heartbeat')
def session_heartbeat():
 return session_acquire()

@bp.post('/api/schedule/session/release')
def session_release():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 if equipment:
  schedule_sync.release_session(equipment,current_login_id(),current_pc_name())
 return jsonify(ok=True)

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

def _cfg_read(fn):
 """設定系マスタ(稼働カレンダー・設備停止・勤務形態・換算係数上書き)の読み取り。
 これらはmaster.sqlite3(ローカル)にあるため、共有DBのスナップショット取得も
 ロックも要らない。ネットワーク共有が不調でもマスタ管理は使えるようにする狙い。"""
 sr.migrate_config_masters_from_shared()
 mc=sr.config_master_conn()
 try:
  sr.ensure_config_master_tables(mc)
  return fn(mc)
 finally:
  mc.close()

def _cfg_write_response(apply_fn):
 """設定系マスタの書込。他のマスタ(routes/masters.py)と同じ素直な
 「開く→書く→commit」で済む(共有DBのロック→取得→適用→反映サイクルは不要)。"""
 sr.migrate_config_masters_from_shared()
 mc=sr.config_master_conn()
 try:
  sr.ensure_config_master_tables(mc)
  result=apply_fn(mc)
  mc.commit()
  return jsonify(ok=True,**(result or {}))
 except ValueError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  return jsonify(error=str(e)),500
 finally:
  mc.close()

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
 except schedule_sync.SessionHeldError as e:
  return jsonify(error=str(e),sessionLockedBy={'loginId':e.holder_login,'pcName':e.holder_pc},retryAfterSec=e.retry_after_sec),423
 except schedule_sync.RevisionConflictError as e:
  return jsonify(error=str(e),revision=e.revision),409
 except schedule_sync.ScheduleUnavailableError as e:
  return jsonify(error=str(e)),503
 except ValueError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  return jsonify(error=str(e)),500

def _check_session(equipment):
 # scheduleモード(§9.11の編集セッション対象)のときだけ強制する。editモードの
 # 現場段取り(§3.1.1、plan_reorderのみ許可)は個別の並べ替え権限で既に
 # ガードされており、この端末はそもそもセッションを取得できない
 # (POST /api/schedule/session/*はscheduleモード限定のBlueprintのため)。
 # ここで一律に要求すると現場段取り自体が機能しなくなってしまうため対象外。
 if get_mode()=='schedule':
  schedule_sync.require_session(equipment,current_login_id(),current_pc_name())

# ========================================================================
# 作業予定
# ========================================================================
@bp.get('/api/schedule/plan')
def plan_list():
 # §7.3・§8.1。schedule_calc.expand_plan()が稼働カレンダーの展開・実績突合
 # (状態の動的導出)まで行った完成形を返す(DBへは書き戻さない)。
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください(equipment)。'),400
 # history_hours(§9.33): 計画外実績の完了分をどこまでさかのぼるか。画面の
 # 「表示範囲」と同じ値をフロントが送る。青天井にすると端末の全測定履歴が
 # 毎回合成されるため、上限を切っておく。
 history_hours=schedule_calc.DEFAULT_HISTORY_HOURS
 raw=request.args.get('history_hours')
 if raw is not None:
  try:history_hours=max(0.0,min(float(raw),24.0*90))
  except (TypeError,ValueError):pass
 result,stale,err=_read(lambda c:schedule_calc.expand_plan(c,equipment,history_hours=history_hours))
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,entries=[],anchor=None,warnings=[])
 if err:return jsonify(error=err),503
 warnings=list(result.get('warnings') or [])
 if stale:warnings.append('スケジュールデータの取得に失敗したため、直前のローカルキャッシュを表示しています。')
 return jsonify(ok=True,configured=True,equipment=equipment,entries=result['entries'],anchor=result.get('anchor'),
                loadFactor=result.get('loadFactor'),historyHours=history_hours,warnings=warnings)

@bp.post('/api/schedule/plan/add')
def plan_add():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 kind=str(x.get('kind') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください。'),400
 def fn(c):
  _check_session(equipment)
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
  row=sr.plan_row(c,plan_id)
  if row:_check_session(row[1])
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
  row=sr.plan_row(c,plan_id)
  if row:_check_session(row[1])
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
  _check_session(equipment)
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
 entries=_cfg_read(lambda mc:[_calendar_entry(r) for r in sr.calendar_rows(mc,equipment)])
 return jsonify(ok=True,configured=True,equipment=equipment,entries=entries,stale=False)

@bp.post('/api/schedule/calendar')
def calendar_save():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 entries=x.get('entries') or []
 def fn(mc):
  n=sr.calendar_sync(mc,equipment,entries,request_user_id(x))
  return {'equipment':equipment,'saved':n}
 return _cfg_write_response(fn)

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
 items=_cfg_read(lambda mc:[_stop_reason_entry(r) for r in sr.stop_reason_rows(mc,equipment or None)])
 return jsonify(ok=True,configured=True,items=items,stale=False)

@bp.post('/api/schedule/stop-reason-master')
def stop_reason_register():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 name=str(x.get('name') or '').strip()
 def fn(mc):
  sid,created=sr.stop_reason_upsert(mc,equipment,name,request_user_id(x),
                                     category=str(x.get('category') or ''),
                                     standard_minutes=x.get('standardMinutes'),
                                     color_key=str(x.get('colorKey') or ''))
  return {'id':sid,'created':created}
 return _cfg_write_response(fn)

@bp.post('/api/schedule/stop-reason-master/delete')
def stop_reason_delete():
 x=request.get_json(force=True) or {}
 sid=x.get('id')
 if sid is None:return jsonify(error='削除対象IDがありません。'),400
 def fn(mc):
  n=sr.stop_reason_delete(mc,sid,request_user_id(x))
  if n==0:raise ValueError('指定の設備停止理由が見つかりません。')
  return {'id':sid}
 return _cfg_write_response(fn)

# ========================================================================
# 勤務体系マスタ / 勤務区分マスタ(§5.5改訂): 「日勤」「交替勤務(1,2,3直)」の
# ような勤務体系(親)の下に、各直の時間帯(子=勤務区分)をぶら下げた2階層。
# タイムラインの「勤務」列(schedule_calc.expand_plan()のentries[].shift)は
# sr.shift_rows()経由でこのマスタを参照する。
# ========================================================================
def _pattern_entry(mc,r):
 # r: 勤務体系ID,適用設備,名称,表示順,有効
 return {'id':r[0],'equipment':r[1],'name':r[2],
         'segments':[{'id':s[0],'name':s[2],'start':s[3],'end':s[4]} for s in sr.shift_segment_rows(mc,r[0])]}

@bp.get('/api/schedule/shift-pattern-master')
def shift_pattern_list():
 """equipment未指定なら全件(マスタ管理の一覧)。指定時はその設備に適用される
 体系(設備専用があればそれ、無ければ全設備既定)を返す。"""
 equipment=str(request.args.get('equipment') or '').strip()
 scope=request.args.get('scope') or ''
 def fn(mc):
  sr.migrate_shift_patterns(mc)
  if scope=='all' or not equipment:
   rows=sr.shift_pattern_rows(mc,'__all__')
  else:
   rows=sr.shift_pattern_rows(mc,equipment) or sr.shift_pattern_rows(mc,None)
  return [_pattern_entry(mc,r) for r in rows]
 return jsonify(ok=True,configured=True,items=_cfg_read(fn),stale=False)

@bp.post('/api/schedule/shift-pattern-master')
def shift_pattern_save():
 """勤務体系と、その配下の勤務区分をまとめて保存する(区分は全置換)。
 親子を1リクエストで保存することで、片方だけ保存された中途半端な状態を作らない。"""
 x=request.get_json(force=True) or {}
 pattern_id=x.get('id')
 equipment=str(x.get('equipment') or '').strip()
 name=str(x.get('name') or '').strip()
 segments=x.get('segments')
 if segments is not None and not isinstance(segments,list):
  return jsonify(error='勤務区分の指定が不正です。'),400
 def fn(mc):
  uid=request_user_id(x)
  pid,created=sr.shift_pattern_upsert(mc,pattern_id,equipment,name,uid)
  saved=sr.shift_segment_sync(mc,pid,segments or [],uid) if segments is not None else None
  return {'id':pid,'created':created,'savedSegments':saved}
 return _cfg_write_response(fn)

@bp.post('/api/schedule/shift-pattern-master/delete')
def shift_pattern_delete_route():
 x=request.get_json(force=True) or {}
 pid=x.get('id')
 if pid is None:return jsonify(error='削除対象IDがありません。'),400
 def fn(mc):
  n=sr.shift_pattern_delete(mc,pid,request_user_id(x))
  if n==0:raise ValueError('指定の勤務体系が見つかりません。')
  return {'id':pid}
 return _cfg_write_response(fn)

# ========================================================================
# 換算係数モデル(§6、フェーズ5)
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
 if not equipment:return jsonify(error='どの設備の換算係数か指定してください(equipment)。'),400
 def fn(mc):
  rows=sr.load_factor_override_rows(mc)
  return [r for r in rows if not r[1] or normalize_equipment_name(r[1])==normalize_equipment_name(equipment)]
 overrides_rows=_cfg_read(fn)
 model=load_factor.get_model(equipment)
 return jsonify(ok=True,configured=True,equipment=equipment,
                model=_load_factor_summary(model,overrides_rows),stale=False)

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
 def fn(mc):
  if coefficient is None:
   rows=sr.load_factor_override_rows(mc,equipment)
   target=next((r for r in rows if str(r[2] or '')==factor and str(r[3] or '')==level),None)
   if target is None:raise ValueError('解除対象の上書きが見つかりません。')
   sr.load_factor_override_delete(mc,target[0],request_user_id(x))
   return {'equipment':equipment,'factor':factor,'level':level,'cleared':True}
  oid,created=sr.load_factor_override_upsert(mc,equipment,factor,level,request_user_id(x),
                                              coefficient=float(coefficient),reason=str(x.get('reason') or ''))
  return {'id':oid,'created':created}
 return _cfg_write_response(fn)

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
 # 見積は換算係数上書きマスタ(master.sqlite3)しか読まないため、共有DBの
 # スナップショット取得は不要。
 result=_cfg_read(lambda mc:load_factor.estimate_work(mc,equipment,detail))
 return jsonify(ok=True,configured=True,equipment=equipment,lot=str(request.args.get('lot') or ''),
                estimate=result,stale=False)

@bp.get('/api/schedule/accuracy')
def accuracy():
 # §6.9・§9.8「見積 vs 実測」の指標(中央値バイアス・MAPE相当)。実績データ
 # (共有測定バックアップ)側の読み込みのみで、共有スケジュールDBには触れない
 # ため、_read()のロック/改訂番号サイクルは使わない(GETかつ読み取り専用)。
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備の精度を見るか指定してください(equipment)。'),400
 result=load_factor.accuracy(equipment)
 return jsonify(ok=True,equipment=equipment,**result)

# ========================================================================
# 全設備横断の俯瞰ボード(§9.9、フェーズ9)
# ========================================================================
# 俯瞰ボードのミニタイムラインに表示する予定は直近何時間分か。あまり長いと
# 1本の帯の中で各予定が細くなり読めなくなるため、フロント側の既定表示幅
# (24時間)より少し長めに持たせておき、48時間ボタンでも取り直し不要にする。
OVERVIEW_WINDOW_HOURS=48

def _overview_row(equipment,expanded,now):
 # expand_plan()の結果(§7、schedule_calc.py)を1設備1行分の俯瞰情報へ圧縮する。
 # 独自の時刻計算はしない(展開はexpand_plan()に一本化、CLAUDE.mdの
 # 「関数の定義は1箇所」)。ここでは表示用に必要な項目だけを抜き出すのみ。
 entries=expanded['entries']
 window_end=now+timedelta(hours=OVERVIEW_WINDOW_HOURS)
 blocks=[]
 pending_minutes=0.0
 pending_count=0
 active=None
 max_overdue=0.0
 for e in entries:
  if e['state']=='着手':
   active={'id':e['id'],'lotNo':e.get('lotNo'),'title':e.get('title'),
           'elapsedMinutes':(e.get('actual') or {}).get('elapsedMinutes')}
  elif e['state']==sr.PLAN_REORDERABLE_STATE:
   pending_count+=1
   pending_minutes+=(e.get('estimate') or {}).get('minutes') or 0.0
  if e.get('overdueMinutes'):max_overdue=max(max_overdue,e['overdueMinutes'])
  if e['state'] in ('着手',sr.PLAN_REORDERABLE_STATE) and e.get('plannedStart') and e.get('plannedEnd'):
   try:
    start=datetime.fromisoformat(e['plannedStart']);end=datetime.fromisoformat(e['plannedEnd'])
   except Exception:
    continue
   if end<now or start>window_end:continue
   blocks.append({'id':e['id'],'kind':e['kind'],'state':e['state'],
                   'plannedStart':e['plannedStart'],'plannedEnd':e['plannedEnd'],
                   'lotNo':e.get('lotNo'),'title':e.get('title'),
                   'overdueMinutes':e.get('overdueMinutes') or 0})
   if len(blocks)>=40:break
 return {'equipment':equipment,'anchor':expanded.get('anchor'),'active':active,
         'pendingCount':pending_count,'pendingMinutes':round(pending_minutes,1),
         'maxOverdueMinutes':round(max_overdue,1),'blocks':blocks,
         'warningCount':len(expanded.get('warnings') or [])}

@bp.get('/api/schedule/overview')
def overview():
 # §9.9「全設備横断の俯瞰ボード」。共有スケジュールDBの取得は1回だけ行い
 # (_read()、§4.2の「取得」のみ)、設備マスタから取れる有効設備の数だけ
 # expand_plan()をメモリ上で繰り返し呼ぶ(設備ごとにファイルを取り直さない)。
 with connect(DBS['MASTER']['path'],False) as mc:
  equipment_names=[str(r[1]).strip() for r in equipment_master_rows(mc) if str(r[1] or '').strip()]
 now=datetime.now()
 def fn(c):
  # 俯瞰ボードは「今どこが動いているか/残りどれだけか」だけを見るため、
  # 計画外実績(§9.33)の完了分は合成しない(history_hours=None)。実施中の
  # 分は合成されるので、予定を立てずに始めた作業も「● 稼働中」に出る。
  return [_overview_row(eq,schedule_calc.expand_plan(c,eq,now=now,history_hours=None),now) for eq in equipment_names]
 result,stale,err=_read(fn)
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=[],generatedAt=now.isoformat())
 if err:return jsonify(error=err),503
 return jsonify(ok=True,configured=True,equipment=result,generatedAt=now.isoformat(),stale=stale)
