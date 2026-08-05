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
 OPERATOR_MASTER_TABLE, ensure_operator_master_table, normalize_operator_name, operator_master_rows,
 OPERATOR_EQUIPMENT_TABLE, ensure_operator_equipment_table, operator_equipment_map, set_operator_equipment,
 rename_equipment_references,
 SPOOL_MASTER_TABLE, ensure_spool_master_table, normalize_spool_name, spool_master_rows,
 INNER_MASTER_TABLE, ensure_inner_master_table, normalize_inner_name, inner_master_rows,
 DEVICE_MASTER_TABLE, ensure_device_master_table, normalize_device_name, device_master_rows,
 FILTER_PRESET_TABLE, ensure_filter_preset_table, filter_preset_rows,
 COLUMN_DISPLAY_TABLE, ensure_column_display_table, hidden_columns_for, set_hidden_columns,
 SCHEDULE_COLUMN_TABLE, ensure_schedule_column_table, schedule_columns_for, set_schedule_columns,
 SCHEDULE_CONTENT_TABLE, ensure_schedule_content_table, schedule_content_items_for, set_schedule_content_items,
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
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=EQUIPMENT_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
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
    cur.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',[name,order,uid,uid])
    c.commit()
    return jsonify(ok=True,name=name,registered=True,reused=False,retiredAs=retired_name,retiredReferences=renamed,updated_by=uid,
                    message=f'「{name}」を新しい設備として登録しました。過去の設備は「{retired_name}」として履歴に残ります。')

   # 同名の既存行が無い場合: 通常の新規登録。
   cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
   cur.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',[name,order,uid,uid]);c.commit()
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
   cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[name,uid,eid])
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

