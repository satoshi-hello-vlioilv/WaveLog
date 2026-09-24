"""tables.py: 汎用DB一覧API — カタログ/テーブル一覧/データ取得(フィルタ・検索・並替)。

app.pyから移設(Phase 3)。接続先は全てSQLite(Access接続は廃止)。

SQL方言について: 検索・フィルタで使うCStr()/Val()はAccess方言のSQL関数で
SQLiteには無いため、db_access.pyのconnect()がユーザー定義関数として登録して
吸収している。またVal()経由の数値範囲フィルタ(gt/gte/lt/lte)は、SQLiteが値の
ストレージクラス優先で比較する仕様のため、パラメータ側もPythonで数値化してから
渡す(そうしないとVal()が返す数値と文字列パラメータの比較が常に不成立になる)。
"""
import json, re, time
from flask import Blueprint, request, jsonify
from .body import body, flag, any_

from .. import query_join
from .. import sort_order
from ..db_access import (DBS, qi, connect, cols, tables, cfg,
                         WORK_DB_KEY, QUALITY_DB_KEY, SCHEDULE_DB_KEY)
from ..logging_setup import app_logger
from ..errors import os_error_hint
from ..quiet import quiet

bp=Blueprint('tables',__name__)

# 1ページの件数（§9.286 ③、利用者の指示「200,500,1000,2000,3000,5000を準備し、
# 1000件としたい」）。**画面の選択肢とそろえること**——以前ここは500で
# 頭打ちにしていたので、画面が1000を選んでも**500件しか返らなかった**
# （画面だけ増やしても効かない。実測で頭打ちを確認）。
# 上限は画面のいちばん大きい選択肢と同じ。**下限は1**——`columns=`で1列だけ
# 引く内部の問い合わせ（§9.94）は少量でよく、50へ切り上げると余分に運ぶ。
PAGE_SIZE_MAX=5000
PAGE_SIZE_DEFAULT=1000

def _numeric_value(value):
 # SQLiteのVal(?)相当。先頭の数値部分を取り出す(見つからなければ0)。
 m=re.match(r'^\s*[+-]?\d+(\.\d+)?',str(value or ''))
 return float(m.group(0)) if m else 0.0

# ========================================================================
# 結合(§9.193): 別のデータソースの列を、突合キーで一覧へ足す。
# 判定と実処理は backend/query_join.py の1箇所が持つ——ここに書き写すと、
# 「画面の言うことと実際の挙動が食い違う」形の壊れ方になる(§9.163)。
# 以前ここにあった品質データ結合(`_join_quality_data`)は、保存されない
# 既定の1件の定義として同じエンジンへ移した。
# ========================================================================
_unique_columns=query_join.unique_columns


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

@bp.get('/api/db-mirror/source')
def api_db_mirror_source():
 """その一覧の元データの素性だけ（§9.463）。**共有を見に行かない**——背景の周回が
 控えた答えを返すだけなので軽い。画面はこれを間隔を置いて聞き、写しが
 新しくなっていれば一覧を読み直す／手動なら「新しい版あり」と出す。"""
 from .. import db_mirror
 k=str(request.args.get('db') or '').strip()
 if k not in DBS:return jsonify(error='データソースがありません。'),404
 try:path=cfg(k).get('path')
 except Exception as _e:quiet('読み込み先が決まっていない（元の時刻は出さない）',_e);path=None
 return jsonify(ok=True,source=db_mirror.source_info(k,path))

@bp.post('/api/db-mirror/refresh')
def api_db_mirror_refresh():
 """今すぐ写し直す(一覧の「再読込」から呼ぶ)。`wait`なら写し終えるまで待って
 結果を返す（画面はそれを字で言う・§9.463）。`force`は元の時刻と大きさが同じでも
 写し直す——共有の時刻は手元に控えられて遅れることがあり、「変わっていない」と
 誤って読むと押した人の期待（最新を見たい）に応えられない。"""
 from .. import db_mirror
 x=body({'wait': flag, 'force': flag}, silent=True, strict=True)
 if x.flag('wait'):
  return jsonify(ok=True,mode=db_mirror.update_mode(),
                 results=db_mirror.refresh_all(force=x.flag('force')))
 db_mirror.wake()
 return jsonify(ok=True,queued=True)

