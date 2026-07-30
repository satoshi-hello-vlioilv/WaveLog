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
from ..db_access import DBS, connect, ensure_audit_columns, tables

EQUIPMENT_MASTER_TABLE='設備マスタ'
def ensure_equipment_master_table(c):
 names=tables(c);created=False
 if EQUIPMENT_MASTER_TABLE not in names:
  # 制約と索引は別SQLで作成する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [設備マスタ] ([設備ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備マスタ_設備名] ON [設備マスタ] ([設備名])')
  c.commit();created=True
 ensure_audit_columns(c,EQUIPMENT_MASTER_TABLE)
 return created

def normalize_equipment_name(value):
 import unicodedata
 return unicodedata.normalize('NFKC',str(value or '')).strip().upper()

def equipment_master_rows(c):
 ensure_equipment_master_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [設備ID],[設備名],[表示順],[有効],[更新日時],[更新者ID] FROM [設備マスタ] ORDER BY [表示順],[設備名]')
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
 cur.execute('SELECT [オペレータID],[氏名],[表示順],[有効],[更新日時],[更新者ID] FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
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
def ensure_filter_preset_table(c):
 names=tables(c);created=False
 if FILTER_PRESET_TABLE not in names:
  # 設備マスタと同様の方針。条件はJSON文字列として保持し、使用回数は集計用に保持する。
  cur=c.cursor()
  cur.execute('CREATE TABLE [フィルタプリセットマスタ] ([プリセットID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [対象DB] TEXT, [対象テーブル] TEXT, [条件JSON] TEXT, [使用回数] INTEGER, [最終使用日時] DATETIME, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  c.commit();created=True
 ensure_audit_columns(c,FILTER_PRESET_TABLE)
 return created

def filter_preset_rows(c):
 ensure_filter_preset_table(c)
 cur=c.cursor()
 # 全行取得後にPython側で有効判定する(使用回数の多い順で返す)。
 cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[最終使用日時],[有効],[更新日時],[更新者ID] FROM [フィルタプリセットマスタ] ORDER BY [使用回数] DESC,[表示順],[名称]')
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
def ensure_access_permission_table(c):
 names=tables(c);created=False
 if ACCESS_PERMISSION_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [アクセス権限マスタ] ([権限ID] INTEGER PRIMARY KEY AUTOINCREMENT, [ログインID] TEXT, [PC名] TEXT, [編集可否] INTEGER, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_アクセス権限マスタ] ON [アクセス権限マスタ] ([ログインID],[PC名])')
  c.commit();created=True
 ensure_audit_columns(c,ACCESS_PERMISSION_TABLE)
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
 # 全行取得後にPython側で有効判定する。
 cur.execute('SELECT [権限ID],[ログインID],[PC名],[編集可否],[表示順],[有効],[更新日時],[更新者ID] FROM [アクセス権限マスタ] ORDER BY [表示順],[ログインID],[PC名]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[5] is None else bool(r[5])
  if active:rows.append(r)
 return rows

def has_edit_permission(c,login_id,pc_name):
 # ログインID＋PC名の完全一致(表記ゆれ吸収)で照合する。該当行が無ければ
 # 「編集可能」を既定とする(上記コメント参照)。
 if ACCESS_PERMISSION_TABLE not in tables(c):return True
 target_login=normalize_identity_part(login_id);target_pc=normalize_identity_part(pc_name)
 for r in access_permission_master_rows(c):
  if normalize_identity_part(r[1])==target_login and normalize_identity_part(r[2])==target_pc:
   return bool(r[3])
 return True

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
