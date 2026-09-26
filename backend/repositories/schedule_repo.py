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
import re as _re

from ..db_access import add_missing_columns, cols, tables
from .master_repo import normalize_equipment_name
from ..quiet import quiet

# ========================================================================
# 作業予定(§5.1)
# ========================================================================
PLAN_TABLE='作業予定'
PLAN_REORDERABLE_STATE='予定'

# 親予定ID: 分割ありの親ロットにぶら下がる子ロットの行(§9.83)。
#   NULL … 通常の予定(まとまりの親、または単独の予定)
#   値   … その予定IDの子。**時間を持たない明細行**として扱う
#          (親ロット1本をスリットする1回の作業なので、タイムラインの
#           長さを決めるのは親の見積だけ)。
PLAN_PARENT_COLUMN='親予定ID'
# 「どの端末が入れたか」(§9.180)。IDだけでは、同じ人が別のPCから触った場合を
# 見分けられない(現場は端末ごとに役割が違う)。**登録側は上書きしない**
# ——予定を入れた端末を、あとから並べ替えた端末で塗り潰さないため。
PLAN_CREATED_PC_COLUMN='登録端末名'
PLAN_UPDATED_PC_COLUMN='更新端末名'
# 実績データソースでHITした行の写し(§9.364)。**スケジュール側へ残す**
# ——実績データは次の抽出で消える（前工程が終わった行は落ちる）ので、
# 突合できた事実をあちら任せにすると、あとから理由を辿れなくなる。
PLAN_ACTUAL_JSON_COLUMN='実績JSON'
# 追加操作そのものの身元(§9.438、利用者の報告「同じロットが2つ表示される」)。
# **HTTPは「サーバーが書けたか」を答えない**——書けたのに応答だけ落ちると、
# 画面には失敗としか見えず、書込キューが同じ`add`を投げ直す(通信不良は
# 待てば通ることがあるので、再送そのものは正しい)。素のINSERTはそのたびに
# 1行増やし、**どちらも本物の行**なので取り込み直しても消えない。
# **操作に身元を持たせ、同じ身元は2回適用しない**——再送を止めるのではなく、
# 2回目が1回目と同じ行を指すようにする(至上1回の配送はネットワーク越しには
# 作れないが、「何度届いても結果は1つ」なら作れる)。
# **行そのものが持つ**(別表にしない)。予定と同じ寿命で、共有DBを写しても
# 一緒に付いていき、消える予定と一緒に消える。
PLAN_OP_ID_COLUMN='操作ID'
# 手で入れた実際の時刻（§9.514、利用者の指示「仕掛にないロットや時間的に完了したであろう
# 設備停止は…開始時間だけ(登録済みの時間を適用する)もしくは開始時間と終了時間を入力」）。
# **測定データの実績とは別の欄**——出どころの違う時刻を同じ欄に入れると、どちらが正か言えない。
# JSON 1つ: {'startAt','endAt','endFrom':'手入力'|'見積','minutes','by','pc','at'}。
# 読むのは`schedule_calc.manual_times()`の1箇所。
PLAN_MANUAL_TIMES_COLUMN='手入力実績JSON'
# 共有DBは既に現場で動いているため、作り直さず「無ければ足す」で移行する
# (master_repo.ensure_audit_columns 等と同じ方式)。列が増えても
# plan_rows/plan_row は列名を明示して読むので、古い版のアプリが書いた
# 行(この列がNULL)もそのまま読める。
_PLAN_COLUMNS=('予定ID','設備名','表示順','種別','ロット番号','検査番号','鋳造番号',
               '予定名称','明細JSON','固定開始日時','見積分','状態','実績測定ID','備考',
               '有効','登録日時','更新日時','更新者ID',PLAN_PARENT_COLUMN,
               '登録者ID',PLAN_CREATED_PC_COLUMN,PLAN_UPDATED_PC_COLUMN,
               PLAN_ACTUAL_JSON_COLUMN,PLAN_MANUAL_TIMES_COLUMN)

def _plan_select(c_share):
 """読む側のSELECT。**読む側は書かない**（§9.325）。

 後から足した列（親予定ID・端末名）が無い写しでは`NULL AS [列]`で読む。
 以前は読む前に`ensure_plan_table()`で列を**足して**いたが、GET系が開くのは
 共有の**写し**（`schedule_cache.sqlite3`）で、別の要求が同時に写し直して
 `Path.replace()`で差し替える。開いたまま差し替えられたファイルへ書くと
 SQLiteは`SQLITE_READONLY_DBMOVED`＝「attempt to write a readonly database」
 で断る（実測。画面では作業スケジュールが500で開けず、完了の行だけ消えた）。
 列を足すのは書込サイクル（`with_write`の中の`plan_add`等）だけ。
 位置で読む側（`r[14]`等）を1つも変えないため、**並びは`_PLAN_COLUMNS`のまま**。"""
 from ..db_access import cols
 have=set(cols(c_share,PLAN_TABLE))
 return ('SELECT '+','.join(f'[{n}]' if n in have else f'NULL AS [{n}]' for n in _PLAN_COLUMNS)
         +' FROM [作業予定]')

def ensure_plan_table(c_share):
 names=tables(c_share);created=False
 if PLAN_TABLE not in names:
  cur=c_share.cursor()
  cur.execute('CREATE TABLE [作業予定] ([予定ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [表示順] INTEGER, [種別] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, [予定名称] TEXT, [明細JSON] TEXT, [固定開始日時] TEXT, [見積分] REAL, [状態] TEXT, [実績測定ID] TEXT, [備考] TEXT, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME, [親予定ID] INTEGER, [登録端末名] TEXT, [更新端末名] TEXT, [操作ID] TEXT)')
  cur.execute('CREATE INDEX [IX_作業予定_設備順] ON [作業予定] ([設備名],[表示順])')
  c_share.commit();created=True
  return created
 # 端末名(§9.180)も「無ければ足す」で移行する。**共有DBは既に現場で動いて
 # いるので作り直さない**(古い版のアプリが書いた行はNULLのまま読める)。
 # **足すのは`add_missing_columns()`の1箇所**（§9.315）——共有DBは
 # なおさら「別の端末が今まさに足した」が起こりうる。
 add_missing_columns(c_share,'作業予定',
                     ((PLAN_PARENT_COLUMN,'INTEGER'),
                      (PLAN_CREATED_PC_COLUMN,'TEXT'),(PLAN_UPDATED_PC_COLUMN,'TEXT'),
                      (PLAN_ACTUAL_JSON_COLUMN,'TEXT'),
                      (PLAN_OP_ID_COLUMN,'TEXT'),
                      (PLAN_MANUAL_TIMES_COLUMN,'TEXT')))
 return created

def plan_by_op_id(c_share,op_id):
 """その操作IDで既に入れた予定のID（無ければNone）。**答えるのはここ1箇所**。

 有効・無効は見ない——**消された予定も「その操作は適用済み」**なので、
 再送で作り直してはいけない（外したはずの行が数秒後に戻る）。
 列そのものが無い写し（古い版が作った共有DB）は、まだ1件も身元を持って
 いないので`None`でよい。"""
 op_id=str(op_id or '').strip()
 if not op_id:return None
 if PLAN_TABLE not in tables(c_share):return None
 if PLAN_OP_ID_COLUMN not in set(cols(c_share,PLAN_TABLE)):return None
 cur=c_share.cursor()
 cur.execute(f'SELECT [予定ID] FROM [作業予定] WHERE [{PLAN_OP_ID_COLUMN}]=?',[op_id])
 row=cur.fetchone()
 return row[0] if row else None

def plan_rows(c_share,equipment=None,include_inactive=False):
 # **読むだけ**（§9.325）。表が無い写し（共有がまだ空）は0件。
 if PLAN_TABLE not in tables(c_share):return []
 cur=c_share.cursor()
 # 子ロットは親と同じ[表示順]を持つ(§9.83)ので、同順のときは[予定ID]順に
 # する。親は必ず子より先に作られるため、これで親→子の並びが確定する
 # (同順の並びをSQLite任せにすると、子が親の前に出ることがある)。
 cur.execute(_plan_select(c_share)+' ORDER BY [設備名],[表示順],[予定ID]')
 target=normalize_equipment_name(equipment) if equipment else ''
 rows=[]
 for r in cur.fetchall():
  active=True if r[14] is None else bool(r[14])
  if not active and not include_inactive:continue
  if target and normalize_equipment_name(r[1])!=target:continue
  rows.append(r)
 return rows

def plan_row(c_share,plan_id):
 if PLAN_TABLE not in tables(c_share):return None
 cur=c_share.cursor()
 cur.execute(_plan_select(c_share)+' WHERE [予定ID]=?',[plan_id])
 return cur.fetchone()

def plan_child_rows(c_share,parent_id):
 """この親にぶら下がる子ロットの行(有効なものだけ、表示順)。"""
 if PLAN_TABLE not in tables(c_share):return []
 # 親予定IDの列そのものが無い写しでは子は1本も無い（`NULL AS`では絞れない）。
 from ..db_access import cols
 if PLAN_PARENT_COLUMN not in set(cols(c_share,PLAN_TABLE)):return []
 cur=c_share.cursor()
 cur.execute(_plan_select(c_share)+' WHERE [親予定ID]=? ORDER BY [表示順],[予定ID]',[parent_id])
 return [r for r in cur.fetchall() if r[14] is None or bool(r[14])]

