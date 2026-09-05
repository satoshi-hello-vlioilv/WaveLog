"""rne_extract.py: RNE(Navigator問い合わせ定義)から仕掛(SIKALOTNOW)・品質データ
(SIKALOTDEF)をSQLite3として抽出する。SymfoNavi-Data-Hubからの移植だが、
WaveLogではSQLite3出力の1経路だけに絞っている(元アプリはCSV/TXT/XLSX/ACCDBにも
対応するが、WaveLog自身が読むのはSQLite3のみのため)。

Windows専用(navigator_api.pyがSymNaviA.dllをctypesで直接呼ぶ)。ローカル運用
(config/local.jsonのsikalot_source=local)のときだけbackend/rne_scheduler.pyから
サブプロセス(backend/rne_worker.py)経由で呼ばれる。

流れ: NaviOpenSession -> (追加データソース接続) -> NaviOpenCatalog ->
NaviExecuteCatalog -> NaviSaveData(CSV) -> CSV解析 -> SQLite3書き込み ->
ローカルで完成させてから公開先(db/配下)へアトミック置換。
"""
from __future__ import annotations
import configparser, csv, os, shutil, sqlite3, time
from datetime import datetime
from pathlib import Path

from . import atomic_io
from .quiet import quiet

def qi(s):return '"'+str(s).replace('"','""')+'"'

def unique_headers(values):
 out=[];used={}
 for i,x in enumerate(values,1):
  name=str(x or '').replace('\r','').replace('\n','').strip() or f'Column{i}';used[name]=used.get(name,0)+1;out.append(name if used[name]==1 else f'{name}_{used[name]}')
 return out

def read_extract_csv(path):
 """Navigator APIがNaviSaveData(NAVI_CSV)で書き出した中間CSVを解析する。"""
 path=Path(path);rows=None;last_error=None
 for encoding in ('cp932','utf-8-sig','utf-8'):
  try:
   with path.open('r',encoding=encoding,errors='strict',newline='') as f:rows=list(csv.reader(f))
   break
  except UnicodeDecodeError as e:last_error=e
 if rows is None:raise UnicodeError(f'中間CSVの文字コードを判定できません: {path}: {last_error}')
 if not rows:raise ValueError(f'{path}にデータがありません')
 hs=unique_headers(rows[0]);body=[]
 for row in rows[1:]:body.append([str(x) if x is not None else '' for x in list(row[:len(hs)])+['']*max(0,len(hs)-len(row))])
 return hs,body

def creds(conf_path):
 """symnavim.confの[Connect_*]セクションからNavigator接続情報を読む。"""
 cp=configparser.ConfigParser(interpolation=None);cp.optionxform=str.lower
 for enc in ('cp932','utf-8-sig','utf-8'):
  try:cp.read(conf_path,encoding=enc);break
  except UnicodeDecodeError:continue
 if not cp.sections():raise ValueError(f'symnavim.confを読み取れません: {conf_path}')
 sec='Default' if cp.has_section('Default') else next((x for x in cp.sections() if x.lower().startswith('connect_')),cp.sections()[0])
 d={k.lower():v.strip() for k,v in cp.items(sec)};a=(d.get('symnaviuserid',''),d.get('symnavipasswd',''),d.get('symnaviserver',''))
 if not all(a):raise ValueError(f'[{sec}]にSymNaviUSERID、SymNaviPASSWD、SymNaviServerが必要です')
 return a[0],a[1],a[2]

def api_data_source_profiles(conf_path):
 """symnavim.confの追加データソース接続([ApiOracle]等)を読む。未設定なら空。"""
 cp=configparser.ConfigParser(interpolation=None);cp.optionxform=str.lower
 for enc in ('cp932','utf-8-sig','utf-8'):
  try:cp.read(conf_path,encoding=enc);break
  except UnicodeDecodeError:continue
 profiles=[];supported={'apioracle':'oracle','apisqlserver':'sqlserver','apirda':'rda','apipostgres':'postgres','apiresource':'resource','apiresourcenoauth':'noauth'}
 for section in cp.sections():
  compact=''.join(ch for ch in section.lower() if ch.isalnum());kind=supported.get(compact)
  if not kind:continue
  d={k.lower():v.strip() for k,v in cp.items(section)};enabled=str(d.get('enabled','yes')).lower() not in ('0','no','false','off')
  if not enabled:continue
  profiles.append({'section':section,'kind':kind,'user':d.get('user',d.get('userid','')),'password':d.get('password',d.get('passwd','')),'server':d.get('server',''),'option':d.get('option',d.get('opt','')),'resource':d.get('resource',d.get('resourcename','')),'resource_kind':d.get('resource_kind',d.get('resourcekind','0'))})
 return profiles

