"""sources.py: ダッシュボードのパネルが数える元（§9.628）。元の鍵 → 数えるファイルの並び（`pivot.Part`）。

元の鍵（パネルの`source`）は4つの形:
    src:<キー>  … データソースマスタの1行（仕掛・品質・実績・その他）。読むのは写し（`db_access.cfg()`・共有は直接読まない）。
                  設備ごとのファイル（ファイル名の型・§9.595）は設備ごとに1つずつ（`cfg_for()`）
    role:<役割> … 役割（仕掛・品質・実績）を担うデータソース。組み込みのダッシュボードはこれで書く（キーを変えても同じ表が開く）
    rec         … 測定データ（作業の記録）。実績データリストと同じ`actuals.rows()`の行を、設備ごとの表へ写して数える
    plan        … 作業予定。作業スケジュールと同じ`schedule_calc.expand_plan()`の行を、設備ごとの表へ写して数える
rec と plan は設備ごとの表＝LotScope の作業実績と同じ形（作業日・直・設備の段が使える。作業日と直は勤務体系の1箇所）。

設備の段（@equip）: 設備ごとのファイル・表は1つの設備。1つの表のデータソースは、設備の列（`EQUIP_COLUMNS`の最初に在る列）の値を
`EquipmentMatcher`で設備マスタの名前へそろえる（残仕掛設備ｺｰｽは「次の設備」なので前方一致）。
"""
import hashlib
import json
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from .. import actuals, db_access, db_mirror, paths, schedule_calc, schedule_sync
from ..quiet import quiet
from ..repositories import master_repo as mr
from ..repositories import schedule_repo as sr
from ..sqlite_io import cols, connect, qi, tables
from ..textnorm import normalize_equipment_name as normalize_part
from . import pivot
from .layout import MINE
from .equip_match import EquipmentMatcher
from .shifts import Clock

REC, PLAN = 'rec', 'plan'
REC_NAME, PLAN_NAME = '測定データ', '作業予定'
# 役割 → その役割を担うデータソースのキー（答えは db_access の1箇所・§9.87）
ROLE_KEYS = {db_access.PURPOSE_WORK: db_access.WORK_DB_KEY, db_access.PURPOSE_QUALITY: db_access.QUALITY_DB_KEY,
             db_access.PURPOSE_ACTUAL: db_access.ACTUAL_DB_KEY}
# 1つの表のデータソースで設備を見分ける列（先に在る物）と取り出し方
EQUIP_COLUMNS = (('設備名', 'そのまま'), ('設備', 'そのまま'), ('BOX設計_設備名', 'そのまま'),
                 ('残仕掛設備ｺｰｽ', '前方一致'), ('残仕掛設備コース', '前方一致'), ('ZANMC', '前方一致'))
REC_START, PLAN_START = '作業開始', '予定開始'


class SourceFail(Exception):
 """数える元を用意できない（理由・種類・状態コード）。kind=copying は写し終えたら読み直す。"""

 def __init__(self, error, kind='error', status=503):
  super().__init__(error)
  self.error, self.kind, self.status = error, kind, status

 def answer(self):
  return {'error': self.error, 'kind': self.kind, 'status': self.status}


# ---------------------------------------------------------------- 設備の名前・勤務体系
def equipment_names():
 """設備マスタの有効な設備（表示順）。設備の列の値をこの名前へそろえる"""
 try:
  with connect(db_access.DBS['MASTER']['path'], False) as mc:
   return [str(r[1]).strip() for r in mr.equipment_master_rows(mc) if str(r[1] or '').strip()]
 except Exception as e:
  quiet('設備マスタを読めない（設備の列の値をそのまま設備名にする）', e)
  return []


def clocks(names):
 """設備ごとの作業日・直の決め方（勤務体系マスタ。設備の体系が無ければ全設備の既定）"""
 out = {}
 try:
  with sr.config_master_conn() as mc:
   base = sr.shift_rows(mc, '')
   for n in names:
    out[n] = Clock(sr.shift_rows(mc, n) or base)
 except Exception as e:
  quiet('勤務体系を読めない（作業日は暦の日・直は「直の外」で数える）', e)
 return {n: out.get(n) or Clock([]) for n in names}


