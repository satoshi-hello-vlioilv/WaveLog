"""master_repo.py: 各種マスタのデータアクセス層。

backend/masters.py から移設。テーブル定義(ensure_*_table)・正規化
(normalize_*_name)・読み取り(*_master_rows/read_*_names)・書き込み補助
(set_operator_equipment等)など、リクエスト処理(Flask)に
依存しないデータアクセスをここへ集める。CRUDのルート受付は
backend/routes/masters.py が持つ。

設備マスタ/オペレータマスタ(+作業可能設備)/スプール種別/内径種別/機器マスタ/
フィルタプリセットを提供する。すべてdb/master.sqlite3に保存し、
テーブルが無ければ初回アクセス時に自動作成する。
"""
import json

from ..db_access import (add_missing_columns, connect, ensure_audit_columns,
                         path_config_rows, set_path_config, tables, cols, qi)
from ..quiet import quiet
# 設備名の表記ゆれ吸収は backend/textnorm.py が持つ（§9.329）。db_access も
# 頭からこれを読むので、ここから再公開して既存の呼び出しを保つ。
from ..textnorm import normalize_equipment_name  # noqa: F401 再公開（§9.329）

EQUIPMENT_MASTER_TABLE='設備マスタ'
MAX_STRIPS_COLUMN='最大条数'
# 設備が扱う材料の形(§9.85)。コイル(巻いたまま)か板(切板)かで、現場の
# 段取りも測り方も変わるため、設備の属性として持つ。
# **空欄('')は「未設定」**で、既存の登録をそのまま動かすための状態
# (他マスタと同じ互換ポリシー。値を入れ直させない)。
EQUIPMENT_KIND_COLUMN='区分'
EQUIPMENT_KINDS=('コイル','板')

def normalize_equipment_kind(value):
 """入力を保存値へ。選択肢に無いものは未設定('')として扱う。"""
 s=str(value or '').strip()
 return s if s in EQUIPMENT_KINDS else ''
# 測定データの構造上の上限。測定値の配列も画面の条ストリップ(20行×2列)も40条で
# 組んであるため、設備ごとの設定はこれを超えられない。
STRIP_LIMIT=40
# 設備マスタに登録が無い/空の場合の既定。現在の主対象(LS4)が40条まで割れるため。
DEFAULT_MAX_STRIPS=40

def clamp_max_strips(value):
 """設備マスタの値を実際に使える条数へ丸める。未設定・不正値は既定。"""
 try:n=int(str(value).strip())
 except Exception as _e:quiet('数として読めない（既定で続ける）',_e);return DEFAULT_MAX_STRIPS
 if n<1:return DEFAULT_MAX_STRIPS
 return min(n,STRIP_LIMIT)

# 1ロットあたりの標準時間(分)。§9.114。
# **実績が1件も無いときの保険**で、実績から作る換算係数モデル
# (backend/load_factor.py)が組めるようになったらそちらが優先される。
# 空欄('')は「未設定」——他マスタと同じ互換ポリシーで、入れ直させない。
STANDARD_MINUTES_COLUMN='標準時間分'
# 上限は現実的な1作業の長さ。**入力ミスの歯止め**で、これを超える値を
# 入れるとタイムラインが何日も先まで伸びて読めなくなる(丸1日=1440分)。
STANDARD_MINUTES_MAX=1440.0

# ---------------------------------------------------------------------------
# 最大ライン速度（§9.231 ①、利用者の指示「設備マスタに最大ライン速度を追加」）
# ---------------------------------------------------------------------------
# **単位はm/min**。空欄＝未設定で、未設定を「0」と読まないこと（§9.114の
# 「空欄は未設定であって0ではない」と同じ）——0m/minのラインは無いので、
# 0を受け入れると「速度の上限0」という押しても何も入らない設定が作れる。
MAX_LINE_SPEED_COLUMN='最大ライン速度'
MAX_LINE_SPEED_MAX=100000.0

# ---------------------------------------------------------------------------
# 使える機能（§9.302、利用者の指示「設備マスタの有効・無効機能を実装して
# ください。有効無効の範囲については機能別に分けて変更できるようにしたい」）
# ---------------------------------------------------------------------------
# これまでの`[有効]`は**全部か無か**だった（マスタ画面の「削除」が0を書く）。
# ところが現場でいちばん多いのは「もうこのラインでは測らないし予定も組まない
# が、**過去のデータは見たいし帳票も刷りたい**」——全部か無かでは表せない。
#
# **保存するのは「使わない機能」のほう**（`[無効機能]`。カンマ区切り）。
# 空欄＝すべて使える、が既定になるので:
#  ・**触っていない現場は1つも変わらない**（§9.132）
#  ・**あとで機能を1つ足しても、既存の設備で黙って無効にならない**
#    （「使う機能」を保存する形だと、足した機能が全設備で最初から無効になる）
#
# `[有効]=0`（マスタ画面の「削除」）は**今までどおり全部無効**。機能別は
# その上に乗る2段目で、置き換えではない。
EQUIPMENT_DISABLED_COLUMN='無効機能'
# **並びは決める順**（測る → 予定を組む → 見る・刷る）。綴りは保存値なので
# 変えないこと（変えると保存済みの設定が「知らない機能」になる・§9.204）。
EQUIPMENT_FEATURES=(
 ('measure','測定','測定画面の「使用設備」に選べます'),
 ('schedule','作業予定','作業スケジュールの設備に出ます'),
 # **記録から出てくる設備は絞らない**——実績データの一覧・データ一覧は
 # 「何が起きたか」の履歴なので、外した設備の記録が読めなくなるのは行き過ぎ
 # （§9.15。隠すと直す手立てまで消える）。ここで絞るのは
 # 「これから紙の配置を作る設備」の候補だけ。
 ('report','帳票','帳票の配置を編集する設備の候補に出ます'),
)
EQUIPMENT_FEATURE_KEYS=tuple(k for k,_l,_n in EQUIPMENT_FEATURES)


def normalize_equipment_features(value):
 """入力を保存値（**使わない機能**のカンマ区切り）へ。

 受けるのは「使わない機能の並び」（リストでもカンマ区切りでも）。
 **知らない綴りは捨てる**——保存値が語彙から外れると、画面のチェックに
 現れないまま効き続ける（押しても外せない設定になる）。
 全部を無効にするのは**許す**——「この設備はもうどこにも出さない」は
 現場が選べてよい（そのことは画面が文字で書く・§4）。
 """
 if value is None:return ''
 if isinstance(value,(list,tuple,set)):items=list(value)
 else:items=str(value).replace('、',',').split(',')
 out=[]
 for x in items:
  k=str(x or '').strip()
  if k in EQUIPMENT_FEATURE_KEYS and k not in out:out.append(k)
 return ','.join(k for k in EQUIPMENT_FEATURE_KEYS if k in out)


def equipment_disabled_features(value):
 """保存値 → 無効な機能の集合。"""
 return set(normalize_equipment_features(value).split(',')) - {''}


def equipment_allows(disabled_value,feature):
 """この設備をその機能で使ってよいか。**判定はここ1箇所**（§9.163）
 ——画面もルートもこの答えを見るだけで、綴りから自分で判断しない。

 `feature`が空（＝機能を指定しない問い合わせ）は**常に真**——設備マスタの
 編集画面や、名前の綴り寄せ・改名の追跡は「使えるかどうか」とは別の話で、
 ここで絞ると**無効にした設備のロールや過去の設定が引けなくなる**。
 """
 f=str(feature or '').strip()
 if not f:return True
 if f not in EQUIPMENT_FEATURE_KEYS:return True   # 知らない機能では絞らない
 return f not in equipment_disabled_features(disabled_value)


# ---------------------------------------------------------------------------
# 設備ごとに使う「入力内容」（§9.392、利用者の指示「測定画面の入力内容を、
# 設備ごとに使う使わないと切り替えられるようにしてください」）
# ---------------------------------------------------------------------------
# **保存するのは「使わない入力内容」のほう**（`[無効入力内容]`。カンマ区切り）。
# `[無効機能]`（§9.302）と同じ作法で、空欄＝すべて使える。
#  ・**触っていない現場は1つも変わらない**
#  ・**あとで入力内容を1つ足しても、既存の設備で黙って無効にならない**
#
# 語彙は**画面の`WL.measureItem.ALL`と同じ綴り・同じ並び**。ここが保存値
# なので、綴りを変えないこと（変えると保存済みの設定が「知らない項目」に
# なる・§9.204）。
MEASURE_ITEM_DISABLED_COLUMN='無効入力内容'
# (綴り, 札の字, 添え書き)。並びは測定画面の一覧と同じ（決める順ではなく
# **画面と同じ順**——マスタで並べ替えると、どれを外したのか探すことになる）。
MEASURE_ITEMS=(
 ('全長','全長','母材（コイル1本ごと）の手入力。手計算・MIN/MAX・前後オフ'),
 ('寸法・外観','寸法・外観','製品（丈ごと）の手入力。長さ・肉厚・外観・巻ズレ・エッジ形状・備考'),
 ('板厚','板厚','丈位置ごとに3点（OS・CL・DS）'),
 ('板幅','板幅','条ごと'),
 ('ラテラルボー','ラテラルボー','条ごと'),
 ('バリ','バリ','条ごと'),
 ('テレスコープ','テレスコープ','条ごと'),
 ('巻ずれ','巻ずれ','条ごと'),
 ('フラットネス','フラットネス','条ごと（〇/△/×）'),
)
MEASURE_ITEM_KEYS=tuple(k for k,_l,_n in MEASURE_ITEMS)
# 旧綴り → いまの保存値（§9.396）。画面側の`WL.measureItem.LEGACY_*`と**同じ対応**を
# サーバーも持つ——設備マスタの`無効入力内容`に旧綴りで保存された行は、読み替えないと
# **黙って捨てられる**（`normalize_measure_items`は知らない綴りを落とすため）。
# その結果「外してあったはずの項目が復活する」という、遠い壊れ方をする。
MEASURE_ITEM_ALIASES={
 '母材':'全長','母材/丈毎':'全長','母材・揃い/肉厚/長さ':'全長',
 '丈毎':'寸法・外観','揃い/肉厚/長さ':'寸法・外観',
 '板厚/板幅':'板幅',
}


def normalize_measure_items(value):
 """入力を保存値（**使わない入力内容**のカンマ区切り）へ。

 **知らない綴りは捨てる**（`normalize_equipment_features`と同じ理由）。
 **全部を外すのは許さない**のはここではなく呼び出し側の役目——この関数は
 「保存できる形へ直す」だけで、断りの文はルートが出す（§9.324 の`api_guard`と
 同じ分担）。
 """
 if value is None:return ''
 if isinstance(value,(list,tuple,set)):items=list(value)
 else:items=str(value).replace('、',',').split(',')
 out=[]
 for x in items:
  k=str(x or '').strip()
  k=MEASURE_ITEM_ALIASES.get(k,k)
  if k in MEASURE_ITEM_KEYS and k not in out:out.append(k)
 return ','.join(k for k in MEASURE_ITEM_KEYS if k in out)


def equipment_disabled_measure_items(value):
 """保存値 → 使わない入力内容の集合。"""
 return set(normalize_measure_items(value).split(',')) - {''}


def read_equipment_measure_items_off(c,equipment):
 """設備名から「使わない入力内容」を引く。**読み取り専用接続でも使う**
    （測定画面の`/api/measurement/context`が呼ぶ）。
    列が無い・読めないときは**空**（＝すべて使える）を返す——伏せる側へ
    倒すと、設定していない現場で項目が消える。
 """
 name=normalize_equipment_name(equipment)
 if not name or EQUIPMENT_MASTER_TABLE not in tables(c):return []
 try:
  if MEASURE_ITEM_DISABLED_COLUMN not in set(cols(c,EQUIPMENT_MASTER_TABLE)):return []
  cur=c.cursor()
  cur.execute(f'SELECT {qi("設備名")},{qi(MEASURE_ITEM_DISABLED_COLUMN)},{qi("有効")} '
              f'FROM {qi(EQUIPMENT_MASTER_TABLE)}')
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2])
   if active and normalize_equipment_name(r[0])==name:
    return [k for k in MEASURE_ITEM_KEYS if k in equipment_disabled_measure_items(r[1])]
 except Exception as _e:quiet('列を読めない（入力内容はすべて使えるものとして扱う）',_e)
 return []


def normalize_max_line_speed(value):
 """入力を保存値へ。空欄・数にならないもの・0以下はNone(=未設定)。"""
 s=str(value if value is not None else '').strip()
 if not s:return None
 try:n=float(s)
 except Exception as _e:quiet('数として読めない（既定で続ける）',_e);return None
 if not (n>0):return None
 return round(min(n,MAX_LINE_SPEED_MAX),1)

def read_equipment_max_line_speed(c,equipment):
 """設備名から最大ライン速度(m/min)を引く。未設定・不正ならNone。
 読み取り専用接続でも使う(テーブル・列が無ければNone)。"""
 name=normalize_equipment_name(equipment)
 if not name or EQUIPMENT_MASTER_TABLE not in tables(c):return None
 try:
  if MAX_LINE_SPEED_COLUMN not in set(cols(c,EQUIPMENT_MASTER_TABLE)):return None
  cur=c.cursor()
  cur.execute(f'SELECT {qi("設備名")},{qi(MAX_LINE_SPEED_COLUMN)},{qi("有効")} '
              f'FROM {qi(EQUIPMENT_MASTER_TABLE)}')
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2])
   if active and normalize_equipment_name(r[0])==name:
    return normalize_max_line_speed(r[1])
 except Exception as _e:quiet('列を読めない（最大ライン速度は無いものとして扱う）',_e)
 return None

def normalize_standard_minutes(value):
 """入力を保存値へ。空欄・数にならないもの・0以下はNone(=未設定)。
 **0を「0分」として保存しない**——0分の作業は無いので、入力ミス
 (空欄のつもりで0)を仕様として受け入れると予定が全部同時刻に潰れる。"""
 s=str(value if value is not None else '').strip()
 if not s:return None
 try:n=float(s)
 except Exception as _e:quiet('数として読めない（既定で続ける）',_e);return None
 if not (n>0):return None
 return round(min(n,STANDARD_MINUTES_MAX),1)

def read_equipment_standard_minutes(c,equipment):
 """設備名から1ロットあたりの標準時間(分)を引く。未設定・不正ならNone。
 読み取り専用接続でも使う(テーブル・列が無ければNone)。"""
 name=normalize_equipment_name(equipment)
 if not name or EQUIPMENT_MASTER_TABLE not in tables(c):return None
 try:
  if STANDARD_MINUTES_COLUMN not in set(cols(c,EQUIPMENT_MASTER_TABLE)):return None
  cur=c.cursor()
  cur.execute(f'SELECT {qi("設備名")},{qi(STANDARD_MINUTES_COLUMN)},{qi("有効")} '
              f'FROM {qi(EQUIPMENT_MASTER_TABLE)}')
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2])
   if active and normalize_equipment_name(r[0])==name:return normalize_standard_minutes(r[1])
 except Exception as _e:quiet('列を読めない（標準時間は無いものとして扱う）',_e)
 return None

def ensure_equipment_master_table(c):
 names=tables(c);created=False
 if EQUIPMENT_MASTER_TABLE not in names:
  # 制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [設備マスタ] ([設備ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [区分] TEXT, [最大条数] INTEGER, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備マスタ_設備名] ON [設備マスタ] ([設備名])')
  c.commit();created=True
 # 既存環境には[最大条数]・[区分]が無い。空のまま足して「未設定＝既定値」で
 # 扱う(他マスタと同じ互換ポリシー。値を入れ直させない)。
 try:
  add_missing_columns(c,EQUIPMENT_MASTER_TABLE,
                      ((MAX_STRIPS_COLUMN,'INTEGER'),(EQUIPMENT_KIND_COLUMN,'TEXT'),
                       (STANDARD_MINUTES_COLUMN,'REAL'),(MAX_LINE_SPEED_COLUMN,'REAL'),
                       (EQUIPMENT_DISABLED_COLUMN,'TEXT'),
                       (MEASURE_ITEM_DISABLED_COLUMN,'TEXT')))
 except Exception as _e:quiet('後から足した列を用意できない（在る列だけで読む）',_e)
 ensure_audit_columns(c,EQUIPMENT_MASTER_TABLE)
 return created

def read_equipment_max_strips(c,equipment):
 """設備名から最大条数を引く。読み取り専用接続でも使う(テーブルが無ければ既定)。"""
 name=normalize_equipment_name(equipment)
 if not name or EQUIPMENT_MASTER_TABLE not in tables(c):return DEFAULT_MAX_STRIPS
 try:
  if MAX_STRIPS_COLUMN not in set(cols(c,EQUIPMENT_MASTER_TABLE)):return DEFAULT_MAX_STRIPS
  cur=c.cursor();cur.execute(f'SELECT {qi("設備名")},{qi(MAX_STRIPS_COLUMN)},{qi("有効")} FROM {qi(EQUIPMENT_MASTER_TABLE)}')
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2])
   if active and normalize_equipment_name(r[0])==name:return clamp_max_strips(r[1])
 except Exception as _e:quiet('列を読めない（最大条数は既定で扱う）',_e)
 return DEFAULT_MAX_STRIPS

def read_equipment_kind(c,equipment):
 """設備名から区分(コイル／板)を引く。読み取り専用接続でも使う。

    §9.157: 板丈(製造板丈)の公差は**板の設備でだけ意味を持つ**。コイルは
    巻いたままなので丈が決まらない。判定できないときは`''`(未設定)を返し、
    **画面側は未設定を「板」と決め付けない**——出どころの分からない公差を
    出すより、出さないほうがよい。
 """
 name=normalize_equipment_name(equipment)
 if not name or EQUIPMENT_MASTER_TABLE not in tables(c):return ''
 try:
  if EQUIPMENT_KIND_COLUMN not in set(cols(c,EQUIPMENT_MASTER_TABLE)):return ''
  cur=c.cursor()
  cur.execute(f'SELECT {qi("設備名")},{qi(EQUIPMENT_KIND_COLUMN)},{qi("有効")} '
              f'FROM {qi(EQUIPMENT_MASTER_TABLE)}')
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2])
   if active and normalize_equipment_name(r[0])==name:return normalize_equipment_kind(r[1])
 except Exception as _e:quiet('列を読めない（設備区分は空として扱う）',_e)
 return ''


