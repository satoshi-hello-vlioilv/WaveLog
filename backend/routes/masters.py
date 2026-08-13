"""masters.py: 各種マスタのCRUD API(Blueprint)。

backend/masters.py から移設。ロジックは変更していない(移動のみ)。データ
アクセス(テーブル定義・読み取り・正規化)は backend/repositories/master_repo.py
が持ち、ここではリクエストの受付とレスポンス整形のみを行う。

設備マスタ/オペレータマスタ(+作業可能設備)/スプール種別/内径種別/機器マスタ/
フィルタプリセット/列表示(表示マスタ)を提供する。すべてdb/master.sqlite3に保存し、
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
 OPERATOR_MASTER_TABLE, ensure_operator_master_table, normalize_operator_name, operator_master_rows,
 OPERATOR_EQUIPMENT_TABLE, ensure_operator_equipment_table, operator_equipment_map, set_operator_equipment,
 rename_equipment_references,
 SPOOL_MASTER_TABLE, ensure_spool_master_table, normalize_spool_name, spool_master_rows,
 INNER_MASTER_TABLE, ensure_inner_master_table, normalize_inner_name, inner_master_rows,
 BURR_MASTER_TABLE, ensure_burr_master_table, normalize_burr_name, burr_master_rows,
 COIL_STOP_MASTER_TABLE, ensure_coil_stop_master_table, normalize_coil_stop_name, coil_stop_master_rows,
 DEVICE_MASTER_TABLE, ensure_device_master_table, normalize_device_name, device_master_rows,
 FILTER_PRESET_TABLE, ensure_filter_preset_table, filter_preset_rows,
 COLUMN_DISPLAY_TABLE, ensure_column_display_table, hidden_columns_for, set_hidden_columns,
 SCHEDULE_COLUMN_TABLE, ensure_schedule_column_table, schedule_columns_for, set_schedule_columns,
 SCHEDULE_CONTENT_TABLE, ensure_schedule_content_table, schedule_content_items_for, set_schedule_content_items,
 COLUMN_LAYOUT_TABLE, ensure_column_layout_table, column_layout_for, set_column_layout,
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
                               else normalize_standard_minutes(r[8]))} for r in rows]
  return jsonify(ok=True,items=items,table=EQUIPMENT_MASTER_TABLE,created=not before,empty=len(items)==0,
                 stripLimit=STRIP_LIMIT,defaultMaxStrips=DEFAULT_MAX_STRIPS,
                 standardMinutesMax=STANDARD_MINUTES_MAX,
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
    cur.execute('INSERT INTO [設備マスタ] ([設備名],[区分],[最大条数],[標準時間分],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',[name,normalize_equipment_kind(x.get('kind')),(None if str(x.get('maxStrips') or '').strip()=='' else clamp_max_strips(x.get('maxStrips'))),normalize_standard_minutes(x.get('standardMinutes')),order,uid,uid])
    c.commit()
    return jsonify(ok=True,name=name,registered=True,reused=False,retiredAs=retired_name,retiredReferences=renamed,updated_by=uid,
                    message=f'「{name}」を新しい設備として登録しました。過去の設備は「{retired_name}」として履歴に残ります。')

   # 同名の既存行が無い場合: 通常の新規登録。
   cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
   cur.execute('INSERT INTO [設備マスタ] ([設備名],[区分],[最大条数],[標準時間分],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,-1,?,?,Now(),Now())',[name,normalize_equipment_kind(x.get('kind')),(None if str(x.get('maxStrips') or '').strip()=='' else clamp_max_strips(x.get('maxStrips'))),normalize_standard_minutes(x.get('standardMinutes')),order,uid,uid]);c.commit()
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
   cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[区分]=?,[最大条数]=?,[標準時間分]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[name,normalize_equipment_kind(x.get('kind')),max_strips,normalize_standard_minutes(x.get('standardMinutes')),uid,eid])
   # 設備名は他マスタ(オペレータ設備マスタ等、EQUIPMENT_NAME_REFERENCES参照)から
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

@bp.get('/api/operator-master')
def operator_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=OPERATOR_MASTER_TABLE in tables(c);ensure_operator_master_table(c);rows=operator_master_rows(c);eqmap=operator_equipment_map(c)
   # ﾖﾐｶﾞﾅ(yomi)は登録・更新時には保存していたのに、この一覧応答へ含めて
   # いなかったため、マスタ管理の「ヨミガナ」列が常に空欄で、編集フォームにも
   # 復元されなかった。そのまま保存すると空欄で上書きされて消える不具合に
   # なっていたので応答へ加える。
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'yomi':(str(r[6]).strip() if len(r)>6 and r[6] else ''),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else ''),'equipment':eqmap.get(r[0],[])} for r in rows]
  return jsonify(ok=True,items=items,table=OPERATOR_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'オペレータマスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/operator-master')
def operator_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();yomi=str(x.get('yomi') or '').strip();equipment=x.get('equipment') or [];uid=request_user_id(x)
  if not name:return jsonify(error='氏名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名] FROM [オペレータマスタ]');rows=cur.fetchall();target=normalize_operator_name(name);existing=next((r for r in rows if normalize_operator_name(r[1])==target),None)
   if existing:
    # 既存氏名は有効化のみ。ﾖﾐｶﾞﾅは指定があるときだけ更新する（値の有無で分岐する）。
    if yomi:cur.execute('UPDATE [オペレータマスタ] SET [有効]=-1,[ﾖﾐｶﾞﾅ]=?,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[yomi,uid,existing[0]])
    else:cur.execute('UPDATE [オペレータマスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip();oid=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [オペレータマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [オペレータマスタ] ([氏名],[ﾖﾐｶﾞﾅ],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,yomi,order,uid,uid]);registered=True;stored_name=name
    oid=cur.lastrowid
   c.commit();set_operator_equipment(c,oid,equipment,uid)
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('オペレータマスタへ新規登録しました。' if registered else 'オペレータマスタの登録済み氏名を有効化しました。'))
 except Exception as e:return jsonify(error=f'オペレータマスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/operator-master/update')
def operator_master_update():
 try:
  x=request.get_json(force=True) or {};oid=x.get('id');name=str(x.get('name') or '').strip();yomi=str(x.get('yomi') or '').strip();equipment=x.get('equipment');uid=request_user_id(x)
  if oid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='氏名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor();cur.execute('SELECT [オペレータID],[氏名] FROM [オペレータマスタ]');rows=cur.fetchall();target=normalize_operator_name(name)
   dup=next((r for r in rows if normalize_operator_name(r[1])==target and str(r[0])!=str(oid)),None)
   if dup:return jsonify(error=f'同名の氏名が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [オペレータマスタ] SET [氏名]=?,[ﾖﾐｶﾞﾅ]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[name,yomi,uid,oid]);c.commit()
   if equipment is not None:set_operator_equipment(c,oid,equipment,uid)
  return jsonify(ok=True,id=oid,name=name,updated_by=uid,message='オペレータを更新しました。')
 except Exception as e:return jsonify(error=f'オペレータマスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/operator-master/delete')
def operator_master_delete():
 try:
  x=request.get_json(force=True) or {};oid=x.get('id');uid=request_user_id(x)
  if oid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_operator_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [オペレータマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [オペレータID]=?',[uid,oid]);c.commit()
  return jsonify(ok=True,id=oid,updated_by=uid)
 except Exception as e:return jsonify(error=f'オペレータマスタ削除失敗: {e}'),500

# ------------------------------------------------------------------------
# 「名前だけ」の単純マスタのCRUD（スプール種別・内径種別・機器・バリ揃え・
# コイル止め）。**1マスタ=1宣言**で4本(一覧/登録/編集/削除)を生成する。
#
# なぜ生成するか。画面(master-maint.jsのsubmitMaint)は
# `GET <endpoint>` / `POST <endpoint>` / `POST <endpoint>/update` /
# `POST <endpoint>/delete` を決め打ちで呼ぶので、**サーバー側の1本を
# 書き忘れても押すまで気づけない**(404のHTMLがそのままトーストに出る。
# 実際に設備停止・設備停止分類・データソースの3つで起きた)。個別に写経すると
# 片方だけ直って食い違う事故も同じ根から出る。
#
# **畳んだのはこの5つだけ**で、オペレータ(作業可能設備の別表)・設備(参照件数の
# 確認と最大条数・区分)・アクセス権限(6項目)は畳んでいない。フラグで吸収すると
# 生成側が読めなくなり、重複より高くつくため(docs/REFACTORING_PLAN.md フェーズC)。
#
# Blueprintは 'masters' のままなので、書込ガード(_WRITE_ALLOWED_MODES)は
# 他のマスタと同じ edit 限定がそのまま効く。
# ------------------------------------------------------------------------
# 文言はマスタごとに言い回しだけが違う。**既定を持ち、違う行だけ差し替える**
# (畳む前の文面をそのまま残すため。ここを揃えると画面に出る文が変わる)。
_MASTER_WORDS={
 'required':'{label}を入力してください。',
 'created' :'{label}マスタへ新規登録しました。',
 'enabled' :'{label}マスタの登録済み項目を有効化しました。',
 'dup'     :'同名が既に存在するため変更できません: {name}',
 'updated' :'{label}を更新しました。',
}

def _simple_item(r):
 """[ID],[名前],[表示順],[有効],[更新日時],[更新者ID] の並びを画面の形へ。"""
 return {'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,
         'updated_at':r[4].isoformat() if r[4] else None,
         'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')}

def _device_item(r):
 """機器マスタだけ[測定区分]が1列入るので、位置が1つずつ後ろへずれる。"""
 return {'id':r[0],'name':str(r[1] or '').strip(),'kind':str(r[2] or '').strip(),
         'order':r[3] or 0,'active':True,
         'updated_at':r[5].isoformat() if r[5] else None,
         'updated_by':(str(r[6]).strip() if len(r)>6 and r[6] else '')}

def _register_simple_master(spec):
 """宣言1つから4本のエンドポイントを生成する。

 spec のキー:
   url/table/id/name/label/ensure/rows/normalize … 必須
   item  … 1行を画面の形へ直す関数(既定 _simple_item)
   extra … 名前のほかに1列持つマスタ用。{'col':列名,'key':受け渡し名}。
           **同一判定にもこの列を含める**(機器は測定区分＋機器名で1件)。
   words … 文言の差し替え(_MASTER_WORDS の一部)
 """
 url,table,id_col,name_col=spec['url'],spec['table'],spec['id'],spec['name']
 label,ensure_table,rows_fn=spec['label'],spec['ensure'],spec['rows']
 normalize=spec['normalize'];item_fn=spec.get('item') or _simple_item
 extra=spec.get('extra');ex_col=extra['col'] if extra else '';ex_key=extra['key'] if extra else ''
 words=dict(_MASTER_WORDS);words.update(spec.get('words') or {})
 def say(key,**kw):return words[key].format(label=label,**kw)

 def list_route():
  try:
   path=DBS['MASTER']['path']
   with connect(path,False) as c:
    before=table in tables(c);ensure_table(c);rows=rows_fn(c)
    items=[item_fn(r) for r in rows]
   return jsonify(ok=True,items=items,table=table,created=not before,empty=len(items)==0,master_path=str(path))
  except Exception as e:return jsonify(error=f'{label}マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

 def register_route():
  try:
   x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip()
   ex=str(x.get(ex_key) or '').strip() if extra else ''
   note=str(x.get('note') or '').strip();uid=request_user_id(x)
   if not name:return jsonify(error=say('required')),400
   with connect(DBS['MASTER']['path'],False) as c:
    ensure_table(c);cur=c.cursor()
    cur.execute(f'SELECT [{id_col}],[{name_col}]'+(f',[{ex_col}]' if extra else '')+f' FROM [{table}]')
    rows=cur.fetchall();target=normalize(name);ex_target=normalize(ex) if extra else None
    existing=next((r for r in rows if normalize(r[1])==target
                   and (not extra or normalize(r[2])==ex_target)),None)
    if existing:
     # 既存は有効化のみ。備考は指定があるときだけ更新する（値の有無で分岐する）。
     if note:cur.execute(f'UPDATE [{table}] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [{id_col}]=?',[note,uid,existing[0]])
     else:cur.execute(f'UPDATE [{table}] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [{id_col}]=?',[uid,existing[0]])
     registered=False;stored=str(existing[1]).strip()
    else:
     cur.execute(f'SELECT Max([表示順]) FROM [{table}]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
     head=f'[{name_col}],'+(f'[{ex_col}],' if extra else '')+'[備考],[表示順]'
     marks='?,'*(3 if extra else 2)+'?'
     cur.execute(f'INSERT INTO [{table}] ({head},[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                 f'VALUES ({marks},-1,?,?,Now(),Now())',
                 ([name,ex,note,order] if extra else [name,note,order])+[uid,uid])
     registered=True;stored=name
    c.commit()
   out={'ok':True,'name':stored,'registered':registered,'updated_by':uid,
        'message':(say('created') if registered else say('enabled'))}
   if extra:out[ex_key]=ex
   return jsonify(**out)
  except Exception as e:return jsonify(error=f'{label}マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

 def update_route():
  try:
   x=request.get_json(force=True) or {};rid=x.get('id');name=str(x.get('name') or '').strip()
   ex=str(x.get(ex_key) or '').strip() if extra else ''
   note=str(x.get('note') or '').strip();uid=request_user_id(x)
   if rid is None:return jsonify(error='更新対象IDがありません。'),400
   if not name:return jsonify(error=say('required')),400
   with connect(DBS['MASTER']['path'],False) as c:
    ensure_table(c);cur=c.cursor()
    cur.execute(f'SELECT [{id_col}],[{name_col}]'+(f',[{ex_col}]' if extra else '')+f' FROM [{table}]')
    rows=cur.fetchall();target=normalize(name);ex_target=normalize(ex) if extra else None
    dup=next((r for r in rows if normalize(r[1])==target
              and (not extra or normalize(r[2])==ex_target) and str(r[0])!=str(rid)),None)
    if dup:return jsonify(error=say('dup',name=str(dup[1]).strip())),409
    sets=f'[{name_col}]=?,'+(f'[{ex_col}]=?,' if extra else '')+'[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now()'
    cur.execute(f'UPDATE [{table}] SET {sets} WHERE [{id_col}]=?',
                ([name,ex,note,uid,rid] if extra else [name,note,uid,rid]))
    c.commit()
   out={'ok':True,'id':rid,'name':name,'updated_by':uid,'message':say('updated')}
   if extra:out[ex_key]=ex
   return jsonify(**out)
  except Exception as e:return jsonify(error=f'{label}マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

 def delete_route():
  try:
   x=request.get_json(force=True) or {};rid=x.get('id');uid=request_user_id(x)
   if rid is None:return jsonify(error='削除対象IDがありません。'),400
   with connect(DBS['MASTER']['path'],False) as c:
    ensure_table(c);cur=c.cursor()
    # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
    cur.execute(f'UPDATE [{table}] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [{id_col}]=?',[uid,rid]);c.commit()
   return jsonify(ok=True,id=rid,updated_by=uid)
  except Exception as e:return jsonify(error=f'{label}マスタ削除失敗: {e}'),500

 # Flaskはエンドポイント名を関数名から取るため、生成した関数は名前が衝突する。
 # endpoint= で明示し、アクセスモードの許可表(Blueprint名.関数名)からも
 # 一意に指せるようにする。**畳む前の関数名をそのまま使う**ので、
 # _WRITE_ALLOWED_MODES/_ENDPOINT_EXTRA_MODES の見え方は変わらない。
 key=spec.get('endpoint') or url.replace('-','_')
 bp.add_url_rule(f'/api/{url}',endpoint=f'{key}_list',view_func=list_route,methods=['GET'])
 bp.add_url_rule(f'/api/{url}',endpoint=f'{key}_register',view_func=register_route,methods=['POST'])
 bp.add_url_rule(f'/api/{url}/update',endpoint=f'{key}_update',view_func=update_route,methods=['POST'])
 bp.add_url_rule(f'/api/{url}/delete',endpoint=f'{key}_delete',view_func=delete_route,methods=['POST'])

# **新しい単純マスタはここへ1行足すだけ**。4本が揃うので書き忘れが起きない。
SIMPLE_MASTERS=[
 {'url':'spool-master','table':SPOOL_MASTER_TABLE,'id':'スプールID','name':'種別名',
  'label':'スプール種別','endpoint':'spool_master',
  'ensure':ensure_spool_master_table,'rows':spool_master_rows,'normalize':normalize_spool_name,
  'words':{'required':'種別名を入力してください。',
           'enabled':'スプール種別マスタの登録済み種別を有効化しました。',
           'dup':'同名の種別が既に存在するため変更できません: {name}'}},
 {'url':'inner-master','table':INNER_MASTER_TABLE,'id':'内径ID','name':'内径種別',
  'label':'内径種別','endpoint':'inner_master',
  'ensure':ensure_inner_master_table,'rows':inner_master_rows,'normalize':normalize_inner_name,
  'words':{'enabled':'内径種別マスタの登録済み種別を有効化しました。',
           'dup':'同名の内径種別が既に存在するため変更できません: {name}'}},
 {'url':'device-master','table':DEVICE_MASTER_TABLE,'id':'機器ID','name':'機器名',
  'label':'機器','endpoint':'device_master','item':_device_item,
  'ensure':ensure_device_master_table,'rows':device_master_rows,'normalize':normalize_device_name,
  # 機器は「測定区分＋機器名」で1件。同一判定にも保存にも区分が要る。
  'extra':{'col':'測定区分','key':'kind'},
  'words':{'required':'機器名を入力してください。',
           'enabled':'機器マスタの登録済み機器を有効化しました。',
           'dup':'同じ測定区分・機器名が既に存在するため変更できません: {name}'}},
 {'url':'burr-master','table':BURR_MASTER_TABLE,'id':'バリ揃えID','name':'バリ揃え',
  'label':'バリ揃え',
  'ensure':ensure_burr_master_table,'rows':burr_master_rows,'normalize':normalize_burr_name},
 {'url':'coil-stop-master','table':COIL_STOP_MASTER_TABLE,'id':'コイル止めID','name':'コイル止め',
  'label':'コイル止め',
  'ensure':ensure_coil_stop_master_table,'rows':coil_stop_master_rows,'normalize':normalize_coil_stop_name},
]
for _spec in SIMPLE_MASTERS:_register_simple_master(_spec)

def _filter_preset_mode(raw):
 """登録フィルタの置き場(§9.80)。スケジュールモードだけを別に持ち、
 それ以外(編集・閲覧)は共通の''にまとめる。**3つに分けない**——
 編集と閲覧で同じ一覧を同じ列構成で見るので、条件を分ける理由が無い。"""
 return 'schedule' if str(raw or '').strip()=='schedule' else ''

@bp.get('/api/filter-presets')
def filter_preset_list():
 try:
  db_key=str(request.args.get('db') or '').strip();table=str(request.args.get('table') or '').strip()
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=FILTER_PRESET_TABLE in tables(c);rows=filter_preset_rows(c)
   items=[]
   for r in rows:
    try:filters=json.loads(r[4] or '[]')
    except Exception:filters=[]
    if not isinstance(filters,list):filters=[]
    items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),'table':str(r[3] or '').strip(),'filters':filters,'uses':int(r[5] or 0),'last_used':r[6].isoformat() if r[6] else None,'updated_at':r[8].isoformat() if r[8] else None,'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else ''),'mode':(str(r[10]).strip() if len(r)>10 and r[10] else '')})
  # ファイル(DB)＆テーブルごとに個別管理するため、対象DB/対象テーブルが
  # 空欄のプリセット(=以前の実装が汎用として扱っていたもの)であっても、
  # 厳密に一致しない限り対象外とする。
  if db_key:items=[x for x in items if x['db']==db_key]
  if table:items=[x for x in items if x['table']==table]
  # 対象モード(§9.80)。同じ仕掛一覧でもスケジュールモードは列構成が変わるので、
  # 条件の置き場も分ける。指定が無ければ共通('')のものだけを返す。
  mode=_filter_preset_mode(request.args.get('mode'))
  items=[x for x in items if x.get('mode','')==mode]
  return jsonify(ok=True,items=items,mode=mode,table=FILTER_PRESET_TABLE,created=not before,master_path=str(path))
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
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[対象モード] FROM [フィルタプリセットマスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key and str(r[3] or '')==table and str(r[4] or '')==mode),None)
   if existing:
    cur.execute('UPDATE [フィルタプリセットマスタ] SET [条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[payload,uid,existing[0]]);registered=False;preset_id=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[使用回数],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,0,?,-1,?,?,Now(),Now())',[name,db_key,table,mode,payload,order,uid,uid]);registered=True
    preset_id=cur.lastrowid
   c.commit()
  return jsonify(ok=True,name=name,id=preset_id,registered=registered,updated_by=uid,message=('フィルタマスタへ新規登録しました。' if registered else '登録済みフィルタを更新しました。'))
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
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [フィルタプリセットマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[uid,pid]);c.commit()
  return jsonify(ok=True,id=pid,updated_by=uid)
 except Exception as e:return jsonify(error=f'フィルタプリセット削除失敗: {e}'),500

@bp.get('/api/column-display-master')
def column_display_master_list():
 try:
  dbkey=str(request.args.get('db') or '').strip()
  if not dbkey:return jsonify(error='対象DBを指定してください。'),400
  cf=cfg(dbkey)
  with connect(cf['path'],cf['role']=='readonly') as c:
   a=tables(c);table=cf['preferred'] if cf['preferred'] in a else (a[0] if a else None)
   real_columns=cols(c,table) if table else []
  master=DBS['MASTER']['path'];hidden=set()
  if master.exists():
   with connect(master,True) as mc:hidden=hidden_columns_for(mc,dbkey)
  return jsonify(ok=True,db=dbkey,label=cf['label'],table=table,columns=real_columns,hidden=sorted(hidden & set(real_columns)))
 except Exception as e:return jsonify(error=f'表示マスタ読込失敗: {e}'),500

@bp.post('/api/column-display-master')
def column_display_master_update():
 try:
  x=request.get_json(force=True) or {};dbkey=str(x.get('db') or '').strip();hidden=x.get('hidden');uid=request_user_id(x)
  if not dbkey:return jsonify(error='対象DBを指定してください。'),400
  if dbkey not in DBS:return jsonify(error='対象DBが不正です。'),400
  if not isinstance(hidden,list):return jsonify(error='非表示列の指定が不正です。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   set_hidden_columns(c,dbkey,hidden,uid)
  return jsonify(ok=True,db=dbkey,hidden=hidden,updated_by=uid,message='表示設定を保存しました。')
 except Exception as e:return jsonify(error=f'表示マスタ更新失敗: {e}'),500

# ========================================================================
# スケジュール列表示マスタ(§9.18新設): 設備ごとにスケジュール画面(分割/
# ポップアップ表示)の仕掛一覧へ出す列を選べるようにする。上の表示マスタ
# (DB単位・常時・ブロックリスト)とは軸も適用範囲も異なる別マスタ。
# ========================================================================
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
                       locks=locks if isinstance(locks,list) else [])
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
