"""masters/filters.py: フィルタ／ソートのプリセットと一覧表示設定。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
import json
from flask import request, jsonify
from ..common import api_guard
from ...db_access import DBS, connect, tables
from ...access_mode import request_user_id
from ..body import body, any_
from ...quiet import quiet
from ._base import bp
from ...repositories.master_repo import (
 normalize_equipment_name,
 FILTER_PRESET_TABLE,
 ensure_filter_preset_table,
 filter_preset_rows,
 filter_preset_members,
 ensure_filter_personal_table,
 filter_personal_marks,
 filter_personal_set,
 filter_personal_has_any,
 SORT_PRESET_TABLE,
 ensure_sort_preset_table,
 sort_preset_rows,
 normalize_sort_keys,
 list_view_settings_for,
 set_list_view_settings,
 ROW_GAP_DEFAULT,
)


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
    except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);filters=[]
    if not isinstance(filters,list):filters=[]
    owner=(str(r[11]).strip() if len(r)>11 and r[11] else '')
    if not _preset_visible_to(owner,uid):continue
    mk=marks.get(int(r[0]),{})
    items.append({'id':r[0],'name':str(r[1] or '').strip(),'db':str(r[2] or '').strip(),'table':str(r[3] or '').strip(),'filters':filters,'uses':int(r[5] or 0),'last_used':r[6].isoformat() if r[6] else None,'updated_at':r[8].isoformat() if r[8] else None,'updated_by':(str(r[9]).strip() if len(r)>9 and r[9] else ''),'mode':(str(r[10]).strip() if len(r)>10 and r[10] else ''),
                  'owner':owner,'mine':bool(owner) and owner==uid,'shared':not owner,
                  # グループ(§9.286 ①)。**空欄＝未分類**をそのまま返す
                  # ——「未分類」という名前をサーバーが作らないこと（画面の
                  # 呼び名であって、保存値ではない）。
                  'group':(str(r[12]).strip() if len(r)>12 and r[12] else ''),
                  # メンバー(§9.288 ②)。**空＝ふつうの「登録した条件」**、
                  # 1件以上＝「組み合わせ（プリセット）」。同じ条件のIDは
                  # 何本の組み合わせにも現れてよい＝使い回せる。
                  'members':filter_preset_members(r[13] if len(r)>13 else None),
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
  x=body({'db': any_, 'filters': any_, 'group': any_, 'members': any_, 'mode': any_, 
          'name': any_, 'owner': any_, 'shared': any_, 'table': any_});name=x.text('name');uid=request_user_id(x)
  if not name:return jsonify(error='フィルタ名を入力してください。'),400
  filters=x.get('filters') or []
  # 組み合わせ(§9.288 ②)は条件を持たない行なので、**メンバーがあれば
  # 条件が空でも通す**。どちらも空のときだけ断る(中身の無い登録は作れない)。
  members=x.get('members')
  members=[int(v) for v in members if str(v).lstrip('-').isdigit()] if isinstance(members,list) else None
  if not isinstance(filters,list) or (not filters and not members):
   return jsonify(error='保存する条件がありません。'),400
  db_key=x.text('db');table=x.text('table');payload=json.dumps(filters,ensure_ascii=False)
  mode=_filter_preset_mode(x.get('mode'))
  # 所有者(§9.172)。指定が無ければ**その人のもの**として登録する。共有したい
  # ときだけ owner='' を明示する(shared=trueでも同じ)。**同名の照合にも
  # 所有者を含める**——含めないと、同じ名前を付けた他人の登録を黙って
  # 書き換えてしまう(個人単位にした意味が無くなるどころか、実害が出る)。
  requester=_filter_preset_user(x) or uid
  owner=('' if x.get('shared') else str(x.get('owner') if x.get('owner') is not None else requester or '').strip()[:50])
  # グループ(§9.286 ①)。**渡していなければ今の値を残す**(§9.212 ②)——
  # 条件だけを送り直す経路（登録済みの上書き）で群が消えないように。
  has_group='group' in x
  group=x.text('group')[:50]
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[対象モード],[所有者ID] FROM [フィルタプリセットマスタ]');rows=cur.fetchall()
   target=normalize_equipment_name(name)
   existing=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key and str(r[3] or '')==table and str(r[4] or '')==mode and str(r[5] or '')==owner),None)
   mem_json=json.dumps(members) if members is not None else None
   if existing:
    sets='[条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now()';args=[payload,uid]
    if has_group:sets='[条件JSON]=?,[グループ]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now()';args=[payload,group,uid]
    if mem_json is not None:sets+=',[メンバーJSON]=?';args.append(mem_json)
    cur.execute(f'UPDATE [フィルタプリセットマスタ] SET {sets} WHERE [プリセットID]=?',args+[existing[0]])
    registered=False;preset_id=existing[0]
   else:
    cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
    cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[メンバーJSON],[使用回数],[表示順],[有効],[所有者ID],[グループ],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,0,?,-1,?,?,?,?,Now(),Now())',[name,db_key,table,mode,payload,mem_json or '[]',order,owner,group,uid,uid]);registered=True
    preset_id=cur.lastrowid
   c.commit()
  return jsonify(ok=True,name=name,id=preset_id,registered=registered,owner=owner,mine=bool(owner),group=group,members=members or [],updated_by=uid,message=('フィルタマスタへ新規登録しました。' if registered else '登録済みフィルタを更新しました。'))
 except Exception as e:return jsonify(error=f'フィルタプリセット登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/filter-presets/use')
@api_guard('使用回数更新失敗')
def filter_preset_use():
 # サジェスト順位（よく使う順）を精緻化するため、適用時に使用回数を加算する。
 x=body({'id': any_});pid=x.get('id');uid=request_user_id(x)
 if pid is None:return jsonify(ok=True,skipped=True)
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,skipped=True)
 with connect(path,False) as c:
  ensure_filter_preset_table(c);cur=c.cursor()
  cur.execute('UPDATE [フィルタプリセットマスタ] SET [使用回数]=Nz([使用回数],0)+1,[最終使用日時]=Now(),[更新者ID]=? WHERE [プリセットID]=?',[uid,pid]);c.commit()
 return jsonify(ok=True,id=pid,updated_by=uid)

@bp.post('/api/filter-presets/delete')
@api_guard('フィルタプリセット削除失敗')
def filter_preset_delete():
 x=body({'id': any_});pid=x.get('id');uid=request_user_id(x)
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

@bp.post('/api/filter-presets/marks')
def filter_preset_marks():
 """「デフォルト」「鍵」の印を、**その人のもの**として残す(§9.172)。
 以前は端末のlocalStorageだったため、同じPCを別の人が使うと相手の既定が
 当たり、別のPCへ移ると付けた覚えの印が消えていた。"""
 try:
  x=body({'id': any_, 'isDefault': any_, 'isLocked': any_, 'items': any_});uid=request_user_id(x)
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
    except Exception as _e:quiet('数として読めない（既定で続ける）',_e);continue
    filter_personal_set(c,requester,pid,bool(it.get('isDefault')),bool(it.get('isLocked')),uid)
    saved+=1
  return jsonify(ok=True,user=requester,saved=saved)
 except Exception as e:return jsonify(error=f'フィルタ個人設定の保存に失敗: {e}'),500

@bp.post('/api/filter-presets/owner')
@api_guard('フィルタの持ち主変更に失敗')
def filter_preset_owner():
 """「自分だけ」と「みんな」を行き来する(§9.172)。**持ち主だけが変えられる**。
 みんなのものを自分のものにするのは、他の人から見えなくなるので**取り上げ**に
 なる——できるのは、まだ誰の物でもない(＝共有)ものを自分の物にする場合だけに
 限らず、画面側が確認を出す。"""
 x=body({'id': any_, 'shared': any_});pid=x.get('id');uid=request_user_id(x)
 if pid is None:return jsonify(error='対象のプリセットIDがありません。'),400
 requester=_filter_preset_user(x) or uid
 to_shared=x.flag('shared')
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

@bp.post('/api/filter-presets/combo')
def filter_preset_combo():
 """組み合わせ（プリセット）を作る・直す（§9.288 ②、利用者の指示「登録した
 データを使いまわせるような形が良い…フィルタ登録したデータを何回でも使える
 という組み合わせのプリセット登録」）。

 §9.286 ①／§9.287 の`[グループ]`は**名札**なので、1つの条件は1つの群にしか
 属せなかった。ここは**組み合わせのほうを1行**にする——`[メンバーJSON]`に
 条件のIDを並べるので、**同じ条件を何本の組み合わせにも入れられる**。

 受ける形は2つ:
   新規 … {name, members:[id...], db, table, mode}
   変更 … {id, name?, members?}   （送った項目だけ書く・§9.212 ②）

 **組み合わせの中に組み合わせを入れない**——入れ子にすると「いま効いて
 いる条件」を辿らないと読めなくなる。落としたものは件数と理由を返す（§4）。
 **持ち主の判定は`/owner`と同じ**（他人の個人フィルタは動かせない）。"""
 try:
  x=body({'db': any_, 'id': any_, 'members': any_, 'mode': any_, 'name': any_, 'shared': any_, 
          'table': any_});uid=request_user_id(x)
  requester=_filter_preset_user(x) or uid
  pid=x.get('id')
  name=x.text('name')
  raw=x.get('members')
  members=None
  if isinstance(raw,list):
   members=[]
   for v in raw:
    try:n=int(v)
    except (TypeError,ValueError):continue
    if n not in members:members.append(n)
  db_key=x.text('db');table=x.text('table')
  mode=_filter_preset_mode(x.get('mode'))
  path=DBS['MASTER']['path']
  dropped={'missing':0,'other':0,'combo':0}
  with connect(path,False) as c:
   ensure_filter_preset_table(c);cur=c.cursor()
   if members is not None:
    keep=[]
    for n in members:
     cur.execute('SELECT [所有者ID],[メンバーJSON],[有効],[名称] FROM [フィルタプリセットマスタ] WHERE [プリセットID]=?',[n])
     row=cur.fetchone()
     if row is None or (row[2] is not None and not bool(row[2])) or not str(row[3] or '').strip():
      dropped['missing']+=1;continue
     if not _preset_visible_to(row[0],requester):dropped['other']+=1;continue
     if filter_preset_members(row[1]):dropped['combo']+=1;continue
     keep.append(n)
    members=keep
   if pid is None:
    if not name:return jsonify(error='組み合わせの名前を入力してください。'),400
    if not members:return jsonify(error='組み合わせに入れる条件を選んでください。'),400
    owner=('' if x.get('shared') else str(requester or '')[:50])
    # **同じ場面・同じ持ち主で同じ名前は1つ**（登録の口と同じ約束）。
    cur.execute('SELECT [プリセットID],[名称],[対象DB],[対象テーブル],[対象モード],[所有者ID] FROM [フィルタプリセットマスタ]')
    target=normalize_equipment_name(name)
    hit=next((r for r in cur.fetchall()
              if normalize_equipment_name(r[1])==target and str(r[2] or '')==db_key
              and str(r[3] or '')==table and str(r[4] or '')==mode and str(r[5] or '')==owner),None)
    if hit:
     cur.execute('UPDATE [フィルタプリセットマスタ] SET [メンバーJSON]=?,[条件JSON]=?,[有効]=-1,[更新者ID]=?,[更新日時]=Now() WHERE [プリセットID]=?',
                 [json.dumps(members),'[]',uid,hit[0]])
     pid=hit[0];created=False
    else:
     cur.execute('SELECT Max([表示順]) FROM [フィルタプリセットマスタ]')
     order=int((cur.fetchone() or [0])[0] or 0)+10
     cur.execute('INSERT INTO [フィルタプリセットマスタ] ([名称],[対象DB],[対象テーブル],[対象モード],[条件JSON],[メンバーJSON],[使用回数],[表示順],[有効],[所有者ID],[グループ],[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,0,?,-1,?,?,?,?,Now(),Now())',
                 [name,db_key,table,mode,'[]',json.dumps(members),order,owner,'',uid,uid])
     pid=cur.lastrowid;created=True
   else:
    cur.execute('SELECT [所有者ID] FROM [フィルタプリセットマスタ] WHERE [プリセットID]=?',[pid])
    row=cur.fetchone()
    if row is None:return jsonify(error='その組み合わせは見つかりません。'),404
    if not _preset_visible_to(row[0],requester):
     return jsonify(error='この組み合わせは別の人のものです。持ち主だけが変えられます。'),403
    sets=[];args=[]
    if name:sets.append('[名称]=?');args.append(name)
    if members is not None:sets.append('[メンバーJSON]=?');args.append(json.dumps(members))
    if not sets:return jsonify(error='変えるものがありません。'),400
    sets.append('[更新者ID]=?');args.append(uid)
    cur.execute(f'UPDATE [フィルタプリセットマスタ] SET {",".join(sets)},[更新日時]=Now() WHERE [プリセットID]=?',args+[pid])
    created=False
   c.commit()
  return jsonify(ok=True,id=pid,name=name,members=members or [],created=created,dropped=dropped)
 except Exception as e:return jsonify(error=f'組み合わせの保存に失敗: {e}'),500

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
   except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);keys=[]
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
@api_guard('ソートプリセット登録失敗')
def sort_preset_register():
 x=body({'db': any_, 'mode': any_, 'name': any_, 'sorts': any_, 'table': any_});name=x.text('name');uid=request_user_id(x)
 if not name:return jsonify(error='並び順の名前を入力してください。'),400
 keys=normalize_sort_keys(x.get('sorts'))
 if not keys:return jsonify(error='保存する並び順がありません。'),400
 db_key=x.text('db');table=x.text('table')
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

@bp.post('/api/sort-presets/use')
@api_guard('使用回数更新失敗')
def sort_preset_use():
 # よく使う順に並べるため、適用時に使用回数を加算する(フィルタと同じ)。
 x=body({'id': any_});pid=x.get('id');uid=request_user_id(x)
 if pid is None:return jsonify(ok=True,skipped=True)
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,skipped=True)
 with connect(path,False) as c:
  ensure_sort_preset_table(c);cur=c.cursor()
  cur.execute('UPDATE [ソートプリセットマスタ] SET [使用回数]=Nz([使用回数],0)+1,'
               '[最終使用日時]=Now(),[更新者ID]=? WHERE [プリセットID]=?',[uid,pid])
  c.commit()
 return jsonify(ok=True,id=pid,updated_by=uid)

@bp.post('/api/sort-presets/delete')
@api_guard('ソートプリセット削除失敗')
def sort_preset_delete():
 x=body({'id': any_});pid=x.get('id');uid=request_user_id(x)
 if pid is None:return jsonify(error='削除対象IDがありません。'),400
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  ensure_sort_preset_table(c);cur=c.cursor()
  # 物理削除ではなく無効化(フィルタプリセットと同じ方針)。
  cur.execute('UPDATE [ソートプリセットマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() '
               'WHERE [プリセットID]=?',[uid,pid])
  c.commit()
 return jsonify(ok=True,id=pid,updated_by=uid)

# ========================================================================
# 一覧表示設定マスタ(§9.88): 行間。列ではなく一覧全体の設定。
# ========================================================================
@bp.get('/api/list-view-master')
@api_guard('一覧表示設定読込失敗')
def list_view_master_get():
 target=str(request.args.get('target') or '').strip()
 if not target:return jsonify(error='対象(target)を指定してください。'),400
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,target=target,rowGap=ROW_GAP_DEFAULT)
 with connect(path,True) as c:
  v=list_view_settings_for(c,target)
 return jsonify(ok=True,target=target,**v)

@bp.post('/api/list-view-master')
@api_guard('一覧表示設定保存失敗')
def list_view_master_save():
 x=body({'rowGap': any_, 'target': any_});uid=request_user_id(x)
 target=x.text('target')
 if not target:return jsonify(error='対象(target)を指定してください。'),400
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  gap=set_list_view_settings(c,target,x.get('rowGap'),uid)
 return jsonify(ok=True,target=target,rowGap=gap,updated_by=uid,message='行間を保存しました。')