def equipment_master_rows(c,feature=None):
 """有効な設備の行。**`feature`を渡すのは「人に選ばせる候補」を作るときだけ**
 （§9.302）——名前の綴り寄せ・改名の追跡・存在確認では渡さないこと。
 絞ると、その機能を切った設備のロールや過去の設定が引けなくなる。

 戻り値の末尾に`[無効機能]`・`[無効入力内容]`が付く（既存の添字は1つも
 動かさない。§9.392で1つ足した）。"""
 ensure_equipment_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [設備ID],[設備名],[表示順],[有効],[更新日時],[更新者ID],[最大条数],[区分],[標準時間分],'
             '[最大ライン速度],[無効機能],[無効入力内容] FROM [設備マスタ] ORDER BY [表示順],[設備名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if not (active and str(r[1] or '').strip()):continue
  # **`[有効]=0`は今までどおり全部無効**。機能別はその上に乗る2段目。
  if not equipment_allows(r[10] if len(r)>10 else '',feature):continue
  rows.append(r)
 return rows

# ========================================================================
# ---------------------------------------------------------------------------
# 移行が済んでいて、**アプリがもう読まない**表（§9.255 ①、利用者の報告）
# ---------------------------------------------------------------------------
# 「移行済みデータをすべて消したはずが、復活しました。
#   旧マスタは無ければ表示しない形にしたいです」
#
# 中身は§9.221 ③で`操業データ選択肢マスタ`へ、勤務形態は`勤務体系＋勤務区分`へ
# 移した。**それでも`ensure_*_table()`が「無ければ作る」ままだった**ので、
# 測定画面を1回開くだけで7つとも作り直され、マスタ管理の「移行済み」に
# 空の表が並び直していた（＝消せないマスタ）。
#
# **無ければ作らない。** 在るときだけ監査列をそろえて読む（移行前の中身を
# 見返すためだけに残す、という約束はそのまま）。消えていれば
# `/api/master-table/catalog`は実在する表しか返さないので、画面からも消える。
# **一覧はここ1箇所**——`backend/routes/master_tables.py`の`RETIRED`（説明文）
# と食い違わないことを`tests/test_rawmaster.py`が機械で見る（§9.163）。
RETIRED_TABLES = ('オペレータマスタ', 'オペレータ設備マスタ', '機器マスタ',
                  'スプール種別マスタ', '内径種別マスタ', 'バリ揃えマスタ',
                  'コイル止めマスタ', '勤務形態マスタ')


def retired_table_present(c, table):
 """移行済みの表が**いま在るか**。無ければ作らない（§9.255 ①）。

 在るときだけ監査列をそろえる——移行前の中身を見返す経路（マスタ管理の
 「移行済み」）はそのまま動く。**ここを「無ければ作る」に戻さないこと。"""
 if table not in tables(c):
  return False
 ensure_audit_columns(c, table)
 return True


# オペレータマスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
OPERATOR_MASTER_TABLE='オペレータマスタ'
def ensure_operator_master_table(c):
 # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
 retired_table_present(c,OPERATOR_MASTER_TABLE)
 return False

def normalize_operator_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_operator_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_operator_master_table(c)
 return created

def operator_master_rows(c):
 # **表が無ければ空**（§9.255 ①）。移行済みなので作り直さない。
 if OPERATOR_MASTER_TABLE not in tables(c):return []
 ensure_operator_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 # ﾖﾐｶﾞﾅは既存の呼び出し元のインデックス([0]〜[5])を壊さないよう末尾へ足す
 # (アクセス権限マスタでスケジュール関連3列を足したときと同じ方針)。
 cur.execute('SELECT [オペレータID],[氏名],[表示順],[有効],[更新日時],[更新者ID],[ﾖﾐｶﾞﾅ] FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

# ------------------------------------------------------------------------
# オペレータ設備マスタ（オペレータ×設備の中間テーブル、多対多）
#  - 設備マスタと同じ表記ゆれ吸収(normalize_equipment_name)で名称突合する。
#  - あるオペレータの割当が0件＝「制限なし（全設備で表示）」として扱う。
#    既存オペレータを不用意に画面から消さないための互換ポリシー。
# ------------------------------------------------------------------------
OPERATOR_EQUIPMENT_TABLE='オペレータ設備マスタ'
def ensure_operator_equipment_table(c):
 # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
 retired_table_present(c,OPERATOR_EQUIPMENT_TABLE)
 return False

def operator_equipment_map(c):
 # {オペレータID: [設備名, ...]} を返す。**表が無ければ空**（§9.255 ①）
 # ——移行済みなので、消えていれば「割当は無い」でよい。
 if OPERATOR_EQUIPMENT_TABLE not in tables(c):return {}
 ensure_operator_equipment_table(c)
 cur=c.cursor();cur.execute('SELECT [オペレータID],[設備名] FROM [オペレータ設備マスタ] ORDER BY [設備名]')
 out={}
 for oid,name in cur.fetchall():
  nm=str(name or '').strip()
  if not nm:continue
  out.setdefault(oid,[]).append(nm)
 return out

def ensure_operator_equipment(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_operator_equipment_table(c)
 return created

def set_operator_equipment(c,oid,names,uid):
 # 指定オペレータの割当設備を names の内容に完全同期する（増分の追加・削除）。
 # **移行済みの表なので、無ければ何もしない**（§9.255 ①）。
 if OPERATOR_EQUIPMENT_TABLE not in tables(c):return
 ensure_operator_equipment_table(c)
 cur=c.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[設備名] FROM [オペレータ設備マスタ] WHERE [オペレータID]=?',[oid])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [オペレータ設備マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [オペレータ設備マスタ] ([オペレータID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[oid,nm,uid,uid])
 c.commit()

# ------------------------------------------------------------------------
# 設備名の改名連動
#  - 設備マスタの[設備名]をキーに参照している内部マスタの一覧。設備名を
#    持たせる新しいマスタを追加したら必ずここへ追記する(追記を忘れても
#    既存の参照は壊れないが、改名時にサイレントに追従しなくなるだけなので
#    気づきにくい)。
#  - SIKALOTNOW側の生カラム(BOX設計_設備名等、工場側システムが所有する
#    読み取り専用データ)や、測定データ内のsettings.registeredEquipment
#    (その時点で実際に使った設備という履歴的事実)は対象に含めない。
#    改名時に過去の記録まで書き換えるのは事実の改ざんになるため。
# ------------------------------------------------------------------------
# 設備名を**文字列で**持っている内部マスタの一覧。**新しいマスタを足したら
# ここへ1行**足すだけで改名連動が効く、というのがこの表の値打ち。
# 第3要素は保存形:
#   'exact' … 1セルに設備名1つ(オペレータ設備マスタ)
#   'list'  … 設備停止マスタと同じカンマ区切り('*'＝すべての設備)。
#             読み書きは schedule_repo.stop_equipment_* が答える1箇所を通す。
# **表そのものを関数にしてあるのは循環importを避けるため**——
# operation_repo は master_repo を読む側なので、モジュールの頭では引けない。
def equipment_name_references():
 from . import operation_repo as op
 from . import roll_repo as rr
 return (
  (OPERATOR_EQUIPMENT_TABLE,'設備名','exact'),
  # ロールマスタ(§9.239 ⑥)。**足し忘れると設備を改名した瞬間に、その設備の
  # ロールが1本も出てこなくなる**（異常位置判定の「ピッチからロールを探す」が
  # 黙って0件になる）。**`'exact'`であること**——ロールは1行＝1設備で、
  # カンマ区切りも`'*'`も持たない（§9.239 ⑥ 訂正）。`'list'`のままだと
  # `stop_equipment_rename()`を通るので、設備名に読点やカンマを含む現場では
  # 名前が分解されて別物になる。
  (rr.TABLE,'設備名','exact'),
  # §9.221 ③でオペレータの作業可能設備の実体がここへ移った。**移した先を
  # この表へ足し忘れると、改名しても追従せず「その設備を選べるはずの
  # オペレータが選択肢に出てこなくなる」**——VER2.44.0で一度直した不具合
  # (CHANGELOG参照)を、置き場所を変えたことで再発させることになる。
  (op.CHOICE_TABLE,'対象設備','list'),
 )

def rename_equipment_references(c,old_name,new_name):
 # 設備マスタで改名された設備名を、これを参照する内部マスタ側にも反映する。
 # 正規化一致(表記ゆれ)する既存値のみを新名称へ書き換える。書き換え後に
 # 一意制約へ衝突する場合(改名先の名称が同じ紐付け先へ既に別行として
 # 登録されていた等のデータ不整合)は、そのUPDATEだけ諦めて重複行を
 # 削除する(新名称側の既存行を優先し、古い方は用済みとして片付ける)。
 old_norm=normalize_equipment_name(old_name)
 if not old_norm or old_norm==normalize_equipment_name(new_name):return 0
 from . import schedule_repo as sr
 total=0
 for table,col,mode in equipment_name_references():
  if table not in tables(c):continue
  cur=c.cursor()
  cur.execute(f'SELECT DISTINCT [{col}] FROM [{table}]')
  for (val,) in cur.fetchall():
   if not val:continue
   if mode=='list':
    # カンマ区切りは**中の1つだけ**を書き換える。丸ごと比較すると
    # 「設備A,設備B」のような行が1件も当たらず、黙って旧名が残る。
    nxt=sr.stop_equipment_rename(val,old_name,new_name)
    if nxt==val:continue
   else:
    if normalize_equipment_name(val)!=old_norm or str(val)==new_name:continue
    nxt=new_name
   try:
    cur.execute(f'UPDATE [{table}] SET [{col}]=? WHERE [{col}]=?',[nxt,val]);total+=cur.rowcount
   except Exception:
    cur.execute(f'DELETE FROM [{table}] WHERE [{col}]=?',[val])
 return total

def read_operator_names(c,equipment=None):
 # 読み取り専用接続から、有効なオペレータ氏名を表示順で取得する。
 # equipment指定時は、割当設備を持つオペレータをその設備でフィルタする。
 # 割当が1件もないオペレータは「制限なし」として常に含める（互換ポリシー）。
 if OPERATOR_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名],[表示順],[有効] FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
 rows=cur.fetchall()
 target=normalize_equipment_name(equipment) if equipment else ''
 eqmap=operator_equipment_map(c) if (target and OPERATOR_EQUIPMENT_TABLE in tables(c)) else {}
 out=[];seen=set()
 for oid,nm,order,active in rows:
  active=True if active is None else bool(active);nm=str(nm or '').strip()
  if not active or not nm:continue
  if target:
   assigned=eqmap.get(oid) or []
   if assigned and not any(normalize_equipment_name(a)==target for a in assigned):continue
  if nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

# ========================================================================
# スプール種別マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
SPOOL_MASTER_TABLE='スプール種別マスタ'
def ensure_spool_master_table(c):
 # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
 retired_table_present(c,SPOOL_MASTER_TABLE)
 return False

def normalize_spool_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_spool_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_spool_master_table(c)
 return created

def spool_master_rows(c):
 # **表が無ければ空**（§9.255 ①）。移行済みなので作り直さない。
 if SPOOL_MASTER_TABLE not in tables(c):return []
 ensure_spool_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [スプールID],[種別名],[表示順],[有効],[更新日時],[更新者ID] FROM [スプール種別マスタ] ORDER BY [表示順],[種別名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_spool_names(c):
 # 読み取り専用接続から、有効なスプール種別名を表示順で取得する。
 if SPOOL_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [種別名],[表示順],[有効] FROM [スプール種別マスタ] ORDER BY [表示順],[種別名]')
 out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[2] is None else bool(r[2]);nm=str(r[0] or '').strip()
  if active and nm and nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

# ========================================================================
# 内径種別マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
INNER_MASTER_TABLE='内径種別マスタ'
def ensure_inner_master_table(c):
 # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
 retired_table_present(c,INNER_MASTER_TABLE)
 return False

def normalize_inner_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_inner_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_inner_master_table(c)
 return created

def inner_master_rows(c):
 # **表が無ければ空**（§9.255 ①）。移行済みなので作り直さない。
 if INNER_MASTER_TABLE not in tables(c):return []
 ensure_inner_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [内径ID],[内径種別],[表示順],[有効],[更新日時],[更新者ID] FROM [内径種別マスタ] ORDER BY [表示順],[内径種別]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_inner_names(c):
 # 読み取り専用接続から、有効な内径種別を表示順で取得する。
 if INNER_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [内径種別],[表示順],[有効] FROM [内径種別マスタ] ORDER BY [表示順],[内径種別]')
 out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[2] is None else bool(r[2]);nm=str(r[0] or '').strip()
  if active and nm and nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

# ========================================================================
# 選択肢だけの単純マスタ（バリ揃え・コイル止め）
#  - 測定画面の「バリ揃え」「コイル止め」は、以前は画面へ直接書かれた固定の
#    選択肢（ラジオ／チェックボックス）だった。他の選択項目（オペレータ・
#    内径・スプール・機器）がすべてマスタから引いているのに、この2つだけ
#    現場で増やせず、見た目も他と揃っていなかったため、同じ作りへ揃える。
#  - 構造はスプール種別マスタ／内径種別マスタと同一（オートナンバー・
#    有効フラグ・表示順・論理削除）。2種類が完全に同じ形なので、写経して
#    片方だけ直る事故を避けるため生成関数でまとめる。
#  - **作成時に既定値を種として入れる**。空のマスタにすると選べる値が無く
#    なり、これまで通りの入力ができなくなるため（画面側にも同じ既定値の
#    フォールバックを持たせて二重に守る）。
# ========================================================================
BURR_MASTER_TABLE='バリ揃えマスタ'
COIL_STOP_MASTER_TABLE='コイル止めマスタ'
BURR_MASTER_SEED=['上バリ揃え','下バリ揃え','指定なし']
COIL_STOP_MASTER_SEED=['内巻両面テープ','指定なし']

def _build_simple_master(table,id_col,name_col,seed):
 """名称+備考だけの単純マスタ一式(ensure_table/ensure/rows/read_names/normalize)を作る。"""
 def ensure_table(c):
  # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
  # 既定の選択肢（`seed`）は`operation_repo.CHOICE_SEEDS`が持つので、
  # まっさらな端末でも選べる値は在る——ここで作り直す理由はもう無い。
  retired_table_present(c,table)
  return False
 def ensure(path):
  with connect(path,False) as c:
   return ensure_table(c)
 def rows(c):
  # **表が無ければ空**（§9.255 ①）。
  if table not in tables(c):return []
  ensure_table(c)
  cur=c.cursor()
  cur.execute(f'SELECT [{id_col}],[{name_col}],[表示順],[有効],[更新日時],[更新者ID] FROM [{table}] ORDER BY [表示順],[{name_col}]')
  out=[]
  for r in cur.fetchall():
   active=True if r[3] is None else bool(r[3])
   if active and str(r[1] or '').strip():out.append(r)
  return out
 def read_names(c):
  # 読み取り専用接続から、有効な名称を表示順で取得する。
  if table not in tables(c):return []
  cur=c.cursor();cur.execute(f'SELECT [{name_col}],[表示順],[有効] FROM [{table}] ORDER BY [表示順],[{name_col}]')
  out=[];seen=set()
  for r in cur.fetchall():
   active=True if r[2] is None else bool(r[2]);nm=str(r[0] or '').strip()
   if active and nm and nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
  return out
 def normalize(value):
  import unicodedata
  return unicodedata.normalize('NFKC',str(value or '')).strip().upper()
 return ensure_table,ensure,rows,read_names,normalize

ensure_burr_master_table,ensure_burr_master,burr_master_rows,read_burr_names,normalize_burr_name=\
 _build_simple_master(BURR_MASTER_TABLE,'バリ揃えID','バリ揃え',BURR_MASTER_SEED)
ensure_coil_stop_master_table,ensure_coil_stop_master,coil_stop_master_rows,read_coil_stop_names,normalize_coil_stop_name=\
 _build_simple_master(COIL_STOP_MASTER_TABLE,'コイル止めID','コイル止め',COIL_STOP_MASTER_SEED)

# ========================================================================
# 機器マスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 測定区分（板厚/板幅 等）を1列で保持し、用途別に読み分ける。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
DEVICE_MASTER_TABLE='機器マスタ'
def ensure_device_master_table(c):
 # **移行済み（§9.221 ③）なので無ければ作らない**（§9.255 ①）。
 retired_table_present(c,DEVICE_MASTER_TABLE)
 return False

def normalize_device_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_device_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_device_master_table(c)
 return created

def device_master_rows(c):
 # **表が無ければ空**（§9.255 ①）。移行済みなので作り直さない。
 if DEVICE_MASTER_TABLE not in tables(c):return []
 ensure_device_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [機器ID],[機器名],[測定区分],[表示順],[有効],[更新日時],[更新者ID] FROM [機器マスタ] ORDER BY [測定区分],[表示順],[機器名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[4] is None else bool(r[4])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def read_device_names(c,kind):
 # 読み取り専用接続から、指定測定区分の有効な機器名を表示順で取得する。
 if DEVICE_MASTER_TABLE not in tables(c):return []
 cur=c.cursor();cur.execute('SELECT [機器名],[測定区分],[表示順],[有効] FROM [機器マスタ] ORDER BY [表示順],[機器名]')
 target=normalize_device_name(kind);out=[];seen=set()
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3]);nm=str(r[0] or '').strip();kd=normalize_device_name(r[1])
  if not active or not nm:continue
  # 測定区分が一致、または区分が板厚/板幅を含む表記の揺れも許容する。
  if kd==target or (target and target in kd):
   if nm.casefold() not in seen:seen.add(nm.casefold());out.append(nm)
 return out

FILTER_PRESET_TABLE='フィルタプリセットマスタ'
# 対象モード('' = 共通 / 'schedule' = スケジュールモード専用)。同じ仕掛一覧でも
# スケジュールモードは品質データを結合して列構成が変わるため、使う条件も
# 別になる。混ざると「その表に無い列の条件」が並ぶので、保存先を分ける(§9.80)。
_FILTER_PRESET_MODE_COLUMN=('対象モード','TEXT')
# 所有者ID(§9.172)。**空欄＝みんなの**——今まで登録された分は誰のものでもない
# 共有として、そのまま全員に見え続ける(個人単位を後から入れたからといって、
# 既にある登録が誰かの持ち物になったり見えなくなったりしてはいけない)。
_FILTER_PRESET_OWNER_COLUMN=('所有者ID','TEXT')
# グループ(§9.286 ①、利用者の指示「登録フィルタのグループ化登録及びグループ
# ごとの一括切り替え機能」)。**空欄＝未分類**——今まで登録された分は
# どの群にも属さないまま、今までどおり全部見え続ける(所有者IDと同じ約束)。
# **群そのものの表は作らない**——群は「この登録に付けた名札」でしかなく、
# 別表にすると「行が1つも無い群」という決まらない状態が生まれる。
_FILTER_PRESET_GROUP_COLUMN=('グループ','TEXT')
# メンバー(§9.288 ②、利用者の指示「フィルタプリセットについては登録したデータを
# 使いまわせるような形が良いです。今だとグループのどこかに属するような使い方
# ですが、やりたいのはフィルタ登録したデータを何回でも使えるという組み合わせの
# プリセット登録です」)。
#
# `[グループ]`は**1つの条件が1つの群にしか属せない**——名札なので当然だが、
# それでは「この条件を3つのプリセットで使い回す」が書けない。そこで
# **組み合わせのほうを1行にする**: `[メンバーJSON]`にプリセットIDの配列を
# 持つ行が「組み合わせ（プリセット）」で、`[条件JSON]`を持つ行が
# 「登録した条件」。同じ条件のIDは何本の組み合わせにも現れてよい。
# **新しいマスタは作らない**——所有者・並び・対象DB/表/モードという
# 「どの場面のものか」は条件と組み合わせで同じなので、同じ表に置いたほうが
# 絞り込みも持ち主の判定も1つで済む(§9.287と同じ理由)。
#
# **IDで持つ**——名前で持つと、①同じ名前の個人フィルタと共有フィルタが
# 区別できない ②条件の名前を変えた瞬間にリンクが切れる。**持ち出し
# (§9.171)だけは名前へ直して運ぶ**(IDはマスタの連番なので別PCで食い違う)。
_FILTER_PRESET_MEMBERS_COLUMN=('メンバーJSON','TEXT')

def _add_missing_column(c,table,name,decl):
 """無ければ足す。**足したときだけTrue**——「この列を初めて作った」を
 一度きりの移行の合図に使える(§9.288 ②)。実処理は
 `add_missing_columns()`の1箇所（§9.315。同時に走っても壊れない——
 同時に足された場合は「こちらが足したのではない」ので False）。"""
 return bool(add_missing_columns(c,table,((name,decl),)))

def ensure_filter_preset_table(c):
 names=tables(c);created=False
 if FILTER_PRESET_TABLE not in names:
  # 設備マスタと同様の方針。条件はJSON文字列として保持し、使用回数は集計用に保持する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタプリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [対象DB] TEXT, [対象テーブル] TEXT, [条件JSON] TEXT, [使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PRESET_TABLE)
 # 既存DBには無い列なので、他のマスタと同じ「無ければALTER TABLEで足す」方式。
 for name,decl in (_FILTER_PRESET_MODE_COLUMN,_FILTER_PRESET_OWNER_COLUMN,
                   _FILTER_PRESET_GROUP_COLUMN):
  _add_missing_column(c,FILTER_PRESET_TABLE,name,decl)
 # **列を初めて作ったときだけ**、旧`[グループ]`を組み合わせの行へ移す
 # (§9.288 ②)。目印を別に持たないのは、`ALTER TABLE`が一度しか起きない
 # ことそのものが「まだ移していない」の合図だから(§9.255 ③の「移行済みの
 # 目印が永久に立たない」罠を避ける)。**旧列は消さない**——読まなくなる
 # だけにしておけば、取り違えたときに元の名札を見て直せる。
 if _add_missing_column(c,FILTER_PRESET_TABLE,*_FILTER_PRESET_MEMBERS_COLUMN):
  _migrate_groups_to_combos(c)
 return created

def _migrate_groups_to_combos(c):
 """旧`[グループ]`→組み合わせの行(§9.288 ②)。同じ群でも**場面と持ち主が
 違えば別の組み合わせ**(対象DB/表/モード/所有者は条件の側の絞り込みと
 揃える)。中身が1件でも作る——「群に入れた」という利用者の意思なので、
 こちらの都合で畳まない。"""
 cur=c.cursor()
 cur.execute('SELECT [プリセットID],[グループ],[対象DB],[対象テーブル],[対象モード],[所有者ID],[有効],[名称] FROM [フィルタプリセットマスタ]')
 buckets={}
 for pid,grp,db,tbl,mode,owner,active,name in cur.fetchall():
  g=str(grp or '').strip()
  if not g or not str(name or '').strip():continue
  if active is not None and not bool(active):continue
  buckets.setdefault((g,str(db or ''),str(tbl or ''),str(mode or ''),str(owner or '')),[]).append(pid)
 if not buckets:return 0
 cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]')
 order=int((cur.fetchone() or [0])[0] or 0)
 for (g,db,tbl,mode,owner),ids in buckets.items():
  order+=10
  cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[メンバーJSON],[使用回数],[表示順],[有効],[所有者ID],[グループ],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,0,?,-1,?,?,?,?,Now(),Now())',
              [g,db,tbl,mode,'[]',json.dumps(ids),order,owner,'','migrate','migrate'])
 c.commit()
 return len(buckets)

