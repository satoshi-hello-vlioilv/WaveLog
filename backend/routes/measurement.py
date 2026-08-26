"""measurement.py: 測定コンテキスト・マスタ診断・バックアップAPI。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, request, jsonify

from ..db_access import DBS, MEAS_DB, RECORDS_BACKUP_EXPORT_PATH, qi, connect, cols, tables, ensure_backup_table, read_backup_rows, invalidate_backup_rows_cache, request_user_id, request_pc_name, QUALITY_DB_KEY, path_exists_safe
# 選択肢の読み取りは §9.221 ③ で op.choice_values() の1本になった。
# **読み取り関数と表名の定数は import ごと外す**——残すと grep で
# read_operator_names が今もここに当たり、廃止した経路が現役だと誤読される
# (§9.87 で「同じ判定が2箇所に散って実際に壊れた」のと同じ入口)。
# ensure_* は /api/measurement/diagnose が今も表の作成を確かめるので残る。
from ..repositories.master_repo import ensure_operator_master, ensure_spool_master, ensure_inner_master, ensure_device_master, ensure_operator_equipment
from ..repositories.master_repo import ensure_burr_master, ensure_coil_stop_master
from ..repositories.master_repo import read_equipment_max_strips, read_equipment_kind, STRIP_LIMIT, DEFAULT_MAX_STRIPS
from ..repositories.master_repo import choice_usage_for, choice_usage_bump
from .. import records_export
from ..logging_setup import app_logger

bp=Blueprint('measurement',__name__)

@bp.get('/api/measurement/context')
def measurement_context():
 try:
  lot=request.args.get('lot','').strip();equipment=request.args.get('equipment','').strip()
  result={'quality':[],'operators':[],'inspectors':[],'packers':[],'thickness_gauges':[],'width_gauges':[],'inner_diameters':[],'spools':[],'burr_types':[],'coil_stops':[],'max_strips':DEFAULT_MAX_STRIPS,'strip_limit':STRIP_LIMIT,'equipment_kind':'','diagnostics':{'master_path':str(DBS['MASTER']['path']),'master_exists':DBS['MASTER']['path'].exists(),'tables':[],'matches':{}}}
  def norm(v):return str(v or '').strip()
  def matching_table(ts,aliases):
   for a in aliases:
    if a in ts:return a
   for t in ts:
    if any(a.lower() in t.lower() for a in aliases):return t
   return None
  def matching_col(cs,aliases):
   for a in aliases:
    if a in cs:return a
   for c in cs:
    if any(a.lower() in c.lower() for a in aliases):return c
   return None
  # 品質データは役割で引く(§9.87)。キーの綴りで探すと、マスタでキーを
  # 変えた端末で KeyError になり測定画面ごと開けなくなる。
  qcfg=DBS.get(QUALITY_DB_KEY or '') or {}
  qpath=qcfg.get('path')
  if lot and qpath and qpath.exists():
   with connect(qpath,True) as c:
    ts=tables(c);t=matching_table(ts,['仕掛','品質情報','品質','保留'])
    if t:
     cs=cols(c,t,source=qpath);lot_col=matching_col(cs,['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'])
     if lot_col:
      cur=c.cursor()
      cur.execute(f'SELECT * FROM {qi(t)} WHERE CStr({qi(lot_col)})=? LIMIT 50',[lot])
      rows=cur.fetchall()
      for row in rows:
       d=dict(zip(cs,row));result['quality'].append({k:norm(d.get(matching_col(cs,[k]) or k)) for k in ['発生設備','登録日時','異常内容','コメント','最終処置','保留設定日','保留解除']})
  master=DBS['MASTER']['path']
  if master.exists():
   # オペレータマスタの存在を保証してから読み取る。
   try:
    created=ensure_operator_master(master);result['diagnostics']['operator_master']={'created':created}
   except Exception as _e:result['diagnostics']['operator_master_error']=str(_e)
   # オペレータ設備マスタ（オペレータ×設備の割当）の存在を保証してから読み取る。
   try:
    oe_created=ensure_operator_equipment(master);result['diagnostics']['operator_equipment_master']={'created':oe_created}
   except Exception as _e:result['diagnostics']['operator_equipment_master_error']=str(_e)
   # スプール種別マスタの存在を保証してから読み取る。
   try:
    s_created=ensure_spool_master(master);result['diagnostics']['spool_master']={'created':s_created}
   except Exception as _e:result['diagnostics']['spool_master_error']=str(_e)
   # 内径種別マスタの存在を保証してから読み取る。
   try:
    i_created=ensure_inner_master(master);result['diagnostics']['inner_master']={'created':i_created}
   except Exception as _e:result['diagnostics']['inner_master_error']=str(_e)
   # 機器マスタの存在を保証してから読み取る。
   try:
    d_created=ensure_device_master(master);result['diagnostics']['device_master']={'created':d_created}
   except Exception as _e:result['diagnostics']['device_master_error']=str(_e)
   # バリ揃え・コイル止めマスタ（作成時に既定の選択肢を種として入れる）。
   try:
    b_created=ensure_burr_master(master);result['diagnostics']['burr_master']={'created':b_created}
   except Exception as _e:result['diagnostics']['burr_master_error']=str(_e)
   try:
    cs_created=ensure_coil_stop_master(master);result['diagnostics']['coil_stop_master']={'created':cs_created}
   except Exception as _e:result['diagnostics']['coil_stop_master_error']=str(_e)
   # ---------- 選択肢は操業データ選択肢マスタの1本から引く(§9.221 ③) ----------
   # 利用者の指示「オペレータ、機器、スプール種別、内径種別、バリ揃え、
   # コイル止めについても汎用化した操業データ項目マスタに移行させて」。
   # **読むのは下の読み取り専用ブロック**なので、表と列をそろえ、6つの
   # マスタを1度だけ写すのはここ（上の`ensure_*`と同じ置き方）。
   try:
    from ..repositories import operation_repo as op
    result['diagnostics']['operation_choices']=op.ensure_operation_choices(master)
   except Exception as _e:result['diagnostics']['operation_choices_error']=str(_e)
   with connect(master,True) as c:
    ts=tables(c);result['diagnostics']['tables']=ts
    def read_values(table_aliases,col_aliases,extra=None):
     table=matching_table(ts,table_aliases)
     if not table:return []
     cs=cols(c,table,source=master);column=matching_col(cs,col_aliases)
     result['diagnostics']['matches']['/'.join(table_aliases)]={'table':table,'column':column,'columns':cs}
     if not column:return []
     sql=f'SELECT DISTINCT {qi(column)} FROM {qi(table)}';params=[];where=[]
     # VBAは設備=FaciNameだが、Webでは仕掛の設備文字列が複合値の場合があるため、完全一致で0件なら全件へフォールバック
     if equipment:
      equip_col=matching_col(cs,['設備','設備名','対象設備'])
      if equip_col:where.append(f'(CStr({qi(equip_col)})=? OR CStr({qi(equip_col)}) LIKE ?)');params += [equipment,f'%{equipment}%']
     if extra:
      for aliases,value in extra:
       col=matching_col(cs,aliases)
       if col:where.append(f'CStr({qi(col)})=?');params.append(value)
     cur=c.cursor()
     query=sql+(' WHERE '+' AND '.join(where) if where else '')
     cur.execute(query,params);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     if not values and where:cur.execute(sql);values=[norm(r[0]) for r in cur.fetchall() if norm(r[0])]
     return sorted(set(values),key=str.casefold)
    # 読み取りはオペレータマスタ（有効・表示順）から行う。
    # オペレータ欄のみ、対象設備（equipment）で作業可能設備によるフィルタをかける。
    # 割当が1件もないオペレータは常に表示対象（互換ポリシー）。検査員・梱包員は従来通り全件。
    # ---------- 選択肢は「まとまり名」で引く(§9.221 ③) ----------
    # 以前はオペレータ／機器／内径／スプール／バリ揃え／コイル止めの6つが
    # それぞれ専用の表と専用の読み取り関数を持っていた（同じことを6箇所）。
    # いまは`操業データ選択肢マスタ`の**まとまり名が違うだけ**で、読み口は
    # `op.choice_values()`の1本。設備の絞り込み（オペレータの作業可能設備）は
    # `[対象設備]`が空＝すべて、という約束でそのまま引き継いでいる。
    from ..repositories import operation_repo as op
    # **どのまとまりを見るかもマスタが決める**(§9.221 ③)。組み込みの欄の
    # `[選択肢名]`が答えるので、現場が別のまとまりへ向け替えられる。
    gname=lambda key:op.builtin_choice_name(c,key)
    people=op.choice_values(c,gname('operator'))
    people_for_equipment=(op.choice_values(c,gname('operator'),equipment=equipment)
                          if equipment else people)
    result['diagnostics']['matches']['操業データ選択肢マスタ']={
      'table':op.CHOICE_TABLE,'オペレータ':len(people),
      'filtered_by_equipment':equipment or '','filtered_count':len(people_for_equipment)}
    result['operators']=people_for_equipment
    # **検査員は設備で絞らない**（今までどおり全員）。
    result['inspectors']=people;result['packers']=people
    thickness_gauges=op.choice_values(c,gname('thicknessGauge'))
    width_gauges=op.choice_values(c,gname('widthGauge'))
    result['thickness_gauges']=thickness_gauges;result['width_gauges']=width_gauges
    inners=op.choice_values(c,gname('innerDiameter'))
    result['inner_diameters']=inners
    spools=op.choice_values(c,gname('spool'))
    result['spools']=spools
    burrs=op.choice_values(c,gname('burr'));coil_stops=op.choice_values(c,gname('coilStop'))
    result['diagnostics']['matches']['操業データ選択肢マスタ'].update({
      '板厚測定器':len(thickness_gauges),'板幅測定器':len(width_gauges),
      '内径':len(inners),'スプール':len(spools),
      'バリ揃え':len(burrs),'コイル止め':len(coil_stops)})
    result['burr_types']=burrs;result['coil_stops']=coil_stops
    # この設備で割れる最大条数(設備マスタ。未登録なら既定)。分割の上限確認と
    # 横割数の入力上限に使う。
    result['max_strips']=read_equipment_max_strips(c,equipment)
    result['diagnostics']['matches']['設備マスタ_最大条数']={'equipment':equipment,'value':result['max_strips'],'limit':STRIP_LIMIT}
    # 設備の区分(コイル／板)。板丈の公差は板の設備でだけ意味を持つため
    # (§9.157)。未設定は''で返し、画面側は「板」と決め付けない。
    result['equipment_kind']=read_equipment_kind(c,equipment)
    result['diagnostics']['matches']['設備マスタ_区分']={'equipment':equipment,'value':result['equipment_kind']}
    # 設備ごとの使用回数(§9.133)。**ここへ相乗りさせる**——選択肢を並べる
    # ためだけに往復を増やさない(選択肢そのものと同時に要るデータなので、
    # 別のAPIにすると「選択肢は出たが並びは前のまま」という瞬間ができる)。
    result['choice_usage']=choice_usage_for(c,equipment)
  return jsonify(result)
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/choice-usage')
def measurement_choice_usage():
 """準備で選んだ値の使用回数を1つ増やす(§9.133)。

 オペレータは実データで171人おり、五十音順のままだと「いつもの人」を毎回
 探すことになる。設備ごとに数えて、よく使うものを上へ並べるための記録。
 **選ばれた瞬間に数える**(保存まで待たない)——同じ人を選び直しただけでも
 使ったことに変わりはなく、待つと「今日はまだ上に来ない」が起きる。

 画面は結果を待たないので、失敗しても測定は止めない(数が1つ増えないだけ)。
 """
 try:
  x=request.get_json(force=True) or {}
  equipment=str(x.get('equipment') or '').strip()
  picks=x.get('picks') or {}
  if not equipment:return jsonify(error='設備名を指定してください。'),400
  if not isinstance(picks,dict):return jsonify(error='picksはオブジェクトで指定してください。'),400
  with connect(DBS['MASTER']['path']) as c:
   n=choice_usage_bump(c,equipment,picks,str(x.get('user_id') or ''))
  return jsonify(ok=True,counted=n)
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/master-diagnostics')
def master_diagnostics():
 try:
  p=DBS['MASTER']['path'];out={'path':str(p),'exists':p.exists(),'size':p.stat().st_size if p.exists() else 0,'tables':{}}
  if p.exists():
   with connect(p,True) as c:
    for t in tables(c):out['tables'][t]=cols(c,t)
  return jsonify(out)
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/backup')
def backup():
 try:
  x=request.get_json(force=True);required=['id','lotNo','payload'];missing=[k for k in required if not x.get(k)]
  if missing:return jsonify(error='必須項目不足: '+','.join(missing)),400
  with connect(MEAS_DB) as c:
   ensure_backup_table(c);cur=c.cursor()
   # ---- 誰が・どの端末で入力を始めたか(§9.180) ----
   # **入力を始めた人と端末は上書きしない。** 測定は別のPCで続きを開ける
   # (§9.91)ので、保存のたびに書き換えると「誰が始めたか」が最後に保存した
   # 端末で塗り潰される。1行を作り直す作りなので、**消す前に控えを取る**。
   cur.execute('SELECT [登録者ID],[登録端末名],[登録日時] FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']])
   prev=cur.fetchone() or (None,None,None)
   # 画面が送ってきた値(レコードが持つ「入力を始めた」情報)を最優先し、
   # 次に既存行の値、最後にこの端末の値へ落とす。
   created_by=str(x.get('created_by') or '').strip() or str(prev[0] or '').strip() or request_user_id(x)
   created_pc=str(x.get('created_pc') or '').strip() or str(prev[1] or '').strip() or request_pc_name()
   created_at=str(x.get('created_at') or '').strip() or (prev[2] if prev[2] else None)
   cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']])
   # [更新時刻ISO]は**レコード自身の`updatedAt`**(§9.208 ⑤)。[更新日時]は
   # サーバーが押す現地時刻で、画面が持つUTCのISOとは物差しが違う——
   # 画面側の「新しい版あり」はこちらの列だけで判定する。
   record_updated_at=str(x.get('updated_at_iso') or '').strip()[:40]
   cur.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード],[登録者ID],[登録端末名],[更新者ID],[更新端末名],[登録日時],[更新時刻ISO]) VALUES (?,?,?,?,?,?,Now(),?,?,?,?,?,?,?,?)',
               [x['id'],x.get('equipment',''),x.get('lotNo',''),x.get('inspectionNo',''),x.get('castingNo',''),
                x.get('status','編集中'),x.get('codec','delimiter-v1'),x['payload'],
                # 更新側は**この端末**の名前(引数を渡さない)。画面が送る
                # `pc_name`は「作った端末」の意味で使うので、混ぜない。
                created_by,created_pc,request_user_id(x),request_pc_name(),created_at,record_updated_at])
   c.commit()
  records_export.mark_dirty()
  # 実績バックアップのキャッシュ(§9.41)を捨てる。作業スケジュールの実績突合が
  # 保存直後の測定を必ず拾えるようにするため(署名でも変化は拾えるが、
  # 同一秒内の連続保存を取りこぼさないよう明示的に捨てる)。
  invalidate_backup_rows_cache()
  return jsonify(ok=True,direction='IndexedDB -> records.sqlite3')
 except Exception as e:return jsonify(error=str(e)),500

@bp.post('/api/measurement/backup/delete')
def backup_delete():
 """端末内の測定データを削除したとき、バックアップ(records.sqlite3)からも消す。

 これが無かったため、データ一覧から削除しても[Web測定バックアップ]に行が
 残り続け、作業スケジュールの実績突合(§7.4)がその行を拾って「作業中
 (開始だけで終了が無い)」を出し続けていた。データ一覧には何も無いのに
 スケジュールにだけ作業中が並ぶ、という食い違いの原因(§9.52)。

 複数IDをまとめて渡せる。存在しないIDは無視して成功扱いにする
 (端末側の削除は既に済んでおり、ここで失敗にしても再送で解決しないため)。
 """
 try:
  x=request.get_json(force=True) or {}
  ids=x.get('ids')
  if ids is None:
   one=x.get('id')
   ids=[one] if one else []
  ids=[str(i).strip() for i in ids if str(i or '').strip()]
  if not ids:return jsonify(error='削除対象IDがありません。'),400
  deleted=0
  with connect(MEAS_DB) as c:
   ensure_backup_table(c);cur=c.cursor()
   for rid in ids:
    cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[rid])
    deleted+=cur.rowcount or 0
   c.commit()
  records_export.mark_dirty()
  # 実績突合が次の描画で必ず消えた状態を見るようにする(§9.41のキャッシュ)。
  invalidate_backup_rows_cache()
  return jsonify(ok=True,deleted=deleted,requested=len(ids))
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/backup/summary')
def backup_summary():
 """データ一覧に**他のPCで保存された測定データ**を出すための軽い一覧(§9.91)。

 従来、途中経過は端末内(IndexedDB+localStorage)にしか無く、データ一覧も
 そこだけを読んでいたため、**別のPCからは同じロットの続きが見えなかった**
 (子ロットデータもレコードの中(settings.splitSourcesCache)にあるので同じ)。
 ここは records.sqlite3 の行を**ペイロード抜き**で返す。一覧に出すのに
 必要なのは見出しだけで、中身は開くときに1件だけ取ればよい
 (全件のペイロードを毎回運ぶと、共有越しでは一覧を開くたびに数MBになる)。

 読み取り専用。書き込みは一切しない。
 """
 try:
  items,path=read_backup_rows(MEAS_DB)
  if items is None:return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(path))
  slim=[{k:v for k,v in r.items() if k!='payload'} for r in items]
  return jsonify(ok=True,items=slim,count=len(slim),table_exists=True,meas_path=str(path))
 except Exception as e:
  # 一覧そのものは端末内のデータで出せるので、ここで500にしても画面は壊さない。
  app_logger().warning('/api/measurement/backup/summary で失敗: %s',e)
  return jsonify(error=f'共有データの一覧を読めませんでした: {e}',meas_path=str(MEAS_DB)),500

# ---------------------------------------------------------------------------
# 実績データリスト(§9.241 ③、利用者の指示)
# ---------------------------------------------------------------------------
# 「メインメニューに『実績』のデータをリストとして表示する機能。設備単位で
#  切り替えて対象期間のデータを一覧で確認できる。データ一覧の完了とは別扱いで
#  **閲覧のみ**、作業時に記録した**全データ**を扱える。」
#
# **GETだけ。書き込みは一切しない**ので、閲覧モードでもそのまま読める
# (書込ガードはGETを素通しする・backend/access_mode.py)。判定(現場日・直)は
# `backend/actuals.py`＝サーバーの1箇所が持ち、画面へ写さない(§9.163)。
ACTUALS_LIMIT_DEFAULT=2000

@bp.get('/api/measurement/actuals')
def measurement_actuals():
 from .. import actuals
 try:
  eq=str(request.args.get('equipment') or '').strip()
  frm=str(request.args.get('from') or '').strip()
  to=str(request.args.get('to') or '').strip()
  basis='cal' if str(request.args.get('basis') or '').strip()=='cal' else 'work'
  try:limit=int(request.args.get('limit') or ACTUALS_LIMIT_DEFAULT)
  except Exception:limit=ACTUALS_LIMIT_DEFAULT
  limit=max(1,min(20000,limit))
  items=actuals.rows(equipment=eq,date_from=frm,date_to=to,basis=basis)
  total=len(items)
  # **黙って切らない**(§CLAUDE「no silent caps」)。切ったことと件数を返し、
  # 画面が「期間を狭めてください」と書けるようにする。
  truncated=total>limit
  return jsonify(ok=True,items=items[:limit],count=min(total,limit),total=total,
                 truncated=truncated,limit=limit,basis=basis,
                 # **列の呼び名はサーバーが答える**(§9.163)。画面が英字キーへ
                 # 日本語を当てる表を持つと、項目が増えたときに2箇所直すことになる。
                 lotFields=actuals.lot_fields(),
                 equipment=eq,**{'from':frm,'to':to})
 except Exception as e:
  app_logger().warning('/api/measurement/actuals で失敗: %s',e)
  return jsonify(error=f'実績データを読めませんでした: {e}'),500

@bp.get('/api/measurement/actuals/equipments')
def measurement_actuals_equipments():
 """実績が1件でもある設備。**設備マスタと突き合わせない**——マスタから消した
 設備の実績も見られる必要がある(履歴なので)。"""
 from .. import actuals
 try:
  return jsonify(ok=True,items=actuals.equipments())
 except Exception as e:
  app_logger().warning('/api/measurement/actuals/equipments で失敗: %s',e)
  return jsonify(error=f'設備の一覧を読めませんでした: {e}'),500

@bp.get('/api/measurement/backup/get')
def backup_get():
 """1件だけペイロード込みで返す(§9.91)。他のPCで保存された続きを開くとき、
 その1件だけを取り込むために使う。"""
 rid=str(request.args.get('id') or '').strip()
 if not rid:return jsonify(error='記録IDがありません。'),400
 try:
  items,path=read_backup_rows(MEAS_DB)
  if items is None:return jsonify(ok=True,item=None,table_exists=False,meas_path=str(path))
  hit=next((r for r in items if r.get('id')==rid),None)
  return jsonify(ok=True,item=hit,table_exists=True,meas_path=str(path))
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/backup/list')
def backup_list():
 # PC引継ぎ等でIndexedDBが空の端末へ、db/records.sqlite3(Web測定バックアップ)から
 # インポートするための読み取り専用API。書き込みはせず、行をそのまま返す。
 # 実際のIndexedDBへの反映(JSON解凍・idbPut)はブラウザ側で行う。
 try:
  items,path=read_backup_rows(MEAS_DB)
  if items is None:return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(path))
  return jsonify(ok=True,items=items,count=len(items),table_exists=True,meas_path=str(path))
 except Exception as e:return jsonify(error=f'測定データ読込失敗: {e}',meas_path=str(MEAS_DB)),500

@bp.get('/api/measurement/storage')
def storage_status():
 """測定データの置き場の状態(§9.202、利用者の指示「仕組みを整理して視覚的に」)。

 測定データは3段で持っている。**どれが何なのかを画面が図にできるよう、
 サーバーが分かるぶん(②③)をここでまとめて答える**——以前は設定画面も
 状態表示も無く、「DBへ同期」が何をするボタンなのかも書かれていなかった。

  ① この端末のブラウザ (IndexedDB + localStorageの控え)
     …入力の実体。**サーバーからは見えない**ので、件数は画面側が足す。
  ② この端末のDB       (db/records.sqlite3 ＝ MEAS_DB)
     …保存のたびに送られる。他のPCから続きを開けるのはここ(§9.91)。
  ③ 閲覧用の複製       (records_backup_export_path、Box等)
     …②が変わったら間隔ごとに丸ごと複製。閲覧モードはここを読む。

 読み取り専用。**数えられなかったら null を返す**（0件と言い切らない）。
 """
 out={'ok':True}
 local={'path':str(MEAS_DB),'exists':None,'count':None,'size':None,'lastWriteAt':None,'error':''}
 try:
  local['exists']=path_exists_safe(MEAS_DB)
 except Exception:
  local['exists']=None
 try:
  local['size']=MEAS_DB.stat().st_size
 except OSError:
  pass
 try:
  with connect(MEAS_DB,True) as c:
   cur=c.cursor()
   cur.execute('SELECT COUNT(*),MAX([更新日時]) FROM [Web測定バックアップ]')
   row=cur.fetchone() or (None,None)
   local['count']=row[0]
   local['lastWriteAt']=row[1]
 except Exception as e:
  # 表がまだ無い端末（1件も測定していない）もここへ来る。**失敗にしない**
  # ——設定画面ごと開けなくなるほうが困る。
  local['error']=str(e)
 out['local']=local
 out['export']=records_export.status()
 out['viewMode']={'reads':'export'}
 return jsonify(out)

@bp.post('/api/measurement/backup/export-now')
def backup_export_now():
 """「いま複製する」(§9.202)。間隔を待たずに③を作り直す。

 **押した手応えを必ず返す**——複製先が未設定・失敗のときは理由を返す
 （黙って成功と言わない）。
 """
 st=records_export.status()
 if not st.get('configured'):
  return jsonify(error='複製先が設定されていません。マスタ管理 > 共通設定の「測定データバックアップの閲覧用複製先」を設定して、アプリを再起動してください。'),400
 ok=records_export.export_now()
 st=records_export.status()
 if not ok:
  return jsonify(error=f'複製できませんでした: {st.get("lastError") or "理由は不明です"}',export=st),500
 return jsonify(ok=True,export=st)

@bp.get('/api/measurement/backup/list-view')
def backup_list_view():
 # 閲覧モード用: 追加バックアップ出力先(config/local.jsonの
 # records_backup_export_path、Box等)に複製されたrecords.sqlite3を読む。
 # 未設定の場合はconfigured=falseを返し、フロント側で案内を出す。
 try:
  if RECORDS_BACKUP_EXPORT_PATH is None:
   return jsonify(ok=True,configured=False,items=[],count=0,table_exists=False,meas_path=None)
  items,path=read_backup_rows(RECORDS_BACKUP_EXPORT_PATH)
  if items is None:return jsonify(ok=True,configured=True,items=[],count=0,table_exists=False,meas_path=str(path))
  return jsonify(ok=True,configured=True,items=items,count=len(items),table_exists=True,meas_path=str(path))
 except Exception as e:return jsonify(error=f'閲覧用データ読込失敗: {e}',meas_path=str(RECORDS_BACKUP_EXPORT_PATH)),500
