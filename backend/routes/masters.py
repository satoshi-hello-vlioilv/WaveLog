"""masters.py: 各種マスタのCRUD API(Blueprint)。

backend/masters.py から移設。ロジックは変更していない(移動のみ)。データ
アクセス(テーブル定義・読み取り・正規化)は backend/repositories/master_repo.py
が持ち、ここではリクエストの受付とレスポンス整形のみを行う。

設備マスタ/オペレータマスタ(+作業可能設備)/スプール種別/内径種別/機器マスタ/
フィルタプリセットを提供する。すべてdb/master.sqlite3に保存し、
テーブルが無ければ初回アクセス時に自動作成する。
URLはBlueprint分離前と同一(/api/equipment-master 等)。
"""
import json
from datetime import datetime
from pathlib import Path
from flask import Blueprint, request, jsonify

from ..paths import APP_ROOT as BASE_DIR

from ..config import RNE_EXTRACT_INTERVAL_SEC_DEFAULT, SCHEDULE_LOCK_TTL_SEC_DEFAULT, SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT
from ..db_access import (
 DBS, connect, request_user_id,
 PATH_CONFIG_KEYS, path_config_rows, set_path_config, path_config_value,
 SIKALOT_SOURCE, RECORDS_BACKUP_EXPORT_PATH, SCHEDULE_SHARE_PATH,
)
from ..repositories.master_repo import (
 EQUIPMENT_MASTER_TABLE, ensure_equipment_master_table, normalize_equipment_name, equipment_master_rows,
 MAX_STRIPS_COLUMN, STRIP_LIMIT, DEFAULT_MAX_STRIPS, clamp_max_strips,
 EQUIPMENT_KINDS, normalize_equipment_kind,
 STANDARD_MINUTES_MAX, normalize_standard_minutes,
 MAX_LINE_SPEED_MAX, normalize_max_line_speed,
 # オペレータ設備マスタは**設備を消したときの後片付け**にだけ使う
 # （§9.221 ③で選択肢マスタへ移したので、読み書きの本線からは外れた）。
 ensure_operator_equipment_table,
 rename_equipment_references,
 FILTER_PRESET_TABLE, ensure_filter_preset_table, filter_preset_rows,
 FILTER_PERSONAL_TABLE, ensure_filter_personal_table, filter_personal_marks,
 filter_personal_set, filter_personal_has_any,
 SCHEDULE_COLUMN_TABLE, ensure_schedule_column_table, schedule_columns_for, set_schedule_columns,
 SCHEDULE_CONTENT_TABLE, ensure_schedule_content_table, schedule_content_items_for, set_schedule_content_items,
 COLUMN_LAYOUT_TABLE, ensure_column_layout_table, column_layout_for, column_layout_targets, set_column_layout,
 COLUMN_PRESET_TABLE, ensure_column_preset_table, column_presets, save_column_preset,
 delete_column_preset, normalize_column_preset,
 FORMAT_KINDS, normalize_format,
 DISPLAY_RULE_TABLE, ensure_display_rule_table, display_rules, set_display_rule,
 delete_display_rule, display_rule_usage, display_rule_usage_all, RULE_OPS, RULE_COLORS,
 SORT_PRESET_TABLE, ensure_sort_preset_table, sort_preset_rows, normalize_sort_keys,
 LIST_VIEW_TABLE, ensure_list_view_table, list_view_settings_for, set_list_view_settings,
 ROW_GAP_DEFAULT,
 ACCESS_PERMISSION_TABLE, ensure_access_permission_table, normalize_identity_part, access_permission_master_rows,
 field_reorder_terminal_count,
 QUERY_JOIN_TABLE, QUERY_JOIN_MULTI, ensure_query_join_table, query_joins,
 query_join_save, query_join_delete,
)
from ..db_access import cols, tables, cfg
from .. import schedule_calc

bp=Blueprint('masters',__name__)

@bp.get('/api/equipment-master')
def equipment_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=EQUIPMENT_MASTER_TABLE in tables(c);rows=equipment_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else ''),
            # 最大条数は未設定なら空で返す(画面側が「既定40」と補って見せる)。
            'maxStrips':('' if (len(r)<7 or r[6] in (None,'')) else int(r[6])),
            'maxStripsEffective':clamp_max_strips(r[6] if len(r)>6 else None),
            # 区分(コイル/板、§9.85)。未設定は空で返す(画面が「未設定」と見せる)。
            'kind':normalize_equipment_kind(r[7] if len(r)>7 else ''),
            # 1ロットあたりの標準時間(分、§9.114)。未設定は空("")で返す
            # ——0を返すと「0分」という設定に見えるが、そんな作業は無い。
            'standardMinutes':('' if (len(r)<9 or normalize_standard_minutes(r[8]) is None)
                               else normalize_standard_minutes(r[8])),
            # 最大ライン速度(m/min、§9.231 ①)。未設定は空("")で返す
            # ——0を返すと「上限0」という設定に見えるが、そんなラインは無い。
            'maxLineSpeed':('' if (len(r)<10 or normalize_max_line_speed(r[9]) is None)
                            else normalize_max_line_speed(r[9]))} for r in rows]
  return jsonify(ok=True,items=items,table=EQUIPMENT_MASTER_TABLE,created=not before,empty=len(items)==0,
                 stripLimit=STRIP_LIMIT,defaultMaxStrips=DEFAULT_MAX_STRIPS,
                 standardMinutesMax=STANDARD_MINUTES_MAX,
                 maxLineSpeedMax=MAX_LINE_SPEED_MAX,
                 equipmentKinds=list(EQUIPMENT_KINDS),master_path=str(path))
 except Exception as e:return jsonify(error=f'設備マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master')
def equipment_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  # reuseExisting: True=同じ設備として復元/False=別の新しい設備として登録/
  # 未指定(None)=無効化された同名設備があれば選択を求める(下記参照)。
  reuse_existing=x.get('reuseExisting')
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor()
   cur.execute('SELECT [設備ID],[設備名],[有効],[更新日時],[更新者ID] FROM [設備マスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target),None)
   existing_active=bool(existing) and (True if existing[2] is None else bool(existing[2]))

   if existing and existing_active:
    # 既にアクティブな同名設備がある。選択の余地は無く、従来どおりの冪等応答。
    return jsonify(ok=True,name=str(existing[1]).strip(),registered=False,reused=True,updated_by=uid,
                    message='設備マスタの登録済み設備を使用します。')

   if existing and not existing_active and reuse_existing is None:
    # 過去に削除(無効化)された同名設備がある。呼び出し元が意図(復元/新規)を
    # 明示していなければ、ここで選択を求める(実装しない=常に復元、という
    # 従来動作をここだけ変える。他の呼び出し元はreuseExisting:trueを渡せば
    # 従来どおり無条件で復元される)。
    return jsonify(error=f'「{name}」は過去に削除された設備と同じ名前です。同じ設備として復元するか、別の新しい設備として登録するか選んでください。',
                    code='inactive_equipment_name_conflict',
                    existingId=existing[0],
                    existingDeactivatedAt=existing[3].isoformat() if existing[3] else None,
                    existingDeactivatedBy=(str(existing[4]).strip() if existing[4] else '')),409

   if existing and not existing_active and reuse_existing:
    # 同じ設備として復元: 無効化されていた行をそのまま有効化する(従来の挙動)。
    cur.execute('UPDATE [設備マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[uid,existing[0]]);c.commit()
    return jsonify(ok=True,name=str(existing[1]).strip(),registered=False,reused=True,updated_by=uid,
                    message='設備マスタへ登録済みの設備を復元しました。過去のスケジュール等の履歴もそのまま引き継がれます。')

   if existing and not existing_active and reuse_existing is False:
    # 別の新しい設備として登録: 既存の無効行を一意な退避名へ改名し、
    # rename_equipment_references(§改名連動)で関連マスタ側もその退避名へ
    # 追従させたうえで、空いた名称で新規行を作る。設備マスタの[設備名]は
    # 一意インデックスがあるため、退避せずに同名で2行目を作ることはできない。
    retired_name=f'{name}(旧{datetime.now().strftime("%Y%m%d%H%M%S%f")})'
    cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[retired_name,uid,existing[0]])
    renamed=rename_equipment_references(c,name,retired_name)
    cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [設備マスタ] ([設備名],[区分],[最大条数],[標準時間分],[最大ライン速度],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,-1,?,?,Now(),Now())',[name,normalize_equipment_kind(x.get('kind')),(None if str(x.get('maxStrips') or '').strip()=='' else clamp_max_strips(x.get('maxStrips'))),normalize_standard_minutes(x.get('standardMinutes')),normalize_max_line_speed(x.get('maxLineSpeed')),order,uid,uid])
    c.commit()
    return jsonify(ok=True,name=name,registered=True,reused=False,retiredAs=retired_name,retiredReferences=renamed,updated_by=uid,
                    message=f'「{name}」を新しい設備として登録しました。過去の設備は「{retired_name}」として履歴に残ります。')

   # 同名の既存行が無い場合: 通常の新規登録。
   cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
   cur.execute('INSERT INTO [設備マスタ] ([設備名],[区分],[最大条数],[標準時間分],[最大ライン速度],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,-1,?,?,Now(),Now())',[name,normalize_equipment_kind(x.get('kind')),(None if str(x.get('maxStrips') or '').strip()=='' else clamp_max_strips(x.get('maxStrips'))),normalize_standard_minutes(x.get('standardMinutes')),normalize_max_line_speed(x.get('maxLineSpeed')),order,uid,uid]);c.commit()
   return jsonify(ok=True,name=name,registered=True,reused=False,updated_by=uid,
                   message='設備マスタへ新規登録しました。次回から設備リストに表示されます。')
 except Exception as e:return jsonify(error=f'設備マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master/update')
def equipment_master_update():
 try:
  x=request.get_json(force=True) or {};eid=x.get('id');name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if eid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor();cur.execute('SELECT [設備ID],[設備名] FROM [設備マスタ]');rows=cur.fetchall();target=normalize_equipment_name(name)
   dup=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[0])!=str(eid)),None)
   if dup:return jsonify(error=f'同名の設備が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   current=next((r for r in rows if str(r[0])==str(eid)),None);old_name=str(current[1]).strip() if current and current[1] else ''
   # 最大条数: 空欄は「未設定＝既定値」の意味なのでNULLへ戻す(0を入れない)。
   raw_max=str(x.get('maxStrips') or '').strip()
   max_strips=None if raw_max=='' else clamp_max_strips(raw_max)
   cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[区分]=?,[最大条数]=?,[標準時間分]=?,[最大ライン速度]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[name,normalize_equipment_kind(x.get('kind')),max_strips,normalize_standard_minutes(x.get('standardMinutes')),normalize_max_line_speed(x.get('maxLineSpeed')),uid,eid])
   # 設備名は他マスタ(オペレータ設備マスタ・操業データ選択肢マスタ[対象設備]等、
   # equipment_name_references()参照)から
   # 文字列で参照されているため、改名時はそちら側も追従させる(改名連動)。
   renamed=rename_equipment_references(c,old_name,name) if old_name else 0
   c.commit()
  msg='設備名を更新しました。'+(f' 関連する設備参照{renamed}件も追従しました。' if renamed else '')
  return jsonify(ok=True,id=eid,name=name,updated_by=uid,renamedReferences=renamed,message=msg)
 except Exception as e:return jsonify(error=f'設備マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master/delete')