def filter_preset_members(raw):
 """`[メンバーJSON]`→プリセットIDの配列。**壊れていたら空**(＝ふつうの
 条件行として扱う)——例外にすると一覧が丸ごと出なくなる。"""
 try:ids=json.loads(raw or '[]')
 except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);return []
 if not isinstance(ids,list):return []
 out=[]
 for v in ids:
  try:
   n=int(v)
  except (TypeError,ValueError):
   continue
  if n not in out:out.append(n)
 return out

def filter_preset_rows(c):
 ensure_filter_preset_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する(使用回数の多い順で返す)。
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[最終使用日時],[有効],[更新日時],[更新者ID],[対象モード],[所有者ID],[グループ],[メンバーJSON] FROM [フィルタプリセットマスタ] ORDER BY [使用回数] DESC,[表示順],[名称]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

# ========================================================================
# フィルタ個人設定マスタ(§9.172)
#  - 「この一覧を開いたら自動で当てる(デフォルト)」「外すときに確認を挟む(鍵)」は
#    **人の好み**であって、登録フィルタそのものの性質ではない。以前は端末の
#    localStorageに置いていたため、(1)同じPCを別の人が使うと相手の既定が当たり、
#    (2)自分が別のPCへ移ると付けた覚えの印が消える、という形で出ていた。
#  - 1行＝(利用者ID × プリセットID)。**行が無い＝印なし**(他マスタと同じ互換
#    ポリシー)。両方の印が外れた行は消す——「無い」を2通りで表さない。
# ========================================================================
FILTER_PERSONAL_TABLE='フィルタ個人設定マスタ'
def ensure_filter_personal_table(c):
 names=tables(c);created=False
 if FILTER_PERSONAL_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタ個人設定マスタ] ([設定ID] INTEGER PRIMARY KEY AUTOINCREMENT, [利用者ID] TEXT, [プリセットID] INTEGER, [既定] INTEGER, [鍵] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_フィルタ個人設定マスタ] ON [フィルタ個人設定マスタ] ([利用者ID],[プリセットID])')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PERSONAL_TABLE)
 return created

def filter_personal_marks(c,user_id):
 """その人の印。{プリセットID: {'isDefault':bool,'isLocked':bool}}

 **利用者IDが空でも引ける**(その端末の主が誰か分からない場合の受け皿)。
 空を「全員ぶん」と読み替えてはいけない——他人の好みが当たってしまう。"""
 ensure_filter_personal_table(c)
 uid=str(user_id or '').strip()
 cur=c.cursor()
 cur.execute('SELECT [プリセットID],[既定],[鍵] FROM [フィルタ個人設定マスタ] WHERE [利用者ID]=?',[uid])
 out={}
 for pid,dflt,lock in cur.fetchall():
  if pid is None:continue
  out[int(pid)]={'isDefault':bool(dflt),'isLocked':bool(lock)}
 return out

def filter_personal_set(c,user_id,preset_id,is_default,is_locked,updated_by=''):
 """印を1件だけ書き換える。**両方外れたら行ごと消す**(上のコメント参照)。"""
 ensure_filter_personal_table(c)
 uid=str(user_id or '').strip();pid=int(preset_id)
 cur=c.cursor()
 if not is_default and not is_locked:
  cur.execute('DELETE FROM [フィルタ個人設定マスタ] WHERE [利用者ID]=? AND [プリセットID]=?',[uid,pid])
  c.commit();return False
 cur.execute('SELECT [設定ID] FROM [フィルタ個人設定マスタ] WHERE [利用者ID]=? AND [プリセットID]=?',[uid,pid])
 row=cur.fetchone()
 if row:
  cur.execute('UPDATE [フィルタ個人設定マスタ] SET [既定]=?,[鍵]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設定ID]=?',
              [-1 if is_default else 0,-1 if is_locked else 0,str(updated_by or uid)[:50],row[0]])
 else:
  cur.execute('INSERT INTO [フィルタ個人設定マスタ] ([利用者ID],[プリセットID],[既定],[鍵],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,-1,?,?,Now(),Now())',
              [uid,pid,-1 if is_default else 0,-1 if is_locked else 0,str(updated_by or uid)[:50],str(updated_by or uid)[:50]])
 c.commit();return True

def filter_personal_has_any(c,user_id):
 """その人の印が1件でもあるか。**一度きりの移行**(端末の控え→その人の印)を
 やってよいかの判定に使う。件数ではなく有無で判定するのは、移行後に全部外した
 人へもう一度移行を仕掛けないため……にはならない(0件に戻る)ので、画面側は
 別に「移行済みの目印」を端末へ残す。ここはサーバー側の安全弁。"""
 ensure_filter_personal_table(c)
 cur=c.cursor()
 cur.execute('SELECT COUNT(*) FROM [フィルタ個人設定マスタ] WHERE [利用者ID]=?',[str(user_id or '').strip()])
 return int((cur.fetchone() or [0])[0] or 0)>0

# ========================================================================
# アクセス権限マスタ（ログインID×PC名の組み合わせで編集可否を管理）
#  - 起動時にこの端末のログインID+PC名で照合し、編集可能/閲覧のみを判定する
#    (backend/access_mode.pyが使う)。該当行が無い場合は「編集可能」を既定と
#    する(複数のPCでローカル運用しており、通常は書き込みが1台に閉じている
#    現状の運用を壊さないため。閲覧専用にしたいPCだけ明示的に登録する)。
#  - キーはログインID＋PC名の組み合わせ(両方完全一致)。ワイルドカード
#    (空欄で「任意」扱い)は現状サポートしない。
# ========================================================================
ACCESS_PERMISSION_TABLE='アクセス権限マスタ'
# スケジュールモード(docs/SCHEDULE_MODE_DESIGN.md §3.2)で追加した3列。
# 既存の ensure_audit_columns と同じ「列が無ければ ALTER TABLE で足す」方式。
_SCHEDULE_PERMISSION_COLUMNS=(('スケジュール可否','INTEGER'),('現場段取り可否','INTEGER'),('現場段取り対象設備','TEXT'))
# ------------------------------------------------------------------------
# 権限区分（§9.272、利用者の指示「アクセス権限マスタに上位概念としてカテゴリ
# 追加し、開発者、メンテナンス者、一般ユーザーの3タイプを作ってください」）
#
# 既存の3つ（編集可否・スケジュール可否・現場段取り可否）が「**何を触れるか**」
# なのに対し、こちらは「**アプリそのものをどこまで管理できるか**」——在席を
# 見る／他の端末を切断する、という運用側の権限。**上位概念**なので、区分だけで
# 判定し、編集可否などとは掛け合わせない（閲覧モードの開発者も切断はできる）。
#
# **既定は一般ユーザー**。登録の無い端末に管理の権限を配らない（触れる範囲が
# 広がる側の既定は安全側へ倒す、という既存の約束と同じ）。編集可否の既定が
# 「可」なのは互換のためで、**そちらへ揃えないこと**。
# ------------------------------------------------------------------------
ROLE_DEVELOPER='開発者'
ROLE_MAINTAINER='メンテナンス者'
ROLE_USER='一般ユーザー'
# 設備作業者（§9.322、利用者の指示「測定の実績登録はできるが、マスタ類は
# 表示せず触れないというのが基本」「1設備1ユーザーをより実現しやすくしたい」）。
# **一般ユーザーより下**——今までの4区分の中でいちばん触れる範囲が狭い。
ROLE_OPERATOR='設備作業者'
# **並びは上位から**（画面の選択欄もこの順で出す）。
ROLES=(ROLE_DEVELOPER,ROLE_MAINTAINER,ROLE_USER,ROLE_OPERATOR)
ROLE_DEFAULT=ROLE_USER
# 上下関係。**「より上位の人しか区分を変えられない」の物差し**（§9.322）で、
# ここ1箇所が答える——ルートにも画面にも書き写さない（写すと「画面では
# 押せるのにサーバーが断る」が作れる）。
ROLE_RANK={ROLE_DEVELOPER:3,ROLE_MAINTAINER:2,ROLE_USER:1,ROLE_OPERATOR:0}
_ROLE_COLUMNS=(('権限区分','TEXT'),('マスタ編集','TEXT'))

def normalize_role(value):
 """保存値 -> 4つのどれか。知らない綴り・空欄は既定（一般ユーザー）。"""
 v=str(value or '').strip()
 return v if v in ROLES else ROLE_DEFAULT

def role_rank(value):
 """区分の上下。大きいほど上位。"""
 return ROLE_RANK.get(normalize_role(value),0)

# ------------------------------------------------------------------------
# マスタ編集（§9.322、利用者の指示「アクセス権限マスタの管理カテゴリに
# 『マスタ編集』を追加してください、非表示・閲覧のみ・部分的編集可・編集可の
# パターンが欲しいです」）
#
# 「何を触れるか」の3つ（編集可否・スケジュール可否・現場段取り可否）が
# **どのドメインへ書けるか**を決めるのに対し、こちらは**マスタ管理という
# 画面そのものをどこまで開くか**を決める。段は4つで、下から順に:
#   非表示     … マスタ管理の入口を出さない（画面へ辿り着けない）
#   閲覧のみ   … 開いて読めるが、1件も書けない
#   部分的編集可 … 現場のマスタ（測定・帳票・設備・スケジュールの設定）だけ書ける
#   編集可     … すべて書ける（今までと同じ）
#
# **既定は「編集可」**（§9.132）——登録の無い端末・この列を持たない既存の行の
# 見え方を1つも変えない。権限区分の既定（一般ユーザー）が安全側なのとは
# 理由が違う: あちらは「新しく配る管理の権限」、こちらは「現場が今使っている
# マスタ管理」で、絞ると触っていない端末の画面が黙って減る。
#
# **ただし区分の上限（キャップ）で頭打ちにする**（利用者の指示「権限区分以上の
# 権限は付与できないようにしてください」）。設備作業者だけが「非表示」に
# 張り付き、残る3区分は今までどおり「編集可」まで許す——一般ユーザーを絞ると、
# 登録の無い端末（＝既定で一般ユーザー）がマスタ管理を失い、しかも
# **アクセス権限マスタごと触れなくなって誰も直せない**（締め出し）。
# ------------------------------------------------------------------------
MASTER_EDIT_HIDDEN='非表示'
MASTER_EDIT_VIEW='閲覧のみ'
MASTER_EDIT_PARTIAL='部分的編集可'
MASTER_EDIT_FULL='編集可'
MASTER_EDIT_LEVELS=(MASTER_EDIT_HIDDEN,MASTER_EDIT_VIEW,MASTER_EDIT_PARTIAL,MASTER_EDIT_FULL)
MASTER_EDIT_RANK={MASTER_EDIT_HIDDEN:0,MASTER_EDIT_VIEW:1,MASTER_EDIT_PARTIAL:2,MASTER_EDIT_FULL:3}
MASTER_EDIT_DEFAULT=MASTER_EDIT_FULL
ROLE_MASTER_EDIT_CAP={ROLE_DEVELOPER:MASTER_EDIT_FULL,
                      ROLE_MAINTAINER:MASTER_EDIT_FULL,
                      ROLE_USER:MASTER_EDIT_FULL,
                      ROLE_OPERATOR:MASTER_EDIT_HIDDEN}

def normalize_master_edit(value):
 """保存値 -> 4段のどれか。知らない綴り・空欄は既定（編集可）。"""
 v=str(value or '').strip()
 return v if v in MASTER_EDIT_LEVELS else MASTER_EDIT_DEFAULT

def master_edit_rank(value):
 return MASTER_EDIT_RANK.get(normalize_master_edit(value),0)

def master_edit_cap(role):
 """その区分に**付与できる上限**。画面の選択欄もこれで絞る。"""
 return ROLE_MASTER_EDIT_CAP.get(normalize_role(role),MASTER_EDIT_HIDDEN)

def master_edit_options(role):
 """その区分で選べる段（上限まで）。**画面へ写さないための窓口**。"""
 top=master_edit_rank(master_edit_cap(role))
 return [lv for lv in MASTER_EDIT_LEVELS if MASTER_EDIT_RANK[lv]<=top]

def master_edit_effective(role,stored):
 """保存値に区分の上限を掛けた**実際に効く段**。

 保存値のほうが上でも上限で頭打ちにする——区分を下げただけで、前に
 与えてあった段が黙って効き続けることが無いようにする。"""
 want=normalize_master_edit(stored)
 cap=master_edit_cap(role)
 return want if MASTER_EDIT_RANK[want]<=MASTER_EDIT_RANK[cap] else cap

# マスタの区別。**管理のマスタ**＝アプリそのものの動きを決めるもの（権限・
# 置き場・接続・後片付け・生データ）で、`部分的編集可`では書けない。
# 綴りは画面のタブのキー（`MASTER_DEFS`の`key`）。**ここが正**で、画面は
# `/api/access-mode`の`adminMasters`を読むだけ（§9.163）。
# **書き込みがこの段に載っているタブだけを並べる**——`presence`（接続状況）と
# `importBackup`（データ引継ぎ）は書き先が別のBlueprint（`presence`／
# `measurement`）で、段では1つも止まらない。並べると画面の帯が
# 「読み取り専用」と名乗るのに実際は切断も引き継ぎもできる＝**合図が嘘をつく**
# （§CLAUDE 6）。接続状況は区分そのもの（`role_can('presence:view')`）が答える。
ADMIN_MASTER_KEYS=('accessPermission','pathConfig','dataSource','queryJoin',
                   'measStorage','cleanup','rawTable')

def master_scope_of(key):
 """タブのキー -> 'admin'（管理のマスタ）/ 'field'（現場のマスタ）。"""
 return 'admin' if str(key or '').strip() in ADMIN_MASTER_KEYS else 'field'

def master_edit_can(level,action,scope='field'):
 """この段で何ができるか。**ここ1箇所が答える**（§9.163）。

   'open'  … マスタ管理の画面を開く（入口を出す）
   'write' … その`scope`のマスタへ書く
 """
 lv=normalize_master_edit(level)
 if action=='open':
  return lv!=MASTER_EDIT_HIDDEN
 if action=='write':
  if lv==MASTER_EDIT_FULL:return True
  if lv==MASTER_EDIT_PARTIAL:return str(scope or 'field')!='admin'
  return False
 return False

