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
import time
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify, g

from .. import schedule_sync
from .. import schedule_calc
from .. import load_factor
from ..repositories import schedule_repo as sr
from ..repositories.master_repo import normalize_equipment_name, equipment_master_rows, field_reorder_equipment_allows
from ..db_access import connect, request_user_id, request_pc_name, DBS
from ..access_mode import current_login_id, current_pc_name, get_mode, current_permission_flags
from ..logging_setup import app_logger

bp=Blueprint('schedule',__name__)

@bp.get('/api/schedule/lock-status')
def lock_status():
 try:
  return jsonify(ok=True,**schedule_sync.lock_status())
 except Exception as e:
  return jsonify(error=str(e)),500

# ========================================================================
# 共有の見張り(§9.188)
# ========================================================================
# 「いつ取り込んだのか」「他のPCの変更を掴んでいるのか」を画面へ出すため。
# **覚えていることは画面に書く**——黙って写しを見せると、他の端末の変更が
# 来ていないように見える(実際に来ていないのか、まだ確かめていないのかを
# 利用者が区別できない)。
@bp.get('/api/schedule/sync-status')
def sync_status():
 try:
  return jsonify(ok=True,**schedule_sync.watch_status())
 except Exception as e:
  return jsonify(error=str(e)),500

@bp.get('/api/schedule/owner-status')
def owner_status():
 """持ち主の状態(§9.192)。**誰が持ち主で、どのURLで話しているか**を画面へ。"""
 try:
  from .. import schedule_owner
  return jsonify(ok=True,**schedule_owner.status())
 except Exception as e:
  return jsonify(error=str(e)),500

@bp.post('/api/schedule/sync-now')
def sync_now():
 # いま取り込む。**読むだけ**なので閲覧モードからも通す
 # (access_mode._READ_ONLY_POST_ENDPOINTSへ登録済み)。
 try:
  from .. import schedule_watch
  result=schedule_watch.schedule_watch_once()
  schedule_watch.wake()
  return jsonify(ok=True,result=result,**schedule_sync.watch_status())
 except schedule_sync.ScheduleNotConfigured as e:
  return jsonify(error=str(e)),400
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

@bp.get('/api/schedule/sessions')
def sessions_list():
 """いま誰が編集権を持っているか(§9.211 ②)。**読むだけ**。

 画面の在席表示が読む。`session-status`は設備1つぶんしか答えられないので、
 「誰が入っているか」を帯へ出すにはこちらが要る。
 """
 try:
  return jsonify(ok=True,**schedule_sync.sessions_all(current_login_id(),current_pc_name()))
 except Exception as e:
  return jsonify(error=str(e)),500

@bp.post('/api/schedule/session/take-over')
def session_take_over():
 """編集権を**強制的に引き継ぐ**(§9.211 ②、利用者の指示)。

 TTL(90秒)を待てば自然に空くが、「抜けているのに残っている」あいだ
 その設備の予定を誰も直せない。奪われた側は次のハートビートで423になり、
 その場でREADONLYへ落ちる(書込APIもrequire_session()で二重に弾く)。
 """
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 if not equipment:return jsonify(error='どの設備か指定してください(equipment)。'),400
 try:
  r=schedule_sync.take_over_session(equipment,current_login_id(),current_pc_name())
  return jsonify(ok=True,equipment=equipment,**r)
 except schedule_sync.SessionHeldError as e:
  # 同じ瞬間にもう1台が奪っていた。**黙って「取れた」ことにしない。**
  return jsonify(error=str(e),sessionLockedBy={'loginId':e.holder_login,'pcName':e.holder_pc}),423
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

