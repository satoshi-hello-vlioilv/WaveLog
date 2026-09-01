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
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

import json

from . import atomic_io
from . import paths
from .config import (SCHEDULE_LOCK_TTL_SEC_DEFAULT, SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT,
                     SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS,
                     SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT, SCHEDULE_WATCH_PAUSE_SEC_DEFAULT)
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
def _lock_verify_delay_default_ms():
 """ロックを読み直して確かめるまでの待ちの**既定**（§9.267の追補）。

 **置き場の種類で変える**（§9.263の`master_share`と同じ作法）——クラウド同期
 （Box等）は結果整合なので待たないと確かめにならないが、ファイルサーバー
 （SMB）は書いた直後に読み返せる。一律1.5秒にすると、**予定を1本足すたびに
 1.2秒よけいに待たされる**（しかもロックは設備をまたいで1本なので、他の設備を
 触っている人も一緒に待つ）。

 **明示の設定があればそちらが勝つ**——`schedule_lock_verify_delay_ms`を
 現場で決めた端末の動きを、既定を賢くしたせいで変えない。
 """
 try:
  if SCHEDULE_SHARE_PATH is not None and paths.cloud_sync_hint(Path(SCHEDULE_SHARE_PATH)):
   return SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT
 except Exception:
  return SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT
 return SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS

def _lock_verify_delay_sec():
 try:return int(path_config_value('schedule_lock_verify_delay_ms',_lock_verify_delay_default_ms()))/1000
 except (TypeError,ValueError):return _lock_verify_delay_default_ms()/1000


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
  # 削除も置き換えと同じで、別のPCが読んでいる最中はWindowsで拒まれる。
  # 消せないまま黙ると次の書込が待たされるので、少し粘ってから諦める。
  if not atomic_io.unlink(path,label='schedule.lock'):
   app_logger().warning('スケジュールロックの解放に失敗しました(TTLで自動的に切れます): %s',path)



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
 """セッション表を共有上のJSONへ書く。

 **置き換えは再試行する**(§9.108)。このJSONは全PCが数十秒ごとに読み書き
 するため、置き換えようとした瞬間に別のPCが読んでいる確率が普通に高い。
 Windowsは開かれているファイルを置き換えられない(WinError 5)ので、
 1回で諦めると解放が落ちて設備が最大TTLぶん掴まれたままになる
 (実機で「アクセスが拒否されました」として観測された)。"""
 path=_sessions_path()
 path.parent.mkdir(parents=True,exist_ok=True)
 tmp=path.with_suffix(f'.{uuid.uuid4().hex}.tmp')
 tmp.write_text(json.dumps(sessions,ensure_ascii=False),encoding='utf-8')
 try:
  atomic_io.replace(tmp,path,label='schedule.sessions')
 except OSError:
  atomic_io.unlink(tmp,budget_sec=0.5,label='schedule.sessions.tmp')
  raise


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
 # **持ち主かどうかの比べ方は acquire_session と1つにそろえる**(§9.211 ②)。
 # 以前は「login_id も pc_name も空なら必ず False」としていたため、素性を
 # 名乗れない端末は**自分が取ったセッションで自分の書込を423にしていた**
 # (acquire は通るのに require_session だけが弾く、という分かりにくい形)。
 # PC名は§9.208 ⑧で必ず取れるようにしたので通常は起きないが、判定が
 # 2通りある状態そのものを残さない。
 mine=(entry.get('login')==login_id and entry.get('pc')==pc_name)
 return {'configured':True,'held':True,'holderLogin':entry.get('login',''),
         'holderPc':entry.get('pc',''),'expiresAt':entry.get('expires_at'),'mine':mine}


def sessions_all(login_id='',pc_name=''):
 """いま生きている編集セッションを**全部**返す(§9.211 ②)。

 画面の在席表示のため。`session_status()`は設備1つぶんしか答えられないので、
 「誰が入っているか」を帯へ出すにはこちらが要る。**読むだけ**(排他なし)。
 期限切れは`_prune_expired`で落ちるので、返るのは今この瞬間の持ち主だけ。
 """
 if SCHEDULE_SHARE_PATH is None:
  return {'configured':False,'sessions':[],'me':{'loginId':login_id,'pcName':pc_name}}
 live=_prune_expired(_read_sessions_raw())
 out=[]
 for eq in sorted(live):
  entry=live[eq]
  out.append({'equipment':eq,
              'holderLogin':entry.get('login',''),'holderPc':entry.get('pc',''),
              'expiresAt':entry.get('expires_at'),'acquiredAt':entry.get('acquired_at'),
              'takenFrom':entry.get('taken_from') or None,
              'mine':entry.get('login')==login_id and entry.get('pc')==pc_name})
 return {'configured':True,'sessions':out,'ttlSec':SESSION_TTL_SEC_DEFAULT,
         'me':{'loginId':login_id,'pcName':pc_name}}