def master_edit_capabilities(role,stored):
 """画面へ渡す「できること」。判定を画面へ書き写さないための窓口。"""
 lv=master_edit_effective(role,stored)
 return {'masterEdit':lv,
         'masterEditStored':normalize_master_edit(stored),
         'masterEditCap':master_edit_cap(role),
         'canOpenMaster':master_edit_can(lv,'open'),
         'canEditFieldMaster':master_edit_can(lv,'write','field'),
         'canEditAdminMaster':master_edit_can(lv,'write','admin'),
         'adminMasters':list(ADMIN_MASTER_KEYS)}

# ------------------------------------------------------------------------
# 表示列の編集（§9.512、利用者の指示「表示列の編集権限もマスタのアクセス権限の
# ところに管理できる内容として組み込んでください」）
#
# 一覧・作業スケジュールの**列の見せ方**（並び・幅・出す/出さない・名前・書式・
# 式・揃え）を誰が変えられるか。段は3つで、下から順に:
#   変更不可     … 列の見せ方を保存しない（見るだけ。幅を引いても保存されない）
#   自分の分だけ … 自分だけの見せ方（§9.259）は変えられる。みんなの分は変えない
#                  ——みんなと同じを見ているときに触ると、自分だけへ切り替えてから保存する
#   編集可       … みんなと同じの見せ方も変えられる（今までと同じ）
#
# **既定は「編集可」**（§9.132）——この列を持たない既存の行・登録の無い端末の
# 動きを1つも変えない。マスタ編集（上）とは**別の軸**: あちらはマスタ管理の
# 画面、こちらは一覧の画面の「見せ方」で、マスタ編集の段は見せ方に掛からない
# （`MASTER_EDIT_EXEMPT_ENDPOINTS`）。見せ方を絞る口はこの1列だけ。
# ------------------------------------------------------------------------
COLUMN_EDIT_NONE='変更不可'
COLUMN_EDIT_SELF='自分の分だけ'
COLUMN_EDIT_FULL='編集可'
COLUMN_EDIT_LEVELS=(COLUMN_EDIT_NONE,COLUMN_EDIT_SELF,COLUMN_EDIT_FULL)
COLUMN_EDIT_DEFAULT=COLUMN_EDIT_FULL
_COLUMN_EDIT_COLUMNS=(('表示列編集','TEXT'),)

def normalize_column_edit(value):
 """保存値 -> 3段のどれか。知らない綴り・空欄は既定（編集可）。"""
 v=str(value or '').strip()
 return v if v in COLUMN_EDIT_LEVELS else COLUMN_EDIT_DEFAULT

def column_edit_can(level,action):
 """この段で何ができるか。**ここ1箇所が答える**（§9.163）。

   'own'    … 自分だけの見せ方を保存する・みんなと同じ⇄自分だけを切り替える
   'common' … みんなと同じの見せ方を保存する
 """
 lv=normalize_column_edit(level)
 if action=='own':return lv in (COLUMN_EDIT_SELF,COLUMN_EDIT_FULL)
 if action=='common':return lv==COLUMN_EDIT_FULL
 return False

def column_edit_capabilities(level):
 """画面へ渡す「できること」。判定を画面へ書き写さないための窓口。"""
 lv=normalize_column_edit(level)
 return {'columnEdit':lv,
         'canEditOwnColumns':column_edit_can(lv,'own'),
         'canEditCommonColumns':column_edit_can(lv,'common')}

# 段が掛からない対象。`report:<設備>`は**帳票の紙の配置**（§9.174）で、同じ
# 列レイアウトマスタに住んでいるが「表示列」ではない（帳票ブロック・帳票
# レイアウトマスタと組で決めるもの）。住まいが同じだけで絞ると、帳票を
# 直す人が表示列の段で止まる。
COLUMN_EDIT_EXEMPT_PREFIXES=('report:',)

def column_edit_applies(target):
 """その対象に「表示列の編集」の段が掛かるか。"""
 return not str(target or '').startswith(COLUMN_EDIT_EXEMPT_PREFIXES)

def column_edit_for_target(level,target):
 """その対象で何ができるか（画面の列の設定パネルが読む）。"""
 if not column_edit_applies(target):
  return {'columnEdit':COLUMN_EDIT_FULL,'canEditOwnColumns':True,'canEditCommonColumns':True}
 return column_edit_capabilities(level)

def column_edit_check(level,owner,target=''):
 """列の見せ方を保存してよいか。`owner`は保存先（''＝みんなと同じ）。
    `(ok, reason)`を返す。理由は**次にすること**まで言う。"""
 if target and not column_edit_applies(target):return True,''
 lv=normalize_column_edit(level)
 if not column_edit_can(lv,'own'):
  return False,('この端末の「表示列の編集」は「変更不可」です。列の並び・幅・表示は保存されません。'
                '変更が要る場合は、アクセス権限マスタで「表示列の編集」を上げてもらってください。')
 if not owner and not column_edit_can(lv,'common'):
  return False,('この端末の「表示列の編集」は「自分の分だけ」です。みんなと同じ表示列は変えられません。'
                '列の設定で「自分だけ」に切り替えてから変えてください。')
 return True,''

# 何ができるか。**ここ1箇所が答える**（§9.163）——画面にもルートにも
# 書き写さない。写すと「画面には切断ボタンが出るのにサーバーが断る」が作れる。
#   'presence:view'       … 接続状況を見る
#   'presence:disconnect' … 他の端末を切断する（対象の区分も見る）
#   'presence:forget'     … 使わなくなった端末の接続の記録を消す（§9.513）
#   'role:grant'          … 他の端末の権限区分を変える（対象の区分も見る）
#   'choice:inline-add'   … 測定画面から選択肢マスタへ間接的に登録する
def role_can(role,action,target_role=''):
 r=normalize_role(role)
 if action=='presence:view':
  # **設備作業者は見られない**（§9.322）——接続状況はマスタ管理の中の
  # 管理のタブで、「マスタ類は表示せず触れない」に含まれる。
  return r!=ROLE_OPERATOR
 if action=='presence:disconnect':
  if r==ROLE_DEVELOPER:return True
  if r==ROLE_MAINTAINER:
   # **開発者は切れない**（利用者の指示「開発者を除いて実行可能」）。
   return normalize_role(target_role)!=ROLE_DEVELOPER
  return False
 if action=='presence:forget':
  # 記録を消すと「古い版の端末」の数が変わる＝配布の判断が変わる。
  # 切断できる区分（開発者・メンテナンス者）だけに許す（§9.513）。
  return r in (ROLE_DEVELOPER,ROLE_MAINTAINER)
 if action=='role:grant':
  # **より上位の人しか区分を触れない**（§9.322、利用者の指示「権限区分に
  # 関しての変更はより上位権限を持つ人からの変更しか受け付けない」）。
  # **例外は開発者だけ**——`presence:disconnect`と同じ「開発者＝制限なし」の
  # 約束をここでも通す。通さないと**開発者の行を誰も直せない**（自分の行は
  # 自分で触れない・同格も不可、で行き止まりになる）し、開発者を新しく
  # 1人増やすこともできない。
  if r==ROLE_DEVELOPER:return True
  return role_rank(r)>role_rank(target_role)
 if action=='choice:inline-add':
  # 測定画面からの間接登録（§9.322、利用者の指示）。**設備作業者にも許す**
  # ——マスタ管理は閉じるが、測定の途中で候補に無い値を打てる設定
  # （手打ち可）が入っている欄はその場で通す。
  return True
 return False

def role_capabilities(role,):
 """画面へ渡す「できること」。**判定を画面へ写さないための窓口**。"""
 r=normalize_role(role)
 return {'role':r,
         'canView':role_can(r,'presence:view'),
         'canDisconnect':role_can(r,'presence:disconnect'),
         'canDisconnectDeveloper':role_can(r,'presence:disconnect',ROLE_DEVELOPER),
         'canForget':role_can(r,'presence:forget')}
# ------------------------------------------------------------------------
# マスタ編集の段を「どの書き込みに掛けるか」（§9.322）
#
# **段が掛かるのはマスタ管理の画面が書くものだけ。** 一覧・作業スケジュール・
# 測定の各画面が書く「見せ方」（列の並び・絞り込み・並べ替え・表示ルール）は
# マスタ管理の外にあり、CLAUDE.mdでも「一覧画面から編集する」と決めてある
# ——ここを塞ぐと、閲覧のみの端末で列幅ひとつ直せなくなる。
#
# 網の張り方は**Blueprintごと（＝書き漏らしは安全側）＋名指しの例外**。
# 逆（守る側を名指し）にすると、マスタを1つ足したときに**黙って穴が空く**。
# 例外を書き漏らしたときは画面が目に見えて断られるので、直せる。
# ------------------------------------------------------------------------
MASTER_WRITE_BLUEPRINTS=('masters','path_config','master_tables','cleanup','rne')
# 管理のマスタ（`部分的編集可`では書けない）。Blueprint単位で管理のものと、
# `masters`の中の名指しの2つ。
_ADMIN_WRITE_BLUEPRINTS=('path_config','master_tables','cleanup','rne')
_ADMIN_WRITE_ENDPOINTS=('masters.access_permission_master_register',
                        'masters.access_permission_master_update',
                        'masters.access_permission_master_delete',
                        'masters.query_join_master_register',
                        'masters.query_join_master_update',
                        'masters.query_join_master_delete',
                        'masters.query_join_master_builtin')
# 「見せ方」の保存。段は掛からない（上のコメント）。
MASTER_EDIT_EXEMPT_ENDPOINTS=(
 'masters.column_layout_master_save','masters.column_layout_master_scope',
 'masters.column_preset_master_save','masters.column_preset_master_update',
 'masters.column_preset_master_delete',
 'masters.display_rule_master_save','masters.display_rule_master_delete',
 'masters.list_view_master_save',
 'masters.sort_preset_register','masters.sort_preset_use','masters.sort_preset_delete',
 'masters.filter_preset_register','masters.filter_preset_use','masters.filter_preset_delete',
 'masters.filter_preset_marks','masters.filter_preset_owner','masters.filter_preset_combo',
 'masters.schedule_column_master_save','masters.schedule_content_master_save')
# 測定画面からの間接登録（§9.322、利用者の指示「測定作業時、汎用カスタム部分の
# 選択肢でリストにないものを登録できるモード設定があった場合に測定画面から
# 入力してマスタに間接的に登録する形のマスタ登録は許可する」）。
# **段（非表示・閲覧のみ）を素通りするのはここだけ**で、通してよいかは
# `role_can(...,'choice:inline-add')`が答える。
MASTER_EDIT_INLINE_ENDPOINTS=('masters.operation_choice_register',)

def master_write_scope(blueprint,endpoint):
 """その書き込みは管理のマスタか現場のマスタか。"""
 if endpoint in _ADMIN_WRITE_ENDPOINTS:return 'admin'
 return 'admin' if blueprint in _ADMIN_WRITE_BLUEPRINTS else 'field'

def master_write_check(role,level,blueprint,endpoint):
 """マスタへの書き込みを通してよいか。`(ok, reason)`を返す。

 **ここ1箇所が答える**（§9.163）——`access_mode`の書込ガードはこれを呼ぶだけ。"""
 if blueprint not in MASTER_WRITE_BLUEPRINTS:return True,''
 if endpoint in MASTER_EDIT_EXEMPT_ENDPOINTS:return True,''
 if endpoint in MASTER_EDIT_INLINE_ENDPOINTS:
  if role_can(role,'choice:inline-add'):return True,''
 lv=master_edit_effective(role,level)
 scope=master_write_scope(blueprint,endpoint)
 if master_edit_can(lv,'write',scope):return True,''
 if lv==MASTER_EDIT_PARTIAL:
  return False,('この端末のマスタ編集は「部分的編集可」です。'
                '権限・置き場・接続などの管理のマスタは変更できません。')
 return False,(f'この端末のマスタ編集は「{lv}」です（権限区分: {normalize_role(role)}）。'
               'マスタは変更できません。変更が要る場合は、'
               'アクセス権限マスタで「マスタ編集」を上げてもらってください。')

def ensure_access_permission_table(c):
 names=tables(c);created=False
 if ACCESS_PERMISSION_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [アクセス権限マスタ] ([権限ID] INTEGER PRIMARY KEY AUTOINCREMENT, [ログインID] TEXT, [PC名] TEXT, [編集可否] INTEGER, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_アクセス権限マスタ] ON [アクセス権限マスタ] ([ログインID],[PC名])')
  c.commit();created=True
 ensure_audit_columns(c,ACCESS_PERMISSION_TABLE)
 add_missing_columns(c,ACCESS_PERMISSION_TABLE,
                     _SCHEDULE_PERMISSION_COLUMNS+_ROLE_COLUMNS+_COLUMN_EDIT_COLUMNS)
 return created

