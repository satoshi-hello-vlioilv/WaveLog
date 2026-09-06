"""masters/report_block.py: 帳票ブロックマスタ。

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
# 帳票ブロックマスタ(§9.217)。「ラベルと値の出どころを並べただけの塊」を
# 現場が自分で足せるようにする。中身の作り方が仕事になっている塊
# （測定表・条の図・異常位置判定）はコードの側のまま。
# ========================================================================
@bp.get('/api/report-block-master')
@api_guard('帳票ブロックマスタの読込に失敗しました')
def report_block_list():
 from ...repositories import report_block_repo as rb
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
          # 繰り返しの向き（§9.277）。**呼び名もサーバーが答える**。
          'repeatDirs':[{'v':v,'label':lb} for v,lb in rb.REPEAT_DIRS],
          # 行・列を最大で出すか（§9.309）。**語彙はサーバーが答える**
          # ——画面へ綴りを書き写すと、増やしたときに2箇所直すことになる。
          'fulls':[{'v':v,'label':lb} for v,lb in rb.FULL_LABELS],
          # 表に組むときの軸（§9.277）。**既定の置き方はこの並びが決める**
          # ——1つ目を行、残りを列。画面へ写すと、軸を1つ足したときに
          # 「既定の並び」が2箇所になる（§9.163）。
          'pivotAxes':list(rb.PIVOT_AXES),
          'axisLot':rb.AXIS_LOT,
          # 節の中の列数の上限（§9.277）。**紙が受ける数と同じ**——画面が
          # 別に持つと、組んだ表が保存で黙って丸められる。
          # コードが描く欄の並びの見せ方（§9.323 ④）。**語彙はサーバーが
          # 答える**——画面へ綴りを写すと、選べる値を1つ足すたびに2箇所直す。
          'factLabelPlaces':[{'v':v,'label':lb} for v,lb in rb.FACT_LABEL_PLACES],
          'factAligns':[{'v':v,'label':lb} for v,lb in rb.ALIGNS],
          'contentColsMax':rb.CONTENT_COLS_MAX,
          'contentEditable':sorted(rb.CONTENT_EDITABLE),
          # **既定の中身をマスの並びで写せる塊**（§9.285 ②）。白紙から
          # 組み直させると、いま見えている形が押した瞬間に消えたように
          # 見える（§9.259と同じ理由）。並びも列数もサーバーが答える。
          'defaultCells':rb.default_cell_map(),
          # **このうち起動時に自動で種をまく塊**（§9.320-E の追補）。
          # `品質情報（仕掛）`は`.rp-info-box`のカードいっぱいに広がる
          # 枠（§9.242 ⑧）を持つので自動では切り替えない——押して
          # 初めて汎用のマスへ移る。**顔ぶれはここが答える**（画面や
          # テストへ綴りを書き写さない）。
          'autoSeededCells':list(rb.AUTO_SEED_CELL_KEYS),
          # 1つのマスが持てるもの（§9.274）。**語彙はサーバーが答える**
          # ——画面へ写すと、選べる書式を1つ足すたびに2箇所直すことになる。
          'cellKinds':[{'v':v,'label':lb} for v,lb in rb.CELL_KINDS],
          'aligns':[{'v':v,'label':lb} for v,lb in rb.ALIGNS],
          'formatKinds':[{'v':v,'label':lb} for v,lb in rb.FORMAT_KINDS],
          'datePatterns':list(rb.DATE_PATTERNS),
          'decimalMax':rb.DECIMAL_MAX,
          # **出どころの見本**。ここに無い道も書けるので、選択肢で塞がない。
          'fields':[{'label':a,'path':b} for a,b in rb.FIELD_CATALOG],
          # **選んで組み立てるための候補**（§9.226 ④）。操業データの項目も
          # 含むので、現場が項目を足せばそのまま候補に増える。
          'catalog':rb.field_catalog(c,eq)}
 return jsonify(ok=True,equipment=eq,**_op_read(fn))

@api_guard('帳票ブロックマスタの保存に失敗しました',bad=ValueError)
def _report_block_save(x):
 from ...repositories import report_block_repo as rb
 uid=request_user_id(x)
 name=x.text('name')
 if not name:return jsonify(error='ブロック名を入力してください。'),400
 iv=lambda v:(None if v in (None,'') else int(v))
 # 「有効」は画面からは呼び名（有効/無効）で来る。読み方は`flags.flag_of`の
 # 1箇所（§9.324 R4）。**渡していなければ触らない**（§9.320-E）——`None`は
 # repo側が「今の値のまま」と読む。
 alive=flag_of(text_or(x,'enabled'))
 def fn(c):
  return rb.block_upsert(c,uid,equipment=x.get('equipment'),name=name,
                         order=iv(x.get('order')),span=x.get('span'),rows=x.get('rows'),
                         content=x.get('content'),note=x.get('note'),
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
                         # 欄の見せ方（§9.323 ④）。**呼び名でも受ける**——画面の
                         # 汎用フォームは文字列の選択欄しか持たない。
                         label_place=(x.get('labelPlaceText')
                                      if x.get('labelPlaceText') is not None
                                      else x.get('labelPlace')),
                         fact_align=(x.get('factAlignText')
                                     if x.get('factAlignText') is not None
                                     else x.get('factAlign')),
                         repeat=(x.get('repeatText') if x.get('repeatText') is not None
                                 else x.get('repeat')),
                         # 繰り返しの向き（§9.277）。**呼び名でも受ける**。
                         repeat_dir=(x.get('repeatDirText')
                                     if x.get('repeatDirText') is not None
                                     else x.get('repeatDir')),
                         # 行・列の出し方（§9.309）。**呼び名でも受ける**。
                         full=(x.get('fullText') if x.get('fullText') is not None
                               else x.get('full')),
                         block_id=(int(x['id']) if x.get('id') not in (None,'') else None))
 return jsonify(ok=True,id=_op_read(fn),message='帳票ブロックを保存しました。')

@bp.get('/api/report-block-master/sample-record')
@api_guard('見本のロットを作れませんでした')
def report_block_sample_record():
 """帳票の見本に使う**ダミーのロット1件**（§9.253、利用者の指示）。

    **読むだけ・保存しない。** このレコードは画面のメモリにしか置かず、
    測定データの一覧にも共有DBにも入らない（見本のロットが実データとして
    残るのは、どんな見間違いより悪い）。

    `equipment` を渡すと登録設備をそれにする——帳票の配置は
    `report:<設備>`（§9.174）なので、**どの設備の配置で見るか**が決まる。"""
 from ...repositories import report_block_repo as rb
 eq=str(request.args.get('equipment') or '').strip()
 rec=_op_read(lambda c:rb.sample_record(c,eq))
 return jsonify(ok=True,equipment=eq,id=rb.SAMPLE_RECORD_ID,record=rec)

@bp.post('/api/report-block-master')
def report_block_register():
 return _report_block_save(body({'cols': any_, 'content': any_, 'enabled': any_, 'enabledText': any_, 'equipment': any_, 
          'factAlign': any_, 
          'factAlignText': any_, 'full': any_, 'fullText': any_, 'id': any_, 
          'kind': any_, 'kindText': any_, 'labelPlace': any_, 'labelPlaceText': any_, 
          'name': any_, 'note': any_, 'order': any_, 'repeat': any_, 
          'repeatDir': any_, 'repeatDirText': any_, 'repeatText': any_, 'rows': any_, 
          'span': any_, 'text': any_}))

@bp.post('/api/report-block-master/update')
def report_block_update():
 x=body({'cols': any_, 'content': any_, 'enabled': any_, 'enabledText': any_, 'equipment': any_, 
          'factAlign': any_, 
          'factAlignText': any_, 'full': any_, 'fullText': any_, 'id': any_, 
          'kind': any_, 'kindText': any_, 'labelPlace': any_, 'labelPlaceText': any_, 
          'name': any_, 'note': any_, 'order': any_, 'repeat': any_, 
          'repeatDir': any_, 'repeatDirText': any_, 'repeatText': any_, 'rows': any_, 
          'span': any_, 'text': any_})
 if x.get('id') in (None,''):return jsonify(error='更新対象IDがありません。'),400
 return _report_block_save(x)

@bp.post('/api/report-block-master/delete')
@api_guard('帳票ブロックマスタの削除に失敗しました',bad=ValueError)
def report_block_delete():
 from ...repositories import report_block_repo as rb
 x=body({'id': any_})
 if x.get('id') in (None,''):return jsonify(error='削除対象IDがありません。'),400
 n=_op_read(lambda c:rb.block_delete(c,x['id'],request_user_id(x)))
 return jsonify(ok=True,deleted=n,message='帳票ブロックを削除しました。')
 # **サーバーが理由を書いているのに包み直さない**（§9.200）。既定の塊は
 # 消せない、という断りは400で返す（500だと「失敗しました」に埋もれる）。