def take_over_session(equipment,login_id,pc_name,ttl_sec=None):
 """**持ち主を強制的に入れ替える**(§9.211 ②、利用者の指示)。

 セッションはTTL(既定90秒)で自然に消える。それでも奪う手立てが要るのは、
 「抜けているのに残っている」時間が現場では長すぎるため——
   - 端末ごと落ちて解放(release)が届かなかった
   - 共有への置き換えが失敗して解放だけが落ちた(§9.108)
   - ブラウザが残ったままハートビートだけ打ち続けている
 のいずれでも、待つしか手立てが無いと**その設備の予定を誰も直せない**。

 奪われた側は**次のハートビート(25秒以内)で423**になり、その場で
 READONLYへ落ちる。気づかないまま書き続けることは無い
 (書込APIも`require_session()`で二重に弾く)。

 誰から奪ったかは`taken_from`として残す——**黙って入れ替えない**。
 """
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 _require_configured()
 ttl=ttl_sec if ttl_sec is not None else SESSION_TTL_SEC_DEFAULT
 sessions=_prune_expired(_read_sessions_raw())
 current=sessions.get(equipment)
 taken_from=None
 if current and not _own_or_free(current,login_id,pc_name):
  taken_from={'login':current.get('login',''),'pc':current.get('pc','')}
 token=uuid.uuid4().hex
 now=datetime.now()
 sessions[equipment]={'login':login_id,'pc':pc_name,'token':token,
                      'acquired_at':now.isoformat(),
                      'expires_at':(now+timedelta(seconds=ttl)).isoformat(),
                      'taken_from':taken_from,
                      'taken_at':now.isoformat() if taken_from else None}
 _write_sessions(sessions)
 # **奪うときは必ず待って確かめる**(acquire_sessionの新規取得と同じ)。
 # 2台が同時に奪おうとしたときに双方が「取れた」と誤認すると、
 # どちらも書けてしまう(助言的ロックの前提が崩れる)。
 if _SESSION_VERIFY_DELAY_SEC>0:
  time.sleep(_SESSION_VERIFY_DELAY_SEC)
 verify=_prune_expired(_read_sessions_raw()).get(equipment)
 if not verify or verify.get('token')!=token:
  raise SessionHeldError(equipment,(verify or {}).get('login',''),(verify or {}).get('pc',''))
 app_logger().info('スケジュール編集権を引き継ぎました: %s <- %s (%s@%s)',
                   equipment,taken_from,login_id,pc_name)
 return {'expiresAt':verify['expires_at'],'takenFrom':taken_from}


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
 # 自分が今まさに保持しているセッションの「延長」か(=ハートビート)。
 # 取得競争ではないので、下の簡易検証で待つ意味が無い(§9.45)。
 renewing=bool(current)
 token=uuid.uuid4().hex
 now=datetime.now()
 # **延長で監査の跡を消さない**(§9.211 ②)。奪って取ったセッションは
 # `taken_from`/`taken_at`を持つが、25秒後の延長でそれを書かずに入れ直すと
 # **誰から奪ったのかが黙って消える**(§9.180の「登録側は上書きしない」と
 # 同じ理由)。延長は同じセッションの続きなので、登録時の情報は運ぶ。
 sessions[equipment]={'login':login_id,'pc':pc_name,'token':token,
                      'acquired_at':(current or {}).get('acquired_at') or now.isoformat(),
                      'expires_at':(now+timedelta(seconds=ttl)).isoformat(),
                      'taken_from':(current or {}).get('taken_from'),
                      'taken_at':(current or {}).get('taken_at')}
 _write_sessions(sessions)
 # schedule.lock.jsonのacquire_lock()と同じ考え方の簡易検証(§4.3参照)。
 # ほぼ同時に2端末が取得を試みた場合に双方が「取れた」と誤認する余地を
 # 減らす(完全排除はできないため、あくまで助言的ロックとして扱うこと)。
 # ただし**延長(ハートビート)では待たない**(§9.45)。既に自分が保持して
 # いる=他端末はSessionHeldErrorで弾かれている状態なので、取得競争が
 # 起きようがない。ハートビートは数十秒ごとに走るため、ここで毎回0.3秒
 # 待つと操作していない間もサーバーを占有し続けることになる。
 if _SESSION_VERIFY_DELAY_SEC>0 and not renewing:
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


