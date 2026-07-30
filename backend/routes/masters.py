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
from flask import Blueprint, request, jsonify

from ..db_access import DBS, connect, request_user_id
from ..repositories.master_repo import (
 EQUIPMENT_MASTER_TABLE, ensure_equipment_master_table, normalize_equipment_name, equipment_master_rows,
 OPERATOR_MASTER_TABLE, ensure_operator_master_table, normalize_operator_name, operator_master_rows,
 OPERATOR_EQUIPMENT_TABLE, ensure_operator_equipment_table, operator_equipment_map, set_operator_equipment,
 SPOOL_MASTER_TABLE, ensure_spool_master_table, normalize_spool_name, spool_master_rows,
 INNER_MASTER_TABLE, ensure_inner_master_table, normalize_inner_name, inner_master_rows,
 DEVICE_MASTER_TABLE, ensure_device_master_table, normalize_device_name, device_master_rows,
 FILTER_PRESET_TABLE, ensure_filter_preset_table, filter_preset_rows,
 COLUMN_DISPLAY_TABLE, ensure_column_display_table, hidden_columns_for, set_hidden_columns,
 ACCESS_PERMISSION_TABLE, ensure_access_permission_table, normalize_identity_part, access_permission_master_rows,
)
from ..db_access import cols, tables, cfg

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
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor();cur.execute('SELECT [設備ID],[設備名] FROM [設備マスタ]');rows=cur.fetchall();target=normalize_equipment_name(name);existing=next((r for r in rows if normalize_equipment_name(r[1])==target),None)
   if existing:
    cur.execute('UPDATE [設備マスタ] SET [有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[uid,existing[0]]);registered=False;stored_name=str(existing[1]).strip()
   else:
    cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,-1,?,?,Now(),Now())',[name,order,uid,uid]);registered=True;stored_name=name
   c.commit()
  return jsonify(ok=True,name=stored_name,registered=registered,updated_by=uid,message=('設備マスタへ新規登録しました。次回から設備リストに表示されます。' if registered else '設備マスタの登録済み設備を使用します。'))
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
   cur.execute('UPDATE [設備マスタ] SET [設備名]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[name,uid,eid]);c.commit()
  return jsonify(ok=True,id=eid,name=name,updated_by=uid,message='設備名を更新しました。')
 except Exception as e:return jsonify(error=f'設備マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master/delete')
def equipment_master_delete():
 try:
  x=request.get_json(force=True) or {};eid=x.get('id');uid=request_user_id(x)
  if eid is None:return jsonify(error='削除対象IDがありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor()
   cur.execute('SELECT [設備名] FROM [設備マスタ] WHERE [設備ID]=?',[eid]);row=cur.fetchone();name=str(row[0]).strip() if row and row[0] else ''
   # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
   cur.execute('UPDATE [設備マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [設備ID]=?',[uid,eid])
   # オペレータ設備マスタは設備名で紐づいているため、削除した設備を作業可能
   # 設備として持つオペレータの割当からも取り除き、削除済みの設備名が
   # 選択肢から消えた後も表示上だけ残り続ける(ゴースト参照)のを防ぐ。
   if name:
    ensure_operator_equipment_table(c)
    cur.execute('DELETE FROM [オペレータ設備マスタ] WHERE [設備名]=?',[name])
   c.commit()
  return jsonify(ok=True,id=eid,updated_by=uid)
 except Exception as e:return jsonify(error=f'設備マスタ削除失敗: {e}'),500

@bp.get('/api/operator-master')
def operator_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=OPERATOR_MASTER_TABLE in tables(c);ensure_operator_master_table(c);rows=operator_master_rows(c);eqmap=operator_equipment_map(c)
   items=[{'id':r[0],'name':str(r[1] or '').strip(),'order':r[2] or 0,'active':True,'updated_at':r[4].isoformat() if r[4] else None,'updated_by':(str(r[5]).strip() if len(r)>5 and r[5] else ''),'equipment':eqmap.get(r[0],[])} for r in rows]
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
# アクセス権限マスタ（ログインID×PC名で編集可否を管理。閲覧モードの判定は
# backend/access_mode.pyが使う。ここではCRUD APIのみを提供する）
# ========================================================================
def _bool_from_can_edit(value):
 # フロントは'編集可'/'閲覧のみ'という表記の select を送ってくる。
 return str(value or '').strip()=='編集可'

@bp.get('/api/access-permission-master')
def access_permission_master_list():
 try:
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   before=ACCESS_PERMISSION_TABLE in tables(c);rows=access_permission_master_rows(c)
   items=[{'id':r[0],'loginId':str(r[1] or '').strip(),'pcName':str(r[2] or '').strip(),'canEdit':'編集可' if bool(r[3]) else '閲覧のみ','order':r[4] or 0,'active':True,'updated_at':r[6].isoformat() if r[6] else None,'updated_by':(str(r[7]).strip() if len(r)>7 and r[7] else '')} for r in rows]
  return jsonify(ok=True,items=items,table=ACCESS_PERMISSION_TABLE,created=not before,empty=len(items)==0,master_path=str(path))
 except Exception as e:return jsonify(error=f'アクセス権限マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master')
def access_permission_master_register():
 try:
  x=request.get_json(force=True) or {};login_id=str(x.get('loginId') or '').strip();pc_name=str(x.get('pcName') or '').strip();can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  if not login_id:return jsonify(error='ログインIDを入力してください。'),400
  if not pc_name:return jsonify(error='PC名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor();cur.execute('SELECT [権限ID],[ログインID],[PC名] FROM [アクセス権限マスタ]');rows=cur.fetchall()
   tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
   existing=next((r for r in rows if normalize_identity_part(r[1])==tl and normalize_identity_part(r[2])==tp),None)
   if existing:
    cur.execute('UPDATE [アクセス権限マスタ] SET [編集可否]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[1 if can_edit else 0,uid,existing[0]]);registered=False
   else:
    cur.execute('SELECT Max([表示順]) FROM [アクセス権限マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,-1,?,?,Now(),Now())',[login_id,pc_name,1 if can_edit else 0,order,uid,uid]);registered=True
   c.commit()
  return jsonify(ok=True,loginId=login_id,pcName=pc_name,registered=registered,updated_by=uid,message=('アクセス権限マスタへ新規登録しました。' if registered else '登録済みの組み合わせを更新しました。'))
 except Exception as e:return jsonify(error=f'アクセス権限マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master/update')
def access_permission_master_update():
 try:
  x=request.get_json(force=True) or {};aid=x.get('id');login_id=str(x.get('loginId') or '').strip();pc_name=str(x.get('pcName') or '').strip();can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  if aid is None:return jsonify(error='更新対象IDがありません。'),400
  if not login_id:return jsonify(error='ログインIDを入力してください。'),400
  if not pc_name:return jsonify(error='PC名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor();cur.execute('SELECT [権限ID],[ログインID],[PC名] FROM [アクセス権限マスタ]');rows=cur.fetchall()
   tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
   dup=next((r for r in rows if normalize_identity_part(r[1])==tl and normalize_identity_part(r[2])==tp and str(r[0])!=str(aid)),None)
   if dup:return jsonify(error='同じログインID・PC名の組み合わせが既に存在するため変更できません。'),409
   cur.execute('UPDATE [アクセス権限マスタ] SET [ログインID]=?,[PC名]=?,[編集可否]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[login_id,pc_name,1 if can_edit else 0,uid,aid]);c.commit()
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
