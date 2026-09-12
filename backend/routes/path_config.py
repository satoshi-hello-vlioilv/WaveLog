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
from .common import api_guard

from .. import paths
from ..paths import APP_ROOT as BASE_DIR
from ..config import (RNE_EXTRACT_INTERVAL_SEC_DEFAULT, SCHEDULE_LOCK_TTL_SEC_DEFAULT,
                      SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT,
                      SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT, SCHEDULE_WATCH_PAUSE_SEC_DEFAULT,
                      SCHEDULE_OWNER_PORT_DEFAULT, SCHEDULE_OWNER_TTL_SEC_DEFAULT,
                      RECORDS_BACKUP_EXPORT_INTERVAL_SEC)
from .. import source_capability
from .. import storage_layout
from ..logging_setup import app_logger
from ..db_access import (
 DBS, MEAS_DB, connect,
 PATH_CONFIG_KEYS, path_config_rows, set_path_config, path_config_value,
 SIKALOT_SOURCE, RECORDS_BACKUP_EXPORT_PATH, RECORDS_SHARE_DIR, SCHEDULE_SHARE_PATH,
 parse_match_keys,
)
import json as _json
from ..access_mode import request_user_id
from .body import body, flag, any_
from ..quiet import quiet

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
 'records_backup_export_path':'','schedule_share_path':'','records_share_dir':'',
 # 閲覧用の複製をどれくらいの間隔で見に行くか(§9.202)。**変化があった
 # ときだけ複製する**ので、短くしても無駄な複製は増えない。こちらは
 # 呼び出しのたびに読み直すので再起動は要らない(複製先のパスは要る)。
 'records_backup_export_interval_sec':str(RECORDS_BACKUP_EXPORT_INTERVAL_SEC),
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
 # 共有スケジュールの見張り(§9.188)。
 'schedule_watch_enabled':'auto',
 'schedule_watch_interval_sec':str(SCHEDULE_WATCH_INTERVAL_SEC_DEFAULT),
 'schedule_watch_pause_sec':str(SCHEDULE_WATCH_PAUSE_SEC_DEFAULT),
 # 共有スケジュールの持ち主(§9.192→§9.269)。**既定は on**——共有へ書くのを
 # 1つのスイッチで入れる（LANへ小さな受け口を開くため）。
 'schedule_owner_enabled':'on',
 'schedule_owner_port':str(SCHEDULE_OWNER_PORT_DEFAULT),
 'schedule_owner_ttl_sec':str(SCHEDULE_OWNER_TTL_SEC_DEFAULT),
 # 編集セッションで**操作を止めるか**(§9.291 ③、利用者との確認)。
 # **既定は off＝止めない**——データの整合は「書く役を1台に絞る(§9.192)＋
 # ロック→取り直し→適用→改訂番号(§4.2)＋並べ替えは集合の一致を要求」で
 # 守られており、READONLYが防いでいたのは**人の意図の衝突**だけだった。
 # 厳密に「1設備1人」で運用したい現場のために'on'を残す。
 'schedule_session_block':'off',
 # 予定に組み込んだロットの元データ（仕掛）が変わったときの扱い(§9.375)。
 # **既定は auto＝見つけたら更新**（利用者の指示）。confirm は中身を見せてから。
 'schedule_source_sync':'auto',
}
_PATH_CONFIG_NUMERIC_FIELDS={
 'rne_extract_interval_sec':('RNE抽出間隔(秒)',60),
 'records_backup_export_interval_sec':('測定データの複製を見に行く間隔(秒)',30),
 'schedule_lock_ttl_sec':('スケジュールロックの有効期限(秒)',1),
 'schedule_lock_verify_delay_ms':('ロック確認までの待機時間(ミリ秒)',0),
 'schedule_watch_interval_sec':('共有スケジュールの変化を見る間隔(秒)',5),
 'schedule_watch_pause_sec':('取り込んだあと休む時間(秒)',0),
 'schedule_owner_port':('持ち主の受け口のポート',1025),
 'schedule_owner_ttl_sec':('持ち主の目印の有効期限(秒)',30),
 # 不要ファイルの掃除(§9.249 ①)。最小値は file_cleanup 側の下限と揃える。
 'cleanup_interval_sec':('不要ファイルの掃除の間隔(秒)',300),
 'cleanup_keep_days':('掃除で残す日数',1),
 'cleanup_keep_generations':('掃除で残す世代数',1),
}

def _pc_name_now():
 """この端末の呼び名と、その出どころ。**読めなくても落ちない**。"""
 try:
  from ..access_mode import pc_name_info
  info=pc_name_info()
  return str(info.get('name') or ''),str(info.get('source') or '')
 except Exception as _e:
  quiet('この端末の名前を引けない（空で返す）',_e)
  return '',''