def release_my_sessions(login_id,pc_name):
 """自分が持っている編集セッションを**全部**手放す（§9.301 ②）。

 終わるときの片付け用。**1回の書き込みでまとめて消す**——設備ごとに
 `release_session()`を呼ぶと、共有への書き込みが設備の数だけ増える
 （終了は待たせたくない場面なので、往復は1回に抑える）。
 戻り値は手放した設備名。**ベストエフォート**——消せなくても期限で消える。
 """
 if SCHEDULE_SHARE_PATH is None:return []
 try:
  sessions=_prune_expired(_read_sessions_raw())
  mine=[eq for eq,v in sessions.items()
        if v.get('login')==login_id and v.get('pc')==pc_name]
  if not mine:return []
  for eq in mine:del sessions[eq]
  _write_sessions(sessions)
  return sorted(mine)
 except Exception as e:
  app_logger().warning('編集セッションの一括解放に失敗しました: %s',e)
  return []


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


# ========================================================================
# 共有の見張り(§9.188)
# ========================================================================
# 以前は**GETのたびにfetch_snapshot()**を呼んでおり、1画面を開くだけで共有
# ファイル全体のbackup()が何度も走っていた。共有(Box等)越しでは1回が数百ms
# かかり、しかもそのあいだ共有ファイルを掴むので、他の端末の書込とぶつかる。
#
# 直したのは「いつ写すか」だけで、**読む先は今までどおり手元の作業コピー**。
#   ・改訂番号だけを見る(1行のSELECT。全体のbackup()より桁違いに軽い)
#   ・変わっていなければ写さない。写しはそのまま使う
#   ・変わっていたら写す。写したら**しばらく休む**(既定30秒)——更新が
#     続いているときに毎回写すと、こちらが共有を掴み続けることになる
#
# 「最後に確かめた時刻」を持ち、間隔の内側なら読みは共有へ触らない。
# **見張りが止まっていても読めること**が最優先なので、確かめてから
# 間隔を過ぎていたらその場で写す(＝従来の挙動へ落ちる)。
_watch={
 'verified_at':0.0,     # 最後に「写しは最新だ」と確かめられた時刻
 'signature':None,      # そのときの共有ファイルの見かけ(更新時刻・バイト数)
 'snapshot_at':0.0,     # 最後に写した時刻
 'revision':None,       # そのときの改訂番号
 'checks':0,'fetches':0,
 'last_error':'',
 'last_change_at':0.0,  # 共有側の変化を見つけた時刻
 'paused_until':0.0,    # 写した直後の休み
 'running':False,
}
_watch_lock=threading.Lock()


def watch_enabled():
 v=str(path_config_value('schedule_watch_enabled','auto') or 'auto').strip().lower()
 return v!='off'


def watch_interval_sec():
 try:n=int(path_config_value('schedule_watch_interval_sec',SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT))
 except (TypeError,ValueError):n=SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT
 return max(5,n)


def watch_pause_sec():
 try:n=int(path_config_value('schedule_watch_pause_sec',SCHEDULE_WATCH_PAUSE_SEC_DEFAULT))
 except (TypeError,ValueError):n=SCHEDULE_WATCH_PAUSE_SEC_DEFAULT
 return max(0,n)


def shared_revision():
 """共有側の改訂番号。**開けなければNone**（無いのか読めないのかは
    ここでは区別しない——呼び出し側は「確かめられなかった」として扱う）。
    共有ファイルを開く前に`Path.exists()`を挟まない(CLAUDE.mdの約束)。"""
 shared=SCHEDULE_SHARE_PATH
 if not shared:return None
 try:
  c=connect(shared,True,'sqlite')
  try:return _read_revision_only(c)
  finally:c.close()
 except Exception as e:
  with _watch_lock:_watch['last_error']=str(e)
  return None


def local_revision():
 if not SCHEDULE_CACHE_PATH.exists():return None
 try:
  c=connect(SCHEDULE_CACHE_PATH,True,'sqlite')
  try:return _read_revision_only(c)
  finally:c.close()
 except Exception:
  return None


