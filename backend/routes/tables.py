"""tables.py: 汎用DB一覧API — カタログ/テーブル一覧/データ取得(フィルタ・検索・並替)。

app.pyから移設(Phase 3)。接続先は全てSQLite(Access接続は廃止)。

SQL方言について: 検索・フィルタで使うCStr()/Val()はAccess方言のSQL関数で
SQLiteには無いため、db_access.pyのconnect()がユーザー定義関数として登録して
吸収している。またVal()経由の数値範囲フィルタ(gt/gte/lt/lte)は、SQLiteが値の
ストレージクラス優先で比較する仕様のため、パラメータ側もPythonで数値化してから
渡す(そうしないとVal()が返す数値と文字列パラメータの比較が常に不成立になる)。
"""
import json, re, unicodedata
from flask import Blueprint, request, jsonify

from ..db_access import DBS, qi, connect, cols, tables, cfg, WORK_DB_KEY, QUALITY_DB_KEY
from ..logging_setup import app_logger
from ..errors import os_error_hint
from ..repositories.master_repo import hidden_columns_for_db

# 品質データ結合のIN句を小分けにする単位(パラメータ数の上限対策)。
_JOIN_IN_CHUNK=100

bp=Blueprint('tables',__name__)

def _numeric_value(value):
 # SQLiteのVal(?)相当。先頭の数値部分を取り出す(見つからなければ0)。
 m=re.match(r'^\s*[+-]?\d+(\.\d+)?',str(value or ''))
 return float(m.group(0)) if m else 0.0

# ========================================================================
# 品質データの結合表示(§9.21新設): スケジュールモードの仕掛一覧(分割/
# ポップアップ表示)だけで、ロット番号+鋳造番号+製造材質をキーに品質データ
# (SIKALOTDEF)を突合し、列をアプリ側でマージする。SIKALOTNOWとSIKALOTDEFは
# 別々の接続先(CLAUDE.mdの接続先の節を参照)のため、単一
# のSQL JOINでは書けず、ここでPython側で結合する。既定のSIKALOTNOW単独表示
# には一切影響しないよう、明示的なjoin_quality=1指定時のみ動く(オプトイン)。
# ========================================================================
_JOIN_KEY_ALIASES={
 'lotNo':['ロット番号','ﾛｯﾄ番号','ロット№','LTNO'],
 'castingNo':['鋳造番号','ﾁｭｳｿﾞｳ番号','CYNO'],
 'mfgMaterial':['製造材質','ﾒｲｿﾞｳ材質','LTA'],
}
def _norm_name(s):
 # 全角/半角・大小文字のゆれを吸収して比較する(CLAUDE.md「フィールド名」)。
 return unicodedata.normalize('NFKC',str(s or '')).strip().lower()
def _find_column(columns,aliases):
 """列名の別名解決。完全一致 → 正規化一致 → 部分一致の順に探す。
 部分一致は誤爆(例: 別名'LTNO'が'PLTNO'に一致)しやすいので最後の手段。"""
 for a in aliases:
  if a in columns:return a
 norm={_norm_name(c):c for c in columns}
 for a in aliases:
  hit=norm.get(_norm_name(a))
  if hit:return hit
 for c in columns:
  if any(_norm_name(a) in _norm_name(c) for a in aliases):return c
 return None
def _norm_value(v):
 # 突合キーの値も同様にゆれを吸収する(前後空白・全角半角)。
 return unicodedata.normalize('NFKC',str(v if v is not None else '')).strip()

def _quality_key_table(c,def_cfg):
 """品質データ側で「3つのキー列がすべて揃っているテーブル」を選ぶ。
 以前はpreferred(既定'仕掛')が無ければ先頭テーブルを無条件に使っていたため、
 キー列を持たない別のテーブルを掴んで黙って結合を諦めることがあった。"""
 names=tables(c)
 if not names:return None,None,None
 ordered=([def_cfg['preferred']] if def_cfg.get('preferred') in names else [])+[n for n in names if n!=def_cfg.get('preferred')]
 for t in ordered:
  try:cs=cols(c,t,source=def_cfg['path'])
  except Exception:continue
  k=[_find_column(cs,_JOIN_KEY_ALIASES[x]) for x in ('lotNo','castingNo','mfgMaterial')]
  if all(k):return t,cs,k
 return None,None,None

