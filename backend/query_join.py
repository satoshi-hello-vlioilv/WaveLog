"""query_join.py: データソース同士のクエリ結合（§9.193）。

------------------------------------------------------------------------
**「読んだデータを、別のデータとつなげて使う」を1箇所で持つ。**

以前、一覧へ別のデータソースの列を足せるのは品質データだけで、突合キーも
「ロット番号・鋳造番号・製造材質」の決め打ちだった（backend/routes/tables.py
の `_join_quality_data`）。参照データは自由に増やせるようにしたのに
（§9.94・§9.163）、増やしたデータには「一覧として眺める」以外の使い道が
無かった——利用者の指示は「読むだけで終わらず、使うかどうか・どのデータと
して使うかを選べるようにして幅を広げたい」。

ここが持つのは3つだけ:
  ① どの結合が効くか   definitions_for()
  ② 行に当てる         apply_joins()
  ③ 保存する前の下見   probe()

**判定を画面へ写さないこと。** どのキーで何列が足されたかを知っているのは
ここだけで、2箇所に持つと「結合できると書いてあるのに結合されない」という
食い違いになる（§9.163で品質データの別名解決を1箇所へ寄せたのと同じ理由）。

**失敗しても一覧は出す（fail-open）。** ただし**なぜ結合できなかったのかは
必ず返す**——黙って素通しすると、利用者からは「設定したのに何も起きない」
としか見えない（品質データ結合が実際にそうだった）。
------------------------------------------------------------------------
"""
import unicodedata

from .db_access import (DBS, QUALITY_DB_KEY, WORK_DB_KEY, cols, connect, qi, tables)
from .logging_setup import app_logger
from . import source_capability

# 相手を引くときのIN句の単位（パラメータ数の上限対策。品質データ結合と同じ）。
_IN_CHUNK = 100
# 1回の結合で相手から読む行数の上限。**青天井にしない**——キーの打ち間違いで
# 相手の表を丸ごと引くと、共有越しでは数十秒画面が止まる。
_MAX_RIGHT_ROWS = 20000

norm_name = source_capability.norm_name
find_column = source_capability.find_column


def norm_value(v):
 """突合キーの値。全角/半角・前後空白のゆれを吸収する（CLAUDE.md「フィールド名」）。"""
 return unicodedata.normalize('NFKC', str(v if v is not None else '')).strip()


# ---- 既定の結合（保存されていない）-------------------------------------
# 品質データ結合(§9.21)は、マスタが空の現場でも今までどおり効いてほしい。
# **同じ処理を2つ持たない**ため、保存されない1件の定義としてこのエンジンに
# 乗せる（旧 `_join_quality_data` は廃止した）。
BUILTIN_QUALITY_NAME = '品質データ'
_QUALITY_KEY_ALIASES = ('lotNo', 'castingNo', 'mfgMaterial')
_QUALITY_KEY_LABEL = {'lotNo': 'ロット番号', 'castingNo': '鋳造番号', 'mfgMaterial': '製造材質'}


def builtin_quality_def():
 """役割「仕掛」と「品質」が両方あるときだけ名乗る、既定の結合。"""
 if not (WORK_DB_KEY and QUALITY_DB_KEY):
  return None
 return {
  'id': 0, 'builtin': True, 'name': BUILTIN_QUALITY_NAME,
  'left': WORK_DB_KEY, 'leftTable': '', 'right': QUALITY_DB_KEY, 'rightTable': '',
  'keys': [{'left': _QUALITY_KEY_LABEL[a], 'right': _QUALITY_KEY_LABEL[a], 'alias': a}
           for a in _QUALITY_KEY_ALIASES],
  'columns': [], 'prefix': '', 'multi': 'first', 'order': -1, 'active': True,
 }


# ---- 定義を読む --------------------------------------------------------
def all_definitions(include_disabled=False):
 """マスタに保存されている結合。読めなければ空（一覧は出す）。"""
 try:
  from .repositories import master_repo as mr
  with connect(DBS['MASTER']['path'], True) as c:
   return mr.query_joins(c, include_disabled=include_disabled)
 except Exception as e:
  app_logger().warning('クエリ結合マスタを読めませんでした: %s', e)
  return []