def _shared_signature():
 """共有ファイルの見かけ(更新時刻・バイト数)。**確かめられなければNone**。

 共有越しでは「statだけ失敗してopenは成功する」ことがある(CLAUDE.md)。
 ここは**確認のためだけ**に使うので、失敗は「分からない」として扱い、
 それを理由に読みを止めない(分からないときは時間の窓で判断する)。"""
 shared=SCHEDULE_SHARE_PATH
 if not shared:return None
 try:
  st=shared.stat()
  return (int(st.st_mtime_ns),int(st.st_size))
 except Exception:
  return None


def _snapshot_is_fresh():
 """手元の写しをそのまま使ってよいか。

 **見かけが変わっていたら、間隔の内側でも写し直す**——アプリの外から
 共有ファイルを差し替えることがある(検証用の種入れ・別のツール)。
 見かけが確かめられないときだけ、時間の窓で判断する。"""
 if not watch_enabled():return False
 with _watch_lock:
  verified=_watch['verified_at'];sig=_watch['signature']
 if not verified:return False
 now_sig=_shared_signature()
 if now_sig is not None and sig is not None and now_sig!=sig:return False
 if (time.time()-verified)>watch_interval_sec():return False
 return SCHEDULE_CACHE_PATH.exists()


def mark_verified(revision=None,fetched=False,signature=None):
 """「写しは最新」と分かった時刻を記録する。書込のあと(＝手元が正)や、
    改訂番号が一致したときに呼ぶ。

 signatureは**確かめる前に**取った共有ファイルの見かけを渡すこと。
 取ったあとに取り直すと、写しているあいだに他の端末が書いた変更を
 「見た」ことにしてしまい、二度と写し直さなくなる。"""
 now=time.time()
 with _watch_lock:
  _watch['verified_at']=now
  _watch['signature']=signature if signature is not None else _shared_signature()
  if revision is not None:_watch['revision']=revision
  if fetched:
   _watch['snapshot_at']=now;_watch['fetches']+=1
   _watch['paused_until']=now+watch_pause_sec()


def watch_check():
 """1回ぶんの見張り。戻り値: 'fetched'（写した）/'same'（変化なし）/
    'paused'（休み中）/'unknown'（確かめられなかった）/'off'（見張らない）。"""
 if not watch_enabled():return 'off'
 if not SCHEDULE_SHARE_PATH:return 'off'
 with _watch_lock:
  _watch['checks']+=1
  paused=time.time()<_watch['paused_until']
 if paused:return 'paused'
 sig=_shared_signature()   # **読む前に**取る(§9.188)
 rev=shared_revision()
 if rev is None:
  # 共有が読めない。**写しがあるなら黙って使い続ける**(fail-open)。
  return 'unknown'
 with _watch_lock:known=_watch['signature']
 # **見かけが変わっていたら改訂番号を信じない**。改訂番号を上げずに中身が
 # 差し替わることがある(検証用の種入れ・別のツール)。ここで「同じ」と
 # 記録してしまうと、以後の読みが古い写しを最新だと思い込む。
 changed=(sig is not None and known is not None and sig!=known)
 mine=local_revision()
 if not changed and mine is not None and mine==rev:
  mark_verified(revision=rev,signature=sig)
  return 'same'
 try:
  fetch_snapshot(force=True)
 except Exception as e:
  with _watch_lock:_watch['last_error']=str(e)
  return 'unknown'
 with _watch_lock:_watch['last_change_at']=time.time()
 return 'fetched'


def watch_status():
 """画面へ出す状態(§9.188)。**覚えていることは画面に書く**——黙って
    古い写しを見せると「他のPCの変更が来ない」と受け取られる。"""
 with _watch_lock:
  st=dict(_watch)
 now=time.time()
 age=lambda t:(None if not t else round(now-t,1))
 return {
  'enabled':watch_enabled(),
  'running':st['running'],
  'intervalSec':watch_interval_sec(),
  'pauseSec':watch_pause_sec(),
  'revision':st['revision'],
  'snapshotAgeSec':age(st['snapshot_at']),
  'verifiedAgeSec':age(st['verified_at']),
  'lastChangeAgeSec':age(st['last_change_at']),
  'pausedForSec':max(0,round(st['paused_until']-now,1)) or None,
  'checks':st['checks'],'fetches':st['fetches'],
  'lastError':st['last_error'],
  'configured':bool(SCHEDULE_SHARE_PATH),
 }