def write_sqlite(dst,table,headers,body,rne_name):
 """列はすべてTEXTで作成する(WaveLog側は文字列比較を前提に読むため)。"""
 if dst.exists():dst.unlink()
 c=sqlite3.connect(dst)
 try:
  c.execute('PRAGMA synchronous=FULL')
  c.execute(f'CREATE TABLE {qi(table)} ('+', '.join(qi(x)+' TEXT' for x in headers)+')')
  if body:c.executemany(f'INSERT INTO {qi(table)} VALUES ('+','.join('?' for _ in headers)+')',body)
  c.execute('CREATE TABLE _更新情報 (項目 TEXT PRIMARY KEY, 値 TEXT)')
  c.executemany('INSERT INTO _更新情報 VALUES (?,?)',[('作成日時',datetime.now().isoformat(timespec='seconds')),('RNE',rne_name),('件数',str(len(body)))])
  c.commit()
  integrity=c.execute('PRAGMA integrity_check').fetchone()[0];count=c.execute(f'SELECT COUNT(*) FROM {qi(table)}').fetchone()[0]
  if integrity!='ok' or count!=len(body):raise RuntimeError('SQLite整合性検査に失敗しました')
 finally:c.close()
 return len(body),len(headers)

def publish(src,dst,backup_dir,generations=5):
 """ローカルで完成させたsrcを、公開先dstへアトミック置換する。
 公開先が他プロセス/他PCで開かれ使用中(Windowsのファイルロック)なら、
 強制せず dst.pending_YYYYMMDD_HHMMSS として保存し、次回の抽出開始時に
 apply_pending()で適用する(SymfoNavi-Data-Hubと同じ方式)。"""
 dst.parent.mkdir(parents=True,exist_ok=True)
 stamp=datetime.now().strftime('%Y%m%d_%H%M%S')
 incoming=dst.parent/f'.{dst.name}.{os.getpid()}.incoming'
 try:
  shutil.copy2(src,incoming)
  if incoming.stat().st_size!=src.stat().st_size:raise IOError('公開先へのコピーサイズが一致しません')
  deadline=time.time()+3.0
  while time.time()<deadline:
   try:
    if dst.exists() and backup_dir:
     bdir=backup_dir/dst.stem;bdir.mkdir(parents=True,exist_ok=True)
     try:shutil.copy2(dst,bdir/f'{dst.stem}_{stamp}{dst.suffix}')
     except OSError:pass
     old=sorted(bdir.glob(f'{dst.stem}_*{dst.suffix}'),key=lambda p:p.stat().st_mtime,reverse=True)
     for item in old[generations:]:
      try:item.unlink()
      except OSError:pass
    os.replace(incoming,dst)
    if dst.stat().st_size!=src.stat().st_size:raise IOError('公開後サイズ不一致')
    return {'published':True,'path':str(dst)}
   except OSError as e:
    # 「待てば直る失敗」の見分けはbackend/atomic_io.pyが1箇所で持つ(§9.108)。
    # ここは保留(pending)へ逃がす独自の受け皿があるので、共通の再試行では
    # なく自前のループのままにしてある。
    if atomic_io.is_transient(e):time.sleep(.25)
    else:raise
  pending=dst.parent/f'{dst.stem}.pending_{stamp}{dst.suffix}';os.replace(incoming,pending)
  return {'published':False,'path':str(dst),'pending':str(pending),'reason':'公開先が使用中のため保留しました'}
 finally:
  if incoming.exists():
   try:incoming.unlink()
   except OSError:pass