def _display_rule_rows(name,cache):
 """読み替えルールの中身。**名前で引く**(§9.88 段4)ので、無い名前は
    「読み替えなし」で済ませる。読めなければ空(並べ替えは生の値になる)。"""
 name=str(name or '').strip()
 if not name:return None
 if name in cache:return cache[name]
 rows=None
 try:
  from ..repositories import master_repo as mr
  with connect(DBS['MASTER']['path'],True) as mc:
   rows=(mr.display_rules(mc) or {}).get(name)
 except Exception as e:
  app_logger().warning('読み替えルール「%s」を読めませんでした: %s',name,e)
 cache[name]=rows
 return rows


def _fetch_custom_sorted(c,t,cs,where,params,keys,size,start):
 """列ごとの並べ替え(§9.187)を当てて、そのページの行だけを返す。

 **2段で引く。** 1段目は並べ替えに要る列とROWIDだけ(214列を丸ごと運ぶと
 2万行で数十MBになる)。Pythonで並べてから、2段目でそのページのROWIDを
 本体から引き直す。戻す形は通常の`SELECT *`と同じ列順のタプル
 ——呼び出し側は`dict(zip(cs,row))`で読むので、ここで形を変えないこと。

 ROWIDを持たない表(WITHOUT ROWID)では1段目が失敗する。**その場合は
 例外を投げて呼び出し側のfail-openに任せる**（黙って別の並びで出さず、
 「当てられなかった」と画面に書く）。"""
 rule_cache={}
 need=set()
 for k in keys:
  if k['column'] in cs:need.add(k['column'])
  if k.get('spec') and k['spec'].get('on')=='display':
   k['ruleRows']=_display_rule_rows(k.get('rule'),rule_cache)
   # 条件が他の列を見ていることがある(「区分が3のときだけ」)。その列も引く。
   for r in (k.get('ruleRows') or []):
    for cd in (r.get('conditions') or []):
     for side in (cd.get('left'),cd.get('right'),cd.get('right2')):
      if isinstance(side,dict) and side.get('kind')=='column':
       nm=str(side.get('column') or '').strip()
       if nm in cs:need.add(nm)
 want=[x for x in cs if x in need]
 if not want:raise ValueError('並べ替えに使える列がありません')
 cur=c.cursor()
 sel=','.join(qi(x) for x in want)
 cur.execute(f'SELECT ROWID,{sel} FROM {qi(t)}'+where,params)
 rows=[dict(zip(want,r[1:]),__rid=r[0]) for r in cur.fetchall()]
 def value_of(row,k):
  v=row.get(k['column'])
  if (k.get('spec') or {}).get('on')=='display':
   return sort_order.display_text(v,k.get('fmt'),k.get('ruleRows'),row,k['column'])
  return v
 ordered=sort_order.order_rows(rows,keys,value_of)
 ids=[r['__rid'] for r in ordered[start:start+size]]
 if not ids:return []
 out={}
 # パラメータ数の上限があるので小分けにする(1ページ最大500件だが念のため)。
 for i in range(0,len(ids),200):
  chunk=ids[i:i+200]
  ph=','.join('?'*len(chunk))
  cur.execute(f'SELECT ROWID,* FROM {qi(t)} WHERE ROWID IN ({ph})',chunk)
  for r in cur.fetchall():out[r[0]]=tuple(r[1:])
 return [out[i] for i in ids if i in out]