def plan_set_actual_json(c_share,plan_id,payload,uid,pc=''):
 """HITした実績の写しを1件ぶん残す(§9.364)。**書込サイクルの中でだけ**呼ぶ
    （`with_write`が開いた作業コピーへ書く。読む側は写しに書かない・§9.325）。

    **既に入っている行は上書きしない。** 実績は前工程が終わると次の抽出で
    消えるので、後から読み直して「見つからない」で空へ戻すと、保存した
    意味が無くなる。消したいときは予定そのものを外す。
    戻り値: 書いたら True。"""
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute(f'SELECT [{PLAN_ACTUAL_JSON_COLUMN}] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:return False
 if str(row[0] or '').strip():return False
 cur.execute(f'UPDATE [作業予定] SET [{PLAN_ACTUAL_JSON_COLUMN}]=?,[更新者ID]=?,'
             f'[{PLAN_UPDATED_PC_COLUMN}]=?,[更新日時]=Now() WHERE [予定ID]=?',
             [payload,uid,pc,plan_id])
 return bool(cur.rowcount)

def _next_plan_order(c_share,equipment):
 cur=c_share.cursor()
 cur.execute('SELECT Max([表示順]) FROM [作業予定] WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0)',[equipment])
 return int(cur.fetchone()[0] or 0)+1

def plan_add(c_share,equipment,kind,uid,pc='',position='end',lot_no='',inspection_no='',casting_no='',title='',detail=None,stop_reason_id=None,stop_sub_id=None,estimate_minutes=None,fixed_start=None,remark='',children=None,op_id=''):
 # §8.2。kind='作業'はdetail(仕掛行スナップショット、辞書)をそのままJSON化して
 # 持つ(サーバー側で仕掛を引き直さない。フロントが送った時点の見え方を固定)。
 # kind='設備停止'はstopReasonIdから設備停止マスタの[名称]をスナップショットし、
 # マスタ行の[設備名]がリクエストのequipmentと一致しなければ拒否する(§5.3、
 # 他設備の停止理由IDの誤流用を防ぐ)。
 ensure_plan_table(c_share)
 # **同じ操作は2回適用しない**（§9.438）。応答が届かなかった追加は書込キューが
 # 投げ直すので、身元が同じなら**1回目に作った行のIDをそのまま返す**
 # ——画面から見れば「成功した」と同じで、行は1つのまま。
 op_id=str(op_id or '').strip()
 done=plan_by_op_id(c_share,op_id)
 if done is not None:return done
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 # 'コメント'(§9.189): 予定の列に挟む申し送り。**時間を持たない**ので
 # 後続の時刻を動かさない(設備停止は時間を持つので別物)。
 # '枠'(§9.238 ②): 空の日付・直の枠。**自分では時間を使わないが、後続の
 # 起点をその日・その直まで進める**——「日にちや直をいくつか飛ばして、
 # 先のスケジュールを先に決める」ための場所取り(利用者の指示)。
 if kind not in ('作業','設備停止','コメント','枠'):
  raise ValueError('種別は作業・設備停止・コメント・枠のいずれかを指定してください。')
 cur=c_share.cursor()
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
  # [設備名]は対象設備(複数設備・全設備'*'を取り得る、§9.81)なので、
  # 文字列の一致ではなく「この設備を含むか」で判定する。
  if not stop_equipment_matches(row[0],equipment):
   raise ValueError('指定の停止理由は別の設備に登録されています。')
  title_snapshot=str(row[1] or '').strip()
  # 内訳(サブカテゴリ・§9.389)。**[予定名称]は親の名称のまま**にする
  # ——利用者の言う「同じ刃組というグループには入れておきたい」がこれで、
  # 集計は今までどおり名称で束ねたまま、内訳でだけ割れる。
  # 置き場は[明細JSON]。作業の行の写しと同じ器だが、**設備停止の行の
  # 明細JSONは今まで空文字**（`plan_merge_detail`が種別='作業'だけを触るのも
  # そのため）なので、意味が混ざらない。列を足すと共有DBの移行が要る。
  if stop_sub_id not in (None,''):
   mc2=config_master_conn()
   try:
    sub=stop_sub_row(mc2,int(stop_sub_id))
    up=stop_sub_parent_of(mc2,int(stop_sub_id)) if sub else None
   finally:
    mc2.close()
   if not sub:raise ValueError('指定のサブカテゴリが見つかりません。')
   if int(sub[1] or 0)!=int(stop_reason_id):
    raise ValueError('そのサブカテゴリは別の設備停止のものです。')
   if not (True if sub[5] is None else bool(sub[5])):
    raise ValueError('そのサブカテゴリは削除されています。')
   detail_json=_json.dumps(stop_sub_detail(sub,up),ensure_ascii=False)
  # [見積分]はestimate_minutes(明示上書き)が無ければNULLのままにする(§5.1)。
  # マスタの標準所要分は固定値としてここでスナップショットしない。マスタの
  # 標準所要分を後から編集したら、まだ見積を上書きしていない予定には反映
  # させたいため、解決はschedule_calc.py(フェーズ3)の展開時に(設備名,
  # 予定名称)で毎回引き直す
  lot_no=inspection_no=casting_no=''
 elif kind=='枠':
  # 空の日付・直の枠(§9.238 ②)。**行が持つのは「いつまで飛ばすか」だけ**で、
  # 実際の時刻はschedule_calcが展開のたびに勤務形態マスタから引き直す
  # （直の開始時刻を後から直したら、置いてある枠も一緒に動いてほしい。
  #   設備停止の標準所要分をスナップショットしないのと同じ理由・§5.1）。
  # **[固定開始日時]は使わない**——あちらは「この予定自身をその時刻へ
  # 釘で留める」意味で、枠の「ここから先はこの日・この直から」とは別物。
  # 2つの意味を1つの列へ入れると、どちらのつもりで入れた値か分からなくなる。
  frame=normalize_frame(detail)
  if not frame.get('date'):
   raise ValueError('枠には日付を指定してください。')
  detail_json=_json.dumps(frame,ensure_ascii=False)
  title_snapshot=(title_snapshot or frame_label(frame))[:200]
  est=0
  fixed_start=None
  lot_no=inspection_no=casting_no=''
 elif kind=='コメント':
  # 中身は[予定名称]の文字だけ。**時間は必ず0**——「見積を入れれば場所を
  # 取れる」形にすると、申し送りが後続の時刻を押すことになる。
  # **空のまま入れられる**(§9.191)。掴んで落とした時点では枠だけで、
  # 中身は落とした場所を見てから書く（先に文章を考えさせない）。
  title_snapshot=title_snapshot[:200]
  est=0
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
 elif position.startswith('before:'):
  # §9.179: 「カーソルがあっている位置へ入れる」。画面で追加してから
  # 並べ替えAPIを叩く形にすると、追加と並べ替えの2往復のあいだに別のPCの
  # 変更が挟まり得る(共有DBは1件ずつ取得→適用→反映する)。**入れる位置は
  # 追加と同じ書込サイクルで決める**。
  # 指定の行が見つからない/動かせない状態(着手・完了・取消)なら**末尾へ**
  # 落とす——例外にすると、画面を開いたまま他のPCが着手した瞬間に
  # 「追加できません」になる(入れたい位置が消えただけで、追加そのものは
  # したい操作)。
  ref=position.split(':',1)[1].strip()
  order=None
  if ref:
   cur.execute('SELECT [表示順],[状態] FROM [作業予定] WHERE [予定ID]=? AND [設備名]=? AND ([有効] IS NULL OR [有効]<>0)',[ref,equipment])
   row_ref=cur.fetchone()
   if row_ref and (str(row_ref[1] or '') == PLAN_REORDERABLE_STATE):
    order=int(row_ref[0] or 0)
    cur.execute('UPDATE [作業予定] SET [表示順]=[表示順]+1 WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0) AND ([状態] IS NULL OR [状態]=?) AND [表示順]>=?',
                [equipment,PLAN_REORDERABLE_STATE,order])
  if order is None:order=_next_plan_order(c_share,equipment)
 else:
  order=_next_plan_order(c_share,equipment)
 # **身元は行と一緒に入れる**（§9.438）。入れたあとで別のUPDATEで書くと、
 # そのあいだに届いた再送が身元を見つけられず、結局2行になる。
 # 列そのものが無い写し（古い版が作った共有DB）へは載せない——`ensure_plan_table`
 # が足すので通常は在るが、足せなかった端末でも**今までどおり動く**側へ倒す。
 has_op=PLAN_OP_ID_COLUMN in set(cols(c_share,PLAN_TABLE))
 cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[検査番号],[鋳造番号],[予定名称],[明細JSON],[固定開始日時],[見積分],[状態],[備考],[有効],[登録者ID],[更新者ID],[登録端末名],[更新端末名]'
             +(f',[{PLAN_OP_ID_COLUMN}]' if has_op else '')
             +',[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,-1,?,?,?,?'
             +(',?' if has_op else '')+',Now(),Now())',
             [equipment,order,kind,lot_no,inspection_no,casting_no,title_snapshot,detail_json,fixed_start,est,PLAN_REORDERABLE_STATE,remark,uid,uid,pc,pc]
             +([op_id] if has_op else []))
 plan_id=cur.lastrowid
 # 分割ありの親ロット(§9.83)。子ロットは**同じ書込サイクルの中で**まとめて
 # 作る。1件ずつ別の書込にすると、共有DBのロック→取得→適用→反映を子の数
 # だけ回すことになるうえ、途中で失敗すると親だけが残る。
 for child in (children or []):
  plan_add_child(c_share,plan_id,equipment,uid,pc=pc,
                 lot_no=str(child.get('lotNo') or ''),
                 inspection_no=str(child.get('inspectionNo') or ''),
                 casting_no=str(child.get('castingNo') or ''),
                 detail=child.get('detail') or {},
                 order=order)
 return plan_id

# ========================================================================
# 空の日付・直の枠(§9.238 ②、利用者の指示)
# ========================================================================
# 「予定を少し飛ばして設定する場合に、何も予定がない領域にセットできる、
#  空の日付や直の枠を登録できるようにしたいです。…日にちや直をいくつか
#  飛ばして、先のスケジュールを先に決めることができるようになるので…
#  スケジュールが押し出してくる際は連動してロットが自然にその設定枠に
#  入るようにします」
#
# 決めごと:
#  ・持つのは **日付(YYYY-MM-DD) と 直の名称** の2つだけ。実時刻は
#    schedule_calc が勤務形態マスタから展開のたびに引き直す(スナップショット
#    しない。§5.1と同じ理由——直の時間帯を直したら枠も追随してほしい)。
#  ・**枠自身は時間を使わない**(見積0分)。効くのは「後続の起点を、その日・
#    その直の開始まで**進める**」ことだけ。
#  ・**進めるのは前へだけ**。前の予定が押してきて起点が枠の時刻を過ぎたら、
#    枠は何もしない——これが利用者の言う「押し出してくる際は連動してロットが
#    自然にその設定枠に入る」。飛ばした空き時間は、手前へ予定を入れるほど
#    自然に埋まっていく。
DATE_RE=_re.compile(r'^\d{4}-\d{2}-\d{2}$')

def normalize_frame(detail):
 """画面から来た枠の中身を、保存する形へそろえる。
 **知らないキーは落とす**——明細JSONは何でも入る器なので、入口で形を決めて
 おかないと、読む側が「あるかもしれない」前提で書くことになる。"""
 d=detail if isinstance(detail,dict) else {}
 date_s=str(d.get('frameDate') or d.get('date') or '').strip()
 if not DATE_RE.match(date_s):date_s=''
 shift=str(d.get('frameShift') or d.get('shift') or '').strip()[:60]
 note=str(d.get('frameNote') or d.get('note') or '').strip()[:120]
 return {'frameDate':date_s,'frameShift':shift,'frameNote':note,
         # 読む側が「枠の明細だ」と一目で分かるようにしておく。
         'frame':True,'date':date_s,'shift':shift}

def frame_label(frame):
 """[予定名称]へ入れる控えの文字。**画面はこれを表示に使わない**
 (画面は日付と直から組み立て直す)が、一覧・帳票・監査ログのように
 明細JSONを開かない場所のために、読める形を1つ持たせておく。"""
 d=str((frame or {}).get('frameDate') or '').strip()
 sh=str((frame or {}).get('frameShift') or '').strip()
 if not d:return '枠'
 return f'{d} {sh}'.strip() if sh else d

def plan_set_frame(c_share,plan_id,uid,detail,pc=''):
 """枠の行き先(日付・直)を入れ替える。**種別が枠の行だけ**。
 [予定名称]と[明細JSON]は必ず一緒に書く——片方だけ直すと、一覧に出る文字と
 実際に効く日付が食い違う(§9.113の「渡す設定を1つでも書き漏らさない」)。"""
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[種別] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:raise ValueError('指定の予定が見つかりません。')
 if str(row[1] or '')!='枠':
  raise ValueError('日付・直を書き換えられるのは枠の行だけです。')
 frame=normalize_frame(detail)
 if not frame.get('frameDate'):raise ValueError('枠には日付を指定してください。')
 cur.execute('UPDATE [作業予定] SET [予定名称]=?,[明細JSON]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',
             [frame_label(frame),_json.dumps(frame,ensure_ascii=False),uid,pc,plan_id])
 return cur.rowcount

# 予定は「投入した時点の写し」(buildScheduleDetail)。**それでも動く値はある**
# ——出荷日のように後から決まる項目は、写したあとに元データ(仕掛)の側で
# 変わる(§9.375、利用者の指示)。そこだけを書き換える口を1つ持つ。
def plan_merge_detail(c_share,plan_id,uid,changes,pc=''):
 """明細JSONへ**指定した鍵だけ**を重ねる。**全置換にしない**——写しには
 画面が今出していない項目も入っており、全置換にすると出していない項目が
 黙って消える(§9.113の「渡す設定を1つでも書き漏らさない」の裏返し)。

 **書き換えてよいのは種別が「作業」の行だけ**。枠は`plan_set_frame`、
 設備停止・申し送りは明細JSONを別の意味で使っている。"""
 ensure_plan_table(c_share)
 if not isinstance(changes,dict) or not changes:return 0
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[種別],[明細JSON] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:raise ValueError('指定の予定が見つかりません。')
 if str(row[1] or '')!='作業':
  raise ValueError('元データの取り込みができるのは作業の行だけです。')
 # **黙って捨てない**（§9.328）。壊れた明細JSONは「空の明細」として続けるのが
 # 正しい（取り込みはこれから上書きする）が、**壊れていたこと自体は残す**
 # ——静かに空へ倒れると、写しが消えた理由が誰にも分からなくなる。
 try:detail=_json.loads(row[2] or '{}')
 except Exception as _e:
  quiet('予定の明細JSONを読めない（空から組み直す）',_e);detail={}
 if not isinstance(detail,dict):detail={}
 # 値は文字で持つ(明細JSONは元データの見え方の写しで、計算には使わない)。
 # **200文字で切る**——仕掛の列には長文の備考が入ることがあり、写しの
 # ふくらみがそのまま共有DBの大きさになる。
 for k,v in changes.items():
  key=str(k or '').strip()
  if not key:continue
  detail[key]='' if v is None else str(v)[:200]
 cur.execute('UPDATE [作業予定] SET [明細JSON]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',
             [_json.dumps(detail,ensure_ascii=False),uid,pc,plan_id])
 return cur.rowcount

def stop_sub_detail(sub,parent=None):
 """予定の[明細JSON]へ入れる内訳の写し（§9.390）。**1段目は`stopSub`のまま**
    ——集計は今までどおり`stopSub`で束ねられ、2段目（`stopSub2`）でだけ割れる。
    `sub`が2段目なら`parent`（1段目の行）を渡すこと。"""
 if not sub:return {}
 name=str(sub[2] or '').strip()
 if parent:
  return {'stopSubId':int(sub[0]),'stopSub':str(parent[2] or '').strip(),
          'stopSub2':name,'stopSubTopId':int(parent[0])}
 return {'stopSubId':int(sub[0]),'stopSub':name}

def plan_set_stop_sub(c_share,plan_id,uid,sub_id,pc=''):
 """入れた設備停止の**内訳(サブカテゴリ)を後から直す**(§9.389)。
 `sub_id`が空なら内訳なしへ戻す。

 **種別が設備停止の行だけ。** 作業の行の明細JSONは仕掛の写しで、
 別物を同じ器へ入れると「写しが消えた」としか見えなくなる
 (`plan_merge_detail`が作業の行だけを触るのと表裏)。

 **[予定名称]は動かさない**——名称は集計の軸(§9.389の「同じグループに
 入れておきたい」)で、内訳を変えるたびに束ね方が変わってはいけない。"""
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[種別],[設備名],[予定名称] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:raise ValueError('指定の予定が見つかりません。')
 if str(row[1] or '')!='設備停止':
  raise ValueError('サブカテゴリを持てるのは設備停止の行だけです。')
 payload=''
 if sub_id not in (None,''):
  mc=config_master_conn()
  try:
   sub=stop_sub_row(mc,int(sub_id))
   if not sub:raise ValueError('指定のサブカテゴリが見つかりません。')
   up=stop_sub_parent_of(mc,int(sub_id))
   parent=stop_reason_id_of(mc,row[2],row[3])
  finally:
   mc.close()
  if parent is None:
   raise ValueError('この行の設備停止が設備停止マスタに見つかりません。')
  if int(sub[1] or 0)!=int(parent):
   raise ValueError('そのサブカテゴリは別の設備停止のものです。')
  payload=_json.dumps(stop_sub_detail(sub,up),ensure_ascii=False)
 cur.execute('UPDATE [作業予定] SET [明細JSON]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',
             [payload,uid,pc,plan_id])
 return cur.rowcount

def plan_add_child(c_share,parent_id,equipment,uid,lot_no='',inspection_no='',casting_no='',detail=None,order=None,pc=''):
 """子ロットの行を1件足す(§9.83)。
    **[見積分]は0で固定**する。親ロット1本をスリットする1回の作業なので、
    タイムラインの長さを決めるのは親の見積だけ。子に時間を持たせると、
    分割ありのロットだけ予定終了が子の数だけ後ろへ伸びてしまう。
    [表示順]は親と同じにする。親のすぐ後ろに並び、並べ替えは親を動かせば
    まとまりで動く(plan_reorder参照)。"""
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 if order is None:
  cur.execute('SELECT [表示順],[設備名] FROM [作業予定] WHERE [予定ID]=?',[parent_id])
  row=cur.fetchone()
  if not row:raise ValueError('親の予定が見つかりません。')
  order=row[0];equipment=equipment or row[1]
 cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[検査番号],[鋳造番号],[予定名称],[明細JSON],[見積分],[状態],[有効],[親予定ID],[登録者ID],[更新者ID],[登録端末名],[更新端末名],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,0,?,-1,?,?,?,?,?,Now(),Now())',
            [equipment,order,'作業',lot_no,inspection_no,casting_no,lot_no,
             _json.dumps(detail or {},ensure_ascii=False),PLAN_REORDERABLE_STATE,parent_id,uid,uid,pc,pc])
 return cur.lastrowid

