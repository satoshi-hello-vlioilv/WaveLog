"""tables.py: 汎用DB一覧API — カタログ/テーブル一覧/データ取得(フィルタ・検索・並替)。

app.pyから移設(Phase 3)。接続先は全てSQLite(Access接続は廃止)。

SQL方言について: 検索・フィルタで使うCStr()/Val()はAccess方言のSQL関数で
SQLiteには無いため、db_access.pyのconnect()がユーザー定義関数として登録して
吸収している。またVal()経由の数値範囲フィルタ(gt/gte/lt/lte)は、SQLiteが値の
ストレージクラス優先で比較する仕様のため、パラメータ側もPythonで数値化してから
渡す(そうしないとVal()が返す数値と文字列パラメータの比較が常に不成立になる)。
"""
import json, re, time, unicodedata
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

def _unique_columns(names):
 """列名を一意にする(順序は最初に出てきた位置を残す)。§9.113。

 **画面は列を名前で引く**(見出し・幅・書式・読み替え・並び順のすべてが
 列名を鍵にしている)ので、同じ名前が2つ入った列リストを返すと、そのまま
 見出しもセルも二重に描かれる(実機で「カラムが増殖した」と報告された形)。
 名前が重なりうる出どころは実際にある——品質データ側がビューで、
 元テーブルと同じ名前の列を2つ持っている場合や、`SELECT *`の結果に
 同名の列が並ぶ場合。行はdictなので**どのみち1つしか持てない**(後勝ち)
 のに、列リストだけが2つあると数が食い違う。ここで1回だけ落とす。"""
 seen=set();out=[]
 for n in names or []:
  if n in seen:continue
  seen.add(n);out.append(n)
 return out

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
 # **足した列の名前も返す**(§9.105)。件数だけでは、列の設定画面で
 # 「どれが結合されてきた列か」を見分けられない(利用者が最初に知りたい
 # のは「この項目はどこから来たのか」で、何列増えたかではない)。
 info.update(applied=True,matched=matched,addedColumns=len(extra_cols),
             addedColumnNames=list(extra_cols),table=t)
 if not matched:
  info['reason']=f'キーが一致する品質データがありませんでした(照合先: {t})'
 return _unique_columns(sikalotnow_cols+extra_cols),merged_rows,info


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
 k=request.args.get('db','') or WORK_DB_KEY or 'MASTER'
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
 # 診断できる接続先の一覧も返す。画面(ログ・診断)がここから選択肢を作るので、
 # **データソースを増やしても画面を直さなくてよい**(決め打ちにしない)。
 out['targets']=[{'key':key,'label':(d.get('label') or key),'role':d.get('role','')}
                 for key,d in DBS.items()]
 return jsonify(out),200

@bp.get('/api/db-mirror')
def api_db_mirror():
 """共有DBの写しの状態(§9.89)。いつの写しを読んでいるかを画面へ出す。

 置き換えの再試行の実績(§9.108)も返す。**「たまに」なのか「毎回」なのかは
 数字でしか分からない**ので、回線の揺らぎ(再試行で吸収され、failedは
 増えない)と構造的な問題(failedが積み上がる)を切り分けられるようにする。"""
 from .. import atomic_io, db_mirror, paths
 cache=str(db_mirror.cache_dir())
 return jsonify(ok=True,enabled=db_mirror.enabled(),
                interval_sec=db_mirror.interval_sec(),
                cacheDir=cache,
                # 置き場を手元へ逃がしたか(§9.109)。設定は不要で、
                # **何が起きたかを確かめるためだけ**に返す。
                cacheRelocated=paths.work_dir_relocated(),
                cacheRelocatedReason=paths.work_dir_reason(),
                cacheCloudSync=atomic_io.cloud_sync_hint(cache),
                replaceStats=atomic_io.stats(),
                items=db_mirror.status())

@bp.post('/api/db-mirror/refresh')
def api_db_mirror_refresh():
 """今すぐ写し直す(一覧の「再読込」から呼ぶ)。**待たせない**——
 背景スレッドを起こすだけで、結果は次の取得から反映される。"""
 from .. import db_mirror
 x=request.get_json(silent=True) or {}
 if x.get('wait'):
  return jsonify(ok=True,results=db_mirror.refresh_all(force=bool(x.get('force'))))
 db_mirror.wake()
 return jsonify(ok=True,queued=True)