@bp.get('/api/catalog')
def catalog():
 # purpose(役割)まで返す。画面はキーの文字列ではなくこれで「作業対象の
 # 一覧か/品質データか」を判断する(§9.87)。
 # **`preferred`(既定テーブル)はここから返さない**(§9.93)。往復を1本
 # 減らすために一度返したが、あれは**設定値**で、そのDBに実在するとは
 # 限らない(品質データの既定が「仕掛」のまま、という実例がある)。
 # 実在しないテーブルを開きに行って読み直す羽目になったので、画面側は
 # 「前回**実際に確認した**テーブル一覧」を端末に覚える方式にした。
 # **一覧に出さないデータソースはここに載せない**(§9.193)。結合の相手として
 # だけ読むデータ(品質・単価表など)は左メニューに並べても押す用が無い——
 # 出しておいて「見るところが無い」より、出さないほうが探す手間が減る。
 # 読むこと自体は止めない（クエリ結合は DBS から直接引く）。
 return jsonify(databases=[{"key":k,"label":v['label'],"file_name":v['path'].name,
                            "role":v['role'],"purpose":v.get('purpose') or ''}
                           for k,v in DBS.items() if v.get('listed',True)],
                workKey=WORK_DB_KEY,qualityKey=QUALITY_DB_KEY,
                scheduleKey=SCHEDULE_DB_KEY,
                restartPending=_restart_pending())

def _restart_pending():
 """データソースマスタで保存済みだが、このプロセスにはまだ効いていない変更(§9.183)。

 接続先も**表示名も**起動時に1回だけ確定する(DBSはプロセス起動時の写し)。
 読み込み先については既にマスタ管理画面が「再起動待ち」を出していたが、
 **名称の変更は誰も何も言わなかった**——左のボタンが古い名前のままなのを
 見て、利用者からは「マスタで直したのに反映されない」としか見えない。
 一覧側でも言えるように、ここで突き合わせて返す。

 **読むだけ・失敗しても空で返す**(左メニューが出なくなるのが一番困る)。
 種別: 'label'=名称だけ / 'path'=読み込み先 / 'new'=まだ読んでいない /
 'gone'=無効にした(再起動で消える)。"""
 try:
  from ..db_access import data_source_rows,_source_path,path_config_rows
  master=DBS['MASTER']['path']
  with connect(master,True) as c:
   rows=data_source_rows(c,include_disabled=True)
   saved=path_config_rows(c)
  out=[];live=set()
  for r in rows:
   key=r['key'];cur=DBS.get(key)
   if not r['active']:
    if cur:out.append({'key':key,'label':r['label'],'kind':'gone',
                       'now':str(cur.get('label') or ''),'next':''})
    continue
   live.add(key)
   if not cur:
    out.append({'key':key,'label':r['label'],'kind':'new','now':'','next':r['label']});continue
   if str(_source_path(r,saved))!=str(cur.get('path') or ''):
    out.append({'key':key,'label':r['label'],'kind':'path',
                'now':str(cur.get('path') or ''),'next':str(_source_path(r,saved))})
   elif str(r['label'])!=str(cur.get('label') or ''):
    out.append({'key':key,'label':r['label'],'kind':'label',
                'now':str(cur.get('label') or ''),'next':r['label']})
  return out
 except Exception as e:
  app_logger().warning('再起動待ちの変更を確かめられませんでした: %s',e)
  return []
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
@bp.get('/api/table-columns')
def api_table_columns():
 """列の名前だけを返す(§9.193)。**行は運ばない。**

 クエリ結合の設定画面は「左右どちらの表のどの列で突き合わせるか」を選ばせる
 ので、両側の列名が要る。`/api/table`を50件で叩けば列名は分かるが、実データは
 200列を超えるため1回450KBを運ぶことになる(§9.94)——名前だけなら数KBで済む。"""
 k=request.args.get('db','');t=request.args.get('table','')
 want_samples=request.args.get('samples')=='1'
 try:
  cf=cfg(k)
  with connect(cf['path'],cf['role']=='readonly') as c:
   names=tables(c)
   if not t:
    t=cf['preferred'] if cf.get('preferred') in names else (names[0] if names else '')
   if not t or t not in names:
    return jsonify(error=f'表「{t or "(未指定)"}」がありません。',tables=names),400
   cs=cols(c,t,source=cf['path'])
   # 突合キーを選ぶ側は「同じ名前らしい列」を知りたいが、**名前のゆれを
   # 吸収する規則を画面に写さないこと**(§9.163)——判定はサーバーの
   # norm_name が1箇所で持つので、その結果だけを渡して画面は等しいかを
   # 見るだけにする。
   normalized={c2:query_join.norm_name(c2) for c2 in cs}
   samples={}
   if want_samples:
    # 実データの見本。**キーが合うかどうかは形を見れば分かる**（L0001 と
    # A-1 は突き合わない）ので、選ぶ前に見せる。20行だけ読む。
    cur=c.cursor();cur.execute(f'SELECT * FROM {qi(t)} LIMIT 20')
    got=cur.fetchall()
    for i,c2 in enumerate(cs):
     vals=[]
     for r in got:
      v='' if i>=len(r) or r[i] is None else str(r[i]).strip()
      if v and v not in vals:vals.append(v)
      if len(vals)>=3:break
     samples[c2]=vals
   return jsonify(ok=True,db=k,table=t,tables=names,columns=cs,
                  normalized=normalized,samples=samples)
 except Exception as e:
  app_logger().warning('/api/table-columns db=%s table=%s で失敗しました: %s',k,t,e)
  return jsonify(error=str(e),hint=_error_hint(e)),500

