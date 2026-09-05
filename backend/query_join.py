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

from .db_access import (DBS, QUALITY_DB_KEY, WORK_DB_KEY, cfg, cols, connect, path_config_value,
                        qi, tables)
from .logging_setup import app_logger
from . import source_capability
from .quiet import quiet

# 相手を引くときのIN句の単位（パラメータ数の上限対策。品質データ結合と同じ）。
_IN_CHUNK = 100
# 1回の結合で相手から読む行数の上限。**青天井にしない**——キーの打ち間違いで
# 相手の表を丸ごと引くと、共有越しでは数十秒画面が止まる。
_MAX_RIGHT_ROWS = 20000
# 「相手にしかない行」を出す結合(右外部・完全外部・右のみ)で読む、左側の
# 突合キーの上限。**表示中のページだけを見て決めないこと**——2ページ目に
# 居る行を「相手にしかない」と数えてしまい、ページを繰るたびに結果が変わる。
_MAX_LEFT_KEYS = 200000


# ---- 結合の仕方(§9.194) ------------------------------------------------
# SQLのJOINと同じ6通り。**3つの真偽値で表す**——「一致した行」「左にしか
# ない行」「右にしかない行」のどれを残すか。この3つが決まれば結合は決まる
# ので、画面のサンプル表も同じ3つから組み立てられる（説明と実際の動きが
# 食い違わない。**画面に別の判定を書かないこと**）。
JOIN_KINDS = [
 {'key': 'left', 'label': '左外部結合', 'short': 'この一覧は全部残す',
  'summary': 'この一覧の行はすべて残し、相手に当たった行だけ列に値が入ります。'
             '当たらなかった行は空欄になります。',
  'when': '相手のデータを「参考として添える」ときはこれ。行が減らないので、'
          '一覧の件数も並び順も今までどおりです。',
  'matched': True, 'leftOnly': True, 'rightOnly': False},
 {'key': 'inner', 'label': '内部結合', 'short': '両方にある行だけ',
  'summary': '相手に当たった行だけを残します。当たらなかった行は一覧から消えます。',
  'when': '「相手にも登録があるものだけ見たい」ときに。行が減ります。',
  'matched': True, 'leftOnly': False, 'rightOnly': False},
 {'key': 'right', 'label': '右外部結合', 'short': '相手を全部残す',
  'summary': '相手の行をすべて残します。この一覧に当たらなかった相手の行は、'
             '突合キーだけが入った行として増えます。',
  'when': '「相手を主役にして、こちらの値を添える」ときに。行が増えることがあります。',
  'matched': True, 'leftOnly': False, 'rightOnly': True},
 {'key': 'full', 'label': '完全外部結合', 'short': 'どちらかにあれば残す',
  'summary': 'この一覧の行も相手の行も、すべて残します。片方にしかない行は'
             'もう片方の列が空欄になります。',
  'when': '「両方を突き合わせて、抜けを洗い出す」ときに。行が増えることがあります。',
  'matched': True, 'leftOnly': True, 'rightOnly': True},
 {'key': 'leftOnly', 'label': 'この一覧にしかない行', 'short': '相手に無いものだけ',
  'summary': '相手に当たらなかった行だけを残します。**相手の列は足しません**'
             '（当たっていないので値がありません）。',
  'when': '「相手に登録し忘れているものを探す」ときに。行が減ります。',
  'matched': False, 'leftOnly': True, 'rightOnly': False},
 {'key': 'rightOnly', 'label': '相手にしかない行', 'short': 'この一覧に無いものだけ',
  'summary': 'この一覧に当たらなかった相手の行だけを出します。'
             'この一覧の列は突合キー以外すべて空欄になります。',
  'when': '「相手にあるのにこちらに無いものを探す」ときに。'
          'この一覧の行は1件も残りません。',
  'matched': False, 'leftOnly': False, 'rightOnly': True},
]
JOIN_KIND_DEFAULT = 'left'
_KIND_BY_KEY = {k['key']: k for k in JOIN_KINDS}


