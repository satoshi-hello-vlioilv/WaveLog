"""masters/equipment.py: 設備マスタ。

`masters.py`（73ルート・2,093行）から段へ分けた（§9.333、REVIEW 3-10）。
**Blueprintは`_base.py`の1つ**なので、URLも`_WRITE_ALLOWED_MODES`／
`_ENDPOINT_EXTRA_MODES`の鍵（`masters.<関数名>`）も1つも変わらない。
ロジックは移しただけ。
"""
from datetime import datetime
from flask import jsonify
from ..common import api_guard
from ...db_access import DBS, connect, tables
from ...access_mode import request_user_id
from ..body import body, any_
from ... import schedule_calc
from ._base import bp
from ...repositories.master_repo import (
 EQUIPMENT_MASTER_TABLE,
 ensure_equipment_master_table,
 normalize_equipment_name,
 equipment_master_rows,
 EQUIPMENT_FEATURES,
 EQUIPMENT_FEATURE_KEYS,
 EQUIPMENT_FEATURE_EFFECTS,
 normalize_equipment_features,
 equipment_disabled_features,
 MEASURE_ITEMS,
 MEASURE_ITEM_KEYS,
 MEASURE_ITEM_EFFECT,
 MEASURE_ITEM_FEATURE,
 MEASURE_ITEM_DISABLED_COLUMN,
 EQUIPMENT_DISABLED_COLUMN,
 normalize_measure_items,
 equipment_disabled_measure_items,
 equipment_allows,
 STRIP_LIMIT,
 DEFAULT_MAX_STRIPS,
 clamp_max_strips,
 EQUIPMENT_KINDS,
 normalize_equipment_kind,
 STANDARD_MINUTES_MAX,
 normalize_standard_minutes,
 MAX_LINE_SPEED_MAX,
 normalize_max_line_speed,
 ensure_operator_equipment_table,
 OPERATOR_EQUIPMENT_TABLE,
 rename_equipment_references,
 field_reorder_terminal_count,
)


def _measure_items_off(value):
 """本文の「使わない入力内容」を保存値へ。**全部は外せない**（§9.392）
    ——1つも選べない測定画面は、押しても何も起きない画面になる（§CLAUDE 4）。
    測定そのものを止めたいときは`[無効機能]`の「測定」を外す道がある。 """
 off=normalize_measure_items(value)
 if off and len(equipment_disabled_measure_items(off))>=len(MEASURE_ITEM_KEYS):
  raise ValueError('入力内容をすべて外すことはできません（1つ以上は使う形にしてください）。'
                   'この設備で測定そのものを止めるときは、「使える機能」の「測定」を外してください。')
 return off