@bp.get('/api/spool-master')
def spool_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=SPOOL_MASTER_TABLE in tables(c);ensure_spool_master_table(c);rows=spool_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=SPOOL_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'スプール種別マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/spool-master')
def spool_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='種別名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor();cur.execute('SELECT [スプールID],[種別名] FROM [スプール種別マスタ]');rows=cur.fetchall();target=normalize_spool_name(name);existing=next((r for r in rows if normalize_spool_name(r[1])==target),None)
   if existing:
    # 既存種別は有効化のみ。備考は指定があるときだけ更新する（値の有無で分岐する）。
    if note:cur.execute('UPDATE [スプール種別マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [スプール種別マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [スプール種別マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [スプール種別マスタ] ([種別名],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('スプール種別マスタへ新規登録しました。' if registered else 'スプール種別マスタの登録済み種別を有効化しました。'))
 except Exception as e:return jsonify(error=f'スプール種別マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/spool-master/update')
def spool_master_update():
 try:
  x=request.get_json(force=True) or {};sid=x.get('id');name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if sid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='種別名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor();cur.execute('SELECT [スプールID],[種別名] FROM [スプール種別マスタ]');rows=cur.fetchall();target=normalize_spool_name(name)
   dup=next((r for r in rows if normalize_spool_name(r[1])==target and str(r[0])!=str(sid)),None)
   if dup:return jsonify(error=f'同名の種別が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [スプール種別マスタ] SET [種別名]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[name,note,uid,sid]);c.commit()
  return jsonify(ok=True,id=sid,name=name,updated_by=uid,message='スプール種別を更新しました。')
 except Exception as e:return jsonify(error=f'スプール種別マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/spool-master/delete')
def spool_master_delete():
 try:
  x=request.get_json(force=True) or {};sid=x.get('id');uid=request_user_id(x)
  if sid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_spool_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [スプール種別マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [スプールID]=?',[uid,sid]);c.commit()
  return jsonify(ok=True,id=sid,updated_by=uid)
 except Exception as e:return jsonify(error=f'スプール種別マスタ削除失敗: {e}'),500

@bp.get('/api/inner-master')
def inner_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=INNER_MASTER_TABLE in tables(c);ensure_inner_master_table(c);rows=inner_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=INNER_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'内径種別マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/inner-master')
def inner_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='内径種別を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor();cur.execute('SELECT [内径ID],[内径種別] FROM [内径種別マスタ]');rows=cur.fetchall();target=normalize_inner_name(name);existing=next((r for r in rows if normalize_inner_name(r[1])==target),None)
   if existing:
    # 既存種別は有効化のみ。備考は指定があるときだけ更新する（値の有無で分岐する）。
    if note:cur.execute('UPDATE [内径種別マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [内径種別マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [内径種別マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [内径種別マスタ] ([内径種別],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,-1,?,?,Now(),Now())',[name,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('内径種別マスタへ新規登録しました。' if registered else '内径種別マスタの登録済み種別を有効化しました。'))
 except Exception as e:return jsonify(error=f'内径種別マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/inner-master/update')
def inner_master_update():
 try:
  x=request.get_json(force=True) or {};iid=x.get('id');name=str(x.get('name') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if iid is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='内径種別を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor();cur.execute('SELECT [内径ID],[内径種別] FROM [内径種別マスタ]');rows=cur.fetchall();target=normalize_inner_name(name)
   dup=next((r for r in rows if normalize_inner_name(r[1])==target and str(r[0])!=str(iid)),None)
   if dup:return jsonify(error=f'同名の内径種別が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [内径種別マスタ] SET [内径種別]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[name,note,uid,iid]);c.commit()
  return jsonify(ok=True,id=iid,name=name,updated_by=uid,message='内径種別を更新しました。')
 except Exception as e:return jsonify(error=f'内径種別マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/inner-master/delete')
def inner_master_delete():
 try:
  x=request.get_json(force=True) or {};iid=x.get('id');uid=request_user_id(x)
  if iid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_inner_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [内径種別マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [内径ID]=?',[uid,iid]);c.commit()
  return jsonify(ok=True,id=iid,updated_by=uid)
 except Exception as e:return jsonify(error=f'内径種別マスタ削除失敗: {e}'),500

@bp.get('/api/device-master')
def device_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=DEVICE_MASTER_TABLE in tables(c);ensure_device_master_table(c);rows=device_master_rows(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'kind':str(r[2] or '').strip(),'order':r[3] or 0,'active':True,'updated_at':r[5].isoformat() if r[5] else None,'updated_by':(str(r[6]).strip() if len(r)>6 and r[6] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=DEVICE_MASTER_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'機器マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/device-master')
def device_master_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();kind=str(x.get('kind') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='機器名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor();cur.execute('SELECT [機器ID],[機器名],[測定区分] FROM [機器マスタ]');rows=cur.fetchall();tn=normalize_device_name(name);tk=normalize_device_name(kind);existing=next((r for r in rows if normalize_device_name(r[1])==tn and normalize_device_name(r[2])==tk),None)
   if existing:
    # 既存（区分＋機器名一致）は有効化のみ。備考は指定があるときだけ更新する（値の有無で分岐する）。
    if note:cur.execute('UPDATE [機器マスタ] SET [有効]=-1,[備考]=?,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[note,uid,existing[0]])
    else:cur.execute('UPDATE [機器マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[uid,existing[0]])
    registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [機器マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [機器マスタ] ([機器名],[測定区分],[備考],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,-1,?,?,Now(),Now())',[name,kind,note,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,kind=kind,registered=registered,updated_by=uid,message=('機器マスタへ新規登録しました。' if registered else '機器マスタの登録済み機器を有効化しました。'))
 except Exception as e:return jsonify(error=f'機器マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/device-master/update')
def device_master_update():
 try:
  x=request.get_json(force=True) or {};did=x.get('id');name=str(x.get('name') or '').strip();kind=str(x.get('kind') or '').strip();note=str(x.get('note') or '').strip();uid=request_user_id(x)
  if did is None:return jsonify(error='更新対象IDがありません。'),400
  if not name:return jsonify(error='機器名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor();cur.execute('SELECT [機器ID],[機器名],[測定区分] FROM [機器マスタ]');rows=cur.fetchall();tn=normalize_device_name(name);tk=normalize_device_name(kind)
   dup=next((r for r in rows if normalize_device_name(r[1])==tn and normalize_device_name(r[2])==tk and str(r[0])!=str(did)),None)
   if dup:return jsonify(error=f'同じ測定区分・機器名が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   cur.execute('UPDATE [機器マスタ] SET [機器名]=?,[測定区分]=?,[備考]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[name,kind,note,uid,did]);c.commit()
  return jsonify(ok=True,id=did,name=name,kind=kind,updated_by=uid,message='機器を更新しました。')
 except Exception as e:return jsonify(error=f'機器マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/device-master/delete')
def device_master_delete():
 try:
  x=request.get_json(force=True) or {};did=x.get('id');uid=request_user_id(x)
  if did is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_device_master_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [機器マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [機器ID]=?',[uid,did]);c.commit()
  return jsonify(ok=True,id=did,updated_by=uid)
 except Exception as e:return jsonify(error=f'機器マスタ削除失敗: {e}'),500

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
    items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),'table':str(r[3] or '').strip(),'filters':filters,'uses':int(r[5] or 0),'last_used':r[6].isoformat() if r[6] else None,'updated_at':r[8].isoformat() if r[8] else None,'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else '')})
  # ファイル(DB)＆テーブルごとに個別管理するため、対象DB/対象テーブルが
  # 空欄のプリセット(=以前の実装が汎用として扱っていたもの)であっても、
  # 厳密に一致しない限り対象外とする。
  if db_key:items=[x for x in items if x['db']==db_key]
  if table:items=[x for x in items if x['table']==table]
  return jsonify(ok=True,items=items,table=FILTER_PRESET_TABLE,created=not before,master_path=str(path))
 except Exception as e:return jsonify(error=f'フィルタプリセット読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/filter-presets')
def filter_preset_register():
 try:
  x=request.get_json(force=True) or {};name=str(x.get('name') or '').strip();uid=request_user_id(x)
  if not name:return jsonify(error='フィルタ名を入力してください。'),400
  filters=x.get('filters') or []
  if not isinstance(filters,list) or not filters:return jsonify(error='保存する条件がありません。'),400
  db_key=str(x.get('db') or '').strip();table=str(x.get('table') or '').strip();payload=json.dumps(filters,ensure_ascii=False)
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル] FROM [フィルタプリセットマスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key and str(r[3] or '')==table),None)
   if existing:
    cur.execute('UPDATE [フィルタプリセットマスタ] SET [条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',[payload,uid,existing[0]]);registered=False;preset_id=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[条件JSON],[使用回数],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,0,?,-1,?,?,Now(),Now())',[name,db_key,table,payload,order,uid,uid]);registered=True
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
# パス設定マスタ（仕掛/品質データの読み込み先・共有パス・各種間隔設定。
# 旧config/local.json。db_access.pyのPATH_CONFIG_*を参照）
#  - sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
#    schedule_share_pathはDBS等の接続先をプロセス起動時に1回だけ決めるため、
#    保存してもこのプロセスでは反映されない(サーバー再起動が必要)。
#  - rne_extract_interval_sec/schedule_lock_ttl_sec/schedule_lock_verify_delay_ms
#    は呼び出しのたびに読み直す設計のため、再起動なしで次回から反映される。
# ========================================================================
_PATH_CONFIG_DEFAULTS={
 'sikalot_source':'network','sikalotnow_path':'','sikalotdef_path':'',
 'records_backup_export_path':'','schedule_share_path':'',
 'rne_extract_enabled':'auto',
 'rne_extract_interval_sec':str(RNE_EXTRACT_INTERVAL_SEC_DEFAULT),
 'schedule_lock_ttl_sec':str(SCHEDULE_LOCK_TTL_SEC_DEFAULT),
 'schedule_lock_verify_delay_ms':str(SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT),
}
_PATH_CONFIG_NUMERIC_FIELDS={
 'rne_extract_interval_sec':('RNE抽出間隔(秒)',60),
 'schedule_lock_ttl_sec':('スケジュールロックの有効期限(秒)',1),
 'schedule_lock_verify_delay_ms':('ロック確認までの待機時間(ミリ秒)',0),
}

@bp.get('/api/path-config-master')
def path_config_master_get():
 try:
  path=DBS['MASTER']['path']
  saved={}
  if path.exists():
   with connect(path,True) as c:saved=path_config_rows(c)
  values={k:saved.get(k,'') for k in PATH_CONFIG_KEYS}
  # active: このプロセスで実際に使われている値(保存値は次回起動から反映)。
  # 突き合わせて画面上で「保存済みだが未反映」を示せるようにする。
  active={
   'sikalot_source':SIKALOT_SOURCE,
   'sikalotnow_path':str(DBS['SIKALOTNOW']['path']),'sikalotnow_engine':DBS['SIKALOTNOW']['engine'],
   'sikalotdef_path':str(DBS['SIKALOTDEF']['path']),'sikalotdef_engine':DBS['SIKALOTDEF']['engine'],
   'records_backup_export_path':str(RECORDS_BACKUP_EXPORT_PATH) if RECORDS_BACKUP_EXPORT_PATH else '',
   'schedule_share_path':str(SCHEDULE_SHARE_PATH) if SCHEDULE_SHARE_PATH else '',
   'rne_extract_enabled':str(path_config_value('rne_extract_enabled','auto') or 'auto'),
   'rne_extract_interval_sec':str(path_config_value('rne_extract_interval_sec',RNE_EXTRACT_INTERVAL_SEC_DEFAULT)),
   'schedule_lock_ttl_sec':str(path_config_value('schedule_lock_ttl_sec',SCHEDULE_LOCK_TTL_SEC_DEFAULT)),
   'schedule_lock_verify_delay_ms':str(path_config_value('schedule_lock_verify_delay_ms',SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT)),
  }
  return jsonify(ok=True,values=values,defaults=_PATH_CONFIG_DEFAULTS,active=active,master_path=str(path))
 except Exception as e:return jsonify(error=f'パス設定読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/path-config-master')
def path_config_master_update():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  errors=[]
  sikalot_source=str(x.get('sikalot_source') or '').strip()
  if sikalot_source and sikalot_source not in ('network','local'):
   errors.append('仕掛/品質データの取得元は「network」「local」のいずれかを指定してください。')
  numeric_values={}
  for key,(label,minimum) in _PATH_CONFIG_NUMERIC_FIELDS.items():
   raw=str(x.get(key) if x.get(key) is not None else '').strip()
   if not raw:
    numeric_values[key]='';continue
   try:n=int(raw)
   except ValueError:errors.append(f'{label}は整数で入力してください。');continue
   if n<minimum:errors.append(f'{label}は{minimum}以上で入力してください。');continue
   numeric_values[key]=str(n)
  rne_enabled=str(x.get('rne_extract_enabled') or '').strip()
  if rne_enabled and rne_enabled not in ('auto','on','off'):
   errors.append('RNE抽出の定期実行は「auto」「on」「off」のいずれかを指定してください。')
  if errors:return jsonify(error=' / '.join(errors)),400
  updates={
   'sikalot_source':sikalot_source,
   'sikalotnow_path':str(x.get('sikalotnow_path') or '').strip(),
   'sikalotdef_path':str(x.get('sikalotdef_path') or '').strip(),
   'records_backup_export_path':str(x.get('records_backup_export_path') or '').strip(),
   'schedule_share_path':str(x.get('schedule_share_path') or '').strip(),
   'rne_extract_enabled':rne_enabled,
   **numeric_values,
  }
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   for key,value in updates.items():
    set_path_config(c,key,value,uid)
  return jsonify(ok=True,updated_by=uid,
                 message='パス設定を保存しました。仕掛/品質データの読み込み先・共有パスの変更はサーバー再起動後に反映されます。抽出間隔・ロック関連の設定は再起動不要で次回から反映されます。')
 except Exception as e:return jsonify(error=f'パス設定保存失敗: {e}'),500

# ========================================================================
# パス参照(§9.49): マスタ管理のパス入力欄から使うディレクトリ一覧。
#  ブラウザのファイル選択は安全上、完全なパスを返さない(名前だけ)。本アプリは
#  利用者自身の端末で動くローカルサーバーなので、**サーバー側で一覧を返して
#  辿らせる**形にすれば実際のパスが得られる。共有(UNC)も同じ経路で辿れるため、
#  \\server\share\... もマウスだけで選べる。
#  読み取り専用(一覧を返すだけ)で、ファイルの中身は一切返さない。
#  待ち受けは127.0.0.1のみ(backend/config.py)なので、この端末の外からは叩けない。
# ========================================================================
def _size_text(n):
 if n is None:return ''
 for unit in ('B','KB','MB','GB'):
  if n<1024:return f'{n:.0f}{unit}' if unit=='B' else f'{n:.1f}{unit}'
  n/=1024
 return f'{n:.1f}TB'

def _browse_places():
 """よく使う場所。1クリックで飛べるようにして手入力を減らす。"""
 places=[{'label':'アプリの場所','path':str(BASE_DIR)},{'label':'データ(db)','path':str(BASE_DIR/'db')}]
 for key in ('SIKALOTNOW','SIKALOTDEF'):
  try:
   parent=DBS[key]['path'].parent
   places.append({'label':f'{key}の場所','path':str(parent)})
  except Exception:
   pass
 if SCHEDULE_SHARE_PATH:
  places.append({'label':'共有スケジュール','path':str(Path(SCHEDULE_SHARE_PATH).parent)})
 seen=set();out=[]
 for p in places:
  if p['path'] and p['path'] not in seen:
   seen.add(p['path']);out.append(p)
 return out

@bp.get('/api/browse-path')
def browse_path():
 """指定フォルダの中身を返す。pathが空/不正なら既定(アプリの場所)を見せる。"""
 raw=str(request.args.get('path') or '').strip()
 error=''
 target=Path(raw) if raw else BASE_DIR
 try:
  if target.exists() and target.is_file():target=target.parent
  if not target.exists():
   error=f'見つかりません: {target}';target=BASE_DIR
 except OSError as e:
  error=f'開けません: {e}';target=BASE_DIR
 entries=[]
 try:
  for child in sorted(target.iterdir(),key=lambda p:(not p.is_dir(),p.name.lower())):
   try:is_dir=child.is_dir();size=None if is_dir else child.stat().st_size
   except OSError:is_dir=False;size=None
   entries.append({'name':child.name,'path':str(child),'isDir':is_dir,'sizeText':_size_text(size)})
   if len(entries)>=2000:break   # 巨大フォルダで画面を固めない
 except OSError as e:
  error=error or f'一覧を取得できません: {e}'
 parent=str(target.parent) if target.parent!=target else ''
 return jsonify(ok=True,path=str(target),parent=parent,entries=entries,
                places=_browse_places(),error=error)

# ========================================================================
# RNE抽出(仕掛/品質データのローカル運用)の状態表示と手動実行(§9.50)
#  従来は「起動時に1回＋rne_extract_interval_secごと」の背景実行だけで、
#  動いているのかを画面から確かめる手段も、その場で取り直す手段も無かった。
#  (「実際に起動させる方法が分からない」という指摘。抽出の成否はアプリログに
#   しか出ていなかった。)
# ========================================================================
@bp.get('/api/rne-extract/status')
def rne_extract_status():
 from .. import rne_scheduler
 return jsonify(ok=True,**rne_scheduler.last_status())

@bp.post('/api/rne-extract/run')
def rne_extract_run():
 """画面の「今すぐ抽出」。抽出は数十秒かかり得るので背景スレッドで走らせ、
 画面は /status をポーリングして結果を見る(要求は即座に返す)。"""
 from .. import rne_scheduler
 import threading as _th
 # 手動実行は取得元(sikalot_source)に関わらず行える。共有から読む運用でも、
 # ローカルの複製を用意する・配置と接続を試す目的で実行できてよいため。
 missing=[j['rne'] for j in rne_scheduler.JOBS
          if not (rne_scheduler.RNE_ASSETS_DIR/'rne'/j['rne']).exists()]
 if missing:
  return jsonify(error=f'抽出定義(RNE)が配置されていません: {", ".join(missing)}。'
                       f'{rne_scheduler.RNE_ASSETS_DIR/"rne"} へ配置してください。'),400
 if not (rne_scheduler.RNE_ASSETS_DIR/'symnavim.conf').exists():
  return jsonify(error=f'接続情報 symnavim.conf が配置されていません'
                       f'({rne_scheduler.RNE_ASSETS_DIR})。'),400
 status=rne_scheduler.last_status()
 if status.get('running'):
  return jsonify(error='抽出が既に実行中です。完了までお待ちください。'),409
 def _go():
  try:rne_scheduler.run_batch('manual')
  except Exception:pass   # 失敗は last_status()のjobs[].errorに出る
 _th.Thread(target=_go,daemon=True,name='rne-manual').start()
 return jsonify(ok=True,started=True,message='抽出を開始しました。完了すると状態表示が更新されます。')
