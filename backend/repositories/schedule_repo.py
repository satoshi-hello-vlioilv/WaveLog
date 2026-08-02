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

4テーブル: 作業予定・稼働カレンダーマスタ・設備停止マスタ・負荷率上書き
マスタ。時刻展開(稼働カレンダーからのETA計算・実績突合)はschedule_calc.py
(フェーズ3)が持ち、ここでは生データのCRUDのみを提供する。
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
  cur.execute('SELECT [設備名],[名称],[標準所要分] FROM [設備停止マスタ] WHERE [停止理由ID]=?',[stop_reason_id])
  row=cur.fetchone()
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
# 負荷率上書きマスタ(§5.4)
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

def ensure_schedule_tables(c):
 # 4テーブルをまとめて用意する。with_write()のapply_fn冒頭やGET系ルートの
 # 前処理から呼ぶ想定(各ensure_*_tableは冪等なので複数回呼んでも安全)。
 ensure_plan_table(c)
 ensure_calendar_table(c)
 ensure_stop_reason_table(c)
 ensure_load_factor_override_table(c)
