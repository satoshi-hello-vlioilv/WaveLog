"""schedule_repo.py: スケジュール機能(docs/SCHEDULE_MODE_DESIGN.md §5)のデータアクセス層。

backend/repositories/master_repo.py と同じ方針(ensure_*_table・正規化・
CRUD関数)を踏襲するが、対象データは backend/schedule_sync.py が管理する
schedule.sqlite3のローカル作業コピー。排他制御(ロック・改訂番号)は
schedule_sync.pyが持つため、ここでは一切関知しない。各書込関数は
with_write(login_id,pc_name,uid,apply_fn)のapply_fn内から
`schedule_repo.plan_add(c,...)`のように呼ばれる想定で、
渡された接続cへ直接書込むだけでよい(commitはwith_write側がまとめて行う
ため、ここでの各関数はcommitしない。ensure_*_tableの新規作成コミットのみ
例外的に行う。既存のmaster_repo.pyの各ensure_*_tableと同じ扱い)。

5テーブル: 作業予定・稼働カレンダーマスタ・設備停止マスタ・換算係数上書き
マスタ(DBテーブル名は既存互換のため`負荷率上書きマスタ`のまま)・勤務形態マスタ。
時刻展開(稼働カレンダーからのETA計算・実績突合)はschedule_calc.py
(フェーズ3)が持ち、ここでは生データのCRUDのみを提供する。

**保存先の使い分け(重要)**: 共有のschedule.sqlite3に置くのは`作業予定`だけ。
設定系の4マスタ(稼働カレンダー・設備停止・換算係数上書き・勤務形態)は
ローカルのmaster.sqlite3(他のマスタと同じ場所)に置く。作業予定は複数端末が
同時に触る運用データなので共有DBとロックが要るが、設定系マスタはそうではなく、
共有DBに置くと(1)ネットワーク共有が不調だとマスタ管理画面すら開けない
(2)1件の設定変更にも共有DBのロック→取得→適用→反映サイクルが必要で遅い、
という不利益しかなかった。CRUD関数はどれも接続`c`を引数に取るだけなので、
呼び出し側が渡す接続を変えるだけで移せる(関数のシグネチャは変更していない)。
既存データはdb_access側の初回起動時マイグレーションでmaster.sqlite3へ移す。
"""
import json as _json

from ..db_access import tables
from .master_repo import normalize_equipment_name

# ========================================================================
# 作業予定(§5.1)
# ========================================================================
PLAN_TABLE='作業予定'
PLAN_REORDERABLE_STATE='予定'

