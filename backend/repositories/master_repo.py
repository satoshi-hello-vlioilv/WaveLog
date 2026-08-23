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

from ..db_access import DBS, connect, ensure_audit_columns, tables, cols, qi

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
 except Exception:return DEFAULT_MAX_STRIPS
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

def normalize_max_line_speed(value):
 """入力を保存値へ。空欄・数にならないもの・0以下はNone(=未設定)。"""
 s=str(value if value is not None else '').strip()
 if not s:return None
 try:n=float(s)
 except Exception:return None
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
 except Exception:pass
 return None

def normalize_standard_minutes(value):
 """入力を保存値へ。空欄・数にならないもの・0以下はNone(=未設定)。
 **0を「0分」として保存しない**——0分の作業は無いので、入力ミス
 (空欄のつもりで0)を仕様として受け入れると予定が全部同時刻に潰れる。"""
 s=str(value if value is not None else '').strip()
 if not s:return None
 try:n=float(s)
 except Exception:return None
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
 except Exception:pass
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
  have=set(cols(c,EQUIPMENT_MASTER_TABLE))
  for name,decl in ((MAX_STRIPS_COLUMN,'INTEGER'),(EQUIPMENT_KIND_COLUMN,'TEXT'),
                    (STANDARD_MINUTES_COLUMN,'REAL'),(MAX_LINE_SPEED_COLUMN,'REAL')):
   if name not in have:
    cur=c.cursor();cur.execute(f'ALTER TABLE {qi(EQUIPMENT_MASTER_TABLE)} ADD COLUMN {qi(name)} {decl}');c.commit()
 except Exception:pass
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
 except Exception:pass
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
 except Exception:pass
 return ''

def normalize_equipment_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def equipment_master_rows(c):
 ensure_equipment_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [設備ID],[設備名],[表示順],[有効],[更新日時],[更新者ID],[最大条数],[区分],[標準時間分],'
             '[最大ライン速度] FROM [設備マスタ] ORDER BY [表示順],[設備名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[3] is None else bool(r[3])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

# ========================================================================
# オペレータマスタ（一般的なオートナンバー方式）
#  - 主キーは COUNTER（オートナンバー）で人手管理不要。
#  - 有効フラグ・表示順・登録/更新日時を持ち、論理削除で履歴を保持。
#  - 読み取り（measurement_context）もこのマスタから行う。
# ========================================================================
OPERATOR_MASTER_TABLE='オペレータマスタ'
def ensure_operator_master_table(c):
 names=tables(c);created=False
 if OPERATOR_MASTER_TABLE not in names:
  # 設備マスタと同じ方針。制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [オペレータマスタ] ([オペレータID] INTEGER PRIMARY KEY AUTOINCREMENT, [氏名] TEXT, [ﾖﾐｶﾞﾅ] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_オペレータマスタ_氏名] ON [オペレータマスタ] ([氏名])')
  c.commit();created=True
 ensure_audit_columns(c,OPERATOR_MASTER_TABLE)
 return created

def normalize_operator_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_operator_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_operator_master_table(c)
 return created

def operator_master_rows(c):
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
 names=tables(c);created=False
 if OPERATOR_EQUIPMENT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [オペレータ設備マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [オペレータID] INTEGER, [設備名] TEXT, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_オペレータ設備マスタ] ON [オペレータ設備マスタ] ([オペレータID],[設備名])')
  c.commit();created=True
 ensure_audit_columns(c,OPERATOR_EQUIPMENT_TABLE)
 return created