@bp.get('/api/catalog')
def catalog():
 # purpose(役割)まで返す。画面はキーの文字列ではなくこれで「作業対象の
 # 一覧か/品質データか」を判断する(§9.87)。
 # **`preferred`(既定テーブル)はここから返さない**(§9.93)。往復を1本
 # 減らすために一度返したが、あれは**設定値**で、そのDBに実在するとは
 # 限らない(品質データの既定が「仕掛」のまま、という実例がある)。
 # 実在しないテーブルを開きに行って読み直す羽目になったので、画面側は
 # 「前回**実際に確認した**テーブル一覧」を端末に覚える方式にした。
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
 # 一覧が出るまでの内訳を測って返す(§9.90)。「遅い」という報告に対して、
 # 共有から読んでいるのか・件数の数え上げなのか・結合なのか・単に量が多くて
 # 転送と描画に時間がかかっているのかを、現地で切り分けられるようにする。
 # 測るのは**サーバー側でできるところまで**で、転送と描画は画面側が足す。
 timing={};t0=time.perf_counter()
 def lap(name,since):
  timing[name]=round((time.perf_counter()-since)*1000)
 try:
  k=request.args['db'];t=request.args['table'];page=max(1,int(request.args.get('page',1)));size=min(500,max(50,int(request.args.get('page_size',200))));q=request.args.get('search','').strip();cf=cfg(k)
  filter_payload=request.args.get('filters','').strip()
  def safe_filters(text,columns):
   if not text:return []
   try:items=json.loads(text)
   except Exception:return []
   if not isinstance(items,list):return []
   allowed_ops={'contains','not_contains','eq','neq','starts','starts_any','ends','gt','gte','lt','lte','empty','not_empty'}
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
    elif op=='starts_any':
     # 「この先頭のどれかで始まる」(§9.94)。仕掛一覧の行ごとの追い判定は
     # 先頭5桁の一族を引くが、1ページに数十の先頭が並ぶため1件ずつ引くと
     # 往復が数十本になる。まとめて1回で引けるようにする。
     vals=[x for x in (value.split(',') if value else []) if x][:60]
     if not vals:parts.append('0=1')
     else:
      parts.append('('+' OR '.join(f'CStr({col}) LIKE ?' for _ in vals)+')')
      params += [f'{v}%' for v in vals]
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
  t_open=time.perf_counter()
  with connect(cf['path'],cf['role']=='readonly') as c:
   lap('open',t_open)
   t_cols=time.perf_counter()
   cs=cols(c,t,source=cf['path']);lap('cols',t_cols)
   where_parts=[];params=[]
   if q:
    where_parts.append('('+' OR '.join(f'CStr({qi(x)}) LIKE ?' for x in cs)+')');params += [f'%{q}%']*len(cs)
   filters=safe_filters(filter_payload,cs);fp,filter_params=build_filter_where(filters);where_parts += fp;params += filter_params
   where=(' WHERE '+' AND '.join(where_parts)) if where_parts else ''
   # 並び順は複数キーを受け付ける(§9.88)。sorts=[{"column":..,"dir":"asc"}..]
   # のJSON。従来の sort / sort_dir (1列)も引き続き使える(見出しクリック)。
   # **実在する列だけを通す**(cs との照合)。qi()で括ってはいるが、そもそも
   # 列名を組み立てに使う箇所なので、素性の分かるものだけに絞る。
   order_parts=[]
   raw_sorts=request.args.get('sorts','').strip()
   if raw_sorts:
    try:items=json.loads(raw_sorts)
    except Exception:items=[]
    for it in (items if isinstance(items,list) else []):
     if isinstance(it,str):it={'column':it}
     if not isinstance(it,dict):continue
     col=str(it.get('column') or '').strip()
     if col not in cs or any(col==x[0] for x in order_parts):continue
     order_parts.append((col,'DESC' if str(it.get('dir') or '').lower()=='desc' else 'ASC'))
   if not order_parts:
    sort_col=request.args.get('sort','').strip()
    sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
    if sort_col in cs:order_parts.append((sort_col,sort_dir))
   order=(' ORDER BY '+','.join(f'{qi(c2)} {d}' for c2,d in order_parts)) if order_parts else ''
   t_count=time.perf_counter()
   cur=c.cursor();cur.execute(f'SELECT COUNT(*) FROM {qi(t)}'+where,params);count=int(cur.fetchone()[0])
   lap('count',t_count)
   # そのページぶんだけ取り出す。以前は頭からpage*size件を取ってPython側で
   # 切り出しており、後ろのページほど無駄が増えていた(§9.95。「全件」は
   # ページを順に読み進めるので、1..12ページで19,500行を読んで3,000行を
   # 使う、という形になっていた)。SQLiteはOFFSETを解するので素直に渡す。
   t_fetch=time.perf_counter()
   start=(page-1)*size
   cur.execute(f'SELECT * FROM {qi(t)}'+where+order+f' LIMIT {size} OFFSET {start}',params)
   rows=cur.fetchall()
   lap('fetch',t_fetch)
  # 表示マスタで非表示指定された列は、検索/絞込/並替の対象(cs)には残しつつ、
  # 返却するcolumns/rowsからのみ除外する(生の行タプルはcs全体の順序と対応するため、
  # zip自体はcs全体で行い、その後に非表示列をdictから取り除く)。
  # include_hidden=1が指定された場合は除外しない。一覧の表示設定はあくまで
  # 画面上の見た目の好みであり、条割(分割)機能など内部計算が特定の列の
  # 実データに依存する場面では、非表示設定によってデータ自体が欠落しては
  # ならないため(一覧を出す通常のリクエストでは指定しない)。
  hidden=set() if request.args.get('include_hidden')=='1' else hidden_columns_for_db(k)
  # 欲しい列だけを返す(§9.94)。**絞り込み・並べ替えの対象(cs)は絞らない**
  # ——効かせるのは戻す量だけ。仕掛の実データは200列を超えることがあり、
  # 「ロット番号があるかどうか」を知りたいだけの内部問い合わせでも1回
  # 450KBを運んでいた(1ページの追い判定で30MB。受け取ったJSONを解くたびに
  # 画面が止まり、実機で「固まる」と報告された)。
  want=[x.strip() for x in (request.args.get('columns','') or '').split(',') if x.strip()]
  keep=set(x for x in want if x in cs) or None
  # **1つも当たらなければ絞らない**(fail-open)。列名を打ち間違えた・
  # データ側で列名が変わった場合に、空の表を黙って返すのが一番困る。
  row_dicts=[dict(zip(cs,r)) for r in rows]
  # 名前は1つずつ(§9.113)。行はdictで同名を1つしか持てないので、列だけ
  # 2つ返すと本数が食い違い、画面では列が増えて見える。
  visible_cs=_unique_columns([x for x in cs if x not in hidden and (keep is None or x in keep)])
  if hidden or keep is not None:
   drop=lambda col:(col in hidden) or (keep is not None and col not in keep)
   row_dicts=[{col:v for col,v in d.items() if not drop(col)} for d in row_dicts]
  join_info=None
  # 結合できるのは役割が「作業」の一覧だけ(§9.87)。
  if WORK_DB_KEY and k==WORK_DB_KEY and request.args.get('join_quality')=='1':
   t_join=time.perf_counter()
   visible_cs,row_dicts,join_info=_join_quality_data(visible_cs,row_dicts)
   lap('join',t_join)
  timing['server']=round((time.perf_counter()-t0)*1000)
  # どこのファイルを読んだのかも一緒に返す。共有を直接読んでいるのか、
  # 手元の写し(§9.89)を読んでいるのかで、遅さの意味がまったく違う。
  timing['source']='mirror' if cf.get('mirrored') else ('share' if cf.get('role')=='readonly' else 'local')
  timing['rows']=len(row_dicts);timing['columns']=len(visible_cs)
  resp=jsonify(columns=visible_cs,rows=row_dicts,count=count,
               filters_applied=len(filters),joinQuality=join_info,timing=timing)
  # 開発者ツールのネットワーク欄でも同じ内訳が読めるようにする。
  resp.headers['Server-Timing']=','.join(
   f'{n};dur={v}' for n,v in timing.items() if isinstance(v,int))
  return resp
 except Exception as e:return jsonify(error=str(e)),500