def definitions_for(db_key, table, include_builtin=True):
 """この一覧（データソース＋表）に効く結合を、当てる順に返す。

 **対象テーブルが空欄なら、そのデータソースのどの表でも効く。** 現場の
 データソースはたいてい表が1つで、名前を毎回入れさせても打ち間違いが
 増えるだけだから（入れてあるときだけ厳密に見る）。"""
 db_key = str(db_key or '')
 table = str(table or '')
 out = []
 for d in all_definitions():
  if d.get('left') != db_key:
   continue
  lt = str(d.get('leftTable') or '')
  if lt and table and lt != table:
   continue
  out.append(d)
 if include_builtin:
  b = builtin_quality_def()
  # **利用者が同じ相手への結合を作っていたら、既定は当てない。** 同じ列が
  # 2度足されることは `_unique_columns` が防ぐが、そのぶん相手を2回引く
  # ことになり、利用者が決めたキーではなく既定のキーで当たった列が残る。
  if b and b['left'] == db_key and not any(d.get('right') == b['right'] for d in out):
   out.insert(0, b)
 return out


# ---- 当てる ------------------------------------------------------------
def _info(d, applied=False, reason='', **kw):
 out = {'id': d.get('id'), 'name': d.get('name') or '', 'builtin': bool(d.get('builtin')),
        'right': d.get('right') or '', 'table': '', 'applied': applied, 'reason': reason,
        'matched': 0, 'ambiguous': 0, 'addedColumns': 0, 'addedColumnNames': []}
 out.update(kw)
 return out


def _resolve_key_column(columns, name, alias=''):
 """列名を引く。完全一致 → ゆれ吸収 → （既定の結合だけ）別名表。"""
 if name in columns:
  return name
 lowered = {norm_name(c): c for c in columns}
 hit = lowered.get(norm_name(name))
 if hit:
  return hit
 if alias:
  return find_column(columns, source_capability.FEATURE_ALIASES.get(alias) or [])
 return None


def _right_table(d, c, right_cfg):
 """相手の表を決める。指定があればそれ、無ければ既定テーブル→先頭。

 **既定の結合(品質データ)だけは「キーが揃っている表」を探す**——設定値の
 既定テーブルが実在しない現場が実際にあり、キー列を持たない別の表を掴んで
 黙って結合を諦めていた（§9.21の `_quality_key_table`）。"""
 names = tables(c)
 if not names:
  return None, None, '相手のデータソースに表がありません。'
 want = str(d.get('rightTable') or '').strip()
 if want:
  if want not in names:
   return None, None, f'相手の表「{want}」がありません（ある表: {"・".join(names)}）。'
  try:
   return want, cols(c, want, source=right_cfg['path']), ''
  except Exception as e:
   return None, None, f'相手の表「{want}」の列を読めません: {e}'
 ordered = ([right_cfg.get('preferred')] if right_cfg.get('preferred') in names else []) \
     + [n for n in names if n != right_cfg.get('preferred')]
 if d.get('builtin'):
  for t in ordered:
   try:
    cs = cols(c, t, source=right_cfg['path'])
   except Exception:
    continue
   if all(_resolve_key_column(cs, k['right'], k.get('alias')) for k in d['keys']):
    return t, cs, ''
  missing = '・'.join(_QUALITY_KEY_LABEL[a] for a in _QUALITY_KEY_ALIASES)
  return None, None, f'突合キー（{missing}）が揃った表が相手にありません。'
 t = ordered[0]
 try:
  return t, cols(c, t, source=right_cfg['path']), ''
 except Exception as e:
  return None, None, f'相手の表「{t}」の列を読めません: {e}'


def _added_names(d, right_cols, left_cols, key_right):
 """足す列の名前を決める。戻り値は [(相手の列名, 一覧での名前), ...]。

 **接頭辞は「ぶつかったときだけ」ではなく、指定があれば必ず付ける**——
 同じ名前の列が回によって付いたり付かなかったりすると、列レイアウトマスタ
 （列名が鍵）の設定がその都度はずれる。指定が無いときは、ぶつかった列は
 **足さない**（左を優先する。現在値としての信頼度が高い運用）。"""
 want = d.get('columns') or []
 pref = str(d.get('prefix') or '')
 left = set(left_cols)
 out = []
 for c in right_cols:
  if want and c not in want:
   continue
  if c in key_right and not want:
   continue          # 突合キーそのものは足さない（左に同じ値がある）
  name = (pref + c) if pref else c
  if name in left:
   continue
  if any(n == name for _, n in out):
   continue
  out.append((c, name))
 return out