def _insert_equipment(cur,name,x,order,uid):
 """設備マスタへ1行足す。**書き方はここ1箇所**——同じINSERTが2箇所にあり、
    列を1つ足すたびに片方だけ直す事故が起きる（§9.392で`[無効入力内容]`を
    足したときに気づいた）。"""
 cur.execute(
  f'INSERT INTO [設備マスタ] ([設備名],[区分],[最大条数],[標準時間分],[最大ライン速度],'
  f'[{EQUIPMENT_DISABLED_COLUMN}],[{MEASURE_ITEM_DISABLED_COLUMN}],[表示順],[有効],'
  '[登録者ID],[更新者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,-1,?,?,Now(),Now())',
  [name,normalize_equipment_kind(x.get('kind')),
   (None if x.text('maxStrips')=='' else clamp_max_strips(x.get('maxStrips'))),
   normalize_standard_minutes(x.get('standardMinutes')),
   normalize_max_line_speed(x.get('maxLineSpeed')),
   normalize_equipment_features(x.get('disabledFeatures')),
   _measure_items_off(x.get('disabledMeasureItems')),
   order,uid,uid])


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
                            else normalize_max_line_speed(r[9])),
            # 使える機能（§9.302）。**画面は綴りから判断しない**——効いている
            # 真偽値をそのまま渡す（§9.163。空欄＝すべて使える、という約束を
            # 画面へ書き写さないため）。`disabledFeatures`は編集画面のため。
            'features':{k:equipment_allows(r[10] if len(r)>10 else '',k)
                        for k in EQUIPMENT_FEATURE_KEYS},
            'disabledFeatures':sorted(equipment_disabled_features(r[10] if len(r)>10 else ''),
                                      key=lambda k:EQUIPMENT_FEATURE_KEYS.index(k)),
            # 使う入力内容（§9.392）。**並びは語彙の順**——保存値の書き順に
            # 引きずられると、画面の札が設備ごとに違う順で並ぶ。
            'disabledMeasureItems':[k for k in MEASURE_ITEM_KEYS
                                    if k in equipment_disabled_measure_items(
                                      r[11] if len(r)>11 else '')]}
           for r in rows]
  return jsonify(ok=True,items=items,table=EQUIPMENT_MASTER_TABLE,created=not before,empty=len(items)==0,
                 stripLimit=STRIP_LIMIT,defaultMaxStrips=DEFAULT_MAX_STRIPS,
                 standardMinutesMax=STANDARD_MINUTES_MAX,
                 maxLineSpeedMax=MAX_LINE_SPEED_MAX,
                 equipmentKinds=list(EQUIPMENT_KINDS),
                 # 機能の語彙は**サーバーが答える**（§9.163）——画面へ写すと、
                 # 機能を1つ足したときに直す場所が2つになる。
                 equipmentFeatures=[{'key':k,'label':l,'note':n,
                                     'off':EQUIPMENT_FEATURE_EFFECTS.get(k,('',''))[0],
                                     'keep':EQUIPMENT_FEATURE_EFFECTS.get(k,('',''))[1]}
                                    for k,l,n in EQUIPMENT_FEATURES],
                 # 入力内容の語彙も**サーバーが答える**（§9.163）。
                 measureItems=[{'key':k,'label':l,'note':n} for k,l,n in MEASURE_ITEMS],
                 # 外したら何が起き、何が残るか（§9.542 効き先の図）。
                 measureItemEffect={'feature':MEASURE_ITEM_FEATURE,'off':MEASURE_ITEM_EFFECT[0],'keep':MEASURE_ITEM_EFFECT[1]},
                 master_path=str(path))
 except Exception as e:return jsonify(error=f'設備マスタ読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master')
def equipment_master_register():
 try:
  x=body({'disabledFeatures': any_, 'disabledMeasureItems': any_, 'kind': any_,
          'maxLineSpeed': any_, 'maxStrips': any_,
          'name': any_, 'reuseExisting': any_, 'standardMinutes': any_});name=x.text('name');uid=request_user_id(x)
  # reuseExisting: True=同じ設備として復元/False=別の新しい設備として登録/
  # 未指定(None)=無効化された同名設備があれば選択を求める(下記参照)。
  reuse_existing=x.get('reuseExisting')
  # **断りは400で、そのまま画面へ出す文で返す**（§CLAUDE 4）。
  # DBを触る前に見る——書いてから戻すと、失敗した設定が一瞬効く。
  try:_measure_items_off(x.get('disabledMeasureItems'))
  except ValueError as _e:return jsonify(error=str(_e)),400
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
    _insert_equipment(cur,name,x,order,uid)
    c.commit()
    return jsonify(ok=True,name=name,registered=True,reused=False,retiredAs=retired_name,retiredReferences=renamed,updated_by=uid,
                    message=f'「{name}」を新しい設備として登録しました。過去の設備は「{retired_name}」として履歴に残ります。')

   # 同名の既存行が無い場合: 通常の新規登録。
   cur.execute('SELECT Max([表示順]) FROM [設備マスタ]');maximum=cur.fetchone()[0];order=int(maximum or 0)+10
   _insert_equipment(cur,name,x,order,uid);c.commit()
   return jsonify(ok=True,name=name,registered=True,reused=False,updated_by=uid,
                   message='設備マスタへ新規登録しました。次回から設備リストに表示されます。')
 except Exception as e:return jsonify(error=f'設備マスタ登録失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master/update')