@bp.get('/api/query-join/keys')
def api_query_join_keys():
 """この一覧に効く結合が、**どの列の値を必要としているか**(§9.193)。

 スケジュール表は行ごとに200列のスナップショットを持っているが、突合に
 要るのはそのうち数列。全部を送りつけると、50行で数MBを往復することに
 なる。要る列名を先に聞いてから、その列だけ送る。"""
 k=request.args.get('db','') or (WORK_DB_KEY or '')
 t=request.args.get('table','')
 if not k:return jsonify(ok=True,keys=[],joins=[])
 # `for=schedule`＝作業スケジュール表からの問い合わせ(§9.365)。**「スケジュールでも
 # 使う」に印の付いた結合だけ**を返す（保存されているのは「使わない」側なので、
 # 設定を触っていない行は今までどおり効く）。
 for_schedule=request.args.get('for')=='schedule'
 try:
  defs=query_join.definitions_for(k,t,include_builtin=request.args.get('builtin')!='0',
                                  for_schedule=for_schedule)
  keys=query_join.unique_columns([kk['left'] for d in defs for kk in (d.get('keys') or [])])
  return jsonify(ok=True,db=k,table=t,keys=keys,
                 joins=[{'name':d.get('name'),'right':d.get('right'),
                         'builtin':bool(d.get('builtin'))} for d in defs])
 except Exception as e:
  app_logger().warning('/api/query-join/keys db=%s で失敗しました: %s',k,e)
  return jsonify(ok=True,keys=[],joins=[],error=str(e))