def _join_quality_data(sikalotnow_cols,row_dicts):
 """戻り値: (結合後の列名リスト, 結合後の行dictリスト, 診断情報dict)。
 重複する列名は仕掛(SIKALOTNOW)側の値を優先する(現在値としての信頼度が
 高い運用のため)。品質データ側が未接続・キー列が見つからない・接続に失敗
 した場合は何もせず素通しする(fail-open、通常の仕掛一覧表示自体は壊さない)が、
 **なぜ結合できなかったのかを必ず診断情報として返す**。以前はすべての失敗を
 黙って握り潰していたため、「結合されない」という報告に対して原因が
 画面にもログにも一切出ず切り分けができなかった。"""
 info={'applied':False,'reason':'','matched':0,'addedColumns':0}
 lot_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['lotNo'])
 cast_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['castingNo'])
 mat_col=_find_column(sikalotnow_cols,_JOIN_KEY_ALIASES['mfgMaterial'])
 missing=[n for n,v in (('ロット番号',lot_col),('鋳造番号',cast_col),('製造材質',mat_col)) if not v]
 if missing:
  info['reason']=f'仕掛一覧側に突合キーの列が見つかりません: {"・".join(missing)}'
  return sikalotnow_cols,row_dicts,info
 def key_of(d):
  return (_norm_value(d.get(lot_col)),_norm_value(d.get(cast_col)),_norm_value(d.get(mat_col)))
 keys=[key_of(d) for d in row_dicts]
 lot_values=sorted({k[0] for k in keys if k[0]})
 if not lot_values:
  info['reason']='表示中の行にロット番号がありません'
  return sikalotnow_cols,row_dicts,info
 # 品質データがどのデータソースかは役割で決まる(§9.87)。キーは利用者が
 # 自由に付けられるので、'SIKALOTDEF'という文字列で探さないこと。
 def_cfg=DBS.get(QUALITY_DB_KEY or '')
 if not def_cfg:
  info['reason']=('役割が「品質」のデータソースが登録されていません。'
                  'マスタ管理 > データソースで役割を選んでください。')
  return sikalotnow_cols,row_dicts,info
 try:
  if not def_cfg['path'].exists():
   info['reason']=f'品質データのファイルが見つかりません: {def_cfg["path"]}'
   app_logger().warning('品質データ結合: %s',info['reason'])
   return sikalotnow_cols,row_dicts,info
  with connect(def_cfg['path'],True) as c:
   t,def_cols,(d_lot,d_cast,d_mat)=_quality_key_table(c,def_cfg)
   if not t:
    info['reason']='品質データ側に突合キー(ロット番号・鋳造番号・製造材質)が揃ったテーブルが見つかりません'
    app_logger().warning('品質データ結合: %s (%s)',info['reason'],def_cfg['path'])
    return sikalotnow_cols,row_dicts,info
   # ロット番号だけでSQL側を軽く絞り、鋳造番号・製造材質の正確な一致は
   # Python側で行う(複合IN条件はSQLで書きにくいため)。
   # INのパラメータ数が多いと失敗するため小分けにする。
   quality_index={};cur=c.cursor()
   for i in range(0,len(lot_values),_JOIN_IN_CHUNK):
    chunk=lot_values[i:i+_JOIN_IN_CHUNK]
    placeholders=','.join('?' for _ in chunk)
    cur.execute(f'SELECT * FROM {qi(t)} WHERE CStr({qi(d_lot)}) IN ({placeholders})',chunk)
    for row in cur.fetchall():
     dd=dict(zip(def_cols,row))
     qkey=(_norm_value(dd.get(d_lot)),_norm_value(dd.get(d_cast)),_norm_value(dd.get(d_mat)))
     if qkey in quality_index:continue  # 同一キーが複数行あれば最初の1件のみ使う
     quality_index[qkey]=dd
 except Exception as e:
  info['reason']=f'品質データへ接続できません: {e}'
  app_logger().warning('品質データ結合に失敗しました: %s',e)
  return sikalotnow_cols,row_dicts,info
 extra_cols=[c for c in def_cols if c not in sikalotnow_cols]
 merged_rows=[];matched=0
 for d,key in zip(row_dicts,keys):
  qd=quality_index.get(key)
  if qd:matched+=1
  merged=dict(qd) if qd else {}
  merged.update(d)  # 重複列は仕掛(SIKALOTNOW)側を優先
  merged_rows.append(merged)
 info.update(applied=True,matched=matched,addedColumns=len(extra_cols),table=t)
 if not matched:
  info['reason']=f'キーが一致する品質データがありませんでした(照合先: {t})'
 return sikalotnow_cols+extra_cols,merged_rows,info