def kind_of(d):
 """定義から結合の仕方を引く。知らない値・未設定は既定（左外部）。"""
 return _KIND_BY_KEY.get(str((d or {}).get('kind') or '')) or _KIND_BY_KEY[JOIN_KIND_DEFAULT]

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
# 既定の結合を解除する印（パス設定マスタ。'off'＝使わない）。**既定は on**
# ——今まで何も設定せずに品質列が出ていた現場の見え方を変えない。
# 解除しても**エラーにはしない**（利用者の指示「該当する列データがないときには
# 品質情報のデータが検索・表示されないというだけでエラーなく使えるように」）:
# 列が足されなくなるだけで、その列を参照していた設定（列レイアウト・フィルタ）は
# 「無い列」として静かに落ちる。
BUILTIN_QUALITY_SWITCH_KEY = 'builtin_quality_join'
_QUALITY_KEY_ALIASES = ('lotNo', 'castingNo', 'mfgMaterial')
_QUALITY_KEY_LABEL = {'lotNo': 'ロット番号', 'castingNo': '鋳造番号', 'mfgMaterial': '製造材質'}


def builtin_quality_enabled(flags=None):
 """既定の品質データ結合を使うか。パス設定マスタの1行で切る。"""
 if flags is None:
  v = path_config_value(BUILTIN_QUALITY_SWITCH_KEY, '')
 else:
  v = flags.get(BUILTIN_QUALITY_SWITCH_KEY, '')
 return str(v or '').strip().lower() != 'off'