# title=[予定名称]。**申し送り(kind='コメント')の本文だけ**書き換えられる
# (§9.191)。作業の予定名称は空、設備停止の予定名称は設備停止マスタの
# スナップショットで、schedule_calc が (設備名,予定名称) で標準所要分を
# 引いている——書き換えさせると見積の出どころが黙って変わる。
_PLAN_UPDATE_FIELDS={'estimateMinutes':'見積分','fixedStart':'固定開始日時','remark':'備考',
                     'state':'状態','title':'予定名称'}

def plan_update(c_share,plan_id,uid,pc='',**fields):
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[種別] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:raise ValueError('指定の予定が見つかりません。')
 if 'title' in fields:
  # コメントの本文(§9.191)と、設備停止の名称(§9.220 2①、利用者の指示
  # 「停止項目入れると変更できないので、右クリックやダブルクリックで
  #  編集・変更できるようにしたい」)。**作業の行は書き換えられない**
  # ——あちらの名称はロット番号から作られる表示で、書き換えると仕掛の
  # どのロットかが辿れなくなる。
  kind=str(row[1] or '')
  if kind not in ('コメント','設備停止'):
   raise ValueError('名称を書き換えられるのは申し送りと設備停止だけです。')
  fields['title']=str(fields['title'] or '')[:200]
  # **設備停止の名称は空にできない**（何の停止か分からない行になる）。
  # コメントは空を通す（§9.191。枠を置いてから書くため）。
  if kind=='設備停止' and not fields['title'].strip():
   raise ValueError('設備停止の名称を入力してください。')
 sets=[];params=[]
 for key,col in _PLAN_UPDATE_FIELDS.items():
  if key in fields:
   sets.append(f'[{col}]=?');params.append(fields[key])
 if not sets:return 0
 params+=[uid,pc,plan_id]
 cur.execute(f'UPDATE [作業予定] SET {",".join(sets)},[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',params)
 return cur.rowcount

# 実際の時刻を手で入れてよい種別（§9.514）。作業（仕掛から消えたロット）と設備停止だけ。
PLAN_MANUAL_TIMES_KINDS=('作業','設備停止')

def plan_set_manual_times(c_share,plan_id,uid,payload,pc=''):
 """手で入れた実際の時刻を書き、**完了を確定する**（§9.514）。

 登録＝「この行は終わった」と人が言ったこと。**状態も完了にする**——あとで仕掛に同じ
 ロットが戻っても、人が確かめた完了を黙って予定へ戻さない。判定（時刻が読めるか・
 終わりが始まりより前でないか）は呼ぶ側（`schedule_calc.manual_payload()`）が済ませてある。"""
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[種別] FROM [作業予定] WHERE [予定ID]=?',[plan_id])
 row=cur.fetchone()
 if not row:raise ValueError('指定の予定が見つかりません。')
 if str(row[1] or '') not in PLAN_MANUAL_TIMES_KINDS:
  raise ValueError('実際の時刻を入れられるのは作業と設備停止だけです。')
 cur.execute(f'UPDATE [作業予定] SET [{PLAN_MANUAL_TIMES_COLUMN}]=?,[状態]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',
             [_json.dumps(payload,ensure_ascii=False),"完了",uid,pc,plan_id])
 return cur.rowcount

def plan_delete(c_share,plan_id,uid,pc=''):
 ensure_plan_table(c_share)
 cur=c_share.cursor()
 cur.execute('UPDATE [作業予定] SET [有効]=0,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',[uid,pc,plan_id])
 n=cur.rowcount
 # 子ロットは親にぶら下がる明細行(§9.83)。親を消したら一緒に消す。
 # 残すと、親のいない子が単独の予定としてタイムラインに並んでしまう。
 cur.execute('UPDATE [作業予定] SET [有効]=0,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [親予定ID]=? AND ([有効] IS NULL OR [有効]<>0)',[uid,pc,plan_id])
 return n

class ReorderStaleError(Exception):
 """並べ替えの土台が古い（§9.291 ③）。**顔ぶれは同じだが並びが変わっている**
 ——他の端末が先に並べ替えたということ。

 編集セッションで操作を止めるのをやめた（§9.291 ③）ので、同時に触れるように
 なった。データが壊れることは無い（書く役は1台・ロック＋改訂番号・全置換）が、
 **同じ顔ぶれのまま2人が並べ替えると、後から保存したほうの並びで丸ごと
 上書きされる**——これだけは行ごとの書き込みでは受けられない唯一の衝突。
 **黙って上書きしない**で、呼び出し側が読み直せるように投げる（§4）。

 顔ぶれが違う（他の端末が足した/消した）ときは、今までどおり
 「並べ替え対象が現在の未着手予定と一致しません」で断る（そちらが先に当たる）。
 """
 def __init__(self,current_ids,by_login='',by_pc=''):
  self.current_ids=list(current_ids or [])
  self.by_login=str(by_login or '');self.by_pc=str(by_pc or '')
  super().__init__('この設備の並び順は、ほかの端末が先に変更しています。'
                   '最新の並びを読み直してから、もう一度お願いします。')

def plan_reorder(c_share,equipment,ordered_ids,uid,reorderable_ids=None,pc='',base_ids=None):
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
 ensure_plan_table(c_share)
 equipment=str(equipment or '').strip()
 if not equipment:raise ValueError('設備名を指定してください。')
 cur=c_share.cursor()
 cur.execute('SELECT [予定ID],[表示順],[状態],[親予定ID] FROM [作業予定] WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0)',[equipment])
 active_rows=cur.fetchall()
 # 子ロット(§9.83)は単独で動かせない。親にぶら下がる明細行なので、
 # 並べ替えの対象は親だけにして、子は親の新しい表示順へ後から揃える。
 # 対象に混ぜると、画面が送らない(=まとまりとして畳んでいる)IDが
 # 「一致しません」の判定に引っかかって並べ替え自体が通らなくなる。
 children_of={}
 for r in active_rows:
  if r[3] is not None:children_of.setdefault(r[3],[]).append(r[0])
 parent_rows=[r for r in active_rows if r[3] is None]
 if reorderable_ids is None:
  reorderable={r[0] for r in parent_rows if (r[2] or PLAN_REORDERABLE_STATE)==PLAN_REORDERABLE_STATE}
 else:
  parent_ids={r[0] for r in parent_rows}
  reorderable={pid for pid in reorderable_ids if pid in parent_ids}
 fixed_orders=[r[1] or 0 for r in parent_rows if r[0] not in reorderable]
 given=list(ordered_ids or [])
 if len(set(given))!=len(given):raise ValueError('並べ替え対象に重複があります。')
 if set(given)!=reorderable:raise ValueError('並べ替え対象が現在の未着手予定と一致しません(追加・削除の直後は最新の一覧を取得し直してください)。')
 # **掴んだときの並びと、いまの並びを突き合わせる**（§9.291 ③）。
 # `base_ids`は「画面が掴む前に見ていた順」。渡されたときだけ見るので、
 # 送らない古い呼び出し（テスト・他の経路）は今までどおり通る。
 if base_ids is not None:
  now_order=[r[0] for r in sorted(parent_rows,key=lambda r:((r[1] or 0),r[0])) if r[0] in reorderable]
  base=[pid for pid in (base_ids or []) if pid in reorderable]
  if base and base!=now_order:
   # 誰が動かしたかも返す（**黙って上書きしない**・§4）。
   cur.execute('SELECT [更新者ID],[更新端末名] FROM [作業予定] '
               'WHERE [設備名]=? AND ([有効] IS NULL OR [有効]<>0) '
               'ORDER BY [更新日時] DESC',[equipment])
   who=cur.fetchone() or ('','')
   raise ReorderStaleError(now_order,who[0] or '',who[1] or '')
 base=max(fixed_orders) if fixed_orders else 0
 for idx,pid in enumerate(given,start=1):
  cur.execute('UPDATE [作業予定] SET [表示順]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [予定ID]=?',[base+idx,uid,pc,pid])
  # 子は親と同じ表示順にして、親のすぐ後ろから離れないようにする。
  if children_of.get(pid):
   cur.execute('UPDATE [作業予定] SET [表示順]=?,[更新者ID]=?,[更新端末名]=?,[更新日時]=Now() WHERE [親予定ID]=?',[base+idx,uid,pc,pid])
 return len(given)

# ========================================================================
# 稼働カレンダーマスタ(§5.2)
# ========================================================================
CALENDAR_TABLE='稼働カレンダーマスタ'

def ensure_calendar_table(c_master):
 names=tables(c_master);created=False
 if CALENDAR_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [稼働カレンダーマスタ] ([カレンダーID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [区分] TEXT, [曜日] INTEGER, [日付] TEXT, [稼働] INTEGER, [開始時刻] TEXT, [終了時刻] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_稼働カレンダーマスタ_設備] ON [稼働カレンダーマスタ] ([設備名])')
  c_master.commit();created=True
 return created

def calendar_rows(c_master,equipment=None):
 # equipment未指定なら全設備既定([設備名]='')・指定ありならその設備専用行のみ。
 # 適用時の優先順位(特異日>設備別の曜日>全設備既定)の解決はschedule_calc.py側で行う。
 ensure_calendar_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [カレンダーID],[設備名],[区分],[曜日],[日付],[稼働],[開始時刻],[終了時刻],[表示順],[有効] FROM [稼働カレンダーマスタ] ORDER BY [設備名],[区分],[曜日],[日付],[表示順]')
 target=normalize_equipment_name(equipment) if equipment else ''
 rows=[]
 for r in cur.fetchall():
  active=True if r[9] is None else bool(r[9])
  if not active:continue
  if normalize_equipment_name(r[1])!=target:continue
  rows.append(r)
 return rows

def calendar_sync(c_master,equipment,entries,uid):
 # §8のPOST /api/schedule/calendar(完全同期)。曜日×複数行(2交替等)の
 # 組み合わせは単純な列名の集合では一意化できないため、対象スコープ
 # (equipment、空文字は全設備既定)の既存行を全削除してentriesを丸ごと
 # 作り直す(オペレータ設備マスタ等の「増分diff」方式ではなく、それより
 # 単純な全置換方式を採る)。
 ensure_calendar_table(c_master)
 equipment=str(equipment or '').strip()
 cur=c_master.cursor()
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

def ensure_stop_category_table(c_master):
 names=tables(c_master);created=False
 if STOP_CATEGORY_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [設備停止分類マスタ] ([分類ID] INTEGER PRIMARY KEY AUTOINCREMENT, [名称] TEXT, [色キー] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備停止分類マスタ_名称] ON [設備停止分類マスタ] ([名称])')
  c_master.commit();created=True
  _seed_stop_categories(c_master)
 return created

def _seed_stop_categories(c_master):
 """初回作成時だけ走る移行。既定の4分類と、既に設備停止マスタで使われている
 分類を取り込む(空欄で作ると、既存データの分類が選択肢から消えてしまう)。"""
 seen=[]
 for name in STOP_CATEGORY_SEEDS:
  if name not in seen:seen.append(name)
 try:
  if STOP_REASON_TABLE in tables(c_master):
   cur=c_master.cursor()
   cur.execute('SELECT DISTINCT [分類] FROM [設備停止マスタ]')
   for (v,) in cur.fetchall():
    v=str(v or '').strip()
    if v and v not in seen:seen.append(v)
 except Exception as _e:
  quiet('分類の種を入れられない（分類は手で足せる）',_e)
 cur=c_master.cursor()
 for i,name in enumerate(seen):
  cur.execute('INSERT INTO [設備停止分類マスタ] ([名称],[色キー],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',
              [name,'',(i+1)*10,'migrate:seed','migrate:seed'])
 c_master.commit()

def stop_category_rows(c_master):
 ensure_stop_category_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [分類ID],[名称],[色キー],[表示順],[有効],[更新日時],[更新者ID] FROM [設備停止分類マスタ] ORDER BY [表示順],[名称]')
 return [r for r in cur.fetchall() if (True if r[4] is None else bool(r[4]))]

def stop_category_names(c_master):
 return [str(r[1] or '').strip() for r in stop_category_rows(c_master) if str(r[1] or '').strip()]

def stop_category_upsert(c_master,name,uid,color_key='',category_id=None):
 """分類の登録・改名。名称が自然キー(全設備共通なので設備名は持たない)。
 category_idを渡した場合はその行の改名として扱う(他マスタと同じリネーム更新)。"""
 ensure_stop_category_table(c_master)
 name=str(name or '').strip()
 if not name:raise ValueError('分類名を入力してください。')
 cur=c_master.cursor()
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

# ========================================================================
# 行表示マスタ(§9.198) — タイムラインの行の見せ方(配色・アイコン)
# ------------------------------------------------------------------------
# **全設備共通で持つ**。設備停止分類マスタと同じ理由で、区分の色は設備を
# またいで意味を持つ言語だから——同じ「設備停止」が設備によって赤だったり
# 青だったりすると、色が何も語らなくなる。
#
# [区分キー]は1つの名前空間で持つ:
#   'cat:<区分>'      … 完了/作業中/予定/取消/設備停止/コメントの6つ
#   'stopcat:<分類名>' … 設備停止の分類(保全・段取り…)ごとの上書き
# **2つの表に分けないこと**——「どちらが効くのか」を答える場所が2つになる。
# 効く順は「分類の指定 → 区分の指定 → 既定」で、判定は画面の1箇所が持つ。
# ========================================================================
ROW_STYLE_TABLE='行表示マスタ'
# ---------------------------------------------------------------------------
# 作業以外の行（設備停止・コメント・枠）の題名の見せ方（§9.295、利用者の指示
# 「作業スケジュールの設備停止の部分に色やバッジみたいなデザインを付けたいのと、
#  左寄せにしたり文字の位置を変更できるようにしてほしいです」）
# ---------------------------------------------------------------------------
# §9.294 ①で題名は「内容の列を束ねた1マス」になった。そこへ**見せ方**を足す。
# **綴りと呼び名はここが1箇所**（§9.163）——画面へ写すと、増やしたときに
# 2箇所直すことになる。**既定はどれも空＝いまの見え方**（§9.132。設定を
# 触っていない現場の紙と画面が1pxも変わらない）。
#
# 色は**既にある`[色キー]`をそのまま使う**（`--rs-fg`/`--rs-bg`/`--rs-line`）
# ——バッジのために色表をもう1つ作らない。効く順も今までどおり
# 「分類の指定 → 区分の指定 → 既定」。
ROW_TITLE_LOOK_COLUMN='題名の見せ方'
ROW_TITLE_PLACE_COLUMN='題名の位置'
ROW_TITLE_ALIGN_COLUMN='題名の揃え'
ROW_TITLE_LOOKS=(
 ('',      '文字だけ','いまの見え方。色は行の地に出ます（既定）'),
 ('バッジ','バッジ',  '名前を札にして、色を札に乗せます。行の地は塗りません'),
 ('帯',    '帯',      '束ねたマスぜんぶを色の面にします。いちばん目立ちます'),
)
ROW_TITLE_PLACES=(
 ('',    '内容の列','日付・時刻・区分はそのまま残ります（既定）'),
 ('全幅','行いっぱい','操作の列を除いて、行の左端から端まで使います'),
)
ROW_TITLE_ALIGNS=(
 ('',    '左',  '既定'),
 ('中央','中央','紙で目立たせたいとき'),
 ('右',  '右',  ''),
)
# 題名の横の（所要時間）（§9.295 ④、利用者の指示「設備停止名の横に()書きで
# 時間を表示するように。デフォルト表示ONでOFFにもできるように」）。
# **既定＝出す**なので、空欄が「出す」。OFFにするときだけ値が入る
# （§9.99「行が無い＝既定」と同じ約束で、既定を変えても追随する）。
ROW_TITLE_TIME_COLUMN='題名に時間'
ROW_TITLE_TIMES=(
 ('',    '出す',  '所要時間を（ ）で名前の横に添えます（既定）'),
 ('なし','出さない','名前だけにします'),
)
def normalize_row_title_time(v):return _norm_choice(v,ROW_TITLE_TIMES)
def _norm_choice(value,table):
 v=str(value or '').strip()
 return v if any(v==k for k,_l,_n in table) else ''
def normalize_row_title_look(v):return _norm_choice(v,ROW_TITLE_LOOKS)
def normalize_row_title_place(v):return _norm_choice(v,ROW_TITLE_PLACES)
def normalize_row_title_align(v):return _norm_choice(v,ROW_TITLE_ALIGNS)

def ensure_row_style_table(c_master):
 names=tables(c_master);created=False
 if ROW_STYLE_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [行表示マスタ] ([行表示ID] INTEGER PRIMARY KEY AUTOINCREMENT, [区分キー] TEXT, [色キー] TEXT, [アイコン] TEXT, [アイコン表示] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_行表示マスタ_区分キー] ON [行表示マスタ] ([区分キー])')
  c_master.commit();created=True
 # 既存環境には題名の3列が無い。**空のまま足して「未設定＝既定」**で扱う
 # （他マスタと同じ互換ポリシー。値を入れ直させない）。
 try:
  add_missing_columns(c_master,ROW_STYLE_TABLE,
                      tuple((n,'TEXT') for n in
                            (ROW_TITLE_LOOK_COLUMN,ROW_TITLE_PLACE_COLUMN,
                             ROW_TITLE_ALIGN_COLUMN,ROW_TITLE_TIME_COLUMN)))
 except Exception as _e:quiet('後から足した列を用意できない（在る列だけで読む）',_e)
 return created

def row_style_rows(c_master):
 ensure_row_style_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [行表示ID],[区分キー],[色キー],[アイコン],[アイコン表示],[有効],[更新日時],[更新者ID],'
             '[題名の見せ方],[題名の位置],[題名の揃え],[題名に時間] FROM [行表示マスタ] ORDER BY [区分キー]')
 return [r for r in cur.fetchall() if (True if r[5] is None else bool(r[5]))]