def normalize_identity_part(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_access_permission_master(path):
 # 書き込み接続でテーブルの存在を保証する。access_mode.pyの起動時判定の前処理に使う。
 with connect(path,False) as c:
  created=ensure_access_permission_table(c)
 return created

def access_permission_master_rows(c):
 ensure_access_permission_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。スケジュール関連3列は既存の呼び出し元
 # (masters.pyのCRUD一覧等)のインデックス([0]〜[7])を壊さないよう末尾へ追加する。
 cur.execute('SELECT [権限ID],[ログインID],[PC名],[編集可否],[表示順],[有効],[更新日時],[更新者ID],[スケジュール可否],[現場段取り可否],[現場段取り対象設備],[権限区分],[マスタ編集],[表示列編集] FROM [アクセス権限マスタ] ORDER BY [表示順],[ログインID],[PC名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[5] is None else bool(r[5])
  if active:rows.append(r)
 return rows

def has_edit_permission(c,login_id,pc_name):
 return permission_flags(c,login_id,pc_name)['canEdit']

_DEFAULT_PERMISSION_FLAGS={'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':'',
 'role':ROLE_DEFAULT,
 # マスタ編集の既定は**編集可**（§9.322/§9.132）——登録の無い端末の
 # マスタ管理を黙って取り上げない。区分の既定（一般ユーザー）の上限が
 # 編集可なので、キャップを掛けても値は変わらない。
 'masterEdit':MASTER_EDIT_DEFAULT,'masterEditStored':MASTER_EDIT_DEFAULT,
 # 表示列の編集の既定も**編集可**（§9.512/§9.132）。
 'columnEdit':COLUMN_EDIT_DEFAULT,
 # どの行が効いているか（§9.322）。**自分の区分を決めている行**は
 # 自分では触れない、を判定するのに要る。登録が無ければNone。
 'matchedId':None}

# 現場段取りの対象設備。1設備だけでなく、複数設備とワイルドカードも書ける。
#   ''          … 未設定（権限なし。空欄は「全設備許可」ではない）
#   '*'         … すべての設備（開発・保守用の全設備権限）
#   'A,B,C'     … 列挙した設備だけ
# 保存はTEXT1列のまま。列を増やすと既存行の移行が要るうえ、判定する場所
# (サーバー2箇所・画面2箇所)を全部直さないと食い違うため、文字列の書式で
# 表現して**判定はこの関数1つに集約**する。
FIELD_REORDER_ALL='*'
def field_reorder_equipment_list(stored):
 """保存文字列を設備名のリストへ。'*'は ['*'] を返す。"""
 s=str(stored or '').strip()
 if not s:return []
 if s==FIELD_REORDER_ALL:return [FIELD_REORDER_ALL]
 return [p.strip() for p in s.replace('、',',').split(',') if p.strip()]

def field_reorder_equipment_allows(stored,equipment):
 """この保存内容で、指定の設備の並べ替えを許してよいか。"""
 items=field_reorder_equipment_list(stored)
 if not items:return False
 if items[0]==FIELD_REORDER_ALL:return True
 target=normalize_equipment_name(equipment)
 if not target:return False
 return any(normalize_equipment_name(x)==target for x in items)

def permission_flags(c,login_id,pc_name):
 # ログインID・PC名は汎用的に使えるよう、どちらか一方だけの登録
 # (もう一方は空欄)も許す(register/update側もどちらか一方の入力のみで
 # 登録できる)。一致度の高い順に判定する: 両方一致 > ログインIDのみ登録の
 # 行がログインID一致(PC名は問わない) > PC名のみ登録の行がPC名一致
 # (ログインIDは問わない) > 両方空欄で登録された行(全端末共通の既定上書き)。
 # 該当行が無ければ編集可否は「可」を既定とする(既存の互換ポリシー、上記
 # コメント参照)。スケジュール可否・現場段取り可否は未登録/未設定なら
 # 「不可」を既定とする(触れる範囲が広がる側の既定は安全側に倒す。
 # docs/SCHEDULE_MODE_DESIGN.md §3.2)。
 if ACCESS_PERMISSION_TABLE not in tables(c):
  return dict(_DEFAULT_PERMISSION_FLAGS)
 target_login=normalize_identity_part(login_id);target_pc=normalize_identity_part(pc_name)
 def flags_of(r):
  role=normalize_role(r[11] if len(r)>11 else '')
  stored=normalize_master_edit(r[12] if len(r)>12 else '')
  return {'canEdit':bool(r[3]),'canSchedule':bool(r[8]),'canFieldReorder':bool(r[9]),'fieldReorderEquipment':str(r[10] or '').strip(),
          'role':role,
          # **保存値ではなく効いている段を配る**（§9.322）——区分を下げたのに
          # 前の段が効き続ける、を作らない。保存値も別に持って画面に出す。
          'masterEdit':master_edit_effective(role,stored),'masterEditStored':stored,
          'columnEdit':normalize_column_edit(r[13] if len(r)>13 else ''),
          'matchedId':r[0]}
 exact=login_only=pc_only=global_rule=None
 for r in access_permission_master_rows(c):
  rl,rp=normalize_identity_part(r[1]),normalize_identity_part(r[2])
  if rl and rp:
   if rl==target_login and rp==target_pc:exact=r
  elif rl:
   if rl==target_login:login_only=r
  elif rp:
   if rp==target_pc:pc_only=r
  else:
   global_rule=r
 matched=exact or login_only or pc_only or global_rule
 return flags_of(matched) if matched else dict(_DEFAULT_PERMISSION_FLAGS)

# ------------------------------------------------------------------------
# 権限区分・マスタ編集を「書き換えてよいか」（§9.322、利用者の指示
# 「権限区分に関しての変更はより上位権限を持つ人からの変更しか受け付けない
#  ようにして、自分自身で自分の権限区分を触れないようにしてください」）
#
# **判定はこの1箇所**（§9.163）——登録・更新・削除の3つのルートが同じここを
# 通る。散らすと「登録では通るのに更新では断られる」が作れる。
#
# 3つの門を順に見る:
#   ① 自分の区分を決めている行か     … 自分では触れない（自己昇格を塞ぐ唯一の門）
#   ② まだ管理者が1人も居ないか      … 居なければ通す（最初の1人を作る道。
#                                      これが無いと、既定の一般ユーザーしか
#                                      居ない新しい現場で開発者を作れない）
#   ③ 相手の区分・与える区分より上位か … `role_can(...,'role:grant',...)`
# ------------------------------------------------------------------------
def has_admin_role_row(c):
 """一般ユーザーより上位の区分を持つ有効な行が1つでもあるか。"""
 if ACCESS_PERMISSION_TABLE not in tables(c):return False
 top=role_rank(ROLE_USER)
 for r in access_permission_master_rows(c):
  if role_rank(r[11] if len(r)>11 else '')>top:return True
 return False

def identity_covers(row_login,row_pc,login_id,pc_name):
 """この行は、その人・その端末に当たるか（空欄＝問わない）。

 `permission_flags`の一致度判定と同じ読み方。**新しく作る行**には権限IDが
 まだ無く「効いている行か」で見分けられないので、こちらで見る。"""
 rl=normalize_identity_part(row_login);rp=normalize_identity_part(row_pc)
 tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
 return (not rl or rl==tl) and (not rp or rp==tp)

def role_change_check(c,actor_login,actor_pc,old_role,new_role,
                      row_id=None,row_login='',row_pc=''):
 """区分を`old_role`から`new_role`へ変えてよいか。`(ok, reason)`を返す。

 `row_id`が無い（新規登録）ときは、その行が自分に当たるかで自己判定する。
 **変わらないなら何も要らない**——区分に触っていない更新（名前や編集可否
 だけを直す、既定のまま新しい端末を登録する）を巻き添えにしない。"""
 old=normalize_role(old_role);new=normalize_role(new_role)
 if old==new:return True,''
 me=permission_flags(c,actor_login,actor_pc)
 mine=(row_id is not None and me.get('matchedId') is not None
       and str(row_id)==str(me['matchedId'])) \
      or (row_id is None and identity_covers(row_login,row_pc,actor_login,actor_pc))
 if mine:
  return False,('自分の権限区分は自分では変更できません'
                f'（いまの区分: {me["role"]}）。上位の区分を持つ人に変更してもらってください。')
 if not has_admin_role_row(c):
  # まだ誰も管理者が居ない＝最初の1人を作る場面。ここを塞ぐと、既定
  # （一般ユーザー）しか居ない現場で開発者を1つも作れない。
  return True,''
 actor=me['role']
 if not role_can(actor,'role:grant',old):
  return False,(f'この端末の権限区分（{actor}）では、{old}の登録の区分を変更できません。'
                'より上位の区分を持つ人に依頼してください。')
 if not role_can(actor,'role:grant',new):
  return False,(f'この端末の権限区分（{actor}）では、{new}を与えられません。'
                '自分より上位（同格を含む）の区分は付与できません。')
 return True,''

def master_edit_check(role,level):
 """その区分にその段を与えてよいか。`(ok, reason)`を返す（§9.322、利用者の
 指示「権限区分以上の権限は付与できないようにしてください」）。"""
 r=normalize_role(role);lv=normalize_master_edit(level)
 cap=master_edit_cap(r)
 if master_edit_rank(lv)<=master_edit_rank(cap):return True,''
 return False,(f'権限区分「{r}」に「{lv}」は与えられません（上限は「{cap}」）。'
               '先に権限区分を上げるか、マスタ編集を上限までにしてください。')

def field_reorder_terminal_count(c,equipment):
 # docs/SCHEDULE_MODE_DESIGN.md §5.0.1: 設備削除確認で使う。現場段取り
 # 対象設備としてこの設備名を登録している端末数(現場段取り可否が真の
 # 行のみを数える)。
 if ACCESS_PERMISSION_TABLE not in tables(c):return 0
 target=normalize_equipment_name(equipment)
 return sum(1 for r in access_permission_master_rows(c) if bool(r[9]) and normalize_equipment_name(str(r[10] or '').strip())==target)

# ========================================================================
# スケジュール列表示マスタ（§9.18新設）
#  - 設備単位(対象=設備名)で、スケジュール画面の分割/ポップアップ表示
#    (list-view.js renderGrid)にだけ効くアローリスト。行が1件も無い設備=
#    未設定=全列表示（他マスタと同じ「行が無ければ既定」の互換ポリシー）。
#  - **DB単位で列を落とす「表示マスタ」は廃止した**(§9.165)。同じことを
#    列レイアウトマスタが対象ごとにもっと細かく持つようになり、しかも
#    サーバーが落とすと画面側で選び直せない(候補に出ない)ためで、
#    残っている物理テーブルは「テーブル生データ」から中身だけ見られる。
# ========================================================================
SCHEDULE_COLUMN_TABLE='スケジュール列表示マスタ'
def ensure_schedule_column_table(c):
 names=tables(c);created=False
 if SCHEDULE_COLUMN_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [スケジュール列表示マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [列名] TEXT, [表示順] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_スケジュール列表示マスタ_設備] ON [スケジュール列表示マスタ] ([設備名])')
  c.commit();created=True
 ensure_audit_columns(c,SCHEDULE_COLUMN_TABLE)
 return created

def schedule_columns_for(c,equipment):
 # 指定設備で選択済みの列名一覧(表示順)。1件も無ければ空リスト
 # (=未設定、呼び出し側で「全列表示」と解釈する)。
 if SCHEDULE_COLUMN_TABLE not in tables(c):return []
 cur=c.cursor()
 cur.execute('SELECT [設備名],[列名] FROM [スケジュール列表示マスタ] ORDER BY [表示順],[ID]')
 target=normalize_equipment_name(equipment)
 return [str(r[1]) for r in cur.fetchall() if target and normalize_equipment_name(r[0])==target]

def set_schedule_columns(c,equipment,column_names,uid):
 # 指定設備の選択列を column_names の内容へ完全同期する(既存行を全削除して
 # 作り直す、稼働カレンダーマスタcalendar_syncと同じ全置換方式)。空リストを
 # 渡すと「未設定(全列表示)」へ戻る。
 ensure_schedule_column_table(c)
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 cur=c.cursor()
 cur.execute('SELECT [ID],[設備名] FROM [スケジュール列表示マスタ]')
 target=normalize_equipment_name(equipment)
 existing_ids=[r[0] for r in cur.fetchall() if normalize_equipment_name(r[1])==target]
 for rid in existing_ids:
  cur.execute('DELETE FROM [スケジュール列表示マスタ] WHERE [ID]=?',[rid])
 order=0
 for name in (column_names or []):
  name=str(name or '').strip()
  if not name:continue
  order+=1
  cur.execute('INSERT INTO [スケジュール列表示マスタ] ([設備名],[列名],[表示順],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,Now(),Now())',
              [equipment,name,order,uid,uid])
 c.commit()
 return order

# ------------------------------------------------------------------------
# スケジュール内容表示マスタ(設備ごと)
# ------------------------------------------------------------------------
# 作業スケジュールのタイムライン各行「内容」欄に、どの項目をどの順で並べるか。
# 上のスケジュール列表示マスタ(仕掛一覧に出す"列"の絞り込み)とは目的が違う:
#   スケジュール列表示マスタ … 一覧の横方向に何を見せるか。選ぶ数は多い。
#   内容表示マスタ … 1行の要約文を何で組み立てるか。選ぶ数は少ない(2〜4項目)。
# 以前は1つのマスタで両方を兼ねていたため、「一覧は10列見たいが内容欄は
# ロット番号と材質だけにしたい」が表現できず、どちらも中途半端になっていた
# (実際に「うまく実装されていない」と報告された)。並び順もそのまま
# 表示順として使うため、利用者が選んだ順に意味がある。
SCHEDULE_CONTENT_TABLE='スケジュール内容表示マスタ'
def ensure_schedule_content_table(c):
 names=tables(c);created=False
 if SCHEDULE_CONTENT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [スケジュール内容表示マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [項目名] TEXT, [表示順] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_スケジュール内容表示マスタ_設備] ON [スケジュール内容表示マスタ] ([設備名])')
  c.commit();created=True
 ensure_audit_columns(c,SCHEDULE_CONTENT_TABLE)
 return created

def schedule_content_items_for(c,equipment):
 # 指定設備の「内容」欄の項目(表示順)。1件も無ければ空リスト
 # (=未設定、呼び出し側で既定の組み立てへフォールバックする)。
 if SCHEDULE_CONTENT_TABLE not in tables(c):return []
 cur=c.cursor()
 cur.execute('SELECT [設備名],[項目名] FROM [スケジュール内容表示マスタ] ORDER BY [表示順],[ID]')
 target=normalize_equipment_name(equipment)
 return [str(r[1]) for r in cur.fetchall() if target and normalize_equipment_name(r[0])==target]

def set_schedule_content_items(c,equipment,item_names,uid):
 # set_schedule_columnsと同じ全置換方式。渡された順序がそのまま表示順になる。
 ensure_schedule_content_table(c)
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 cur=c.cursor()
 cur.execute('SELECT [ID],[設備名] FROM [スケジュール内容表示マスタ]')
 target=normalize_equipment_name(equipment)
 for rid in [r[0] for r in cur.fetchall() if normalize_equipment_name(r[1])==target]:
  cur.execute('DELETE FROM [スケジュール内容表示マスタ] WHERE [ID]=?',[rid])
 order=0
 for name in (item_names or []):
  name=str(name or '').strip()
  if not name:continue
  order+=1
  cur.execute('INSERT INTO [スケジュール内容表示マスタ] ([設備名],[項目名],[表示順],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,Now(),Now())',
              [equipment,name,order,uid,uid])
 c.commit()
 return order


# ========================================================================
# 列レイアウトマスタ（§9.88新設）
#  - 一覧・タイムラインの「列の並び順」と「列幅」を覚える。
#  - 既存の3つの列関連マスタとは**軸が違う**ので別テーブルにする:
#      スケジュール列表示マスタ … 設備単位・どの列を出すか(アローリスト)
#      スケジュール内容表示マスタ … 設備単位・「内容」に出す項目と順序
#    こちらは**どの画面でも使える「並びと幅」**だけを持つ。列を出すか
#    どうかは上の3つが決める(責務を混ぜない)。
#  - [対象]は画面ごとのスコープ文字列。呼び出し側が組み立てる:
#      list:<DBキー>:<テーブル名>   一覧グリッド(モードによらず共有)
#      timeline:<設備名>            作業スケジュールのタイムライン
#  - 行が1件も無い対象＝未設定＝既定の並び・既定の幅(他マスタと同じ互換
#    ポリシー)。**幅だけ・並びだけ**の保存もできるよう、幅はNULL可。
# ========================================================================
COLUMN_LAYOUT_TABLE='列レイアウトマスタ'

# ---- 書式(§9.88 段3) ----------------------------------------------------
# 値を「どう整形して見せるか」。**保存するのは指定だけ**で、整形そのものは
# 画面側が行う(サーバーは生の値を返す。並べ替えや絞り込みは生の値で効く
# ままにしたいので、整形をサーバーへ持ち込まない)。
FORMAT_KINDS=('','number','datetime','text')

def normalize_format(raw):
 """保存できる書式指定へ整える。何も指定が無ければNone(=そのまま表示)。"""
 if not isinstance(raw,dict):return None
 kind=str(raw.get('kind') or '').strip()
 if kind not in FORMAT_KINDS:kind=''
 pattern=str(raw.get('pattern') or '').strip()[:60]
 try:decimals=int(raw.get('decimals')) if raw.get('decimals') not in (None,'') else None
 except (TypeError,ValueError):decimals=None
 if decimals is not None:decimals=max(0,min(6,decimals))
 thousands=bool(raw.get('thousands'))
 prefix=str(raw.get('prefix') or '')[:8]
 suffix=str(raw.get('suffix') or '')[:8]
 if not kind and not pattern and decimals is None and not thousands and not prefix and not suffix:
  return None
 return {'kind':kind,'pattern':pattern,'decimals':decimals,
         'thousands':thousands,'prefix':prefix,'suffix':suffix}


# ---- 揃え(§9.239 ④、利用者の指示) ------------------------------------
# 「数値は右詰め、文字列は左詰めなど自動で書式に合わせた設定になりますが、
#  手動での任意変更もできるようにしてください。また、カラムの文字列は
#  データとは別で中央位置をデフォルトにして、データの位置に追従するか、
#  別で設定するか選べるようにしてください」。
#
# **2つの値を別々に持つ**——値の揃えと見出しの揃えは「別のもの」だと
# 利用者が明示している。1つにまとめると「見出しだけ中央」が表現できない。
#  値  : ''=自動(書式が数値なら右・それ以外は左) / left / center / right
#  見出し: ''=既定(中央) / follow(値に追従) / left / center / right
# **既定を空文字で表す**のは他の設定と同じ約束（列を足しても既存行が
# 勝手に変わらない）。解決そのものは画面が持つ——サーバーは生の値を返し、
# 整形も揃えも画面側だけで行う（並べ替え・絞り込みを生の値で効かせたまま
# にするため。§9.88 段3と同じ理由）。
VALUE_ALIGNS=('','left','center','right')
HEAD_ALIGNS=('','follow','left','center','right')

def normalize_align(value,head=False):
 """保存できる揃えへ整える。知らない値は''(=既定)へ倒す。"""
 v=str(value or '').strip().lower()
 return v if v in (HEAD_ALIGNS if head else VALUE_ALIGNS) else ''


def ensure_column_layout_table(c):
 names=tables(c);created=False
 if COLUMN_LAYOUT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [列レイアウトマスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[対象] TEXT, [列名] TEXT, [表示名] TEXT, [表示順] INTEGER, [幅] INTEGER, [表示] INTEGER, '
              '[書式種別] TEXT, [書式パターン] TEXT, [小数桁] INTEGER, [桁区切り] INTEGER, '
              '[単位前] TEXT, [単位後] TEXT, [読み替えルール] TEXT, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_列レイアウトマスタ] ON [列レイアウトマスタ] ([対象],[列名])')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_LAYOUT_TABLE)
 # 既存DBへの追加(他マスタと同じ「無ければ足す」方式)。
 # 計算式(§9.111 ⑦): データ側に無い列を、既にある列から作る。**列の1行**
 # として持つので、並び・幅・書式・読み替えはそのまま効く。
 # 幅固定(§9.119): 幅を「自動(内容に合わせる)/手で決めた幅/固定」の3つで持つ。
 # 自動と手動は[幅]の有無で分かるが、**固定はもう1つの状態**なので列を足す
 # (幅を持ったまま「もう動かさない」と言えるようにするため)。
 # 並べ替え(§9.187): 種類が混ざったときの塊の順・数字混じりの読み順・
 # 生の値/変換後のどちらで並べるか。**1列ぶんをJSONで持つ**——中身は
 # 3つで、増えるたびに列を足すと移行が要る（表示だけの設定なので、
 # SQLで絞り込む相手にはならない）。
 add_missing_columns(c,COLUMN_LAYOUT_TABLE,
                    (('表示','INTEGER'),('表示名','TEXT'),
                     ('書式種別','TEXT'),('書式パターン','TEXT'),('小数桁','INTEGER'),
                     ('桁区切り','INTEGER'),('単位前','TEXT'),('単位後','TEXT'),
                     ('読み替えルール','TEXT'),('計算式','TEXT'),('幅固定','INTEGER'),
                     ('並べ替え','TEXT'),
                   # 揃え(§9.239 ④)。**2列に分ける**——値と見出しは別の設定で、
                   # 「見出しだけ中央」「見出しは値に追従」を1つの値では書けない。
                     ('値揃え','TEXT'),('見出し揃え','TEXT'),
                     # 所有者(§9.259): **空欄＝みんなのもの**。既存の行はそのまま
                   # 共通の設定として効き続ける（フィルタの[所有者ID]・§9.172と
                   # 同じ約束）。**NULLにしないこと**——SQLiteの一意索引は
                   # NULL同士を「違う」と見るので、同じ列の行を何本でも作れて
                   # しまう。NOT NULL DEFAULT '' で必ず値を持たせる。
                     ('所有者ID',"TEXT NOT NULL DEFAULT ''")))
 # 鍵は(対象,列名)から(対象,列名,所有者ID)へ張り直す。所有者を足した以上、
 # 古い鍵のままでは**同じ列の個人設定を1つも作れない**。
 cur=c.cursor()
 idx={r[1] for r in cur.execute(f'PRAGMA index_list([{COLUMN_LAYOUT_TABLE}])')}
 if 'UX_列レイアウトマスタ_所有者' not in idx:
  cur.execute(f"UPDATE [{COLUMN_LAYOUT_TABLE}] SET [所有者ID]='' WHERE [所有者ID] IS NULL")
  if 'UX_列レイアウトマスタ' in idx:cur.execute('DROP INDEX [UX_列レイアウトマスタ]')
  cur.execute('CREATE UNIQUE INDEX [UX_列レイアウトマスタ_所有者] ON '
              '[列レイアウトマスタ] ([対象],[列名],[所有者ID])')
  c.commit()
 return created


# ---- 列の見せ方を「共通／個人」で選ぶ(§9.259、利用者の指示) --------------
# 「列の表示の部分については、こだわりが強い人もいるので、表示する一覧表毎に
#  共通のものを使うか、個別ID単位のものを使うか選べるようにしたい」
#
# **行が有る＝その人はその一覧で個人の設定を使う。無ければ共通**（フィルタの
# 個人設定マスタ・§9.172と同じ「行が無い＝印なし」の約束）。選ぶのは
# **一覧ごと・人ごと**——こだわりのある人だけが自分の並びを持ち、他の人の
# 見え方は1ピクセルも変わらない、というのがこの指示の趣旨。
COLUMN_LAYOUT_SCOPE_TABLE='列レイアウト個人設定マスタ'

def ensure_column_layout_scope_table(c):
 names=tables(c);created=False
 if COLUMN_LAYOUT_SCOPE_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [列レイアウト個人設定マスタ] ([設定ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[利用者ID] TEXT, [対象] TEXT, [有効] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_列レイアウト個人設定マスタ] ON '
              '[列レイアウト個人設定マスタ] ([利用者ID],[対象])')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_LAYOUT_SCOPE_TABLE)
 return created