def ensure_plan_table(c):
 names=tables(c);created=False
 if PLAN_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [作業予定] ([予定ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [表示順] INTEGER, [種別] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, [予定名称] TEXT, [明細JSON] TEXT, [固定開始日時] TEXT, [見積分] REAL, [状態] TEXT, [実績測定ID] TEXT, [備考] TEXT, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_作業予定_設備順] ON [作業予定] ([設備名],[表示順])')
  c.commit();created=True
 return created

def plan_rows(c,equipment=None,include_inactive=False):
 ensure_plan_table(c)
 cur=c.cursor()
 cur.execute('SELECT [予定ID],[設備名],[表示順],[種別],[ロット番号],[検査番号],[鋳造番号],[予定名称],[明細JSON],[固定開始日時],[見積分],[状態],[実績測定ID],[備考],[有効],[登録日時],[更新日時],[更新者ID] FROM [作業予定] ORDER BY [設備名],[表示順]')
 target=normalize_equipment_name(equipment) if equipment else ''
 rows=[]
 for r in cur.fetchall():
  active=True if r[14] is None else bool(r[14])
  if not active and not include_inactive:continue
  if target and normalize_equipment_name(r[1])!=target:continue
  rows.append(r)
 return rows

def plan_row(c,plan_id):
 ensure_plan_table(c)
 cur=c.cursor()
 cur.execute('SELECT [予定ID],[設備名],[表示順],[種別],[ロット番号],[検査番号],[鋳造番号],[予定名称],[明細JSON],[固定開始日時],[見積分],[状態],[実績測定ID],[備考],[有効],[登録日時],[更新日時],[更新者ID] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 return cur.fetchone()

def _next_plan_order(c,equipment):
 cur=c.cursor()
 cur.execute('SELECT Max([表示順]) FROM [作業予定] WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0)',[equipment])
 return int(cur.fetchone()[0] or 0)+1

def plan_add(c,equipment,kind,uid,position='end',lot_no='',inspection_no='',casting_no='',title='',detail=None,stop_reason_id=None,estimate_minutes=None,fixed_start=None,remark=''):
 # §8.2。kind='作業'はdetail(仕掛行スナップショット、辞書)をそのままJSON化して
 # 持つ(サーバー側で仕掛を引き直さない。フロントが送った時点の見え方を固定)。
 # kind='設備停止'はstopReasonIdから設備停止マスタの[名称]をスナップショットし、
 # マスタ行の[設備名]がリクエストのequipmentと一致しなければ拒否する(§5.3、
 # 他設備の停止理由IDの誤流用を防ぐ)。
 ensure_plan_table(c)
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 if kind not in ('作業','設備停止'):raise ValueError('種別は作業または設備停止を指定してください。')
 cur=c.cursor()
 title_snapshot=str(title or '').strip();detail_json='';est=estimate_minutes
 if kind=='設備停止':
  if not stop_reason_id:raise ValueError('設備停止の予定には停止理由(stopReasonId)を指定してください。')
  # 設備停止マスタはmaster.sqlite3側にあるため、共有DBの接続cではなく
  # 設定系マスタ接続から引く(保存先を移したときの取りこぼし注意点)。
  mc=config_master_conn()
  try:
   mcur=mc.cursor()
   mcur.execute('SELECT [設備名],[名称],[標準所要分] FROM [設備停止マスタ] WHERE [停止理由ID]=?',[stop_reason_id])
   row=mcur.fetchone()
  finally:
   mc.close()
  if not row:raise ValueError('指定の設備停止理由が見つかりません。')
  if normalize_equipment_name(row[0])!=normalize_equipment_name(equipment):
   raise ValueError('指定の停止理由は別の設備に登録されています。')
  title_snapshot=str(row[1] or '').strip()
  # [見積分]はestimate_minutes(明示上書き)が無ければNULLのままにする(§5.1)。
  # マスタの標準所要分は固定値としてここでスナップショットしない。マスタの
  # 標準所要分を後から編集したら、まだ見積を上書きしていない予定には反映
  # させたいため、解決はschedule_calc.py(フェーズ3)の展開時に(設備名,
  # 予定名称)で毎回引き直す
  lot_no=inspection_no=casting_no=''
 else:
  detail_json=_json.dumps(detail or {},ensure_ascii=False)
 if position=='start':
  # 未着手([状態]='予定')の予定より前には出せない(着手中・完了・取消は
  # 既に確定した並びのため動かさない、plan_reorderと同じ不変条件)。
  cur.execute('SELECT Max([表示順]) FROM [作業予定] WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0) AND ([状態] IS NOT NULL AND [状態]<>?)',[equipment,PLAN_REORDERABLE_STATE])
  fixed_max=int(cur.fetchone()[0] or 0)
  cur.execute('UPDATE [作業予定] SET [表示順]=[表示順]+1 WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0) AND ([状態] IS NULL OR [状態]=?)',[equipment,PLAN_REORDERABLE_STATE])
  order=fixed_max+1
 else:
  order=_next_plan_order(c,equipment)
 cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[検査番号],[鋳造番号],[予定名称],[明細JSON],[固定開始日時],[見積分],[状態],[備考],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
             [equipment,order,kind,lot_no,inspection_no,casting_no,title_snapshot,detail_json,fixed_start,est,PLAN_REORDERABLE_STATE,remark,uid,uid])
 return cur.lastrowid

_PLAN_UPDATE_FIELDS={'estimateMinutes':'見積分','fixedStart':'固定開始日時','remark':'備考','state':'状態'}

def plan_update(c,plan_id,uid,**fields):
 ensure_plan_table(c)
 cur=c.cursor()
 cur.execute('SELECT [予定ID] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 if not cur.fetchone():raise ValueError('指定の予定が見つかりません。')
 sets=[];params=[]
 for key,col in _PLAN_UPDATE_FIELDS.items():
  if key in fields:
   sets.append(f'[{col}]=?');params.append(fields[key])
 if not sets:return 0
 params+=[uid,plan_id]
 cur.execute(f'UPDATE [作業予定] SET {",".join(sets)},[更新者ID]=?,[更新日時]=Now() WHERE [予定ID]=?',params)
 return cur.rowcount

def plan_delete(c,plan_id,uid):
 ensure_plan_table(c)
 cur=c.cursor()
 cur.execute('UPDATE [作業予定] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [予定ID]=?',[uid,plan_id])
 return cur.rowcount

def plan_reorder(c,equipment,ordered_ids,uid,reorderable_ids=None):
 # §5.1.1・§7.5。未着手(実質的に「予定」状態)の予定だけが並べ替え対象。
 # 着手中・完了・取消の予定は物理的な作業順序として既に確定しているため
 # 動かせない(実運用では常に「これから」の作業が「済み」の後ろに来る)。
 # ordered_idsは対象の全件と過不足なく一致する必要がある(部分並べ替えは
 # 一貫性を崩すため受け付けない)。対象外(確定済み)行の[表示順]の直後から
 # 1..Nを振り直すことで、確定済みの並びを一切動かさずに済む。
 #
 # reorderable_ids: 呼び出し元(backend/routes/schedule.py)がschedule_calc.
 # expand_plan()の実績突合込みの導出状態(§7.4)から計算した「実質的に予定」
 # なIDの集合。渡されなければ、DBの[状態]列だけを見た簡易判定にフォール
 # バックする(schedule_calc抜きの直接呼び出し・単体テスト向け。実績突合が
 # 絡む本番の並べ替えでは必ずreorderable_idsを渡すこと)。
 ensure_plan_table(c)
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 cur=c.cursor()
 cur.execute('SELECT [予定ID],[表示順],[状態] FROM [作業予定] WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0)',[equipment])
 active_rows=cur.fetchall()
 if reorderable_ids is None:
  reorderable={r[0] for r in active_rows if (r[2] or PLAN_REORDERABLE_STATE)==PLAN_REORDERABLE_STATE}
 else:
  reorderable=set(reorderable_ids)
 fixed_orders=[r[1] or 0 for r in active_rows if r[0] not in reorderable]
 given=list(ordered_ids or [])
 if len(set(given))!=len(given):raise ValueError('並べ替え対象に重複があります。')
 if set(given)!=reorderable:raise ValueError('並べ替え対象が現在の未着手予定と一致しません(追加・削除の直後は最新の一覧を取得し直してください)。')
 base=max(fixed_orders) if fixed_orders else 0
 for idx,pid in enumerate(given,start=1):
  cur.execute('UPDATE [作業予定] SET [表示順]=?,[更新者ID]=?,[更新日時]=Now() WHERE [予定ID]=?',[base+idx,uid,pid])
 return len(given)

# ========================================================================
# 稼働カレンダーマスタ(§5.2)
# ========================================================================
CALENDAR_TABLE='稼働カレンダーマスタ'

def ensure_calendar_table(c):
 names=tables(c);created=False
 if CALENDAR_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [稼働カレンダーマスタ] ([カレンダーID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [区分] TEXT, [曜日] INTEGER, [日付] TEXT, [稼働] INTEGER, [開始時刻] TEXT, [終了時刻] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_稼働カレンダーマスタ_設備] ON [稼働カレンダーマスタ] ([設備名])')
  c.commit();created=True
 return created

def calendar_rows(c,equipment=None):
 # equipment未指定なら全設備既定([設備名]='')・指定ありならその設備専用行のみ。
 # 適用時の優先順位(特異日>設備別の曜日>全設備既定)の解決はschedule_calc.py側で行う。
 ensure_calendar_table(c)
 cur=c.cursor()
 cur.execute('SELECT [カレンダーID],[設備名],[区分],[曜日],[日付],[稼働],[開始時刻],[終了時刻],[表示順],[有効] FROM [稼働カレンダーマスタ] ORDER BY [設備名],[区分],[曜日],[日付],[表示順]')
 target=normalize_equipment_name(equipment) if equipment else ''
 rows=[]
 for r in cur.fetchall():
  active=True if r[9] is None else bool(r[9])
  if not active:continue
  if normalize_equipment_name(r[1])!=target:continue
  rows.append(r)
 return rows

def calendar_sync(c,equipment,entries,uid):
 # §8のPOST /api/schedule/calendar(完全同期)。曜日×複数行(2交替等)の
 # 組み合わせは単純な列名の集合では一意化できないため、対象スコープ
 # (equipment、空文字は全設備既定)の既存行を全削除してentriesを丸ごと
 # 作り直す(表示マスタ等の「増分diff」方式ではなく、set_hidden_columnsより
 # 単純な全置換方式を採る)。
 ensure_calendar_table(c)
 equipment=str(equipment or '').strip()
 cur=c.cursor()
 cur.execute('DELETE FROM [稼働カレンダーマスタ] WHERE [設備名]=?',[equipment])
 count=0
 for e in (entries or []):
  kind=str(e.get('kind') or '').strip()
  if kind not in ('曜日','特異日'):raise ValueError('区分は曜日または特異日を指定してください。')
  count+=1
  weekday=e.get('weekday') if kind=='曜日' else None
  date=str(e.get('date') or '').strip() if kind=='特異日' else None
  cur.execute('INSERT INTO [稼働カレンダーマスタ] ([設備名],[区分],[曜日],[日付],[稼働],[開始時刻],[終了時刻],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
              [equipment,kind,weekday,date,1 if e.get('active',True) else 0,str(e.get('start') or '').strip(),str(e.get('end') or '').strip(),count*10,uid,uid])
 return count

# ========================================================================
# 設備停止分類マスタ(§5.3.1)
#  設備停止マスタの[分類]の選択肢。**分類は全設備共通**(設備ごとに分類体系が
#  違うと、設備をまたいだ集計・色分けができなくなるため)。設備停止マスタは
#  従来どおり設備ごとの行を持ち、分類だけをこのマスタから引く。
#  以前は画面側に'保全/段取り/待ち/突発'をハードコードしていたため、現場で
#  使いたい分類を足すのにコード修正が要った。
# ========================================================================
STOP_CATEGORY_TABLE='設備停止分類マスタ'
# 初回作成時に入れておく分類(従来ハードコードしていた4つ)。既存の設備停止
# マスタに別の分類が入っていれば、それも同時に取り込む(下の移行処理)。
STOP_CATEGORY_SEEDS=('保全','段取り','待ち','突発')

def ensure_stop_category_table(c):
 names=tables(c);created=False
 if STOP_CATEGORY_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [設備停止分類マスタ] ([分類ID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [色キー] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備停止分類マスタ_名称] ON [設備停止分類マスタ] ([名称])')
  c.commit();created=True
  _seed_stop_categories(c)
 return created

def _seed_stop_categories(c):
 """初回作成時だけ走る移行。既定の4分類と、既に設備停止マスタで使われている
 分類を取り込む(空欄で作ると、既存データの分類が選択肢から消えてしまう)。"""
 seen=[]
 for name in STOP_CATEGORY_SEEDS:
  if name not in seen:seen.append(name)
 try:
  if STOP_REASON_TABLE in tables(c):
   cur=c.cursor()
   cur.execute('SELECT DISTINCT [分類] FROM [設備停止マスタ]')
   for (v,) in cur.fetchall():
    v=str(v or '').strip()
    if v and v not in seen:seen.append(v)
 except Exception:
  pass  # 取り込めなくても既定の4分類だけで動く
 cur=c.cursor()
 for i,name in enumerate(seen):
  cur.execute('INSERT INTO [設備停止分類マスタ] ([名称],[色キー],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',
              [name,'',(i+1)*10,'migrate:seed','migrate:seed'])
 c.commit()

def stop_category_rows(c):
 ensure_stop_category_table(c)
 cur=c.cursor()
 cur.execute('SELECT [分類ID],[名称],[色キー],[表示順],[有効],[更新日時],[更新者ID] FROM [設備停止分類マスタ] ORDER BY [表示順],[名称]')
 return [r for r in cur.fetchall() if (True if r[4] is None else bool(r[4]))]

def stop_category_names(c):
 return [str(r[1] or '').strip() for r in stop_category_rows(c) if str(r[1] or '').strip()]

def stop_category_upsert(c,name,uid,color_key='',category_id=None):
 """分類の登録・改名。名称が自然キー(全設備共通なので設備名は持たない)。
 category_idを渡した場合はその行の改名として扱う(他マスタと同じリネーム更新)。"""
 ensure_stop_category_table(c)
 name=str(name or '').strip()
 if not name:raise ValueError('分類名を入力してください。')
 cur=c.cursor()
 cur.execute('SELECT [分類ID],[名称],[有効] FROM [設備停止分類マスタ]')
 rows=cur.fetchall()
 same=next((r for r in rows if str(r[1] or '').strip()==name),None)
 if category_id is not None:
  # 改名。改名先の名前が別IDで既に使われていれば拒否する(UNIQUE制約と同じ)。
  if same and same[0]!=category_id:raise ValueError(f'分類「{name}」は既に登録されています。')
  cur.execute('UPDATE [設備停止分類マスタ] SET [名称]=?,[色キー]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [分類ID]=?',
              [name,color_key,uid,category_id])
  if cur.rowcount==0:raise ValueError('指定の分類が見つかりません。')
  return category_id,False
 if same:
  # 既にある(無効化されていたものも含む)。有効へ戻すだけで新規行は作らない。
  cur.execute('UPDATE [設備停止分類マスタ] SET [色キー]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [分類ID]=?',
              [color_key,uid,same[0]])
  return same[0],False
 cur.execute('SELECT Max([表示順]) FROM [設備停止分類マスタ]')
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [設備停止分類マスタ] ([名称],[色キー],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',
             [name,color_key,order,uid,uid])
 return cur.lastrowid,True

def stop_category_delete(c,category_id,uid):
 ensure_stop_category_table(c)
 cur=c.cursor()
 cur.execute('UPDATE [設備停止分類マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [分類ID]=?',[uid,category_id])
 return cur.rowcount

def stop_category_usage(c,category_id):
 """この分類を使っている設備停止マスタの行数(削除前の確認用)。"""
 ensure_stop_category_table(c)
 cur=c.cursor()
 cur.execute('SELECT [名称] FROM [設備停止分類マスタ] WHERE [分類ID]=?',[category_id])
 row=cur.fetchone()
 if not row:return None,0
 name=str(row[0] or '').strip()
 if STOP_REASON_TABLE not in tables(c):return name,0
 cur.execute('SELECT [分類],[有効] FROM [設備停止マスタ]')
 n=0
 for cat,active in cur.fetchall():
  if (True if active is None else bool(active)) and str(cat or '').strip()==name:n+=1
 return name,n

# ========================================================================
# 設備停止マスタ(§5.3)
# ========================================================================
STOP_REASON_TABLE='設備停止マスタ'

def ensure_stop_reason_table(c):
 names=tables(c);created=False
 if STOP_REASON_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [設備停止マスタ] ([停止理由ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [分類] TEXT, [名称] TEXT, [標準所要分] REAL, [色キー] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備停止マスタ_名称] ON [設備停止マスタ] ([設備名],[名称])')
  c.commit();created=True
 return created

def stop_reason_rows(c,equipment=None):
 ensure_stop_reason_table(c)
 cur=c.cursor()
 cur.execute('SELECT [停止理由ID],[設備名],[分類],[名称],[標準所要分],[色キー],[表示順],[有効],[更新日時],[更新者ID] FROM [設備停止マスタ] ORDER BY [設備名],[表示順],[名称]')
 target=normalize_equipment_name(equipment) if equipment else ''
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if not active:continue
  if target and normalize_equipment_name(r[1])!=target:continue
  rows.append(r)
 return rows

def stop_reason_upsert(c,equipment,name,uid,category='',standard_minutes=None,color_key=''):
 # §5.3。設備名は必須(空なら拒否、他マスタの必須チェックと同じ方式)。
 # (設備名,名称)の一意組で自然キー照合し、既存なら更新・無ければ新規登録する
 # (backend/routes/masters.pyのaccess_permission_master_registerと同じ方式)。
 ensure_stop_reason_table(c)
 equipment=str(equipment or '').strip();name=str(name or '').strip()
 if not equipment:raise ValueError('設備名を入力してください。')
 if not name:raise ValueError('名称を入力してください。')
 # 分類は設備停止分類マスタ(§5.3.1)へ自動で登録する。分類の選択肢を増やす
 # ためだけに別画面へ移動させないための連動(未登録の分類を入力したら、その場で
 # マスタにも増える)。空欄(分類なし)は登録しない。
 category=str(category or '').strip()
 if category:stop_category_upsert(c,category,uid)
 cur=c.cursor()
 # 設備名は表記ゆれを吸収して照合する(他の設備名参照と同じ方式)。名称は
 # UNIQUE INDEXの実体に合わせて完全一致(前後空白除去のみ)で照合する。
 cur.execute('SELECT [停止理由ID],[設備名],[名称] FROM [設備停止マスタ]')
 target_eq=normalize_equipment_name(equipment)
 existing_row=next((r for r in cur.fetchall() if normalize_equipment_name(r[1])==target_eq and str(r[2] or '').strip()==name),None)
 existing=(existing_row[0],) if existing_row else None
 if existing:
  cur.execute('UPDATE [設備停止マスタ] SET [分類]=?,[標準所要分]=?,[色キー]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [停止理由ID]=?',
              [category,standard_minutes,color_key,uid,existing[0]])
  return existing[0],False
 cur.execute('SELECT Max([表示順]) FROM [設備停止マスタ] WHERE [設備名]=?',[equipment])
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [設備停止マスタ] ([設備名],[分類],[名称],[標準所要分],[色キー],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,-1,?,?,Now(),Now())',
             [equipment,category,name,standard_minutes,color_key,order,uid,uid])
 return cur.lastrowid,True

def stop_reason_delete(c,stop_reason_id,uid):
 ensure_stop_reason_table(c)
 cur=c.cursor()
 cur.execute('UPDATE [設備停止マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [停止理由ID]=?',[uid,stop_reason_id])
 return cur.rowcount

def stop_reason_standard_minutes(c,equipment,name):
 # §5.1: 設備停止の予定は[見積分]がNULLなら、追加時点ではなく展開の都度
 # このマスタの現在値を引く(スナップショットしない。plan_addのコメント参照)。
 # 予定側にはstopReasonIdの参照列が無いため、(設備名,名称)の自然キーで
 # 引き直す(設備名は表記ゆれ吸収、名称は完全一致。stop_reason_upsertと同じ方式)。
 ensure_stop_reason_table(c)
 cur=c.cursor()
 cur.execute('SELECT [設備名],[名称],[標準所要分],[有効] FROM [設備停止マスタ]')
 target_eq=normalize_equipment_name(equipment);target_name=str(name or '').strip()
 for eq,nm,minutes,active in cur.fetchall():
  active=True if active is None else bool(active)
  if active and normalize_equipment_name(eq)==target_eq and str(nm or '').strip()==target_name:
   return minutes
 return None

# ========================================================================
# 換算係数上書きマスタ(§5.4、DBテーブル名は既存互換のため`負荷率上書きマスタ`のまま)
#  - テーブル定義のみフェーズ2で用意する。算出・上書きAPI・見積内訳は
#    backend/load_factor.py(フェーズ5、未実装)が持つ。
# ========================================================================
LOAD_FACTOR_OVERRIDE_TABLE='負荷率上書きマスタ'

def ensure_load_factor_override_table(c):
 names=tables(c);created=False
 if LOAD_FACTOR_OVERRIDE_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [負荷率上書きマスタ] ([上書きID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [因子] TEXT, [水準] TEXT, [係数] REAL, [理由] TEXT, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_負荷率上書き] ON [負荷率上書きマスタ] ([設備名],[因子],[水準])')
  c.commit();created=True
 return created

def load_factor_override_rows(c,equipment=None):
 # §5.4。設備名は空文字が「全設備共通」の意味を持つため、他マスタと違い
 # normalize_equipment_nameでの絞り込みはしない(呼び出し側で設備別/全体
 # 共通の両方を必要に応じて引く。load_factor.pyのresolve_overrides参照)。
 ensure_load_factor_override_table(c)
 cur=c.cursor()
 cur.execute('SELECT [上書きID],[設備名],[因子],[水準],[係数],[理由],[有効],[更新日時],[更新者ID] FROM [負荷率上書きマスタ] ORDER BY [設備名],[因子],[水準]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[6] is None else bool(r[6])
  if not active:continue
  if equipment is not None and str(r[1] or '').strip()!=str(equipment or '').strip():continue
  rows.append(r)
 return rows

def load_factor_override_upsert(c,equipment,factor,level,uid,coefficient=None,reason=''):
 # 因子='BASE'のときは[水準]は空文字固定(§5.4「因子='BASE'のときは空」)。
 ensure_load_factor_override_table(c)
 equipment=str(equipment or '').strip();factor=str(factor or '').strip();level='' if factor=='BASE' else str(level or '').strip()
 if not factor:raise ValueError('因子を指定してください。')
 cur=c.cursor()
 cur.execute('SELECT [上書きID] FROM [負荷率上書きマスタ] WHERE [設備名]=? AND [因子]=? AND [水準]=?',[equipment,factor,level])
 existing=cur.fetchone()
 if existing:
  cur.execute('UPDATE [負荷率上書きマスタ] SET [係数]=?,[理由]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [上書きID]=?',
              [coefficient,reason,uid,existing[0]])
  return existing[0],False
 cur.execute('INSERT INTO [負荷率上書きマスタ] ([設備名],[因子],[水準],[係数],[理由],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',
             [equipment,factor,level,coefficient,reason,uid,uid])
 return cur.lastrowid,True

def load_factor_override_delete(c,override_id,uid):
 ensure_load_factor_override_table(c)
 cur=c.cursor()
 cur.execute('UPDATE [負荷率上書きマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [上書きID]=?',[uid,override_id])
 return cur.rowcount

def base_minutes_override(c,equipment):
 # §6.1のT0(基準時間)。因子='BASE'(水準は空)の行を設備別優先で読む。
 # フェーズ5(load_factor.py)が実績から自動算出するまでの間、
 # schedule_calc.pyの「一律見積(係数1.0)」はこの値(無ければ既定値)を使う。
 ensure_load_factor_override_table(c)
 cur=c.cursor()
 cur.execute("SELECT [設備名],[係数],[有効] FROM [負荷率上書きマスタ] WHERE [因子]='BASE'")
 rows=[r for r in cur.fetchall() if (True if r[2] is None else bool(r[2]))]
 target=normalize_equipment_name(equipment)
 specific=next((r[1] for r in rows if normalize_equipment_name(r[0])==target and target),None)
 if specific is not None:return specific
 global_row=next((r[1] for r in rows if not str(r[0] or '').strip()),None)
 return global_row

# ========================================================================
# 勤務形態マスタ(§5.5新設)
#  - 時刻(HH:MM)の範囲と勤務名称の対応表。稼働カレンダーマスタ(§5.2)と
#    同じ設計方針: [設備名]が空文字なら全設備既定、指定ありならその設備
#    専用行。適用時の優先順位(設備別>全設備既定)の解決はschedule_calc.py
#    側で行う(稼働カレンダーマスタのworking_slots_for_dateと同じ構造)。
#    終了時刻<=開始時刻は日跨ぎ勤務として扱う(例: 23:00〜07:00の3直)。
# ========================================================================
SHIFT_TABLE='勤務形態マスタ'          # 旧・フラット構造(移行元としてのみ参照)
SHIFT_PATTERN_TABLE='勤務体系マスタ'   # 親: 日勤 / 交替勤務(1,2,3直) など
SHIFT_SEGMENT_TABLE='勤務区分マスタ'   # 子: 1直 7:00-15:00 など

def ensure_shift_table(c):
 """旧フラット構造。移行元として読むだけなので、無ければ作るだけで使わない。"""
 names=tables(c);created=False
 if SHIFT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [勤務形態マスタ] ([勤務ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [名称] TEXT, [開始時刻] TEXT, [終了時刻] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_勤務形態マスタ_設備] ON [勤務形態マスタ] ([設備名])')
  c.commit();created=True
 return created

def ensure_shift_pattern_tables(c):
 """勤務体系(親)と勤務区分(子)の2テーブル。
 現場の言い方に合わせた2階層にする:
   日勤              -> 日勤 8:15-17:05
   交替勤務(1,2,3直) -> 1直 7:00-15:00 / 2直 15:00-23:00 / 3直 23:00-翌7:00
   交替勤務(4,5直)   -> 4直 11:00-19:10 / 5直 21:20-翌5:45
 以前は「名称+開始+終了」のフラットな1テーブルだったため、どの直が
 どの勤務体系に属するのかを表現できず、体系ごと切り替えることもできなかった。
 [適用設備]は他のマスタと同じ規約で、空文字=全設備既定・設備名指定=その設備専用。"""
 names=tables(c);created=False
 if SHIFT_PATTERN_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [勤務体系マスタ] ([勤務体系ID] INTEGER PRIMARY KEY AUTOINCREMENT, [適用設備] TEXT, [名称] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_勤務体系マスタ_設備] ON [勤務体系マスタ] ([適用設備])')
  c.commit();created=True
 if SHIFT_SEGMENT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [勤務区分マスタ] ([勤務区分ID] INTEGER PRIMARY KEY AUTOINCREMENT, [勤務体系ID] INTEGER, [名称] TEXT, [開始時刻] TEXT, [終了時刻] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_勤務区分マスタ_体系] ON [勤務区分マスタ] ([勤務体系ID])')
  c.commit();created=True
 if SHIFT_PATTERN_EQUIPMENT_TABLE not in names:
  cur=c.cursor()
  cur.execute('CREATE TABLE [勤務体系設備マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [勤務体系ID] INTEGER, [設備名] TEXT, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_勤務体系設備マスタ] ON [勤務体系設備マスタ] ([勤務体系ID],[設備名])')
  c.commit();created=True
 _migrate_shift_pattern_equipment(c)
 return created

# ------------------------------------------------------------------------
# 勤務体系の適用設備(複数)
#  1つの勤務体系を複数設備へ割り当てたいという要望に対応するため、
#  単一値だった[適用設備]列から子テーブルへ移した(オペレータ設備マスタと
#  同じ方式)。**割当が0件 = 全設備既定**で、旧仕様の「空文字=全設備既定」を
#  そのまま引き継ぐ。移行後は[適用設備]列を読まない(単一の情報源にするため、
#  移行時に空へ更新して残骸を残さない)。
# ------------------------------------------------------------------------
SHIFT_PATTERN_EQUIPMENT_TABLE='勤務体系設備マスタ'
_SHIFT_PATTERN_EQUIPMENT_MIGRATED=False

def _migrate_shift_pattern_equipment(c):
 """旧[適用設備](単一値)を子テーブルへ1回だけ移す。"""
 global _SHIFT_PATTERN_EQUIPMENT_MIGRATED
 if _SHIFT_PATTERN_EQUIPMENT_MIGRATED:return
 try:
  cur=c.cursor()
  cur.execute('SELECT [勤務体系ID],[適用設備] FROM [勤務体系マスタ]')
  pending=[(pid,str(eq or '').strip()) for pid,eq in cur.fetchall() if str(eq or '').strip()]
  for pid,eq in pending:
   cur.execute('SELECT COUNT(*) FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?',[pid])
   if int(cur.fetchone()[0] or 0):continue
   cur.execute('INSERT INTO [勤務体系設備マスタ] ([勤務体系ID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',
               [pid,eq,'migrate:shift-equipment','migrate:shift-equipment'])
   cur.execute('UPDATE [勤務体系マスタ] SET [適用設備]=? WHERE [勤務体系ID]=?',['',pid])
  if pending:c.commit()
  _SHIFT_PATTERN_EQUIPMENT_MIGRATED=True
 except Exception:
  pass   # 移行できなくても、子テーブルが空=全設備既定として動く

def shift_pattern_equipment_map(c):
 """{勤務体系ID: [設備名, ...]}。割当の無い体系はキー自体が無い(=全設備既定)。"""
 ensure_shift_pattern_tables(c)
 cur=c.cursor()
 cur.execute('SELECT [勤務体系ID],[設備名] FROM [勤務体系設備マスタ] ORDER BY [設備名]')
 out={}
 for pid,name in cur.fetchall():
  nm=str(name or '').strip()
  if nm:out.setdefault(pid,[]).append(nm)
 return out

def set_shift_pattern_equipment(c,pattern_id,names,uid):
 """指定体系の適用設備を names の内容へ完全同期する(増分の追加・削除)。"""
 ensure_shift_pattern_tables(c)
 cur=c.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[設備名] FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?',[pattern_id])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [勤務体系設備マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [勤務体系設備マスタ] ([勤務体系ID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',
               [pattern_id,nm,uid,uid])

def shift_pattern_rows(c,equipment=None):
 """勤務体系の一覧。equipment指定時はその設備が割当に含まれる体系、
 未指定なら割当0件の体系(=全設備既定)。equipment='__all__'で全件。"""
 ensure_shift_pattern_tables(c)
 cur=c.cursor()
 cur.execute('SELECT [勤務体系ID],[適用設備],[名称],[表示順],[有効] FROM [勤務体系マスタ] ORDER BY [表示順],[勤務体系ID]')
 rows=[r for r in cur.fetchall() if (True if r[4] is None else bool(r[4]))]
 if equipment=='__all__':return rows
 assigned=shift_pattern_equipment_map(c)
 if not equipment:
  # 全設備既定 = どの設備にも割り当てていない体系
  return [r for r in rows if not assigned.get(r[0])]
 target=normalize_equipment_name(equipment)
 return [r for r in rows
         if any(normalize_equipment_name(n)==target for n in assigned.get(r[0],[]))]

def shift_segment_rows(c,pattern_id):
 ensure_shift_pattern_tables(c)
 cur=c.cursor()
 cur.execute('SELECT [勤務区分ID],[勤務体系ID],[名称],[開始時刻],[終了時刻],[表示順],[有効] FROM [勤務区分マスタ] WHERE [勤務体系ID]=? ORDER BY [表示順],[勤務区分ID]',[pattern_id])
 return [r for r in cur.fetchall() if (True if r[6] is None else bool(r[6]))]

def shift_rows(c,equipment=None):
 """勤務名称の解決に使う勤務区分の一覧。
 **戻り値のタプル形は旧フラット構造のまま**
 (勤務ID,設備名,名称,開始時刻,終了時刻,表示順,有効)にしてある。
 schedule_calc.resolve_shift_label()は形しか見ないため、階層化しても
 あちらは無改修で済む(呼び出し規約: equipment未指定=全設備既定)。
 該当設備の勤務体系が複数あれば表示順で最初の1件を使う。"""
 migrate_shift_patterns(c)
 patterns=shift_pattern_rows(c,equipment)
 if not patterns:return []
 # [適用設備]列は移行済みで空。呼び出し元が渡した設備名をそのまま載せる
 # (resolve_shift_label()は形しか見ないが、意味のある値を入れておく)。
 pid=patterns[0][0]
 eq=str(equipment or '')
 return [(r[0],eq,r[2],r[3],r[4],r[5],r[6]) for r in shift_segment_rows(c,pid)]

def shift_pattern_upsert(c,pattern_id,equipment,name,uid):
 """equipmentは設備名のリスト(複数可)。空リスト=全設備既定。
 互換のため単一の文字列を渡された場合も1件のリストとして扱う。"""
 ensure_shift_pattern_tables(c)
 if isinstance(equipment,str):equipment=[equipment] if equipment.strip() else []
 names=[str(n).strip() for n in (equipment or []) if str(n or '').strip()]
 name=str(name or '').strip()
 if not name:raise ValueError('勤務体系の名称を入力してください。')
 cur=c.cursor()
 if pattern_id:
  # [適用設備]列は移行済みで読まれない。単一の情報源を保つため空のまま更新する。
  cur.execute('UPDATE [勤務体系マスタ] SET [適用設備]=?,[名称]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [勤務体系ID]=?',['',name,uid,pattern_id])
  if cur.rowcount==0:raise ValueError('指定の勤務体系が見つかりません。')
  set_shift_pattern_equipment(c,pattern_id,names,uid)
  return pattern_id,False
 cur.execute('SELECT Max([表示順]) FROM [勤務体系マスタ]')
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [勤務体系マスタ] ([適用設備],[名称],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',['',name,order,uid,uid])
 new_id=cur.lastrowid
 set_shift_pattern_equipment(c,new_id,names,uid)
 return new_id,True

def shift_pattern_delete(c,pattern_id,uid):
 ensure_shift_pattern_tables(c)
 cur=c.cursor()
 cur.execute('UPDATE [勤務体系マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [勤務体系ID]=?',[uid,pattern_id])
 # 「何件消せたか」は**この無効化の結果**。あとに続くDELETEでcur.rowcountが
 # 上書きされるため、ここで確定させておく(呼び出し元は0を「対象が無い」と
 # 見なすので、割当0件の体系=全設備共通が削除できない不具合になっていた)。
 deleted=cur.rowcount
 # 無効化した体系の設備割当は残さない(再登録したときに古い割当が復活しないよう)
 cur.execute('DELETE FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?',[pattern_id])
 return deleted

_TIME_RE=None
def _valid_hm(v):
 global _TIME_RE
 if _TIME_RE is None:
  import re as _re;_TIME_RE=_re.compile(r'^([01]?\d|2[0-3]):[0-5]\d$')
 return bool(_TIME_RE.match(str(v or '').strip()))

def shift_segment_sync(c,pattern_id,segments,uid):
 """勤務区分を渡された内容へ完全同期する(稼働カレンダーcalendar_syncと同じ
 全置換方式)。渡された順序がそのまま表示順になる。"""
 ensure_shift_pattern_tables(c)
 if not pattern_id:raise ValueError('勤務体系を指定してください。')
 cleaned=[]
 for seg in (segments or []):
  name=str((seg or {}).get('name') or '').strip()
  start=str((seg or {}).get('start') or '').strip()
  end=str((seg or {}).get('end') or '').strip()
  if not name:raise ValueError('勤務区分の名称を入力してください。')
  if not _valid_hm(start) or not _valid_hm(end):
   raise ValueError(f'「{name}」の時刻はHH:MM(00:00〜23:59)で指定してください。')
  if start==end:raise ValueError(f'「{name}」の開始時刻と終了時刻が同じです。')
  cleaned.append((name,start,end))
 cur=c.cursor()
 cur.execute('DELETE FROM [勤務区分マスタ] WHERE [勤務体系ID]=?',[pattern_id])
 for i,(name,start,end) in enumerate(cleaned,start=1):
  cur.execute('INSERT INTO [勤務区分マスタ] ([勤務体系ID],[名称],[開始時刻],[終了時刻],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',
              [pattern_id,name,start,end,i*10,uid,uid])
 return len(cleaned)

_shift_migration_done=False
def migrate_shift_patterns(c):
 """旧フラット勤務形態マスタ -> 勤務体系/勤務区分 への一度きりの移行。
 設備ごとに1つの勤務体系へまとめる(どの直が同じ体系かは旧構造では
 表現されていなかったため、設備単位でまとめる以上の推測はしない)。"""
 global _shift_migration_done
 if _shift_migration_done:return
 ensure_shift_pattern_tables(c)
 try:
  if SHIFT_TABLE not in tables(c):
   _shift_migration_done=True;return
  cur=c.cursor()
  cur.execute('SELECT COUNT(*) FROM [勤務体系マスタ]')
  if int(cur.fetchone()[0] or 0)>0:
   _shift_migration_done=True;return
  cur.execute('SELECT [設備名],[名称],[開始時刻],[終了時刻],[表示順],[有効] FROM [勤務形態マスタ] ORDER BY [設備名],[表示順]')
  old=[r for r in cur.fetchall() if (True if r[5] is None else bool(r[5]))]
  if not old:
   _shift_migration_done=True;return
  by_eq={}
  for r in old:by_eq.setdefault(str(r[0] or '').strip(),[]).append(r)
  for eq,rows in by_eq.items():
   label='既定の勤務' if not eq else f'{eq}の勤務'
   pid,_=shift_pattern_upsert(c,None,eq,label,'migrate:勤務形態マスタ')
   shift_segment_sync(c,pid,[{'name':r[1],'start':r[2],'end':r[3]} for r in rows],'migrate:勤務形態マスタ')
  c.commit()
  from ..logging_setup import app_logger
  app_logger().info('勤務形態マスタを勤務体系/勤務区分の階層構造へ移行しました: %s',{k or '(全設備既定)':len(v) for k,v in by_eq.items()})
 except Exception as e:
  from ..logging_setup import app_logger
  app_logger().warning('勤務形態マスタの階層移行に失敗しました: %s',e)
 _shift_migration_done=True

def ensure_schedule_tables(c):
 # 共有schedule.sqlite3側。作業予定だけを用意する(設定系マスタは
 # master.sqlite3へ移したため、下のensure_config_master_tablesが受け持つ)。
 # with_write()のapply_fn冒頭やGET系ルートの前処理から呼ぶ想定
 # (ensure_*_tableは冪等なので複数回呼んでも安全)。
 ensure_plan_table(c)

def ensure_config_master_tables(mc):
 # master.sqlite3側。設定系マスタをまとめて用意する。
 ensure_calendar_table(mc)
 ensure_stop_reason_table(mc)
 # 分類マスタは設備停止マスタの後に作る(初回作成時に既存の分類値を取り込むため)
 ensure_stop_category_table(mc)
 ensure_load_factor_override_table(mc)
 ensure_shift_table(mc)
 ensure_shift_pattern_tables(mc)

CONFIG_MASTER_TABLES=('稼働カレンダーマスタ','設備停止マスタ','設備停止分類マスタ','負荷率上書きマスタ','勤務形態マスタ','勤務体系マスタ','勤務区分マスタ','勤務体系設備マスタ')

def config_master_conn():
 """設定系4マスタの保存先(master.sqlite3)への書込可能な接続。
 呼び出し側は `with sr.config_master_conn() as mc:` で使う。
 循環importを避けるため関数内でdb_accessを参照する。"""
 from ..db_access import DBS, connect
 return connect(DBS['MASTER']['path'],False)

# ------------------------------------------------------------------------
# 共有schedule.sqlite3 -> master.sqlite3 への一度きりの移行
# ------------------------------------------------------------------------
# 設定系4マスタの保存先を変更したため、既存環境に入っているデータを引き継ぐ。
# 共有ファイルへ到達できない場合は「まだ移行していない」まま何もせず戻り、
# 次回以降のアクセスで再挑戦する(移行済みの目印は成功時のみ立てる)。
# パス設定マスタの_migrate_legacy_path_configと同じ、目印付き一度きり方式。
_CONFIG_MIGRATION_MARKER='__schedule_config_masters_migrated__'
_config_migration_done=False

def _marker_table_ready(mc):
 from ..db_access import PATH_CONFIG_TABLE, ensure_path_config_table
 ensure_path_config_table(mc)
 return PATH_CONFIG_TABLE

def migrate_config_masters_from_shared():
 """共有schedule.sqlite3に残っている設定系4マスタをmaster.sqlite3へ複製する。
 master側に既に行があるテーブルは触らない(二重取り込みを避ける)。"""
 global _config_migration_done
 if _config_migration_done:return
 from ..db_access import connect, path_config_rows, set_path_config
 from ..logging_setup import app_logger
 mc=config_master_conn()
 try:
  _marker_table_ready(mc)
  if _CONFIG_MIGRATION_MARKER in path_config_rows(mc):
   _config_migration_done=True;return
  ensure_config_master_tables(mc)
  from .. import schedule_sync
  try:
   local_path,_stale=schedule_sync.fetch_snapshot()
  except Exception:
   # 共有が未設定・未到達。目印は立てず、次回のアクセスで再挑戦する。
   return
  moved={}
  sc=connect(local_path,False,'sqlite')
  try:
   src_tables=set(tables(sc))
   for name in CONFIG_MASTER_TABLES:
    if name not in src_tables:continue
    cur=mc.cursor();cur.execute(f'SELECT COUNT(*) FROM [{name}]')
    if int(cur.fetchone()[0] or 0)>0:continue  # 既に中身がある(移行済みか手入力済み)
    scur=sc.cursor();scur.execute(f'SELECT * FROM [{name}]')
    rows=scur.fetchall()
    if not rows:continue
    cols_src=[d[0] for d in scur.description]
    # 主キー(自動採番)は移さず、master側で振り直す。
    usable=[c for c in cols_src if c in set(_column_names(mc,name)) and c not in ('カレンダーID','停止理由ID','上書きID','勤務ID')]
    if not usable:continue
    idx=[cols_src.index(c) for c in usable]
    ph=','.join('?' for _ in usable)
    coldef=','.join(f'[{c}]' for c in usable)
    mc.cursor().executemany(f'INSERT INTO [{name}] ({coldef}) VALUES ({ph})',[[r[i] for i in idx] for r in rows])
    moved[name]=len(rows)
  finally:
   sc.close()
  set_path_config(mc,_CONFIG_MIGRATION_MARKER,'done','migrate:schedule.sqlite3')
  mc.commit()
  _config_migration_done=True
  if moved:
   app_logger().info('設定系マスタを共有schedule.sqlite3からmaster.sqlite3へ移行しました: %s',moved)
 except Exception as e:
  from ..logging_setup import app_logger as _lg
  _lg().warning('設定系マスタの移行に失敗しました(次回再試行します): %s',e)
 finally:
  mc.close()

def _column_names(c,table):
 from ..db_access import cols as _cols
 try:return _cols(c,table)
 except Exception:return []