def apply_joins(base_key, base_table, columns, rows, defs):
 """行に結合を当てる。戻り値: (列名リスト, 行リスト, 結合ごとの診断)。

 **左（元の一覧）の値を必ず優先する。** 相手を先に置いてから左で上書きする
 ので、同じ名前の列があっても一覧の見え方は変わらない。"""
 columns = list(columns or [])
 rows = list(rows or [])
 infos = []
 for d in (defs or []):
  try:
   columns, rows, info = _apply_one(d, columns, rows)
  except Exception as e:
   app_logger().warning('クエリ結合「%s」を当てられませんでした: %s', d.get('name'), e)
   info = _info(d, reason=f'結合できませんでした: {e}')
  infos.append(info)
 return columns, rows, infos


def _apply_one(d, columns, rows):
 keys = d.get('keys') or []
 if not keys:
  return columns, rows, _info(d, reason='突合キーが登録されていません。')
 left_cols = [(k, _resolve_key_column(columns, k['left'], k.get('alias'))) for k in keys]
 missing = [k['left'] for k, hit in left_cols if not hit]
 if missing:
  return columns, rows, _info(
   d, reason='この一覧に突合キーの列がありません: ' + '・'.join(missing))
 right_cfg = DBS.get(d.get('right') or '')
 if not right_cfg:
  return columns, rows, _info(
   d, reason=f'相手のデータソース「{d.get("right")}」が登録されていません'
             '（無効にした・キーを変えた・再起動していない、のいずれかです）。')
 if not rows:
  return columns, rows, _info(d, reason='表示中の行がありません。')
 lefts = [hit for _, hit in left_cols]
 first_values = sorted({norm_value(r.get(lefts[0])) for r in rows if norm_value(r.get(lefts[0]))})
 if not first_values:
  return columns, rows, _info(
   d, reason=f'表示中の行に「{lefts[0]}」の値がありません。')
 try:
  with connect(right_cfg['path'], right_cfg.get('role', 'readonly') == 'readonly') as c:
   t, right_cols, err = _right_table(d, c, right_cfg)
   if not t:
    return columns, rows, _info(d, reason=err)
   rights = [_resolve_key_column(right_cols, k['right'], k.get('alias')) for k in keys]
   lost = [k['right'] for k, hit in zip(keys, rights) if not hit]
   if lost:
    return columns, rows, _info(
     d, table=t, reason=f'相手の表「{t}」に突合キーの列がありません: ' + '・'.join(lost))
   index = {}
   dup_keys = set()
   ambiguous = 0
   cur = c.cursor()
   read = 0
   for i in range(0, len(first_values), _IN_CHUNK):
    chunk = first_values[i:i + _IN_CHUNK]
    ph = ','.join('?' for _ in chunk)
    cur.execute(f'SELECT * FROM {qi(t)} WHERE CStr({qi(rights[0])}) IN ({ph})', chunk)
    for row in cur.fetchall():
     read += 1
     if read > _MAX_RIGHT_ROWS:
      break
     dd = dict(zip(right_cols, row))
     rk = tuple(norm_value(dd.get(x)) for x in rights)
     if rk in index:
      ambiguous += 1
      dup_keys.add(rk)
      continue      # 表示順の最初の1件を残す
     index[rk] = dd
    if read > _MAX_RIGHT_ROWS:
     break
 except Exception as e:
  app_logger().warning('クエリ結合「%s」で相手を読めませんでした: %s', d.get('name'), e)
  return columns, rows, _info(d, reason=f'相手のデータへ接続できません: {e}')
 pairs = _added_names(d, right_cols, columns, set(rights))
 if not pairs:
  return columns, rows, _info(
   d, table=t, matched=0,
   reason='足せる列がありません（取り込む列の指定が今の相手の列と合っていないか、'
          'すべて同じ名前の列が一覧側にあります。接頭辞を入れると足せます）。')
 # 相手が2件以上当たったキーの扱い（'first'＝最初の1件／'blank'＝出さない）。
 # **どのキーが重なったかは索引に残らない**ので、索引を作るときに覚えておく。
 blank = str(d.get('multi') or 'first') == 'blank'
 merged = []
 matched = 0
 for r in rows:
  rk = tuple(norm_value(r.get(x)) for x in lefts)
  hit = index.get(rk)
  add = {}
  if hit is not None and not (blank and rk in dup_keys):
   matched += 1
   for src, name in pairs:
    add[name] = hit.get(src)
  add.update(r)          # 左（元の一覧）を必ず優先する
  merged.append(add)
 names = [n for _, n in pairs]
 info = _info(d, applied=True, table=t, matched=matched, ambiguous=ambiguous,
              addedColumns=len(names), addedColumnNames=names)
 if not matched:
  info['reason'] = f'キーが一致する行が相手にありませんでした（照合先: {t}）。'
 return columns + names, merged, info


