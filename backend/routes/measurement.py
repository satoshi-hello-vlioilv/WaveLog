"""measurement.py: 測定コンテキスト・マスタ診断・バックアップAPI。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, request, jsonify

from ..db_access import DBS, MEAS_DB, qi, connect, cols, tables, ensure_backup_table
from ..masters import read_operator_names, read_spool_names, read_inner_names, read_device_names, ensure_operator_master, ensure_spool_master, ensure_inner_master, ensure_device_master, ensure_operator_equipment, OPERATOR_MASTER_TABLE, SPOOL_MASTER_TABLE, INNER_MASTER_TABLE, DEVICE_MASTER_TABLE

bp=Blueprint('measurement',__name__)

@bp.get('/api/measurement/context')
def measurement_context():
 try:
  lot=request.args.get('lot','').strip();equipment=request.args.get('equipment','').strip()
  result={'quality':[],'operators':[],'inspectors':[],'packers':[],'thickness_gauges':[],'width_gauges':[],'inner_diameters':[],'spools':[],'diagnostics':{'master_path':str(DBS['MASTER']['path']),'master_exists':DBS['MASTER']['path'].exists(),'tables':[],'matches':{}}}
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
  if lot and DBS['SIKALOTDEF']['path'].exists():
   with connect(DBS['SIKALOTDEF']['path'],True) as c:
    ts=tables(c);t=matching_table(ts,['仕掛','品質情報','品質','保留'])
    if t:
     cs=cols(c,t);lot_col=matching_col(cs,['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'])
     if lot_col:
      cur=c.cursor();cur.execute(f'SELECT TOP 50 * FROM {qi(t)} WHERE CStr({qi(lot_col)})=?',[lot]);rows=cur.fetchall()
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
   with connect(master,True) as c:
    ts=tables(c);result['diagnostics']['tables']=ts
    def read_values(table_aliases,col_aliases,extra=None):
     table=matching_table(ts,table_aliases)
     if not table:return []
     cs=cols(c,table);column=matching_col(cs,col_aliases)
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
    people=read_operator_names(c)
    people_for_equipment=read_operator_names(c,equipment=equipment) if equipment else people
    result['diagnostics']['matches']['オペレータマスタ']={'table':OPERATOR_MASTER_TABLE,'column':'氏名','count':len(people),'filtered_by_equipment':equipment or '','filtered_count':len(people_for_equipment)}
    result['operators']=people_for_equipment;result['inspectors']=people;result['packers']=people
    # 読み取りは機器マスタ（測定区分・有効・表示順）から行う。
    thickness_gauges=read_device_names(c,'板厚');width_gauges=read_device_names(c,'板幅')
    result['diagnostics']['matches']['機器マスタ']={'table':DEVICE_MASTER_TABLE,'column':'機器名','板厚':len(thickness_gauges),'板幅':len(width_gauges)}
    result['thickness_gauges']=thickness_gauges;result['width_gauges']=width_gauges
    # 読み取りは内径種別マスタ（有効・表示順）から行う。
    inners=read_inner_names(c)
    result['diagnostics']['matches']['内径種別マスタ']={'table':INNER_MASTER_TABLE,'column':'内径種別','count':len(inners)}
    result['inner_diameters']=inners
    # 読み取りはスプール種別マスタ（有効・表示順）から行う。
    spools=read_spool_names(c)
    result['diagnostics']['matches']['スプール種別マスタ']={'table':SPOOL_MASTER_TABLE,'column':'種別名','count':len(spools)}
    result['spools']=spools
  return jsonify(result)
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
   ensure_backup_table(c);cur=c.cursor();cur.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?',[x['id']]);cur.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,Now(),?,?)',[x['id'],x.get('equipment',''),x.get('lotNo',''),x.get('inspectionNo',''),x.get('castingNo',''),x.get('status','編集中'),x.get('codec','delimiter-v1'),x['payload']]);c.commit()
  return jsonify(ok=True,direction='IndexedDB -> records.sqlite3')
 except Exception as e:return jsonify(error=str(e)),500

@bp.get('/api/measurement/backup/list')
def backup_list():
 # PC引継ぎ等でIndexedDBが空の端末へ、db/records.sqlite3(Web測定バックアップ)から
 # インポートするための読み取り専用API。書き込みはせず、行をそのまま返す。
 # 実際のIndexedDBへの反映(JSON解凍・idbPut)はブラウザ側で行う。
 try:
  if not MEAS_DB.exists():return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(MEAS_DB))
  with connect(MEAS_DB,True) as c:
   if 'Web測定バックアップ' not in tables(c):
    return jsonify(ok=True,items=[],count=0,table_exists=False,meas_path=str(MEAS_DB))
   cur=c.cursor()
   cur.execute('SELECT [記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],[圧縮形式],[ペイロード] FROM [Web測定バックアップ] ORDER BY [更新日時] DESC')
   rows=cur.fetchall()
  items=[{'id':str(r[0] or ''),'equipment':str(r[1] or ''),'lotNo':str(r[2] or ''),'inspectionNo':str(r[3] or ''),'castingNo':str(r[4] or ''),'status':str(r[5] or ''),'updated_at':r[6].isoformat() if r[6] else None,'codec':str(r[7] or ''),'payload':str(r[8] or '')} for r in rows]
  return jsonify(ok=True,items=items,count=len(items),table_exists=True,meas_path=str(MEAS_DB))
 except Exception as e:return jsonify(error=f'測定データ読込失敗: {e}',meas_path=str(MEAS_DB)),500