# ---------------------------------------------------------------- データソース（src:・role:）
def _src_key(source):
 """元の鍵 → データソースのキー（role: は役割を担うキー）。分からなければ空"""
 if source.startswith('src:'):
  return source[4:]
 if source.startswith('role:'):
  return ROLE_KEYS.get(source[5:]) or ''
 return ''


def _readable():
 return {k: v for k, v in db_access.DBS.items() if v.get('role') == 'readonly'}


def _equip_spec(path, table):
 """1つの表のデータソースの設備の段の決め方（設備の列が無ければ None）"""
 try:
  with pivot.connect_ro(path) as c:
   t = table if table in tables(c) else pivot.pick_table(tables(c), table)
   have = set(cols(c, t)) if t else set()
 except Exception as e:
  quiet('表の列を読めない（設備の段は使えないものとして続ける）', e)
  return None
 hit = next(((col, mode) for col, mode in EQUIP_COLUMNS if col in have), None)
 return {'column': hit[0], 'match': EquipmentMatcher(equipment_names(), hit[1])} if hit else None


def _copy_fail(e):
 return SourceFail(str(e), 'copying', 503)


def _src_parts(key, equips):
 entry = db_access.DBS.get(key)
 if not entry or entry.get('role') != 'readonly':
  raise SourceFail(f'データソース「{key}」がありません（マスタ管理 > データソースのキーを確かめてください）。', 'unknown', 404)
 name = entry.get('label') or key
 if not entry.get('pattern'):
  try:
   c = db_access.cfg(key)
  except db_mirror.NotCopiedYet as e:
   raise _copy_fail(e) from None
  return [pivot.Part(c['path'], preferred_table=entry.get('preferred') or '', equip=_equip_spec(c['path'], entry.get('preferred') or ''),
                     name=name)], [], name
 files = db_access.pattern_files(key)
 pick = {normalize_part(x) for x in equips or []}
 parts, failed, copying = [], [], None
 for k, (eq, _remote) in files.items():
  if pick and k not in pick:
   continue
  try:
   c = db_access.cfg_for(key, eq)
  except db_mirror.NotCopiedYet as e:
   copying = copying or e
   failed.append({'name': eq, 'error': str(e), 'kind': 'copying'})
   continue
  except Exception as e:
   failed.append({'name': eq, 'error': str(e), 'kind': 'error'})
   continue
  parts.append(pivot.Part(c['path'], preferred_table=entry.get('preferred') or '', equip={'name': eq}, name=eq))
 if not parts:
  if copying:
   raise _copy_fail(copying)
  raise SourceFail(db_access.no_pattern_file_text(key), 'unknown', 404)
 return parts, failed, name


# ---------------------------------------------------------------- 写して数える元（rec・plan）
_lock = threading.Lock()
_made = {}          # 元 → (署名, ファイル, 表の並び [(設備, 表)])
KEEP_FILES = 3      # 前の写しを残す数（数えている最中の問い合わせが読み終えるまで消さない）


def _folder():
 d = Path(paths.work_dir()) / 'dashboard'
 d.mkdir(parents=True, exist_ok=True)
 return d


def _write(kind, sig, by_equip):
 """設備ごとの行 → 写しの sqlite（設備ごとに1つの表）。名前は署名から（数えている写しを置き換えない）"""
 path = _folder() / f'{kind}-{sig[:16]}.sqlite3'
 if not path.exists():
  tmp = path.with_suffix('.tmp')
  if tmp.exists():
   tmp.unlink()
  con = sqlite3.connect(str(tmp))
  try:
   for i, (eq, (names, rows)) in enumerate(by_equip.items()):
    t = f't{i + 1}'
    con.execute(f'CREATE TABLE {qi(t)} ({", ".join(qi(n) for n in names)})')
    con.executemany(f'INSERT INTO {qi(t)} VALUES ({",".join("?" * len(names))})', rows)
   con.commit()
  finally:
   con.close()
  os.replace(tmp, path)
 _tidy(kind, path)
 return path, [(eq, f't{i + 1}') for i, eq in enumerate(by_equip)]


def _tidy(kind, keep):
 olds = sorted((p for p in _folder().glob(f'{kind}-*.sqlite3') if p != keep), key=lambda p: p.stat().st_mtime, reverse=True)
 for p in olds[KEEP_FILES - 1:]:
  try:
   p.unlink()
  except OSError as e:
   quiet('前の写しを消せない（次の写しのときにもう一度消す）', e)