def equipment_master_delete():
 try:
  x=request.get_json(force=True) or {};eid=x.get('id');uid=request_user_id(x);force=bool(x.get('force'))
  if eid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor()
   cur.execute('SELECT [設備名] FROM [設備マスタ] WHERE [設備ID]=?',[eid]);row=cur.fetchone();name=str(row[0]).strip() if row and row[0] else ''
   # docs/SCHEDULE_MODE_DESIGN.md §5.0.1: まず拒否して内訳を提示し、
   # 利用者が再確認のうえforce:trueで再送した場合のみ実際に削除する。
   # スケジュール側の参照はDBへ一切書き込まない読み取り専用の確認のみ
   # (削除してもスケジュール側のデータは履歴として残る)。
   references_check_failed=False
   if name and not force:
    references=schedule_calc.equipment_reference_counts(name)
    if references is None:
     # 共有ファイルの取得自体に失敗(Box未接続等)。確認できないだけで、
     # 削除自体をブロックする理由にはしない(§5.0.1)。
     references_check_failed=True
    else:
     references['fieldReorderTerminals']=field_reorder_terminal_count(c,name)
     if any(v>0 for v in references.values()):
      return jsonify(error='この設備には関連するスケジュールデータがあります。',
                      code='schedule_references_exist',references=references),409
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [設備マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[uid,eid])
   # オペレータ設備マスタは設備名で紐づいているため、削除した設備を作業可能
   # 設備として持つオペレータの割当からも取り除き、削除済みの設備名が
   # 選択肢から消えた後も表示上だけ残り続ける(ゴースト参照)のを防ぐ。
   if name:
    ensure_operator_equipment_table(c)
    cur.execute('DELETE FROM [オペレータ設備マスタ] WHERE [設備名]=?',[name])
   c.commit()
  return jsonify(ok=True,id=eid,updated_by=uid,referencesCheckFailed=references_check_failed)
 except Exception as e:return jsonify(error=f'設備マスタ削除失敗: {e}'),500

# ---------------------------------------------------------------------------
# オペレータ／機器／スプール種別／内径種別／バリ揃え／コイル止めは
# **操業データ選択肢マスタへ移した**(§9.221 ③、利用者の指示)。
#   「オペレータ、機器、スプール種別、内径種別、バリ揃え、コイル止めに
#    ついても汎用化した操業データ項目マスタに移行させてください」
# 6つとも「名前の一覧」でしかなく、違いはオペレータが持っていた
# ヨミガナと作業可能設備だけだった——その2つは`[よみ]`／`[対象設備]`として
# 選択肢の側へ持たせたので、**まとまり名が違うだけの同じもの**になる。
# CRUDは`/api/operation-choice-master`の1組、読み口は`op.choice_values()`の
# 1本、画面は「選択肢の値」の1枚。元の表は`migrate_legacy_choice_masters()`が
# 1度だけ写す材料として残してあるが、アプリはもう読まない。
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 「名前だけ」の単純マスタの生成器は**撤去した**(§9.221 ③)。スプール種別・
# 内径種別・機器・バリ揃え・コイル止めの5つを1宣言から生成するための仕掛け
# だったが、5つとも操業データ選択肢マスタの**まとまり**になったので使い手が
# 居なくなった。使われていない生成器を残すと、次に触る人が「まだ現役だ」と
# 読んで新しいマスタをそちらへ足し、選択肢マスタと2本立てになる。
# 名前だけのマスタが要る場面は`/api/operation-choice-master`で足りる。
# ---------------------------------------------------------------------------

def _filter_preset_mode(raw):
 """登録フィルタの置き場(§9.80)。スケジュールモードだけを別に持ち、
 それ以外(編集・閲覧)は共通の''にまとめる。**3つに分けない**——
 編集と閲覧で同じ一覧を同じ列構成で見るので、条件を分ける理由が無い。"""
 return 'schedule' if str(raw or '').strip()=='schedule' else ''

def _filter_preset_user(source=None):
 """「今この画面を使っている人」(§9.172)。空でも受ける——OSのログインIDが
 取れない端末があり、そこで登録を拒むと**フィルタ機能ごと使えなくなる**。
 空は「利用者が分からない端末」という1つの入れ物として扱い、画面側がその旨を
 書く(他人の設定と混ざる可能性を黙って隠さない)。"""
 x=source if source is not None else request.args
 for k in ('user','user_id','userId'):
  v=str((x.get(k) if hasattr(x,'get') else '') or '').strip()
  if v:return v[:50]
 return ''

def _preset_visible_to(owner,user_id):
 """見えるのは「みんなのもの(所有者ID空欄)」と「自分のもの」だけ。
 **他人の個人フィルタは出さない**——出すと個人単位にした意味が無い。"""
 own=str(owner or '').strip()
 return (not own) or own==str(user_id or '').strip()

@bp.get('/api/filter-presets')
def filter_preset_list():
 try:
  db_key=str(request.args.get('db') or '').strip();table=str(request.args.get('table') or '').strip()
  uid=_filter_preset_user()
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=FILTER_PRESET_TABLE in tables(c);rows=filter_preset_rows(c)
   marks=filter_personal_marks(c,uid)
   items=[]
   for r in rows:
    try:filters=json.loads(r[4] or '[]')
    except Exception:filters=[]
    if not isinstance(filters,list):filters=[]
    owner=(str(r[11]).strip() if len(r)>11 and r[11] else '')
    if not _preset_visible_to(owner,uid):continue
    mk=marks.get(int(r[0]),{})
    items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),'table':str(r[3] or '').strip(),'filters':filters,'uses':int(r[5] or 0),'last_used':r[6].isoformat() if r[6] else None,'updated_at':r[8].isoformat() if r[8] else None,'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else ''),'mode':(str(r[10]).strip() if len(r)>10 and r[10] else ''),
                  'owner':owner,'mine':bool(owner) and owner==uid,'shared':not owner,
                  'isDefault':bool(mk.get('isDefault')),'isLocked':bool(mk.get('isLocked'))})
  # ファイル(DB)＆テーブルごとに個別管理するため、対象DB/対象テーブルが
  # 空欄のプリセット(=以前の実装が汎用として扱っていたもの)であっても、
  # 厳密に一致しない限り対象外とする。
  if db_key:items=[x for x in items if x['db']==db_key]
  if table:items=[x for x in items if x['table']==table]
  # 対象モード(§9.80)。同じ仕掛一覧でもスケジュールモードは列構成が変わるので、
  # 条件の置き場も分ける。指定が無ければ共通('')のものだけを返す。
  mode=_filter_preset_mode(request.args.get('mode'))
  items=[x for x in items if x.get('mode','')==mode]
  # **「この人の印が1件でもあるか」は一覧の絞り込みと別に数える**——今開いて
  # いる一覧に印が無いだけで「まだ一度も付けていない人」と判定すると、
  # 端末に残っていた古い印の移行(§9.172)が何度も走ってしまう。
  with connect(path,True) as c2:
   has_marks=filter_personal_has_any(c2,uid)
  return jsonify(ok=True,items=items,mode=mode,user=uid,
                 hasPersonalMarks=has_marks,
                 table=FILTER_PRESET_TABLE,created=not before,master_path=str(path))
 except Exception as e:return jsonify(error=f'フィルタプリセット読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/filter-presets')
def filter_preset_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='フィルタ名を入力してください。'),400
  filters=x.get('filters') or []
  if not isinstance(filters,list) or not filters:return jsonify(error='保存する条件がありません。'),400
  db_key=str(x.get('db') or '').strip();table=str(x.get('table') or '').strip();payload=json.dumps(filters,ensure_ascii=False)
  mode=_filter_preset_mode(x.get('mode'))
  # 所有者(§9.172)。指定が無ければ**その人のもの**として登録する。共有したい
  # ときだけ owner='' を明示する(shared=trueでも同じ)。**同名の照合にも
  # 所有者を含める**——含めないと、同じ名前を付けた他人の登録を黙って
  # 書き換えてしまう(個人単位にした意味が無くなるどころか、実害が出る)。
  requester=_filter_preset_user(x) or uid
  owner=('' if x.get('shared') else str(x.get('owner') if x.get('owner') is not None else requester or '').strip()[:50])
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[対象モード],[所有者ID] FROM [フィルタプリセットマスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key and str(r[3] or '')==table and str(r[4] or '')==mode and str(r[5] or '')==owner),None)
   if existing:
    cur.execute('UPDATE [フィルタプリセットマスタ] SET [条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[payload,uid,existing[0]]);registered=False;preset_id=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[使用回数],[表示順],[有効],[所有者ID],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,0,?,-1,?,?,?,Now(),Now())',[name,db_key,table,mode,payload,order,owner,uid,uid]);registered=True
    preset_id=cur.lastrowid
   c.commit()
  return jsonify(ok=True,name=name,id=preset_id,registered=registered,owner=owner,mine=bool(owner),updated_by=uid,message=('フィルタマスタへ新規登録しました。' if registered else '登録済みフィルタを更新しました。'))
 except Exception as e:return jsonify(error=f'フィルタプリセット登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/filter-presets/use')
def filter_preset_use():
 # サジェスト順位（よく使う順）を精緻化するため、適用時に使用回数を加算する。
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(ok=True,skipped=True)
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,skipped=True)
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [使用回数]=Nz([使用回数],0)+1,[最終使用日時]=Now(),[更新者ID]=? WHERE [プリセットID]=?',[uid,pid]);c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'使用回数更新失敗: {e}'),500

@bp.post('/api/filter-presets/delete')
def filter_preset_delete():
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(error='削除対象IDがありません。'),400
  requester=_filter_preset_user(x) or uid
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   # **他人の個人フィルタは消せない**(§9.172)。みんなのもの(所有者空欄)は
   # 今までどおり誰でも消せる——共有のものを消せる人を絞ると、作った人が
   # 辞めた後に誰も片付けられなくなる。
   cur.execute('SELECT [所有者ID] FROM [フィルタプリセットマスタ] WHERE [プリセットID]=?',[pid])
   row=cur.fetchone()
   if row is not None and not _preset_visible_to(row[0],requester):
    return jsonify(error='この登録フィルタは別の人のものです。持ち主だけが削除できます。'),403
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[uid,pid]);c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'フィルタプリセット削除失敗: {e}'),500