def row_style_upsert(c_master,key,uid,color_key='',icon='',show_icon=True,row_style_id=None,
                     title_look=None,title_place=None,title_align=None,title_time=None):
 """1件の登録・更新。区分キーが自然キー。**既定へ戻すのは行を消すこと**
 （空文字を保存すると「空という設定」になり、あとから既定を変えても
 追随しなくなる。§9.99の「行が無い＝既定」と同じ約束）。"""
 ensure_row_style_table(c_master)
 key=str(key or '').strip()
 if not key:raise ValueError('どの区分の見せ方かを指定してください。')
 flag=-1 if show_icon else 0
 cur=c_master.cursor()
 cur.execute('SELECT [行表示ID],[区分キー],[題名の見せ方],[題名の位置],[題名の揃え],[題名に時間] FROM [行表示マスタ]')
 rows=cur.fetchall()
 same=next((r for r in rows if str(r[1] or '').strip()==key),None)
 # **送られてこなかった項目は今の値を残す**（§9.212 ②）——呼び出し側が
 # 1つ書き漏らすと、その設定だけが黙って消える形にしない。
 def keep(row,idx,given,norm):
  if given is not None:return norm(given)
  return norm(row[idx]) if row else ''
 if row_style_id is not None:
  if same and same[0]!=row_style_id:raise ValueError(f'区分「{key}」の設定は既にあります。')
  cur.execute('SELECT [行表示ID],[区分キー],[題名の見せ方],[題名の位置],[題名の揃え],[題名に時間] FROM [行表示マスタ] WHERE [行表示ID]=?',[row_style_id])
  cur_row=cur.fetchone()
  cur.execute('UPDATE [行表示マスタ] SET [区分キー]=?,[色キー]=?,[アイコン]=?,[アイコン表示]=?,'
              '[題名の見せ方]=?,[題名の位置]=?,[題名の揃え]=?,[題名に時間]=?,'
              '[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [行表示ID]=?',
              [key,color_key,icon,flag,
               keep(cur_row,2,title_look,normalize_row_title_look),
               keep(cur_row,3,title_place,normalize_row_title_place),
               keep(cur_row,4,title_align,normalize_row_title_align),
               keep(cur_row,5,title_time,normalize_row_title_time),
               uid,row_style_id])
  if cur.rowcount==0:raise ValueError('指定の設定が見つかりません。')
  return row_style_id,False
 if same:
  cur.execute('UPDATE [行表示マスタ] SET [色キー]=?,[アイコン]=?,[アイコン表示]=?,'
              '[題名の見せ方]=?,[題名の位置]=?,[題名の揃え]=?,[題名に時間]=?,'
              '[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [行表示ID]=?',
              [color_key,icon,flag,
               keep(same,2,title_look,normalize_row_title_look),
               keep(same,3,title_place,normalize_row_title_place),
               keep(same,4,title_align,normalize_row_title_align),
               keep(same,5,title_time,normalize_row_title_time),
               uid,same[0]])
  return same[0],False
 cur.execute('INSERT INTO [行表示マスタ] ([区分キー],[色キー],[アイコン],[アイコン表示],'
             '[題名の見せ方],[題名の位置],[題名の揃え],[題名に時間],'
             '[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
             [key,color_key,icon,flag,
              normalize_row_title_look(title_look),normalize_row_title_place(title_place),
              normalize_row_title_align(title_align),normalize_row_title_time(title_time),uid,uid])
 return cur.lastrowid,True

def row_style_delete(c_master,row_style_id,uid):
 """既定へ戻す。**行ごと消す**（無効フラグで残すと、同じ区分をもう一度
 設定したときに一意制約とぶつかる）。"""
 ensure_row_style_table(c_master)
 cur=c_master.cursor()
 cur.execute('DELETE FROM [行表示マスタ] WHERE [行表示ID]=?',[row_style_id])
 return cur.rowcount>0

def stop_category_delete(c_master,category_id,uid):
 ensure_stop_category_table(c_master)
 cur=c_master.cursor()
 cur.execute('UPDATE [設備停止分類マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [分類ID]=?',[uid,category_id])
 return cur.rowcount

def stop_category_usage(c_master,category_id):
 """この分類を使っている設備停止マスタの行数(削除前の確認用)。"""
 ensure_stop_category_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [名称] FROM [設備停止分類マスタ] WHERE [分類ID]=?',[category_id])
 row=cur.fetchone()
 if not row:return None,0
 name=str(row[0] or '').strip()
 if STOP_REASON_TABLE not in tables(c_master):return name,0
 cur.execute('SELECT [分類],[有効] FROM [設備停止マスタ]')
 n=0
 for cat,active in cur.fetchall():
  if (True if active is None else bool(active)) and str(cat or '').strip()==name:n+=1
 return name,n

# ========================================================================
# 設備停止マスタ(§5.3)
# ========================================================================
STOP_REASON_TABLE='設備停止マスタ'

# ------------------------------------------------------------------------
# 対象設備(§9.81)
#  [設備名]の1列に「この停止内容がどの設備に登録されているか」を書く。
#  1設備だけでなく、複数設備とワイルドカードも1行で書ける。
#    'A'      … 設備Aだけ(従来の登録はすべてこの形)
#    'A,B,C'  … 列挙した設備
#    '*'      … すべての設備
#  書式はアクセス権限マスタの[現場段取り対象設備]
#  (master_repo.FIELD_REORDER_ALL)と同じにしてある。列を増やすと既存行の
#  移行が要るうえ、判定する場所(サーバー・画面)を全部直さないと
#  「画面では対象なのにサーバーが弾く」といった食い違いが出るため、
#  **書式は文字列のまま・判定はこの5関数へ集約**する
#  (list / text / matches / named / label。呼び出し側で
#   normalize_equipment_name() の直接比較を書かないこと)。
STOP_EQUIPMENT_ALL='*'

def stop_equipment_list(stored):
 """保存文字列を設備名のリストへ。'*'は ['*'] を返す。"""
 s=str(stored or '').strip()
 if not s:return []
 if s==STOP_EQUIPMENT_ALL:return [STOP_EQUIPMENT_ALL]
 return [p.strip() for p in s.replace('、',',').split(',') if p.strip()]

def stop_equipment_text(value):
 """入力(文字列 or 設備名のリスト)を保存用の1列へ。表記ゆれの重複を落とす。
    '*'が1つでも含まれていれば全設備の意味に丸める(併記しても意味が同じで、
    残しておくと「Aと全設備」のような読めない値になるため)。"""
 items=value if isinstance(value,(list,tuple)) else stop_equipment_list(value)
 out=[];seen=set()
 for x in items:
  name=str(x or '').strip()
  if not name:continue
  if name==STOP_EQUIPMENT_ALL:return STOP_EQUIPMENT_ALL
  key=normalize_equipment_name(name)
  if key in seen:continue
  seen.add(key);out.append(name)
 return ','.join(out)

def stop_equipment_matches(stored,equipment):
 """この対象設備に、指定の設備が含まれるか。"""
 items=stop_equipment_list(stored)
 if not items:return False
 if items[0]==STOP_EQUIPMENT_ALL:return True
 target=normalize_equipment_name(equipment)
 if not target:return False
 return any(normalize_equipment_name(x)==target for x in items)

def stop_equipment_named(stored,equipment):
 """対象設備にこの設備名が**名指しで**書かれているか('*'は数えない)。
    設備マスタの削除確認のように「その設備を消したら行き場を失う登録」だけを
    数えたい場面で使う(全設備の行は1台消えても意味を失わないため)。"""
 items=stop_equipment_list(stored)
 if not items or items[0]==STOP_EQUIPMENT_ALL:return False
 target=normalize_equipment_name(equipment)
 return bool(target) and any(normalize_equipment_name(x)==target for x in items)

def stop_equipment_rename(stored,old_name,new_name):
 """カンマ区切りの対象設備の中の1つだけを改名する。**書式を知っているのは
    ここだけ**なので、設備名を持つマスタが増えても読み方は1通りのまま
    (§9.221 の追補)。'*'(すべての設備)は名前を持たないのでそのまま返し、
    1つも当たらなければ元の文字列をそのまま返す(呼び出し側が「書き換えた
    かどうか」を値の同一性で見分けられるようにするため)。"""
 items=stop_equipment_list(stored)
 if not items or items[0]==STOP_EQUIPMENT_ALL:return stored
 old=normalize_equipment_name(old_name)
 new=str(new_name or '').strip()
 if not old or not new:return stored
 out=[new if normalize_equipment_name(x)==old else x for x in items]
 if out==items:return stored
 return stop_equipment_text(out)

def stop_equipment_label(stored):
 """人が読む形("すべての設備" / "設備A / 設備B")。エラー文言と画面で共用。"""
 items=stop_equipment_list(stored)
 if not items:return '(未設定)'
 if items[0]==STOP_EQUIPMENT_ALL:return 'すべての設備'
 return ' / '.join(items)

def _stop_equipment_overlaps(a,b):
 """2つの対象設備が1台でも重なるか('*'はすべてと重なる)。"""
 ia,ib=stop_equipment_list(a),stop_equipment_list(b)
 if not ia or not ib:return False
 if ia[0]==STOP_EQUIPMENT_ALL or ib[0]==STOP_EQUIPMENT_ALL:return True
 sa={normalize_equipment_name(x) for x in ia}
 return any(normalize_equipment_name(x) in sa for x in ib)

def _stop_equipment_same(a,b):
 """対象設備が同じ集合か(表記ゆれは吸収、並び順は問わない)。"""
 ia,ib=stop_equipment_list(a),stop_equipment_list(b)
 return {normalize_equipment_name(x) for x in ia}=={normalize_equipment_name(x) for x in ib}