def apply_pending(dst,backup_dir,generations=5):
 """前回publish()が公開先の使用中で保留した内容を適用する。publish()と同じく、
 適用前のdstを世代管理付きでバックアップしてから置き換える(バックアップの
 抜けを作らないため)。"""
 pending=sorted(dst.parent.glob(f'{dst.stem}.pending_*{dst.suffix}'),key=lambda p:p.stat().st_mtime,reverse=True)
 if not pending:return None
 newest=pending[0]
 try:
  if dst.exists() and backup_dir:
   stamp=datetime.now().strftime('%Y%m%d_%H%M%S')
   bdir=backup_dir/dst.stem;bdir.mkdir(parents=True,exist_ok=True)
   try:shutil.copy2(dst,bdir/f'{dst.stem}_{stamp}{dst.suffix}')
   except OSError:pass
   old=sorted(bdir.glob(f'{dst.stem}_*{dst.suffix}'),key=lambda p:p.stat().st_mtime,reverse=True)
   for item in old[generations:]:
    try:item.unlink()
    except OSError:pass
  # 保留を適用するここは再試行が無かった(publish()側にはあった)。
  # 使用中で保留したものを適用しに来るのだから、ここでこそ粘る必要がある。
  atomic_io.replace(newest,dst,label='rne.apply_pending')
  for old in pending[1:]:
   try:old.unlink()
   except OSError:pass
  return newest
 except PermissionError:
  return None

def extract_one(job,conf,work_dir):
 """job: {'name','rne','table','output'}。conf: {'rne_dir','symnavim_conf','backup_dir','base_dir'}。
 work_dirはこの抽出専用のローカル作業フォルダ(サブプロセスごとに分離)。"""
 from .navigator_api import NavigatorApi
 started=time.perf_counter();api_client=None
 name=job.get('name','');dst=Path(job['output'])
 try:
  work_dir=Path(work_dir);work_dir.mkdir(parents=True,exist_ok=True)
  rne_path=(Path(conf['rne_dir'])/job['rne']).resolve()
  if not rne_path.is_file():raise FileNotFoundError(f'RNEがありません: {rne_path}')
  backup_dir=Path(conf['backup_dir']) if conf.get('backup_dir') else None
  if backup_dir:apply_pending(dst,backup_dir)
  user,pw,server=creds(conf['symnavim_conf'])
  api_client=NavigatorApi(base_dir=conf.get('base_dir'))
  api_client.open_session(user,pw,server)
  profiles=api_data_source_profiles(conf['symnavim_conf'])
  if not any(p.get('kind')=='oracle' for p in profiles):
   # Oracle専用設定が無い場合、Navigator認証情報を1回だけ流用する
   # (SymfoNavi-Data-Hub側の実運用で必要だった挙動を踏襲)。
   profiles.insert(0,{'section':'NavigatorCredentialFallback','kind':'oracle','user':user,'password':pw,'server':'','option':'','resource':'','resource_kind':'0'})
  for profile in profiles:
   api_client.connect_data_source(profile)
  previous_cwd=os.getcwd()
  try:
   os.chdir(rne_path.parent)
   handle,_=api_client.open_catalog(rne_path)
  finally:os.chdir(previous_cwd)
  _,_=api_client.execute(handle)
  expected_rows,expected_cols=api_client.dimensions(handle)
  csv_path=work_dir/f'{name}.csv'
  api_client.save_csv(handle,csv_path)
  if not csv_path.is_file() or csv_path.stat().st_size<=0:raise RuntimeError(f'中間CSVが作成されませんでした: {csv_path}')
  api_client.close_catalog()
  headers,body=read_extract_csv(csv_path)
  if len(body)!=int(expected_rows) or len(headers)!=int(expected_cols):
   raise RuntimeError(f'抽出件数検査に失敗 expected={expected_rows}x{expected_cols} actual={len(body)}x{len(headers)}')
  local_db=work_dir/f'{name}.sqlite3'
  rows,cols=write_sqlite(local_db,job.get('table') or name,headers,body,job['rne'])
  pub=publish(local_db,dst,backup_dir) if backup_dir else publish(local_db,dst,None)
  elapsed=time.perf_counter()-started
  return {'ok':True,'job':name,'rows':rows,'columns':cols,'elapsed':elapsed,'target':str(dst),'published':pub['published']}
 except Exception as e:
  return {'ok':False,'job':name,'elapsed':time.perf_counter()-started,'error':str(e)}
 finally:
  if api_client:
   try:api_client.close()
   except Exception as _e:quiet('接続を閉じられない（この要求のあいだだけの接続なので後で片付く）',_e)
  try:shutil.rmtree(work_dir,ignore_errors=True)
  except Exception as _e:quiet('作業フォルダを片付けられない（次の掃除で消える）',_e)
