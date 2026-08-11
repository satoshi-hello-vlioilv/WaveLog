"""master_repo.py: 各種マスタのデータアクセス層。

backend/masters.py から移設。テーブル定義(ensure_*_table)・正規化
(normalize_*_name)・読み取り(*_master_rows/read_*_names)・書き込み補助
(set_operator_equipment/set_hidden_columns)など、リクエスト処理(Flask)に
依存しないデータアクセスをここへ集める。CRUDのルート受付は
backend/routes/masters.py が持つ。

設備マスタ/オペレータマスタ(+作業可能設備)/スプール種別/内径種別/機器マスタ/
フィルタプリセット/列表示(表示マスタ)を提供する。すべてdb/master.sqlite3に保存し、
テーブルが無ければ初回アクセス時に自動作成する。
"""
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
  for name,decl in ((MAX_STRIPS_COLUMN,'INTEGER'),(EQUIPMENT_KIND_COLUMN,'TEXT')):
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

def normalize_equipment_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def equipment_master_rows(c):
 ensure_equipment_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [設備ID],[設備名],[表示順],[有効],[更新日時],[更新者ID],[最大条数],[区分] FROM [設備マスタ] ORDER BY [表示順],[設備名]')
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
EQUIPMENT_NAME_REFERENCES=(
 (OPERATOR_EQUIPMENT_TABLE,'設備名'),
)

def rename_equipment_references(c,old_name,new_name):
 # 設備マスタで改名された設備名を、これを参照する内部マスタ側にも反映する。
 # 正規化一致(表記ゆれ)する既存値のみを新名称へ書き換える。書き換え後に
 # 一意制約へ衝突する場合(改名先の名称が同じ紐付け先へ既に別行として
 # 登録されていた等のデータ不整合)は、そのUPDATEだけ諦めて重複行を
 # 削除する(新名称側の既存行を優先し、古い方は用済みとして片付ける)。
 old_norm=normalize_equipment_name(old_name)
 if not old_norm or old_norm==normalize_equipment_name(new_name):return 0
 total=0
 for table,col in EQUIPMENT_NAME_REFERENCES:
  if table not in tables(c):continue
  cur=c.cursor()
  cur.execute(f'SELECT DISTINCT [{col}] FROM [{table}]')
  for (val,) in cur.fetchall():
   if not val or normalize_equipment_name(val)!=old_norm or str(val)==new_name:continue
   try:
    cur.execute(f'UPDATE [{table}] SET [{col}]=? WHERE [{col}]=?',[new_name,val]);total+=cur.rowcount
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

def ensure_filter_preset_table(c):
 names=tables(c);created=False
 if FILTER_PRESET_TABLE not in names:
  # 設備マスタと同様の方針。条件はJSON文字列として保持し、使用回数は集計用に保持する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタプリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [対象DB] TEXT, [対象テーブル] TEXT, [条件JSON] TEXT, [使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PRESET_TABLE)
 # 既存DBには無い列なので、他のマスタと同じ「無ければALTER TABLEで足す」方式。
 name,decl=_FILTER_PRESET_MODE_COLUMN
 if name not in {r[1] for r in c.cursor().execute(f'PRAGMA table_info([{FILTER_PRESET_TABLE}])')}:
  c.cursor().execute(f'ALTER TABLE [{FILTER_PRESET_TABLE}] ADD COLUMN [{name}] {decl}')
  c.commit()
 return created

def filter_preset_rows(c):
 ensure_filter_preset_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する(使用回数の多い順で返す)。
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[最終使用日時],[有効],[更新日時],[更新者ID],[対象モード] FROM [フィルタプリセットマスタ] ORDER BY [使用回数] DESC,[表示順],[名称]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if active and str(r[1] or '').strip():rows.append(r)
 return rows

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
# 表示マスタ（列表示設定）
#  - 対象DB（仕掛一覧=SIKALOTNOW、品質データ=SIKALOTDEF等、DBS参照）ごとに、
#    どの列を一覧から非表示にするかを管理する。
#  - 行の存在＝非表示。行が無い列は既定で表示（互換ポリシー、他マスタと同じ考え方）。
#    オペレータ設備マスタと同じ「完全同期」方式で保存する。
# ========================================================================
COLUMN_DISPLAY_TABLE='表示マスタ'
def ensure_column_display_table(c):
 names=tables(c);created=False
 if COLUMN_DISPLAY_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [表示マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [対象] TEXT, [列名] TEXT, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_表示マスタ] ON [表示マスタ] ([対象],[列名])')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_DISPLAY_TABLE)
 return created

def hidden_columns_for(c,dbkey):
 # 対象=dbkey の非表示列名の集合を返す。テーブル未作成時は空集合。
 if COLUMN_DISPLAY_TABLE not in tables(c):return set()
 cur=c.cursor();cur.execute('SELECT [列名] FROM [表示マスタ] WHERE [対象]=?',[dbkey])
 return {str(r[0] or '').strip() for r in cur.fetchall() if str(r[0] or '').strip()}