# 選択肢を持つ設定（キー -> (画面での呼び名, 受け付ける値)）。
# **空文字は常に許す**——「既定へ戻す」の意味で、行そのものを消す。
_PATH_CONFIG_CHOICE_FIELDS={
 'sikalot_source':('参照データの取得元',('network','local')),
 'rne_extract_enabled':('RNE抽出の定期実行',('auto','on','off')),
 'db_mirror_enabled':('共有DBの写し',('auto','on','off')),
 'schedule_watch_enabled':('共有スケジュールの見張り',('auto','on','off')),
 'schedule_owner_enabled':('共有スケジュールの書き込み役',('on','off')),
 'schedule_session_block':('編集セッションで操作を止める',('on','off')),
 'builtin_quality_join':('既定の品質データ結合',('on','off')),
 'schedule_source_sync':('元データが変わったときの扱い',('auto','confirm')),
 'cleanup_auto_enabled':('不要ファイルの定期掃除',('on','off')),
}
# 自由に書ける文字列の設定（置き場と端末名）。空欄なら既定へ戻る。
# `pc_name`はこの端末の呼び名(§9.208 ⑧)——OSから取れない端末が名乗り直すため。
_PATH_CONFIG_TEXT_FIELDS=('records_backup_export_path','schedule_share_path',
                          'records_share_dir',
                          'rne_assets_dir','rne_conf_path','pc_name')


# ---- 置き場は`backend/storage_layout.py`が答える(§9.260→§9.267) ----------
# §9.260では作業予定・測定データ・マスタの3つだけをここで組み立てていたが、
# `config/local.json`の側（マスタDB自身の置き場を決める4つ）が入っていな
# かった。**同じ問いに2つの答えを持たない**（§9.163）ので、組み立ては
# `storage_layout.layout()`の1箇所へ移し、ここは口だけを持つ。
# ---- 置き場は`backend/storage_layout.py`が答える(§9.260→§9.267) ----------
# §9.260では作業予定・測定データ・マスタの3つだけをここで組み立てていたが、
# `config/local.json`の側（マスタDB自身の置き場を決める4つ）が入っていな
# かった。**同じ問いに2つの答えを持たない**（§9.163）ので、組み立ては
# `storage_layout.layout()`の1箇所へ移し、ここは口だけを持つ。
def _master_note():
 """マスタの行に添える一言。**共有に置いたときと置いていないときで違う**
 （§9.263）——置いていない端末に「共有で動いています」と書かない。"""
 from .. import master_share
 if master_share.is_shared():
  return ('共有で動いています。書くときは順番待ち（ロック→取り直し→反映）を通り、'
          '読むのはこの端末の写しからです。')
 return ('この端末の中だけです。共有フォルダへ移すと、'
         '書き込みが重ならないよう順番待ちを通る形で動きます。')

def master_share_is_shared():
 from .. import master_share
 return master_share.is_shared()