def _sig(obj):
 return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str).encode('utf-8')).hexdigest()


def _cell(v):
 if v is None or isinstance(v, (int, float, str)):
  return v
 return '' if isinstance(v, (dict, list)) else str(v)


def _made_for(kind, build):
 """kind の写し。build() → (署名, {設備: (列, 行)})。署名が同じなら前の写し"""
 sig, by_equip = build()
 with _lock:
  hit = _made.get(kind)
  if hit and hit[0] == sig and hit[1].exists():
   return hit[1], hit[2]
  path, tables_ = _write(kind, sig, by_equip)
  _made[kind] = (sig, path, tables_)
  return path, tables_


def _work_parts(kind, start, equips, basis):
 build = rec_rows if kind == REC else plan_rows
 path, tables_ = _made_for(kind, build)
 pick = {normalize_part(x) for x in equips or []}
 tables_ = [(eq, t) for eq, t in tables_ if not pick or normalize_part(eq) in pick]
 if not tables_:
  what = '測定データ（作業の記録）' if kind == REC else '作業予定'
  raise SourceFail(f'数える{what}がありません。', 'unknown', 404)
 cl = clocks([eq for eq, _t in tables_])
 return [pivot.Part(path, table=t, preferred_table=t, work={'clock': cl[eq], 'basis': basis, 'start': start}, equip={'name': eq}, name=eq)
         for eq, t in tables_]


# ---- 測定データ（rec）: 列は実績データリストの候補（帳票と同じ1箇所・`actuals.catalog()`）＋芯の列
# 芯の列は前の生産管理ダッシュボードの軸と指標（設備・作業人数・品種・用途名・オペレータ・入力内容・作業時間）を必ず持つ
# （操業データ項目の顔ぶれで消えない）。同じ値の候補の列は出さない（_REC_SKIP）
REC_CORE = ('記録ID', '設備名', 'ロット番号', '状態', REC_START, '作業終了', '作業時間（分）', '作業日', '直', '品種', '用途名',
            '作業人数', 'オペレータ', '入力内容', '更新日時')
_REC_SKIP = {'calc.equipment', 'calc.workStart', 'calc.workEnd', 'calc.workDuration', 'calc.status', 'calc.updatedAt', 'calc.crewSize',
             'workTime.startAt', 'workTime.endAt', 'updatedAt', 'basic.lotNo', 'basic.purposeName', 'settings.crewSize', 'settings.operator',
             'settings.measureType', 'qualityInfo'}


def rec_columns():
 """測定データの列 → [(列の名前, 道)]。道が空の列は芯（`_rec_core()`が値を作る）"""
 out, seen = [(n, '') for n in REC_CORE], set(REC_CORE)
 for g in actuals.catalog('').get('groups') or []:
  for it in g.get('items') or []:
   path, label = str(it.get('key') or ''), str(it.get('label') or '').strip()
   if not path or not label or path in _REC_SKIP:
    continue
   name = label if label not in seen else f'{label}（{g.get("group") or path}）'
   if name in seen:
    continue
   seen.add(name)
   out.append((name, path))
 return out


def _rec_core(item):
 """芯の列の値（REC_CORE の順）。呼び名は前の画面と同じ（作業人数は「N名班」・品種は「用途名 / 丈数×条数」）"""
 b, st = item.get('basic') or {}, item.get('settings') or {}
 purpose = str(b.get('purposeName') or '').strip() or '用途未設定'
 v, h = st.get('verticalCount') or 1, st.get('horizontalCount') or 1
 crew = str(st.get('crewSize') or '').strip()
 return [item.get('id') or '', item.get('equipment') or '', item.get('lotNo') or '', item.get('status') or '',
         _stamp(item.get('workStart')), _stamp(item.get('workEnd')), item.get('durationMin'), item.get('workDate') or '', item.get('shift') or '',
         f'{purpose} / {v}丈×{h}条', purpose, f'{crew}名班' if crew and crew != '-' else '人数未設定',
         str(st.get('operator') or '').strip() or '-', str(st.get('measureType') or '').strip() or '-',
         _stamp(item.get('updatedAt') or item.get('updatedAtDb'))]