# ------------------------------------------------------------------------
# 連携機能(§9.377、利用者の指示)
#  「設備停止マスタにカテゴリを1つ増やし…例えば『刃組み』に刃組ガイダンス
#    連携がセットされたとすると、そこをクリックすると刃組ガイダンスに
#    遷移することができるようにします」
#
#  1つの停止内容に**行き先を1つ**結び付ける。空欄(なし)がこれまでどおり。
#  **語彙はここだけが持つ**(§9.163)——画面へ綴りを書き写すと、行き先を
#  増やしたときに2箇所直すことになり、片方だけ直すと「マスタでは選べるのに
#  押しても何も起きない」になる(§CLAUDE 4)。
STOP_LINK_NONE=''
STOP_LINK_BLADESET='bladeset'
STOP_LINK_FEATURES=(
 {'key':STOP_LINK_NONE,'label':'なし',
  'note':'行き先を持たない、ふつうの設備停止です。'},
 # 札の一言は**短く**（長いと札の中で見切れる）。詳しい説明は欄の下の
 # 注意書き（`master-defs.js`の`hint`）が持つ。
 {'key':STOP_LINK_BLADESET,'label':'刃組ガイダンス',
  'note':'予定の行から刃組ガイダンスを開きます'},
)

def stop_link_key(value):
 """保存する連携機能の鍵。**知らない鍵は空(なし)へ倒す**——綴りの間違いが
    「押しても何も起きないボタン」として残るより、なしのほうが読める。"""
 v=str(value or '').strip()
 return v if any(f['key']==v for f in STOP_LINK_FEATURES) else STOP_LINK_NONE

def stop_link_label(value):
 """人が読む形。エラー文言と画面で共用する。"""
 v=stop_link_key(value)
 return next((f['label'] for f in STOP_LINK_FEATURES if f['key']==v),'なし')

def ensure_stop_reason_table(c_master):
 names=tables(c_master);created=False
 if STOP_REASON_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [設備停止マスタ] ([停止理由ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [分類] TEXT, [名称] TEXT, [標準所要分] REAL, [色キー] TEXT, [連携機能] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備停止マスタ_名称] ON [設備停止マスタ] ([設備名],[名称])')
  c_master.commit();created=True
  return created
 # 後から足した列を「無ければ足す」のは`add_missing_columns()`の1箇所(§9.216)。
 add_missing_columns(c_master,STOP_REASON_TABLE,[('連携機能','TEXT')])
 return created

def stop_reason_rows(c_master,equipment=None):
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [停止理由ID],[設備名],[分類],[名称],[標準所要分],[色キー],[表示順],[有効],[更新日時],[更新者ID],[連携機能] FROM [設備停止マスタ] ORDER BY [設備名],[表示順],[名称]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[7] is None else bool(r[7])
  if not active:continue
  # 設備を指定した問い合わせには、その設備を含む行だけを返す
  # (複数設備の行・全設備('*')の行もここで拾う)。
  if equipment and not stop_equipment_matches(r[1],equipment):continue
  rows.append(r)
 return rows

def stop_reason_upsert(c_master,equipment,name,uid,category='',standard_minutes=None,color_key='',stop_reason_id=None,link_key=None):
 # §5.3 / §9.81。対象設備は必須(空なら拒否、他マスタの必須チェックと同じ方式)。
 # 照合の順番:
 #   ① stop_reason_id が来ていれば、その行の更新(対象設備そのものを
 #      入れ替えられるのは、この経路だけ)。
 #   ② 無ければ(対象設備,名称)の自然キーで既存を探し、あれば更新
 #      (backend/routes/masters.pyのaccess_permission_master_registerと同じ方式)。
 #   ③ それも無ければ新規登録。
 ensure_stop_reason_table(c_master)
 equipment=stop_equipment_text(equipment);name=str(name or '').strip()
 if not equipment:raise ValueError('対象設備を選んでください。')
 if not name:raise ValueError('名称を入力してください。')
 # 分類は設備停止分類マスタ(§5.3.1)へ自動で登録する。分類の選択肢を増やす
 # ためだけに別画面へ移動させないための連動(未登録の分類を入力したら、その場で
 # マスタにも増える)。空欄(分類なし)は登録しない。
 category=str(category or '').strip()
 if category:stop_category_upsert(c_master,category,uid)
 cur=c_master.cursor()
 # 対象設備は表記ゆれを吸収して照合する(他の設備名参照と同じ方式)。名称は
 # UNIQUE INDEXの実体に合わせて完全一致(前後空白除去のみ)で照合する。
 cur.execute('SELECT [停止理由ID],[設備名],[名称],[有効] FROM [設備停止マスタ]')
 rows=cur.fetchall()
 target_id=int(stop_reason_id) if str(stop_reason_id or '').strip() else None
 if target_id is not None and not any(r[0]==target_id for r in rows):
  raise ValueError('指定の設備停止理由が見つかりません。')
 same_name=[r for r in rows if str(r[2] or '').strip()==name]
 if target_id is None:
  # 自然キーの照合は**無効化済みの行も対象**にする。削除は論理削除なので、
  # 同じ(対象設備,名称)を登録し直したら元の行を復活させるのが従来の挙動で、
  # かつUNIQUE INDEX([設備名],[名称])があるため新規INSERTでは弾かれる。
  exact=next((r for r in same_name if _stop_equipment_same(r[1],equipment)),None)
  if exact:target_id=exact[0]
 # 同じ名称の行が同じ設備を二重に指すと、その設備には同じ停止内容が2つ並び、
 # 予定の標準所要分をどちらから引くのかも決まらない('*'は全設備と重なる)。
 # 登録の時点で弾き、重なっている相手を文言で示す。**無効化済みの行は数えない**
 # (消したはずの登録が、別の設備の登録を止め続けてしまうため)。
 conflict=next((r for r in same_name
                if r[0]!=target_id and (r[3] is None or bool(r[3]))
                and _stop_equipment_overlaps(r[1],equipment)),None)
 if conflict:
  raise ValueError('「%s」は %s に登録済みです。対象設備が重ならないようにしてください。'
                   %(name,stop_equipment_label(conflict[1])))
 # 連携機能は**渡されたときだけ書く**(§9.212 ②)。呼ぶ側が1つ渡し忘れた
 # だけで、設定してあった行き先が黙って消えるのを防ぐ。
 link=None if link_key is None else stop_link_key(link_key)
 if target_id is not None:
  sets='[設備名]=?,[分類]=?,[名称]=?,[標準所要分]=?,[色キー]=?'
  args=[equipment,category,name,standard_minutes,color_key]
  if link is not None:sets+=',[連携機能]=?';args.append(link)
  cur.execute('UPDATE [設備停止マスタ] SET '+sets+',[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [停止理由ID]=?',
              args+[uid,target_id])
  return target_id,False
 # 表示順は全体の最大+10。対象設備が複数設備・全設備を取れるようになり、
 # 「その設備の中での最大」が一意に決まらなくなったため(同じ行が複数の設備に
 # 属する)。設備ごとの並びは登録順のまま保たれる。
 cur.execute('SELECT Max([表示順]) FROM [設備停止マスタ]')
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [設備停止マスタ] ([設備名],[分類],[名称],[標準所要分],[色キー],[連携機能],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
             [equipment,category,name,standard_minutes,color_key,link or STOP_LINK_NONE,order,uid,uid])
 return cur.lastrowid,True

def stop_reason_copy_name(c_master,equipment,name):
 """複製先の名前を決める（§9.400）。`名称（写し）`、それも埋まっていれば
    `名称（写し2）`…と数える。

    **同じ名前では2行目を作れない**（`[設備名]`×`[名称]`はUNIQUEで、
    `stop_reason_upsert()`は同じ自然キーを見つけると既存行の更新に倒れる）
    ので、**名前だけは必ず変える**。使われているかは**無効化済みの行も
    数える**——論理削除なので、同じ名前を登録し直すと消した行が戻ってくる。"""
 ensure_stop_reason_table(c_master)
 base=str(name or '').strip()
 cur=c_master.cursor()
 cur.execute('SELECT [設備名],[名称] FROM [設備停止マスタ]')
 used={str(nm or '').strip() for eq,nm in cur.fetchall()
       if _stop_equipment_overlaps(eq,equipment)}
 for i in range(1,100):
  cand=f'{base}（写し）' if i==1 else f'{base}（写し{i}）'
  if cand not in used:return cand
 # **勝手な名前を作らない**（§CLAUDE 4）。99通り埋まっているのは、
 # 写しを整理していないということなので、そう言う。
 raise ValueError(f'「{base}」の写しが多すぎます。使っていない写しを消してください。')

def stop_reason_duplicate(c_master,stop_reason_id,uid,name=None):
 """停止内容を1件まるごと写す（§9.400、利用者の指示「停止内容(マスタから
    引っ張ってくるもの)を複製したいです」）。

    **写すのは「その停止内容が持っているもの全部」**——分類・標準所要分・
    色キー・連携機能と、**内訳の木（2段とも・既定の印つき）**。内訳を置いて
    いくと、写した側は「同じ名前なのに選べる内訳が無い」ことになり、
    複製した意味が消える（§CLAUDE 4「できないことは、できないと書く」の前に、
    そもそも中途半端な行を作らない）。

    **対象設備は写さない**——写し元と同じ設備に同じ内容が2つ並ぶのが
    ふつうの使い方（名前を変えて枝分かれさせる）なので、設備まで変えたい
    ときは出来た行を普通に直す（入口を2つにしない）。"""
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [停止理由ID],[設備名],[分類],[名称],[標準所要分],[色キー],[連携機能],[有効] '
             'FROM [設備停止マスタ] WHERE [停止理由ID]=?',[stop_reason_id])
 src=cur.fetchone()
 if not src:raise ValueError('複製元の設備停止が見つかりません。')
 if not (True if src[7] is None else bool(src[7])):
  raise ValueError('消された設備停止は複製できません。')
 equipment=src[1]
 want=str(name or '').strip() or stop_reason_copy_name(c_master,equipment,src[3])
 new_id,created=stop_reason_upsert(c_master,equipment,want,uid,
                                   category=str(src[2] or ''),
                                   standard_minutes=src[4],
                                   color_key=str(src[5] or ''),
                                   link_key=src[6])
 if not created:
  # 既にある行を書き換えてしまった＝名前が重なっている。**黙って上書きしない**。
  raise ValueError(f'「{want}」は既に登録されています。別の名前を指定してください。')
 # 内訳の木を写す。**1段目を先に作り、その新しいIDを親にして2段目を作る**
 # （`stop_sub_rows()`が「親 → その子」の順で返すので、1周で足りる）。
 idmap={}
 subs=0
 for r in stop_sub_rows(c_master,int(src[0])):
  parent=int(r[8] or 0)
  if parent and parent not in idmap:continue      # 親を写せていない子は置いていく
  gid,_made=stop_sub_upsert(c_master,new_id,str(r[2] or ''),uid,
                            standard_minutes=r[3],
                            parent_sub_id=idmap.get(parent,0) if parent else 0,
                            is_default=bool(r[9]) if len(r)>9 else None)
  if not parent:idmap[int(r[0])]=gid
  subs+=1
 return {'id':new_id,'name':want,'subs':subs}

def stop_reason_delete(c_master,stop_reason_id,uid):
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('UPDATE [設備停止マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [停止理由ID]=?',[uid,stop_reason_id])
 return cur.rowcount

def stop_reason_id_of(c_master,equipment,name):
 """(対象設備,名称)から[停止理由ID]を引く。予定の行はIDを持たず名称の写し
    しか持たないので、**予定から内訳を足すときの親探しはここ1箇所**
    (§9.163)。照合は`stop_reason_standard_minutes`と同じ方式。"""
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [停止理由ID],[設備名],[名称],[有効] FROM [設備停止マスタ]')
 target=str(name or '').strip()
 for sid,eq,nm,active in cur.fetchall():
  active=True if active is None else bool(active)
  if active and str(nm or '').strip()==target and stop_equipment_matches(eq,equipment):
   return sid
 return None

def stop_reason_standard_minutes(c_master,equipment,name):
 # §5.1: 設備停止の予定は[見積分]がNULLなら、追加時点ではなく展開の都度
 # このマスタの現在値を引く(スナップショットしない。plan_addのコメント参照)。
 # 予定側にはstopReasonIdの参照列が無いため、(対象設備,名称)の自然キーで
 # 引き直す(対象設備は複数設備・全設備を含めて照合、名称は完全一致。
 # stop_reason_upsertと同じ方式)。同じ設備を指す同名の行はupsertが作らせない
 # ため、最初に見つかった行で確定してよい。
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [設備名],[名称],[標準所要分],[有効] FROM [設備停止マスタ]')
 target_name=str(name or '').strip()
 for eq,nm,minutes,active in cur.fetchall():
  active=True if active is None else bool(active)
  if active and str(nm or '').strip()==target_name and stop_equipment_matches(eq,equipment):
   return minutes
 return None

