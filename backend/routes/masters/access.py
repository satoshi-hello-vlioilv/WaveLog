"""masters/access.py: アクセス権限マスタ。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from flask import jsonify
from ..common import api_guard
from ...db_access import DBS, connect, tables
from ...access_mode import request_user_id
from ..body import body, any_
from ._base import bp
from ...repositories.master_repo import (
 ACCESS_PERMISSION_TABLE,
 ensure_access_permission_table,
 normalize_identity_part,
 access_permission_master_rows,
 ROLES as PERMISSION_ROLES,
 ROLE_DEFAULT as PERMISSION_ROLE_DEFAULT,
 normalize_role,
 MASTER_EDIT_LEVELS,
 normalize_master_edit,
 master_edit_effective,
 master_edit_options,
 master_edit_check,
 role_change_check,
 has_admin_role_row,
)


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

def _row_role(c,aid):
 """その行の**いまの**権限区分。行が無ければ既定（＝未登録の端末と同じ）。"""
 if aid is None:return PERMISSION_ROLE_DEFAULT
 cur=c.cursor();cur.execute('SELECT [権限区分] FROM [アクセス権限マスタ] WHERE [権限ID]=?',[aid])
 r=cur.fetchone()
 return normalize_role(r[0] if r else '')

def _permission_grant_error(c,x,existing_role,role,master_edit,row_id=None,row_login='',row_pc=''):
 """区分・マスタ編集を書き換えてよいか。断るなら理由の文、通るなら''（§9.322）。

 **判定そのものは`master_repo`が持つ**（§9.163）。ここがするのは「誰が
 頼んでいるか」を`access_mode`から取ってくることだけ——ルートごとに
 判定を書き写すと、登録では通るのに更新では断られる、が作れる。

 誰が頼んでいるかは**中継（§9.192）でも依頼元**になる（`current_login_id()`が
 `_relayed_identity()`を見る）ので、持ち主PC経由の書き込みでも区分の門は
 依頼元の区分で効く。"""
 from ...access_mode import current_login_id,current_pc_name
 actor_login=current_login_id();actor_pc=current_pc_name()
 ok,reason=role_change_check(c,actor_login,actor_pc,existing_role,role,
                             row_id=row_id,row_login=row_login,row_pc=row_pc)
 if not ok:return reason
 if master_edit is not None:
  ok,reason=master_edit_check(role,master_edit)
  if not ok:return reason
 return ''

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
   items=[{'id':r[0],'loginId':str(r[1] or '').strip(),'pcName':str(r[2] or '').strip(),'canEdit':'編集可' if bool(r[3]) else '閲覧のみ','order':r[4] or 0,'active':True,'updated_at':r[6].isoformat() if r[6] else None,'updated_by':(str(r[7]).strip() if len(r)>7 and r[7] else ''),'canSchedule':'可' if (len(r)>8 and bool(r[8])) else '不可','canFieldReorder':'可' if (len(r)>9 and bool(r[9])) else '不可','fieldReorderEquipment':(str(r[10]).strip() if len(r)>10 and r[10] else ''),
            # 権限区分（§9.272）。**知らない綴りは既定へ寄せて返す**——選択欄の
            # 候補と一致しないと、編集を開いたときに選択が復元されない。
            'role':normalize_role(r[11] if len(r)>11 else ''),
            # マスタ編集（§9.322）。**保存値と効いている段の両方を返す**——
            # 区分の上限で頭打ちになっている行は、画面が理由を書けるようにする。
            'masterEdit':normalize_master_edit(r[12] if len(r)>12 else ''),
            'masterEditEffective':master_edit_effective(normalize_role(r[11] if len(r)>11 else ''),
                                                        r[12] if len(r)>12 else '')} for r in rows]
   # **区分ごとに選べる段はサーバーが答える**（§9.163）——画面へ上限の表を
   # 写すと、上限を1つ直したときに片方だけ古い約束のまま残る。
   caps={role:master_edit_options(role) for role in PERMISSION_ROLES}
   bootstrap=not has_admin_role_row(c)
  return jsonify(ok=True,items=items,table=ACCESS_PERMISSION_TABLE,created=not before,empty=len(items)==0,master_path=str(path),
                 roles=list(PERMISSION_ROLES),masterEditLevels=list(MASTER_EDIT_LEVELS),
                 masterEditByRole=caps,
                 # まだ管理者（一般ユーザーより上位）が1人も居ない状態か。
                 # 画面は「最初の1人はいま作れます」と書ける（§4）。
                 roleBootstrap=bootstrap)
 except Exception as e:return jsonify(error=f'アクセス権限マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master')
def access_permission_master_register():
 try:
  x=body({'canEdit': any_, 'canFieldReorder': any_, 'canSchedule': any_, 
          'fieldReorderEquipment': any_, 'loginId': any_, 'masterEdit': any_, 
          'pcName': any_, 'role': any_});login_id=x.text('loginId');pc_name=x.text('pcName');can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  can_schedule=_bool_from_yes_no(x.get('canSchedule'));can_field_reorder=_bool_from_yes_no(x.get('canFieldReorder'));field_reorder_equipment=x.text('fieldReorderEquipment')
  role=normalize_role(x.get('role'));master_edit=normalize_master_edit(x.get('masterEdit'))
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
   # ---- 区分とマスタ編集の門（§9.322）。**3つのルートとも同じ1箇所を通す** ----
   err=_permission_grant_error(c,x,existing_role=(_row_role(c,existing[0]) if existing else PERMISSION_ROLE_DEFAULT),
                               role=role,master_edit=master_edit,
                               row_id=(existing[0] if existing else None),
                               row_login=login_id,row_pc=pc_name)
   if err:return jsonify(error=err),403
   if existing:
    cur.execute('UPDATE [アクセス権限マスタ] SET [編集可否]=?,[スケジュール可否]=?,[現場段取り可否]=?,[現場段取り対象設備]=?,[権限区分]=?,[マスタ編集]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,role,master_edit,uid,existing[0]]);registered=False
   else:
    cur.execute('SELECT Max([表示順]) FROM [アクセス権限マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [アクセス権限マスタ] ([ログインID],[PC名],[編集可否],[スケジュール可否],[現場段取り可否],[現場段取り対象設備],[権限区分],[マスタ編集],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',[login_id,pc_name,1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,role,master_edit,order,uid,uid]);registered=True
   c.commit()
  return jsonify(ok=True,loginId=login_id,pcName=pc_name,registered=registered,updated_by=uid,message=('アクセス権限マスタへ新規登録しました。' if registered else '登録済みの組み合わせを更新しました。'))
 except Exception as e:return jsonify(error=f'アクセス権限マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master/update')
def access_permission_master_update():
 try:
  x=body({'canEdit': any_, 'canFieldReorder': any_, 'canSchedule': any_, 
          'fieldReorderEquipment': any_, 'id': any_, 'loginId': any_, 
          'masterEdit': any_, 'pcName': any_, 'role': any_});aid=x.get('id');login_id=x.text('loginId');pc_name=x.text('pcName');can_edit=_bool_from_can_edit(x.get('canEdit'));uid=request_user_id(x)
  can_schedule=_bool_from_yes_no(x.get('canSchedule'));can_field_reorder=_bool_from_yes_no(x.get('canFieldReorder'));field_reorder_equipment=x.text('fieldReorderEquipment')
  role=normalize_role(x.get('role'));master_edit=normalize_master_edit(x.get('masterEdit'))
  if aid is None:return jsonify(error='更新対象IDがありません。'),400
  if not login_id and not pc_name:return jsonify(error='ログインIDまたはPC名の少なくとも一方を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_access_permission_table(c);cur=c.cursor();cur.execute('SELECT [権限ID],[ログインID],[PC名] FROM [アクセス権限マスタ]');rows=cur.fetchall()
   tl=normalize_identity_part(login_id);tp=normalize_identity_part(pc_name)
   dup=next((r for r in rows if normalize_identity_part(r[1])==tl and normalize_identity_part(r[2])==tp and str(r[0])!=str(aid)),None)
   if dup:return jsonify(error='同じログインID・PC名の組み合わせが既に存在するため変更できません。'),409
   err=_permission_grant_error(c,x,existing_role=_row_role(c,aid),role=role,master_edit=master_edit,
                               row_id=aid,row_login=login_id,row_pc=pc_name)
   if err:return jsonify(error=err),403
   cur.execute('UPDATE [アクセス権限マスタ] SET [ログインID]=?,[PC名]=?,[編集可否]=?,[スケジュール可否]=?,[現場段取り可否]=?,[現場段取り対象設備]=?,[権限区分]=?,[マスタ編集]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[login_id,pc_name,1 if can_edit else 0,1 if can_schedule else 0,1 if can_field_reorder else 0,field_reorder_equipment,role,master_edit,uid,aid]);c.commit()
  return jsonify(ok=True,id=aid,loginId=login_id,pcName=pc_name,updated_by=uid,message='アクセス権限を更新しました。')
 except Exception as e:return jsonify(error=f'アクセス権限マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/access-permission-master/delete')
@api_guard('アクセス権限マスタ削除失敗')
def access_permission_master_delete():
 x=body({'id': any_});aid=x.get('id');uid=request_user_id(x)
 if aid is None:return jsonify(error='削除対象IDがありません。'),400
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  ensure_access_permission_table(c);cur=c.cursor()
  # **消すことも区分の変更**（§9.322）——行が消えれば、その端末は既定
  # （一般ユーザー）へ戻る。自分の行を消して制限を外す、という抜け道を
  # 塞ぐため、登録・更新とまったく同じ門を通す。
  err=_permission_grant_error(c,x,existing_role=_row_role(c,aid),role=PERMISSION_ROLE_DEFAULT,
                              master_edit=None,row_id=aid)
  if err:return jsonify(error=err),403
  # 物理削除ではなく無効化し、履歴を残す。無効化した更新者も記録する。
  cur.execute('UPDATE [アクセス権限マスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [権限ID]=?',[uid,aid]);c.commit()
 return jsonify(ok=True,id=aid,updated_by=uid)