def builtin_quality_def():
 """役割「仕掛」と「品質」が両方あるときだけ名乗る、既定の結合。

 **解除されていても定義そのものは返す**——マスタ管理では「既定はどう
 つないでいるのか」を見て真似できることが値打ちなので、解除＝見えなく
 する、にはしない（利用者の指示「マージの参考となるため、他のデータと
 同じように品質の設定データも見られるように」）。当てるかどうかを決めるのは
 definitions_for() の1箇所。"""
 if not (WORK_DB_KEY and QUALITY_DB_KEY):
  return None
 return {
  'id': 0, 'builtin': True, 'name': BUILTIN_QUALITY_NAME,
  'left': WORK_DB_KEY, 'leftTable': '', 'right': QUALITY_DB_KEY, 'rightTable': '',
  'keys': [{'left': _QUALITY_KEY_LABEL[a], 'right': _QUALITY_KEY_LABEL[a], 'alias': a}
           for a in _QUALITY_KEY_ALIASES],
  'columns': [], 'prefix': '', 'multi': 'first', 'kind': JOIN_KIND_DEFAULT,
  'order': -1, 'active': True,
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
 if include_builtin and builtin_quality_enabled():
  b = builtin_quality_def()
  # **利用者が同じ相手への結合を作っていたら、既定は当てない。** 同じ列が
  # 2度足されることは `_unique_columns` が防ぐが、そのぶん相手を2回引く
  # ことになり、利用者が決めたキーではなく既定のキーで当たった列が残る。
  if b and b['left'] == db_key and not any(d.get('right') == b['right'] for d in out):
   out.insert(0, b)
 return out


# ---- 当てる ------------------------------------------------------------
def _info(d, applied=False, reason='', **kw):
 k = kind_of(d)
 out = {'id': d.get('id'), 'name': d.get('name') or '', 'builtin': bool(d.get('builtin')),
        'right': d.get('right') or '', 'table': '', 'applied': applied, 'reason': reason,
        'matched': 0, 'ambiguous': 0, 'addedColumns': 0, 'addedColumnNames': [],
        'kind': k['key'], 'kindLabel': k['label'], 'rowsBefore': 0, 'rowsAfter': 0,
        'droppedRows': 0, 'addedRows': 0, 'note': ''}
 out.update(kw)
 return out


def source_cfg(key):
 """データソースの設定を**読む場所（写し）で**返す。無ければNone。

 **`DBS[...]` を直に見ないこと**（§9.198）。`DBS`が持っているのは設定に
 書いてある元のパス＝共有フォルダそのもので、読み取り専用のデータソースは
 `db_mirror`が手元へ写している（`cfg()`がその写しを指す）。直に見ると
 **結合のたびに共有越しで相手の表を走査する**ことになり、一覧を開くたび・
 予定を読むたびにネットワークの往復が乗る（しかも写しを作った理由である
 「書込中の共有を読むと壊れる」も一緒に戻ってくる）。実際に一覧と
 スケジュールの読み込みが遅い原因の1つがこれだった。"""
 if not key or key not in DBS:
  return None
 try:
  return cfg(key)
 except Exception:
  return DBS.get(key)


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
   except Exception as _e:
    quiet('相手の列を読めない（この表は候補から外す）',_e)
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


def _left_key_set(base_key, base_table, key_names):
 """この一覧が持つ突合キーを全部集める。戻り値は (集合 or None, 但し書き)。

 **「相手にしかない行」を表示中のページだけで決めないこと**——2ページ目に
 居る行を「相手にしかない」と数えてしまい、ページを繰るたびに結果が変わる。
 読むのはキーの列だけ（1行200列の実データを丸ごと運ばない。§9.94）。"""
 src = source_cfg(base_key or '')
 if not src or not base_table:
  return None, ''
 try:
  with connect(src['path'], src.get('role', 'readonly') == 'readonly') as c:
   cur = c.cursor()
   sel = ','.join(qi(n) for n in key_names)
   cur.execute(f'SELECT {sel} FROM {qi(base_table)} LIMIT {_MAX_LEFT_KEYS + 1}')
   out = set()
   n = 0
   for row in cur:
    n += 1
    if n > _MAX_LEFT_KEYS:
     break
    out.add(tuple(norm_value(v) for v in row))
 except Exception as e:
  app_logger().warning('クエリ結合: 対象のキーを読めませんでした: %s', e)
  return None, f'この一覧のキーを読めませんでした（{e}）。'
 if n > _MAX_LEFT_KEYS:
  return out, f'この一覧が大きいため、先頭{_MAX_LEFT_KEYS}行と突き合わせました。'
 return out, ''


def apply_joins(base_key, base_table, columns, rows, defs):
 """行に結合を当てる。戻り値: (列名リスト, 行リスト, 結合ごとの診断)。

 **左（元の一覧）の値を必ず優先する。** 相手を先に置いてから左で上書きする
 ので、同じ名前の列があっても一覧の見え方は変わらない。"""
 columns = list(columns or [])
 rows = list(rows or [])
 infos = []
 for d in (defs or []):
  try:
   columns, rows, info = _apply_one(d, base_key, base_table, columns, rows)
  except Exception as e:
   app_logger().warning('クエリ結合「%s」を当てられませんでした: %s', d.get('name'), e)
   info = _info(d, reason=f'結合できませんでした: {e}')
  infos.append(info)
 return columns, rows, infos


def _read_right(c, t, right_cols, rights, rows, lefts, need_all, want=None):
 """相手の行を突合キーで索引する。戻り値: (索引, 重なったキー, 重なった件数)。

 **「相手にしかない行」を出す結合のときだけ相手を丸ごと読む**（それ以外は
 表示中の行のキーで絞る。共有越しに全件を運ぶと画面が数十秒止まる）。

 **`SELECT *` にしないこと**（§9.198）。実データは1表200列を超えるのに、
 使うのは突合キーと足す列だけ——相手の行を丸ごと運ぶと、当たった行の数だけ
 200列を読んで捨てることになる（品質データで実測、1行あたり十数倍）。
 `want`が要る列（キー＋足す列）で、渡されなければ今までどおり全列。"""
 index = {}
 dup_keys = set()
 ambiguous = 0
 read = 0
 cur = c.cursor()
 have = set(right_cols)
 take_cols = [x for x in (want or right_cols) if x in have] or list(right_cols)
 sel = ','.join(qi(x) for x in take_cols)

 def take(row):
  nonlocal ambiguous
  dd = dict(zip(take_cols, row))
  rk = tuple(norm_value(dd.get(x)) for x in rights)
  if rk in index:
   ambiguous += 1
   dup_keys.add(rk)
   return          # 表示順の最初の1件を残す
  index[rk] = dd

 if need_all:
  cur.execute(f'SELECT {sel} FROM {qi(t)} LIMIT {_MAX_RIGHT_ROWS}')
  for row in cur.fetchall():
   take(row)
  return index, dup_keys, ambiguous
 first_values = sorted({norm_value(r.get(lefts[0])) for r in rows if norm_value(r.get(lefts[0]))})
 for i in range(0, len(first_values), _IN_CHUNK):
  chunk = first_values[i:i + _IN_CHUNK]
  ph = ','.join('?' for _ in chunk)
  cur.execute(f'SELECT {sel} FROM {qi(t)} WHERE CStr({qi(rights[0])}) IN ({ph})', chunk)
  for row in cur.fetchall():
   read += 1
   if read > _MAX_RIGHT_ROWS:
    break
   take(row)
  if read > _MAX_RIGHT_ROWS:
   break
 return index, dup_keys, ambiguous


def _apply_one(d, base_key, base_table, columns, rows):
 kind = kind_of(d)
 keys = d.get('keys') or []
 if not keys:
  return columns, rows, _info(d, reason='突合キーが登録されていません。')
 left_cols = [(k, _resolve_key_column(columns, k['left'], k.get('alias'))) for k in keys]
 missing = [k['left'] for k, hit in left_cols if not hit]
 if missing:
  return columns, rows, _info(
   d, reason='この一覧に突合キーの列がありません: ' + '・'.join(missing))
 right_cfg = source_cfg(d.get('right') or '')
 if not right_cfg:
  return columns, rows, _info(
   d, reason=f'相手のデータソース「{d.get("right")}」が登録されていません'
             '（無効にした・キーを変えた・再起動していない、のいずれかです）。')
 lefts = [hit for _, hit in left_cols]
 # 相手にしかない行を出す結合は、表示中の行が無くても意味がある。
 if not rows and not kind['rightOnly']:
  return columns, rows, _info(d, reason='表示中の行がありません。')
 if rows and not kind['rightOnly'] and not any(norm_value(r.get(lefts[0])) for r in rows):
  return columns, rows, _info(d, reason=f'表示中の行に「{lefts[0]}」の値がありません。')
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
   # 「この一覧にしかない行」だけを残す結合は、相手の列を足さない（当たって
   # いないので値が無い）。空の列を並べても読む人の手間が増えるだけ。
   add_cols = kind['matched'] or kind['rightOnly']
   pairs = _added_names(d, right_cols, columns, set(rights)) if add_cols else []
   # **読む前に「要る列」を決める**（§9.198）。ここで決めておかないと
   # `SELECT *`しか書けず、使わない190列を運ぶことになる。
   index, dup_keys, ambiguous = _read_right(
    c, t, right_cols, rights, rows, lefts, kind['rightOnly'],
    want=list(dict.fromkeys(list(rights) + [src for src, _ in pairs])))
 except Exception as e:
  app_logger().warning('クエリ結合「%s」で相手を読めませんでした: %s', d.get('name'), e)
  return columns, rows, _info(d, reason=f'相手のデータへ接続できません: {e}')
 if add_cols and not pairs:
  return columns, rows, _info(
   d, table=t, matched=0,
   reason='足せる列がありません（取り込む列の指定が今の相手の列と合っていないか、'
          'すべて同じ名前の列が一覧側にあります。接頭辞を入れると足せます）。')
 note = ''
 left_all = None
 if kind['rightOnly']:
  left_all, note = _left_key_set(base_key, base_table, lefts)
  if left_all is None:
   left_all = {tuple(norm_value(r.get(x)) for x in lefts) for r in rows}
   note = (note or '') + '表示中のページと突き合わせました（この一覧の全体を読めませんでした）。'
 # 相手が2件以上当たったキーの扱い（'first'＝最初の1件／'blank'＝出さない）。
 # **どのキーが重なったかは索引に残らない**ので、索引を作るときに覚えておく。
 blank = str(d.get('multi') or 'first') == 'blank'
 merged = []
 matched = 0
 dropped = 0
 for r in rows:
  rk = tuple(norm_value(r.get(x)) for x in lefts)
  hit = index.get(rk)
  if hit is not None:
   matched += 1
   if not kind['matched']:
    dropped += 1
    continue
   add = {}
   if not (blank and rk in dup_keys):
    for src, name in pairs:
     add[name] = hit.get(src)
   add.update(r)          # 左（元の一覧）を必ず優先する
   merged.append(add)
  else:
   if not kind['leftOnly']:
    dropped += 1
    continue
   merged.append(dict(r))
 # 相手にしかない行を足す（右外部・完全外部・右のみ）。突合キーの列だけは
 # 相手の値で埋める——キーが空の行が並ぶと、どれが何の行か読めない。
 added_rows = 0
 if kind['rightOnly']:
  for rk, hit in index.items():
   if rk in left_all:
    continue
   row = {}
   for lc, rc in zip(lefts, rights):
    row[lc] = hit.get(rc)
   for src, name in pairs:
    row[name] = hit.get(src)
   merged.append(row)
   added_rows += 1
 names = [n for _, n in pairs]
 info = _info(d, applied=True, table=t, matched=matched, ambiguous=ambiguous,
              addedColumns=len(names), addedColumnNames=names)
 info.update(kind=kind['key'], kindLabel=kind['label'],
             rowsBefore=len(rows), rowsAfter=len(merged),
             droppedRows=dropped, addedRows=added_rows, note=note)
 if not matched and kind['matched']:
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
 """全部の結合をまとめた1件の診断（画面の帯・列の分類が読む）。

 **行が増減したことは必ず伝える**（§9.194）——列が足されるだけだった頃と
 違い、結合の仕方によっては一覧から行が消える。黙って消すと、利用者からは
 「絞り込んでいないのに件数が合わない」としか見えない。"""
 names = []
 for i in infos or []:
  names += list(i.get('addedColumnNames') or [])
 names = unique_columns(names)
 applied = [i for i in (infos or []) if i.get('applied')]
 failed = [i for i in (infos or []) if not i.get('applied')]
 dropped = sum(int(i.get('droppedRows') or 0) for i in applied)
 added = sum(int(i.get('addedRows') or 0) for i in applied)
 return {
  'applied': bool(applied),
  'count': len(infos or []),
  'matched': sum(int(i.get('matched') or 0) for i in applied),
  'ambiguous': sum(int(i.get('ambiguous') or 0) for i in applied),
  'addedColumns': len(names),
  'addedColumnNames': names,
  'table': (applied[0].get('table') if applied else ''),
  'names': [i.get('name') for i in applied],
  'kinds': unique_columns([i.get('kindLabel') for i in applied
                           if i.get('kind') and i.get('kind') != JOIN_KIND_DEFAULT]),
  'droppedRows': dropped,
  'addedRows': added,
  'rowsChanged': bool(dropped or added),
  'rowsAfter': (applied[-1].get('rowsAfter') if applied else 0),
  'note': '／'.join(i.get('note') for i in applied if i.get('note')),
  'reason': '／'.join(f"{i.get('name')}: {i.get('reason')}" for i in failed if i.get('reason')),
 }


# ---- 保存する前の下見 --------------------------------------------------
def probe(d, sample=200):
 """この設定で実際に当たるかを、いまのデータで確かめる（§9.168と同じ作法）。

 **保存する前に確かめられること**が値打ち。読み込み先は起動時に1回だけ
 決まるので、これが無いと打ち間違いに気づけるのが再起動のあとになる。"""
 out = {'ok': False, 'reason': '', 'sampled': 0, 'matched': 0, 'ambiguous': 0,
        'addedColumns': 0, 'addedColumnNames': [], 'table': '', 'examples': [],
        'kind': kind_of(d)['key'], 'kindLabel': kind_of(d)['label'],
        'rowsAfter': 0, 'droppedRows': 0, 'addedRows': 0, 'note': ''}
 left_cfg = source_cfg(d.get('left') or '')
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
            table=info.get('table') or '',
            rowsAfter=int(info.get('rowsAfter') or 0),
            droppedRows=int(info.get('droppedRows') or 0),
            addedRows=int(info.get('addedRows') or 0), note=info.get('note') or '')
 # 当たった行の実例を3件（1件では「たまたま」と区別が付かない。§9.105）。
 if out['addedColumnNames']:
  shown = out['addedColumnNames'][:4]
  for r in merged:
   if any(r.get(n) not in (None, '') for n in shown):
    out['examples'].append({n: ('' if r.get(n) is None else str(r.get(n))) for n in shown})
   if len(out['examples']) >= 3:
    break
 return out