@bp.post('/api/filter-presets/marks')
def filter_preset_marks():
 """「デフォルト」「鍵」の印を、**その人のもの**として残す(§9.172)。
 以前は端末のlocalStorageだったため、同じPCを別の人が使うと相手の既定が
 当たり、別のPCへ移ると付けた覚えの印が消えていた。"""
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  requester=_filter_preset_user(x) or uid
  items=x.get('items')
  if not isinstance(items,list):
   if x.get('id') is None:return jsonify(error='対象のプリセットIDがありません。'),400
   items=[{'id':x.get('id'),'isDefault':x.get('isDefault'),'isLocked':x.get('isLocked')}]
  path=DBS['MASTER']['path']
  saved=0
  with connect(path,False) as c:
   ensure_filter_personal_table(c)
   for it in items:
    if not isinstance(it,dict) or it.get('id') is None:continue
    try:pid=int(it.get('id'))
    except Exception:continue
    filter_personal_set(c,requester,pid,bool(it.get('isDefault')),bool(it.get('isLocked')),uid)
    saved+=1
  return jsonify(ok=True,user=requester,saved=saved)
 except Exception as e:return jsonify(error=f'フィルタ個人設定の保存に失敗: {e}'),500

@bp.post('/api/filter-presets/owner')
def filter_preset_owner():
 """「自分だけ」と「みんな」を行き来する(§9.172)。**持ち主だけが変えられる**。
 みんなのものを自分のものにするのは、他の人から見えなくなるので**取り上げ**に
 なる——できるのは、まだ誰の物でもない(＝共有)ものを自分の物にする場合だけに
 限らず、画面側が確認を出す。"""
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(error='対象のプリセットIDがありません。'),400
  requester=_filter_preset_user(x) or uid
  to_shared=bool(x.get('shared'))
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [所有者ID] FROM [フィルタプリセットマスタ] WHERE [プリセットID]=?',[pid])
   row=cur.fetchone()
   if row is None:return jsonify(error='その登録フィルタは見つかりません。'),404
   if not _preset_visible_to(row[0],requester):
    return jsonify(error='この登録フィルタは別の人のものです。持ち主だけが変えられます。'),403
   owner='' if to_shared else str(requester or '')[:50]
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [所有者ID]=?,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[owner,uid,pid])
   c.commit()
  return jsonify(ok=True,id=pid,owner=owner,mine=bool(owner))
 except Exception as e:return jsonify(error=f'フィルタの持ち主変更に失敗: {e}'),500

@bp.get('/api/schedule-column-master')
def schedule_column_master_get():
 try:
  equipment=str(request.args.get('equipment') or '').strip()
  if not equipment:return jsonify(ok=True,equipment='',columns=[])
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,equipment=equipment,columns=[])
  with connect(path,True) as c:
   columns=schedule_columns_for(c,equipment)
  return jsonify(ok=True,equipment=equipment,columns=columns)
 except Exception as e:return jsonify(error=f'スケジュール列表示マスタ読込失敗: {e}'),500

