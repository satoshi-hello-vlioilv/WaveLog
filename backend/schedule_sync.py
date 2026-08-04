"""schedule_sync.py: スケジュール機能の排他制御基盤(docs/SCHEDULE_MODE_DESIGN.md §4)。

schedule.sqlite3の実体は共有環境(Box等、パス設定マスタの
"schedule_share_path"、マスタ管理画面から編集)に1つだけ置く想定で、
最大3端末程度の同時アクセスを見込む。SQLiteは複数プロセスからのネットワーク越し書込を推奨しておらず、
Boxのようなクラウド同期ストレージは真のファイルロックを提供しないため、
このモジュールが「共有ファイルへは常に1端末だけが、短時間だけ、取得→適用→
反映のサイクルで触れる」ことをアプリ側で保証する(直接の複数プロセス書込は
破損・データ消失のリスクがあるため、共有ファイルへ直接書き込むコードは
このモジュール以外に絶対に書かないこと)。

二段構えの排他制御:
  1. ロック(このモジュールの本体): schedule_share_pathと同じフォルダへ
     schedule.lock.jsonという小さなマーカーファイルを置き、書込系の呼び出し
     1回分だけを保持する短命ロックとして使う(既定TTL30秒。編集セッション
     全体を長時間ロックし続ける方式は採らない)。
  2. 改訂番号(スケジュールメタテーブル): ロック自体はBoxの結果整合性ゆえに
     完全なアトミック排他ではない(他端末とほぼ同時に取得を試みた場合、双方
     が「自分が確保した」と誤認する余地が理論上残る)ため、反映直前に取得
     時点からの改訂番号のずれを検出し、ずれていれば反映せずに中断する保険。

書込は必ず with_write() 経由の「ロック取得→共有ファイルをローカルへ取得→
ローカルで加工→改訂番号を確認して反映→ロック解放」というサイクルを踏む。

三段目(§9.11新設・編集セッション): 上記1・2はデータの整合性を保証する
ための機構で、書込1回ごとに数百ms保持するだけの短命ロックである。これとは
別に「設備単位で同時に1人しか編集作業に入れない」というUX上の要件のため、
acquire_session/release_session/require_sessionが編集セッション(分単位)を
schedule.sessions.jsonという軽量な別ファイルで管理する。データ本体の
with_write()サイクルとは独立しているため、1端末が何十件も連続追加する間、
毎回ネットワーク越しの共有DBバックアップを取り直す必要が無い。
"""
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import json

from .config import SCHEDULE_LOCK_TTL_SEC_DEFAULT, SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT
from .db_access import SCHEDULE_SHARE_PATH, SCHEDULE_CACHE_PATH, connect, path_config_value
from .logging_setup import app_logger

LOCK_FILENAME='schedule.lock.json'
META_TABLE='スケジュールメタ'

# 呼び出しのたびにパス設定マスタを読み直す(path_config_value)。以前は
# プロセス起動時に1回だけ計算していたが、この2つは接続先を決める値では
# ないため、マスタ管理画面での変更を再起動無しで反映できるようにした。
def _lock_ttl_sec():
 try:return int(path_config_value('schedule_lock_ttl_sec',SCHEDULE_LOCK_TTL_SEC_DEFAULT))
 except (TypeError,ValueError):return SCHEDULE_LOCK_TTL_SEC_DEFAULT
def _lock_verify_delay_sec():
 try:return int(path_config_value('schedule_lock_verify_delay_ms',SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT))/1000
 except (TypeError,ValueError):return SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT/1000


class ScheduleNotConfigured(Exception):
 """schedule_share_path未設定。スケジュール機能自体が無効。"""


class LockHeldError(Exception):
 """他端末がロックを保持中(423想定)。"""
 def __init__(self,holder_login,holder_pc,retry_after_sec):
  super().__init__(f'編集中です: {holder_login}@{holder_pc}')
  self.holder_login=holder_login;self.holder_pc=holder_pc;self.retry_after_sec=retry_after_sec


class RevisionConflictError(Exception):
 """反映直前に改訂番号のずれを検出(409想定)。"""
 def __init__(self,revision):
  super().__init__('別の端末の変更と競合しました。最新の状態を読み直してください。')
  self.revision=revision


class ScheduleUnavailableError(Exception):
 """共有ファイルの取得に失敗し、フォールバック用のローカルキャッシュも無い。"""