def equipment_master_update():
 try:
  x=body({'disabledFeatures': any_, 'disabledMeasureItems': any_, 'id': any_, 'kind': any_,
          'maxLineSpeed': any_,
          'maxStrips': any_, 'name': any_, 'standardMinutes': any_});eid=x.get('id');name=x.text('name');uid=request_user_id(x)
  if eid is None:return jsonify(error='更新対象IDがありません。'),400
  # **断りは400で、そのまま画面へ出す文で返す**（§CLAUDE 4）。
  # DBを触る前に見る——書いてから戻すと、失敗した設定が一瞬効く。
  try:_measure_items_off(x.get('disabledMeasureItems'))
  except ValueError as _e:return jsonify(error=str(_e)),400
  if not name:return jsonify(error='設備名を入力してください。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_equipment_master_table(c);cur=c.cursor();cur.execute('SELECT [設備ID],[設備名] FROM [設備マスタ]');rows=cur.fetchall();target=normalize_equipment_name(name)
   dup=next((r for r in rows if normalize_equipment_name(r[1])==target and str(r[0])!=str(eid)),None)
   if dup:return jsonify(error=f'同名の設備が既に存在するため変更できません: {str(dup[1]).strip()}'),409
   current=next((r for r in rows if str(r[0])==str(eid)),None);old_name=str(current[1]).strip() if current and current[1] else ''
   # 最大条数: 空欄は「未設定＝既定値」の意味なのでNULLへ戻す(0を入れない)。
   raw_max=x.text('maxStrips')
   max_strips=None if raw_max=='' else clamp_max_strips(raw_max)
   # 使える機能（§9.302）。**送られてこなければ今の値を残す**——他の画面が
   # 一部だけを送ってきたときに、触っていない設定が黙って消えないように
   # （§9.212 ②と同じ約束）。
   sets=['[設備名]=?','[区分]=?','[最大条数]=?','[標準時間分]=?','[最大ライン速度]=?']
   vals=[name,normalize_equipment_kind(x.get('kind')),max_strips,
         normalize_standard_minutes(x.get('standardMinutes')),
         normalize_max_line_speed(x.get('maxLineSpeed'))]
   # **送られてきた鍵だけ書く**（§9.212 ②）。列が増えても分岐は増やさない
   # ——`if 'A' in x`／`if 'B' in x`の組み合わせでSQLを2の冪だけ書き分けると、
   # 足すたびに書き漏らす（§9.392で2列目を足したときに畳んだ）。
   for key,col,norm in (('disabledFeatures',EQUIPMENT_DISABLED_COLUMN,normalize_equipment_features),
                        ('disabledMeasureItems',MEASURE_ITEM_DISABLED_COLUMN,_measure_items_off)):
    if key in x:
     sets.append(f'[{col}]=?');vals.append(norm(x.get(key)))
   sets+=['[有効]=-1','[更新者ID]=?','[更新日時]=Now()']
   vals+=[uid,eid]
   cur.execute('UPDATE [設備マスタ] SET '+','.join(sets)+' WHERE [設備ID]=?',vals)
   # 設備名は他マスタ(オペレータ設備マスタ・操業データ選択肢マスタ[対象設備]等、
   # equipment_name_references()参照)から
   # 文字列で参照されているため、改名時はそちら側も追従させる(改名連動)。
   renamed=rename_equipment_references(c,old_name,name) if old_name else 0
   c.commit()
  msg='設備名を更新しました。'+(f' 関連する設備参照{renamed}件も追従しました。' if renamed else '')
  return jsonify(ok=True,id=eid,name=name,updated_by=uid,renamedReferences=renamed,message=msg)
 except Exception as e:return jsonify(error=f'設備マスタ更新失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/equipment-master/delete')
@api_guard('設備マスタ削除失敗')
def equipment_master_delete():
 x=body({'force': any_, 'id': any_});eid=x.get('id');uid=request_user_id(x);force=x.flag('force')
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
  # **移行済みの表は無ければ作らない**（§9.255 ①）。在るときだけ片付ける
  #  ——`ensure_operator_equipment_table()`はもう作らないので、
  #  存在を確かめずにDELETEすると、消してある端末で500になる。
  if name and OPERATOR_EQUIPMENT_TABLE in tables(c):
   ensure_operator_equipment_table(c)
   cur.execute('DELETE FROM [オペレータ設備マスタ] WHERE [設備名]=?',[name])
  c.commit()
 return jsonify(ok=True,id=eid,updated_by=uid,referencesCheckFailed=references_check_failed)
