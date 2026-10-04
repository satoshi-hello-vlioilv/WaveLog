"""masters/columns.py: 列の見せ方（スケジュール列・内容欄・列レイアウト・列プリセット・表示ルール）。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from flask import request, jsonify
from ..common import api_guard
from ...db_access import DBS, connect
from ...access_mode import request_user_id, current_permission_flags
from ..body import body, any_
from ...quiet import quiet
from ._base import bp
from ...repositories.master_repo import (
 schedule_columns_for,
 set_schedule_columns,
 schedule_content_items_for,
 set_schedule_content_items,
 column_layout_for,
 column_layout_targets,
 set_column_layout,
 column_layout_owner,
 column_layout_scope_set,
 column_layout_personal_targets,
 column_edit_check,
 column_edit_for_target,
 ensure_column_preset_table,
 column_presets,
 save_column_preset,
 delete_column_preset,
 normalize_column_preset,
 DISPLAY_RULE_TABLE,
 display_rules, display_rule_options,
 set_display_rule,
 delete_display_rule,
 display_rule_usage,
 display_rule_usage_all,
 RULE_OPS,
 RULE_COLORS,
)


# ------------------------------------------------------------------------
# 表示列の編集（§9.512）。**判定は`column_edit_check()`の1箇所**——ここは
# 「この端末の段」と「保存先（''＝みんなと同じ）」を渡して、断るなら403を返すだけ。
# 掛けるのは表示列そのもの（列レイアウト・作業スケジュールの列と内容）。
# プリセット・表示ルール・絞り込みは名前を付けて残す別の物で、ここでは絞らない。
# ------------------------------------------------------------------------
def _column_edit_level():
 return current_permission_flags().get('columnEdit','')

def _column_edit_denied(owner,target=''):
 ok,reason=column_edit_check(_column_edit_level(),owner,target)
 return None if ok else (jsonify(error=reason,code='column-edit'),403)


@bp.get('/api/schedule-column-master')
@api_guard('スケジュール列表示マスタ読込失敗')
def schedule_column_master_get():
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(ok=True,equipment='',columns=[])
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,equipment=equipment,columns=[])
 with connect(path,True) as c:
  columns=schedule_columns_for(c,equipment)
 return jsonify(ok=True,equipment=equipment,columns=columns)

@bp.post('/api/schedule-column-master')
@api_guard('スケジュール列表示マスタ保存失敗',bad=ValueError)
def schedule_column_master_save():
 x=body({'columns': any_, 'equipment': any_});uid=request_user_id(x)
 equipment=x.text('equipment')
 columns=x.get('columns')
 if not equipment:return jsonify(error='設備名を指定してください。'),400
 if not isinstance(columns,list):return jsonify(error='列の指定が不正です。'),400
 # 設備ごとの列はみんなで1つ（自分だけを持たない）＝みんなの分の保存（§9.512）
 denied=_column_edit_denied('')
 if denied:return denied
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  n=set_schedule_columns(c,equipment,columns,uid)
 return jsonify(ok=True,equipment=equipment,saved=n,updated_by=uid,message='表示列を保存しました。')

# ------------------------------------------------------------------------
# スケジュール内容表示マスタ（タイムラインの「内容」欄の項目・並び順）
# ------------------------------------------------------------------------
@bp.get('/api/schedule-content-master')
@api_guard('スケジュール内容表示マスタ読込失敗')
def schedule_content_master_get():
 equipment=str(request.args.get('equipment') or '').strip()
 if not equipment:return jsonify(ok=True,equipment='',items=[])
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,equipment=equipment,items=[])
 with connect(path,True) as c:
  items=schedule_content_items_for(c,equipment)
 return jsonify(ok=True,equipment=equipment,items=items)

@bp.post('/api/schedule-content-master')
@api_guard('スケジュール内容表示マスタ保存失敗',bad=ValueError)
def schedule_content_master_save():
 x=body({'equipment': any_, 'items': any_});uid=request_user_id(x)
 equipment=x.text('equipment')
 items=x.get('items')
 if not equipment:return jsonify(error='設備名を指定してください。'),400
 if not isinstance(items,list):return jsonify(error='項目の指定が不正です。'),400
 denied=_column_edit_denied('')
 if denied:return denied
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  n=set_schedule_content_items(c,equipment,items,uid)
 return jsonify(ok=True,equipment=equipment,saved=n,updated_by=uid,message='内容欄の項目を保存しました。')

# ========================================================================
# 列レイアウトマスタ(§9.88新設): 一覧・タイムラインの「並び順」と「列幅」。
# 対象(target)は画面が組み立てるスコープ文字列(list:<DB>:<表> / timeline:<設備>)。
# **どの列を出すかは別マスタ**(表示マスタ/スケジュール列表示マスタ)が決める。
# ここは並びと幅だけを持つので、列が増減しても保存内容は壊れない
# (知らない列は無視し、記録に無い列は既定の位置・既定の幅になる)。
# ========================================================================
@bp.get('/api/column-layout-master')
@api_guard('列レイアウト読込失敗')
def column_layout_master_get():
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
 uid=str(request.args.get('user') or '').strip()
 path=DBS['MASTER']['path']
 if not path.exists():
  return jsonify(ok=True,target=target,order=[],widths={},scope='common',canPersonalize=bool(uid),
                 **column_edit_for_target(_column_edit_level(),target))
 with connect(path,True) as c:
  # **誰の行を読むかは column_layout_owner の1箇所が答える**(§9.259)。
  # 画面は今までどおり対象(target)だけを送り、所有者のことを知らない。
  owner=column_layout_owner(c,target,uid)
  layout=column_layout_for(c,target,owner)
 # **どちらを見ているかを必ず返す**(§3)。黙って個人の並びを出すと、
 # 「自分にだけ違って見える」理由が画面のどこにも無くなる。
 return jsonify(ok=True,target=target,scope=('personal' if owner else 'common'),
                canPersonalize=bool(uid),
                # この対象で何ができるか（§9.512）。**判定はサーバー**——画面は受け取って
                # パネルの押せる/押せないと保存の行き先を決めるだけ。
                **column_edit_for_target(_column_edit_level(),target),**layout)

@bp.post('/api/column-layout-master')
@api_guard('列レイアウト保存失敗')
def column_layout_master_save():
 x=body({'aligns': any_, 'clear': any_, 'formats': any_, 'formulas': any_, 'hidden': any_, 
          'locks': any_, 'names': any_, 'order': any_, 'places': any_, 'rules': any_, 'sorts': any_, 
          'target': any_, 'widths': any_});uid=request_user_id(x)
 target=x.text('target')
 if not target:return jsonify(error='対象(target)を指定してください。'),400
 order=x.get('order');widths=x.get('widths');hidden=x.get('hidden');names=x.get('names')
 formats=x.get('formats');rules=x.get('rules');formulas=x.get('formulas')
 locks=x.get('locks')          # 幅を固定する列(§9.119)
 sorts=x.get('sorts')          # 列ごとの並べ替えの決まり(§9.187)
 aligns=x.get('aligns')        # 値と見出しの揃え(§9.239 ④)
 places=x.get('places')        # 段組の配置(§9.553)。段・何マス目から・何マスぶん
 # **送られてきた項目だけを書く**(§9.212 ②、利用者の指示「修正した内容が
 # 戻されたりしないために」)。以前は常に全置換で、渡し忘れた設定が黙って
 # 消えていた(計算式・並べ替え・幅固定で実際に3回起きた)。判断の材料は
 # 「JSONにそのキーがあるか」の1点——**空の値と省略は別のこと**で、
 # `hidden:[]`は「隠す列は無い」、`hidden`が無いのは「触っていない」。
 fields={k for k in ('order','widths','hidden','names','formats','rules',
                     'formulas','locks','sorts','aligns','places') if k in x}
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
  # 読むときと**同じ1箇所**で所有者を決める(§9.259)。別々に決めると
  # 「画面には個人の並びが出ているのに保存は共通へ行く」が作れる。
  owner=column_layout_owner(c,target,uid)
  denied=_column_edit_denied(owner,target)
  if denied:return denied
  n=set_column_layout(c,target,order or [],widths or {},uid,owner=owner,hidden=hidden or [],
                      names=names if isinstance(names,dict) else {},
                      formats=formats if isinstance(formats,dict) else {},
                      rules=rules if isinstance(rules,dict) else {},
                      formulas=formulas if isinstance(formulas,dict) else {},
                      locks=locks if isinstance(locks,list) else [],
                      sorts=sorts if isinstance(sorts,dict) else {},
                      aligns=aligns if isinstance(aligns,dict) else {},
                      places=places if isinstance(places,dict) else {},
                      fields=fields)
 return jsonify(ok=True,target=target,columns=n,updated_by=uid,
                scope=('personal' if owner else 'common'),
                message=('自分だけの表示の並びを保存しました。' if owner
                         else '表示の並びを保存しました。'))


@bp.post('/api/column-layout-master/scope')
@api_guard('列レイアウトの切り替えに失敗')
def column_layout_master_scope():
 """その一覧の列の見せ方を「みんなと同じ／自分だけ」で切り替える(§9.259)。

 利用者の指示「列の表示の部分については、こだわりが強い人もいるので、
 表示する一覧表毎に共通のものを使うか、個別ID単位のものを使うか選べるように」。

 **個人にするときは、いま見えている共通の設定を写してから切り替える**
 ——白紙から始めると、こだわって作った並びが押した瞬間に消えたように見える。
 **共通へ戻しても個人の行は消さない**（また個人へ戻せば続きから使える）。
 """
 x=body({'scope': any_, 'target': any_});uid=request_user_id(x)
 target=x.text('target')
 if not target:return jsonify(error='対象(target)を指定してください。'),400
 if not uid:
  # **押せるのに何も起きないボタンを残さない**(§4)。画面はこの理由をそのまま出す。
  return jsonify(error='利用者IDが分からないため、自分だけの設定は持てません。'
                        'この端末のログインIDを取得できていない可能性があります。'),400
 scope=x.text('scope').lower()
 if scope not in ('common','personal'):
  return jsonify(error="scopeは'common'か'personal'を指定してください。"),400
 # 切り替えは「自分の分」の操作（みんなの分は書かない）。変更不可の端末だけ断る（§9.512）
 denied=_column_edit_denied(uid,target)
 if denied:return denied
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  personal=column_layout_scope_set(c,target,uid,scope=='personal',updated_by=uid)
  layout=column_layout_for(c,target,uid if personal else '')
  mine=column_layout_personal_targets(c,uid)
 return jsonify(ok=True,target=target,scope=('personal' if personal else 'common'),
                personalTargets=mine,canPersonalize=True,
                **column_edit_for_target(_column_edit_level(),target),
                message=('この一覧の列は、これから自分だけの設定になります。'
                          '（いまの見え方を写してあるので、続きから直せます）'
                         if personal else
                         'この一覧の列は、みんなと同じ設定に戻りました。'
                          '（自分だけの設定は消していないので、いつでも戻せます）'),
                **layout)


# ========================================================================
# 列プリセットマスタ(§9.111): 列の設定一式に名前を付けて保存する。
#  - **マスタへ置くので他のPCからも読み出せる**(これが要望の主目的)。
#  - 中身は列レイアウトマスタと同じ構造をJSONで丸ごと持つ。プリセットは
#    出し入れが丸ごとなので、列ごとに行へ展開しない。
#  - ファイルへの書き出し/読み込みは画面側だけで完結する(このAPIが返す
#    JSONをそのまま保存し、読み込んだJSONをそのまま当てる)。
# ========================================================================
@bp.get('/api/column-preset-master')
@api_guard('列プリセット読込失敗')
def column_preset_master_get():
 target=str(request.args.get('target') or '').strip()
 path=DBS['MASTER']['path']
 if not path.exists():return jsonify(ok=True,target=target,items=[])
 with connect(path,False) as c:
  items=column_presets(c,target)
 return jsonify(ok=True,target=target,items=items)

@bp.post('/api/column-preset-master')
@api_guard('列プリセット保存失敗',bad=ValueError)
def column_preset_master_save():
 x=body({'body': any_, 'name': any_, 'note': any_, 'target': any_});uid=request_user_id(x)
 target=x.text('target')
 name=x.text('name')
 # 変数名は`preset_body`——`body`は本文を読む関数の名前（`from ..body import body`）。
 preset_body=x.get('body')
 if not isinstance(preset_body,dict):return jsonify(error='内容(body)の指定が不正です。'),400
 with connect(DBS['MASTER']['path'],False) as c:
  pid=save_column_preset(c,target,name,preset_body,uid,note=x.text('note'))
  items=column_presets(c,target)
 return jsonify(ok=True,id=pid,target=target,items=items,updated_by=uid,
                message=f'「{name}」として保存しました。')

@bp.post('/api/column-preset-master/update')
def column_preset_master_update():
 """名前の付け替え・内容の差し替え(ID指定)。登録側は同名を上書きする自然キー
 照合なので、**名前そのものを変える操作はこちらでしか表現できない**
 (登録側へ送ると別のプリセットが増える)。"""
 try:
  x=body({'body': any_, 'id': any_, 'name': any_, 'note': any_});uid=request_user_id(x)
  pid=x.get('id')
  if pid in (None,''):return jsonify(error='プリセットIDを指定してください。'),400
  name=x.text('name')
  if not name:return jsonify(error='プリセットの名前を入力してください。'),400
  with connect(DBS['MASTER']['path'],False) as c:
   ensure_column_preset_table(c)
   cur=c.cursor()
   cur.execute('SELECT [対象],[内容JSON] FROM [列プリセットマスタ] WHERE [プリセットID]=?',[pid])
   row=cur.fetchone()
   if not row:return jsonify(error='そのプリセットが見つかりません。'),404
   target=row[0]
   # 変数名は`preset_body`——`body`は本文を読む関数の名前（`from ..body import body`）。
   preset_body=x.get('body')
   if not isinstance(preset_body,dict):
    import json as _json
    try:preset_body=_json.loads(row[1] or '{}')
    except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);preset_body={}
   cur.execute('UPDATE [列プリセットマスタ] SET [名称]=?,[説明]=?,[内容JSON]=?,[更新者ID]=?,'
               '[更新日時]=Now() WHERE [プリセットID]=?',
               [name,x.text('note'),
                __import__('json').dumps(normalize_column_preset(preset_body),ensure_ascii=False),uid,pid])
   c.commit()
   items=column_presets(c,target)
  return jsonify(ok=True,id=pid,target=target,items=items,updated_by=uid,message='更新しました。')
 except Exception as e:return jsonify(error=f'列プリセット更新失敗: {e}'),500

@bp.post('/api/column-preset-master/delete')
@api_guard('列プリセット削除失敗')
def column_preset_master_delete():
 x=body({'id': any_, 'target': any_})
 pid=x.get('id')
 if pid in (None,''):return jsonify(error='プリセットIDを指定してください。'),400
 target=x.text('target')
 with connect(DBS['MASTER']['path'],False) as c:
  n=delete_column_preset(c,pid)
  items=column_presets(c,target)
 return jsonify(ok=True,deleted=n,target=target,items=items,message='削除しました。')


# ========================================================================
# 表示ルールマスタ(§9.88 段4): 値の読み替え。
#  - ルール名でまとめて全置換する(列レイアウトマスタと同じ方式)。
#    行の順序がそのまま評価順になるので、部分更新にすると「どちらの順が
#    正か」が決まらなくなる。
#  - 判定は画面側が行う。ここは保存と読み出しだけ。
# ========================================================================
@bp.get('/api/display-rule-master')
@api_guard('表示ルール読込失敗')
def display_rule_master_get():
 path=DBS['MASTER']['path']
 if not path.exists():
  return jsonify(ok=True,rules={},options={},usage={},ops=list(RULE_OPS),colors=list(RULE_COLORS))
 with connect(path,True) as c:
  rules=display_rules(c)
  # ルールごとの「条件が見る列の値」（§9.474）。行の並びとは別に返す（ルールの属性）。
  options=display_rule_options(c)
  # **どの列で使われているかも一緒に返す。** 編集画面が「このルールを直すと
  # どこへ効くか」を出せるようにするため(読み替えは複数の列で使い回す)。
  usage=display_rule_usage_all(c)
 return jsonify(ok=True,rules=rules,options=options,usage=usage,ops=list(RULE_OPS),colors=list(RULE_COLORS),
                table=DISPLAY_RULE_TABLE)

@bp.post('/api/display-rule-master')
@api_guard('表示ルール保存失敗',bad=ValueError)
def display_rule_master_save():
 x=body({'name': any_, 'rows': any_, 'self': any_});uid=request_user_id(x)
 name=x.text('name')
 if not name:return jsonify(error='ルール名を指定してください。'),400
 rows=x.get('rows')
 if rows is not None and not isinstance(rows,list):
  return jsonify(error='ルールの行(rows)の指定が不正です。'),400
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  n=set_display_rule(c,name,rows or [],uid,x.text('self'))
  rules=display_rules(c)
  options=display_rule_options(c)
 return jsonify(ok=True,name=name,rows=n,rules=rules,options=options,updated_by=uid,
                message=f'表示ルール「{name}」を保存しました。')

@bp.post('/api/display-rule-master/delete')
@api_guard('表示ルール削除失敗',bad=ValueError)
def display_rule_master_delete():
 x=body({'name': any_})
 name=x.text('name')
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