# ========================================================================
# 設備停止サブカテゴリマスタ(§9.389、利用者の指示)
# ------------------------------------------------------------------------
# 「設備停止マスタにサブカテゴリを登録できるようにしてください。例えば、
#  刃組待ちだったら、ゴムリングとフィンガーと刃出しの3種類があります。
#  そのような種類の違いも後でわかるようにしたいが同じ刃組というグループには
#  入れておきたい」
#
# **3階層になる**: 分類(全設備共通) → 設備停止(設備ごと) → サブカテゴリ。
# 集計の軸として見ると「刃組待ち」で束ねたまま、内訳でゴムリング/フィンガー/
# 刃出しへ割れる——これが利用者の言う「同じグループには入れておきたい」。
#
# **親は設備停止マスタの1行**([停止理由ID])。分類のように全設備共通にしない
# ——サブカテゴリは「その停止内容の内訳」で、停止内容そのものが設備ごとの
# 登録だから、内訳だけを設備から切り離すと親の無い子が作れてしまう。
#
# **自然キーは(停止理由ID,名称)**。設備停止マスタの(設備名,名称)と違い
# 親のIDで割る——別の停止内容が同じ名前の内訳を持つのは普通のこと
# (「刃組待ち>刃出し」と「段取り待ち>刃出し」は別物)。
#
# [標準所要分]は**空にできる**。空＝親の標準所要分をそのまま使う
# (§9.212 ②と同じ「触っていない」の表し方)。刃出しだけ時間が違う、という
# ときにその1行だけ持てばよく、全部の内訳へ同じ数字を書き写さずに済む。
# ========================================================================
STOP_SUB_TABLE='設備停止サブカテゴリマスタ'
# ------------------------------------------------------------------------
# もう1階層（§9.390、利用者の指示「設備停止の内訳はもう1階層増やすことが
# できるようにしてください」）
# ------------------------------------------------------------------------
# 内訳の下にもう1段だけ置ける（分類 → 停止内容 → 内訳 → 内訳の内訳）。
# **親は同じ表の行**（`[親サブカテゴリID]`）で、**深さは2段まで**——
# 底なしの木にすると、予定へ入れる手順が何段になるか決められない
# （§CLAUDE 2「次にすることを常に1つだけ指す」）。
#
# **親なしは`0`で持つ。`NULL`にしない。** SQLiteのUNIQUE INDEXは
# **NULL同士を別物として扱う**ので、親をNULLにすると
# `(停止理由ID,親,名称)`の重複を1つも止められない（同じ名前の1段目が
# いくつでも作れてしまう）。
STOP_SUB_PARENT_COLUMN='親サブカテゴリID'
STOP_SUB_ROOT=0
# 名前の自然キー。**親まで入れる**——「刃組待ち>ゴムリング>交換」と
# 「刃組待ち>フィンガー>交換」は別物で、親を入れないと2つ目が作れない。
_STOP_SUB_INDEX='UX_設備停止サブカテゴリマスタ_名称'
# 既定の内訳（§9.397、利用者の指示「内訳は1つしかない場合はそれを既定に。
# 2つ以上あっても既定のものを設定して登録できるように」）。
# **兄弟のうち1つだけ**が持つ印（同じ`[停止理由ID]`・同じ`[親サブカテゴリID]`
# の中で1つ）。UNIQUEでは守れない（0が何行あってもよいので）ため、
# `stop_sub_upsert()`が立てるときに兄弟を降ろす——**守るのは1箇所**。
STOP_SUB_DEFAULT_COLUMN='既定'
_STOP_SUB_COLS=('[サブカテゴリID],[停止理由ID],[名称],[標準所要分],[表示順],[有効],'
                '[更新日時],[更新者ID],[親サブカテゴリID],[既定]')

def ensure_stop_sub_table(c_master):
 names=tables(c_master);created=False
 if STOP_SUB_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [設備停止サブカテゴリマスタ] ([サブカテゴリID] INTEGER PRIMARY KEY AUTOINCREMENT, [停止理由ID] INTEGER, [親サブカテゴリID] INTEGER, [名称] TEXT, [標準所要分] REAL, [表示順] INTEGER, [有効] INTEGER, [既定] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute(f'CREATE UNIQUE INDEX [{_STOP_SUB_INDEX}] ON [設備停止サブカテゴリマスタ] ([停止理由ID],[親サブカテゴリID],[名称])')
  c_master.commit();created=True
  return created
 # 後から足した列は`add_missing_columns()`の1箇所（§9.216）。
 add_missing_columns(c_master,STOP_SUB_TABLE,[(STOP_SUB_PARENT_COLUMN,'INTEGER'),
                                             (STOP_SUB_DEFAULT_COLUMN,'INTEGER')])
 cur=c_master.cursor()
 # **足した列のNULLは0へ寄せる**（親なし）。NULLのままだと自然キーの照合も
 # UNIQUEも効かない（上のコメント）。
 cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [親サブカテゴリID]=? WHERE [親サブカテゴリID] IS NULL',[STOP_SUB_ROOT])
 # 古い索引（親を含まない）は張り替える。**索引は導出物**なので作り直して
 # よい（行は1つも触らない）。名前が同じでも中身が違うので、列の顔ぶれで見る。
 try:
  cols=[r[2] for r in cur.execute(f'PRAGMA index_info([{_STOP_SUB_INDEX}])').fetchall()]
  if cols and STOP_SUB_PARENT_COLUMN not in cols:
   cur.execute(f'DROP INDEX [{_STOP_SUB_INDEX}]')
   cur.execute(f'CREATE UNIQUE INDEX [{_STOP_SUB_INDEX}] ON [設備停止サブカテゴリマスタ] ([停止理由ID],[親サブカテゴリID],[名称])')
 except Exception as _e:
  quiet('内訳の索引を張り替えられない（重複の見張りが緩むだけ）',_e)
 c_master.commit()
 return created

def stop_sub_rows(c_master,stop_reason_id=None):
 """有効なサブカテゴリ。
    r: サブカテゴリID,停止理由ID,名称,標準所要分,表示順,有効,更新日時,更新者ID,親サブカテゴリID,既定
    **並びは「親 → その子」**（`[親サブカテゴリID]`が0の行が先）。"""
 ensure_stop_sub_table(c_master)
 cur=c_master.cursor()
 cur.execute(f'SELECT {_STOP_SUB_COLS} FROM [設備停止サブカテゴリマスタ] ORDER BY [停止理由ID],[表示順],[名称]')
 rows=[]
 target=None if stop_reason_id in (None,'') else int(stop_reason_id)
 for r in cur.fetchall():
  if not (True if r[5] is None else bool(r[5])):continue
  if target is not None and int(r[1] or 0)!=target:continue
  rows.append(r)
 # 親を先に、その直後へ子を並べる（画面が木を組み直さずに描ける）。
 top=[r for r in rows if not int(r[8] or 0)]
 kids={}
 for r in rows:
  p=int(r[8] or 0)
  if p:kids.setdefault(p,[]).append(r)
 out=[]
 for r in top:
  out.append(r)
  out.extend(kids.pop(int(r[0]),[]))
 # 親を失った子（親だけ消された）も落とさない——見えないと消せない。
 for rest in kids.values():out.extend(rest)
 return out

def stop_sub_row(c_master,sub_id):
 """1件。**無効化済みも返す**(消えた内訳を参照している予定の名前を出すため)。"""
 ensure_stop_sub_table(c_master)
 cur=c_master.cursor()
 cur.execute(f'SELECT {_STOP_SUB_COLS} FROM [設備停止サブカテゴリマスタ] WHERE [サブカテゴリID]=?',[sub_id])
 return cur.fetchone()

def stop_sub_parent_of(c_master,sub_id):
 """その内訳の親の行（1段目）。親なし・見つからないときは None。"""
 row=stop_sub_row(c_master,sub_id)
 if not row:return None
 p=int(row[8] or 0)
 return stop_sub_row(c_master,p) if p else None

def stop_sub_upsert(c_master,stop_reason_id,name,uid,standard_minutes=None,sub_id=None,
                    parent_sub_id=None,is_default=None):
 """内訳の登録・改名。照合の順番は設備停止マスタと同じ3段
    (①IDが来ていればその行 ②(停止理由ID,親,名称)の自然キー ③新規)。

    `parent_sub_id`＝同じ停止内容の**1段目の内訳**（§9.390）。省略・0なら
    1段目そのもの。**深さは2段まで**——子を親にはできない。

    `is_default`＝既定の内訳（§9.397）。**`None`は「触っていない」**で、
    今の印をそのまま残す（§9.212 ②）——名前や分を直すたびに既定が落ちると、
    直した人は何が起きたか分からない。真を渡したときだけ**兄弟の印を降ろす**
    （同じ親の下で既定は1つ。守るのはここ1箇所）。"""
 ensure_stop_sub_table(c_master)
 ensure_stop_reason_table(c_master)
 name=str(name or '').strip()
 if not name:raise ValueError('サブカテゴリ名を入力してください。')
 pid=None if stop_reason_id in (None,'') else int(stop_reason_id)
 if pid is None:raise ValueError('どの設備停止の内訳かを選んでください。')
 cur=c_master.cursor()
 cur.execute('SELECT [停止理由ID] FROM [設備停止マスタ] WHERE [停止理由ID]=?',[pid])
 if not cur.fetchone():raise ValueError('指定の設備停止が見つかりません。')
 cur.execute('SELECT [サブカテゴリID],[停止理由ID],[名称],[親サブカテゴリID] FROM [設備停止サブカテゴリマスタ]')
 rows=cur.fetchall()
 target_id=int(sub_id) if str(sub_id or '').strip() else None
 if target_id is not None and not any(r[0]==target_id for r in rows):
  raise ValueError('指定のサブカテゴリが見つかりません。')
 parent=int(parent_sub_id) if str(parent_sub_id or '').strip() else STOP_SUB_ROOT
 if parent:
  up=next((r for r in rows if r[0]==parent),None)
  if not up:raise ValueError('親の内訳が見つかりません。')
  if int(up[1] or 0)!=pid:raise ValueError('親の内訳は別の設備停止のものです。')
  if int(up[3] or 0):raise ValueError('内訳の階層は2段までです（内訳の内訳を、さらに分けることはできません）。')
  if target_id is not None and parent==target_id:
   raise ValueError('自分自身を親にはできません。')
 elif target_id is not None and any(int(r[3] or 0)==target_id for r in rows):
  # 子を持つ行は1段目のまま。子ごと動かす操作は用意していない（§CLAUDE 4）。
  if str(parent_sub_id or '').strip():
   raise ValueError('内訳の内訳を持つ行は、ほかの内訳の下へ移せません。')
 # **無効化済みの行も照合の対象**(削除は論理削除なので、同じ名前を登録し
 # 直したら元の行が戻る。設備停止マスタと同じ挙動・UNIQUE INDEXの実体とも合う)。
 same=next((r for r in rows if int(r[1] or 0)==pid and int(r[3] or 0)==parent
            and str(r[2] or '').strip()==name),None)
 if target_id is None and same:target_id=same[0]
 if target_id is not None and same and same[0]!=target_id:
  raise ValueError(f'「{name}」はこの場所に既に登録されています。')
 if target_id is not None:
  cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [停止理由ID]=?,[親サブカテゴリID]=?,[名称]=?,[標準所要分]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [サブカテゴリID]=?',
              [pid,parent,name,standard_minutes,uid,target_id])
  _stop_sub_set_default(cur,pid,parent,target_id,is_default,uid)
  return target_id,False
 # 表示順は**その親の中での最大+10**(内訳は親ごとに並ぶので、全体の最大に
 # すると別の親を足すたびに番号が飛ぶ)。
 cur.execute('SELECT Max([表示順]) FROM [設備停止サブカテゴリマスタ] WHERE [停止理由ID]=? AND [親サブカテゴリID]=?',[pid,parent])
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [設備停止サブカテゴリマスタ] ([停止理由ID],[親サブカテゴリID],[名称],[標準所要分],[表示順],[有効],[既定],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,0,?,?,Now(),Now())',
             [pid,parent,name,standard_minutes,order,uid,uid])
 new_id=cur.lastrowid
 _stop_sub_set_default(cur,pid,parent,new_id,is_default,uid)
 return new_id,True

def _stop_sub_set_default(cur,pid,parent,sub_id,is_default,uid):
 """既定の印を立てる／降ろす（§9.397）。**`None`は触らない**。
    立てるときは**同じ親の兄弟をまとめて降ろす**——2つ既定があると、
    どちらが最初から選ばれるのかを決められない（§CLAUDE 「推測させない」）。"""
 if is_default is None:return
 if is_default:
  cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [既定]=0,[更新者ID]=?,[更新日時]=Now() '
              'WHERE [停止理由ID]=? AND [親サブカテゴリID]=? AND [サブカテゴリID]<>?',[uid,pid,parent,sub_id])
  cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [既定]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [サブカテゴリID]=?',[uid,sub_id])
 else:
  cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [既定]=0,[更新者ID]=?,[更新日時]=Now() WHERE [サブカテゴリID]=?',[uid,sub_id])

def stop_sub_delete(c_master,sub_id,uid):
 """内訳を消す。**子も一緒に消す**（§9.390）——親だけ消すと、どこにも
    ぶら下がっていない内訳が予定の選択肢に出続ける（§CLAUDE 4）。"""
 ensure_stop_sub_table(c_master)
 cur=c_master.cursor()
 cur.execute('UPDATE [設備停止サブカテゴリマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [サブカテゴリID]=? OR [親サブカテゴリID]=?',
             [uid,sub_id,sub_id])
 return cur.rowcount

def stop_default_sub(c_master,stop_reason_id,parent_sub_id=STOP_SUB_ROOT):
 """最初から選ばれている内訳のID（§9.397、利用者の指示）。

 「内訳は1つしかない場合はそれを既定に。2つ以上あっても既定のものを
   設定して登録できるようにしてください」

    順は **①候補が1つならそれ ②`[既定]`の印がある行 ③無し（未選択）**。
    ①を①に置くのは利用者の言葉どおりで、**印を付け忘れていても迷わせない**
    ため——選択肢が1つしかない場面で「選んでください」と出すのは、
    できないことを聞いているのと同じ（§CLAUDE 2）。

    **答えるのはここ1箇所**（§9.163）。予定の登録画面とマスタ管理の両方が
    この答えを読む——2つの画面が別々に数えると、「既定」と出ている内訳と
    実際に選ばれる内訳が食い違う。"""
 pid=int(stop_reason_id or 0);parent=int(parent_sub_id or 0)
 kids=[r for r in stop_sub_rows(c_master,pid) if int(r[8] or 0)==parent]
 if not kids:return None
 if len(kids)==1:return kids[0][0]
 hit=next((r for r in kids if (r[9] if len(r)>9 else 0)),None)
 return hit[0] if hit else None

def stop_default_sub_map(c_master):
 """{'停止理由ID:親サブカテゴリID': サブカテゴリID}。画面が段ごとに
    聞き直さずに済むよう、1度の問い合わせで全部答える。"""
 groups={}
 for r in stop_sub_rows(c_master):
  groups.setdefault((int(r[1] or 0),int(r[8] or 0)),[]).append(r)
 out={}
 for (pid,parent),kids in groups.items():
  if len(kids)==1:pick=kids[0][0]
  else:
   hit=next((r for r in kids if (r[9] if len(r)>9 else 0)),None)
   pick=hit[0] if hit else None
  if pick is not None:out['%d:%d'%(pid,parent)]=pick
 return out