def _read(fn,timings=None):
 """GET系共通。ロックを取らず、共有ファイルをローカルへ取得して読むだけ
 (§4.2の「取得」のみを行い、適用・反映はしない)。
 戻り値: (fn(c)の結果 or None, stale:bool, エラー種別 or None)
 timings: 渡すと「共有の取り込みに何ms掛かったか」を入れる(§9.198)。"""
 t0=time.perf_counter()
 try:
  local_path,stale=schedule_sync.fetch_snapshot()
 except schedule_sync.ScheduleNotConfigured:
  return None,False,'not_configured'
 except schedule_sync.ScheduleUnavailableError as e:
  return None,False,str(e)
 if timings is not None:timings['snapshot']=round((time.perf_counter()-t0)*1000,1)
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
 変換する。apply_fn(c)の戻り値(dict)をそのまま応答へマージする。

 **共有ファイルへ書くのはここ1本**(§4.2)なので、「持ち主が1台だけ書く」
 (§9.192)を差し込むのもここ1箇所で足りる。持ち主でなければ、いま来ている
 リクエストをそのまま持ち主へ頼み、返事をそのまま返す。**頼めなければ
 今までどおり自分で書く**——持ち主が落ちていても仕事が止まらないことの
 ほうが大事で、ロックと改訂番号の砦はそのまま残っている。"""
 x=request.get_json(force=True) or {}
 uid=request_user_id(x)
 relayed=_relay_write(x)
 if relayed is not None:return relayed
 try:
  result=schedule_sync.with_write(current_login_id(),current_pc_name(),uid,apply_fn)
  out=dict(result or {})
  # 持ち主へ頼めなかったときは**自分で書いたことを黙らない**(§9.192)。
  # 画面はこれを見て「書込役へ届いていません」と言える。
  note=getattr(g,'relay_fallback',None)
  if note:out['relayFallback']=True;out['relayNote']=note
  return jsonify(ok=True,**out)
 except schedule_sync.ScheduleNotConfigured as e:
  return jsonify(error=str(e)),400
 except schedule_sync.LockHeldError as e:
  return jsonify(error=str(e),lockedBy={'loginId':e.holder_login,'pcName':e.holder_pc},retryAfterSec=e.retry_after_sec),423
 except schedule_sync.SessionHeldError as e:
  return jsonify(error=str(e),sessionLockedBy={'loginId':e.holder_login,'pcName':e.holder_pc},retryAfterSec=e.retry_after_sec),423
 except schedule_sync.RevisionConflictError as e:
  return jsonify(error=str(e),revision=e.revision),409
 except PermissionError as e:
  # まとめ書込(§9.45)の中で権限不足を検出した場合。個別エンドポイントの
  # 403と同じ扱いにする(4xxはフロント側でリトライされない)。
  return jsonify(error=str(e)),403
 except schedule_sync.ScheduleUnavailableError as e:
  return jsonify(error=str(e)),503
 except ValueError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  return jsonify(error=str(e)),500

def _relay_write(body):
 """持ち主へ書き込みを頼む(§9.192)。頼まないときは None。

 **頼んだ結果は「持ち主が答えたそのもの」**を返す（423の編集中・409の
 競合・403の権限も、そのままの語彙で画面へ届く）。頼めなかったときだけ
 Noneを返して、呼び出し元が自分で書く道へ落ちる。"""
 try:
  from .. import schedule_owner, schedule_watch
 except Exception:
  return None
 # **中継されてきたものを中継し返さない。** 共有(Box等)の結果整合性では
 # 目印が二重に見えることがあり、互いを持ち主だと思い込むと同じ依頼を
 # 往復させ続ける（画面はただ固まる）。中継の印はヘッダで分かる。
 if schedule_owner.relayed_identity(request.headers) is not None:return None
 # **受け口が通す道だけを頼む。** ここを見ずに頼むと、あとから
 # `_write_response()`を使う書込を1本足したときに、持ち主が
 # 「受け付けません」と答え、その403が**そのまま画面へ出る**
 # （自分で書けば済む場面なのに、他のPCだけ機能が欠ける）。
 if request.path not in schedule_owner.RELAY_PATHS:return None
 if not schedule_owner.should_relay():return None
 status,out=schedule_owner.relay(request.path,body,current_login_id(),current_pc_name(),get_mode())
 if status is None:
  app_logger().warning('持ち主へ頼めなかったので自分で書きます(%s): %s',request.path,out)
  try:g.relay_fallback=str(out or '書込役へ届きません')
  except Exception:pass
  return None
 # 書けたので**自分の写しも取り直す**——取り直さないと、書いた本人の画面
 # だけが古いままになる（他の端末は見張りが気づく）。
 if status<400:
  try:
   schedule_watch.schedule_watch_once();schedule_watch.wake()
  except Exception:pass
 payload=dict(out or {})
 payload['relayedTo']=schedule_owner.status().get('ownerPc') or ''
 return jsonify(**payload),status

def _request_mode():
 """このリクエストを出した端末のモード。**中継されてきたなら頼んだ端末の
 モード**(§9.192)。

 持ち主はたいていeditモードなので、持ち主のモードで判定すると、
 scheduleモードの端末どうしの設備排他(§9.11)が**持ち主を経由した書き込みで
 だけ効かなくなる**（同じ設備を2人が同時に触れる）。"""
 try:
  from .. import schedule_owner
  m=schedule_owner.relayed_mode(request.headers)
  if m:return m
 except Exception:pass
 return get_mode()

def _check_session(equipment):
 # 編集セッション(§9.11)を強制する。
 # **editモード(現場段取り)も対象**(§9.211 ②、利用者の指示「スケジュール
 # 編集者が1名になるまでは後から入った人は編集権を持たずREADONLY」)。
 # 以前はscheduleモードだけを見ていた——理由は「edit端末はセッションを
 # 取得できない(POST /api/schedule/session/*がscheduleモード限定のBlueprint
 # だった)ので、一律に要求すると現場段取りが機能しなくなる」だった。
 # その前提を先に外してある(access_mode._ENDPOINT_EXTRA_MODESでsession系の
 # 4本をeditへ開けた)ので、ここも一律にできる。
 # **順番を逆にしないこと**——取得口を開ける前にここを一律にすると、
 # 現場段取りの並べ替えだけが静かに423で止まる。
 # 閲覧モードはそもそも書込ガード(_guard_write)で弾かれるのでここへ来ない。
 if _request_mode() in ('schedule','edit'):
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
 # 読み込みの内訳(§9.198)。**遅いときにどこが遅いのかを画面から見られる**
 # ようにするための計測。「共有の取り込み」「予定の読み出し」「実績の突合」
 # 「展開」で桁が違うので、どれか1つでも分かれば打つ手が決まる。
 timings={}
 t_all=time.perf_counter()
 result,stale,err=_read(lambda c:schedule_calc.expand_plan(c,equipment,history_hours=history_hours),timings)
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=equipment,entries=[],anchor=None,warnings=[])
 if err:return jsonify(error=err),503
 warnings=list(result.get('warnings') or [])
 if stale:warnings.append('スケジュールデータの取得に失敗したため、直前のローカルキャッシュを表示しています。')
 timings.update(result.get('timings') or {})
 timings['total']=round((time.perf_counter()-t_all)*1000,1)
 timings['rowCount']=len(result['entries'])
 return jsonify(ok=True,configured=True,equipment=equipment,entries=result['entries'],anchor=result.get('anchor'),
                anchorRounded=result.get('anchorRounded'),
                loadFactor=result.get('loadFactor'),historyHours=history_hours,warnings=warnings,
                timings=timings)

@bp.post('/api/schedule/plan/add')
def plan_add():
 x=request.get_json(force=True) or {}
 equipment=str(x.get('equipment') or '').strip()
 kind=str(x.get('kind') or '').strip()
 if not equipment:return jsonify(error='どの設備の予定か指定してください。'),400
 def fn(c):
  _check_session(equipment)
  pid=sr.plan_add(c,equipment,kind,request_user_id(x),pc=request_pc_name(x),position=str(x.get('position') or 'end'),
                   lot_no=str(x.get('lotNo') or ''),inspection_no=str(x.get('inspectionNo') or ''),
                   casting_no=str(x.get('castingNo') or ''),title=str(x.get('title') or ''),
                   detail=x.get('detail') or {},stop_reason_id=x.get('stopReasonId'),
                   estimate_minutes=x.get('estimateMinutes'),fixed_start=x.get('fixedStart'),
                   remark=str(x.get('remark') or ''),
                   children=_plan_children(x.get('children')))
  return {'id':pid}
 return _write_response(fn)

def _plan_children(raw):
 """分割ありの親ロットにぶら下げる子ロット(§9.83)。画面が投入時に仕掛から
    引いた行をそのまま受ける。上限は分割の上限(9ロット)に合わせる。"""
 if not isinstance(raw,(list,tuple)):return []
 out=[]
 for c in raw[:9]:
  if not isinstance(c,dict):continue
  lot=str(c.get('lotNo') or '').strip()
  if not lot:continue
  out.append({'lotNo':lot,'inspectionNo':str(c.get('inspectionNo') or ''),
              'castingNo':str(c.get('castingNo') or ''),
              'detail':c.get('detail') if isinstance(c.get('detail'),dict) else {}})
 return out

@bp.post('/api/schedule/plan/update')
def plan_update():
 x=request.get_json(force=True) or {}
 plan_id=x.get('id')
 if plan_id is None:return jsonify(error='更新対象の予定IDがありません。'),400
 # titleは申し送り(コメント)の本文(§9.191)。他の種別では repo が弾く。
 fields={k:x[k] for k in ('estimateMinutes','fixedStart','remark','state','title') if k in x}
 def fn(c):
  row=sr.plan_row(c,plan_id)
  if row:_check_session(row[1])
  n=sr.plan_update(c,plan_id,request_user_id(x),pc=request_pc_name(x),**fields)
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
  n=sr.plan_delete(c,plan_id,request_user_id(x),pc=request_pc_name(x))
  if n==0:raise ValueError('指定の予定が見つかりません。')
  return {'id':plan_id}
 return _write_response(fn)

# ------------------------------------------------------------------------
# まとめ書込(§9.45)
# ------------------------------------------------------------------------
# 共有スケジュールDBの書込は1回ごとに「ロック取得→検証待ち→スナップショット
# 取得→適用→改訂番号確認→反映→ロック解放」というサイクルを丸ごと踏む
# (§4.2)。1件あたりの固定費が大きいため、20ロットの一括追加のように連続
# する操作では、この固定費が件数ぶん積み上がって体感を悪化させていた
# (実測1件約1.5秒 → 20件で30秒)。
#
# ここでは複数の操作を**1サイクルの中で**順に適用する。各操作の可否判定
# (編集セッション・現場段取り権限)は個別エンドポイントとまったく同じものを
# 呼ぶこと。まとめたことで判定が緩むと権限の抜け道になる。
#
# 1件失敗しても残りは適用する(従来の1件1リクエストと同じ挙動)。結果は
# 送った順で返し、呼び出し側が成功/失敗を1件ずつ処理できるようにする。
def _apply_plan_op(c,op,uid,pc=''):
 """1操作を適用して結果dictを返す。例外はそのまま呼び出し側へ。

 `pc`は操作した端末名(§9.180)。**まとめて適用するときも1件ずつと同じものを
 残す**——まとめたことで残る情報が減ると、あとから「誰がどの端末で入れたか」
 を追えない行が混ざる。"""
 kind=str(op.get('op') or '').strip()
 if kind=='add':
  equipment=str(op.get('equipment') or '').strip()
  if not equipment:raise ValueError('どの設備の予定か指定してください。')
  _check_session(equipment)
  pid=sr.plan_add(c,equipment,str(op.get('kind') or ''),uid,pc=pc,position=str(op.get('position') or 'end'),
                   lot_no=str(op.get('lotNo') or ''),inspection_no=str(op.get('inspectionNo') or ''),
                   casting_no=str(op.get('castingNo') or ''),title=str(op.get('title') or ''),
                   detail=op.get('detail') or {},stop_reason_id=op.get('stopReasonId'),
                   estimate_minutes=op.get('estimateMinutes'),fixed_start=op.get('fixedStart'),
                   remark=str(op.get('remark') or ''),
                   children=_plan_children(op.get('children')))
  return {'id':pid}
 if kind=='update':
  plan_id=op.get('id')
  if plan_id is None:raise ValueError('更新対象の予定IDがありません。')
  row=sr.plan_row(c,plan_id)
  if row:_check_session(row[1])
  fields={k:op[k] for k in ('estimateMinutes','fixedStart','remark','state','title') if k in op}
  n=sr.plan_update(c,plan_id,uid,pc=pc,**fields)
  if n==0:raise ValueError('指定の予定が見つからないか、更新項目がありません。')
  return {'id':plan_id}
 if kind=='delete':
  plan_id=op.get('id')
  if plan_id is None:raise ValueError('削除対象の予定IDがありません。')
  row=sr.plan_row(c,plan_id)
  if row:_check_session(row[1])
  n=sr.plan_delete(c,plan_id,uid,pc=pc)
  if n==0:raise ValueError('指定の予定が見つかりません。')
  return {'id':plan_id}
 if kind=='reorder':
  equipment=str(op.get('equipment') or '').strip()
  if not equipment:raise ValueError('どの設備の並べ替えか指定してください。')
  # 個別エンドポイント(plan_reorder)と同じ現場段取り権限の確認。
  if get_mode()=='edit':
   flags=current_permission_flags()
   if not flags['canFieldReorder'] or not field_reorder_equipment_allows(flags['fieldReorderEquipment'],equipment):
    raise PermissionError('この端末には、この設備の現場段取り(並べ替え)権限がありません。')
  _check_session(equipment)
  expanded=schedule_calc.expand_plan(c,equipment)
  reorderable_ids={e['id'] for e in expanded['entries'] if e.get('reorderable')}
  n=sr.plan_reorder(c,equipment,op.get('orderedIds') or [],uid,reorderable_ids=reorderable_ids,pc=pc)
  return {'reordered':n}
 raise ValueError(f'不明な操作です: {kind}')

@bp.post('/api/schedule/plan/batch')
def plan_batch():
 # **このエンドポイントはscheduleモード限定**(Blueprintの既定、
 # access_mode._WRITE_ALLOWED_MODES)。_ENDPOINT_EXTRA_MODESでeditへ開いては
 # いけない: まとめ書込は追加・削除も運べるため、editモードへ開くと
 # 「現場段取り端末は並べ替えだけ」という§3.1.1の制限を迂回できてしまう。
 # editモードの現場段取りは従来どおり個別のplan/reorderを使うこと。
 x=request.get_json(force=True) or {}
 ops=x.get('ops')
 if not isinstance(ops,list) or not ops:
  return jsonify(error='適用する操作がありません。'),400
 if len(ops)>200:
  return jsonify(error='一度にまとめられる操作は200件までです。'),400
 uid=request_user_id(x);pc=request_pc_name(x)
 def fn(c):
  results=[]
  for op in ops:
   try:
    results.append({'ok':True,**(_apply_plan_op(c,op,uid,pc) or {})})
   except (PermissionError,schedule_sync.SessionHeldError):
    # 権限不足・他端末が編集中は、1件でもあればサイクルごと止める
    # (個別エンドポイントと同じく「やる前に弾く」挙動)。
    raise
   except Exception as e:
    # それ以外(対象が見つからない等)は、その1件だけ失敗として記録し
    # 残りは適用する。1件1リクエストだった頃と同じ結果になる。
    results.append({'ok':False,'error':str(e)})
  return {'results':results}
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
  if not flags['canFieldReorder'] or not field_reorder_equipment_allows(flags['fieldReorderEquipment'],equipment):
   return jsonify(error='この端末には、この設備の現場段取り(並べ替え)権限がありません。'),403
 ordered_ids=x.get('orderedIds') or x.get('planIds') or []
 def fn(c):
  _check_session(equipment)
  # §7.5手順1〜2: 実績突合込みで導出した状態から「実質的に予定」なIDだけを
  # 並べ替え対象にする(DBの[状態]列だけを見ると、実績突合で既に着手/完了
  # 相当になっている予定を誤って動かせてしまう)。
  expanded=schedule_calc.expand_plan(c,equipment)
  reorderable_ids={e['id'] for e in expanded['entries'] if e.get('reorderable')}
  n=sr.plan_reorder(c,equipment,ordered_ids,request_user_id(x),reorderable_ids=reorderable_ids,pc=request_pc_name(x))
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
# 設備停止分類マスタ(§5.3.1) - 全設備共通
# ========================================================================
def _stop_category_entry(r):
 # r: 分類ID,名称,色キー,表示順,有効,更新日時,更新者ID
 return {'id':r[0],'name':r[1],'colorKey':r[2],'order':r[3],
         'updatedAt':r[5].isoformat() if r[5] else None,'updatedBy':str(r[6] or '')}

@bp.get('/api/schedule/stop-category-master')
def stop_category_list():
 items=_cfg_read(lambda mc:[_stop_category_entry(r) for r in sr.stop_category_rows(mc)])
 return jsonify(ok=True,configured=True,items=items,stale=False)

def _stop_category_save(x):
 name=str(x.get('name') or '').strip()
 # idがあれば改名(他マスタと同じリネーム更新)。無ければ新規または再有効化。
 cid=x.get('id')
 def fn(mc):
  gid,created=sr.stop_category_upsert(mc,name,request_user_id(x),
                                      color_key=str(x.get('colorKey') or ''),
                                      category_id=int(cid) if cid not in (None,'') else None)
  return {'id':gid,'created':created}
 return _cfg_write_response(fn)

@bp.post('/api/schedule/stop-category-master')
def stop_category_register():
 return _stop_category_save(request.get_json(force=True) or {})

@bp.post('/api/schedule/stop-category-master/update')
def stop_category_update():
 """マスタ管理画面の「編集」はどのマスタも <endpoint>/update へPOSTする
    (static/js/master-maint.js の submitMaint)。改名の処理は登録側が
    idを見て既に持っているのに、このURLだけ無く404で弾かれていた(§9.82)。"""
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _stop_category_save(x)

@bp.post('/api/schedule/stop-category-master/delete')
def stop_category_delete():
 x=request.get_json(force=True) or {}
 cid=x.get('id')
 if cid is None:return jsonify(error='削除対象IDがありません。'),400
 force=bool(x.get('force'))
 # 使用中の分類をうっかり消すと、設備停止マスタ側の分類が「選択肢に無い値」
 # として取り残される。まず件数を提示して確認を求め、利用者が再確認のうえ
 # force:trueで再送したときだけ実際に消す(設備マスタの削除と同じ考え方。§5.0.1)。
 name,used=_cfg_read(lambda mc:sr.stop_category_usage(mc,cid))
 if name is None:return jsonify(error='指定の分類が見つかりません。'),400
 if used and not force:
  return jsonify(error=f'分類「{name}」は設備停止マスタの{used}件で使用中です。',
                 code='stop_category_in_use',
                 references={'name':name,'stopReasonRows':used}),409
 def fn(mc):
  n=sr.stop_category_delete(mc,cid,request_user_id(x))
  if n==0:raise ValueError('指定の分類が見つかりません。')
  return {'id':cid,'name':name,'stopReasonRows':used}
 return _cfg_write_response(fn)

# ========================================================================
# 行表示マスタ(§9.198) — タイムラインの行の見せ方(配色・アイコン)
# ------------------------------------------------------------------------
# **全設備共通**。区分の色は設備をまたいで意味を持つ言語なので、設備ごとに
# 変えられるようにすると色が何も語らなくなる(設備停止分類マスタと同じ理由)。
# ========================================================================
def _row_style_entry(r):
 # r: 行表示ID,区分キー,色キー,アイコン,アイコン表示,有効,更新日時,更新者ID
 return {'id':r[0],'key':str(r[1] or ''),'colorKey':str(r[2] or ''),'icon':str(r[3] or ''),
         'showIcon':(True if r[4] is None else bool(r[4])),
         'updatedAt':r[6].isoformat() if r[6] else None,'updatedBy':str(r[7] or '')}

@bp.get('/api/schedule/row-style-master')
def row_style_list():
 items=_cfg_read(lambda mc:[_row_style_entry(r) for r in sr.row_style_rows(mc)])
 return jsonify(ok=True,configured=True,items=items,stale=False)

def _row_style_save(x):
 rid=x.get('id')
 def fn(mc):
  gid,created=sr.row_style_upsert(mc,x.get('key'),request_user_id(x),
                                  color_key=str(x.get('colorKey') or ''),
                                  icon=str(x.get('icon') or ''),
                                  show_icon=x.get('showIcon') is not False,
                                  row_style_id=int(rid) if rid not in (None,'') else None)
  return {'id':gid,'created':created}
 return _cfg_write_response(fn)

@bp.post('/api/schedule/row-style-master')
def row_style_register():
 return _row_style_save(request.get_json(force=True) or {})

@bp.post('/api/schedule/row-style-master/update')
def row_style_update():
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _row_style_save(x)

@bp.post('/api/schedule/row-style-master/delete')
def row_style_delete_route():
 """既定へ戻す。**行ごと消す**のが「設定していない」状態。"""
 x=request.get_json(force=True) or {}
 rid=x.get('id')
 if rid is None:return jsonify(error='削除対象IDがありません。'),400
 def fn(mc):
  if not sr.row_style_delete(mc,rid,request_user_id(x)):
   raise ValueError('指定の設定が見つかりません。')
  return {'deleted':1}
 return _cfg_write_response(fn)

# ========================================================================
# 設備停止マスタ
# ========================================================================
def _stop_reason_entry(r):
 # r: 停止理由ID,設備名,分類,名称,標準所要分,色キー,表示順,有効,更新日時,更新者ID
 # equipment は保存値そのまま(複数設備はカンマ区切り、全設備は'*'。§9.81)。
 # 画面が書式を解釈し直さずに済むよう、配列と表示用の文字列も添える。
 return {'id':r[0],'equipment':r[1],
         'equipmentList':sr.stop_equipment_list(r[1]),
         'equipmentLabel':sr.stop_equipment_label(r[1]),
         'category':r[2],'name':r[3],
         'standardMinutes':r[4],'colorKey':r[5],
         'updatedAt':r[8].isoformat() if r[8] else None,'updatedBy':str(r[9] or '')}

@bp.get('/api/schedule/stop-reason-master')
def stop_reason_list():
 equipment=str(request.args.get('equipment') or '').strip()
 items=_cfg_read(lambda mc:[_stop_reason_entry(r) for r in sr.stop_reason_rows(mc,equipment or None)])
 return jsonify(ok=True,configured=True,items=items,stale=False)

def _stop_reason_save(x,stop_reason_id=None):
 # 対象設備は文字列(カンマ区切り・'*')でもリストでも受ける。書式の正規化は
 # schedule_repo.stop_equipment_text が一手に引き受ける(§9.81)。
 equipment=x.get('equipment')
 if not isinstance(equipment,(list,tuple)):equipment=str(equipment or '').strip()
 name=str(x.get('name') or '').strip()
 def fn(mc):
  sid,created=sr.stop_reason_upsert(mc,equipment,name,request_user_id(x),
                                     category=str(x.get('category') or ''),
                                     standard_minutes=x.get('standardMinutes'),
                                     color_key=str(x.get('colorKey') or ''),
                                     stop_reason_id=stop_reason_id)
  return {'id':sid,'created':created}
 return _cfg_write_response(fn)

@bp.post('/api/schedule/stop-reason-master')
def stop_reason_register():
 return _stop_reason_save(request.get_json(force=True) or {})

@bp.post('/api/schedule/stop-reason-master/update')
def stop_reason_update():
 # 既存行の更新(§9.81)。対象設備そのものを入れ替えられるのはこの経路だけで、
 # 登録側(自然キー照合)では「対象設備を変える」と別行の新規登録になってしまう。
 x=request.get_json(force=True) or {}
 sid=x.get('id')
 if sid is None or str(sid).strip()=='':return jsonify(error='更新対象IDがありません。'),400
 return _stop_reason_save(x,stop_reason_id=sid)

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
def _pattern_entry(mc,r,assigned=None):
 # r: 勤務体系ID,適用設備,名称,表示順,有効
 # equipment(複数)は勤務体系設備マスタから引く。0件=全設備既定。
 # equipmentText は一覧表示用の連結文字列(オペレータマスタと同じ流儀)。
 if assigned is None:assigned=sr.shift_pattern_equipment_map(mc)
 names=assigned.get(r[0],[])
 return {'id':r[0],'equipment':names,'equipmentText':'、'.join(names) or '全設備共通',
         'name':r[2],
         # dayOffset は**効いている値**(§9.195)。跨がない区分は必ず0で、
         # crossesMidnight が False のときは画面に欄ごと出さない(§4)。
         # 時刻は HH:MM へそろえて返す（1桁の時が保存されていると編集画面の
         # input[type=time] が空欄になる。schedule_repo.pad_hm 参照）。
         'segments':[{'id':s[0],'name':s[2],'start':sr.pad_hm(s[3]),'end':sr.pad_hm(s[4]),
                      'crossesMidnight':sr.crosses_midnight(s[3],s[4]),
                      'dayOffset':s[7]} for s in sr.shift_segment_rows(mc,r[0])]}

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
  assigned=sr.shift_pattern_equipment_map(mc)
  return [_pattern_entry(mc,r,assigned) for r in rows]
 return jsonify(ok=True,configured=True,items=_cfg_read(fn),stale=False)

@bp.post('/api/schedule/shift-pattern-master')
def shift_pattern_save():
 """勤務体系と、その配下の勤務区分をまとめて保存する(区分は全置換)。
 親子を1リクエストで保存することで、片方だけ保存された中途半端な状態を作らない。"""
 x=request.get_json(force=True) or {}
 pattern_id=x.get('id')
 # equipmentは設備名の配列(複数可、空配列=全設備共通)。以前は単一文字列
 # だったため、互換のため文字列で来た場合も受け付ける。
 raw_eq=x.get('equipment')
 if isinstance(raw_eq,list):equipment=[str(v or '').strip() for v in raw_eq if str(v or '').strip()]
 else:equipment=[str(raw_eq or '').strip()] if str(raw_eq or '').strip() else []
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
 # 実績突合の索引は設備によらず同じ。設備ごとに作り直すと、実績バックアップ
 # (共有上の閲覧用複製を含む)を設備数ぶん読み直すことになる(§9.41)。
 actual_index=schedule_calc.build_actual_index()
 def fn(c):
  # 俯瞰ボードは「今どこが動いているか/残りどれだけか」だけを見るため、
  # 計画外実績(§9.33)の完了分は合成しない(history_hours=None)。実施中の
  # 分は合成されるので、予定を立てずに始めた作業も「● 稼働中」に出る。
  return [_overview_row(eq,schedule_calc.expand_plan(c,eq,now=now,history_hours=None,
                                                     actual_index=actual_index),now)
          for eq in equipment_names]
 result,stale,err=_read(fn)
 if err=='not_configured':return jsonify(ok=True,configured=False,equipment=[],generatedAt=now.isoformat())
 if err:return jsonify(error=err),503
 return jsonify(ok=True,configured=True,equipment=result,generatedAt=now.isoformat(),stale=stale)