def column_layout_is_personal(c,target,user_id):
 """その人がその一覧で個人の設定を使っているか。

 **利用者IDが空なら必ず共通**——空を1つの入れ物として扱うと、IDを名乗れない
 端末どうしが同じ「個人設定」を共有してしまい、共通と区別が付かなくなる
 （フィルタの§9.172は空を受け皿にしてよいが、あれは印であってレイアウト
 そのものではない）。"""
 uid=str(user_id or '').strip();target=str(target or '').strip()
 if not uid or not target:return False
 if COLUMN_LAYOUT_SCOPE_TABLE not in tables(c):return False
 cur=c.cursor()
 cur.execute('SELECT [有効] FROM [列レイアウト個人設定マスタ] WHERE [利用者ID]=? AND [対象]=?',[uid,target])
 row=cur.fetchone()
 return bool(row) and bool(row[0])

def column_layout_owner(c,target,user_id):
 """その読み書きが**どの所有者の行**に当たるかを答える1箇所。

 戻り値は所有者ID（''＝みんなのもの）。読む側・書く側・切り替える側が
 すべてここを通ることで、「画面には個人の並びが出ているのに保存は共通へ
 行く」が構造として作れない。"""
 return str(user_id or '').strip() if column_layout_is_personal(c,target,user_id) else ''

