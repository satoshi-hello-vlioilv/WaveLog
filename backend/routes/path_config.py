"""path_config.py: パス設定マスタとパス参照ダイアログのAPI(Blueprint)。

backend/routes/masters.py から分離した(docs/REFACTORING_PLAN.md フェーズ4.1)。
ロジックは変更していない(移動のみ)。URLも従来と同一。

**Blueprint名を変えると書込ガードの判定が変わる**: backend/access_mode.py の
_WRITE_ALLOWED_MODES はBlueprint名をキーに判定し、未宣言のBlueprintは
fail-open(全モード素通し)になる。この分離に合わせて 'path_config':{'edit'} を
同表へ登録してある(分離前の masters と同じ許可)。
tests/test_modeguard.py がモード×エンドポイントの許可表を固定しているので、
ここを変えると落ちる。
"""
import re
from pathlib import Path
from flask import Blueprint, request, jsonify

from .. import paths
from ..paths import APP_ROOT as BASE_DIR
from ..config import (RNE_EXTRACT_INTERVAL_SEC_DEFAULT, SCHEDULE_LOCK_TTL_SEC_DEFAULT,
                      SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT)
from ..db_access import (
 DBS, connect, request_user_id,
 PATH_CONFIG_KEYS, path_config_rows, set_path_config, path_config_value,
 SIKALOT_SOURCE, RECORDS_BACKUP_EXPORT_PATH, SCHEDULE_SHARE_PATH,
)

bp=Blueprint('path_config',__name__)

# ========================================================================
# パス設定マスタ（仕掛/品質データの読み込み先・共有パス・各種間隔設定。
# 旧config/local.json。db_access.pyのPATH_CONFIG_*を参照）
#  - sikalot_source/sikalotnow_path/sikalotdef_path/records_backup_export_path/
#    schedule_share_pathはDBS等の接続先をプロセス起動時に1回だけ決めるため、
#    保存してもこのプロセスでは反映されない(サーバー再起動が必要)。
#  - rne_extract_interval_sec/schedule_lock_ttl_sec/schedule_lock_verify_delay_ms
#    は呼び出しのたびに読み直す設計のため、再起動なしで次回から反映される。
# ========================================================================
_PATH_CONFIG_DEFAULTS={
 'sikalot_source':'network','sikalotnow_path':'','sikalotdef_path':'',
 'records_backup_export_path':'','schedule_share_path':'',
 'rne_extract_enabled':'auto',
 # 共有DBを手元へ写してから読むか(§9.89)。既定は有効。
 'db_mirror_enabled':'auto','db_mirror_interval_sec':'60',
 # RNE資材(RNEファイル・symnavim.conf)の置き場。空欄なら config/rne_extract。
 # 共有フォルダに1式だけ置いて全端末から参照する運用のため、端末ごとの
 # コピーを強制しない(§9.79)。認証情報だけ別の場所に置きたい運用があるので
 # symnavim.conf は個別に指定できる(空欄なら資材置き場の直下)。
 'rne_assets_dir':'','rne_conf_path':'',
 'rne_extract_interval_sec':str(RNE_EXTRACT_INTERVAL_SEC_DEFAULT),
 'schedule_lock_ttl_sec':str(SCHEDULE_LOCK_TTL_SEC_DEFAULT),
 'schedule_lock_verify_delay_ms':str(SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT),
}
_PATH_CONFIG_NUMERIC_FIELDS={
 'rne_extract_interval_sec':('RNE抽出間隔(秒)',60),
 'schedule_lock_ttl_sec':('スケジュールロックの有効期限(秒)',1),
 'schedule_lock_verify_delay_ms':('ロック確認までの待機時間(ミリ秒)',0),
}