def stop_sub_counts(c_master):
 """{停止理由ID: 1段目の件数}。一覧が「内訳を持つ停止内容」を1度の
    問い合わせで見分けられるようにする(行ごとに聞き直すと設備停止の数だけ
    往復する)。**数えるのは1段目だけ**——2段目まで足すと、同じ「3件」が
    「3つに分かれる」なのか「3つの内訳の合計」なのか読めない。"""
 out={}
 for r in stop_sub_rows(c_master):
  if int(r[8] or 0):continue
  pid=int(r[1] or 0)
  out[pid]=out.get(pid,0)+1
 return out

# ========================================================================
# 設備停止時間マスタ(§9.389、利用者の指示)
# ------------------------------------------------------------------------
# 「設備停止マスタから、時間を切り離して、設備停止時間マスタに分割し…
#  設備停止内容を選択し、その後時間を選択して登録するようにしたい。
#  そうした方が集計の時にすっきり集計しやすくなる」
#  「時間のマスタは全体で共通、時間の選択マスタとしては機能させる。
#   数値として扱うものなのであくまで選択肢を作るマスタ」
#
# **持つのは分だけ**。名前も色も分類も持たない——「30分」は全設備で30分で、
# 呼び名を付けると設備ごとに別の意味を持たせたくなる(分類マスタと逆の判断:
# あちらは意味の軸なので名前が要る)。書式は`WL.duration`の1箇所が答える
# (§9.341)ので、ここに「1時間30分」のような文字は持たせない。
#
# **設備停止マスタの[標準所要分]は残す**(利用者の指示「既定値として残す」)。
# あちらは「この停止はふつう何分か」で、こちらは「選ばせる刻み」——役割が
# 違うので片方に寄せられない。登録の画面は標準所要分を最初から選んだ状態で
# 開き、違うときだけ選び直す(§CLAUDE 2「次にすることを常に1つだけ指す」)。
# ========================================================================
STOP_MINUTES_TABLE='設備停止時間マスタ'
# 初回作成時に入れておく選択肢。**現場が足せる**ので、ここは「よくある刻み」
# だけ。5分刻みの細かい値まで並べると、選ぶ側が数える羽目になる(§CLAUDE 2)。
STOP_MINUTES_SEEDS=(10,15,20,30,45,60,90,120,180,240)
# スライダーの刻み。**選択肢の間を埋めるためのもの**なので、選択肢そのものの
# 刻みより細かくてよい(60分の選択肢から65分へ寄せる、という使い方)。
STOP_MINUTES_STEP=5

def ensure_stop_minutes_table(c_master):
 names=tables(c_master);created=False
 if STOP_MINUTES_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [設備停止時間マスタ] ([時間ID] INTEGER PRIMARY KEY AUTOINCREMENT, [分] REAL, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_設備停止時間マスタ_分] ON [設備停止時間マスタ] ([分])')
  c_master.commit();created=True
  for i,m in enumerate(STOP_MINUTES_SEEDS):
   cur.execute('INSERT INTO [設備停止時間マスタ] ([分],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',
               [float(m),(i+1)*10,'migrate:seed','migrate:seed'])
  c_master.commit()
 return created

def stop_minutes_normalize(value):
 """保存する分。**0以下・数でないものは断る**(0分の停止は行を置く意味が
    無く、負の時間は後続の予定を前へ引っ張る)。0.1分まで持つ。"""
 try:m=float(value)
 except (TypeError,ValueError):raise ValueError('時間は数値で入力してください。')
 if not (m>0):raise ValueError('時間は0より大きい値を入力してください。')
 return round(m,1)

def stop_minutes_rows(c_master):
 """r: 時間ID,分,表示順,有効,更新日時,更新者ID。**分の小さい順**に返す
    ——数の並びは1通りしかないので、[表示順]で並べ替えさせない
    (並べ替えられる形にすると「120の次が45」の一覧を作れてしまう)。"""
 ensure_stop_minutes_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [時間ID],[分],[表示順],[有効],[更新日時],[更新者ID] FROM [設備停止時間マスタ]')
 rows=[r for r in cur.fetchall() if (True if r[3] is None else bool(r[3]))]
 return sorted(rows,key=lambda r:float(r[1] or 0))

def stop_minutes_values(c_master):
 return [float(r[1] or 0) for r in stop_minutes_rows(c_master)]

def stop_minutes_upsert(c_master,minutes,uid,minutes_id=None):
 ensure_stop_minutes_table(c_master)
 m=stop_minutes_normalize(minutes)
 cur=c_master.cursor()
 cur.execute('SELECT [時間ID],[分] FROM [設備停止時間マスタ]')
 rows=cur.fetchall()
 target_id=int(minutes_id) if str(minutes_id or '').strip() else None
 if target_id is not None and not any(r[0]==target_id for r in rows):
  raise ValueError('指定の時間が見つかりません。')
 same=next((r for r in rows if abs(float(r[1] or 0)-m)<0.05),None)
 if target_id is None and same:target_id=same[0]
 if target_id is not None and same and same[0]!=target_id:
  raise ValueError('その時間は既に登録されています。')
 if target_id is not None:
  cur.execute('UPDATE [設備停止時間マスタ] SET [分]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [時間ID]=?',[m,uid,target_id])
  return target_id,False
 cur.execute('SELECT Max([表示順]) FROM [設備停止時間マスタ]')
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [設備停止時間マスタ] ([分],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',
             [m,order,uid,uid])
 return cur.lastrowid,True

def stop_minutes_delete(c_master,minutes_id,uid):
 ensure_stop_minutes_table(c_master)
 cur=c_master.cursor()
 cur.execute('UPDATE [設備停止時間マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [時間ID]=?',[uid,minutes_id])
 return cur.rowcount

def stop_minutes_slider(c_master):
 """スライダーの範囲。**選択肢そのものから作る**(§9.163)——別の設定値に
    すると「選択肢には240分があるのにスライダーは120分で止まる」が起きる。
    選択肢が1件以下なら`None`。画面はそのときスライダーを出さない
    (動かせない目盛りを置かない・§CLAUDE 4)。"""
 vals=stop_minutes_values(c_master)
 if len(vals)<2:return None
 lo,hi=min(vals),max(vals)
 if hi<=lo:return None
 return {'min':lo,'max':hi,'step':float(STOP_MINUTES_STEP)}

def stop_default_minutes(c_master,stop_reason_id,sub_id=None):
 """登録の画面を開いたときに**最初から選ばれている分**。
    効く順は「サブカテゴリの標準所要分 → 設備停止の標準所要分 → 無し」。
    **答えるのはここ1箇所**(§9.163)——画面とサーバーで順番がずれると、
    出ている数字と実際に入る数字が食い違う。"""
 # **内訳が2段になった**（§9.390）ので、下から順に見る
 # （内訳の内訳 → 内訳 → 停止内容 → 無し）。
 sid=None if sub_id in (None,'') else int(sub_id)
 while sid:
  sub=stop_sub_row(c_master,sid)
  if not sub:break
  if sub[3] is not None and str(sub[3]).strip()!='':
   try:return float(sub[3])
   except (TypeError,ValueError):quiet('サブカテゴリの標準所要分を読めない（親の値へ倒す）',None)
  sid=int(sub[8] or 0)
 ensure_stop_reason_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [標準所要分] FROM [設備停止マスタ] WHERE [停止理由ID]=?',[stop_reason_id])
 row=cur.fetchone()
 if row and row[0] is not None and str(row[0]).strip()!='':
  try:return float(row[0])
  except (TypeError,ValueError):quiet('設備停止の標準所要分を読めない（既定なしで続ける）',None)
 return None

# ========================================================================
# 換算係数上書きマスタ(§5.4、DBテーブル名は既存互換のため`負荷率上書きマスタ`のまま)
#  - テーブル定義のみフェーズ2で用意する。算出・上書きAPI・見積内訳は
#    backend/load_factor.py(フェーズ5、未実装)が持つ。
# ========================================================================
LOAD_FACTOR_OVERRIDE_TABLE='負荷率上書きマスタ'