class SessionHeldError(Exception):
 """他端末がこの設備の編集セッションを保持中(423想定)。"""
 def __init__(self,equipment,holder_login,holder_pc,retry_after_sec=5):
  super().__init__(f'{equipment}は{holder_login or "?"}@{holder_pc or "?"}が編集中です。')
  self.equipment=equipment;self.holder_login=holder_login;self.holder_pc=holder_pc;self.retry_after_sec=retry_after_sec


def _require_configured():
 if SCHEDULE_SHARE_PATH is None:
  raise ScheduleNotConfigured('schedule_share_pathが未設定のため、スケジュール機能は無効です。')
 return SCHEDULE_SHARE_PATH


def _lock_path():
 return _require_configured().parent/LOCK_FILENAME


def _read_lock():
 path=_lock_path()
 if not path.exists():return None
 try:
  data=json.loads(path.read_text(encoding='utf-8'))
  return data if isinstance(data,dict) else None
 except Exception:
  return None


def _lock_expired(lock):
 if not lock or not lock.get('expires_at'):return True
 try:
  return datetime.fromisoformat(lock['expires_at'])<=datetime.now()
 except Exception:
  return True


def lock_status():
 """現在のロック保有者情報(GET /api/schedule/lock-statusの実体)。
 全モードから読み取り専用で参照できる(取得すること自体はロックしない)。"""
 if SCHEDULE_SHARE_PATH is None:
  return {'configured':False}
 lock=_read_lock()
 if lock is None or _lock_expired(lock):
  return {'configured':True,'locked':False}
 return {'configured':True,'locked':True,'holderLogin':lock.get('holder_login',''),
         'holderPc':lock.get('holder_pc',''),'expiresAt':lock.get('expires_at')}


def acquire_lock(login_id,pc_name,ttl_sec=None):
 """§4.3のロック取得。取得できたらトークンを返す。埋まっていればLockHeldError。"""
 path=_lock_path()
 ttl=ttl_sec if ttl_sec is not None else _lock_ttl_sec()
 current=_read_lock()
 if current and not _lock_expired(current):
  remaining=1
  try:
   remaining=max(1,int((datetime.fromisoformat(current['expires_at'])-datetime.now()).total_seconds()))
  except Exception:
   pass
  raise LockHeldError(current.get('holder_login',''),current.get('holder_pc',''),remaining)
 token=uuid.uuid4().hex
 now=datetime.now()
 payload={'token':token,'holder_login':login_id,'holder_pc':pc_name,
          'acquired_at':now.isoformat(),'expires_at':(now+timedelta(seconds=ttl)).isoformat()}
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
 # 再読込による簡易検証(§4.3)。他端末とほぼ同時に取得を試みた場合、双方が
 # 「自分が確保した」と誤認する余地が理論上残る(Boxの結果整合性ゆえに完全な
 # アトミック排他は原理的に作れない)。この残存リスクはwith_write()側の
 # 改訂番号チェックで最終的に検出・棄却する(ロックが一次防御、改訂番号が
 # 二次防御という二段構え)。
 verify_delay=_lock_verify_delay_sec()
 if verify_delay>0:
  time.sleep(verify_delay)
 verify=_read_lock()
 if not verify or verify.get('token')!=token:
  raise LockHeldError((verify or {}).get('holder_login',''),(verify or {}).get('holder_pc',''),5)
 return token


def release_lock(token):
 """自分のトークンのままであれば解放する(他端末が既に上書きしていたら何もしない)。"""
 if SCHEDULE_SHARE_PATH is None or not token:return
 path=_lock_path()
 current=_read_lock()
 if current and current.get('token')==token:
  try:path.unlink(missing_ok=True)
  except Exception as e:app_logger().warning('スケジュールロックの解放に失敗しました: %s',e)



# ------------------------------------------------------------------------
# 編集セッション(§9.11新設): 「設備単位で同時に1人しか編集作業に入れない」
# ための助言的ロック。schedule.lock.json(このファイル冒頭のロック)は
# 書込1回分(数百ms)だけを保持する短命ロックのため、複数ロットの一括追加
# 中は取得のたびに解放・再取得を繰り返すことになり、体感速度が悪化する
# うえ、他端末の書込と交互に割り込まれて表示が乱れる余地もある。
# 編集セッションは「この設備のスケジュール画面を開いている間」という
# 分単位の長さを持つ別レイヤーのロックとして、schedule.sqlite3本体とは
# 別の小さなJSONファイル(schedule.sessions.json)へ直接読み書きする
# (with_write()のsqlite取得→適用→反映サイクルを経由しない。1端末が
# 何十件も連続追加する間、毎回ネットワーク越しのDBバックアップを取り直す
# 必要が無いようにするための軽量化)。データ本体の整合性はwith_write()の
# ロック+改訂番号チェックが引き続き最終防御として機能するため、この
# セッション機構はあくまで「同じ設備を2人が同時にいじり始めない」ための
# UX上の安全策(以下require_session参照)。
SESSION_FILENAME='schedule.sessions.json'
SESSION_TTL_SEC_DEFAULT=90
_SESSION_VERIFY_DELAY_SEC=0.3


