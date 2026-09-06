"""masters/operation.py: 操業データ（項目・選択肢・入力フォーム）。

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
from ...quiet import quiet
from ._base import bp, _op_read


# ========================================================================
# 操業データ(§9.215): 設備ごとに「何を記録するか」を持つ2つのマスタ。
#  - 操業データ項目マスタ   … 1行＝1つの入力欄
#  - 操業データ選択肢マスタ … 1行＝1つの選択肢(名前でひとまとまり)
# 値そのものは測定レコード(settings.opData)に入る。マスタへは入れない
# ——1ロット1枚の記録なので、レコードと一緒に運ばれるのが正しい(§9.91)。
# ========================================================================
@bp.get('/api/operation-item-master')
def operation_item_list():
 """`equipment`を付けると**その設備で使う項目だけ**返す（`*`＝全設備の行も
    含む）。付けなければマスタ管理の一覧用に全部返す。"""
 try:
  from ...repositories import operation_repo as op
  eq=str(request.args.get('equipment') or '').strip()
  def fn(c):
   # **「出さない」にした項目も返す**（§9.219 ③）。落とすと盤から消えて
   # 戻せなくなる——盤は`is-off`の見た目で置き、測定画面だけが落とす。
   items=op.items_for_equipment(c,eq,True) if eq else op.item_rows(c,True)
   # 見本の値（§9.250 ⑤、利用者の指示「データダミーをつかって…操業データが
   # どうなるかといった結果を…すぐに確認できる導線を」）。**作るのは
   # `report_block_repo.sample_for()`の1箇所**——帳票の候補と設定窓の見本で
   # 違う値が出ると、どちらが本当か分からなくなる（§9.163）。
   #
   # **道の組み立ても`field_catalog()`と同じにすること**——組み込みの欄は
   # `settings.<キー>`で、`settings.opData.<項目名>`ではない（§9.215）。
   # 揃えないと、組み込みの欄だけ見本の値が引けず「（値）」のまま残る。
   # **選択肢は選択肢マスタから引く**（行そのものは名前しか持っていない）。
   from ...repositories import report_block_repo as rb
   for it in items:
    builtin=str(it.get('builtin') or '').strip()
    path=('settings.'+builtin) if builtin else ('settings.opData.'+str(it.get('name') or ''))
    src=it
    if not (it.get('choices') or []):
     cname=str(it.get('choice') or '').strip()
     if cname:
      try:
       vals=op.choice_values(c,cname,eq)
      except Exception as _e:
       quiet('選択肢を読めない（候補なしで返す）',_e)
       vals=[]
      if vals:
       src=dict(it);src['choices']=vals
    it['sample']=rb.sample_for(path,src)
   return {'items':items,'types':list(op.ITEM_TYPES),'choiceNames':op.choice_names(c),
           # 画面が「どこへ出すか」「何列ぶんか」を選ばせるための一覧(§9.216 ②)。
           # **画面へ書き写さない**——増減したときに2箇所を直すことになる。
           'places':list(op.PLACES),'spans':list(op.SPANS),'gridCols':op.GRID_COLS,
           'spanUnit':op.SPAN_UNIT,'widgets':list(op.WIDGETS),
           # §9.307 入力値の丸めの向き。**サーバーが答える**——
           # 画面へ写すと、増やしたときに2箇所直すことになる。
           'roundModes':list(op.ROUND_MODES),
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
           # §9.248 ⑤ 選択肢の並びの語彙と、それが効く入力方法。
           # **効くのは「押すと新しい面が開く」形だけ**——札を並べる形で
           # 順番が変わると、同じ欄なのに押す場所が毎回動く（§4）。
           'choiceOrders':list(op.CHOICE_ORDERS),
           'choiceOrderWidgets':list(op.CHOICE_ORDER_WIDGETS),
           # §9.286 ⑥ 未入力・未選択のときの配色。**語彙はサーバーが答える**
           # ——色の鍵は`WL.columnTint.PALETTE`と揃える約束なので、画面へ
           # 書き写すと片方だけ増えた状態が作れる（§9.163）。
           'blankTints':list(op.BLANK_TINTS),
           'blankTintNone':op.BLANK_TINT_NONE,
           # §9.323 ① 測定画面からの間接登録は**入切の1つ**なので、語彙は
           # 出さない（`choiceOrder`のような綴りの一覧を持たない）。
           # **読まれない鍵をAPIへ置かないこと**——契約が在るように見えて
           # 誰も使っていない面が増える。効く欄かどうかは行ごとの
           # `inlineAdd`／`inlineAddSaved`が言う。
           # §9.248 ① 選ばせ方のまとまり（盤の見出しと並び）。**サーバーが
           # 答える**——画面へ写すと、種類を足したときに2箇所直すことになる。
           'widgetGroups':[{'label':l,'note':n,'items':list(i)}
                           for l,n,i in op.WIDGET_GROUPS],
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
           # §9.256。式で作る自動値の鍵。**画面へ綴りを書き写さない**
           # （`tests/test_opauto.js`が機械で見張っている）。
           'autoFormulaKey':op.AUTO_FORMULA_KEY,
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

@api_guard('操業データ項目マスタの保存に失敗しました',bad=ValueError)
def _operation_item_save(x):
 from ...repositories import operation_repo as op
 uid=request_user_id(x)
 name=x.text('name')
 if not name:return jsonify(error='項目名を入力してください。'),400
 num=lambda v:(None if v in (None,'') else float(v))
 iv=lambda v:(None if v in (None,'') else int(v))
 ref={}
 def fn(c):
  return op.item_upsert(c,uid,equipment=x.get('equipment') or '*',
                        group=x.get('group') or '',name=name,order=iv(x.get('order')),
                        kind=x.get('type') or '文字',decimals=iv(x.get('decimals')),
                        vmin=num(x.get('min')),vmax=num(x.get('max')),
                        choice=x.get('choice') or '',unit=x.get('unit') or '',
                        required=x.flag('required'),note=x.get('note') or '',
                        enabled=(True if x.get('enabled') is None else x.flag('enabled')),
                        item_id=(int(x['id']) if x.get('id') not in (None,'') else None),
                        place=x.get('place'),span=x.get('span'),
                        fold=x.flag('fold'),show_when=x.get('showWhen'),
                        widget=x.get('widget'),
                        # §9.220 ②③⑤
                        initial=x.get('initial'),free_text=x.flag('freeText'),
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
                        # §9.256 式で作る自動値。**送っていないときは今の値を
                        # 残す**（`None`のまま渡す・§9.212 ②）。
                        auto_formula=x.get('autoFormula'),
                        # §9.242 ④ ③「記録した値」のカードへ出すか。
                        # **送られてきたときだけ**書く（`dummy`と同じ約束）。
                        record_show=x.get('recordShow'),
                        # §9.248 ⑤ 選択肢の並び（''＝表示順／'よく使う順'）。
                        choice_order=x.get('choiceOrder'),
                        # §9.286 ⑥ 未入力・未選択のときの配色
                        # （''＝既定／'なし'／色の鍵）。**送っていないときは
                        # 今の値を残す**（`None`のまま渡す・§9.212 ②）。
                        blank_tint=x.get('blankTint'),
                        # §9.307 入力値の丸めの向き（単位は「刻み」）。
                        round_mode=x.get('roundMode'),
                        # §9.323 ① 測定画面で打った値をその場で選択肢マスタへ
                        # 足せるか。**呼び名でも受ける**——汎用フォームは
                        # 文字列の選択欄しか持たない（`enabledText`と同じ作法）。
                        # **送っていないときは今の値を残す**（§9.212 ②）。
                        # 真偽の読み方は`flags.flag_of`の1箇所（§9.324 R4）。
                        inline_add=flag_of(text_or(x,'inlineAdd')),
                        report=ref)
 saved=_op_read(fn)
 # **付け替えたことは黙って済ませない**（§9.226 ①）。名前を変えると
 # 帳票の`settings.opData.<項目名>`も一緒に動くので、何件動いたかを言う。
 msg='操業データの項目を保存しました。'
 if ref.get('renamedRefs'):
  msg+=f"「{ref.get('oldName')}」を参照していた帳票ブロック{ref['renamedRefs']}件も新しい名前へ付け替えました。"
 return jsonify(ok=True,id=saved,message=msg,renamedRefs=ref.get('renamedRefs') or 0)

@bp.post('/api/operation-item-master')
def operation_item_register():
 return _operation_item_save(body({'align': any_, 'autoFormula': any_, 'autoValue': any_, 'blankTint': any_, 
          'choice': any_, 'choiceOrder': any_, 'decimals': any_, 'digits': any_, 
          'dummy': any_, 'enabled': any_, 'equipment': any_, 'fold': any_, 
          'freeText': any_, 'group': any_, 'groupSpan': any_, 'id': any_, 
          'initial': any_, 'inlineAdd': any_, 'inlineAddText': any_, 
          'layout': any_, 'look': any_, 'max': any_, 
          'maxFrom': any_, 'min': any_, 'minFrom': any_, 'name': any_, 
          'noBlank': any_, 'note': any_, 'order': any_, 'place': any_, 
          'recordShow': any_, 'required': any_, 'role': any_, 'roundMode': any_, 
          'showWhen': any_, 'sourceNote': any_, 'span': any_, 'step': any_, 
          'type': any_, 'unit': any_, 'unitPlace': any_, 'valueFormat': any_, 
          'widget': any_}))

@bp.post('/api/operation-item-master/update')
def operation_item_update():
 x=body({'align': any_, 'autoFormula': any_, 'autoValue': any_, 'blankTint': any_, 
          'choice': any_, 'choiceOrder': any_, 'decimals': any_, 'digits': any_, 
          'dummy': any_, 'enabled': any_, 'equipment': any_, 'fold': any_, 
          'freeText': any_, 'group': any_, 'groupSpan': any_, 'id': any_, 
          'initial': any_, 'inlineAdd': any_, 'inlineAddText': any_, 
          'layout': any_, 'look': any_, 'max': any_, 
          'maxFrom': any_, 'min': any_, 'minFrom': any_, 'name': any_, 
          'noBlank': any_, 'note': any_, 'order': any_, 'place': any_, 
          'recordShow': any_, 'required': any_, 'role': any_, 'roundMode': any_, 
          'showWhen': any_, 'sourceNote': any_, 'span': any_, 'step': any_, 
          'type': any_, 'unit': any_, 'unitPlace': any_, 'valueFormat': any_, 
          'widget': any_})
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _operation_item_save(x)

@bp.post('/api/operation-item-master/layout')
@api_guard('操業データの並びの保存に失敗しました')
def operation_item_layout():
 """並び・群・列幅・置き場・必須・出す/出さないを**まとめて1回で**書く
    (§9.216 ②)。D&Dで組み替える画面なので、1行ずつ送ると往復が増え、
    途中で切れると並びが半分だけ変わった状態が残る。"""
 from ...repositories import operation_repo as op
 x=body({'equipment': any_, 'items': any_})
 rows=x.get('items')
 if not isinstance(rows,list):return jsonify(error='items（並び）がありません。'),400
 # 設備を選んで並べているときは**その設備の上書きへ**書く（§9.239 ②）。
 # 空＝「共通（すべての設備）」で、今までどおり行そのものを書き換える。
 eq=x.text('equipment')
 n=_op_read(lambda c:op.item_layout_save(c,request_user_id(x),rows,equipment=eq))
 return jsonify(ok=True,saved=n,equipment=eq,
                message=f'操業データの並びを保存しました（{eq or "共通（すべての設備）"}）。')

@bp.post('/api/operation-item-master/record-layout')
@api_guard('「記録した値」の配置の保存に失敗しました')
def operation_item_record_layout():
 """③「記録した値」のカードの配置を**まとめて1回で**書く（§9.243）。

    D&Dで組み替える盤なので、1行ずつ送ると往復が増え、途中で切れると
    並びが半分だけ変わった状態が残る（`layout`と同じ理由）。
    書くのは`[記録表示]`／`[記録群]`／`[記録順]`の3つだけで、
    型・選択肢・役割・意匠には触らない。"""
 from ...repositories import operation_repo as op
 x=body({'items': any_})
 rows=x.get('items')
 if not isinstance(rows,list):return jsonify(error='items（配置）がありません。'),400
 n=_op_read(lambda c:op.record_layout_save(c,request_user_id(x),rows))
 return jsonify(ok=True,saved=n,message=f'「記録した値」の配置を保存しました（{n}件）。')

@bp.post('/api/operation-item-master/group')
@api_guard('群の設定の保存に失敗しました')
def operation_item_group():
 """群のふるまい（畳む・開く条件）だけをまとめて書く(§9.216 ④)。
    `layout`で代用すると、直前に1件だけ更新した内容を古い写しで上書きする。"""
 from ...repositories import operation_repo as op
 x=body({'dummy': any_, 'equipment': any_, 'fold': any_, 'group': any_, 'groupSpan': any_, 
          'place': any_, 'showWhen': any_})
 g=x.text('group')
 if not g:return jsonify(error='群がありません。'),400
 n=_op_read(lambda c:op.group_flags_save(c,request_user_id(x),x.get('place'),g,
                                         x.flag('fold'),x.get('showWhen'),
                                         # **送られてきたときだけ書く**（§9.226 ③）
                                         x.get('groupSpan'),
                                         # §9.227 ③ ダミー（空き）の群
                                         x.get('dummy'),
                                         # §9.239 ② 設備を選んでいるときは上書きへ
                                         equipment=x.text('equipment')))
 return jsonify(ok=True,saved=n,message='群の設定を保存しました。')

@bp.post('/api/operation-item-master/delete')
@api_guard('操業データ項目マスタの削除に失敗しました')
def operation_item_delete():
 from ...repositories import operation_repo as op
 x=body({'id': any_})
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 n=_op_read(lambda c:op.item_delete(c,x['id'],request_user_id(x)))
 return jsonify(ok=True,deleted=n,message='操業データの項目を削除しました。')

@bp.get('/api/operation-choice-master')
def operation_choice_list():
 try:
  from ...repositories import operation_repo as op
  def fn(c):
   # **6つのマスタの移行はここでも1度だけ通す**(§9.221 ③)。測定画面を
   # 開く前にマスタ管理を開いた端末では、まだ写していない状態で一覧が
   # 出る——「移したはずのオペレータが1人も居ない」に見える。
   try:op.migrate_legacy_choice_masters(c)
   except Exception as _e:quiet('旧マスタの移行を試せない（移行済みの目印は立てない）',_e)
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
   # ---------- 親子（§9.306、利用者の指示） ----------
   # **リンクと「その親のまとまりの値」はサーバーが答える**（§9.163）——
   # 画面で「このまとまりの親は誰か」を数え直すと、盤と値の欄で答えが
   # 食い違いうる。`parentValues`は**親の値の欄が選ばせる候補**そのもの。
   links=op.choice_links(c)
   parent_of={x['child']:x['parent'] for x in links}
   for r in rows:
    r['parent']=parent_of.get(r['name'],'')
   for g in groups:
    g['parent']=parent_of.get(g['name'],'')
    g['children']=[x['child'] for x in links if x['parent']==g['name']]
   return {'items':rows,'names':op.choice_names(c),'usage':usage,'groups':groups,
           'legacyGroups':[g for g,_ in op.LEGACY_CHOICE_GROUPS],
           'links':links,
           'parentValues':{ch:op.choice_values(c,pa) for ch,pa in parent_of.items()}}
  return jsonify(ok=True,**_op_read(fn))
 except Exception as e:return jsonify(error=f'操業データ選択肢マスタの読込に失敗しました: {e}'),500

@api_guard('操業データ選択肢マスタの保存に失敗しました',bad=ValueError)
def _operation_choice_save(x):
 from ...repositories import operation_repo as op
 uid=request_user_id(x)
 iv=lambda v:(None if v in (None,'') else int(v))
 def fn(c):
  return op.choice_upsert(c,x.get('name'),x.get('value'),uid,order=iv(x.get('order')),
                          choice_id=(int(x['id']) if x.get('id') not in (None,'') else None),
                          enabled=flag_of(text_or(x,'enabled')),
                          note=x.get('note'),
                          # §9.221 ③。よみ＝探すための読み、対象設備＝
                          # その設備のときだけ出す（空＝すべて）。
                          reading=x.get('reading'),equipment=x.get('equipment'),
                          # §9.306 親のどの値のときに出るか（空＝すべての親）。
                          # **`None`は「送っていない」**なので今の値が残る。
                          parent_value=x.get('parentValue'))
 return jsonify(ok=True,id=_op_read(fn),message='操業データの選択肢を保存しました。')

@bp.post('/api/operation-choice-master')
def operation_choice_register():
 return _operation_choice_save(body({'enabled': any_, 'enabledText': any_, 'equipment': any_, 'id': any_, 'name': any_, 
          'note': any_, 'order': any_, 'parentValue': any_, 'reading': any_, 
          'value': any_}))

@bp.post('/api/operation-choice-master/update')
def operation_choice_update():
 x=body({'enabled': any_, 'enabledText': any_, 'equipment': any_, 'id': any_, 'name': any_, 
          'note': any_, 'order': any_, 'parentValue': any_, 'reading': any_, 
          'value': any_})
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _operation_choice_save(x)

@bp.post('/api/operation-choice-master/rename-group')
@api_guard('まとまり名の変更に失敗しました',bad=ValueError)
def operation_choice_rename_group():
 """まとまりの名前を変える(§9.221 ②)。**参照している項目の`[選択肢名]`も
    一緒に書き換える**——名前で結んでいるので(§9.215)、片方だけ変えると
    その項目の選択肢が黙って消える。"""
 from ...repositories import operation_repo as op
 x=body({'from': any_, 'to': any_})
 src=x.text('from');dst=x.text('to')
 if not src or not dst:return jsonify(error='まとまり名を入力してください。'),400
 if src==dst:return jsonify(ok=True,moved=0,message='名前は変わっていません。')
 n=_op_read(lambda c:op.choice_rename_group(c,src,dst,request_user_id(x)))
 return jsonify(ok=True,moved=n,message=f'「{src}」を「{dst}」へ変更しました（{n}件）。')

@bp.post('/api/operation-choice-master/delete-group')
@api_guard('まとまりの削除に失敗しました',bad=ValueError,bad_status=409)
def operation_choice_delete_group():
 """まとまりごと消す(§9.221 ②)。**使っている項目があれば断る**——消すと
    その項目は黙って空の欄になる（§9.216 ④で「使い道の見えない選択肢は
    消してよいのか判断できない」と書いた、その裏返し）。"""
 from ...repositories import operation_repo as op
 x=body({'name': any_})
 nm=x.text('name')
 if not nm:return jsonify(error='まとまり名がありません。'),400
 n=_op_read(lambda c:op.choice_delete_group(c,nm,request_user_id(x)))
 return jsonify(ok=True,deleted=n,message=f'「{nm}」を{n}件まとめて削除しました。')

@bp.post('/api/operation-choice-master/reorder')
@api_guard('選択肢の並びの保存に失敗しました')
def operation_choice_reorder():
 """1つのまとまりの中の並びをまとめて書く(§9.221 ②)。D&Dで並べ替える
    画面なので、1行ずつ送ると往復が増え、途中で切れると半分だけ動いた
    並びが残る（項目マスタの`layout`と同じ作法）。"""
 from ...repositories import operation_repo as op
 x=body({'ids': any_})
 ids=x.get('ids')
 if not isinstance(ids,list):return jsonify(error='ids（並び）がありません。'),400
 n=_op_read(lambda c:op.choice_reorder(c,ids,request_user_id(x)))
 return jsonify(ok=True,saved=n,message='選択肢の並びを保存しました。')

@bp.post('/api/operation-choice-master/used')
@api_guard('使用回数を数えられませんでした')
def operation_choice_used():
 """選ばれた回数を1つ増やす（§9.248 ⑤、利用者の指示）。

 **測定画面は投げっぱなしで呼ぶ**（値が入るのを待たせない）。選択肢に
 無い値（手打ち）は`choice_used_bump`が何もしないので、打ち間違いで
 マスタが膨れることは無い。

 **書き込みだが、閲覧モードからも通す**——数えているのは「選ばれた」と
 いう事実だけで、現場の設定は1つも変わらない。ここを塞ぐと、閲覧モードの
 端末で測った回数だけが数えられず、並びが端末によって食い違う。"""
 from ...repositories import operation_repo as op
 x=body({'name': any_, 'value': any_})
 # `_op_read`は名前に反して**書ける接続**（`connect(path,False)`）を開く
 # だけの道具で、他の保存経路も同じものを通っている。
 n=_op_read(lambda c:op.choice_used_bump(c,x.get('name'),x.get('value')))
 return jsonify(ok=True,updated=n)

@bp.post('/api/operation-choice-master/delete')
@api_guard('操業データ選択肢マスタの削除に失敗しました')
def operation_choice_delete():
 from ...repositories import operation_repo as op
 x=body({'id': any_})
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 n=_op_read(lambda c:op.choice_delete(c,x['id'],request_user_id(x)))
 return jsonify(ok=True,deleted=n,message='操業データの選択肢を削除しました。')


@bp.get('/api/operation-form')
def operation_form():
 """測定画面が開いた瞬間に要る「その設備の入力欄一式」。**選択肢まで解決して
    返す**——2度目の問い合わせを画面にさせない。読めなくても測定は開けるよう、
    失敗しても項目0件で返す(fail-open)。"""
 try:
  from ...repositories import operation_repo as op
  eq=str(request.args.get('equipment') or '').strip()
  return jsonify(ok=True,equipment=eq,**_op_read(lambda c:op.form_for_equipment(c,eq)))
 except Exception as e:
  return jsonify(ok=True,equipment=str(request.args.get('equipment') or ''),items=[],
                 builtinOff=[],gridCols=op.GRID_COLS,
                 error=f'操業データの項目を読めませんでした: {e}')