@bp.post('/api/schedule-column-master')
def schedule_column_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  equipment=str(x.get('equipment') or '').strip()
  columns=x.get('columns')
  if not equipment:return jsonify(error='設備名を指定してください。'),400
  if not isinstance(columns,list):return jsonify(error='列の指定が不正です。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   n=set_schedule_columns(c,equipment,columns,uid)
  return jsonify(ok=True,equipment=equipment,saved=n,updated_by=uid,message='表示列を保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'スケジュール列表示マスタ保存失敗: {e}'),500

# ------------------------------------------------------------------------
# スケジュール内容表示マスタ（タイムラインの「内容」欄の項目・並び順）
# ------------------------------------------------------------------------
@bp.get('/api/schedule-content-master')
def schedule_content_master_get():
 try:
  equipment=str(request.args.get('equipment') or '').strip()
  if not equipment:return jsonify(ok=True,equipment='',items=[])
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,equipment=equipment,items=[])
  with connect(path,True) as c:
   items=schedule_content_items_for(c,equipment)
  return jsonify(ok=True,equipment=equipment,items=items)
 except Exception as e:return jsonify(error=f'スケジュール内容表示マスタ読込失敗: {e}'),500

@bp.post('/api/schedule-content-master')
def schedule_content_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  equipment=str(x.get('equipment') or '').strip()
  items=x.get('items')
  if not equipment:return jsonify(error='設備名を指定してください。'),400
  if not isinstance(items,list):return jsonify(error='項目の指定が不正です。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   n=set_schedule_content_items(c,equipment,items,uid)
  return jsonify(ok=True,equipment=equipment,saved=n,updated_by=uid,message='内容欄の項目を保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'スケジュール内容表示マスタ保存失敗: {e}'),500

# ========================================================================
# アクセス権限マスタ（ログインID×PC名で編集可否を管理。閲覧モードの判定は
# backend/access_mode.pyが使う。ここではCRUD APIのみを提供する）
# ========================================================================
def _bool_from_can_edit(value):
 # フロントは'編集可'/'閲覧のみ'という表記の select を送ってくる。
 return str(value or '').strip()=='編集可'

def _bool_from_yes_no(value):
 # canSchedule/canFieldReorderは'可'/'不可'という表記の select を送ってくる
 # (canEditと同じ、文字列表記のselectで統一する)。
 return str(value or '').strip()=='可'

@bp.get('/api/access-permission-master')
def access_permission_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=ACCESS_PERMISSION_TABLE in tables(c);rows=access_permission_master_rows(c)
   # canSchedule/canFieldReorderもcanEditと同じ文字列表記('可'/'不可')で返す
   # (マスタ管理モーダルの汎用select編集フォームが、編集時にediting[f.k]の
   # 値とoptionsの文字列を突き合わせて選択状態を復元するため、真偽値のままだと
   # 一致せず選択が復元されない)。
   items=[{'id':r[0],'loginId':str(r[1] or '').strip(),'pcName':str(r[2] or '').strip(),'canEdit':'編集可' if bool(r[3]) else '閲覧のみ','order':r[4] or 0,'active':True,'updated_at':r[6].isoformat() if r[6] else None,'updated_by':(str(r[7]).strip() if len(r)>7 and r[7] else ''),'canSchedule':'可' if (len(r)>8 and bool(r[8])) else '不可','canFieldReorder':'可' if (len(r)>9 and bool(r[9])) else '不可','fieldReorderEquipment':(str(r[10]).strip() if len(r)>10 and r[10] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=ACCESS_PERMISSION_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'アクセス権限マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master')
def access_permission_master_register():
 try:
  x=request.get_json(force=True) or {};login_id=str(x.get('loginId') or '').strip();pc_name=str(x.get('pcName') or '').strip();can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  can_schedule=_bool_from_yes_no(x.get('canSchedule'));can_field_reorder=_bool_from_yes_no(x.get('canFieldReorder'));field_reorder_equipment=str(x.get('fieldReorderEquipment') or '').strip()
  # ログインID・PC名は汎用的に使えるよう、どちらか一方だけの登録を許す
  # (もう一方は空欄=「問わない」という意味になる。master_repo.permission_flags
  # 側の一致度判定で解決する)。両方空欄は「誰の・どの端末か」を一切
  # 特定できないため唯一拒否する。
  if not login_id and not pc_name:return jsonify(error='ログインIDまたはPC名の少なくとも一方を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor();cur.execute('SELECT [権限ID],[ログインID],[PC名] FROM [アクセス権限マスタ]');rows=cur.fetchall()
   tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
   existing=next((r for r in rows if normalize_identity_part(r[1])==tl and normalize_identity_part(r[2])==tp),None)
   if existing:
    cur.execute('UPDATE [アクセス権限マスタ] SET [編集可否]=?,[スケジュール可否]=?,[現場段取り可否]=?,[現場段取り対象設備]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,uid,existing[0]]);registered=False
   else:
    cur.execute('SELECT Max([表示順]) FROM [アクセス権限マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[スケジュール可否],[現場段取り可否],[現場段取り対象設備],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,-1,?,?,Now(),Now())',[login_id,pc_name,1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,order,uid,uid]);registered=True
   c.commit()
  return jsonify(ok=True,loginId=login_id,pcName=pc_name,registered=registered,updated_by=uid,message=('アクセス権限マスタへ新規登録しました。' if registered else '登録済みの組み合わせを更新しました。'))
 except Exception as e:return jsonify(error=f'アクセス権限マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master/update')
def access_permission_master_update():
 try:
  x=request.get_json(force=True) or {};aid=x.get('id');login_id=str(x.get('loginId') or '').strip();pc_name=str(x.get('pcName') or '').strip();can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  can_schedule=_bool_from_yes_no(x.get('canSchedule'));can_field_reorder=_bool_from_yes_no(x.get('canFieldReorder'));field_reorder_equipment=str(x.get('fieldReorderEquipment') or '').strip()
  if aid is None:return jsonify(error='更新対象IDがありません。'),400
  if not login_id and not pc_name:return jsonify(error='ログインIDまたはPC名の少なくとも一方を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor();cur.execute('SELECT [権限ID],[ログインID],[PC名] FROM [アクセス権限マスタ]');rows=cur.fetchall()
   tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
   dup=next((r for r in rows if normalize_identity_part(r[1])==tl and normalize_identity_part(r[2])==tp and str(r[0])!=str(aid)),None)
   if dup:return jsonify(error='同じログインID・PC名の組み合わせが既に存在するため変更できません。'),409
   cur.execute('UPDATE [アクセス権限マスタ] SET [ログインID]=?,[PC名]=?,[編集可否]=?,[スケジュール可否]=?,[現場段取り可否]=?,[現場段取り対象設備]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[login_id,pc_name,1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,uid,aid]);c.commit()
  return jsonify(ok=True,id=aid,loginId=login_id,pcName=pc_name,updated_by=uid,message='アクセス権限を更新しました。')
 except Exception as e:return jsonify(error=f'アクセス権限マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master/delete')
def access_permission_master_delete():
 try:
  x=request.get_json(force=True) or {};aid=x.get('id');uid=request_user_id(x)
  if aid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [アクセス権限マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[uid,aid]);c.commit()
  return jsonify(ok=True,id=aid,updated_by=uid)
 except Exception as e:return jsonify(error=f'アクセス権限マスタ削除失敗: {e}'),500


# ========================================================================
# 列レイアウトマスタ(§9.88新設): 一覧・タイムラインの「並び順」と「列幅」。
# 対象(target)は画面が組み立てるスコープ文字列(list:<DB>:<表> / timeline:<設備>)。
# **どの列を出すかは別マスタ**(表示マスタ/スケジュール列表示マスタ)が決める。
# ここは並びと幅だけを持つので、列が増減しても保存内容は壊れない
# (知らない列は無視し、記録に無い列は既定の位置・既定の幅になる)。
# ========================================================================
@bp.get('/api/column-layout-master')
def column_layout_master_get():
 try:
  # all=1 は「保存されている全対象をまとめて返す」(§9.178。持ち出し用)。
  # **画面はここでしか全対象を知れない**——targetは画面が組み立てる文字列で、
  # どんな対象が保存済みかを推測する手掛かりがどこにも無い。
  if str(request.args.get('all') or '').strip() in ('1','true','yes'):
   path=DBS['MASTER']['path']
   if not path.exists():return jsonify(ok=True,items=[])
   with connect(path,True) as c:
    items=[dict(target=t,**column_layout_for(c,t)) for t in column_layout_targets(c)]
   return jsonify(ok=True,items=items)
  target=str(request.args.get('target') or '').strip()
  if not target:return jsonify(error='対象(target)を指定してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,target=target,order=[],widths={})
  with connect(path,True) as c:
   layout=column_layout_for(c,target)
  return jsonify(ok=True,target=target,**layout)
 except Exception as e:
  # 並びが読めなくても一覧そのものは出せる(既定の並び)。画面はfail-openで扱う。
  return jsonify(error=f'列レイアウト読込失敗: {e}'),500

@bp.post('/api/column-layout-master')
def column_layout_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  target=str(x.get('target') or '').strip()
  if not target:return jsonify(error='対象(target)を指定してください。'),400
  order=x.get('order');widths=x.get('widths');hidden=x.get('hidden');names=x.get('names')
  formats=x.get('formats');rules=x.get('rules');formulas=x.get('formulas')
  locks=x.get('locks')          # 幅を固定する列(§9.119)
  sorts=x.get('sorts')          # 列ごとの並べ替えの決まり(§9.187)
  aligns=x.get('aligns')        # 値と見出しの揃え(§9.239 ④)
  # **送られてきた項目だけを書く**(§9.212 ②、利用者の指示「修正した内容が
  # 戻されたりしないために」)。以前は常に全置換で、渡し忘れた設定が黙って
  # 消えていた(計算式・並べ替え・幅固定で実際に3回起きた)。判断の材料は
  # 「JSONにそのキーがあるか」の1点——**空の値と省略は別のこと**で、
  # `hidden:[]`は「隠す列は無い」、`hidden`が無いのは「触っていない」。
  fields={k for k in ('order','widths','hidden','names','formats','rules',
                      'formulas','locks','sorts','aligns') if k in x}
  # `clear:true`は**この対象の設定を全部消す**。差分更新にしたぶん、
  # 「まっさらに戻す」は9個のキーを空で並べる必要が出てしまうので、
  # **意図を1語で言える口**を用意する(書き漏らすと消し残る＝前の設定が
  # 生き延びる。検証の後片付けで実際に問題になる)。
  if str(x.get('clear') or '').lower() in ('1','true','yes') or x.get('clear') is True:
   fields=None
  if order is not None and not isinstance(order,list):
   return jsonify(error='並び(order)の指定が不正です。'),400
  if widths is not None and not isinstance(widths,dict):
   return jsonify(error='列幅(widths)の指定が不正です。'),400
  if hidden is not None and not isinstance(hidden,list):
   return jsonify(error='非表示列(hidden)の指定が不正です。'),400
  if locks is not None and not isinstance(locks,list):
   return jsonify(error='幅を固定する列(locks)の指定が不正です。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   n=set_column_layout(c,target,order or [],widths or {},uid,hidden=hidden or [],
                       names=names if isinstance(names,dict) else {},
                       formats=formats if isinstance(formats,dict) else {},
                       rules=rules if isinstance(rules,dict) else {},
                       formulas=formulas if isinstance(formulas,dict) else {},
                       locks=locks if isinstance(locks,list) else [],
                       sorts=sorts if isinstance(sorts,dict) else {},
                       aligns=aligns if isinstance(aligns,dict) else {},
                       fields=fields)
  return jsonify(ok=True,target=target,columns=n,updated_by=uid,message='表示の並びを保存しました。')
 except Exception as e:return jsonify(error=f'列レイアウト保存失敗: {e}'),500


# ========================================================================
# 列プリセットマスタ(§9.111): 列の設定一式に名前を付けて保存する。
#  - **マスタへ置くので他のPCからも読み出せる**(これが要望の主目的)。
#  - 中身は列レイアウトマスタと同じ構造をJSONで丸ごと持つ。プリセットは
#    出し入れが丸ごとなので、列ごとに行へ展開しない。
#  - ファイルへの書き出し/読み込みは画面側だけで完結する(このAPIが返す
#    JSONをそのまま保存し、読み込んだJSONをそのまま当てる)。
# ========================================================================
@bp.get('/api/column-preset-master')
def column_preset_master_get():
 try:
  target=str(request.args.get('target') or '').strip()
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,target=target,items=[])
  with connect(path,False) as c:
   items=column_presets(c,target)
  return jsonify(ok=True,target=target,items=items)
 except Exception as e:return jsonify(error=f'列プリセット読込失敗: {e}'),500

@bp.post('/api/column-preset-master')
def column_preset_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  target=str(x.get('target') or '').strip()
  name=str(x.get('name') or '').strip()
  body=x.get('body')
  if not isinstance(body,dict):return jsonify(error='内容(body)の指定が不正です。'),400
  with connect(DBS['MASTER']['path'],False) as c:
   pid=save_column_preset(c,target,name,body,uid,note=str(x.get('note') or ''))
   items=column_presets(c,target)
  return jsonify(ok=True,id=pid,target=target,items=items,updated_by=uid,
                 message=f'「{name}」として保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'列プリセット保存失敗: {e}'),500

@bp.post('/api/column-preset-master/update')
def column_preset_master_update():
 """名前の付け替え・内容の差し替え(ID指定)。登録側は同名を上書きする自然キー
 照合なので、**名前そのものを変える操作はこちらでしか表現できない**
 (登録側へ送ると別のプリセットが増える)。"""
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  pid=x.get('id')
  if pid in (None,''):return jsonify(error='プリセットIDを指定してください。'),400
  name=str(x.get('name') or '').strip()
  if not name:return jsonify(error='プリセットの名前を入力してください。'),400
  with connect(DBS['MASTER']['path'],False) as c:
   ensure_column_preset_table(c)
   cur=c.cursor()
   cur.execute('SELECT [対象],[内容JSON] FROM [列プリセットマスタ] WHERE [プリセットID]=?',[pid])
   row=cur.fetchone()
   if not row:return jsonify(error='そのプリセットが見つかりません。'),404
   target=row[0]
   body=x.get('body')
   if not isinstance(body,dict):
    import json as _json
    try:body=_json.loads(row[1] or '{}')
    except Exception:body={}
   cur.execute('UPDATE [列プリセットマスタ] SET [名称]=?,[説明]=?,[内容JSON]=?,[更新者ID]=?,'
               '[更新日時]=Now() WHERE [プリセットID]=?',
               [name,str(x.get('note') or ''),
                __import__('json').dumps(normalize_column_preset(body),ensure_ascii=False),uid,pid])
   c.commit()
   items=column_presets(c,target)
  return jsonify(ok=True,id=pid,target=target,items=items,updated_by=uid,message='更新しました。')
 except Exception as e:return jsonify(error=f'列プリセット更新失敗: {e}'),500

@bp.post('/api/column-preset-master/delete')
def column_preset_master_delete():
 try:
  x=request.get_json(force=True) or {}
  pid=x.get('id')
  if pid in (None,''):return jsonify(error='プリセットIDを指定してください。'),400
  target=str(x.get('target') or '').strip()
  with connect(DBS['MASTER']['path'],False) as c:
   n=delete_column_preset(c,pid)
   items=column_presets(c,target)
  return jsonify(ok=True,deleted=n,target=target,items=items,message='削除しました。')
 except Exception as e:return jsonify(error=f'列プリセット削除失敗: {e}'),500


# ========================================================================
# 表示ルールマスタ(§9.88 段4): 値の読み替え。
#  - ルール名でまとめて全置換する(列レイアウトマスタと同じ方式)。
#    行の順序がそのまま評価順になるので、部分更新にすると「どちらの順が
#    正か」が決まらなくなる。
#  - 判定は画面側が行う。ここは保存と読み出しだけ。
# ========================================================================
@bp.get('/api/display-rule-master')
def display_rule_master_get():
 try:
  path=DBS['MASTER']['path']
  if not path.exists():
   return jsonify(ok=True,rules={},usage={},ops=list(RULE_OPS),colors=list(RULE_COLORS))
  with connect(path,True) as c:
   rules=display_rules(c)
   # **どの列で使われているかも一緒に返す。** 編集画面が「このルールを直すと
   # どこへ効くか」を出せるようにするため(読み替えは複数の列で使い回す)。
   usage=display_rule_usage_all(c)
  return jsonify(ok=True,rules=rules,usage=usage,ops=list(RULE_OPS),colors=list(RULE_COLORS),
                 table=DISPLAY_RULE_TABLE)
 except Exception as e:
  # ルールが読めなくても一覧そのものは出せる(読み替えなしで表示)。
  return jsonify(error=f'表示ルール読込失敗: {e}'),500

@bp.post('/api/display-rule-master')
def display_rule_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  name=str(x.get('name') or '').strip()
  if not name:return jsonify(error='ルール名を指定してください。'),400
  rows=x.get('rows')
  if rows is not None and not isinstance(rows,list):
   return jsonify(error='ルールの行(rows)の指定が不正です。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   n=set_display_rule(c,name,rows or [],uid)
   rules=display_rules(c)
  return jsonify(ok=True,name=name,rows=n,rules=rules,updated_by=uid,
                 message=f'表示ルール「{name}」を保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'表示ルール保存失敗: {e}'),500

@bp.post('/api/display-rule-master/delete')
def display_rule_master_delete():
 try:
  x=request.get_json(force=True) or {}
  name=str(x.get('name') or '').strip()
  if not name:return jsonify(error='ルール名を指定してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   # 参照している列があっても消せる(無いルール名は読み替えなしとして扱う)。
   # ただし**どこで使っていたかは返す**——消した後で「表示が戻った」と
   # 言われたときに、原因へたどり着けるようにするため。
   used=display_rule_usage(c,name)
   n=delete_display_rule(c,name)
   rules=display_rules(c)
  return jsonify(ok=True,name=name,deleted=n,used_by=used,rules=rules,
                 message=f'表示ルール「{name}」を削除しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'表示ルール削除失敗: {e}'),500


# ========================================================================
# ソートプリセットマスタ(§9.88新設): 「いつも使う並び順」。
# フィルタプリセット(/api/filter-presets)と同じ構成・同じ操作にしてある。
# ========================================================================
@bp.get('/api/sort-presets')
def sort_preset_list():
 try:
  db_key=str(request.args.get('db') or '').strip();table=str(request.args.get('table') or '').strip()
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   rows=sort_preset_rows(c)
  items=[]
  for r in rows:
   try:keys=json.loads(r[4] or '[]')
   except Exception:keys=[]
   items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),
                 'table':str(r[3] or '').strip(),'sorts':normalize_sort_keys(keys),
                 'uses':int(r[5] or 0),
                 'last_used':r[6].isoformat() if r[6] else None,
                 'updated_at':r[8].isoformat() if r[8] else None,
                 'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else ''),
                 'mode':(str(r[10]).strip() if len(r)>10 and r[10] else '')})
  if db_key:items=[x for x in items if x['db']==db_key]
  if table:items=[x for x in items if x['table']==table]
  mode=_filter_preset_mode(request.args.get('mode'))
  items=[x for x in items if x.get('mode','')==mode]
  return jsonify(ok=True,items=items,mode=mode,table=SORT_PRESET_TABLE,master_path=str(path))
 except Exception as e:return jsonify(error=f'ソートプリセット読込失敗: {e}'),500

@bp.post('/api/sort-presets')
def sort_preset_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='並び順の名前を入力してください。'),400
  keys=normalize_sort_keys(x.get('sorts'))
  if not keys:return jsonify(error='保存する並び順がありません。'),400
  db_key=str(x.get('db') or '').strip();table=str(x.get('table') or '').strip()
  mode=_filter_preset_mode(x.get('mode'));payload=json.dumps(keys,ensure_ascii=False)
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_sort_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[対象モード] FROM [ソートプリセットマスタ]')
   target=normalize_equipment_name(name)
   existing=next((r for r in cur.fetchall()
                  if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key
                  and str(r[3] or '')==table and str(r[4] or '')==mode),None)
   if existing:
    cur.execute('UPDATE [ソートプリセットマスタ] SET [並びJSON]=?,[有効]=-1,[更新者ID]=?,'
                '[更新日時]=Now() WHERE [プリセットID]=?',[payload,uid,existing[0]])
    registered=False;pid=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [ソートプリセットマスタ]')
    order=int(cur.fetchone()[0] or 0)+10
    cur.execute('INSERT INTO [ソートプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],'
                '[並びJSON],[使用回数],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,0,?,-1,?,?,Now(),Now())',
                [name,db_key,table,mode,payload,order,uid,uid])
    registered=True;pid=cur.lastrowid
   c.commit()
  return jsonify(ok=True,name=name,id=pid,registered=registered,updated_by=uid,
                 message=('並び順を登録しました。' if registered else '登録済みの並び順を更新しました。'))
 except Exception as e:return jsonify(error=f'ソートプリセット登録失敗: {e}'),500

@bp.post('/api/sort-presets/use')
def sort_preset_use():
 # よく使う順に並べるため、適用時に使用回数を加算する(フィルタと同じ)。
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(ok=True,skipped=True)
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,skipped=True)
  with connect(path,False) as c:
   ensure_sort_preset_table(c);cur=c.cursor()
   cur.execute('UPDATE [ソートプリセットマスタ] SET [使用回数]=Nz([使用回数],0)+1,'
               '[最終使用日時]=Now(),[更新者ID]=? WHERE [プリセットID]=?',[uid,pid])
   c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'使用回数更新失敗: {e}'),500

@bp.post('/api/sort-presets/delete')
def sort_preset_delete():
 try:
  x=request.get_json(force=True) or {};pid=x.get('id');uid=request_user_id(x)
  if pid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_sort_preset_table(c);cur=c.cursor()
   # 物理削除ではなく無効化(フィルタプリセットと同じ方針)。
   cur.execute('UPDATE [ソートプリセットマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() '
               'WHERE [プリセットID]=?',[uid,pid])
   c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'ソートプリセット削除失敗: {e}'),500

# ========================================================================
# 一覧表示設定マスタ(§9.88): 行間。列ではなく一覧全体の設定。
# ========================================================================
@bp.get('/api/list-view-master')
def list_view_master_get():
 try:
  target=str(request.args.get('target') or '').strip()
  if not target:return jsonify(error='対象(target)を指定してください。'),400
  path=DBS['MASTER']['path']
  if not path.exists():return jsonify(ok=True,target=target,rowGap=ROW_GAP_DEFAULT)
  with connect(path,True) as c:
   v=list_view_settings_for(c,target)
  return jsonify(ok=True,target=target,**v)
 except Exception as e:return jsonify(error=f'一覧表示設定読込失敗: {e}'),500

@bp.post('/api/list-view-master')
def list_view_master_save():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  target=str(x.get('target') or '').strip()
  if not target:return jsonify(error='対象(target)を指定してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   gap=set_list_view_settings(c,target,x.get('rowGap'),uid)
  return jsonify(ok=True,target=target,rowGap=gap,updated_by=uid,message='行間を保存しました。')
 except Exception as e:return jsonify(error=f'一覧表示設定保存失敗: {e}'),500


# ========================================================================
# クエリ結合マスタ(§9.193): データソース同士を突合キーでつなぐ
# ------------------------------------------------------------------------
# 実際の突合は backend/query_join.py の1箇所。ここは受付と、**保存する前に
# 確かめる**(probe)だけを持つ。読み込み先は起動時に1回だけ決まるので、
# 下見が無いと打ち間違いに気づけるのが再起動のあとになる(§9.168と同じ作法)。
# ========================================================================
def _join_payload(x):
 return {'name':x.get('name'),'left':x.get('left'),'leftTable':x.get('leftTable'),
         'right':x.get('right'),'rightTable':x.get('rightTable'),
         'keys':x.get('keys'),'columns':x.get('columns'),'prefix':x.get('prefix'),
         'multi':x.get('multi'),'kind':x.get('kind'),
         'order':x.get('order'),'enabled':x.get('enabled')}

@bp.get('/api/query-join-master')
def query_join_master_list():
 try:
  from .. import query_join
  from ..db_access import DBS as _DBS
  path=DBS['MASTER']['path']
  items=[]
  if path.exists():
   with connect(path,False) as c:
    ensure_query_join_table(c)
    items=query_joins(c,include_disabled=True)
  # 選べる相手は**データ接続に登録済みのものだけ**(§9.193、利用者の指示)。
  # 画面が別に一覧を作ると、消したデータソースが選択肢に残る。
  sources=[{'key':k,'label':v.get('label') or k,'purpose':v.get('purpose') or '',
            'listed':bool(v.get('listed',True)),'preferred':v.get('preferred') or ''}
           for k,v in _DBS.items() if v.get('role')=='readonly']
  # 既定の品質データ結合は**解除していても内容を返す**(§9.194)。
  # 「どうつないでいるのか」を見て真似できることが値打ちなので、
  # 解除＝見えなくする、にはしない（利用者の指示）。
  builtin=query_join.builtin_quality_def()
  return jsonify(ok=True,items=items,sources=sources,multiModes=list(QUERY_JOIN_MULTI),
                 kinds=query_join.JOIN_KINDS,kindDefault=query_join.JOIN_KIND_DEFAULT,
                 builtinEnabled=query_join.builtin_quality_enabled(),
                 builtin=({'name':builtin['name'],'left':builtin['left'],'right':builtin['right'],
                           'leftTable':builtin.get('leftTable') or '',
                           'rightTable':builtin.get('rightTable') or '',
                           'kind':builtin.get('kind') or query_join.JOIN_KIND_DEFAULT,
                           'multi':builtin.get('multi') or 'first',
                           'keys':builtin['keys']} if builtin else None))
 except Exception as e:return jsonify(error=f'クエリ結合マスタ読込失敗: {e}'),500

@bp.post('/api/query-join-master')
def query_join_master_register():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  with connect(DBS['MASTER']['path'],False) as c:
   jid=query_join_save(c,_join_payload(x),uid)
  return jsonify(ok=True,id=jid,updated_by=uid,message='結合を登録しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'クエリ結合の登録に失敗しました: {e}'),500

@bp.post('/api/query-join-master/update')
def query_join_master_update():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  jid=x.get('id')
  if jid is None or str(jid).strip()=='':return jsonify(error='更新対象IDがありません。'),400
  with connect(DBS['MASTER']['path'],False) as c:
   query_join_save(c,_join_payload(x),uid,jid=int(jid))
  return jsonify(ok=True,id=int(jid),updated_by=uid,message='結合を保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'クエリ結合の保存に失敗しました: {e}'),500

@bp.post('/api/query-join-master/delete')
def query_join_master_delete():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  jid=x.get('id')
  if jid is None or str(jid).strip()=='':return jsonify(error='削除対象IDがありません。'),400
  with connect(DBS['MASTER']['path'],False) as c:
   n=query_join_delete(c,int(jid))
  return jsonify(ok=True,deleted=n,updated_by=uid,
                 message='結合を削除しました。' if n else '対象が見つかりませんでした。')
 except Exception as e:return jsonify(error=f'クエリ結合の削除に失敗しました: {e}'),500

@bp.post('/api/query-join-master/builtin')
def query_join_master_builtin():
 """既定の品質データ結合を使う／使わない(§9.194、利用者の指示)。

 **解除してもエラーにしない**——足していた列が出なくなるだけで、その列を
 参照していた設定（列レイアウト・フィルタ）は「無い列」として静かに落ちる。
 保存先はパス設定マスタの1行なので、**再起動は要らない**。"""
 try:
  from .. import query_join
  from ..db_access import set_path_config
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  on=x.get('enabled')
  on=(str(on).strip().lower() not in ('0','false','off','no','無効')) if on is not None else True
  with connect(DBS['MASTER']['path'],False) as c:
   set_path_config(c,query_join.BUILTIN_QUALITY_SWITCH_KEY,'' if on else 'off',uid)
  return jsonify(ok=True,enabled=on,updated_by=uid,
                 message='既定の品質データ結合を使います。' if on
                         else '既定の品質データ結合を解除しました。品質の列は一覧に出なくなります。')
 except Exception as e:return jsonify(error=f'既定の結合を切り替えられませんでした: {e}'),500

@bp.post('/api/query-join-master/probe')
def query_join_master_probe():
 """保存する前に、いまのデータで実際に当ててみる。**読むだけ**。"""
 try:
  from .. import query_join
  from ..repositories.master_repo import normalize_join_keys, normalize_join_columns
  x=request.get_json(force=True) or {}
  d={'id':x.get('id'),'name':str(x.get('name') or '(下見)'),
     'left':str(x.get('left') or ''),'leftTable':str(x.get('leftTable') or ''),
     'right':str(x.get('right') or ''),'rightTable':str(x.get('rightTable') or ''),
     'keys':normalize_join_keys(x.get('keys')),
     'columns':normalize_join_columns(x.get('columns')),
     'prefix':str(x.get('prefix') or ''),'multi':str(x.get('multi') or 'first'),
     'kind':str(x.get('kind') or query_join.JOIN_KIND_DEFAULT),
     'active':True}
  if not d['keys']:
   return jsonify(ok=True,result={'ok':False,'reason':'突合キーを1組入れると、ここで結果を確かめられます。',
                                  'sampled':0,'matched':0,'ambiguous':0,'addedColumns':0,
                                  'addedColumnNames':[],'table':'','examples':[]}),200
  return jsonify(ok=True,result=query_join.probe(d))
 except Exception as e:return jsonify(error=f'下見に失敗しました: {e}'),500


# ========================================================================
# 操業データ(§9.215): 設備ごとに「何を記録するか」を持つ2つのマスタ。
#  - 操業データ項目マスタ   … 1行＝1つの入力欄
#  - 操業データ選択肢マスタ … 1行＝1つの選択肢(名前でひとまとまり)
# 値そのものは測定レコード(settings.opData)に入る。マスタへは入れない
# ——1ロット1枚の記録なので、レコードと一緒に運ばれるのが正しい(§9.91)。
# ========================================================================
def _op_read(fn):
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  return fn(c)

@bp.get('/api/operation-item-master')
def operation_item_list():
 """`equipment`を付けると**その設備で使う項目だけ**返す（`*`＝全設備の行も
    含む）。付けなければマスタ管理の一覧用に全部返す。"""
 try:
  from ..repositories import operation_repo as op
  eq=str(request.args.get('equipment') or '').strip()
  def fn(c):
   # **「出さない」にした項目も返す**（§9.219 ③）。落とすと盤から消えて
   # 戻せなくなる——盤は`is-off`の見た目で置き、測定画面だけが落とす。
   items=op.items_for_equipment(c,eq,True) if eq else op.item_rows(c,True)
   return {'items':items,'types':list(op.ITEM_TYPES),'choiceNames':op.choice_names(c),
           # 画面が「どこへ出すか」「何列ぶんか」を選ばせるための一覧(§9.216 ②)。
           # **画面へ書き写さない**——増減したときに2箇所を直すことになる。
           'places':list(op.PLACES),'spans':list(op.SPANS),'gridCols':op.GRID_COLS,
           'spanUnit':op.SPAN_UNIT,'widgets':list(op.WIDGETS),
           # §9.231 ② 上下限の出どころの語彙。**サーバーが答える**
           # ——画面へ書き写すと、増やしたときに2箇所直すことになる。
           # **いまの値も一緒に返す**（§CLAUDE 6「出どころ・単位・根拠を
           # 画面に出す」）——設定窓は「この設備だといくつになるか」を
           # 出せないと、選んでも効いているのか分からない。設備を選んで
           # いないときは`None`＝「まだ引けない」で、**0にしないこと**。
           'limitSources':[{'key':k,'label':l,'unit':u,
                            'value':(op.resolve_limit(c,k,eq) if eq and eq!='*' else None)}
                           for k,l,u in op.LIMIT_SOURCES],
           # 見せ方の選択肢(§9.221 ⑦)。**画面へ書き写さない**——増減したときに
           # 2箇所を直すことになり、片方だけ直った状態が作れる。
           'unitPlaces':list(op.UNIT_PLACES),'aligns':list(op.ALIGNS),
           'valueFormats':list(op.VALUE_FORMATS),
           # 単位を重ねられない入力方法（箱が1つではない）。画面は理由を
           # 文字で出すのに使う（§4）。
           'unitInBlocked':list(op.UNIT_IN_BLOCKED_WIDGETS),
           # 手打ちを許すと重ねられなくなる入力方法（§9.233 ④）。プルダウンは
           # 手打ちにすると`<select>`が器の裏へ回って1pxになるので、その隣へ
           # 重ねた単位は一度も見えない。**規則はサーバーの`unit_in_ok()`が
           # 持ち、画面は一覧を引くだけ**（判定を2つ持たない）。
           'unitInFreeTextBlocked':list(op.UNIT_IN_FREE_TEXT_BLOCKED),
           # 手打ちの席が無い入力方法（§9.247 ①）。`入切`はスイッチ1つ、
           # `切替`は押すたびに次へ進むボタン1つなので、**打ち込む場所が
           # 出せない**。設定窓はここを見て欄ごと押せなくし、理由を書く（§4）。
           # **規則はサーバーの`free_text_ok()`が持ち、画面は一覧を引くだけ。**
           'freeTextBlocked':list(op.FREE_TEXT_BLOCKED_WIDGETS),
           # §9.233 ⑤ 自動で入る値の添え書きの置き場と、添え書きを持つ
           # 項目の役割。**サーバーが答える**——「どの項目が添え書きを
           # 出すのか」は仕掛からの読み込みを持っている側しか知らない。
           'sourceNotePlaces':list(op.SOURCE_NOTE_PLACES),
           'sourceNoteKeys':list(op.SOURCE_NOTE_KEYS),
           # 値がこの画面の外から入る欄の分類（§9.234 ⑦、利用者の指示
           # 「自動に入力されるものについては配色してほしい」）。
           # **呼び名と説明もサーバーが答える**——画面へ写すと、増やしたときに
           # 2箇所直すことになる（§9.163）。
           'autoFills':[{'key':k,'label':l,'note':n} for k,l,n in op.AUTO_FILLS],
           # 自動で入る値・計算値の**語彙**（§9.234 ②、利用者の指示「自動で
           # 入る値、計算値についても、現在使っているものは、そのリストから
           # 選んで表示設定できるように」）。**サーバーが答える**——鍵の綴りを
           # 画面へ写すと、増やしたときに2箇所直すことになる（§9.163）。
           # 値の**引き方**は測定画面が持つ（出どころは開いているレコード）。
           'autoValues':[{'key':k,'label':l,'group':g,'unit':u,'note':n}
                         for k,l,g,u,n in op.AUTO_VALUES],
           # 並べ方(§9.226 ①)。**効く入力方法もサーバーが答える**——画面へ
           # 写すと、並べても何も起きない設定を選ばせることになる（§4）。
           'layouts':list(op.LAYOUTS),'layoutWidgets':list(op.LAYOUT_WIDGETS),
           # 型ごとに効く入力方法(§9.219 ③)。**判定はサーバーの1箇所**
           # （画面へ写すと、効く物の一覧が2つになる）。
           'widgetFamilies':{k:list(v) for k,v in op.WIDGET_FAMILIES.items()},
           # 型・組み込みキーがどの仲間かの**対応表**。画面は引くだけで、
           # 規則そのものは持たない（設定窓は型を切り替えた瞬間に効く物を
           # 出し分けるので、行の`widgetFamily`だけでは足りない）。
           'typeFamilies':{t:op.widget_family(t) for t in op.ITEM_TYPES},
           'builtinFamilies':dict(op.BUILTIN_FAMILIES),
           'choiceTypes':list(op.CHOICE_TYPES),
           'numberTypes':list(op.NUMBER_TYPES),
           'builtinKeys':list(op.BUILTIN_KEYS),
           'choiceNotes':op.choice_notes(c),
           # **読めなかった(None)は空の辞書として渡す**——画面は「使っている
           # 項目の一覧」を出すだけなので出せないものは出さないが、削除の
           # 可否はサーバー(`choice_delete_group`)が改めて数え直す。
           'choiceUsage':op.choice_usage(c) or {},
           # 選択肢のまとまり名のサジェスト(§9.220 ④)。**候補を選ぶ規則は
           # サーバーが持つ**——「同じ群が使っている」「名前が似ている」は
           # 判定であって表示ではないので、画面へ写すと答えが2つになる。
           'choiceHints':op.choice_hints(c),
           # --- §9.223 ①（役割と構成チェック）---
           # **必須はカードではなく構成が持つ**。役割の一覧と、いま誰が担って
           # いるか・足りない役割・二重の役割をサーバーが答える（画面に同じ
           # 判定を書かない——2つの答えが出る）。
           'roles':[{'key':k,'label':lb,'note':nt,'required':rq,'choice':gr}
                    for k,lb,nt,rq,gr in op.ROLE_SEEDS],
           'roleReport':op.role_report(items),
           # --- §9.223 ③（見た目の軸）---
           'lookColors':list(op.LOOK_COLORS),'lookShapes':list(op.LOOK_SHAPES),
           'lookSizes':list(op.LOOK_SIZES),
           'lookSlugs':{'color':dict(op.LOOK_COLOR_SLUG),'shape':dict(op.LOOK_SHAPE_SLUG),
                        'size':dict(op.LOOK_SIZE_SLUG)}}
  d=_op_read(fn)
  return jsonify(ok=True,equipment=eq,**d)
 except Exception as e:return jsonify(error=f'操業データ項目マスタの読込に失敗しました: {e}'),500

def _operation_item_save(x):
 from ..repositories import operation_repo as op
 uid=request_user_id(x)
 name=str(x.get('name') or '').strip()
 if not name:return jsonify(error='項目名を入力してください。'),400
 num=lambda v:(None if v in (None,'') else float(v))
 iv=lambda v:(None if v in (None,'') else int(v))
 ref={}
 try:
  def fn(c):
   return op.item_upsert(c,uid,equipment=x.get('equipment') or '*',
                         group=x.get('group') or '',name=name,order=iv(x.get('order')),
                         kind=x.get('type') or '文字',decimals=iv(x.get('decimals')),
                         vmin=num(x.get('min')),vmax=num(x.get('max')),
                         choice=x.get('choice') or '',unit=x.get('unit') or '',
                         required=bool(x.get('required')),note=x.get('note') or '',
                         enabled=(True if x.get('enabled') is None else bool(x.get('enabled'))),
                         item_id=(int(x['id']) if x.get('id') not in (None,'') else None),
                         place=x.get('place'),span=x.get('span'),
                         fold=bool(x.get('fold')),show_when=x.get('showWhen'),
                         widget=x.get('widget'),
                         # §9.220 ②③⑤
                         initial=x.get('initial'),free_text=bool(x.get('freeText')),
                         step=x.get('step'),
                         # §9.221 ⑦（単位の置き場・寄せ・見せ方・桁数）
                         unit_place=x.get('unitPlace'),align=x.get('align'),
                         value_format=x.get('valueFormat'),digits=x.get('digits'),
                         # §9.223 ①③（役割・見た目）
                         role=x.get('role'),look=x.get('look'),
                         # §9.226 ①③
                         layout=x.get('layout'),group_span=x.get('groupSpan'),
                         # §9.228 ② ダミー（空き）のカード。**送られてきた
                         # ときだけ**書く（設定窓は送らないので、触るたびに
                         # 空きが解けては困る）。
                         dummy=x.get('dummy'),
                         # §9.228 ④ 空欄（選ばない）の札を並べないか
                         no_blank=x.get('noBlank'),
                         # §9.231 ② 上下限の出どころ（空＝この行の数をそのまま）
                         min_from=x.get('minFrom'),max_from=x.get('maxFrom'),
                         # §9.233 ⑤ 自動で入る値の添え書きの置き場
                         source_note=x.get('sourceNote'),
                         # §9.234 ② 自動で入る値の鍵。**送られてきたときだけ**
                         # 書く（設定窓は送らないので、触るたびに人が打つ欄へ
                         # 戻っては困る。`dummy`と同じ約束）。
                         auto_value=x.get('autoValue'),
                         # §9.242 ④ ③「記録した値」のカードへ出すか。
                         # **送られてきたときだけ**書く（`dummy`と同じ約束）。
                         record_show=x.get('recordShow'),
                         report=ref)
  saved=_op_read(fn)
  # **付け替えたことは黙って済ませない**（§9.226 ①）。名前を変えると
  # 帳票の`settings.opData.<項目名>`も一緒に動くので、何件動いたかを言う。
  msg='操業データの項目を保存しました。'
  if ref.get('renamedRefs'):
   msg+=f"「{ref.get('oldName')}」を参照していた帳票ブロック{ref['renamedRefs']}件も新しい名前へ付け替えました。"
  return jsonify(ok=True,id=saved,message=msg,renamedRefs=ref.get('renamedRefs') or 0)
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'操業データ項目マスタの保存に失敗しました: {e}'),500

@bp.post('/api/operation-item-master')
def operation_item_register():
 return _operation_item_save(request.get_json(force=True) or {})

@bp.post('/api/operation-item-master/update')
def operation_item_update():
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _operation_item_save(x)

@bp.post('/api/operation-item-master/layout')
def operation_item_layout():
 """並び・群・列幅・置き場・必須・出す/出さないを**まとめて1回で**書く
    (§9.216 ②)。D&Dで組み替える画面なので、1行ずつ送ると往復が増え、
    途中で切れると並びが半分だけ変わった状態が残る。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 rows=x.get('items')
 if not isinstance(rows,list):return jsonify(error='items（並び）がありません。'),400
 try:
  # 設備を選んで並べているときは**その設備の上書きへ**書く（§9.239 ②）。
  # 空＝「共通（すべての設備）」で、今までどおり行そのものを書き換える。
  eq=str(x.get('equipment') or '').strip()
  n=_op_read(lambda c:op.item_layout_save(c,request_user_id(x),rows,equipment=eq))
  return jsonify(ok=True,saved=n,equipment=eq,
                 message=f'操業データの並びを保存しました（{eq or "共通（すべての設備）"}）。')
 except Exception as e:return jsonify(error=f'操業データの並びの保存に失敗しました: {e}'),500

@bp.post('/api/operation-item-master/record-layout')
def operation_item_record_layout():
 """③「記録した値」のカードの配置を**まとめて1回で**書く（§9.243）。

    D&Dで組み替える盤なので、1行ずつ送ると往復が増え、途中で切れると
    並びが半分だけ変わった状態が残る（`layout`と同じ理由）。
    書くのは`[記録表示]`／`[記録群]`／`[記録順]`の3つだけで、
    型・選択肢・役割・意匠には触らない。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 rows=x.get('items')
 if not isinstance(rows,list):return jsonify(error='items（配置）がありません。'),400
 try:
  n=_op_read(lambda c:op.record_layout_save(c,request_user_id(x),rows))
  return jsonify(ok=True,saved=n,message=f'「記録した値」の配置を保存しました（{n}件）。')
 except Exception as e:return jsonify(error=f'「記録した値」の配置の保存に失敗しました: {e}'),500

@bp.post('/api/operation-item-master/group')
def operation_item_group():
 """群のふるまい（畳む・開く条件）だけをまとめて書く(§9.216 ④)。
    `layout`で代用すると、直前に1件だけ更新した内容を古い写しで上書きする。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 g=str(x.get('group') or '').strip()
 if not g:return jsonify(error='群がありません。'),400
 try:
  n=_op_read(lambda c:op.group_flags_save(c,request_user_id(x),x.get('place'),g,
                                          bool(x.get('fold')),x.get('showWhen'),
                                          # **送られてきたときだけ書く**（§9.226 ③）
                                          x.get('groupSpan'),
                                          # §9.227 ③ ダミー（空き）の群
                                          x.get('dummy'),
                                          # §9.239 ② 設備を選んでいるときは上書きへ
                                          equipment=str(x.get('equipment') or '').strip()))
  return jsonify(ok=True,saved=n,message='群の設定を保存しました。')
 except Exception as e:return jsonify(error=f'群の設定の保存に失敗しました: {e}'),500

@bp.post('/api/operation-item-master/delete')
def operation_item_delete():
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 try:
  n=_op_read(lambda c:op.item_delete(c,x['id'],request_user_id(x)))
  return jsonify(ok=True,deleted=n,message='操業データの項目を削除しました。')
 except Exception as e:return jsonify(error=f'操業データ項目マスタの削除に失敗しました: {e}'),500

@bp.get('/api/operation-choice-master')
def operation_choice_list():
 try:
  from ..repositories import operation_repo as op
  def fn(c):
   # **6つのマスタの移行はここでも1度だけ通す**(§9.221 ③)。測定画面を
   # 開く前にマスタ管理を開いた端末では、まだ写していない状態で一覧が
   # 出る——「移したはずのオペレータが1人も居ない」に見える。
   try:op.migrate_legacy_choice_masters(c)
   except Exception:pass
   usage=op.choice_usage(c) or {}
   rows=op.choice_rows(c,True)
   # **どの項目がこの選択肢を使っているか**(§9.216 ④)。使い道の見えない
   # 選択肢は消してよいのか判断できず、消すと項目側が黙って空になる。
   # 一覧の1列として出せるよう、行にも畳んで入れる（画面で組み立てると
   # 「どこに出すか」を2箇所で決めることになる）。
   for r in rows:
    r['usedBy']='、'.join(usage.get(r['name'],[]))
   # ---------- まとまりごとに畳んだ姿(§9.221 ②、利用者の指示) ----------
   # 「まとまり名毎にまとめて管理したいです。まとまり名毎にさらに子マスタを
   #  持つような感じにしてマスタに階層構造を持たせたい」
   # **数えるのはサーバー**——件数・使い道・設備の有無は行を全部見ないと
   # 分からないので、画面で数え直すと同じ数字の出どころが2つになる。
   groups=[]
   for nm in op.choice_names(c):
    vals=[r for r in rows if r['name']==nm]
    groups.append({'name':nm,'count':len(vals),
                   'live':len([r for r in vals if r['enabled']]),
                   'usedBy':usage.get(nm,[]),
                   'hasEquipment':any(r['equipment'] for r in vals),
                   'hasReading':any(r['reading'] for r in vals),
                   'legacy':nm in [g for g,_ in op.LEGACY_CHOICE_GROUPS]})
   return {'items':rows,'names':op.choice_names(c),'usage':usage,'groups':groups,
           'legacyGroups':[g for g,_ in op.LEGACY_CHOICE_GROUPS]}
  return jsonify(ok=True,**_op_read(fn))
 except Exception as e:return jsonify(error=f'操業データ選択肢マスタの読込に失敗しました: {e}'),500

def _choice_on(v):
 """「出す/出さない」の真偽（§9.222 ⑥）。**文字列をそのまま`bool()`しない**
    ——汎用モーダルは`enabledText`に'出さない'を入れて送るので、`bool('出さない')`
    はTrueになり**「出さない」が一度も保存できない**（帳票ブロックの`_on()`で
    同じ罠を踏んでいる）。"""
 # **`None`は「送っていない」**（§9.212 ②）。Trueへ倒すと、説明やよみだけを
 # 直す呼び出しが「出さない」にしてあった行を毎回「出す」へ戻す。
 if v is None:return None
 if isinstance(v,str):return v.strip() not in ('出さない','無効','false','0','')
 return bool(v)

def _operation_choice_save(x):
 from ..repositories import operation_repo as op
 uid=request_user_id(x)
 iv=lambda v:(None if v in (None,'') else int(v))
 try:
  def fn(c):
   return op.choice_upsert(c,x.get('name'),x.get('value'),uid,order=iv(x.get('order')),
                           choice_id=(int(x['id']) if x.get('id') not in (None,'') else None),
                           enabled=_choice_on(x.get('enabledText') if x.get('enabledText') is not None
                                              else x.get('enabled')),
                           note=x.get('note'),
                           # §9.221 ③。よみ＝探すための読み、対象設備＝
                           # その設備のときだけ出す（空＝すべて）。
                           reading=x.get('reading'),equipment=x.get('equipment'))
  return jsonify(ok=True,id=_op_read(fn),message='操業データの選択肢を保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'操業データ選択肢マスタの保存に失敗しました: {e}'),500

@bp.post('/api/operation-choice-master')
def operation_choice_register():
 return _operation_choice_save(request.get_json(force=True) or {})

@bp.post('/api/operation-choice-master/update')
def operation_choice_update():
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _operation_choice_save(x)

@bp.post('/api/operation-choice-master/rename-group')
def operation_choice_rename_group():
 """まとまりの名前を変える(§9.221 ②)。**参照している項目の`[選択肢名]`も
    一緒に書き換える**——名前で結んでいるので(§9.215)、片方だけ変えると
    その項目の選択肢が黙って消える。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 src=str(x.get('from') or '').strip();dst=str(x.get('to') or '').strip()
 if not src or not dst:return jsonify(error='まとまり名を入力してください。'),400
 if src==dst:return jsonify(ok=True,moved=0,message='名前は変わっていません。')
 try:
  n=_op_read(lambda c:op.choice_rename_group(c,src,dst,request_user_id(x)))
  return jsonify(ok=True,moved=n,message=f'「{src}」を「{dst}」へ変更しました（{n}件）。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'まとまり名の変更に失敗しました: {e}'),500

@bp.post('/api/operation-choice-master/delete-group')
def operation_choice_delete_group():
 """まとまりごと消す(§9.221 ②)。**使っている項目があれば断る**——消すと
    その項目は黙って空の欄になる（§9.216 ④で「使い道の見えない選択肢は
    消してよいのか判断できない」と書いた、その裏返し）。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 nm=str(x.get('name') or '').strip()
 if not nm:return jsonify(error='まとまり名がありません。'),400
 try:
  n=_op_read(lambda c:op.choice_delete_group(c,nm,request_user_id(x)))
  return jsonify(ok=True,deleted=n,message=f'「{nm}」を{n}件まとめて削除しました。')
 except ValueError as e:return jsonify(error=str(e)),409
 except Exception as e:return jsonify(error=f'まとまりの削除に失敗しました: {e}'),500

@bp.post('/api/operation-choice-master/reorder')
def operation_choice_reorder():
 """1つのまとまりの中の並びをまとめて書く(§9.221 ②)。D&Dで並べ替える
    画面なので、1行ずつ送ると往復が増え、途中で切れると半分だけ動いた
    並びが残る（項目マスタの`layout`と同じ作法）。"""
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 ids=x.get('ids')
 if not isinstance(ids,list):return jsonify(error='ids（並び）がありません。'),400
 try:
  n=_op_read(lambda c:op.choice_reorder(c,ids,request_user_id(x)))
  return jsonify(ok=True,saved=n,message='選択肢の並びを保存しました。')
 except Exception as e:return jsonify(error=f'選択肢の並びの保存に失敗しました: {e}'),500

@bp.post('/api/operation-choice-master/delete')
def operation_choice_delete():
 from ..repositories import operation_repo as op
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 try:
  n=_op_read(lambda c:op.choice_delete(c,x['id'],request_user_id(x)))
  return jsonify(ok=True,deleted=n,message='操業データの選択肢を削除しました。')
 except Exception as e:return jsonify(error=f'操業データ選択肢マスタの削除に失敗しました: {e}'),500

# ========================================================================
# 帳票ブロックマスタ(§9.217)。「ラベルと値の出どころを並べただけの塊」を
# 現場が自分で足せるようにする。中身の作り方が仕事になっている塊
# （測定表・条の図・異常位置判定）はコードの側のまま。
# ========================================================================
@bp.get('/api/report-block-master')
def report_block_list():
 try:
  from ..repositories import report_block_repo as rb
  eq=str(request.args.get('equipment') or '').strip()
  def fn(c):
   items=rb.blocks_for_equipment(c,eq) if eq else rb.block_rows(c,True)
   return {'items':items,'spans':list(rb.SPANS),'rows':list(rb.ROWS),
           # **出さない既定の塊は名指しで返す**（§9.219 ②）。画面はコードの
           # 側にも既定の塊を持っているので、伝えないと外したつもりの塊が
           # 今までどおり出たままになる（`operation-form`の`builtinOff`と同じ）。
           'builtinOff':rb.builtin_off(c,eq),
           'builtinKeys':list(rb.BUILTIN_KEYS),
           # 塊の種別の選択肢（§9.234 ⑤）。**呼び名もサーバーが答える**
           # ——画面へ写すと、増やしたときに2箇所直すことになる（§9.163）。
           'kinds':[{'v':v,'label':lb} for v,lb in rb.KIND_LABELS],
           # 繰り返しの選択肢（§9.247 ②）。**呼び名もサーバーが答える**。
           'repeats':[{'v':v,'label':lb} for v,lb in rb.REPEAT_LABELS],
           'contentEditable':sorted(rb.CONTENT_EDITABLE),
           # **出どころの見本**。ここに無い道も書けるので、選択肢で塞がない。
           'fields':[{'label':a,'path':b} for a,b in rb.FIELD_CATALOG],
           # **選んで組み立てるための候補**（§9.226 ④）。操業データの項目も
           # 含むので、現場が項目を足せばそのまま候補に増える。
           'catalog':rb.field_catalog(c,eq)}
  return jsonify(ok=True,equipment=eq,**_op_read(fn))
 except Exception as e:return jsonify(error=f'帳票ブロックマスタの読込に失敗しました: {e}'),500

def _report_block_save(x):
 from ..repositories import report_block_repo as rb
 uid=request_user_id(x)
 name=str(x.get('name') or '').strip()
 if not name:return jsonify(error='ブロック名を入力してください。'),400
 iv=lambda v:(None if v in (None,'') else int(v))
 # 「有効」は画面からは文字列（有効/無効）で来る。**文字列をそのまま
 # `bool()`へ渡さないこと**——`'無効'`は真なので、外したつもりが効かない。
 def _on(v):
  if v is None:return True
  if isinstance(v,str):return v.strip() not in ('無効','false','0','')
  return bool(v)
 alive=_on(x.get('enabledText') if x.get('enabledText') is not None else x.get('enabled'))
 try:
  def fn(c):
   return rb.block_upsert(c,uid,equipment=x.get('equipment') or '*',name=name,
                          order=iv(x.get('order')),span=x.get('span'),rows=x.get('rows'),
                          content=x.get('content') or '',note=x.get('note') or '',
                          enabled=alive,cols=x.get('cols'),
                          # 種別（項目の並び／エリア）と、エリアに置く文字（§9.234 ⑤）。
                          # **文字列→内部値の変換は`normalize_kind`に任せる**
                          # ——ここで判定を書くと2つの答えが出る（§9.163）。
                          kind=(x.get('kindText') if x.get('kindText') is not None
                                else x.get('kind')),
                          text=x.get('text'),
                          # 繰り返し（§9.247 ②）。**呼び名でも受ける**
                          # ——画面の汎用フォームは文字列の選択欄しか持たない
                          # （`kindText`／`enabledText`とまったく同じ作法）。
                          repeat=(x.get('repeatText') if x.get('repeatText') is not None
                                  else x.get('repeat')),
                          block_id=(int(x['id']) if x.get('id') not in (None,'') else None))
  return jsonify(ok=True,id=_op_read(fn),message='帳票ブロックを保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'帳票ブロックマスタの保存に失敗しました: {e}'),500

@bp.post('/api/report-block-master')
def report_block_register():
 return _report_block_save(request.get_json(force=True) or {})

@bp.post('/api/report-block-master/update')
def report_block_update():
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _report_block_save(x)

@bp.post('/api/report-block-master/delete')
def report_block_delete():
 from ..repositories import report_block_repo as rb
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 try:
  n=_op_read(lambda c:rb.block_delete(c,x['id'],request_user_id(x)))
  return jsonify(ok=True,deleted=n,message='帳票ブロックを削除しました。')
 # **サーバーが理由を書いているのに包み直さない**（§9.200）。既定の塊は
 # 消せない、という断りは400で返す（500だと「失敗しました」に埋もれる）。
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'帳票ブロックマスタの削除に失敗しました: {e}'),500

# ========================================================================
# ロールマスタ(§9.239 ⑥、利用者の指示)
#  - 「欠陥のピッチから当設備のロールを判定する」ための諸元。
#  - 設備は**設備停止マスタと同じ書式**('A' / 'A,B,C' / '*')で、判定は
#    schedule_repo.stop_equipment_* の1箇所を借りる（新しい照合を書かない）。
#  - 語彙（入出位置・接触面・駆動方式）は**サーバーだけが持つ**（§9.163）。
#    画面へ写すと、増やしたときに2箇所直すことになる。
# ========================================================================
@bp.get('/api/roll-master')
def roll_master_list():
 try:
  from ..repositories import roll_repo as rr
  eq=str(request.args.get('equipment') or '').strip()
  def fn(c):
   items=rr.rolls_for_equipment(c,eq) if eq else rr.roll_rows(c,True)
   return {'items':items,
           'entryPositions':list(rr.ENTRY_POSITIONS),
           'contactFaces':list(rr.CONTACT_FACES),
           'driveKinds':list(rr.DRIVE_KINDS),
           'equipments':rr.equipments(c)}
  return jsonify(ok=True,equipment=eq,**_op_read(fn))
 except Exception as e:return jsonify(error=f'ロールマスタの読込に失敗しました: {e}'),500

def _roll_save(x):
 from ..repositories import roll_repo as rr
 uid=request_user_id(x)
 # 「有効」は画面からは文字列（有効/無効）で来る。**文字列をそのまま
 # `bool()`へ渡さないこと**——`'無効'`は真なので、外したつもりが効かない。
 def _on(v):
  if v is None:return None
  if isinstance(v,str):return v.strip() not in ('無効','出さない','false','0','')
  return bool(v)
 alive=_on(x.get('enabledText') if x.get('enabledText') is not None else x.get('enabled'))
 try:
  def fn(c):
   return rr.roll_upsert(c,uid,
     equipment=x.get('equipment'),name=x.get('name'),
     entry_pos=x.get('entryPos'),contact_face=x.get('contactFace'),
     dia_max=x.get('diaMax'),dia_min=x.get('diaMin'),face_len=x.get('faceLen'),
     material=x.get('material'),hardness=x.get('hardness'),count=x.get('count'),
     use_cond=x.get('useCond'),drive_kind=x.get('driveKind'),
     ref_no=x.get('refNo'),note=x.get('note'),order=x.get('order'),
     enabled=alive,
     roll_id=(int(x['id']) if x.get('id') not in (None,'') else None))
  return jsonify(ok=True,id=_op_read(fn),message='ロールを保存しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'ロールマスタの保存に失敗しました: {e}'),500

@bp.post('/api/roll-master')
def roll_master_register():
 return _roll_save(request.get_json(force=True) or {})

@bp.post('/api/roll-master/update')
def roll_master_update():
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _roll_save(x)

# ---- Excel の持ち出し・取り込み（§9.240、利用者の指示） ----
# **書き出しはGET（バイナリ）**。既存の唯一の前例（`logs.py`の
# `download_log`）と同じ`send_file`の作法に合わせる。
# **取り込みはJSON+base64**——この repo は multipart を1つも受けておらず、
# ここだけ別の受け口を作ると、後から触る人が2通りを覚えることになる。
@bp.get('/api/roll-master/export')
def roll_master_export():
 from ..repositories import roll_repo as rr
 try:
  eq=str(request.args.get('equipment') or '').strip()
  data=_op_read(lambda c:rr.export_bytes(c,eq))
  import time
  stamp=time.strftime('%Y%m%d-%H%M%S')
  name=('ロールマスタ_%s_%s.xlsx'%(eq,stamp)) if eq else ('ロールマスタ_%s.xlsx'%stamp)
  from flask import send_file
  import io
  return send_file(io.BytesIO(data),as_attachment=True,download_name=name,
                   mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 except Exception as e:return jsonify(error=f'ロールマスタの書き出しに失敗しました: {e}'),500

@bp.post('/api/roll-master/import')
def roll_master_import():
 """Excelから取り込む。**既定は下見**（`apply`を付けたときだけ書く）。

 §9.193 のクエリ結合と同じで、**保存する前に何が起きるかを見せる**
 ——何件が追加で何件が上書きか、どの行がなぜ飛ばされるか。"""
 from ..repositories import roll_repo as rr
 from ..xlsx_io import XlsxError
 x=request.get_json(force=True) or {}
 b64=str(x.get('fileBase64') or '')
 if not b64:return jsonify(error='ファイルがありません。'),400
 try:
  import base64
  if ',' in b64[:200] and b64.strip().startswith('data:'):
   b64=b64.split(',',1)[1]          # data: URL のまま来ても受ける
  data=base64.b64decode(b64)
 except Exception:
  return jsonify(error='ファイルを読み取れませんでした（送信の途中で壊れた可能性があります）。'),400
 apply=bool(x.get('apply'))
 try:
  uid=request_user_id(x)
  r=_op_read(lambda c:rr.import_rows(c,uid,data,dry_run=not apply))
  msg=(f"{r.get('saved',0)}件を取り込みました（追加{r['add']}・上書き{r['update']}）。"
       if apply else
       f"取り込むと 追加{r['add']}件・上書き{r['update']}件 になります。")
  if r['skipped']:msg+=f" 取り込めない行が{len(r['skipped'])}件あります。"
  return jsonify(ok=True,message=msg,**r)
 except XlsxError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'ロールマスタの取り込みに失敗しました: {e}'),500

@bp.post('/api/roll-master/delete')
def roll_master_delete():
 from ..repositories import roll_repo as rr
 x=request.get_json(force=True) or {}
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 try:
  n=_op_read(lambda c:rr.roll_delete(c,x['id'],request_user_id(x)))
  return jsonify(ok=True,deleted=n,message='ロールを削除しました。')
 except ValueError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'ロールマスタの削除に失敗しました: {e}'),500


@bp.get('/api/operation-form')
def operation_form():
 """測定画面が開いた瞬間に要る「その設備の入力欄一式」。**選択肢まで解決して
    返す**——2度目の問い合わせを画面にさせない。読めなくても測定は開けるよう、
    失敗しても項目0件で返す(fail-open)。"""
 try:
  from ..repositories import operation_repo as op
  eq=str(request.args.get('equipment') or '').strip()
  return jsonify(ok=True,equipment=eq,**_op_read(lambda c:op.form_for_equipment(c,eq)))
 except Exception as e:
  return jsonify(ok=True,equipment=str(request.args.get('equipment') or ''),items=[],
                 builtinOff=[],gridCols=op.GRID_COLS,
                 error=f'操業データの項目を読めませんでした: {e}')