def _sessions_path():
 return _require_configured().parent/SESSION_FILENAME


def _read_sessions_raw():
 path=_sessions_path()
 if not path.exists():return {}
 try:
  data=json.loads(path.read_text(encoding='utf-8'))
  return data if isinstance(data,dict) else {}
 except Exception:
  return {}


def _prune_expired(sessions):
 now=datetime.now()
 kept={}
 for eq,entry in sessions.items():
  try:
   if isinstance(entry,dict) and datetime.fromisoformat(entry.get('expires_at',''))>now:
    kept[eq]=entry
  except Exception:
   continue
 return kept


def _write_sessions(sessions):
 path=_sessions_path()
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
 tmp.write_text(json.dumps(sessions,ensure_ascii=False),encoding='utf-8')
 tmp.replace(path)


def _own_or_free(entry,login_id,pc_name):
 if not entry:return True
 return entry.get('login')==login_id and entry.get('pc')==pc_name


def session_status(equipment,login_id='',pc_name=''):
 """現在このequipmentの編集セッションを誰が保持しているか(読み取りのみ、
 排他制御なし。schedule.lock.jsonのlock_status()と同じ位置づけ)。"""
 if SCHEDULE_SHARE_PATH is None:
  return {'configured':False}
 equipment=str(equipment or '').strip()
 entry=_prune_expired(_read_sessions_raw()).get(equipment) if equipment else None
 if not entry:
  return {'configured':True,'held':False}
 mine=_own_or_free(entry,login_id,pc_name) if (login_id or pc_name) else False
 return {'configured':True,'held':True,'holderLogin':entry.get('login',''),
         'holderPc':entry.get('pc',''),'expiresAt':entry.get('expires_at'),'mine':mine}


def acquire_session(equipment,login_id,pc_name,ttl_sec=None):
 """取得(自分がまだ保持していなければ新規、既に保持していれば延長=
 ハートビートも兼ねる)。他端末が保持中ならSessionHeldError。"""
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 _require_configured()
 ttl=ttl_sec if ttl_sec is not None else SESSION_TTL_SEC_DEFAULT
 sessions=_prune_expired(_read_sessions_raw())
 current=sessions.get(equipment)
 if current and not _own_or_free(current,login_id,pc_name):
  raise SessionHeldError(equipment,current.get('login',''),current.get('pc',''))
 token=uuid.uuid4().hex
 now=datetime.now()
 sessions[equipment]={'login':login_id,'pc':pc_name,'token':token,
                      'acquired_at':(current or {}).get('acquired_at') or now.isoformat(),
                      'expires_at':(now+timedelta(seconds=ttl)).isoformat()}
 _write_sessions(sessions)
 # schedule.lock.jsonのacquire_lock()と同じ考え方の簡易検証(§4.3参照)。
 # ほぼ同時に2端末が取得を試みた場合に双方が「取れた」と誤認する余地を
 # 減らす(完全排除はできないため、あくまで助言的ロックとして扱うこと)。
 if _SESSION_VERIFY_DELAY_SEC>0:
  time.sleep(_SESSION_VERIFY_DELAY_SEC)
 verify=_prune_expired(_read_sessions_raw()).get(equipment)
 if not verify or verify.get('token')!=token:
  raise SessionHeldError(equipment,(verify or {}).get('login',''),(verify or {}).get('pc',''))
 return verify['expires_at']


def release_session(equipment,login_id,pc_name):
 """自分が保持している分だけ解放する(他端末が既に上書きしていたら何もしない、
 release_lock()と同じ方針)。ベストエフォート。"""
 if SCHEDULE_SHARE_PATH is None:return
 equipment=str(equipment or '').strip()
 if not equipment:return
 try:
  sessions=_prune_expired(_read_sessions_raw())
  current=sessions.get(equipment)
  if current and current.get('login')==login_id and current.get('pc')==pc_name:
   del sessions[equipment]
   _write_sessions(sessions)
 except Exception as e:
  app_logger().warning('スケジュール編集セッションの解放に失敗しました: %s',e)