def operator_equipment_map(c):
 # {オペレータID: [設備名, ...]} を返す。テーブル未作成の場合は空。
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
 return (
  (OPERATOR_EQUIPMENT_TABLE,'設備名','exact'),
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
 names=tables(c);created=False
 if SPOOL_MASTER_TABLE not in names:
  # 設備マスタ・オペレータマスタと同じ方針。制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [スプール種別マスタ] ([スプールID] INTEGER PRIMARY KEY AUTOINCREMENT, [種別名] TEXT, [備考] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_スプール種別マスタ_種別名] ON [スプール種別マスタ] ([種別名])')
  c.commit();created=True
 ensure_audit_columns(c,SPOOL_MASTER_TABLE)
 return created

def normalize_spool_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_spool_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_spool_master_table(c)
 return created

def spool_master_rows(c):
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
 names=tables(c);created=False
 if INNER_MASTER_TABLE not in names:
  # 設備マスタ・オペレータマスタ・スプール種別マスタと同じ方針。制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [内径種別マスタ] ([内径ID] INTEGER PRIMARY KEY AUTOINCREMENT, [内径種別] TEXT, [備考] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_内径種別マスタ_内径種別] ON [内径種別マスタ] ([内径種別])')
  c.commit();created=True
 ensure_audit_columns(c,INNER_MASTER_TABLE)
 return created

def normalize_inner_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_inner_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_inner_master_table(c)
 return created

def inner_master_rows(c):
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
  created=False
  if table not in tables(c):
   cur=c.cursor()
   cur.execute(f'CREATE TABLE [{table}] ([{id_col}] INTEGER PRIMARY KEY AUTOINCREMENT, [{name_col}] TEXT, [備考] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
   cur.execute(f'CREATE UNIQUE INDEX [UX_{table}_{name_col}] ON [{table}] ([{name_col}])')
   for i,nm in enumerate(seed):
    cur.execute(f'INSERT INTO [{table}] ([{name_col}],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[nm,'',(i+1)*10,'seed','seed'])
   c.commit();created=True
  ensure_audit_columns(c,table)
  return created
 def ensure(path):
  with connect(path,False) as c:
   return ensure_table(c)
 def rows(c):
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
 names=tables(c);created=False
 if DEVICE_MASTER_TABLE not in names:
  # 他マスタと同じ方針。制約と索引は別SQLで作成する。
  # 測定区分＋機器名の複合一意（同名でも区分違いは別レコードとして許容）。
  cur=c.cursor()
  cur.execute('CREATE TABLE [機器マスタ] ([機器ID] INTEGER PRIMARY KEY AUTOINCREMENT, [機器名] TEXT, [測定区分] TEXT, [備考] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_機器マスタ_区分名] ON [機器マスタ] ([測定区分],[機器名])')
  c.commit();created=True
 ensure_audit_columns(c,DEVICE_MASTER_TABLE)
 return created

def normalize_device_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def ensure_device_master(path):
 # 書き込み接続でテーブルの存在を保証する。measurement_context の前処理に使う。
 with connect(path,False) as c:
  created=ensure_device_master_table(c)
 return created

def device_master_rows(c):
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

def _add_missing_column(c,table,name,decl):
 if name not in {r[1] for r in c.cursor().execute(f'PRAGMA table_info([{table}])')}:
  c.cursor().execute(f'ALTER TABLE [{table}] ADD COLUMN [{name}] {decl}')
  c.commit()

def ensure_filter_preset_table(c):
 names=tables(c);created=False
 if FILTER_PRESET_TABLE not in names:
  # 設備マスタと同様の方針。条件はJSON文字列として保持し、使用回数は集計用に保持する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタプリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [対象DB] TEXT, [対象テーブル] TEXT, [条件JSON] TEXT, [使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PRESET_TABLE)
 # 既存DBには無い列なので、他のマスタと同じ「無ければALTER TABLEで足す」方式。
 for name,decl in (_FILTER_PRESET_MODE_COLUMN,_FILTER_PRESET_OWNER_COLUMN):
  _add_missing_column(c,FILTER_PRESET_TABLE,name,decl)
 return created

def filter_preset_rows(c):
 ensure_filter_preset_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する(使用回数の多い順で返す)。
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[最終使用日時],[有効],[更新日時],[更新者ID],[対象モード],[所有者ID] FROM [フィルタプリセットマスタ] ORDER BY [使用回数] DESC,[表示順],[名称]')
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
def ensure_access_permission_table(c):
 names=tables(c);created=False
 if ACCESS_PERMISSION_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [アクセス権限マスタ] ([権限ID] INTEGER PRIMARY KEY AUTOINCREMENT, [ログインID] TEXT, [PC名] TEXT, [編集可否] INTEGER, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_アクセス権限マスタ] ON [アクセス権限マスタ] ([ログインID],[PC名])')
  c.commit();created=True
 ensure_audit_columns(c,ACCESS_PERMISSION_TABLE)
 existing=set(cols(c,ACCESS_PERMISSION_TABLE));cur=c.cursor();changed=False
 for name,typ in _SCHEDULE_PERMISSION_COLUMNS:
  if name not in existing:
   cur.execute(f'ALTER TABLE [{ACCESS_PERMISSION_TABLE}] ADD COLUMN [{name}] {typ}');changed=True
 if changed:c.commit()
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
 cur.execute('SELECT [権限ID],[ログインID],[PC名],[編集可否],[表示順],[有効],[更新日時],[更新者ID],[スケジュール可否],[現場段取り可否],[現場段取り対象設備] FROM [アクセス権限マスタ] ORDER BY [表示順],[ログインID],[PC名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[5] is None else bool(r[5])
  if active:rows.append(r)
 return rows

def has_edit_permission(c,login_id,pc_name):
 return permission_flags(c,login_id,pc_name)['canEdit']

_DEFAULT_PERMISSION_FLAGS={'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':''}

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
  return {'canEdit':bool(r[3]),'canSchedule':bool(r[8]),'canFieldReorder':bool(r[9]),'fieldReorderEquipment':str(r[10] or '').strip()}
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
 # 既存DBへの追加(他マスタと同じ「無ければALTER TABLEで足す」方式)。
 have={r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 # 計算式(§9.111 ⑦): データ側に無い列を、既にある列から作る。**列の1行**
 # として持つので、並び・幅・書式・読み替えはそのまま効く。
 # 幅固定(§9.119): 幅を「自動(内容に合わせる)/手で決めた幅/固定」の3つで持つ。
 # 自動と手動は[幅]の有無で分かるが、**固定はもう1つの状態**なので列を足す
 # (幅を持ったまま「もう動かさない」と言えるようにするため)。
 # 並べ替え(§9.187): 種類が混ざったときの塊の順・数字混じりの読み順・
 # 生の値/変換後のどちらで並べるか。**1列ぶんをJSONで持つ**——中身は
 # 3つで、増えるたびに列を足すと移行が要る（表示だけの設定なので、
 # SQLで絞り込む相手にはならない）。
 for name,decl in (('表示','INTEGER'),('表示名','TEXT'),
                   ('書式種別','TEXT'),('書式パターン','TEXT'),('小数桁','INTEGER'),
                   ('桁区切り','INTEGER'),('単位前','TEXT'),('単位後','TEXT'),
                   ('読み替えルール','TEXT'),('計算式','TEXT'),('幅固定','INTEGER'),
                   ('並べ替え','TEXT')):
  if name not in have:
   c.cursor().execute(f'ALTER TABLE [{COLUMN_LAYOUT_TABLE}] ADD COLUMN [{name}] {decl}')
   c.commit()
 return created

# 幅の下限・上限。狭すぎると掴めなくなり、広すぎると他の列が押し出される。
COLUMN_WIDTH_MIN=40
COLUMN_WIDTH_MAX=900

def normalize_column_width(value):
 """保存できる幅へ丸める。数値でなければNone(=既定の幅)。"""
 if value in (None,''):return None
 try:w=int(float(value))
 except (TypeError,ValueError):return None
 return max(COLUMN_WIDTH_MIN,min(COLUMN_WIDTH_MAX,w))

def column_layout_for(c,target):
 """{'order':[列名...], 'widths':{列名:幅}, 'hidden':[列名...]}。未設定なら空。

 **hiddenは「この対象で隠す列」**。[表示]がNULLの行は表示(既定)として扱う
 ——列を足したときに既存の行が勝手に隠れないようにするため。"""
 empty={'order':[],'widths':{},'hidden':[],'names':{},'formats':{},'rules':{},'formulas':{},
        'locks':[],'sorts':{}}
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
             +col('並べ替え')+
             ' FROM [列レイアウトマスタ] WHERE [対象]=? ORDER BY [表示順],[ID]',[target])
 order=[];widths={};hidden=[];names={};formats={};rules={};formulas={};locks=[];sorts={}
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
 return {'order':order,'widths':widths,'hidden':hidden,'names':names,
         'formats':formats,'rules':rules,'formulas':formulas,'locks':locks,
         'sorts':sorts}

def column_layout_targets(c):
 """保存されている対象(target)の一覧。**持ち出し・取り込み用**(§9.178)。

 対象は画面が組み立てる文字列(list:<DB>:<表> / timeline:<設備> / print:<設備> /
 report:<設備> / records:list)で、サーバーは中身を解釈しない。並びは
 名前順——保存順は「最後に触った順」で、人が探すときの手掛かりにならない。"""
 if COLUMN_LAYOUT_TABLE not in tables(c):return []
 cur=c.cursor()
 cur.execute(f'SELECT DISTINCT [対象] FROM [{COLUMN_LAYOUT_TABLE}] ORDER BY [対象]')
 return [str(r[0] or '').strip() for r in cur.fetchall() if str(r[0] or '').strip()]

def set_column_layout(c,target,order,widths,uid,hidden=None,names=None,formats=None,rules=None,
                      formulas=None,locks=None,sorts=None,fields=None):
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
  keep=column_layout_for(c,target)
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
 cur=c.cursor()
 cur.execute('DELETE FROM [列レイアウトマスタ] WHERE [対象]=?',[target])

 def write(name,seq):
  f=normalize_format(fmt.get(name)) or {}
  cur.execute('INSERT INTO [列レイアウトマスタ] ([対象],[列名],[表示名],[表示順],[幅],[表示],'
              '[書式種別],[書式パターン],[小数桁],[桁区切り],[単位前],[単位後],'
              '[読み替えルール],[計算式],[幅固定],[並べ替え],'
              '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
              'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
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
               sortspec.get(name) or None,uid,uid])

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
                    +list(sortspec)+sorted(hide)+sorted(lock))
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
  except Exception:body={}
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
RULE_OPS=('eq','ne','contains','startsWith','endsWith','empty','notEmpty',
          'gt','ge','lt','le','between','regex')
# 右辺を持たない演算子。UIで値欄を出さない判断にも使う。
RULE_OPS_NO_RIGHT=('empty','notEmpty')
# 色。バッジの意味を4つに絞る(増やすと「どれを選ぶか」で迷いが生まれる)。
RULE_COLORS=('','ok','ng','warn','muted')

def _normalize_operand(raw,allow_value=True):
 """条件の片側。self(この列) / column(他の列) / value(固定値)。"""
 if not isinstance(raw,dict):return None
 kind=str(raw.get('kind') or '').strip()
 if kind=='self':return {'kind':'self'}
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
 return created

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
  except Exception:continue
  out.setdefault(name,[]).append({
   'conditions':normalize_rule_conditions(parsed),
   'text':str(text or ''),
   'color':str(color or '').strip() if str(color or '').strip() in RULE_COLORS else '',
  })
 return out

def set_display_rule(c,name,rows,uid):
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
  text=str(row.get('text') if row.get('text') is not None else '')[:120]
  color=str(row.get('color') or '').strip()
  if color not in RULE_COLORS:color=''
  if not conds and not text and not color:continue
  seq+=1
  cur.execute('INSERT INTO [表示ルールマスタ] ([ルール名],[表示順],[条件JSON],[表示値],[色],'
              '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,Now(),Now())',
              [name,seq,json.dumps(conds,ensure_ascii=False),text,color or None,uid,uid])
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
  except Exception:n=0
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
_QUERY_JOIN_KIND_COLUMN=('結合方法','TEXT')
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
 # 結合方法(§9.194)は後から足した列。共有せず現場で動いているDBを作り直さない
 # ため、他のマスタと同じ「無ければALTER TABLEで足す」方式にする。
 _add_missing_column(c,QUERY_JOIN_TABLE,*_QUERY_JOIN_KIND_COLUMN)
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

def _join_row(r):
 name=str(r[1] or '').strip()
 try:keys=json.loads(r[6]) if r[6] else []
 except Exception:keys=[]
 try:columns=json.loads(r[7]) if r[7] else []
 except Exception:columns=[]
 multi=str(r[9] or '').strip()
 kind=str((r[12] if len(r)>12 else '') or '').strip()
 return {'id':r[0],'name':name or f'結合{r[0]}',
         'kind':kind if kind in QUERY_JOIN_KINDS else QUERY_JOIN_KIND_DEFAULT,
         'left':str(r[2] or '').strip(),'leftTable':str(r[3] or '').strip(),
         'right':str(r[4] or '').strip(),'rightTable':str(r[5] or '').strip(),
         'keys':normalize_join_keys(keys),'columns':normalize_join_columns(columns),
         'prefix':str(r[8] or '').strip()[:40],
         'multi':multi if multi in QUERY_JOIN_MULTI else 'first',
         'order':int(r[10] or 0),'active':True if r[11] is None else bool(r[11])}

def query_joins(c,include_disabled=False):
 """登録されている結合。表が無ければ空(読み取り専用接続から呼べる)。

 **[結合方法]が無い古い表も読めること**——読み取り専用で開く経路があるので
 ここではALTER TABLEできない。列が無ければ既定('left')として読む。"""
 if QUERY_JOIN_TABLE not in tables(c):return []
 cur=c.cursor()
 has_kind=_QUERY_JOIN_KIND_COLUMN[0] in {r[1] for r in cur.execute(f'PRAGMA table_info([{QUERY_JOIN_TABLE}])')}
 if not has_kind:
  cur.execute('SELECT [結合ID],[結合名],[対象データソース],[対象テーブル],[相手データソース],'
              '[相手テーブル],[突合キーJSON],[取り込む列JSON],[接頭辞],[複数一致],[表示順],[有効] '
              'FROM [クエリ結合マスタ] ORDER BY [表示順],[結合ID]')
  return [d for d in (_join_row(r) for r in cur.fetchall()) if d['active'] or include_disabled]
 cur.execute('SELECT [結合ID],[結合名],[対象データソース],[対象テーブル],[相手データソース],'
             '[相手テーブル],[突合キーJSON],[取り込む列JSON],[接頭辞],[複数一致],[表示順],[有効],'
             '[結合方法] FROM [クエリ結合マスタ] ORDER BY [表示順],[結合ID]')
 out=[]
 for r in cur.fetchall():
  d=_join_row(r)
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
       0 if str((data or {}).get('enabled') or '').strip()=='無効' else -1,kind,uid]
 if jid is not None:
  cur.execute('SELECT [結合ID] FROM [クエリ結合マスタ] WHERE [結合ID]=?',[int(jid)])
  if not cur.fetchone():raise ValueError('指定の結合が見つかりません。')
  cur.execute('UPDATE [クエリ結合マスタ] SET [結合名]=?,[対象データソース]=?,[対象テーブル]=?,'
              '[相手データソース]=?,[相手テーブル]=?,[突合キーJSON]=?,[取り込む列JSON]=?,'
              '[接頭辞]=?,[複数一致]=?,[表示順]=?,[有効]=?,[結合方法]=?,[更新者ID]=?,[更新日時]=Now() '
              'WHERE [結合ID]=?',vals+[int(jid)])
  c.commit();return int(jid)
 cur.execute('INSERT INTO [クエリ結合マスタ] ([結合名],[対象データソース],[対象テーブル],'
             '[相手データソース],[相手テーブル],[突合キーJSON],[取り込む列JSON],[接頭辞],'
             '[複数一致],[表示順],[有効],[結合方法],[更新者ID],[登録者ID],[登録日時],[更新日時]) '
             'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',vals+[uid])
 c.commit()
 return int(cur.lastrowid)

def query_join_delete(c,jid):
 """1件消す。**本当に消す**——無効にするだけの行が溜まると、どの結合が
 効いているのかを毎回読んで確かめることになる(有効/無効は別に持つ)。"""
 if QUERY_JOIN_TABLE not in tables(c):return 0
 cur=c.cursor()
 cur.execute('DELETE FROM [クエリ結合マスタ] WHERE [結合ID]=?',[int(jid)])
 n=cur.rowcount;c.commit()
 return n