def _error_hint(e):
 """画面へ出す一言の手がかり。原因の切り分けを現地でできるようにする。
    文面は backend/errors.py が全経路ぶんを持っているので、そこから借りる
    (同じ現象に2種類の説明が出ると、どちらが正しいのか分からなくなる)。"""
 hint=os_error_hint(e)
 if isinstance(e,FileNotFoundError):
  return 'マスタ管理 > パス設定 で指定したファイルが見つかりません。パスを確認し、サーバーを再起動してください。'
 return hint

@bp.get('/api/db-diagnose')
def api_db_diagnose():
 """DBを開くまでの各段階を順に試して、どこで失敗するかを返す(§9.75)。

 別端末でだけ起きる接続不良は、エラーメッセージだけでは
 「パスの解決」「存在確認(os.stat)」「実際の接続」のどれで転んだのか
 分からない。ブラウザでこのURLを開けば、その端末で1つずつ確かめられる。
 読むだけで、設定は一切変更しない。"""
 k=request.args.get('db','SIKALOTNOW')
 out={'db':k,'steps':[]}
 def step(name,fn):
  try:
   out['steps'].append({'name':name,'ok':True,'value':str(fn())})
   return True
  except Exception as ex:
   out['steps'].append({'name':name,'ok':False,
                        'error':f'{type(ex).__name__}: {ex}',
                        'winerror':getattr(ex,'winerror',None)})
   return False
 try:
  cf=cfg(k)
 except Exception as ex:
  out['steps'].append({'name':'DB名の解決','ok':False,'error':str(ex)})
  return jsonify(out),200
 path=cf['path']
 out['path']=str(path)
 out['is_absolute']=path.is_absolute()
 out['is_unc']=str(path).startswith('\\\\')
 step('親フォルダの存在確認 (Path.exists)',lambda:path.parent.exists())
 step('ファイルの存在確認 (Path.exists / os.stat)',lambda:path.exists())
 step('サイズ・更新時刻 (Path.stat)',lambda:path.stat().st_size)
 step('パスの正規化 (Path.resolve)',lambda:path.resolve())
 step('読み取りで1バイト開く (open)',lambda:open(path,'rb').read(1) and 'OK')
 uri=[None]
 def build_uri():
  from ..db_access import _sqlite_ro_uri
  uri[0]=_sqlite_ro_uri(path);return uri[0]
 step('接続URIの組み立て',build_uri)
 def open_db():
  with connect(path,cf['role']=='readonly') as c:
   return f"テーブル{len(tables(c))}件"
 step('SQLiteへ接続してテーブル一覧を取得',open_db)
 out['ok']=all(s.get('ok') for s in out['steps'])
 return jsonify(out),200

@bp.get('/api/catalog')
def catalog():
 # purpose(役割)まで返す。画面はキーの文字列ではなくこれで「作業対象の
 # 一覧か/品質データか」を判断する(§9.87)。
 return jsonify(databases=[{"key":k,"label":v['label'],"file_name":v['path'].name,
                            "role":v['role'],"purpose":v.get('purpose') or ''}
                           for k,v in DBS.items()],
                workKey=WORK_DB_KEY,qualityKey=QUALITY_DB_KEY)
@bp.get('/api/tables')
def api_tables():
 k=request.args.get('db','')
 try:
  cf=cfg(k)
  with connect(cf['path'],cf['role']=='readonly') as c: a=tables(c)
  if cf['preferred'] in a:a=[cf['preferred']]+[x for x in a if x!=cf['preferred']]
  return jsonify(tables=a)
 except Exception as e:
  # **必ずtracebackをログへ残す**。以前はstr(e)だけを返しており、別端末で
  # 「[WinError 59] 予期しないネットワークエラー」とパスだけが画面に出て、
  # どの行から出たのか(存在確認なのか接続なのか)を現地で切り分けられなかった。
  app_logger().exception('/api/tables db=%s で失敗しました',k)
  return jsonify(error=str(e),db=k,hint=_error_hint(e)),500