@bp.get('/api/path-config-master')
def path_config_master_get():
 try:
  path=DBS['MASTER']['path']
  saved={}
  if path.exists():
   with connect(path,True) as c:saved=path_config_rows(c)
  # データソースごとの個別上書き(<キー小文字>_path)も保存値として返す。
  values={k:saved.get(k,'') for k in PATH_CONFIG_KEYS}
  # active: このプロセスで実際に使われている値(保存値は次回起動から反映)。
  # 突き合わせて画面上で「保存済みだが未反映」を示せるようにする。
  from .. import rne_scheduler
  from ..db_access import DATA_SOURCES
  # データソースは利用者が増減できる(データソースマスタ)。**キーが必ず在る
  # 前提で書かない** —— 消された途端にパス設定画面ごと開けなくなる。
  from ..db_access import WORK_DB_KEY,QUALITY_DB_KEY
  now=DBS.get(WORK_DB_KEY or '') or {};dfn=DBS.get(QUALITY_DB_KEY or '') or {}
  # 画面はこの一覧から欄を組み立てる(§9.81)。以前は「仕掛(SIKALOTNOW)」
  # 「品質データ(SIKALOTDEF)」と決め打ちで書かれており、データソースを
  # 増やしても増えず、名前を変えても古いままだった。
  sources=[{'key':x['key'],'label':x['label'],
            'valueKey':f"{x['key'].lower()}_path",
            'saved':saved.get(f"{x['key'].lower()}_path",''),
            'active':str((DBS.get(x['key']) or {}).get('path','')),
            'output':str(rne_scheduler._output_path(x)),
            'share':x.get('share',''),'rne':x.get('rne','')} for x in DATA_SOURCES]
  active={
   'sikalot_source':SIKALOT_SOURCE,
   'sikalotnow_path':str(now.get('path','')),'sikalotnow_engine':now.get('engine',''),
   'sikalotdef_path':str(dfn.get('path','')),'sikalotdef_engine':dfn.get('engine',''),
   'rne_assets_dir':str(rne_scheduler.assets_dir()),
   'rne_conf_path':str(rne_scheduler.conf_path()),
   'records_backup_export_path':str(RECORDS_BACKUP_EXPORT_PATH) if RECORDS_BACKUP_EXPORT_PATH else '',
   'schedule_share_path':str(SCHEDULE_SHARE_PATH) if SCHEDULE_SHARE_PATH else '',
   'rne_extract_enabled':str(path_config_value('rne_extract_enabled','auto') or 'auto'),
   'rne_extract_interval_sec':str(path_config_value('rne_extract_interval_sec',RNE_EXTRACT_INTERVAL_SEC_DEFAULT)),
   'db_mirror_enabled':str(path_config_value('db_mirror_enabled','auto') or 'auto'),
   'db_mirror_interval_sec':str(path_config_value('db_mirror_interval_sec','60')),
   'schedule_lock_ttl_sec':str(path_config_value('schedule_lock_ttl_sec',SCHEDULE_LOCK_TTL_SEC_DEFAULT)),
   'schedule_lock_verify_delay_ms':str(path_config_value('schedule_lock_verify_delay_ms',SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT)),
   # 作り直せるファイル(写し・スケジュールの作業コピー)の実際の置き場(§9.109)。
   # **設定項目ではない**——db_dirが共有/クラウド同期フォルダーの上のときだけ
   # 自動で手元へ移るので、どこになったかを確かめるためだけに出す。
   'work_dir':str(paths.work_dir()),
   'work_dir_reason':paths.work_dir_reason(),
  }
  for src in sources:values.setdefault(src['valueKey'],src['saved'])
  return jsonify(ok=True,values=values,defaults=_PATH_CONFIG_DEFAULTS,active=active,
                 sources=sources,master_path=str(path))
 except Exception as e:return jsonify(error=f'パス設定読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/path-config-master')