@bp.post('/api/query-join/resolve')
def api_query_join_resolve():
 """渡した鍵の値に、登録済みの結合を当てて**足される列だけ**を返す(§9.193)。

 スケジュール表がこれを使う。タイムラインの行が持っているのは投入した時点の
 仕掛データ(detail)なので、**結合の相手は今の値**で引き直したい——予定は
 スナップショットでよいが、品質や在庫のように後から確定する値は、投入時点に
 まだ無い。一覧と同じ定義・同じエンジンを通すので、**一覧に出る列と
 スケジュール表に出る列が食い違わない**。

 読むだけ(_READ_ONLY_POST_ENDPOINTSで全モードから通す)。"""
 x=body({'db': str, 'table': str, 'rows': any_, 'builtin': any_, 'for': str}, silent=True)
 k=x.text('db');t=x.text('table')
 rows=x.get('rows')
 if not isinstance(rows,list):return jsonify(error='rowsは配列で送ってください。'),400
 rows=[r if isinstance(r,dict) else {} for r in rows[:2000]]
 if not k:
  from ..db_access import WORK_DB_KEY as _wk
  k=_wk or ''
 if not k:return jsonify(error='役割「仕掛」のデータソースが決まっていません。'),400
 try:
  defs=query_join.definitions_for(k,t,include_builtin=x.get('builtin') is not False,
                                  for_schedule=x.text('for')=='schedule')
  if not defs:
   return jsonify(ok=True,db=k,table=t,joins=[],columns=[],values=[{} for _ in rows])
  base=[str(c) for c in query_join.unique_columns([c for r in rows for c in r.keys()])]
  _cols,merged,infos=query_join.apply_joins(k,t,base,rows,defs)
  added=query_join.unique_columns([n for i in infos for n in (i.get('addedColumnNames') or [])])
  # **足された列だけ**を返す(元の値は依頼元が持っている)。運ぶ量を減らすのと、
  # 受け取った側が「これは結合で来た値」と見分けられるようにするため。
  values=[{n:m.get(n) for n in added if m.get(n) not in (None,'')} for m in merged]
  return jsonify(ok=True,db=k,table=t,joins=infos,columns=added,values=values,
                 summary=query_join.summarize(infos))
 except Exception as e:
  app_logger().warning('/api/query-join/resolve db=%s で失敗しました: %s',k,e)
  return jsonify(error=str(e)),500

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
  k=request.args['db'];t=request.args['table'];page=max(1,int(request.args.get('page',1)));size=min(PAGE_SIZE_MAX,max(1,int(request.args.get('page_size',PAGE_SIZE_DEFAULT))));q=request.args.get('search','').strip();cf=cfg(k)
  filter_payload=request.args.get('filters','').strip()
  def safe_filters(text,columns):
   if not text:return []
   try:items=json.loads(text)
   except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);return []
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
   order_parts=[];order_keys=[]
   raw_sorts=request.args.get('sorts','').strip()
   if raw_sorts:
    try:items=json.loads(raw_sorts)
    except Exception as _e:quiet('保存された値を読めない（既定で続ける）',_e);items=[]
    for it in (items if isinstance(items,list) else []):
     if isinstance(it,str):it={'column':it}
     if not isinstance(it,dict):continue
     col=str(it.get('column') or '').strip()
     if col not in cs or any(col==x[0] for x in order_parts):continue
     order_parts.append((col,'DESC' if str(it.get('dir') or '').lower()=='desc' else 'ASC'))
     # 列ごとの並べ替えの決まり(§9.187)。**指定が無ければNone**＝今までどおり
     # SQLのORDER BY。画面が送るのは「いま当たっている設定」なので、
     # 保存前の試し(stage)もそのまま効く。
     order_keys.append({'column':col,
                        'dir':'desc' if str(it.get('dir') or '').lower()=='desc' else 'asc',
                        'spec':sort_order.normalize_spec(it.get('sort')),
                        'fmt':it.get('fmt') if isinstance(it.get('fmt'),dict) else None,
                        'rule':str(it.get('rule') or '').strip()})
   if not order_parts:
    sort_col=request.args.get('sort','').strip()
    sort_dir='DESC' if request.args.get('sort_dir','').strip().lower()=='desc' else 'ASC'
    if sort_col in cs:
     order_parts.append((sort_col,sort_dir))
     order_keys.append({'column':sort_col,'dir':sort_dir.lower(),'spec':None,'fmt':None,'rule':''})
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
   sort_note=''
   custom=[k for k in order_keys if k.get('spec')]
   if custom:
    # **並べ替えの決まりがある列だけこの経路**(§9.187)。SQLでは書けないので
    # Pythonで並べてからページを切り出す。失敗しても一覧は出す(fail-open)
    # ——並びの設定で表そのものが開けなくなるのが一番困る。
    try:
     rows=_fetch_custom_sorted(c,t,cs,where,params,order_keys,size,start)
    except Exception as e:
     app_logger().warning('列ごとの並べ替えを当てられませんでした(table=%s): %s',t,e)
     sort_note=f'この列の並べ替えの設定を当てられなかったので、ふだんの並びで出しています（{e}）'
     cur.execute(f'SELECT * FROM {qi(t)}'+where+order+f' LIMIT {size} OFFSET {start}',params)
     rows=cur.fetchall()
   else:
    cur.execute(f'SELECT * FROM {qi(t)}'+where+order+f' LIMIT {size} OFFSET {start}',params)
    rows=cur.fetchall()
   lap('fetch',t_fetch)
  # **どの列を出すかはサーバーが決めない**(§9.165)。以前はここで「表示マスタ」
  # (DB単位・行の存在=非表示)を引いて列を落としていたが、同じことを列レイアウト
  # マスタが対象(`list:<DB>:<表>`)ごとに、並び・幅・表示名・書式・読み替えまで
  # 含めて持つようになったため、**劣化した重複**になっていた。サーバーが列を
  # 落とすと画面側は落ちた列を選ぶことすらできない(候補に出てこない)ので、
  # 落とす役はやめて画面へ一本化した。`include_hidden`は受け取っても何もしない
  # (古い呼び出しを落とさないため。付いていても外れていても同じ結果)。
  hidden=set()
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
  join_info=None;join_list=[]
  # 結合(§9.193)。**明示的に頼まれたときだけ**当てる——一覧を出す本筋の
  # 問い合わせ(`join=1`)と、既定の品質データ結合(`join_quality=1`)の2つ。
  # 内部の軽い問い合わせ(§9.94の`columns=`)には付かないので、行の追い判定の
  # たびに相手のDBを引くことにはならない。
  want_join=request.args.get('join')=='1'
  want_quality=bool(WORK_DB_KEY) and k==WORK_DB_KEY and request.args.get('join_quality')=='1'
  if want_join or want_quality:
   t_join=time.perf_counter()
   defs=query_join.definitions_for(k,t,include_builtin=want_quality) if want_join else []
   if want_quality and not want_join:
    # 既定の品質データ結合は解除できる(§9.194)。解除されていたら**何も
    # 起きないだけ**——品質の列が足されないので、その列を見ていた設定は
    # 「無い列」として静かに落ちる（エラーにしない。利用者の指示）。
    b=query_join.builtin_quality_def() if query_join.builtin_quality_enabled() else None
    defs=[b] if b else []
   visible_cs,row_dicts,join_list=query_join.apply_joins(k,t,visible_cs,row_dicts,defs)
   visible_cs=_unique_columns(visible_cs)
   join_info=query_join.summarize(join_list) if join_list else None
   lap('join',t_join)
  timing['server']=round((time.perf_counter()-t0)*1000)
  # どこのファイルを読んだのかも一緒に返す。共有を直接読んでいるのか、
  # 手元の写し(§9.89)を読んでいるのかで、遅さの意味がまったく違う。
  timing['source']='mirror' if cf.get('mirrored') else ('share' if cf.get('role')=='readonly' else 'local')
  timing['rows']=len(row_dicts);timing['columns']=len(visible_cs)
  # **その一覧が読んだデータは「いつのものか」**（§9.286 ④）。この応答に
  # 添えるのは、**いま画面に出ている行と同じ問い合わせの答え**にするため
  # ——別の口で取りに行くと、一覧と鮮度が別のタイミングの話になりうる。
  from .. import db_mirror as _dbm
  try:src_info=_dbm.source_info(k,cf.get('path'))
  except Exception as _e:quiet('元データの時刻を引けない（鮮度を出さない）',_e);src_info=None
  resp=jsonify(columns=visible_cs,rows=row_dicts,count=count,
               filters_applied=len(filters),joinQuality=join_info,joins=join_list,
               timing=timing,sortNote=sort_note,source=src_info)
  # 開発者ツールのネットワーク欄でも同じ内訳が読めるようにする。
  resp.headers['Server-Timing']=','.join(
   f'{n};dur={v}' for n,v in timing.items() if isinstance(v,int))
  return resp
 except Exception as e:return jsonify(error=str(e)),500