def unique_columns(names):
 """列名を一意にする（順序は最初に出てきた位置を残す）。§9.113。"""
 seen = set()
 out = []
 for n in names or []:
  if n in seen:
   continue
  seen.add(n)
  out.append(n)
 return out


def summarize(infos):
 """全部の結合をまとめた1件の診断（画面の帯・列の分類が読む）。"""
 names = []
 for i in infos or []:
  names += list(i.get('addedColumnNames') or [])
 names = unique_columns(names)
 applied = [i for i in (infos or []) if i.get('applied')]
 failed = [i for i in (infos or []) if not i.get('applied')]
 return {
  'applied': bool(applied),
  'count': len(infos or []),
  'matched': sum(int(i.get('matched') or 0) for i in applied),
  'ambiguous': sum(int(i.get('ambiguous') or 0) for i in applied),
  'addedColumns': len(names),
  'addedColumnNames': names,
  'table': (applied[0].get('table') if applied else ''),
  'names': [i.get('name') for i in applied],
  'reason': '／'.join(f"{i.get('name')}: {i.get('reason')}" for i in failed if i.get('reason')),
 }


# ---- 保存する前の下見 --------------------------------------------------
def probe(d, sample=200):
 """この設定で実際に当たるかを、いまのデータで確かめる（§9.168と同じ作法）。

 **保存する前に確かめられること**が値打ち。読み込み先は起動時に1回だけ
 決まるので、これが無いと打ち間違いに気づけるのが再起動のあとになる。"""
 out = {'ok': False, 'reason': '', 'sampled': 0, 'matched': 0, 'ambiguous': 0,
        'addedColumns': 0, 'addedColumnNames': [], 'table': '', 'examples': []}
 left_cfg = DBS.get(d.get('left') or '')
 if not left_cfg:
  out['reason'] = '対象のデータソースが登録されていません。'
  return out
 try:
  with connect(left_cfg['path'], left_cfg.get('role', 'readonly') == 'readonly') as c:
   names = tables(c)
   t = str(d.get('leftTable') or '').strip() or (
       left_cfg.get('preferred') if left_cfg.get('preferred') in names else (names[0] if names else ''))
   if not t or t not in names:
    out['reason'] = f'対象の表「{t or "(未指定)"}」がありません。'
    return out
   cs = cols(c, t, source=left_cfg['path'])
   cur = c.cursor()
   cur.execute(f'SELECT * FROM {qi(t)} LIMIT {int(sample)}')
   rows = [dict(zip(cs, r)) for r in cur.fetchall()]
 except Exception as e:
  out['reason'] = f'対象のデータを読めません: {e}'
  return out
 out['sampled'] = len(rows)
 _cols, merged, infos = apply_joins(d.get('left'), t, cs, rows, [d])
 info = infos[0] if infos else _info(d, reason='確かめられませんでした。')
 out.update(ok=bool(info.get('applied')), reason=info.get('reason') or '',
            matched=int(info.get('matched') or 0), ambiguous=int(info.get('ambiguous') or 0),
            addedColumns=int(info.get('addedColumns') or 0),
            addedColumnNames=list(info.get('addedColumnNames') or []),
            table=info.get('table') or '')
 # 当たった行の実例を3件（1件では「たまたま」と区別が付かない。§9.105）。
 if out['addedColumnNames']:
  shown = out['addedColumnNames'][:4]
  for r in merged:
   if any(r.get(n) not in (None, '') for n in shown):
    out['examples'].append({n: ('' if r.get(n) is None else str(r.get(n))) for n in shown})
   if len(out['examples']) >= 3:
    break
 return out