@bp.get('/api/table')
def api_table():
 try:
  k=request.args['db'];t=request.args['table'];page=max(1,int(request.args.get('page',1)));size=min(500,max(50,int(request.args.get('page_size',200))));q=request.args.get('search','').strip();cf=cfg(k)
  filter_payload=request.args.get('filters','').strip()
  def safe_filters(text,columns):
   if not text:return []
   try:items=json.loads(text)
   except Exception:return []
   if not isinstance(items,list):return []
   allowed_ops={'contains','not_contains','eq','neq','starts','ends','gt','gte','lt','lte','empty','not_empty'}
   out=[]
   for item in items[:20]:
    if not isinstance(item,dict):continue
    col=str(item.get('column') or '').strip();op=str(item.get('op') or 'contains').strip();value=str(item.get('value') or '').strip()
    if col in columns and op in allowed_ops:out.append({'column':col,'op':op,'value':value})
   return out
  def build_filter_where(filters):
   parts=[];params=[]
   for f in filters:
    col=qi(f['column']);op=f['op'];value=f['value']
    if op=='contains':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}%')
    elif op=='not_contains':parts.append(f'(CStr({col}) NOT LIKE ? OR {col} IS NULL)');params.append(f'%{value}%')
    elif op=='eq':parts.append(f'CStr({col})=?');params.append(value)
    elif op=='neq':parts.append(f'(CStr({col})<>? OR {col} IS NULL)');params.append(value)
    elif op=='starts':parts.append(f'CStr({col}) LIKE ?');params.append(f'{value}%')
    elif op=='ends':parts.append(f'CStr({col}) LIKE ?');params.append(f'%{value}')
    elif op=='empty':parts.append(f'({col} IS NULL OR CStr({col})=\'\')')
    elif op=='not_empty':parts.append(f'({col} IS NOT NULL AND CStr({col})<>\'\')')
    elif op in ('gt','gte','lt','lte'):
     sign={"gt":'>',"gte":'>=',"lt":'<',"lte":'<='}[op]
     parts.append(f'Val(CStr({col})) {sign} ?')
     # SQLiteは値の型(ストレージクラス)優先で比較するため、REALを返す
     # Val()の結果と文字列パラメータを比べると常にREAL<TEXT扱いで不成立に
     # なる。パラメータ側もこちらで数値化してから渡す。
     params.append(_numeric_value(value))
   return parts,params
  with connect(cf['path'],cf['role']=='readonly') as c:
   cs=cols(c,t,source=cf['path']);where_parts=[];params=[]
   if q:
    where_parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params += [f'%{q}%']*len(cs)
   filters=safe_filters(filter_payload,cs);fp,filter_params=build_filter_where(filters);where_parts += fp;params += filter_params
   where=(' WHERE '+' AND '.join(where_parts)) if where_parts else ''
   sort_col=request.args.get('sort','').strip();sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
   order=f' ORDER BY {qi(sort_col)} {sort_dir}' if sort_col in cs else ''
   cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {qi(t)}'+where,params);count=int(cur.fetchone()[0]);top=page*size
   # 件数の頭からtop件を取り、Python側でページ分だけ切り出す(rows[start:start+size])。
   cur.execute(f'SELECT * FROM {qi(t)}'+where+order+f' LIMIT {top}',params)
   rows=cur.fetchmany(top);start=(page-1)*size;rows=rows[start:start+size]
  # 表示マスタで非表示指定された列は、検索/絞込/並替の対象(cs)には残しつつ、
  # 返却するcolumns/rowsからのみ除外する(生の行タプルはcs全体の順序と対応するため、
  # zip自体はcs全体で行い、その後に非表示列をdictから取り除く)。
  # include_hidden=1が指定された場合は除外しない。一覧の表示設定はあくまで
  # 画面上の見た目の好みであり、条割(分割)機能など内部計算が特定の列の
  # 実データに依存する場面では、非表示設定によってデータ自体が欠落しては
  # ならないため(一覧を出す通常のリクエストでは指定しない)。
  hidden=set() if request.args.get('include_hidden')=='1' else hidden_columns_for_db(k)
  row_dicts=[dict(zip(cs,r)) for r in rows]
  visible_cs=[x for x in cs if x not in hidden] if hidden else cs
  if hidden:row_dicts=[{col:v for col,v in d.items() if col not in hidden} for d in row_dicts]
  join_info=None
  # 結合できるのは役割が「作業」の一覧だけ(§9.87)。
  if WORK_DB_KEY and k==WORK_DB_KEY and request.args.get('join_quality')=='1':
   visible_cs,row_dicts,join_info=_join_quality_data(visible_cs,row_dicts)
  return jsonify(columns=visible_cs,rows=row_dicts,count=count,filters_applied=len(filters),joinQuality=join_info)
 except Exception as e:return jsonify(error=str(e)),500