def require_session(equipment,login_id,pc_name):
 """書込系ハンドラの入口用: このequipmentの編集セッションを自分が保持して
 いる(または誰も保持していない)ことを確認する。他端末が保持中なら
 SessionHeldError。schedule_share_path未設定時は素通し(with_write()側の
 ScheduleNotConfiguredに任せる)。"""
 equipment=str(equipment or '').strip()
 if not equipment or SCHEDULE_SHARE_PATH is None:return
 status=session_status(equipment,login_id,pc_name)
 if status.get('held') and not status.get('mine'):
  raise SessionHeldError(equipment,status.get('holderLogin',''),status.get('holderPc',''))


def _verify_integrity(path):
 try:
  c=connect(path,True,'sqlite')
  try:
   c.execute('PRAGMA integrity_check').fetchone()
  finally:
   c.close()
  return True
 except Exception:
  return False


def ensure_meta_table(c):
 cur=c.cursor()
 cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[META_TABLE])
 if not cur.fetchone():
  cur.execute(f'CREATE TABLE [{META_TABLE}] ([改訂番号] INTEGER, [最終更新者ID] TEXT, [最終更新日時] DATETIME)')
  cur.execute(f"INSERT INTO [{META_TABLE}] ([改訂番号],[最終更新者ID],[最終更新日時]) VALUES (0,'',Now())")
  c.commit()


def _read_revision_only(c):
 """テーブル未作成(初回)でも例外にせず0を返す、読み取り専用接続向けの版。"""
 try:
  cur=c.cursor();cur.execute(f'SELECT [改訂番号] FROM [{META_TABLE}] LIMIT 1')
  row=cur.fetchone()
  return int(row[0]) if row and row[0] is not None else 0
 except sqlite3.OperationalError:
  return 0


def read_revision(c):
 ensure_meta_table(c)
 return _read_revision_only(c)


def bump_revision(c,uid):
 ensure_meta_table(c)
 cur=c.cursor()
 cur.execute(f'UPDATE [{META_TABLE}] SET [改訂番号]=[改訂番号]+1,[最終更新者ID]=?,[最終更新日時]=Now()',[uid])
 c.commit()
 return _read_revision_only(c)


def fetch_snapshot():
 """共有ファイルをローカルの作業コピーへ整合性のとれた状態で取得する
 (sqlite3.Connection.backup()。単純なファイルコピーは書込中に壊れたコピーを
 作りうるため使わない、§4.2手順2)。取得・検証に失敗した場合は直前に取得
 できていた最後の正常ローカルキャッシュへフォールバックする(§4.5)。
 キャッシュも無ければScheduleUnavailableError。
 戻り値: (ローカルパス, stale: bool)"""
 shared=_require_configured()
 SCHEDULE_CACHE_PATH.parent.mkdir(parents=True,exist_ok=True)
 # tmp名は呼び出しごとに一意にする(§4.2手順2はGET系(読み取り専用)からも
 # ロック無しで呼ばれるため、複数リクエストが同時に走ると固定名の一時
 # ファイルを取り合って書込失敗・rename失敗を起こしうる。実際にPlaywright
 # 検証で"attempt to write a readonly database"/"tmpが見つからない"という
 # 形で再現した)。最終目的地(SCHEDULE_CACHE_PATH)への書込自体は
 # Path.replace()がOSレベルでアトミックなため、複数呼び出しが同時に
 # 完了しても最終状態は常にどちらか一方の完全なスナップショットになり、
 # 壊れたファイルが残ることはない。
 tmp=SCHEDULE_CACHE_PATH.with_suffix(f'.fetch.{uuid.uuid4().hex}.tmp')
 last_error=None
 if shared.is_dir():
  # schedule_share_pathにファイル名を付け忘れ、共有フォルダそのものを
  # 指しているケース(実際に発生: 「unable to open database file」という
  # SQLite側の汎用エラーだけでは原因が伝わらなかった)。存在チェックだけの
  # 「未作成」判定(shared.exists()がFalse)では区別できないため、is_dir()で
  # 明示的に弾き、対処方法を直接伝える。
  raise ScheduleUnavailableError(f'schedule_share_pathがフォルダを指しています({shared})。schedule.sqlite3のようにファイル名まで指定してください(ファイル自体は未作成でも構いません。最初の書込み時に自動作成されます)。')
 if shared.exists():
  try:
   src=connect(shared,True,'sqlite')
   try:
    dst=connect(tmp,False,'sqlite')
    try:
     src.backup(dst)
    finally:
     dst.close()
   finally:
    src.close()
   if _verify_integrity(tmp):
    tmp.replace(SCHEDULE_CACHE_PATH)
    return SCHEDULE_CACHE_PATH,False
   last_error='取得結果が壊れていました(整合性チェック失敗)'
   app_logger().warning('スケジュールデータの取得結果が壊れていたため破棄しました: %s',shared)
  except Exception as e:
   last_error=str(e)
   app_logger().warning('スケジュールデータの取得に失敗しました(%s): %s',shared,e)
  finally:
   try:tmp.unlink(missing_ok=True)
   except Exception:pass
 else:
  # 共有ファイルがまだ存在しない(初回)。空のローカルコピーを新規に作る。
  if not SCHEDULE_CACHE_PATH.exists():
   c=connect(SCHEDULE_CACHE_PATH,False,'sqlite')
   try:ensure_meta_table(c)
   finally:c.close()
  return SCHEDULE_CACHE_PATH,False
 if SCHEDULE_CACHE_PATH.exists() and _verify_integrity(SCHEDULE_CACHE_PATH):
  return SCHEDULE_CACHE_PATH,True
 # 原因(last_error)を画面まで返す。サーバーのログを開かなくても
 # schedule_share_pathの設定ミス(ファイルではなくフォルダを指している等)に
 # その場で気づけるようにするため(以前は固定文言のみで原因が分からなかった)。
 detail=f'({shared}: {last_error})' if last_error else f'({shared})'
 raise ScheduleUnavailableError(f'共有データを取得できず、有効なローカルキャッシュもありません{detail}。')