def fetch_snapshot(force=False):
 """共有ファイルをローカルの作業コピーへ整合性のとれた状態で取得する
 (sqlite3.Connection.backup()。単純なファイルコピーは書込中に壊れたコピーを
 作りうるため使わない、§4.2手順2)。取得・検証に失敗した場合は直前に取得
 できていた最後の正常ローカルキャッシュへフォールバックする(§4.5)。
 キャッシュも無ければScheduleUnavailableError。
 戻り値: (ローカルパス, stale: bool)"""
 shared=_require_configured()
 # **見張りが「最新」と言っているうちは共有へ触らない**(§9.188)。
 # 書込(with_write)は必ずforce=Trueで来るので、排他の保証は変わらない。
 if not force and _snapshot_is_fresh():
  return SCHEDULE_CACHE_PATH,False
 sig=_shared_signature()   # **写す前に**取る(写しているあいだの変更を見落とさない)
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
    # 置き換え先(ローカルの作業コピー)は自分が読んでいる最中のことがある。
    # Windowsでは開かれていると置き換えられないので粘る(§9.108)。
    atomic_io.replace(tmp,SCHEDULE_CACHE_PATH,label='schedule.cache')
    mark_verified(revision=local_revision(),fetched=True,signature=sig)
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
  mark_verified(revision=0,fetched=True)
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
 # 共有側は他のPCが読んでいる最中のことがある(§9.108)。1回で諦めると
 # 書込サイクル全体が失敗し、ロックを取り直すところからやり直しになる。
 atomic_io.replace(tmp,shared_path,label='schedule.push')


@contextmanager
def _local_connection(path):
 c=connect(path,False,'sqlite')
 try:
  yield c
 finally:
  c.close()


def acquire_lock_deferred(login_id,pc_name,ttl_sec=None):
 """acquire_lock()を「ロックファイルの書込」と「再読込による検証」に分ける
 (§9.45)。戻り値は(token, verify)で、verify()を呼んだ時点で検証が完了する。

 検証は「書いてから一定時間おいて読み直す」ことに意味がある(Boxのような
 結果整合的な共有では、直後に読んでも他端末の書込がまだ見えないため)。
 一方その待ち時間は**何もしていない**時間なので、呼び出し側は待っている間に
 読み取り専用の作業(スナップショット取得)を挟める。検証を通るまで書込は
 一切行わないので、保証は従来と変わらない。"""
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
 written_at=time.monotonic()
 def verify():
  # 書込からverify_delayが経つまで待つ。呼び出し側が既にその時間を
  # 別の作業へ使っていれば、ここでの追加の待ちは0になる。
  remaining_wait=_lock_verify_delay_sec()-(time.monotonic()-written_at)
  if remaining_wait>0:
   time.sleep(remaining_wait)
  got=_read_lock()
  if not got or got.get('token')!=token:
   raise LockHeldError((got or {}).get('holder_login',''),(got or {}).get('holder_pc',''),5)
  return token
 return token,verify


def with_write(login_id,pc_name,uid,apply_fn):
 """§4.2の全サイクル。apply_fn(conn)はローカルの作業コピーへ変更を加えて
 良い(コミットは呼び出し側で行うため、apply_fn内でのcommitは不要)。
 戻り値はapply_fnの戻り値。

 例外: ScheduleNotConfigured / LockHeldError(423想定) /
 RevisionConflictError(409想定) / ScheduleUnavailableError。"""
 shared=_require_configured()
 # ロックの検証待ち(既定1.5秒)は「待つ」こと自体に意味があるが、その間は
 # 何もしていない時間でもある。読み取り専用のスナップショット取得を先に
 # 済ませ、待ち時間と重ねる(§9.45)。書込は検証を通ってからしか行わない
 # ので、排他の保証は従来と変わらない。
 token,verify_lock=acquire_lock_deferred(login_id,pc_name)
 try:
  # 書込は**必ず取り直す**(§9.188)。見張りの間隔を信用して書くと、
  # 間隔の内側に他端末が書いた変更を踏み潰すことになる。
  local_path,stale=fetch_snapshot(force=True)
  if stale:
   app_logger().warning('スケジュールデータの最新性を確認できないまま書込を行います: %s',shared)
  verify_lock()
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
  # 反映したので**手元の写しが正**。次の読みで写し直さない(§9.188)。
  mark_verified(revision=local_revision())
  return result
 finally:
  release_lock(token)