def hidden_columns_for_db(dbkey):
 # api_table() から使う簡易ヘルパー。db/master.sqlite3が未整備/未接続でも
 # 一覧表示自体は継続できるよう、失敗時は空集合（＝全列表示）を返す。
 try:
  path=DBS['MASTER']['path']
  if not path.exists():return set()
  with connect(path,True) as c:
   return hidden_columns_for(c,dbkey)
 except Exception:
  return set()

def set_hidden_columns(c,dbkey,names,uid):
 # 指定対象DBの非表示列を names の内容に完全同期する（増分の追加・削除）。
 ensure_column_display_table(c)
 cur=c.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[列名] FROM [表示マスタ] WHERE [対象]=?',[dbkey])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [表示マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [表示マスタ] ([対象],[列名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',[dbkey,nm,uid,uid])
 c.commit()

# ========================================================================
# スケジュール列表示マスタ（§9.18新設）
#  - 上の表示マスタ(対象=DB単位、行の存在=非表示のブロックリスト)とは
#    軸が異なる: 設備単位(対象=設備名)で、スケジュール画面の分割/ポップ
#    アップ表示(list-view.js renderGrid)にだけ効くアローリスト。
#    行が1件も無い設備=未設定=全列表示（表示マスタ・他マスタと同じ
#    「行が無ければ既定」の互換ポリシー）。表示マスタ(DB全体・常時)と
#    役割が違うため、既存テーブルへ列を足して意味を上書きするのではなく
#    別テーブルにした。
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
#   列表示マスタ … 一覧の横方向に何を見せるか。選ぶ数は多い(10列でも普通)。
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
#      表示マスタ             … DB単位・どの列を隠すか(ブロックリスト)
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

def ensure_column_layout_table(c):
 names=tables(c);created=False
 if COLUMN_LAYOUT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [列レイアウトマスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, '
              '[対象] TEXT, [列名] TEXT, [表示順] INTEGER, [幅] INTEGER, [表示] INTEGER, '
              '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_列レイアウトマスタ] ON [列レイアウトマスタ] ([対象],[列名])')
  c.commit();created=True
 ensure_audit_columns(c,COLUMN_LAYOUT_TABLE)
 # 既存DBへの追加(他マスタと同じ「無ければALTER TABLEで足す」方式)。
 if '表示' not in {r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}:
  c.cursor().execute(f'ALTER TABLE [{COLUMN_LAYOUT_TABLE}] ADD COLUMN [表示] INTEGER')
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
 empty={'order':[],'widths':{},'hidden':[]}
 if COLUMN_LAYOUT_TABLE not in tables(c):return dict(empty)
 target=str(target or '').strip()
 if not target:return dict(empty)
 has_visible='表示' in {r[1] for r in c.cursor().execute(f'PRAGMA table_info([{COLUMN_LAYOUT_TABLE}])')}
 cur=c.cursor()
 cur.execute('SELECT [列名],[表示順],[幅]'+(',[表示]' if has_visible else '')+
             ' FROM [列レイアウトマスタ] WHERE [対象]=? ORDER BY [表示順],[ID]',[target])
 order=[];widths={};hidden=[]
 for row in cur.fetchall():
  name=str(row[0] or '').strip()
  if not name:continue
  order.append(name)
  if row[2] not in (None,''):widths[name]=int(row[2])
  if has_visible and row[3] is not None and not bool(row[3]):hidden.append(name)
 return {'order':order,'widths':widths,'hidden':hidden}

def set_column_layout(c,target,order,widths,uid,hidden=None):
 """全置換方式(他の列マスタと同じ)。渡された順序がそのまま表示順になる。

 **幅だけを変えたいときも並び全体を送る**こと。部分更新にすると、
 並べ替えと幅変更が別々に走ったときにどちらが正か決まらなくなる。"""
 ensure_column_layout_table(c)
 target=str(target or '').strip()
 if not target:raise ValueError('対象を指定してください。')
 widths=widths if isinstance(widths,dict) else {}
 hide={str(x or '').strip() for x in (hidden or []) if str(x or '').strip()}
 cur=c.cursor()
 cur.execute('DELETE FROM [列レイアウトマスタ] WHERE [対象]=?',[target])
 seq=0
 for name in (order or []):
  name=str(name or '').strip()
  if not name:continue
  seq+=1
  cur.execute('INSERT INTO [列レイアウトマスタ] ([対象],[列名],[表示順],[幅],[表示],'
              '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,Now(),Now())',
              [target,name,seq,normalize_column_width(widths.get(name)),
               0 if name in hide else -1,uid,uid])
 # 並びに載っていない列の幅だけが指定されている場合も残す(列が増減しても
 # 幅の記憶が消えないように。表示順は末尾扱いの0にしておく)。
 for name,width in widths.items():
  name=str(name or '').strip()
  if not name or name in (order or []):continue
  w=normalize_column_width(width)
  if w is None:continue
  cur.execute('INSERT INTO [列レイアウトマスタ] ([対象],[列名],[表示順],[幅],[表示],'
              '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,0,?,?,?,?,Now(),Now())',
              [target,name,w,0 if name in hide else -1,uid,uid])
 c.commit()
 return seq


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