def _push(local_path,shared_path):
 """ローカルの作業コピーを共有側へ反映する。直接上書きせず、一時名で書込んで
 からリネームする(§4.2手順4。リネームは多くのファイルシステムで準アトミック
 に扱われ、Box側が書込途中の中身を拾ってしまう窓を最小化する)。"""
 shared_path.parent.mkdir(parents=True,exist_ok=True)
 tmp=shared_path.with_suffix('.push.tmp')
 src=connect(local_path,True,'sqlite')
 try:
  dst=connect(tmp,False,'sqlite')
  try:
   src.backup(dst)
  finally:
   dst.close()
 finally:
  src.close()
 tmp.replace(shared_path)


@contextmanager
def _local_connection(path):
 c=connect(path,False,'sqlite')
 try:
  yield c
 finally:
  c.close()


def with_write(login_id,pc_name,uid,apply_fn):
 """§4.2の全サイクル。apply_fn(conn)はローカルの作業コピーへ変更を加えて
 良い(コミットは呼び出し側で行うため、apply_fn内でのcommitは不要)。
 戻り値はapply_fnの戻り値。

 例外: ScheduleNotConfigured / LockHeldError(423想定) /
 RevisionConflictError(409想定) / ScheduleUnavailableError。"""
 shared=_require_configured()
 token=acquire_lock(login_id,pc_name)
 try:
  local_path,stale=fetch_snapshot()
  if stale:
   app_logger().warning('スケジュールデータの最新性を確認できないまま書込を行います: %s',shared)
  with _local_connection(local_path) as c:
   base_revision=read_revision(c)
   result=apply_fn(c)
   c.commit()
  # 反映直前に共有側の改訂番号を再確認する(§4.4の二次防御)。取得に失敗した
  # 場合は、日常の書込がBoxの一時的な不調に引きずられて止まらないよう、
  # 警告のみで続行する(ロックが一次防御として既に機能しているため)。
  if shared.exists():
   try:
    check=connect(shared,True,'sqlite')
    try:
     shared_revision=_read_revision_only(check)
    finally:
     check.close()
    if shared_revision!=base_revision:
     raise RevisionConflictError(shared_revision)
   except RevisionConflictError:
    raise
   except Exception as e:
    app_logger().warning('反映前の改訂番号確認に失敗しました(処理は続行します): %s',e)
  with _local_connection(local_path) as c:
   bump_revision(c,uid)
  _push(local_path,shared)
  return result
 finally:
  release_lock(token)