def _share_kind(path):
 """置き場の種類。'network'／'cloud'／'local'／''（分からない）。"""
 raw=str(path or '')
 if not raw:return ''
 try:
  if paths.is_network_path(raw):return 'network'
 except Exception as _e:quiet('置き場の種類を確かめられない（分からないものとして続ける）',_e)
 try:
  if paths.cloud_sync_hint(Path(raw)):return 'cloud'
 except Exception as _e:quiet('置き場の種類を確かめられない（分からないものとして続ける）',_e)
 return 'local'

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
  from ..db_access import data_source_rows, source_override_key, _source_path
  # データソースは利用者が増減できる(データソースマスタ)。**キーが必ず在る
  # 前提で書かない** —— 消された途端にパス設定画面ごと開けなくなる。
  # 画面はこの一覧から欄を組み立てる(§9.81)。以前は「仕掛(SIKALOTNOW)」
  # 「品質データ(SIKALOTDEF)」と決め打ちで書かれており、データソースを
  # 増やしても増えず、名前を変えても古いままだった。
  # **今マスタに登録されている行から作る**(§9.163)。以前はプロセス起動時の
  # スナップショット(DATA_SOURCES)を見ていたため、データソースを足した直後は
  # その読み込み先の欄が画面に無く、**再起動するまで設定すらできなかった**。
  # 登録された行はすぐ欄を出し、この端末でまだ読んでいないものは
  # loaded=False として「再起動後に反映」と書く。
  try:
   with connect(path,True) as c:ds_rows=data_source_rows(c)
  except Exception as _e:
   quiet('マスタを開けない（保存値なしで組み立てる）',_e)
   ds_rows=[]
  sources=[]
  for x in ds_rows:
   vk=source_override_key(x['key'])
   live=DBS.get(x['key']) or {}
   sources.append({'key':x['key'],'label':x['label'],'valueKey':vk,
                   'saved':saved.get(vk,''),
                   'loaded':bool(live),
                   'active':str(live.get('path','')),
                   # 再起動したらどこを読むか。**保存済みの設定で計算する**ので、
                   # 再起動する前に打ち間違いに気づける。
                   'planned':str(_source_path(x,saved)),
                   'output':str(rne_scheduler._output_path(x)),
                   'share':x.get('share',''),'rne':x.get('rne','')})
  active={
   'sikalot_source':SIKALOT_SOURCE,
   'rne_assets_dir':str(rne_scheduler.assets_dir()),
   'rne_conf_path':str(rne_scheduler.conf_path()),
   'records_backup_export_path':str(RECORDS_BACKUP_EXPORT_PATH) if RECORDS_BACKUP_EXPORT_PATH else '',
   # **解決したあとの値**を出す（§9.262）。フォルダを指定できるので、
   # 保存値のままだと「どのファイルを読み書きするのか」が画面から分からない。
   'schedule_share_path':str(SCHEDULE_SHARE_PATH) if SCHEDULE_SHARE_PATH else '',
   'records_share_dir':str(RECORDS_SHARE_DIR) if RECORDS_SHARE_DIR else '',
   'rne_extract_enabled':str(path_config_value('rne_extract_enabled','auto') or 'auto'),
   'rne_extract_interval_sec':str(path_config_value('rne_extract_interval_sec',RNE_EXTRACT_INTERVAL_SEC_DEFAULT)),
   'records_backup_export_interval_sec':str(path_config_value('records_backup_export_interval_sec',RECORDS_BACKUP_EXPORT_INTERVAL_SEC)),
   'db_mirror_enabled':str(path_config_value('db_mirror_enabled','auto') or 'auto'),
   'db_mirror_interval_sec':str(path_config_value('db_mirror_interval_sec','60')),
   'schedule_lock_ttl_sec':str(path_config_value('schedule_lock_ttl_sec',SCHEDULE_LOCK_TTL_SEC_DEFAULT)),
   'schedule_lock_verify_delay_ms':str(path_config_value('schedule_lock_verify_delay_ms',SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT)),
   # 作り直せるファイル(写し・スケジュールの作業コピー)の実際の置き場(§9.109)。
   # **設定項目ではない**——db_dirが共有/クラウド同期フォルダーの上のときだけ
   # 自動で手元へ移るので、どこになったかを確かめるためだけに出す。
   # この端末の呼び名(§9.208 ⑧)。設定で名乗り直したときの「いま」と
   # 突き合わせられるように、解決した結果と出どころを返す。
   'pc_name':_pc_name_now()[0],'pc_name_source':_pc_name_now()[1],
   'work_dir':str(paths.work_dir()),
   'work_dir_reason':paths.work_dir_reason(),
   # マスタDB・測定データDBは**手元のもの**(§9.109で移さないと決めた側)。
   # BOX等の同期フォルダーの中に置いたまま複数のPCで同じファイル群を起動
   # すると、**全員が同じmaster.sqlite3へ書く**ことになり、同期の衝突で
   # 設定が失われうる。判定はサーバーが答える（画面で推測しない）。
   'master_cloud':paths.cloud_sync_hint(paths.db_dir()),
   'db_dir':str(paths.db_dir()),
   # マスタDB・測定データDBの実際の場所。**設定項目ではない**が、共有へ
   # 移すときに「いまどこか」が分からないと動かしようがない。
   'master_db_path':str(DBS['MASTER']['path']),
   'records_db_path':str(MEAS_DB),
  }
  for src in sources:
   values.setdefault(src['valueKey'],src['saved'])
   # **「いま効いている値」も登録されたデータソースぶんだけ作る**(§9.163)。
   # 以前は仕掛/品質の2件ぶんしか入れておらず、3件目以降は現在値が空欄の
   # ままだった——画面は「保存値≠現在値」を再起動待ちの印にするので、
   # 増やしたデータソースは**再起動しても永久に「再起動待ち」**と出た
   # （これが「固定のソースの参照先しか登録できない」の実体）。
   active[src['valueKey']]=src['active']
  return jsonify(ok=True,values=values,defaults=_PATH_CONFIG_DEFAULTS,active=active,
                 sources=sources,master_path=str(path))
 except Exception as e:return jsonify(error=f'パス設定読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

@bp.post('/api/path-config-master')
def path_config_master_update():
 try:
  # 鍵は`_PATH_CONFIG_*_FIELDS`と、登録済みデータソースぶんの`<キー>_path`
  # ——**実行時にしか分からない**ので spec では宣言できない。
  x=body({})
  uid=request_user_id(x)
  errors=[]
  # ---- 選択肢を持つ設定は1つの表で受ける(§9.208 ⑨) ----
  # 以前は`sikalot_source`と`rne_extract_enabled`だけを名指しで受けており、
  # **画面に欄があるのに保存側に無い設定**が3つあった
  # (`schedule_watch_enabled`・`schedule_owner_enabled`・`db_mirror_enabled`)。
  # 触っても何も起きず、開き直すと元に戻る——一番分かりにくい壊れ方なので、
  # 受け取る側も1箇所にまとめる。
  choice_values={}
  for key,(label,allowed) in _PATH_CONFIG_CHOICE_FIELDS.items():
   if key not in x:continue
   raw=str(x.get(key) or '').strip()
   if raw and raw not in allowed:
    errors.append(f'{label}は「'+'」「'.join(allowed)+'」のいずれかを指定してください。');continue
   choice_values[key]=raw
  numeric_values={}
  for key,(label,minimum) in _PATH_CONFIG_NUMERIC_FIELDS.items():
   if key not in x:continue                      # 送られてこなかった項目は触らない(下記)
   raw=str(x.get(key) if x.get(key) is not None else '').strip()
   if not raw:
    numeric_values[key]='';continue
   try:n=int(raw)
   except ValueError:errors.append(f'{label}は整数で入力してください。');continue
   if n<minimum:errors.append(f'{label}は{minimum}以上で入力してください。');continue
   numeric_values[key]=str(n)
  if errors:return jsonify(error=' / '.join(errors)),400
  # **データソースの読み込み先はここに固定で書かない**(§9.163)。以前は
  # 'sikalotnow_path'/'sikalotdef_path'を必ず書いており、キーを変えた環境では
  # 画面が送っていない古いキーへ毎回空文字を書き込んでいた（＝消していた）。
  # 個別上書きは下の「登録済みデータソースぶん」だけが受け付ける。
  #
  # **送られてこなかった項目は触らない**(§9.192で判明)。固定キーの側は
  # 「x.get(k) or ''」で必ず書いていたため、**一部だけを送る呼び出しが
  # 残りの設定を黙って消していた**（`{'user_id':...}`だけのPOSTで
  # `schedule_share_path`の行が消え、以降その端末ではスケジュール機能が
  # 「未設定」になる。検証の通しで実際に踏んだ）。画面は全項目を送るので
  # 「空欄で保存＝既定へ戻す」は今までどおり効く（キーは送られてくる）。
  updates=dict(choice_values)
  for key in _PATH_CONFIG_TEXT_FIELDS:
   if key in x:updates[key]=str(x.get(key) or '').strip()
  updates.update(numeric_values)
  # データソースごとの個別上書き(<キー小文字>_path)。マスタに登録された
  # ぶんだけ受け付ける(任意のキーを書けるようにはしない)。
  # **今マスタにある行を見る**(§9.163)。起動時のスナップショットで見ると、
  # 足したばかりのデータソースの読み込み先が黙って捨てられる（画面には
  # 欄が出ているのに保存されない、という一番分かりにくい壊れ方になる）。
  from ..db_access import data_source_rows, source_override_key
  path=DBS['MASTER']['path']
  try:
   with connect(path,True) as c:ds_rows=data_source_rows(c)
  except Exception as _e:
   quiet('マスタを開けない（保存値なしで組み立てる）',_e)
   ds_rows=[]
  for src in ds_rows:
   k=source_override_key(src['key'])
   if k in x:updates[k]=str(x.get(k) or '').strip()
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
  except Exception as _e:
   quiet('この置き場を候補に足せない（残りの候補を出す）',_e)
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
  # 「再起動したらどこを読むか」は**保存済みの設定**で計算する(§9.163)ので、
  # 打ち間違いに再起動する前に気づける。読み方(§9.168)も同じ関数で答える。
  from ..db_access import source_read_mode,_source_path,source_override_key
  saved={}
  try:
   with connect(path,True) as c:saved=path_config_rows(c)
  except Exception as _e:quiet('マスタを開けない（保存値なしで組み立てる）',_e);saved={}
  items=[]
  for r in rows:
   rne=rne_scheduler.rne_path(r['rne']) if r.get('rne') else None
   out=rne_scheduler._output_path(r)
   # **この設定で何ができるか／できない理由**(§9.163)。役割を選んだだけでは
   # 決まらない（行にロット番号・設備名の列が無いと画面は黙って機能を出さない）
   # ため、実際にファイルを開いて確かめた結果を添える。判定は
   # backend/source_capability.py の1箇所が持つ。
   try:cap=source_capability.describe(r)
   except Exception as e:
    app_logger().warning('データソース「%s」のできることを確かめられませんでした: %s',r['key'],e)
    cap={'key':r['key'],'table':'','columnCount':0,
         'error':f'確かめられませんでした: {e}','features':{}}
   items.append({**r,
                 'capability':cap,
                 # 画面の言葉はサーバーが決める(§9.168)。'direct'は
                 # パス設定の個別上書きが入っているときだけ名乗る。
                 'readMode':source_read_mode(r,saved),
                 'overridePath':str(saved.get(source_override_key(r['key']),'') or ''),
                 'plannedPath':str(_source_path(r,saved)),
                 'loaded':bool(_DBS.get(r['key'])),
                 'activePath':active.get(r['key'],''),
                 # **いま出ている名称**(§9.183)。表示名も接続先と同じく起動時に
                 # 1回だけ決まるため、保存値と食い違うことがある。
                 'activeLabel':str((_DBS.get(r['key']) or {}).get('label','') or ''),
                 'rnePath':str(rne) if rne else '',
                 'rneExists':bool(rne and rne.exists()),
                 'outputPath':str(out),
                 'outputExists':out.exists(),
                 'enabled':'有効' if r['active'] else '無効',
                 'listed':bool(r.get('listed',True)),
                 'listedText':'出す' if r.get('listed',True) else '出さない',
                 # いま効いている値(§9.183と同じ扱い)。左メニューの元になる
                 # カタログはDBSの写しから作るので、保存しても再起動までは
                 # 変わらない——違うときだけ画面が「再起動待ち」と言う。
                 'activeListed':(bool((_DBS.get(r['key']) or {}).get('listed',True))
                                 if _DBS.get(r['key']) else None),
                 'purpose':r.get('purpose') or 'その他'})
  # 選べる役割と、いまそれが付いている行(§9.193)。**画面が推測しない**——
  # 「仕掛／品質／スケジュールは各1件」という決まりを持っているのはこちら
  # なので、どれが埋まっているかもこちらが答える(選ぶ前に分かる)。
  from ..db_access import DATA_SOURCE_PURPOSES,PURPOSE_OTHER
  holder={}
  try:
   with connect(path,True) as c:
    cur=c.cursor()
    for pv in DATA_SOURCE_PURPOSES:
     if pv==PURPOSE_OTHER:continue
     holder[pv]=_purpose_holder(cur,pv)
  except Exception as e:
   app_logger().warning('役割の割り当てを確かめられませんでした: %s',e)
  # 突合キーは**この画面から消した**（§9.367、利用者の指示「データ接続部には
  # なくてもよい」）。突合の設定はマスタ管理 > クエリ結合の1行が持つ。
  # `[突合キー]`の列は**一度きりの移行の材料**としてだけ残っている
  # （`master_repo.migrate_finish_join()`）ので、画面へは返さない。
  return jsonify(ok=True,items=items,master_path=str(path),
                 purposes=[pv for pv in DATA_SOURCE_PURPOSES if pv!=PURPOSE_OTHER],
                 purposeHolders=holder,
                 assetsDir=str(rne_scheduler.assets_dir()),
                 confPath=str(rne_scheduler.conf_path()),
                 confExists=rne_scheduler.conf_path().exists())
 except Exception as e:
  return jsonify(error=f'データソース読込失敗: {e}',master_path=str(DBS['MASTER']['path'])),500

_KEY_RE=re.compile(r'^[A-Za-z0-9_]{1,40}$')

def _read_mode_of(x,current=''):
 """画面から来た読み方を正規化する(§9.168)。'share'/'rne' 以外は空欄
    （＝全体設定に従う）。**'direct' は保存しない**——直接指定は
    パス設定マスタの個別上書き(<キー>_path)の有無そのものなので、
    2箇所に持つと必ず食い違う。

    **「いま効いている値」を保存値に混ぜないこと**（§9.250 ⑩）。以前は
    `x.get('mode') or x.get('readMode') or ''`と書いており、`mode`（保存値）が
    **空欄＝全体設定に従う**のときに`readMode`（`source_read_mode()`が解決した
    **効いている値**）へ落ちていた。一覧はこの2つを両方返すので、画面が行を
    そのまま送り返すだけで**空欄が`share`に焼き付く**——名称を1文字直しただけで
    「共有を直接読む」に変わり、抽出ジョブからそのソースが消える（実機で
    `test_datasource`が「抽出ジョブも同じマスタから作られる」で落ちた）。
    §9.163の「保存値と効いている値を混ぜない」と同じ罠。

    **送っていないときは今の値を残す**（§9.212 ②）——`mode`を持たない古い
    呼び出しの保存で、設定してある読み方を巻き添えで消さない。"""
 from ..db_access import _read_mode_value
 if 'mode' in x:return _read_mode_value(x.get('mode') or '')
 if 'readMode' in x and str(x.get('readMode') or '') in ('share','rne'):
  # `readMode`しか持たない画面は、明に選んだ2つだけを保存値として受ける
  # （`direct`と空欄は「解決の結果」なので保存しない）。
  return _read_mode_value(x.get('readMode'))
 return _read_mode_value(current)

def _save_source_override(key,value,uid):
 """読み込み先の個別上書き。**データソースの行から直接触れる**ようにした
    （§9.168。以前はパス設定タブにしか無く、同じ「どこを読むか」の設定が
    2つの画面に散っていた）。保存先は今までどおりパス設定マスタなので、
    検証用の差し替え(tests/run_all.sh)もそのまま効く。"""
 from ..db_access import source_override_key
 with connect(DBS['MASTER']['path'],False) as c:
  set_path_config(c,source_override_key(key),str(value or '').strip(),uid)

def _purpose_of(x):
 """画面から来た役割を正規化する(§9.87・§9.193)。判定は db_access の1箇所。"""
 from ..db_access import normalize_purpose,PURPOSE_OTHER
 v=str(x.get('purpose') or '').strip()
 if v in ('その他','—','-'):return PURPOSE_OTHER
 return normalize_purpose(v)

def _listed_of(x,purpose):
 """一覧に出すかどうか(§9.193)。**役割「仕掛」だけは隠せない**——測定も
    予定投入もあの一覧から始まるので、隠すと入口が消える。画面にもそう書く。"""
 from ..db_access import PURPOSE_WORK
 if purpose==PURPOSE_WORK:return -1
 v=str(x.get('listed') if x.get('listed') is not None else '').strip()
 if v in ('出さない','非表示','false','0','no'):return 0
 if x.get('listed') is False:return 0
 return -1

def _match_keys_of(x,now):
 """実績との突合キー(§9.364)。**送っていないときは今の値を残す**
    （§9.212 ②。渡し忘れた設定が黙って既定へ戻るのを防ぐ）。
    保存はJSON配列の文字列で揃える——読む側(`parse_match_keys`)は
    読点区切りも受けるが、書く側が2通り作ると見比べられなくなる。"""
 if 'matchKeys' not in x:return now
 return _json.dumps(parse_match_keys(x.get('matchKeys')),ensure_ascii=False)

def _purpose_holder(cur,purpose,exclude_id=None):
 """その役割が今どのキーに付いているか。無ければ空文字。

    **仕掛／品質／スケジュールは各1件だけ**(§9.193、利用者の指示)。判定を
    ここ1箇所に置き、保存時の門番(_purpose_conflict)と画面へ出す「現在: ○○」
    の両方がこれを見る——2つ持つと、画面が「空いている」と言っている役割で
    保存が弾かれる、という食い違いになる。"""
 from ..db_access import PURPOSE_OTHER
 if not purpose or purpose==PURPOSE_OTHER:return ''
 sql='SELECT [キー] FROM [データソースマスタ] WHERE [役割]=? AND [有効]<>0'
 args=[purpose]
 if exclude_id is not None:sql+=' AND [ソースID]<>?';args.append(exclude_id)
 cur.execute(sql,args)
 row=cur.fetchone()
 return str(row[0]) if row else ''

def _purpose_conflict(cur,purpose,exclude_id=None):
 """同じ役割が2行に付くのを防ぐ。**どちらを使うか決められない**ため。
    戻り値: 問題があればメッセージ、無ければ None。"""
 holder=_purpose_holder(cur,purpose,exclude_id)
 if not holder:return None
 return (f'役割「{purpose}」は既に「{holder}」に付いています。'
         '1つの役割は1件だけです。先にそちらを「その他」へ変えてください。')

@bp.post('/api/data-source-master')
@api_guard('データソース保存失敗')
def data_source_master_save():
 from ..db_access import ensure_data_source_table
 x=body({'id': any_,'key': str,'label': str,'rne': str,'table': str,'output': str,
         'share': str,'preferred': str,'purpose': str,'order': any_,'enabled': any_,
         'listed': any_,'mode': any_,'readMode': any_,'overridePath': any_,
         'matchKeys': any_});uid=request_user_id(x)
 key=x.text('key').upper()
 if not _KEY_RE.match(key):
  return jsonify(error='キーは半角英数と _ で1〜40文字にしてください（一覧のURLに使うため）。'),400
 if key=='MASTER':
  return jsonify(error='MASTER はマスタDB自身に予約されています。別のキーにしてください。'),400
 label=x.text('label') or key
 purpose=_purpose_of(x)
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  ensure_data_source_table(c);cur=c.cursor()
  cur.execute('SELECT [ソースID],[読み方],[突合キー] FROM [データソースマスタ] WHERE [キー]=?',[key])
  row=cur.fetchone()
  err=_purpose_conflict(cur,purpose,exclude_id=row[0] if row else None)
  if err:return jsonify(error=err),400
  # **送っていない読み方は今の値を残す**（§9.250 ⑩・§9.212 ②）。
  now_mode=str(row[1] or '') if row else ''
  now_match=str(row[2] or '') if row else ''
  vals=[label,str(x.get('rne') or '').strip(),str(x.get('table') or '').strip() or '仕掛',
        str(x.get('output') or '').strip(),str(x.get('share') or '').strip(),
        str(x.get('preferred') or '').strip(),
        int(x.get('order') or 0),
        0 if str(x.get('enabled') or '').strip()=='無効' else -1,purpose,
        _read_mode_of(x,now_mode),
        _listed_of(x,purpose),_match_keys_of(x,now_match),uid]
  if row:
   cur.execute('UPDATE [データソースマスタ] SET [表示名]=?,[RNEファイル]=?,[抽出テーブル]=?,'
                '[出力ファイル]=?,[共有パス]=?,[既定テーブル]=?,[表示順]=?,[有効]=?,[役割]=?,[読み方]=?,'
                '[一覧表示]=?,[突合キー]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ソースID]=?',vals+[row[0]])
   registered=False;sid=row[0]
  else:
   cur.execute('INSERT INTO [データソースマスタ] ([表示名],[RNEファイル],[抽出テーブル],'
                '[出力ファイル],[共有パス],[既定テーブル],[表示順],[有効],[役割],[読み方],[一覧表示],'
                '[突合キー],[更新者ID],[キー],[登録者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
               vals+[key,uid])
   registered=True;sid=cur.lastrowid
  c.commit()
 # 直接指定(<キー>_path)は同じ保存操作でまとめて書く。**画面が送ったときだけ**
 # 触る——送っていない画面の保存で既存の上書きを消さないため(§9.163で
 # sikalotnow_path を無条件に書いて消していたのと同じ罠)。
 if 'overridePath' in x:_save_source_override(key,x.get('overridePath'),uid)
 return jsonify(ok=True,id=sid,key=key,registered=registered,updated_by=uid,
                message='保存しました。読み込み先の切り替えはサーバー再起動後に反映されます。')

@bp.post('/api/data-source-master/update')
@api_guard('データソース更新失敗')
def data_source_master_update():
 """既存行の更新(§9.82)。登録側(POST /api/data-source-master)は**キーで
    既存を探す**ため、キーを書き換えると別行の新規登録になってしまう。
    ID指定のこの経路だけがキーそのものを付け替えられる。
    マスタ管理画面の「編集」は元からこのURLへPOSTしており、ルートが無い
    あいだは404で弾かれていた(設備停止マスタと同じ取りこぼし)。"""
 from ..db_access import ensure_data_source_table
 x=body({'id': any_,'key': str,'label': str,'rne': str,'table': str,'output': str,
         'share': str,'preferred': str,'purpose': str,'order': any_,'enabled': any_,
         'listed': any_,'mode': any_,'readMode': any_,'overridePath': any_,
         'matchKeys': any_});uid=request_user_id(x)
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
  cur.execute('SELECT [ソースID],[読み方],[突合キー] FROM [データソースマスタ] WHERE [ソースID]=?',[sid])
  cur_row=cur.fetchone()
  if not cur_row:return jsonify(error='指定のデータソースが見つかりません。'),400
  # **送っていない読み方は今の値を残す**（§9.250 ⑩・§9.212 ②）。
  now_mode=str(cur_row[1] or '')
  now_match=str(cur_row[2] or '')
  # 付け替え先のキーが別の行で使われていないか。キーは一覧を指す識別子で、
  # 重なると「どちらの設定で読むのか」が決まらない。
  cur.execute('SELECT [ソースID] FROM [データソースマスタ] WHERE [キー]=? AND [ソースID]<>?',[key,sid])
  if cur.fetchone():
   return jsonify(error=f'キー「{key}」は別のデータソースが使っています。'),400
  err=_purpose_conflict(cur,purpose,exclude_id=sid)
  if err:return jsonify(error=err),400
  cur.execute('UPDATE [データソースマスタ] SET [キー]=?,[表示名]=?,[RNEファイル]=?,[抽出テーブル]=?,'
               '[出力ファイル]=?,[共有パス]=?,[既定テーブル]=?,[表示順]=?,[有効]=?,[役割]=?,[読み方]=?,'
               '[一覧表示]=?,[突合キー]=?,[更新者ID]=?,[更新日時]=Now() WHERE [ソースID]=?',
              [key,label,str(x.get('rne') or '').strip(),
               str(x.get('table') or '').strip() or '仕掛',
               str(x.get('output') or '').strip(),str(x.get('share') or '').strip(),
               str(x.get('preferred') or '').strip(),
               int(x.get('order') or 0),
               0 if str(x.get('enabled') or '').strip()=='無効' else -1,
               purpose,_read_mode_of(x,now_mode),_listed_of(x,purpose),
               _match_keys_of(x,now_match),uid,sid])
  c.commit()
 if 'overridePath' in x:_save_source_override(key,x.get('overridePath'),uid)
 return jsonify(ok=True,id=sid,key=key,registered=False,updated_by=uid,
                message='保存しました。キー・表示名・読み込み先の変更はサーバー再起動後に反映されます。')

@bp.post('/api/data-source-master/probe')
def data_source_master_probe():
 """**保存する前に確かめる**(§9.168)。編集中の下書き（読み方・パス・
    テーブル名）そのままで実際にファイルを開き、
      ・開けたか／開けないなら理由
      ・中にある表と列数
      ・この設定で何ができるか（一覧・測定・予定・結合）
    を返す。接続先はサーバー起動時に1回だけ決まるので、**保存しても
    再起動するまで一覧には出ない**——それまで打ち間違いに気づけないのが
    今までの一番の不便だった。

    **読むだけ**で、マスタには何も書かない。"""
 try:
  x=body({'id': any_,'key': str,'label': str,'rne': str,'table': str,'output': str,
         'share': str,'preferred': str,'purpose': str,'order': any_,'enabled': any_,
         'listed': any_,'mode': any_,'readMode': any_,'overridePath': any_,
         'matchKeys': any_})
  from ..db_access import source_read_mode,_source_path,source_override_key
  key=str(x.get('key') or '').strip().upper() or 'PROBE'
  entry={'key':key,'label':str(x.get('label') or '').strip() or key,
         'rne':str(x.get('rne') or '').strip(),
         'table':str(x.get('table') or '').strip() or '仕掛',
         'output':str(x.get('output') or '').strip(),
         'share':str(x.get('share') or '').strip(),
         'preferred':str(x.get('preferred') or '').strip(),
         'purpose':str(x.get('purpose') or '').strip(),
         'mode':_read_mode_of(x)}
  # 直接指定は画面の下書きを使う（保存済みの上書きは見ない。**いま欄に
  # 入っている値**で確かめたいのがこのAPIの目的）。
  override=str(x.get('overridePath') or '').strip()
  cfg_map={source_override_key(key):override}
  path=_source_path(entry,cfg_map)
  cap=source_capability.describe({**entry,'_path':str(path)},path=path)
  return jsonify(ok=True,key=key,readMode=source_read_mode(entry,cfg_map),
                 path=str(path),capability=cap)
 except Exception as e:
  # **確かめる操作で画面を壊さない**。読めなかったことも結果のうち。
  return jsonify(ok=True,error=f'確かめられませんでした: {e}',capability={'features':{}}),200

@bp.post('/api/data-source-master/delete')
@api_guard('データソース削除失敗')
def data_source_master_delete():
 from ..db_access import ensure_data_source_table
 x=body({'id': any_,'key': str});uid=request_user_id(x)
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


# ========================================================================
# 置き場を1枚で（§9.267、利用者の指示「マスタの置き場、スケジュールの置き場、
# 測定データの置き場、バックアップの置き場などを含めた全ての設定を共通設定に
# 視覚的に表現した上で…設定を簡単にわかりやすく」）
# ========================================================================
# **判定は`storage_layout`が持つ**（§9.163）。ここは口だけで、画面は
# 返ってきた答えをそのまま並べる。
@bp.get('/api/storage-layout')
def storage_layout_get():
 try:
  return jsonify(ok=True,**storage_layout.layout())
 except Exception as e:
  app_logger().exception('置き場の一覧を作れませんでした')
  return jsonify(error=f'置き場の一覧を作れませんでした: {e}'),500

@bp.post('/api/storage-layout/local-config')
def storage_layout_local_config():
 """`config/local.json` を書き換える。

 **鶏と卵なのは読む側だけ**——起動時にマスタDBの場所を知るために外の
 ファイルが要る、という話であって、書く側を画面から塞ぐ理由は無い。
 塞いだままにしていたので、置き場の設定だけが画面の外に残っていた。
 """
 x=body({k: str for k in storage_layout.LOCAL_CONFIG_KEYS})
 updates={k:x[k] for k in storage_layout.LOCAL_CONFIG_KEYS if k in x}
 if not updates:
  return jsonify(error='変える項目がありません。'),400
 try:
  values,backup=storage_layout.save_local_config(updates)
 except storage_layout.LocalConfigError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  app_logger().exception('config/local.json を書けませんでした')
  return jsonify(error=f'config/local.json を書けませんでした: {e}'),500
 app_logger().info('config/local.json を更新しました: %s',sorted(updates))
 # **効くのは再起動から**（起動時に1回だけ読む値なので）。黙って
 # 「保存しました」だけ返すと、直したのに変わらないと読まれる。
 return jsonify(ok=True,values=values,backup=backup,
                path=str(storage_layout.local_config_path()),
                restartRequired=True,
                layout=storage_layout.layout())

@bp.post('/api/storage-layout/prepare')
def storage_layout_prepare():
 """置き場が無ければ作る。**既定は下見**（§9.193）。

 利用者の指示「設定さえ書いてあればフォルダやファイルが存在しない場合には
 強制的に作成して、ユーザーの操作を妨げないように。但し作成する前に
 ユーザーに確認する方式にして欲しい」——確認できる材料（何を作るのか）を
 先に返し、`apply:true` で初めて作る。
 """
 x=body({'path': str,'mode': str,'apply': flag})
 try:
  plan=storage_layout.prepare_path(x.get('path'),x.text('mode') or 'dir',
                                   apply=x.flag('apply'))
 except storage_layout.LocalConfigError as e:
  return jsonify(error=str(e)),400
 except Exception as e:
  app_logger().exception('置き場を用意できませんでした')
  return jsonify(error=f'置き場を用意できませんでした: {e}'),500
 return jsonify(ok=True,plan=plan)