def path_config_master_update():
 try:
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  errors=[]
  sikalot_source=str(x.get('sikalot_source') or '').strip()
  if sikalot_source and sikalot_source not in ('network','local'):
   errors.append('参照データの取得元は「network」「local」のいずれかを指定してください。')
  numeric_values={}
  for key,(label,minimum) in _PATH_CONFIG_NUMERIC_FIELDS.items():
   raw=str(x.get(key) if x.get(key) is not None else '').strip()
   if not raw:
    numeric_values[key]='';continue
   try:n=int(raw)
   except ValueError:errors.append(f'{label}は整数で入力してください。');continue
   if n<minimum:errors.append(f'{label}は{minimum}以上で入力してください。');continue
   numeric_values[key]=str(n)
  rne_enabled=str(x.get('rne_extract_enabled') or '').strip()
  if rne_enabled and rne_enabled not in ('auto','on','off'):
   errors.append('RNE抽出の定期実行は「auto」「on」「off」のいずれかを指定してください。')
  if errors:return jsonify(error=' / '.join(errors)),400
  updates={
   'sikalot_source':sikalot_source,
   'sikalotnow_path':str(x.get('sikalotnow_path') or '').strip(),
   'sikalotdef_path':str(x.get('sikalotdef_path') or '').strip(),
   'records_backup_export_path':str(x.get('records_backup_export_path') or '').strip(),
   'schedule_share_path':str(x.get('schedule_share_path') or '').strip(),
   'rne_extract_enabled':rne_enabled,
   # RNE資材・接続情報の置き場(§9.79)。空欄なら既定へ戻る。
   'rne_assets_dir':str(x.get('rne_assets_dir') or '').strip(),
   'rne_conf_path':str(x.get('rne_conf_path') or '').strip(),
   **numeric_values,
  }
  # データソースごとの個別上書き(<キー小文字>_path)。マスタに登録された
  # ぶんだけ受け付ける(任意のキーを書けるようにはしない)。
  from ..db_access import DATA_SOURCES
  for src in DATA_SOURCES:
   k=f"{src['key'].lower()}_path"
   if k in x:updates[k]=str(x.get(k) or '').strip()
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   for key,value in updates.items():
    set_path_config(c,key,value,uid)
  return jsonify(ok=True,updated_by=uid,
                 message='パス設定を保存しました。参照データの読み込み先・共有パスの変更はサーバー再起動後に反映されます。抽出間隔・ロック関連の設定は再起動不要で次回から反映されます。')
 except Exception as e:return jsonify(error=f'パス設定保存失敗: {e}'),500

# ========================================================================
# パス参照(§9.49): マスタ管理のパス入力欄から使うディレクトリ一覧。
#  ブラウザのファイル選択は安全上、完全なパスを返さない(名前だけ)。本アプリは
#  利用者自身の端末で動くローカルサーバーなので、**サーバー側で一覧を返して
#  辿らせる**形にすれば実際のパスが得られる。共有(UNC)も同じ経路で辿れるため、
#  \\server\share\... もマウスだけで選べる。
#  読み取り専用(一覧を返すだけ)で、ファイルの中身は一切返さない。
#  待ち受けは127.0.0.1のみ(backend/config.py)なので、この端末の外からは叩けない。
# ========================================================================
def _size_text(n):
 if n is None:return ''
 for unit in ('B','KB','MB','GB'):
  if n<1024:return f'{n:.0f}{unit}' if unit=='B' else f'{n:.1f}{unit}'
  n/=1024
 return f'{n:.1f}TB'

def _browse_places():
 """よく使う場所。1クリックで飛べるようにして手入力を減らす。"""
 places=[{'label':'アプリの場所','path':str(BASE_DIR)},{'label':'データ(db)','path':str(BASE_DIR/'db')}]
 # データソースは利用者が増減できる。**キーを決め打ちで書かない**(§9.87)。
 for key,cfg in DBS.items():
  if (cfg or {}).get('role')!='readonly':continue
  try:
   places.append({'label':f'{cfg.get("label") or key}の場所',
                  'path':str(cfg['path'].parent)})
  except Exception:
   pass
 if SCHEDULE_SHARE_PATH:
  places.append({'label':'共有スケジュール','path':str(Path(SCHEDULE_SHARE_PATH).parent)})
 seen=set();out=[]
 for p in places:
  if p['path'] and p['path'] not in seen:
   seen.add(p['path']);out.append(p)
 return out