def ensure_load_factor_override_table(c_master):
 names=tables(c_master);created=False
 if LOAD_FACTOR_OVERRIDE_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [負荷率上書きマスタ] ([上書きID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [因子] TEXT, [水準] TEXT, [係数] REAL, [理由] TEXT, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_負荷率上書き] ON [負荷率上書きマスタ] ([設備名],[因子],[水準])')
  c_master.commit();created=True
 return created

def load_factor_override_rows(c_master,equipment=None):
 # §5.4。設備名は空文字が「全設備共通」の意味を持つため、他マスタと違い
 # normalize_equipment_nameでの絞り込みはしない(呼び出し側で設備別/全体
 # 共通の両方を必要に応じて引く。load_factor.pyのresolve_overrides参照)。
 ensure_load_factor_override_table(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [上書きID],[設備名],[因子],[水準],[係数],[理由],[有効],[更新日時],[更新者ID] FROM [負荷率上書きマスタ] ORDER BY [設備名],[因子],[水準]')
 rows=[]
 for r in cur.fetchall():
  active=True if r[6] is None else bool(r[6])
  if not active:continue
  if equipment is not None and str(r[1] or '').strip()!=str(equipment or '').strip():continue
  rows.append(r)
 return rows

def load_factor_override_upsert(c_master,equipment,factor,level,uid,coefficient=None,reason=''):
 # 因子='BASE'のときは[水準]は空文字固定(§5.4「因子='BASE'のときは空」)。
 ensure_load_factor_override_table(c_master)
 equipment=str(equipment or '').strip();factor=str(factor or '').strip();level='' if factor=='BASE' else str(level or '').strip()
 if not factor:raise ValueError('因子を指定してください。')
 cur=c_master.cursor()
 cur.execute('SELECT [上書きID] FROM [負荷率上書きマスタ] WHERE [設備名]=? AND [因子]=? AND [水準]=?',[equipment,factor,level])
 existing=cur.fetchone()
 if existing:
  cur.execute('UPDATE [負荷率上書きマスタ] SET [係数]=?,[理由]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [上書きID]=?',
              [coefficient,reason,uid,existing[0]])
  return existing[0],False
 cur.execute('INSERT INTO [負荷率上書きマスタ] ([設備名],[因子],[水準],[係数],[理由],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',
             [equipment,factor,level,coefficient,reason,uid,uid])
 return cur.lastrowid,True

def load_factor_override_delete(c_master,override_id,uid):
 ensure_load_factor_override_table(c_master)
 cur=c_master.cursor()
 cur.execute('UPDATE [負荷率上書きマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [上書きID]=?',[uid,override_id])
 return cur.rowcount

def base_minutes_override(c_master,equipment):
 # §6.1のT0(基準時間)。因子='BASE'(水準は空)の行を設備別優先で読む。
 # フェーズ5(load_factor.py)が実績から自動算出するまでの間、
 # schedule_calc.pyの「一律見積(係数1.0)」はこの値(無ければ既定値)を使う。
 ensure_load_factor_override_table(c_master)
 cur=c_master.cursor()
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
# 現場歴の日付補正(§9.195)。日を跨ぐ勤務区分の**跨いだ後の時間帯**に当てる
# 日数。未設定は -1（＝跨いだ部分は前の日として数える。3直 23:00〜翌7:00 の
# 翌2:00は「その日の3直」）。跨がない区分には効かない（当てる時間帯が無い）。
# **日付の演算をここへ埋め込まないこと**(利用者の指示)——現場ごとに
# 「どこで日が変わるか」は違うので、マスタの1列で直せる形にしてある。
SHIFT_SEGMENT_DAYOFF_COLUMN=('日付補正','INTEGER')
SHIFT_DAYOFF_DEFAULT=-1
SHIFT_DAYOFF_LIMIT=7

SHIFT_TABLE='勤務形態マスタ'          # 旧・フラット構造(移行元としてのみ参照)
SHIFT_PATTERN_TABLE='勤務体系マスタ'   # 親: 日勤 / 交替勤務(1,2,3直) など
SHIFT_SEGMENT_TABLE='勤務区分マスタ'   # 子: 1直 7:00-15:00 など

def ensure_shift_table(c_master):
 """旧フラット構造。**移行元として読むだけなので、無ければ作らない**
 （§9.255 ①、利用者の報告「移行済みデータをすべて消したはずが、
 復活しました」）。以前は「無ければ作る」だったので、設定系マスタを
 用意するたび（＝スケジュールを開くたび）に空の`勤務形態マスタ`が
 作り直され、マスタ管理の「移行済み」から消えなかった。
 **ここを「無ければ作る」に戻さないこと。**"""
 return False

def ensure_shift_pattern_tables(c_master):
 """勤務体系(親)と勤務区分(子)の2テーブル。
 現場の言い方に合わせた2階層にする:
   日勤              -> 日勤 8:15-17:05
   交替勤務(1,2,3直) -> 1直 7:00-15:00 / 2直 15:00-23:00 / 3直 23:00-翌7:00
   交替勤務(4,5直)   -> 4直 11:00-19:10 / 5直 21:20-翌5:45
 以前は「名称+開始+終了」のフラットな1テーブルだったため、どの直が
 どの勤務体系に属するのかを表現できず、体系ごと切り替えることもできなかった。
 [適用設備]は他のマスタと同じ規約で、空文字=全設備既定・設備名指定=その設備専用。"""
 names=tables(c_master);created=False
 if SHIFT_PATTERN_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [勤務体系マスタ] ([勤務体系ID] INTEGER PRIMARY KEY AUTOINCREMENT, [適用設備] TEXT, [名称] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_勤務体系マスタ_設備] ON [勤務体系マスタ] ([適用設備])')
  c_master.commit();created=True
 if SHIFT_SEGMENT_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [勤務区分マスタ] ([勤務区分ID] INTEGER PRIMARY KEY AUTOINCREMENT, [勤務体系ID] INTEGER, [名称] TEXT, [開始時刻] TEXT, [終了時刻] TEXT, [表示順] INTEGER, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE INDEX [IX_勤務区分マスタ_体系] ON [勤務区分マスタ] ([勤務体系ID])')
  c_master.commit();created=True
 if SHIFT_PATTERN_EQUIPMENT_TABLE not in names:
  cur=c_master.cursor()
  cur.execute('CREATE TABLE [勤務体系設備マスタ] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [勤務体系ID] INTEGER, [設備名] TEXT, [登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
  cur.execute('CREATE UNIQUE INDEX [UX_勤務体系設備マスタ] ON [勤務体系設備マスタ] ([勤務体系ID],[設備名])')
  c_master.commit();created=True
 # 日付補正(§9.195)は後から足した列。現場で動いているDBを作り直さないため
 # 「無ければALTER TABLEで足す」方式にする(他のマスタと同じ)。
 add_missing_columns(c_master,SHIFT_SEGMENT_TABLE,(SHIFT_SEGMENT_DAYOFF_COLUMN,))
 _migrate_shift_pattern_equipment(c_master)
 return created

def crosses_midnight(start,end):
 """日を跨ぐ勤務区分か（終了<=開始）。判定はここ1箇所。"""
 def hm(v):
  t=str(v or '').strip().split(':')
  try:return int(t[0])*60+int(t[1])
  except Exception as _e:quiet('数として読めない（既定で続ける）',_e);return None
 a,b=hm(start),hm(end)
 if a is None or b is None:return False
 return b<=a

def segment_day_offset(start,end,raw):
 """この区分の「跨いだ後の時間帯」に当てる日付補正（現場歴。§9.195）。

 **跨がない区分は必ず0**——当てる時間帯そのものが無いので、値を持たせても
 効かない（効かない設定を画面に出さないための判定もここを見る）。
 未設定は -1。0を明示すれば太陽暦どおりに戻せる。"""
 if not crosses_midnight(start,end):return 0
 if raw in (None,''):return SHIFT_DAYOFF_DEFAULT
 try:n=int(raw)
 except Exception as _e:quiet('数として読めない（既定で続ける）',_e);return SHIFT_DAYOFF_DEFAULT
 return max(-SHIFT_DAYOFF_LIMIT,min(SHIFT_DAYOFF_LIMIT,n))

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

def _migrate_shift_pattern_equipment(c_master):
 """旧[適用設備](単一値)を子テーブルへ1回だけ移す。"""
 global _SHIFT_PATTERN_EQUIPMENT_MIGRATED
 if _SHIFT_PATTERN_EQUIPMENT_MIGRATED:return
 try:
  cur=c_master.cursor()
  cur.execute('SELECT [勤務体系ID],[適用設備] FROM [勤務体系マスタ]')
  pending=[(pid,str(eq or '').strip()) for pid,eq in cur.fetchall() if str(eq or '').strip()]
  for pid,eq in pending:
   cur.execute('SELECT COUNT(*) FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?',[pid])
   if int(cur.fetchone()[0] or 0):continue
   cur.execute('INSERT INTO [勤務体系設備マスタ] ([勤務体系ID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',
               [pid,eq,'migrate:shift-equipment','migrate:shift-equipment'])
   cur.execute('UPDATE [勤務体系マスタ] SET [適用設備]=? WHERE [勤務体系ID]=?',['',pid])
  if pending:c_master.commit()
  _SHIFT_PATTERN_EQUIPMENT_MIGRATED=True
 except Exception as _e:
  quiet('勤務体系の設備を移し替えられない（次に開いたときに試す）',_e)

def shift_pattern_equipment_map(c_master):
 """{勤務体系ID: [設備名, ...]}。割当の無い体系はキー自体が無い(=全設備既定)。"""
 ensure_shift_pattern_tables(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [勤務体系ID],[設備名] FROM [勤務体系設備マスタ] ORDER BY [設備名]')
 out={}
 for pid,name in cur.fetchall():
  nm=str(name or '').strip()
  if nm:out.setdefault(pid,[]).append(nm)
 return out

def set_shift_pattern_equipment(c_master,pattern_id,names,uid):
 """指定体系の適用設備を names の内容へ完全同期する(増分の追加・削除)。"""
 ensure_shift_pattern_tables(c_master)
 cur=c_master.cursor()
 wanted={str(n).strip() for n in (names or []) if str(n or '').strip()}
 cur.execute('SELECT [ID],[設備名] FROM [勤務体系設備マスタ] WHERE [勤務体系ID]=?',[pattern_id])
 existing={str(r[1] or '').strip():r[0] for r in cur.fetchall()}
 for nm,rid in existing.items():
  if nm not in wanted:cur.execute('DELETE FROM [勤務体系設備マスタ] WHERE [ID]=?',[rid])
 for nm in wanted:
  if nm not in existing:
   cur.execute('INSERT INTO [勤務体系設備マスタ] ([勤務体系ID],[設備名],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,Now(),Now())',
               [pattern_id,nm,uid,uid])

def shift_pattern_rows(c_master,equipment=None):
 """勤務体系の一覧。equipment指定時はその設備が割当に含まれる体系、
 未指定なら割当0件の体系(=全設備既定)。equipment='__all__'で全件。"""
 ensure_shift_pattern_tables(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [勤務体系ID],[適用設備],[名称],[表示順],[有効] FROM [勤務体系マスタ] ORDER BY [表示順],[勤務体系ID]')
 rows=[r for r in cur.fetchall() if (True if r[4] is None else bool(r[4]))]
 if equipment=='__all__':return rows
 assigned=shift_pattern_equipment_map(c_master)
 if not equipment:
  # 全設備既定 = どの設備にも割り当てていない体系
  return [r for r in rows if not assigned.get(r[0])]
 target=normalize_equipment_name(equipment)
 return [r for r in rows
         if any(normalize_equipment_name(n)==target for n in assigned.get(r[0],[]))]

def shift_segment_rows(c_master,pattern_id):
 ensure_shift_pattern_tables(c_master)
 cur=c_master.cursor()
 cur.execute('SELECT [勤務区分ID],[勤務体系ID],[名称],[開始時刻],[終了時刻],[表示順],[有効],[日付補正] FROM [勤務区分マスタ] WHERE [勤務体系ID]=? ORDER BY [表示順],[勤務区分ID]',[pattern_id])
 # 8番目に**効いている日付補正**を載せる。生の値ではなく解決済みにするのは、
 # 読む側（画面・schedule_calc）が既定の決め方を持たなくて済むようにするため。
 return [tuple(r[:7])+(segment_day_offset(r[3],r[4],r[7]),)
         for r in cur.fetchall() if (True if r[6] is None else bool(r[6]))]

def shift_rows(c_master,equipment=None):
 """勤務名称の解決に使う勤務区分の一覧。
 **戻り値のタプル形は旧フラット構造のまま**
 (勤務ID,設備名,名称,開始時刻,終了時刻,表示順,有効)にしてある。
 schedule_calc.resolve_shift_label()は形しか見ないため、階層化しても
 あちらは無改修で済む(呼び出し規約: equipment未指定=全設備既定)。
 該当設備の勤務体系が複数あれば表示順で最初の1件を使う。"""
 migrate_shift_patterns(c_master)
 patterns=shift_pattern_rows(c_master,equipment)
 if not patterns:return []
 # [適用設備]列は移行済みで空。呼び出し元が渡した設備名をそのまま載せる
 # (resolve_shift_label()は形しか見ないが、意味のある値を入れておく)。
 pid=patterns[0][0]
 eq=str(equipment or '')
 # 8番目の日付補正(§9.195)も渡す。resolve_shift_label は形しか見ないので
 # 足しても壊れない（読むのは resolve_shift_info だけ）。
 return [(r[0],eq,r[2],r[3],r[4],r[5],r[6],r[7]) for r in shift_segment_rows(c_master,pid)]

def shift_pattern_upsert(c_master,pattern_id,equipment,name,uid):
 """equipmentは設備名のリスト(複数可)。空リスト=全設備既定。
 互換のため単一の文字列を渡された場合も1件のリストとして扱う。"""
 ensure_shift_pattern_tables(c_master)
 if isinstance(equipment,str):equipment=[equipment] if equipment.strip() else []
 names=[str(n).strip() for n in (equipment or []) if str(n or '').strip()]
 name=str(name or '').strip()
 if not name:raise ValueError('勤務体系の名称を入力してください。')
 cur=c_master.cursor()
 if pattern_id:
  # [適用設備]列は移行済みで読まれない。単一の情報源を保つため空のまま更新する。
  cur.execute('UPDATE [勤務体系マスタ] SET [適用設備]=?,[名称]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [勤務体系ID]=?',['',name,uid,pattern_id])
  if cur.rowcount==0:raise ValueError('指定の勤務体系が見つかりません。')
  set_shift_pattern_equipment(c_master,pattern_id,names,uid)
  return pattern_id,False
 cur.execute('SELECT Max([表示順]) FROM [勤務体系マスタ]')
 order=int((cur.fetchone()[0]) or 0)+10
 cur.execute('INSERT INTO [勤務体系マスタ] ([適用設備],[名称],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',['',name,order,uid,uid])
 new_id=cur.lastrowid
 set_shift_pattern_equipment(c_master,new_id,names,uid)
 return new_id,True

def shift_pattern_delete(c_master,pattern_id,uid):
 ensure_shift_pattern_tables(c_master)
 cur=c_master.cursor()
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

def pad_hm(v):
 """'8:15' -> '08:15'。**HH:MMへそろえて保存する**——HTMLの
 `input[type=time]`は2桁の時しか読まないので、1桁で保存された区分は
 編集画面で**空欄になり、そのまま保存すると400で断られる**（旧フラット
 マスタからの移行分が実際にそうなっていた）。"""
 t=str(v or '').strip().split(':')
 try:return '%02d:%02d'%(int(t[0]),int(t[1]))
 except Exception:return str(v or '').strip()

def shift_segment_sync(c_master,pattern_id,segments,uid):
 """勤務区分を渡された内容へ完全同期する(稼働カレンダーcalendar_syncと同じ
 全置換方式)。渡された順序がそのまま表示順になる。"""
 ensure_shift_pattern_tables(c_master)
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
  # 日付補正(§9.195)。**跨がない区分には持たせない**——効かない値が
  # 保存されていると、後から見た人が「設定したのに変わらない」と読む。
  raw=(seg or {}).get('dayOffset')
  if raw in (None,'') or not crosses_midnight(start,end):off=None
  else:
   try:off=max(-SHIFT_DAYOFF_LIMIT,min(SHIFT_DAYOFF_LIMIT,int(raw)))
   except Exception:
    raise ValueError(f'「{name}」の日付補正は整数（日数）で指定してください。')
  cleaned.append((name,pad_hm(start),pad_hm(end),off))
 cur=c_master.cursor()
 cur.execute('DELETE FROM [勤務区分マスタ] WHERE [勤務体系ID]=?',[pattern_id])
 for i,(name,start,end,off) in enumerate(cleaned,start=1):
  cur.execute('INSERT INTO [勤務区分マスタ] ([勤務体系ID],[名称],[開始時刻],[終了時刻],[表示順],[有効],[日付補正],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,?,Now(),Now())',
              [pattern_id,name,start,end,i*10,off,uid,uid])
 return len(cleaned)

_shift_migration_done=False
def migrate_shift_patterns(c_master):
 """旧フラット勤務形態マスタ -> 勤務体系/勤務区分 への一度きりの移行。
 設備ごとに1つの勤務体系へまとめる(どの直が同じ体系かは旧構造では
 表現されていなかったため、設備単位でまとめる以上の推測はしない)。"""
 global _shift_migration_done
 if _shift_migration_done:return
 ensure_shift_pattern_tables(c_master)
 try:
  if SHIFT_TABLE not in tables(c_master):
   _shift_migration_done=True;return
  cur=c_master.cursor()
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
   pid,_=shift_pattern_upsert(c_master,None,eq,label,'migrate:勤務形態マスタ')
   shift_segment_sync(c_master,pid,[{'name':r[1],'start':r[2],'end':r[3]} for r in rows],'migrate:勤務形態マスタ')
  c_master.commit()
  from ..logging_setup import app_logger
  app_logger().info('勤務形態マスタを勤務体系/勤務区分の階層構造へ移行しました: %s',{k or '(全設備既定)':len(v) for k,v in by_eq.items()})
 except Exception as e:
  from ..logging_setup import app_logger
  app_logger().warning('勤務形態マスタの階層移行に失敗しました: %s',e)
 _shift_migration_done=True

def ensure_schedule_tables(c_share):
 # 共有schedule.sqlite3側。作業予定だけを用意する(設定系マスタは
 # master.sqlite3へ移したため、下のensure_config_master_tablesが受け持つ)。
 # with_write()のapply_fn冒頭やGET系ルートの前処理から呼ぶ想定
 # (ensure_*_tableは冪等なので複数回呼んでも安全)。
 ensure_plan_table(c_share)

def ensure_config_master_tables(mc):
 # master.sqlite3側。設定系マスタをまとめて用意する。
 ensure_calendar_table(mc)
 ensure_stop_reason_table(mc)
 # 分類マスタは設備停止マスタの後に作る(初回作成時に既存の分類値を取り込むため)
 ensure_stop_category_table(mc)
 # 内訳(サブカテゴリ)と時間の選択肢(§9.389)。どちらも設備停止マスタの後
 # ——内訳は[停止理由ID]で親を指すので、親の表が先に無いと参照が宙に浮く。
 ensure_stop_sub_table(mc)
 ensure_stop_minutes_table(mc)
 ensure_row_style_table(mc)
 ensure_load_factor_override_table(mc)
 ensure_shift_table(mc)
 ensure_shift_pattern_tables(mc)

# 共有schedule.sqlite3から移してきた設定系マスタ。**新しく作るマスタを
# ここへ足さないこと**——この一覧は「昔は共有側にあったので引き継ぎが要る」
# ものの一覧で、最初からmaster側にあるものは引き継ぐ元が無い
# (行表示マスタ(§9.198)はこちらに該当しないので載せていない)。
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
  except Exception as _e:
   # 共有が未設定・未到達。目印は立てず、次回のアクセスで再挑戦する。
   quiet('共有の写しを取れない（手元のマスタで続ける）',_e)
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
 except Exception as _e:quiet('列を読めない（無い列として読む・§9.325）',_e);return []
