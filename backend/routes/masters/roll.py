"""masters/roll.py: ロールマスタ。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from flask import request, jsonify
from ..common import api_guard
from ...flags import flag_of, text_or
from ...access_mode import request_user_id
from ..body import body, any_
from ._base import bp, _op_read


# ========================================================================
# ロールマスタ(§9.239 ⑥、利用者の指示)
#  - 「欠陥のピッチから当設備のロールを判定する」ための諸元。
#  - 設備は**設備停止マスタと同じ書式**('A' / 'A,B,C' / '*')で、判定は
#    schedule_repo.stop_equipment_* の1箇所を借りる（新しい照合を書かない）。
#  - 語彙（入出位置・接触面・駆動方式）は**サーバーだけが持つ**（§9.163）。
#    画面へ写すと、増やしたときに2箇所直すことになる。
# ========================================================================
@bp.get('/api/roll-master')
@api_guard('ロールマスタの読込に失敗しました')
def roll_master_list():
 from ...repositories import roll_repo as rr
 eq=str(request.args.get('equipment') or '').strip()
 def fn(c):
  items=rr.rolls_for_equipment(c,eq) if eq else rr.roll_rows(c,True)
  return {'items':items,
          'entryPositions':list(rr.ENTRY_POSITIONS),
          'contactFaces':list(rr.CONTACT_FACES),
          'driveKinds':list(rr.DRIVE_KINDS),
          # **1本を見分ける列はサーバーが答える**（§9.163／§9.257 ③）。
          # 画面へ書き写すと、鍵を1つ足したときに2箇所直すことになる
          # ——実際にこの一覧は (設備,名前) → +接触面 → +径・備考 と
          # 2度広がっている。
          'keyLabels':list(rr.KEY_LABELS),
          'equipments':rr.equipments(c)}
 return jsonify(ok=True,equipment=eq,**_op_read(fn))

@api_guard('ロールマスタの保存に失敗しました',bad=ValueError)
def _roll_save(x):
 from ...repositories import roll_repo as rr
 uid=request_user_id(x)
 # 「有効」は呼び名で来る。読み方は`flags.flag_of`の1箇所（§9.324 R4）。
 alive=flag_of(text_or(x,'enabled'))
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

@bp.post('/api/roll-master')
def roll_master_register():
 return _roll_save(body({'contactFace': any_, 'count': any_, 'diaMax': any_, 'diaMin': any_, 
          'driveKind': any_, 'enabled': any_, 'enabledText': any_, 'entryPos': any_, 'equipment': any_, 
          'faceLen': any_, 
          'hardness': any_, 'id': any_, 'material': any_, 'name': any_, 'note': any_, 
          'order': any_, 'refNo': any_, 'useCond': any_}))

@bp.post('/api/roll-master/update')
def roll_master_update():
 x=body({'contactFace': any_, 'count': any_, 'diaMax': any_, 'diaMin': any_, 
          'driveKind': any_, 'enabled': any_, 'enabledText': any_, 'entryPos': any_, 'equipment': any_, 
          'faceLen': any_, 
          'hardness': any_, 'id': any_, 'material': any_, 'name': any_, 'note': any_, 
          'order': any_, 'refNo': any_, 'useCond': any_})
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _roll_save(x)

# ---- Excel の持ち出し・取り込み（§9.240、利用者の指示） ----
# **書き出しはGET（バイナリ）**。既存の唯一の前例（`logs.py`の
# `download_log`）と同じ`send_file`の作法に合わせる。
# **取り込みはJSON+base64**——この repo は multipart を1つも受けておらず、
# ここだけ別の受け口を作ると、後から触る人が2通りを覚えることになる。
@bp.get('/api/roll-master/export')
@api_guard('ロールマスタの書き出しに失敗しました')
def roll_master_export():
 from ...repositories import roll_repo as rr
 eq=str(request.args.get('equipment') or '').strip()
 data=_op_read(lambda c:rr.export_bytes(c,eq))
 import time
 stamp=time.strftime('%Y%m%d-%H%M%S')
 name=('ロールマスタ_%s_%s.xlsx'%(eq,stamp)) if eq else ('ロールマスタ_%s.xlsx'%stamp)
 from flask import send_file
 import io
 return send_file(io.BytesIO(data),as_attachment=True,download_name=name,
                  mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@bp.post('/api/roll-master/import')
def roll_master_import():
 """Excelから取り込む。**既定は下見**（`apply`を付けたときだけ書く）。

 §9.193 のクエリ結合と同じで、**保存する前に何が起きるかを見せる**
 ——何件が追加で何件が上書きか、どの行がなぜ飛ばされるか。"""
 from ...repositories import roll_repo as rr
 from ...xlsx_io import XlsxError
 x=body({'apply': any_, 'fileBase64': any_, 'replace': any_})
 b64=str(x.get('fileBase64') or '')
 if not b64:return jsonify(error='ファイルがありません。'),400
 try:
  import base64
  if ',' in b64[:200] and b64.strip().startswith('data:'):
   b64=b64.split(',',1)[1]          # data: URL のまま来ても受ける
  data=base64.b64decode(b64)
 except Exception:
  return jsonify(error='ファイルを読み取れませんでした（送信の途中で壊れた可能性があります）。'),400
 apply=x.flag('apply')
 # **取り込み方は口が受けるだけ**（§9.251）。何が消えるかを決めるのは
 # `roll_repo.import_rows()`の1箇所で、ここは綴りを運ぶだけにする。
 replace=x.text('replace')
 try:
  uid=request_user_id(x)
  r=_op_read(lambda c:rr.import_rows(c,uid,data,dry_run=not apply,replace=replace))
  n_rm=int(r.get('removeCount') or 0)
  if apply:
   msg=f"{r.get('saved',0)}件を取り込みました（追加{r['add']}・上書き{r['update']}"
   msg+=(f"・削除{r.get('removed',0)}）。" if replace else '）。')
  else:
   msg=f"取り込むと 追加{r['add']}件・上書き{r['update']}件"
   msg+=(f"・削除{n_rm}件 になります。" if replace else ' になります。')
  if r['skipped']:msg+=f" 取り込めない行が{len(r['skipped'])}件あります。"
  return jsonify(ok=True,message=msg,**r)
 except XlsxError as e:return jsonify(error=str(e)),400
 except Exception as e:return jsonify(error=f'ロールマスタの取り込みに失敗しました: {e}'),500

@bp.post('/api/roll-master/delete-all')
@api_guard('ロールマスタの一括削除に失敗しました',bad=ValueError)
def roll_master_delete_all():
 """まとめて消す（§9.251、利用者の指示「ロールマスタの全削除機能
    （ロールマスタの完全入替機能）」）。**既定は下見**——`apply`を付けた
    ときだけ消す。取り消せない操作なので、何件・どの設備が消えるかを
    書き込む前に返す（§9.193／§9.240と同じ作法）。

    **範囲の`equipment`は「送ってきたかどうか」で見る**——空文字は
    「設備の入っていない行」という意味を持つので、`or ''`で潰すと
    その行を名指しで消せなくなる。"""
 from ...repositories import roll_repo as rr
 x=body({'apply': any_, 'equipment': any_, 'scope': any_})
 scope=x.text('scope')
 eq=x.get('equipment') if 'equipment' in x else None
 if eq is not None:eq=str(eq)
 apply=x.flag('apply')
 uid=request_user_id(x)
 r=_op_read(lambda c:rr.delete_all(c,uid,scope=scope,equipment=eq,dry_run=not apply))
 msg=(f"{r.get('deleted',0)}件を削除しました（{r['label']}）。" if apply
      else f"{r['label']}のロール {r['count']}件を削除します（全{r['total']}件）。")
 return jsonify(ok=True,message=msg,**r)

@bp.post('/api/roll-master/delete')
@api_guard('ロールマスタの削除に失敗しました',bad=ValueError)
def roll_master_delete():
 from ...repositories import roll_repo as rr
 x=body({'id': any_})
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 n=_op_read(lambda c:rr.roll_delete(c,x['id'],request_user_id(x)))
 return jsonify(ok=True,deleted=n,message='ロールを削除しました。')