def column_layout_scope_set(c,target,user_id,personal,updated_by=''):
 """共通⇄個人を切り替える。戻り値は切り替えた後が個人かどうか。

 **個人にするときは、いま見えている共通の設定を写してから切り替える**
 ——白紙から始めると、こだわって作った並びが押した瞬間に消えたように見える。
 **共通へ戻すときは個人の行を消さない**（また個人へ戻せば続きから使える）。
 消したいときは列の設定パネルの「まっさらに戻す」を使う。"""
 uid=str(user_id or '').strip();target=str(target or '').strip()
 if not uid or not target:return False
 ensure_column_layout_scope_table(c)
 cur=c.cursor()
 if personal:
  # 個人の行がまだ1つも無ければ、共通をそのまま写す。
  ensure_column_layout_table(c)
  cur.execute('SELECT COUNT(*) FROM [列レイアウトマスタ] WHERE [対象]=? AND [所有者ID]=?',[target,uid])
  if not int((cur.fetchone() or [0])[0] or 0):
   have=[r[1] for r in cur.execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')]
   copy=[n for n in have if n not in ('ID','所有者ID','登録者ID','更新者ID','登録日時','更新日時')]
   if copy:
    cols=','.join('['+n+']' for n in copy)
    cur.execute(f'INSERT INTO [列レイアウトマスタ] ({cols},[所有者ID],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                f'SELECT {cols},?,?,?,Now(),Now() FROM [列レイアウトマスタ] '
                'WHERE [対象]=? AND [所有者ID]=?',
                [uid,str(updated_by or uid)[:50],str(updated_by or uid)[:50],target,''])
 cur.execute('SELECT [設定ID] FROM [列レイアウト個人設定マスタ] WHERE [利用者ID]=? AND [対象]=?',[uid,target])
 row=cur.fetchone()
 if row:
  cur.execute('UPDATE [列レイアウト個人設定マスタ] SET [有効]=?,[更新者ID]=?,[更新日時]=Now() WHERE [設定ID]=?',
              [-1 if personal else 0,str(updated_by or uid)[:50],row[0]])
 else:
  cur.execute('INSERT INTO [列レイアウト個人設定マスタ] ([利用者ID],[対象],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
              'VALUES (?,?,?,?,?,Now(),Now())',
              [uid,target,-1 if personal else 0,str(updated_by or uid)[:50],str(updated_by or uid)[:50]])
 c.commit()
 return bool(personal)

def column_layout_personal_targets(c,user_id):
 """その人が個人の設定を使っている一覧の一覧。画面が「いくつ持っているか」を
 文字で出すために使う（黙って個人設定にしない・§3）。"""
 uid=str(user_id or '').strip()
 if not uid or COLUMN_LAYOUT_SCOPE_TABLE not in tables(c):return []
 cur=c.cursor()
 cur.execute('SELECT [対象] FROM [列レイアウト個人設定マスタ] WHERE [利用者ID]=? AND [有効]<>0 ORDER BY [対象]',[uid])
 return [str(r[0] or '').strip() for r in cur.fetchall() if str(r[0] or '').strip()]

# 幅の下限・上限。狭すぎると掴めなくなり、広すぎると他の列が押し出される。
COLUMN_WIDTH_MIN=40
COLUMN_WIDTH_MAX=900

def normalize_column_width(value):
 """保存できる幅へ丸める。数値でなければNone(=既定の幅)。"""
 if value in (None,''):return None
 try:w=int(float(value))
 except (TypeError,ValueError):return None
 return max(COLUMN_WIDTH_MIN,min(COLUMN_WIDTH_MAX,w))

def column_layout_for(c,target,owner=''):
 """{'order':[列名...], 'widths':{列名:幅}, 'hidden':[列名...]}。未設定なら空。

 `owner`は所有者ID（''＝みんなのもの・§9.259）。**誰の行を読むかは
 呼ぶ側が`column_layout_owner()`で決めてから渡す**——ここで利用者IDから
 引き直すと、同じ問いに2通りの答えが生まれる。

 **hiddenは「この対象で隠す列」**。[表示]がNULLの行は表示(既定)として扱う
 ——列を足したときに既存の行が勝手に隠れないようにするため。"""
 empty={'order':[],'widths':{},'hidden':[],'names':{},'formats':{},'rules':{},'formulas':{},
        'locks':[],'sorts':{},'aligns':{}}
 if COLUMN_LAYOUT_TABLE not in tables(c):return dict(empty)
 target=str(target or '').strip()
 if not target:return dict(empty)
 have={r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 col=lambda n:('['+n+']') if n in have else 'NULL'
 cur=c.cursor()
 cur.execute('SELECT [列名],[表示順],[幅],'+col('表示')+','+col('表示名')+','
             +col('書式種別')+','+col('書式パターン')+','+col('小数桁')+','
             +col('桁区切り')+','+col('単位前')+','+col('単位後')+','
             +col('読み替えルール')+','+col('計算式')+','+col('幅固定')+','
             +col('並べ替え')+','+col('値揃え')+','+col('見出し揃え')+
             ' FROM [列レイアウトマスタ] WHERE [対象]=? AND '
             +('[所有者ID]=?' if '所有者ID' in have else '?=?')+
             ' ORDER BY [表示順],[ID]',
             [target,str(owner or '')] if '所有者ID' in have else [target,'',''])
 order=[];widths={};hidden=[];names={};formats={};rules={};formulas={};locks=[];sorts={};aligns={}
 for row in cur.fetchall():
  name=str(row[0] or '').strip()
  if not name:continue
  order.append(name)
  if row[2] not in (None,''):widths[name]=int(row[2])
  if row[3] is not None and not bool(row[3]):hidden.append(name)
  label=str(row[4] or '').strip()
  if label:names[name]=label
  f=normalize_format({'kind':row[5],'pattern':row[6],'decimals':row[7],
                      'thousands':row[8],'prefix':row[9],'suffix':row[10]})
  if f:formats[name]=f
  rule=str(row[11] or '').strip()
  if rule:rules[name]=rule
  # **空の式と「計算列ではない」を区別する**（§9.234 ⑥）。以前は空文字を
  # 落としていたため、式を空にして読み替えだけを付けた列が保存の往復で
  # `formulas`から消え、画面は「知らない列」として並びごと落としていた
  # （利用者の報告「他の列のみで構成されたルールを適用しても何も出ない」の
  # 半分がこれ）。NULL＝計算列ではない／''＝式が空の計算列。
  if row[12] is not None:formulas[name]=str(row[12]).strip()
  # 幅固定。**列が無い古いDBではNULL**なので、そのときは固定なしとして扱う。
  if len(row)>13 and row[13] is not None and bool(row[13]):locks.append(name)
  # 並べ替え。**壊れた値は「指定なし」**（設定1つで一覧が開けなくならない）。
  if len(row)>14:
   from .. import sort_order
   spec=sort_order.normalize_spec(row[14])
   if spec:sorts[name]=spec
  # 揃え(§9.239 ④)。**どちらも既定なら持たない**——空の辞書が並ぶと
  # 「触った列」と「触っていない列」が見分けられなくなる。
  if len(row)>16:
   va=normalize_align(row[15]);ha=normalize_align(row[16],True)
   if va or ha:aligns[name]={'data':va,'head':ha}
 return {'order':order,'widths':widths,'hidden':hidden,'names':names,
         'formats':formats,'rules':rules,'formulas':formulas,'locks':locks,
         'sorts':sorts,'aligns':aligns}

def column_layout_targets(c,owner=''):
 """保存されている対象(target)の一覧。**持ち出し・取り込み用**(§9.178)。

 既定は共通ぶんだけ——持ち出しは「みんなの設定」を配るためのものなので、
 誰かの個人設定が混ざると、受け取った側の全員にその人の好みが当たる。

 対象は画面が組み立てる文字列(list:<DB>:<表> / timeline:<設備> / print:<設備> /
 report:<設備> / records:list)で、サーバーは中身を解釈しない。並びは
 名前順——保存順は「最後に触った順」で、人が探すときの手掛かりにならない。"""
 if COLUMN_LAYOUT_TABLE not in tables(c):return []
 cur=c.cursor()
 have={r[1] for r in cur.execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 if '所有者ID' in have:
  cur.execute(f'SELECT DISTINCT [対象] FROM [{COLUMN_LAYOUT_TABLE}] WHERE [所有者ID]=? ORDER BY [対象]',
              [str(owner or '')])
 else:
  cur.execute(f'SELECT DISTINCT [対象] FROM [{COLUMN_LAYOUT_TABLE}] ORDER BY [対象]')
 return [str(r[0] or '').strip() for r in cur.fetchall() if str(r[0] or '').strip()]

def set_column_layout(c,target,order,widths,uid,hidden=None,names=None,formats=None,rules=None,
                      formulas=None,locks=None,sorts=None,aligns=None,fields=None,owner=''):
 """対象(target)の行をまとめて書き直す。渡された順序がそのまま表示順になる。

 **並び(order)は必ず全体を送ること。** 部分的な並べ替えは「どちらが正か」が
 決まらない(A→Bの移動とC→Dの移動が別々に走ると結果が定まらない)。

 **それ以外は「送った項目だけ書く」**(§9.212 ②、利用者の指示
 「修正した内容が戻されたりしないために」)。`fields`に名前が入っている
 項目だけを引数の値で置き換え、**入っていない項目は今の値をそのまま残す**。
 `fields=None`のときは今までどおり全部を引数の値にする(＝全置換)。

 以前は常に全置換で、**渡し忘れた設定が黙って消えていた**——実際に
 計算式で作った列が全部消える(§9.113)・列ごとの並べ替えが消える(§9.211 ①)・
 幅固定が解ける(§9.119)の3回起きている。呼ぶ側が十数箇所に散っている以上、
 「全部渡す」を各所で守らせるのは無理筋なので、**入口で安全側に倒す**。
 パス設定マスタが§9.192で同じ理由で同じ形にしてある。"""
 ensure_column_layout_table(c)
 target=str(target or '').strip()
 if not target:raise ValueError('対象を指定してください。')
 if fields is not None:
  # **残す値は同じ所有者の行から取る**——共通から取ると、個人設定を
  # 1項目だけ触った瞬間に残りが共通の値で塗り替わる。
  keep=column_layout_for(c,target,str(owner or ''))
  own=set(fields)
  if 'order'    not in own:order=keep['order']
  if 'widths'   not in own:widths=keep['widths']
  if 'hidden'   not in own:hidden=keep['hidden']
  if 'names'    not in own:names=keep['names']
  if 'formats'  not in own:formats=keep['formats']
  if 'rules'    not in own:rules=keep['rules']
  if 'formulas' not in own:formulas=keep['formulas']
  if 'locks'    not in own:locks=keep['locks']
  if 'sorts'    not in own:sorts=keep['sorts']
  if 'aligns'   not in own:aligns=keep['aligns']
 widths=widths if isinstance(widths,dict) else {}
 hide={str(x or '').strip() for x in (hidden or []) if str(x or '').strip()}
 label=names if isinstance(names,dict) else {}
 fmt=formats if isinstance(formats,dict) else {}
 rule=rules if isinstance(rules,dict) else {}
 formula=formulas if isinstance(formulas,dict) else {}
 lock={str(x or '').strip() for x in (locks or []) if str(x or '').strip()}
 from .. import sort_order
 sortspec={}
 for k,v in (sorts if isinstance(sorts,dict) else {}).items():
  txt=sort_order.spec_json(v)
  if txt:sortspec[str(k or '').strip()]=txt
 # 揃え(§9.239 ④)。**どちらも既定の行は持たない**（下の`extra`で
 # 「設定がある列」を数えるので、空の指定を残すと並びに載っていない列が
 # 理由なく生き残る）。
 align={}
 for k,v in (aligns if isinstance(aligns,dict) else {}).items():
  if not isinstance(v,dict):continue
  va=normalize_align(v.get('data'));ha=normalize_align(v.get('head'),True)
  if va or ha:align[str(k or '').strip()]={'data':va,'head':ha}
 cur=c.cursor()
 # 所有者の行だけを書き直す(§9.259)。**所有者を絞り忘れると、個人の設定を
 # 保存した瞬間に共通の設定が消える**（あるいはその逆）。
 owner=str(owner or '')
 cur.execute('DELETE FROM [列レイアウトマスタ] WHERE [対象]=? AND [所有者ID]=?',[target,owner])

 def write(name,seq):
  f=normalize_format(fmt.get(name)) or {}
  a=align.get(name) or {}
  cur.execute('INSERT INTO [列レイアウトマスタ] ([対象],[列名],[表示名],[表示順],[幅],[表示],'
              '[書式種別],[書式パターン],[小数桁],[桁区切り],[単位前],[単位後],'
              '[読み替えルール],[計算式],[幅固定],[並べ替え],[値揃え],[見出し揃え],'
              '[所有者ID],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
              'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
              [target,name,str(label.get(name) or '').strip() or None,seq,
               normalize_column_width(widths.get(name)),
               0 if name in hide else -1,
               f.get('kind') or None,f.get('pattern') or None,
               f.get('decimals'),(-1 if f.get('thousands') else 0) if f else None,
               f.get('prefix') or None,f.get('suffix') or None,
               str(rule.get(name) or '').strip() or None,
               # 空文字はそのまま空文字で書く（NULLにすると計算列でなくなる）。
               (str(formula.get(name) or '').strip() if name in formula else None),
               -1 if name in lock else 0,
               sortspec.get(name) or None,
               a.get('data') or None,a.get('head') or None,owner,uid,uid])

 seq=0;seen=set()
 for name in (order or []):
  name=str(name or '').strip()
  if not name or name in seen:continue
  seq+=1;seen.add(name)
  write(name,seq)
 # 並びに載っていない列でも、幅・表示名・書式・非表示のどれかが指定されて
 # いれば残す(列が増減しても記憶が消えないように。表示順は末尾扱いの0)。
 # **どれか1つでも拾い漏らすと、その設定だけが黙って消える**——並びを
 # 送らずに書式だけ保存した場合に実際に起きた。
 extra=[n for n in (list(widths)+list(label)+list(fmt)+list(rule)+list(formula)
                    +list(sortspec)+list(align)+sorted(hide)+sorted(lock))
        if str(n or '').strip() and str(n).strip() not in seen]
 for name in extra:
  name=str(name).strip()
  if name in seen:continue
  seen.add(name)
  write(name,0)
 c.commit()
 return seq


# ========================================================================
# 列プリセットマスタ（§9.111新設）
#  - 列の設定一式（並び・出す出さない・幅・表示名・書式・読み替え）に名前を
#    付けて保存し、あとから読み出す。**マスタに置くのが要点**で、
#    そうすると他のPCからも同じ形を呼び出せる（要望の主目的）。
#  - 中身は列レイアウトマスタと同じ構造をそのままJSONで持つ。列ごとに1行へ
#    展開しないのは、プリセットは**丸ごと出し入れするもの**で、1列だけ
#    引くことが無いため（展開すると行数が列数×プリセット数になる）。
#  - 対象(list:<DB>:<表>)ごとに名前が一意。同じ名前で保存し直すと上書き。
# ========================================================================
COLUMN_PRESET_TABLE='列プリセットマスタ'

def ensure_column_preset_table(c):
 names=tables(c);created=False
 if COLUMN_PRESET_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [列プリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[対象] TEXT, [名称] TEXT, [説明] TEXT, [内容JSON] TEXT, [表示順] INTEGER, [有効] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_PRESET_TABLE)
 return created

def normalize_column_preset(body):
 """保存できる形へ整える。**知らないキーは捨てる**——ファイルから読み込んだ
 ものをそのまま入れると、次の版で意味の変わったキーが紛れ込む。"""
 body=body if isinstance(body,dict) else {}
 order=[str(x).strip() for x in (body.get('order') or []) if str(x or '').strip()]
 seen=set();uniq=[]
 for name in order:
  if name in seen:continue
  seen.add(name);uniq.append(name)
 widths={}
 for k,v in (body.get('widths') or {}).items():
  w=normalize_column_width(v)
  if w is not None:widths[str(k)]=w
 hidden=sorted({str(x).strip() for x in (body.get('hidden') or []) if str(x or '').strip()})
 names={str(k):str(v).strip() for k,v in (body.get('names') or {}).items() if str(v or '').strip()}
 formats={}
 for k,v in (body.get('formats') or {}).items():
  f=normalize_format(v)
  if f:formats[str(k)]=f
 rules={str(k):str(v).strip() for k,v in (body.get('rules') or {}).items() if str(v or '').strip()}
 formulas={str(k):str(v).strip() for k,v in (body.get('formulas') or {}).items() if str(v or '').strip()}
 return {'order':uniq,'widths':widths,'hidden':hidden,'names':names,
         'formats':formats,'rules':rules,'formulas':formulas}

def column_presets(c,target=''):
 ensure_column_preset_table(c)
 target=str(target or '').strip()
 cur=c.cursor()
 if target:
  cur.execute('SELECT [プリセットID],[対象],[名称],[説明],[内容JSON],[更新日時],[更新者ID] '
              'FROM [列プリセットマスタ] WHERE [対象]=? AND ([有効] IS NULL OR [有効]<>0) '
              'ORDER BY [表示順],[名称]',[target])
 else:
  cur.execute('SELECT [プリセットID],[対象],[名称],[説明],[内容JSON],[更新日時],[更新者ID] '
              'FROM [列プリセットマスタ] WHERE ([有効] IS NULL OR [有効]<>0) '
              'ORDER BY [対象],[表示順],[名称]')
 out=[]
 for r in cur.fetchall():
  name=str(r[2] or '').strip()
  if not name:continue
  try:body=json.loads(r[4] or '{}')
  except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);body={}
  out.append({'id':r[0],'target':r[1],'name':name,'note':str(r[3] or ''),
              'body':normalize_column_preset(body),
              'updatedAt':r[5],'updatedBy':r[6]})
 return out

def save_column_preset(c,target,name,body,uid,note=''):
 """同じ対象・同じ名前があれば上書き、無ければ追加。"""
 ensure_column_preset_table(c)
 target=str(target or '').strip();name=str(name or '').strip()
 if not target:raise ValueError('対象を指定してください。')
 if not name:raise ValueError('プリセットの名前を入力してください。')
 payload=json.dumps(normalize_column_preset(body),ensure_ascii=False)
 cur=c.cursor()
 cur.execute('SELECT [プリセットID] FROM [列プリセットマスタ] WHERE [対象]=? AND [名称]=?',[target,name])
 row=cur.fetchone()
 if row:
  cur.execute('UPDATE [列プリセットマスタ] SET [内容JSON]=?,[説明]=?,[有効]=-1,[更新者ID]=?,'
              '[更新日時]=Now() WHERE [プリセットID]=?',[payload,str(note or ''),uid,row[0]])
  c.commit();return row[0]
 cur.execute('INSERT INTO [列プリセットマスタ] ([対象],[名称],[説明],[内容JSON],[表示順],[有効],'
             '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',
             [target,name,str(note or ''),payload,0,uid,uid])
 c.commit()
 return cur.lastrowid

def delete_column_preset(c,preset_id):
 ensure_column_preset_table(c)
 cur=c.cursor()
 cur.execute('DELETE FROM [列プリセットマスタ] WHERE [プリセットID]=?',[preset_id])
 c.commit()
 return cur.rowcount


# ========================================================================
# ソートプリセットマスタ（§9.88新設）
#  - 「いつも使う並び順」を保存して再利用する。フィルタプリセットマスタと
#    同じ構成(対象DB・対象テーブル・対象モード・使用回数)にしてあるので、
#    画面も同じ形で作れる。
#  - 並びは複数キーを持てる: [{'column':'ロット番号','dir':'asc'}, ...]。
#    1キーしか使わない運用でも、保存する価値があるのは複数キーのときなので
#    最初から配列で持つ。
# ========================================================================
SORT_PRESET_TABLE='ソートプリセットマスタ'

def ensure_sort_preset_table(c):
 names=tables(c);created=False
 if SORT_PRESET_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [ソートプリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[名称] TEXT, [対象DB] TEXT, [対象テーブル] TEXT, [対象モード] TEXT, [並びJSON] TEXT, '
              '[使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,SORT_PRESET_TABLE)
 return created

def sort_preset_rows(c):
 ensure_sort_preset_table(c)
 cur=c.cursor()
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[並びJSON],[使用回数],'
             '[最終使用日時],[有効],[更新日時],[更新者ID],[対象モード] FROM [ソートプリセットマスタ] '
             'ORDER BY [使用回数] DESC,[表示順],[名称]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

def normalize_sort_keys(raw):
 """保存・適用できる形へ整える。列名が空のものは捨てる。
 同じ列を2回指定しても後勝ちにはせず**先勝ち**で1回だけ残す
 (SQLのORDER BYで同じ列を並べても2つ目に意味が無いため)。"""
 out=[];seen=set()
 for item in (raw or []):
  if isinstance(item,str):item={'column':item}
  if not isinstance(item,dict):continue
  col=str(item.get('column') or '').strip()
  if not col or col in seen:continue
  seen.add(col)
  out.append({'column':col,
              'dir':'desc' if str(item.get('dir') or '').strip().lower()=='desc' else 'asc'})
 return out


# ========================================================================
# 一覧表示設定マスタ（§9.88）
#  - 「その一覧をどの密度で見せるか」= 行間。列ではなく**一覧全体**の設定
#    なので、列表示定義マスタ(1行=1列)とは別テーブルにする。混ぜると
#    「列名が空の行」という読めない行が混ざる。
#  - 対象は列レイアウトマスタと同じスコープ文字列。
#  - 行が無い対象＝未設定＝既定(3)。
# ========================================================================
LIST_VIEW_TABLE='一覧表示設定マスタ'
ROW_GAP_MIN=1
ROW_GAP_MAX=5
ROW_GAP_DEFAULT=3

def ensure_list_view_table(c):
 names=tables(c);created=False
 if LIST_VIEW_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [一覧表示設定マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[対象] TEXT, [行間] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_一覧表示設定マスタ] ON [一覧表示設定マスタ] ([対象])')
  c.commit();created=True
 ensure_audit_columns(c,LIST_VIEW_TABLE)
 return created

def normalize_row_gap(value):
 """行間の段階へ丸める。数値でなければ既定。"""
 try:n=int(float(value))
 except (TypeError,ValueError):return ROW_GAP_DEFAULT
 return max(ROW_GAP_MIN,min(ROW_GAP_MAX,n))

def list_view_settings_for(c,target):
 if LIST_VIEW_TABLE not in tables(c):return {'rowGap':ROW_GAP_DEFAULT}
 target=str(target or '').strip()
 if not target:return {'rowGap':ROW_GAP_DEFAULT}
 cur=c.cursor()
 cur.execute('SELECT [行間] FROM [一覧表示設定マスタ] WHERE [対象]=?',[target])
 row=cur.fetchone()
 if not row or row[0] is None:return {'rowGap':ROW_GAP_DEFAULT}
 return {'rowGap':normalize_row_gap(row[0])}

def set_list_view_settings(c,target,row_gap,uid):
 ensure_list_view_table(c)
 target=str(target or '').strip()
 if not target:raise ValueError('対象を指定してください。')
 gap=normalize_row_gap(row_gap)
 cur=c.cursor()
 cur.execute('SELECT [ID] FROM [一覧表示設定マスタ] WHERE [対象]=?',[target])
 row=cur.fetchone()
 if row:
  cur.execute('UPDATE [一覧表示設定マスタ] SET [行間]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ID]=?',
              [gap,uid,row[0]])
 else:
  cur.execute('INSERT INTO [一覧表示設定マスタ] ([対象],[行間],[登録者ID],[更新者ID],'
              '[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[target,gap,uid,uid])
 c.commit()
 return gap


# ========================================================================
# 表示ルールマスタ（§9.88 段4・読み替え）
#  - 「00」を「なし」と見せるような**値の読み替え**を、ルール名でまとめて
#    登録し、複数の列から使い回す。列に紐づけると「00→なし」を列の数だけ
#    書かせることになるので、ルールは列に属さない(列側は名前で参照する)。
#  - **1行 = 1つのルールの1行分**。[表示順]の上から評価して、最初に
#    当てはまったものを採用する(Excelの条件付き書式と同じ考え方。
#    「上から順に見て、最初に当てはまったものを表示する」とだけ覚えればよい)。
#  - [条件JSON]は条件の配列で、**中はAND**。ORは行を分ける
#    (「ORもANDも1画面で」は破綻しやすいので、行=OR・行の中=ANDと決める)。
#    **空配列＝どれにも当てはまらなかったとき**の既定行。
#  - 判定そのものは画面側(WL.displayRules)が行う。サーバーは生の値を返し、
#    並べ替え・絞り込みは生の値のまま効かせる(書式と同じ方針)。
# ========================================================================
DISPLAY_RULE_TABLE='表示ルールマスタ'

# 演算子。増やすときは画面(list-rules.js)の選択肢と評価(base.js)も足すこと。
# `formula`＝**式そのものが真なら**（§9.474、利用者の指示「式を選んだら、条件式の符号など選ばずに、
# 列の作り方にあるような自由度の高い内容で組めるように」）。左辺は式（calc）だけ。
RULE_OPS=('eq','ne','contains','startsWith','endsWith','empty','notEmpty',
          'gt','ge','lt','le','between','regex','formula')
# 右辺を持たない演算子。UIで値欄を出さない判断にも使う。
RULE_OPS_NO_RIGHT=('empty','notEmpty','formula')
# 条件が見る列の値（§9.474、利用者の指示「データをもとのまま使うか、設定範囲内で変換されたデータを
# 使うか選べるように」「他の列だったとしても…元データのみを対象にしている」）。**ルールごと**に持つ:
#   raw   … 元のデータ（今までどおり）
#   shown … 表示の値（その列の作り方の式→読み替え→値の整え方の後。この列も他の列も同じ）
RULE_SELF_MODES=('raw','shown')
# 色。バッジの意味を4つに絞る(増やすと「どれを選ぶか」で迷いが生まれる)。
RULE_COLORS=('','ok','ng','warn','muted')

# 条件の片側の式・出す字の式の長さ（§9.464）。**画面の`WL.formula`の上限と同じ**（§9.474 で 400→2000）。
RULE_EXPR_MAX=2000

def _normalize_operand(raw,allow_value=True):
 """条件の片側。self(この列) / column(他の列) / value(固定値) / calc(式・§9.464)。

 式の中身はここでは解かない——評価は画面の`WL.formula`の1箇所（二重に持たない）。
 読めない式は画面で「当たらない」に倒れる（固定値の正規表現と同じ扱い）。"""
 if not isinstance(raw,dict):return None
 kind=str(raw.get('kind') or '').strip()
 if kind=='self':return {'kind':'self'}
 if kind=='calc':
  expr=str(raw.get('expr') or '').strip()[:RULE_EXPR_MAX]
  return {'kind':'calc','expr':expr} if expr else None
 if kind=='column':
  col=str(raw.get('column') or '').strip()[:120]
  return {'kind':'column','column':col} if col else None
 if kind=='value' and allow_value:
  return {'kind':'value','value':str(raw.get('value') if raw.get('value') is not None else '')[:120]}
 return None

def normalize_rule_conditions(raw):
 """保存できる条件の配列へ整える。壊れた条件は落とす(全体は捨てない)。

 **落とすのは1件だけにする**——1つの入力ミスでルール全体が消えると、
 利用者からは「保存したのに戻っている」としか見えない。"""
 if not isinstance(raw,list):return []
 out=[]
 for item in raw:
  if not isinstance(item,dict):continue
  op=str(item.get('op') or '').strip()
  if op not in RULE_OPS:continue
  left=_normalize_operand(item.get('left'))
  if not left:continue
  # 「式が真なら」は左辺が式のときだけ意味を持つ（他の片側では真偽を作れない）。
  if op=='formula' and left.get('kind')!='calc':continue
  cond={'left':left,'op':op}
  if op not in RULE_OPS_NO_RIGHT:
   right=_normalize_operand(item.get('right'))
   if not right:continue
   cond['right']=right
   if op=='between':
    right2=_normalize_operand(item.get('right2'))
    if not right2:continue
    cond['right2']=right2
  out.append(cond)
 return out

def ensure_display_rule_table(c):
 names=tables(c);created=False
 if DISPLAY_RULE_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [表示ルールマスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[ルール名] TEXT, [表示順] INTEGER, [条件JSON] TEXT, [表示値] TEXT, [色] TEXT, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_表示ルールマスタ] ON [表示ルールマスタ] ([ルール名],[表示順])')
  c.commit();created=True
 ensure_audit_columns(c,DISPLAY_RULE_TABLE)
 # 条件が見る列の値（§9.474）。**ルールの全行に同じ値**を書く（ルールの属性だが、表は行単位）。
 add_missing_columns(c,DISPLAY_RULE_TABLE,(('列の値','TEXT'),))
 return created

def rule_self_mode(v):
 """条件が見る列の値（§9.474）を 'raw'／'shown' へ。読めなければ 'raw'（今までの動き）。"""
 t=str(v or '').strip()
 return t if t in RULE_SELF_MODES else 'raw'

def display_rule_options(c):
 """{ルール名: {'self': 'raw'|'shown'}}。列がまだ無い古い表では空（全部 raw）。"""
 if DISPLAY_RULE_TABLE not in tables(c):return {}
 have={r[1] for r in c.cursor().execute(f'PRAGMA table_info([{DISPLAY_RULE_TABLE}])')}
 if '列の値' not in have:return {}
 out={}
 for name,mode in c.cursor().execute('SELECT [ルール名],[列の値] FROM [表示ルールマスタ] ORDER BY [ルール名],[表示順],[ID]'):
  name=str(name or '').strip()
  if name and name not in out:out[name]={'self':rule_self_mode(mode)}
 return out

def display_rules(c):
 """{ルール名: [{'conditions':[...], 'text':..., 'color':...}, ...]}。

 壊れたJSONの行は**その行だけ**落とす(ルールごと消さない)。"""
 import json
 if DISPLAY_RULE_TABLE not in tables(c):return {}
 cur=c.cursor()
 cur.execute('SELECT [ルール名],[表示順],[条件JSON],[表示値],[色] FROM [表示ルールマスタ] '
             'ORDER BY [ルール名],[表示順],[ID]')
 out={}
 for name,_seq,cond,text,color in cur.fetchall():
  name=str(name or '').strip()
  if not name:continue
  try:parsed=json.loads(cond) if cond else []
  except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);continue
  out.setdefault(name,[]).append({
   'conditions':normalize_rule_conditions(parsed),
   'text':str(text or ''),
   'color':str(color or '').strip() if str(color or '').strip() in RULE_COLORS else '',
  })
 return out

def set_display_rule(c,name,rows,uid,self_mode='raw'):
 """1つのルールを全置換する(列レイアウトマスタと同じ方式)。

 行の順序がそのまま評価順になる。**空の行(表示値も条件も無い)は捨てる**
 ——編集画面で足しただけの行が保存されて評価順を乱さないように。"""
 import json
 ensure_display_rule_table(c)
 name=str(name or '').strip()[:60]
 if not name:raise ValueError('ルール名を指定してください。')
 cur=c.cursor()
 cur.execute('DELETE FROM [表示ルールマスタ] WHERE [ルール名]=?',[name])
 seq=0
 for row in (rows or []):
  if not isinstance(row,dict):continue
  conds=normalize_rule_conditions(row.get('conditions'))
  # `=`で始まる字は式（§9.464）。式は長くなるので上限を式のほうへ合わせる。
  _t=str(row.get('text') if row.get('text') is not None else '')
  text=_t[:RULE_EXPR_MAX] if _t.startswith('=') else _t[:120]
  color=str(row.get('color') or '').strip()
  if color not in RULE_COLORS:color=''
  if not conds and not text and not color:continue
  seq+=1
  cur.execute('INSERT INTO [表示ルールマスタ] ([ルール名],[表示順],[条件JSON],[表示値],[色],[列の値],'
              '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,Now(),Now())',
              [name,seq,json.dumps(conds,ensure_ascii=False),text,color or None,rule_self_mode(self_mode),uid,uid])
 c.commit()
 return seq

def delete_display_rule(c,name):
 """ルールを丸ごと消す。列側の参照は残るが、無いルール名は読み替えなしとして
 扱う(他マスタと同じ互換ポリシー。参照が残っていても一覧は出る)。"""
 if DISPLAY_RULE_TABLE not in tables(c):return 0
 name=str(name or '').strip()
 if not name:raise ValueError('ルール名を指定してください。')
 cur=c.cursor()
 cur.execute('SELECT COUNT(*) FROM [表示ルールマスタ] WHERE [ルール名]=?',[name])
 n=cur.fetchone()[0]
 cur.execute('DELETE FROM [表示ルールマスタ] WHERE [ルール名]=?',[name])
 c.commit()
 return n

def display_rule_usage_all(c):
 """ルール名 → 参照している列の一覧。**編集画面で「どこで使っているか」を
 出すため**に使う。列側の参照はルールに書かれていないので、ここで引かないと
 「他の列にも効くと知らずに直す」ことになる(読み替えは複数の列で使い回す
 前提で作ってあるので、これは実際に起こる)。1回のクエリでまとめて返す
 ——ルールごとに引くと、ルールの数だけ問い合わせが増える。"""
 if COLUMN_LAYOUT_TABLE not in tables(c):return {}
 have={r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 if '読み替えルール' not in have:return {}
 cur=c.cursor()
 cur.execute('SELECT [読み替えルール],[対象],[列名] FROM [列レイアウトマスタ] '
             "WHERE [読み替えルール] IS NOT NULL AND [読み替えルール]<>'' "
             'ORDER BY [対象],[表示順]')
 out={}
 for rule,target,col in cur.fetchall():
  out.setdefault(str(rule or ''),[]).append({'target':str(target or ''),'column':str(col or '')})
 return out

def display_rule_usage(c,name):
 """そのルールを参照している列の一覧(対象と列名)。削除前の確認に使う。"""
 if COLUMN_LAYOUT_TABLE not in tables(c):return []
 have={r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 if '読み替えルール' not in have:return []
 cur=c.cursor()
 cur.execute('SELECT [対象],[列名] FROM [列レイアウトマスタ] WHERE [読み替えルール]=? '
             'ORDER BY [対象],[表示順]',[str(name or '').strip()])
 return [{'target':str(t or ''),'column':str(col or '')} for t,col in cur.fetchall()]

# ------------------------------------------------------------------------
# 選択履歴マスタ(設備ごと・項目ごとの使用回数、§9.133)
# ------------------------------------------------------------------------
# 準備の入力欄(オペレータ・検査員・板厚測定器・板幅測定器…)は、選択肢が
# マスタ由来で**増え続ける**。実データのオペレータは171人おり、五十音順に
# 並べると「いつもの人」を毎回探すことになる。ここに設備ごとの使用回数を
# 持ち、**よく使うものを上へ**並べる。
#
# **なぜ端末(localStorage)ではなくマスタDBか。** 同じ設備を別のPCから
# 開くことがあり、端末に持つと台数ぶん別々に育つ。「その設備でよく使う人」
# は設備の性質であって端末の性質ではない。
#
# **なぜ測定データから数えないか。** 実績(records.sqlite3)にも設定は
# 入っているが、数えるには全件のペイロードを解く必要があり、選択肢を
# 並べるだけのために毎回それをやるのは重い(§9.91と同じ理由)。
CHOICE_USAGE_TABLE='選択履歴マスタ'
def ensure_choice_usage_table(c):
 names=tables(c);created=False
 if CHOICE_USAGE_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [選択履歴マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [項目] TEXT, [値] TEXT, [使用回数] INTEGER, [最終使用日時] DATETIME, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_選択履歴マスタ_設備項目] ON [選択履歴マスタ] ([設備名],[項目])')
  c.commit();created=True
 ensure_audit_columns(c,CHOICE_USAGE_TABLE)
 return created

def choice_usage_for(c,equipment):
 """設備の使用回数を {項目:{値:回数}} で返す。**未登録は空**(=マスタの
 並び順のまま)。設備名の全角/半角ゆれは normalize_equipment_name で吸収。"""
 if CHOICE_USAGE_TABLE not in tables(c):return {}
 cur=c.cursor()
 cur.execute('SELECT [設備名],[項目],[値],[使用回数] FROM [選択履歴マスタ]')
 target=normalize_equipment_name(equipment)
 out={}
 for eq,field,value,cnt in cur.fetchall():
  if not target or normalize_equipment_name(eq)!=target:continue
  f=str(field or '').strip();v=str(value or '').strip()
  if not f or not v:continue
  try:n=int(cnt or 0)
  except Exception as _e:quiet('数として読めない（既定で続ける）',_e);n=0
  out.setdefault(f,{})[v]=n
 return out

def choice_usage_bump(c,equipment,picks,uid):
 """選ばれた値の回数を1つずつ増やす。picks は {項目:値}。
 **'-'や空は数えない**(「選んでいない」を上位に押し上げないため)。
 戻り値は数えた件数。"""
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 ensure_choice_usage_table(c)
 cur=c.cursor();n=0
 for field,value in (picks or {}).items():
  f=str(field or '').strip();v=str(value or '').strip()
  if not f or not v or v=='-':continue
  cur.execute('SELECT [ID],[設備名] FROM [選択履歴マスタ] WHERE [項目]=? AND [値]=?',[f,v])
  target=normalize_equipment_name(equipment)
  rid=next((r[0] for r in cur.fetchall() if normalize_equipment_name(r[1])==target),None)
  if rid is None:
   cur.execute('INSERT INTO [選択履歴マスタ] ([設備名],[項目],[値],[使用回数],[最終使用日時],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,1,Now(),?,?,Now(),Now())',
               [equipment,f,v,uid,uid])
  else:
   cur.execute('UPDATE [選択履歴マスタ] SET [使用回数]=Nz([使用回数],0)+1,[最終使用日時]=Now(),[更新者ID]=?,[更新日時]=Now() WHERE [ID]=?',[uid,rid])
  n+=1
 c.commit()
 return n


# ========================================================================
# クエリ結合マスタ(§9.193): データソース同士を突合キーでつなぐ
# ------------------------------------------------------------------------
# 以前、別のデータソースの列を一覧へ足せるのは**品質データだけ**で、しかも
# 「ロット番号・鋳造番号・製造材質の3つで突き合わせる」と決め打ちだった。
# 参照データを増やせるようにした(§9.94・§9.163)のに、増やしたデータは
# 「一覧として見る」以外に使い道が無かった。
#
# 1行＝1つの結合。左(対象)はどの一覧に足すか、右(相手)はどこから持ってくるか。
# **保存するのは定義だけ**で、実際の突合は backend/query_join.py が
# 1箇所で行う(画面もサーバーも同じ答えになるようにするため)。
# ========================================================================
QUERY_JOIN_TABLE='クエリ結合マスタ'
# 同じキーに相手が2件以上当たったときの扱い。
#   'first' … 表示順の最初の1件を使う(既定。今までの品質データ結合と同じ)
#   'blank' … 空にする(どれが正しいか決められないので出さない)
QUERY_JOIN_MULTI=('first','blank')
# 結合の仕方(§9.194)。SQLのJOINと同じ6通りで、**行がどう増減するか**が違う。
#   'left'      … 左外部: この一覧は全部残す(既定。今までの品質データ結合と同じ)
#   'inner'     … 内部  : 両方にある行だけ
#   'right'     … 右外部: 相手は全部残す(相手にしかない行が増える)
#   'full'      … 完全外部: どちらかにあれば残す
#   'leftOnly'  … 左のみ: この一覧にしかない行だけ(相手の列は空)
#   'rightOnly' … 右のみ: 相手にしかない行だけ
# **既定を'left'から動かさないこと**——保存済みの行は結合方法を持たないので、
# 既定が変わると設定を触っていない現場の一覧が黙って変わる。
QUERY_JOIN_KINDS=('left','inner','right','full','leftOnly','rightOnly')
QUERY_JOIN_KIND_DEFAULT='left'
# 用途(§9.365)。**1行が「何のための結合か」を名乗る。**
#   ''       … 一覧に列を足す(今までどおり。既定)
#   '完了突合' … 仕掛から消えたロットを相手のデータで探し、当たれば完了にする
# **既定を''から動かさないこと**——保存済みの行は用途を持たないので、既定を
# 変えると設定を触っていない現場の結合が別のものとして動き出す。
QUERY_JOIN_PURPOSE_LIST=''
QUERY_JOIN_PURPOSE_FINISH='完了突合'
QUERY_JOIN_PURPOSES=(QUERY_JOIN_PURPOSE_LIST,QUERY_JOIN_PURPOSE_FINISH)
# 後から足した列。**共有せず現場で動いているDBを作り直さない**ため、他のマスタと
# 同じ「無ければALTER TABLEで足す」方式にする(§9.194で[結合方法]を足したのと同じ)。
# **[スケジュール除外]の保存値は「使わない」側**(§9.132の作法)——1が入っている
# 行だけがスケジュール表から外れるので、設定を触っていない行の見え方は変わらない。
_QUERY_JOIN_EXTRA_COLUMNS=(('結合方法','TEXT'),('用途','TEXT'),
                           ('完了日時列','TEXT'),('スケジュール除外','INTEGER'))
# 読むときに必ずある列。**後から足した列は`_QUERY_JOIN_EXTRA_COLUMNS`で、
# 実際にある列だけをSELECTする**——読み取り専用で開く経路があるのでここでは
# ALTER TABLEできず、古い表もそのまま読めなければならない。
_QUERY_JOIN_BASE_COLUMNS=('結合ID','結合名','対象データソース','対象テーブル',
                          '相手データソース','相手テーブル','突合キーJSON',
                          '取り込む列JSON','接頭辞','複数一致','表示順','有効')
# 1つの結合で持てる突合キーと取り込む列の上限。**画面が壊れない範囲**で
# 切る(キーが10も要る突合は、たいてい元データの持ち方が間違っている)。
QUERY_JOIN_MAX_KEYS=6
QUERY_JOIN_MAX_COLUMNS=400

def ensure_query_join_table(c):
 names=tables(c);created=False
 if QUERY_JOIN_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [クエリ結合マスタ] ([結合ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[結合名] TEXT, [対象データソース] TEXT, [対象テーブル] TEXT, '
              '[相手データソース] TEXT, [相手テーブル] TEXT, [突合キーJSON] TEXT, '
              '[取り込む列JSON] TEXT, [接頭辞] TEXT, [複数一致] TEXT, '
              '[表示順] INTEGER, [有効] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_クエリ結合マスタ_対象] ON [クエリ結合マスタ] '
              '([対象データソース],[対象テーブル],[表示順])')
  c.commit();created=True
 ensure_audit_columns(c,QUERY_JOIN_TABLE)
 # 後から足した列(結合方法=§9.194、用途・完了日時列・スケジュール除外=§9.365)。
 for name,decl in _QUERY_JOIN_EXTRA_COLUMNS:
  _add_missing_column(c,QUERY_JOIN_TABLE,name,decl)
 return created

def normalize_join_keys(raw):
 """突合キーの配列へ整える。[{'left':列名,'right':列名}, ...]。

 **片側だけの行は落とす**(どちらと突き合わせるのか決まらない)。落とすのは
 その行だけで、定義ごと捨てない——1行の打ち間違いで結合の設定が丸ごと
 消えると、利用者からは「保存したのに戻っている」としか見えない。"""
 out=[]
 for item in (raw if isinstance(raw,list) else []):
  if not isinstance(item,dict):continue
  l=str(item.get('left') or '').strip()[:120]
  r=str(item.get('right') or '').strip()[:120]
  if not l or not r:continue
  if any(x['left']==l and x['right']==r for x in out):continue
  out.append({'left':l,'right':r})
  if len(out)>=QUERY_JOIN_MAX_KEYS:break
 return out

def normalize_join_columns(raw):
 """取り込む列。**空＝相手の列をすべて**(選び直さずに済むほうが普通)。"""
 out=[]
 for x in (raw if isinstance(raw,list) else []):
  n=str(x or '').strip()[:120]
  if n and n not in out:out.append(n)
  if len(out)>=QUERY_JOIN_MAX_COLUMNS:break
 return out

def _json_list(raw):
 try:return json.loads(raw) if raw else []
 except Exception as _e:
  quiet('保存された値を読めない（既定で続ける）',_e);return []

def _join_row(d):
 """1行を画面・エンジンが読む形へ。**受けるのは列名の辞書**——後から足した
 列は表にあるとは限らないので、位置ではなく名前で読む(無ければ既定)。"""
 jid=d.get('結合ID')
 name=str(d.get('結合名') or '').strip()
 multi=str(d.get('複数一致') or '').strip()
 kind=str(d.get('結合方法') or '').strip()
 purpose=str(d.get('用途') or '').strip()
 active=d.get('有効')
 return {'id':jid,'name':name or f'結合{jid}',
         'kind':kind if kind in QUERY_JOIN_KINDS else QUERY_JOIN_KIND_DEFAULT,
         'purpose':purpose if purpose in QUERY_JOIN_PURPOSES else QUERY_JOIN_PURPOSE_LIST,
         'left':str(d.get('対象データソース') or '').strip(),
         'leftTable':str(d.get('対象テーブル') or '').strip(),
         'right':str(d.get('相手データソース') or '').strip(),
         'rightTable':str(d.get('相手テーブル') or '').strip(),
         'keys':normalize_join_keys(_json_list(d.get('突合キーJSON'))),
         'columns':normalize_join_columns(_json_list(d.get('取り込む列JSON'))),
         'prefix':str(d.get('接頭辞') or '').strip()[:40],
         'finishColumn':str(d.get('完了日時列') or '').strip()[:120],
         # **保存されているのは「使わない」側**(§9.132)。空＝使う。
         'useInSchedule':not bool(d.get('スケジュール除外')),
         'multi':multi if multi in QUERY_JOIN_MULTI else 'first',
         'order':int(d.get('表示順') or 0),
         'active':True if active is None else bool(active)}

def query_joins(c,include_disabled=False):
 """登録されている結合。表が無ければ空(読み取り専用接続から呼べる)。

 **後から足した列が無い古い表も読めること**——読み取り専用で開く経路が
 あるのでここではALTER TABLEできない。実際にある列だけをSELECTし、
 無い列は`_join_row()`が既定で埋める。"""
 if QUERY_JOIN_TABLE not in tables(c):return []
 cur=c.cursor()
 have={r[1] for r in cur.execute(f'PRAGMA table_info([{QUERY_JOIN_TABLE}])')}
 names=list(_QUERY_JOIN_BASE_COLUMNS)+[n for n,_d in _QUERY_JOIN_EXTRA_COLUMNS if n in have]
 sel=','.join(f'[{n}]' for n in names)
 cur.execute(f'SELECT {sel} FROM [クエリ結合マスタ] ORDER BY [表示順],[結合ID]')
 out=[]
 for r in cur.fetchall():
  d=_join_row(dict(zip(names,r)))
  if d['active'] or include_disabled:out.append(d)
 return out

def query_join_save(c,data,uid,jid=None):
 """1件を登録／更新する。戻り値は結合ID。

 **同じ名前は1つだけ**——結合名は列名がぶつかったときの接頭辞にも
 見出しにも使うので、2つあるとどちらの列か分からなくなる。"""
 ensure_query_join_table(c)
 name=str((data or {}).get('name') or '').strip()[:60]
 if not name:raise ValueError('結合名を入れてください。')
 left=str((data or {}).get('left') or '').strip()
 right=str((data or {}).get('right') or '').strip()
 if not left:raise ValueError('どの一覧へ足すか（対象のデータソース）を選んでください。')
 if not right:raise ValueError('どこから持ってくるか（相手のデータソース）を選んでください。')
 keys=normalize_join_keys((data or {}).get('keys'))
 if not keys:raise ValueError('突合キーを1組以上入れてください（左右どちらの列名も要ります）。')
 columns=normalize_join_columns((data or {}).get('columns'))
 multi=str((data or {}).get('multi') or 'first').strip()
 if multi not in QUERY_JOIN_MULTI:multi='first'
 kind=str((data or {}).get('kind') or '').strip()
 if kind not in QUERY_JOIN_KINDS:kind=QUERY_JOIN_KIND_DEFAULT
 purpose=str((data or {}).get('purpose') or '').strip()
 if purpose not in QUERY_JOIN_PURPOSES:purpose=QUERY_JOIN_PURPOSE_LIST
 finish_col=str((data or {}).get('finishColumn') or '').strip()[:120]
 if purpose==QUERY_JOIN_PURPOSE_FINISH:
  # 完了突合は「当たったら完了にする」1通りしか無いので、結合の仕方は既定へ寄せる
  # (押せるのに効かない設定を残さない。§4)。
  kind=QUERY_JOIN_KIND_DEFAULT
 else:
  finish_col=''
 # **保存するのは「使わない」側**(§9.132)。渡されなければ「使う」。
 excluded=0 if (data or {}).get('useInSchedule',True) else 1
 cur=c.cursor()
 sql='SELECT [結合ID] FROM [クエリ結合マスタ] WHERE [結合名]=?'
 args=[name]
 if jid is not None:sql+=' AND [結合ID]<>?';args.append(int(jid))
 cur.execute(sql,args)
 if cur.fetchone():raise ValueError(f'結合名「{name}」は既に登録されています。別の名前にしてください。')
 vals=[name,left,str((data or {}).get('leftTable') or '').strip(),
       right,str((data or {}).get('rightTable') or '').strip(),
       json.dumps(keys,ensure_ascii=False),json.dumps(columns,ensure_ascii=False),
       str((data or {}).get('prefix') or '').strip()[:40],multi,
       int((data or {}).get('order') or 0),
       0 if str((data or {}).get('enabled') or '').strip()=='無効' else -1,
       kind,purpose,finish_col,excluded,uid]
 if jid is not None:
  cur.execute('SELECT [結合ID] FROM [クエリ結合マスタ] WHERE [結合ID]=?',[int(jid)])
  if not cur.fetchone():raise ValueError('指定の結合が見つかりません。')
  cur.execute('UPDATE [クエリ結合マスタ] SET [結合名]=?,[対象データソース]=?,[対象テーブル]=?,'
              '[相手データソース]=?,[相手テーブル]=?,[突合キーJSON]=?,[取り込む列JSON]=?,'
              '[接頭辞]=?,[複数一致]=?,[表示順]=?,[有効]=?,[結合方法]=?,[用途]=?,[完了日時列]=?,'
              '[スケジュール除外]=?,[更新者ID]=?,[更新日時]=Now() '
              'WHERE [結合ID]=?',vals+[int(jid)])
  c.commit();return int(jid)
 cur.execute('INSERT INTO [クエリ結合マスタ] ([結合名],[対象データソース],[対象テーブル],'
             '[相手データソース],[相手テーブル],[突合キーJSON],[取り込む列JSON],[接頭辞],'
             '[複数一致],[表示順],[有効],[結合方法],[用途],[完了日時列],[スケジュール除外],'
             '[更新者ID],[登録者ID],[登録日時],[更新日時]) '
             'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',vals+[uid])
 c.commit()
 return int(cur.lastrowid)

# ---- 旧い突合キーの移行(§9.367) ---------------------------------------
# §9.364では`データソースマスタ[突合キー]`が突合キーの並びを1つ持ち、§9.365は
# それを「保存されていない既定の1件」としてこのエンジンへ乗せた。**保存されて
# いないものは編集も削除もできない**（利用者の指摘「固定されてしまい実績の
# クエリが修正できません」）ので、**一度きりの移行で普通の1行にする**。
# 移したあとは他の結合とまったく同じ——編集・複製・削除ができる。
FINISH_JOIN_MIGRATED_KEY='__finish_join_migrated__'
# 移行で作る行の名前。**現場が見て意味の分かる名前**にする（`結合12`のような
# 通し番号だと、何のための行か開くまで分からない）。
FINISH_JOIN_MIGRATED_NAME='実績突合'

def migrate_finish_join(c,work_key,actual_key,keys,finish_column=''):
 """旧い突合キーを、クエリ結合マスタの「完了突合」1行へ移す。

 戻り値は作った結合IDか None。**何度呼んでも同じ**（目印があれば何もしない）。

 移さないのは次のとき——いずれも**目印は立てる**（次に開くたびに試し続けない）:
  ・役割「仕掛」か「実績」が無い（突合そのものが成り立たない）
  ・突合キーが1つも無い
  ・既に完了突合の行がある（利用者が自分で作った。そちらが正）
 """
 if path_config_rows(c).get(FINISH_JOIN_MIGRATED_KEY):
  return None
 ensure_query_join_table(c)
 made=None
 have=[d for d in query_joins(c,include_disabled=True)
       if str(d.get('purpose') or '')==QUERY_JOIN_PURPOSE_FINISH]
 names=[str(k or '').strip() for k in (keys or []) if str(k or '').strip()]
 if work_key and actual_key and names and not have:
  # **名前がぶつからないようにする**——同じ名前は1つだけ（`query_join_save`が
  # 弾く）ので、移行が例外で止まると目印も立たず毎回試すことになる。
  used={str(d.get('name') or '') for d in query_joins(c,include_disabled=True)}
  name=FINISH_JOIN_MIGRATED_NAME
  n=2
  while name in used:
   name=f'{FINISH_JOIN_MIGRATED_NAME}{n}';n+=1
  made=query_join_save(c,{
   'name':name,'left':work_key,'leftTable':'','right':actual_key,'rightTable':'',
   # 旧い設定は**左右で同じ列名**しか持てなかった（それがこの移行の動機）。
   'keys':[{'left':k,'right':k} for k in names],
   'columns':[],'prefix':'','multi':'first','kind':QUERY_JOIN_KIND_DEFAULT,
   'purpose':QUERY_JOIN_PURPOSE_FINISH,
   'finishColumn':(finish_column if finish_column in names else ''),
   'useInSchedule':True,'order':0,'enabled':'有効'},'migrate:finish-join')
 set_path_config(c,FINISH_JOIN_MIGRATED_KEY,'done','migrate:finish-join')
 return made

def query_join_delete(c,jid):
 """1件消す。**本当に消す**——無効にするだけの行が溜まると、どの結合が
 効いているのかを毎回読んで確かめることになる(有効/無効は別に持つ)。"""
 if QUERY_JOIN_TABLE not in tables(c):return 0
 cur=c.cursor()
 cur.execute('DELETE FROM [クエリ結合マスタ] WHERE [結合ID]=?',[int(jid)])
 n=cur.rowcount;c.commit()
 return n