@bp.get('/api/browse-path')
def browse_path():
 """指定フォルダの中身を返す。pathが空/不正なら既定(アプリの場所)を見せる。"""
 raw=str(request.args.get('path') or '').strip()
 error=''
 target=Path(raw) if raw else BASE_DIR
 try:
  if target.exists() and target.is_file():target=target.parent
  if not target.exists():
   error=f'見つかりません: {target}';target=BASE_DIR
 except OSError as e:
  error=f'開けません: {e}';target=BASE_DIR
 entries=[]
 try:
  for child in sorted(target.iterdir(),key=lambda p:(not p.is_dir(),p.name.lower())):
   try:is_dir=child.is_dir();size=None if is_dir else child.stat().st_size
   except OSError:is_dir=False;size=None
   entries.append({'name':child.name,'path':str(child),'isDir':is_dir,'sizeText':_size_text(size)})
   if len(entries)>=2000:break   # 巨大フォルダで画面を固めない
 except OSError as e:
  error=error or f'一覧を取得できません: {e}'
 parent=str(target.parent) if target.parent!=target else ''
 return jsonify(ok=True,path=str(target),parent=parent,entries=entries,
                places=_browse_places(),error=error)

# ========================================================================
# データソースマスタ（§9.79）
# ------------------------------------------------------------------------
# 「RNEから抽出して .sqlite3 を作り、それを一覧として読む」という1本の流れを
# 1行で持つ。以前は "何を抽出するか"(rne_scheduler.JOBS) と
# "どこを読むか"(db_access.DBS) が別々のコードに書かれていて、増やすには
# 両方を直す必要があり、しかも別々に書けるため「抽出しているのに読まない」
# 状態が作れた。
#
# **接続先を決める設定なので、保存してもこのプロセスには反映されない**
# (パス設定マスタの sikalotnow_path 等と同じ。サーバー再起動で反映)。
# 画面はその旨を出すため、保存値と「現在有効な値」の両方を返す。
# ========================================================================
@bp.get('/api/data-source-master')
def data_source_master_list():
 try:
  from ..db_access import data_source_rows, seed_data_sources, DATA_SOURCES, DBS as _DBS
  from .. import rne_scheduler
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   seed_data_sources(c)
   rows=data_source_rows(c,include_disabled=True)
  # 「今このプロセスが実際に読んでいる場所」と、資材の有無を添える。
  # 設定と実態がずれていることに、その場で気づけるようにするため。
  active={s['key']:str((_DBS.get(s['key']) or {}).get('path','')) for s in DATA_SOURCES}
  items=[]
  for r in rows:
   rne=rne_scheduler.rne_path(r['rne']) if r.get('rne') else None
   out=rne_scheduler._output_path(r)
   items.append({**r,
                 'activePath':active.get(r['key'],''),
                 'rnePath':str(rne) if rne else '',
                 'rneExists':bool(rne and rne.exists()),
                 'outputPath':str(out),
                 'outputExists':out.exists(),
                 'enabled':'有効' if r['active'] else '無効',
                 'purpose':r.get('purpose') or 'その他'})
  return jsonify(ok=True,items=items,master_path=str(path),
                 assetsDir=str(rne_scheduler.assets_dir()),
                 confPath=str(rne_scheduler.conf_path()),
                 confExists=rne_scheduler.conf_path().exists())
 except Exception as e:
  return jsonify(error=f'データソース読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

_KEY_RE=re.compile(r'^[A-Za-z0-9_]{1,40}$')

def _purpose_of(x):
 """画面から来た役割を正規化する(§9.87)。「作業」「品質」以外は「その他」。"""
 from ..db_access import DATA_SOURCE_PURPOSES,PURPOSE_OTHER
 v=str(x.get('purpose') or '').strip()
 if v in ('その他','—','-'):return PURPOSE_OTHER
 return v if v in DATA_SOURCE_PURPOSES else PURPOSE_OTHER

def _purpose_conflict(cur,purpose,exclude_id=None):
 """同じ役割が2行に付くのを防ぐ。**どちらを使うか決められない**ため。
    戻り値: 問題があればメッセージ、無ければ None。"""
 from ..db_access import PURPOSE_OTHER
 if not purpose or purpose==PURPOSE_OTHER:return None
 sql='SELECT [キー] FROM [データソースマスタ] WHERE [役割]=? AND [有効]<>0'
 args=[purpose]
 if exclude_id is not None:sql+=' AND [ソースID]<>?';args.append(exclude_id)
 cur.execute(sql,args)
 row=cur.fetchone()
 if row:
  return (f'役割「{purpose}」は既に「{row[0]}」に付いています。'
          '1つの役割は1件だけです。先にそちらを「その他」へ変えてください。')
 return None

@bp.post('/api/data-source-master')
def data_source_master_save():
 try:
  from ..db_access import ensure_data_source_table
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  key=str(x.get('key') or '').strip().upper()
  if not _KEY_RE.match(key):
   return jsonify(error='キーは半角英数と _ で1〜40文字にしてください（一覧のURLに使うため）。'),400
  if key=='MASTER':
   return jsonify(error='MASTER はマスタDB自身に予約されています。別のキーにしてください。'),400
  label=str(x.get('label') or '').strip() or key
  purpose=_purpose_of(x)
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_data_source_table(c);cur=c.cursor()
   cur.execute('SELECT [ソースID] FROM [データソースマスタ] WHERE [キー]=?',[key])
   row=cur.fetchone()
   err=_purpose_conflict(cur,purpose,exclude_id=row[0] if row else None)
   if err:return jsonify(error=err),400
   vals=[label,str(x.get('rne') or '').strip(),str(x.get('table') or '').strip() or '仕掛',
         str(x.get('output') or '').strip(),str(x.get('share') or '').strip(),
         str(x.get('preferred') or '').strip(),
         int(x.get('order') or 0),
         0 if str(x.get('enabled') or '').strip()=='無効' else -1,purpose,uid]
   if row:
    cur.execute('UPDATE [データソースマスタ] SET [表示名]=?,[RNEファイル]=?,[抽出テーブル]=?,'
                '[出力ファイル]=?,[共有パス]=?,[既定テーブル]=?,[表示順]=?,[有効]=?,[役割]=?,'
                '[更新者ID]=?,[更新日時]=Now() WHERE [ソースID]=?',vals+[row[0]])
    registered=False;sid=row[0]
   else:
    cur.execute('INSERT INTO [データソースマスタ] ([表示名],[RNEファイル],[抽出テーブル],'
                '[出力ファイル],[共有パス],[既定テーブル],[表示順],[有効],[役割],[更新者ID],'
                '[キー],[登録者ID],[登録日時],[更新日時]) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
                vals+[key,uid])
    registered=True;sid=cur.lastrowid
   c.commit()
  return jsonify(ok=True,id=sid,key=key,registered=registered,updated_by=uid,
                 message='保存しました。読み込み先の切り替えはサーバー再起動後に反映されます。')
 except Exception as e:
  return jsonify(error=f'データソース保存失敗: {e}'),500

@bp.post('/api/data-source-master/update')
def data_source_master_update():
 """既存行の更新(§9.82)。登録側(POST /api/data-source-master)は**キーで
    既存を探す**ため、キーを書き換えると別行の新規登録になってしまう。
    ID指定のこの経路だけがキーそのものを付け替えられる。
    マスタ管理画面の「編集」は元からこのURLへPOSTしており、ルートが無い
    あいだは404で弾かれていた(設備停止マスタと同じ取りこぼし)。"""
 try:
  from ..db_access import ensure_data_source_table
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  sid=x.get('id')
  if sid is None or str(sid).strip()=='':return jsonify(error='更新対象IDがありません。'),400
  sid=int(sid)
  key=str(x.get('key') or '').strip().upper()
  if not _KEY_RE.match(key):
   return jsonify(error='キーは半角英数と _ で1〜40文字にしてください（一覧のURLに使うため）。'),400
  if key=='MASTER':
   return jsonify(error='MASTER はマスタDB自身に予約されています。別のキーにしてください。'),400
  label=str(x.get('label') or '').strip() or key
  purpose=_purpose_of(x)
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_data_source_table(c);cur=c.cursor()
   cur.execute('SELECT [ソースID] FROM [データソースマスタ] WHERE [ソースID]=?',[sid])
   if not cur.fetchone():return jsonify(error='指定のデータソースが見つかりません。'),400
   # 付け替え先のキーが別の行で使われていないか。キーは一覧を指す識別子で、
   # 重なると「どちらの設定で読むのか」が決まらない。
   cur.execute('SELECT [ソースID] FROM [データソースマスタ] WHERE [キー]=? AND [ソースID]<>?',[key,sid])
   if cur.fetchone():
    return jsonify(error=f'キー「{key}」は別のデータソースが使っています。'),400
   err=_purpose_conflict(cur,purpose,exclude_id=sid)
   if err:return jsonify(error=err),400
   cur.execute('UPDATE [データソースマスタ] SET [キー]=?,[表示名]=?,[RNEファイル]=?,[抽出テーブル]=?,'
               '[出力ファイル]=?,[共有パス]=?,[既定テーブル]=?,[表示順]=?,[有効]=?,[役割]=?,'
               '[更新者ID]=?,[更新日時]=Now() WHERE [ソースID]=?',
               [key,label,str(x.get('rne') or '').strip(),
                str(x.get('table') or '').strip() or '仕掛',
                str(x.get('output') or '').strip(),str(x.get('share') or '').strip(),
                str(x.get('preferred') or '').strip(),
                int(x.get('order') or 0),
                0 if str(x.get('enabled') or '').strip()=='無効' else -1,
                purpose,uid,sid])
   c.commit()
  return jsonify(ok=True,id=sid,key=key,registered=False,updated_by=uid,
                 message='保存しました。キー・表示名・読み込み先の変更はサーバー再起動後に反映されます。')
 except Exception as e:
  return jsonify(error=f'データソース更新失敗: {e}'),500

@bp.post('/api/data-source-master/delete')
def data_source_master_delete():
 try:
  from ..db_access import ensure_data_source_table
  x=request.get_json(force=True) or {};uid=request_user_id(x)
  # 画面の削除ボタンは他マスタと同じく id を送る。キー指定も受け付ける
  # (APIを直接叩く運用・以前の呼び出し方との互換)。
  sid=x.get('id')
  key=str(x.get('key') or '').strip().upper()
  if (sid is None or str(sid).strip()=='') and not key:
   return jsonify(error='削除対象がありません。'),400
  path=DBS['MASTER']['path']
  with connect(path,False) as c:
   ensure_data_source_table(c);cur=c.cursor()
   # 物理削除ではなく無効化し、履歴を残す(他マスタと同じ方針)。
   if sid is not None and str(sid).strip()!='':
    cur.execute('UPDATE [データソースマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [ソースID]=?',[uid,int(sid)])
   else:
    cur.execute('UPDATE [データソースマスタ] SET [有効]=0,[更新者ID]=?,[更新日時]=Now() WHERE [キー]=?',[uid,key])
   if cur.rowcount==0:return jsonify(error='指定のデータソースが見つかりません。'),400
   if not key:
    cur.execute('SELECT [キー] FROM [データソースマスタ] WHERE [ソースID]=?',[int(sid)])
    r=cur.fetchone();key=str((r or [''])[0] or '')
   c.commit()
  return jsonify(ok=True,key=key,updated_by=uid,
                 message='無効にしました。一覧から消えるのはサーバー再起動後です。')
 except Exception as e:
  return jsonify(error=f'データソース削除失敗: {e}'),500