def _stamp(v):
 """ISO の日時（'2026-10-01T08:00:00.000Z' など）→ 'YYYY-MM-DD HH:MM:SS'（地方時）。読めなければ字のまま"""
 s = str(v or '').strip()
 if not s:
  return ''
 try:
  dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
  return (dt.astimezone() if dt.tzinfo else dt).strftime('%Y-%m-%d %H:%M:%S')
 except ValueError:
  return s


def rec_rows():
 items = actuals.rows()
 spec = rec_columns()
 names, paths_ = [n for n, _p in spec], [p for _n, p in spec if p]
 by = {n: (names, []) for n in equipment_names()}      # 記録の無い設備も表を持つ（数は 0 と答える・断らない）
 for it in items:
  eq = it.get('equipment') or '（設備なし）'
  vals = actuals.field_values(it, paths_)
  by.setdefault(eq, (names, []))[1].append(_rec_core(it) + [_cell(vals.get(p)) for p in paths_])
 order = {n: i for i, n in enumerate(equipment_names())}
 by = dict(sorted(by.items(), key=lambda kv: (order.get(kv[0], len(order)), kv[0])))
 # 署名は列・設備（表の顔ぶれ）・記録の版（写しのファイル名になる。どれかが変われば新しい写し）
 return _sig([names, list(by), [(it.get('id'), it.get('updatedAtDb'), it.get('updatedAt')) for it in items]]), by


# ---- 作業予定（plan）: 作業スケジュールの予定の行（子ロットは時刻を持たないので数えない）
# 所要時間（分）の列。数えた値（合計・平均・最大…）も分なので、画面は端末の時間の書き方（WL.duration）で書く（前の稼働状況と同じ・§9.628）
MINUTE_COLUMNS = frozenset({'作業時間（分）', '見積（分）', '経過（分）', '遅れ（分）'})
MINUTE_AGGS = frozenset({'sum', 'avg', 'min', 'max', 'median', 'q1', 'q3', 'iqr', 'range', 'sd', 'mode', 'pct'})


def minutes_of(m):
 """値（measure）が所要時間（分）か: 分の列を、分のまま返す集計で数えたとき（件数・割合などの表し方は分でない）"""
 return m.get('column') in MINUTE_COLUMNS and m.get('agg') in MINUTE_AGGS and not m.get('show')


PLAN_CORE = ('設備名', '種類', '状態', 'ロット番号', '検査番号', '鋳造番号', '題名', PLAN_START, '予定終了', '見積（分）',
             '経過（分）', '遅れ（分）', REC_START, '作業終了', '備考')


def _plan_core(eq, e):
 a = e.get('actual') or {}
 return [eq, e.get('kind') or '', e.get('state') or '', e.get('lotNo') or '', e.get('inspectionNo') or '', e.get('castingNo') or '',
         e.get('title') or '', _stamp(e.get('plannedStart')), _stamp(e.get('plannedEnd')), (e.get('estimate') or {}).get('minutes'),
         a.get('elapsedMinutes'), e.get('overdueMinutes') or 0, _stamp(a.get('startAt')), _stamp(a.get('endAt')), e.get('remark') or '']


def _plan_entries():
 """作業予定を使う設備ごとの予定の行（作業スケジュールの俯瞰と同じ読み方）。共有の予定が読めなければ SourceFail"""
 with connect(db_access.DBS['MASTER']['path'], False) as mc:
  names = [str(r[1]).strip() for r in mr.equipment_master_rows(mc, feature='schedule') if str(r[1] or '').strip()]
 try:
  local, _stale = schedule_sync.fetch_snapshot()
 except schedule_sync.ScheduleNotConfigured:
  raise SourceFail('作業予定の共有先が未設定です（マスタ管理 > パス設定）。', 'unknown', 404) from None
 except schedule_sync.ScheduleUnavailableError as e:
  raise SourceFail(str(e), 'error', 503) from None
 now = datetime.now()
 index = schedule_calc.build_actual_index()
 c = connect(local, False, 'sqlite')
 try:
  return [(eq, schedule_calc.expand_plan(c, eq, now=now, history_hours=None, actual_index=index)['entries']) for eq in names], now
 finally:
  c.close()


def plan_rows():
 per, now = _plan_entries()
 extra = []
 for _eq, entries in per:
  for e in entries:
   for k, v in (e.get('detail') or {}).items():
    if k not in PLAN_CORE and k not in extra and not isinstance(v, (dict, list)):
     extra.append(k)
 names = list(PLAN_CORE) + extra
 by = {}
 for eq, entries in per:      # 予定の無い設備も表を持つ（数は 0 と答える）
  rows = [_plan_core(eq, e) + [_cell((e.get('detail') or {}).get(k)) for k in extra] for e in entries if e.get('parentId') is None]
  by[eq] = (names, rows)
 return _sig([names, now.strftime('%Y-%m-%d %H:%M'), by]), by


# ---------------------------------------------------------------- 入口
def parts_for(source, equips=None, basis='work'):
 """パネルの元 → (数える Part の並び, 読めなかった設備 [{name, error, kind}], 元の名前)。用意できなければ SourceFail"""
 if MINE in (equips or []):
  # 自設備（この端末の使用設備）は画面が問い合わせる前に置き換える。置き換わらずに来た＝使用設備が決まっていない
  raise SourceFail('この端末の使用設備が未登録です（ヘッダーの「使用設備」から登録すると、その設備で数えます）。', 'unknown', 404)
 if source == REC:
  return _work_parts(REC, REC_START, equips, basis), [], REC_NAME
 if source == PLAN:
  return _work_parts(PLAN, PLAN_START, equips, basis), [], PLAN_NAME
 key = _src_key(source)
 if not key:
  what = f'役割「{source[5:]}」のデータソース' if source.startswith('role:') else f'元「{source}」'
  raise SourceFail(f'{what}がありません（マスタ管理 > データソースで役割を選んでください）。', 'unknown', 404)
 return _src_parts(key, equips)


def equip_ok(source):
 """その元で設備の段（@equip）を使えるか"""
 if source in (REC, PLAN):
  return True
 key = _src_key(source)
 entry = db_access.DBS.get(key) or {}
 if entry.get('pattern'):
  return True
 try:
  c = db_access.cfg(key)
 except Exception as e:
  quiet('写しを開けない（設備の段は使えないものとして答える）', e)
  return False
 return _equip_spec(c['path'], entry.get('preferred') or '') is not None


def source_state(key, entry):
 """データソースの元の状態（§9.630）: ready（読める）・copying（共有の元をまだ手元へ写せていない＝選べるが、写し終えてから数える）・
 unset（置き場が未設定＝選べない）。待たない・写さない（元の並びを返すたびに共有を開かない）"""
 path = str(entry.get('path') or '').strip()
 if not path:
  return 'unset'
 if entry.get('pattern'):
  return 'ready'          # 設備ごとのファイル: 読めない設備は数えるときに名指しする（`_src_parts()`の failed）
 try:
  return 'ready' if db_mirror.has_copy(key, path) else 'copying'
 except Exception as e:
  quiet('写しの有無を確かめられない（写し中として出す）', e)
  return 'copying'


def source_items():
 """パネルに使える元の並び（画面の「データ」の札）: 測定データ → 作業予定 → データソース（表示順）。
 state … ready・copying・unset（`source_state()`）。前は画面が来ない鍵（place）で全部「場所が未設定」にしていた（§9.630）"""
 out = [{'key': REC, 'name': REC_NAME, 'role': '', 'equip': True, 'work': True, 'state': 'ready',
         'hint': '作業の記録（実績データリストと同じ行）。設備ごと・作業日・直で数えられます'},
        {'key': PLAN, 'name': PLAN_NAME, 'role': '', 'equip': True, 'work': True, 'state': 'ready',
         'hint': '作業スケジュールの予定（予定・作業中・完了）。予定開始で作業日・直を決めます'}]
 for key, v in _readable().items():
  out.append({'key': f'src:{key}', 'name': v.get('label') or key, 'role': v.get('purpose') or '', 'equip': bool(v.get('pattern')) or None,
              'work': False, 'state': source_state(key, v),
              'hint': f'データソース「{v.get("label") or key}」' + ('（設備ごとのファイル）' if v.get('pattern') else '')})
 return out


def role_sources():
 """役割 → その役割を担う元の鍵（組み込みのダッシュボードの role: を画面が名前で言うため）"""
 return {r: f'src:{k}' for r, k in ROLE_KEYS.items() if k}
