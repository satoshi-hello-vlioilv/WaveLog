"""access_mode.py: 編集可能モード/閲覧モード/スケジュールモードの判定・切替・書込ガード。

複数の設備でこのアプリをローカル運用しており、通常は測定データの書き込みが
1台に閉じている想定(config/local.jsonのrecords_backup_export_pathで、その
1台が測定データバックアップをBox等へ複製し、他端末はそれを閲覧するだけ、
という運用を想定している)。

このモジュールは、この端末のログインID+PC名の組み合わせをアクセス権限
マスタ(backend/repositories/master_repo.py)と照合し、起動時の初期モードを
決める。該当行が無ければ「編集可能」を既定とする(既存の単一書き込みPC
運用を壊さないため。閲覧専用/スケジュール専用にしたい端末だけ明示的に登録する)。

3モード(docs/SCHEDULE_MODE_DESIGN.md §3.1):
  edit     編集可能モード   測定データ・マスタへ書込可、作業予定へは読み取りのみ
  view     閲覧モード       すべて読み取りのみ
  schedule スケジュールモード 作業予定へ書込可、測定データ・マスタは読み取りのみ
             (閲覧モードの上位互換ではない。測定データ・マスタは閲覧モードと
              同じく禁止で、作業予定という別ドメインの書込だけが開く)

現場段取り(§3.1.1)はモードとは別軸の真偽値(現場段取り可否)で、editモードの
端末に限り「作業予定の並べ替えAPIだけ」を追加で許可する権限。モードを増やす
のではなく書込1操作だけを許可する権限として設計している。

起動後は、権限のあるモードへPOST /api/access-modeで切り替えられる(切替可能な
モードの組み合わせは§3.2の表を参照)。権限は呼び出しのたびにマスタを読み直して
判定するため、権限側の変更(マスタ編集)が次回の切替から即座に反映される
(再起動不要)。

モードはこのFlaskプロセス(=この端末)のメモリ上の状態であり、同じ端末で
開いている複数タブ間で共有される(単一端末単一サーバーの前提のため)。
"""
from flask import request, jsonify
import os
import socket
import threading

from .db_access import DBS, connect
from .repositories.master_repo import permission_flags

_lock=threading.Lock()
_mode='edit'  # 'edit' | 'view' | 'schedule'

# Blueprint名 -> 非GETを許可するモードの集合。未宣言のBlueprintは従来どおり
# 素通しにする(tables/quality/core等の読み取り専用Blueprintは非GETを持たない)。
# 新しい書込系Blueprintを追加する場合は必ずここへ追記すること(書き漏れは
# 「どのモードでも通らない」側に倒れる安全側の既定)。
_WRITE_ALLOWED_MODES={
 'measurement':{'edit'},
 'masters':{'edit'},
 # masters から分離したBlueprint(フェーズ4.1)。分離前と同じ許可を維持する。
 # **未宣言のままにするとfail-open(全モード素通し)** で、閲覧モードからも
 # 書けてしまう(下の_guard_writeの `if allowed is None: return None`)。
 'path_config':{'edit'},
 'rne':{'edit'},
 'schedule':{'schedule'},
 # 一覧系(tables)。**業務データを書くルートは1本も無い**が、宣言しないと
 # fail-openのまま「たまたま安全」な状態になる。ここに本物の書込を1本
 # 足した瞬間、閲覧モードから書けてしまう。唯一の非GETである
 # 共有DBの写し直しは_READ_ONLY_POST_ENDPOINTS側で全モードへ開けてある。
 'tables':{'edit'},
 # ログ・診断(§9.99)。読み出し(GET)は全モードから通る(ガードはGETを見ない)。
 # **消す・区切るだけをeditへ絞る**——ログは端末ごとのローカルファイルで
 # 共有データではないが、消えると調査ができなくなる。
 'logs':{'edit'},
}
# 上の表より広く許可する例外(エンドポイント名 -> 追加で許可するモード)。
# 現場段取り: 並べ替えAPI(schedule.plan_reorder)だけをeditにも開ける。
# スケジュール列表示マスタ(masters.schedule_column_master_save)は、
# scheduleモードの端末が分割/ポップアップ表示中にその場で表示列を
# 選べるようにするため、マスタ管理(通常はeditモード限定)の例外として
# scheduleモードにも開く(§9.18)。表示設定のみで測定データ・他マスタには
# 触れないため、schedule運用の端末に許可しても実害が無い。
# 新しい書込系エンドポイントをここへ追記する際は、権限の絞り込みを
# ハンドラ側(_field_reorder_permitted等)で必ず二重に行うこと。
# 設定系マスタ(稼働カレンダー・設備停止・勤務体系・換算係数上書き)は、
# 保存先をmaster.sqlite3へ移して(docs/SCHEDULE_MODE_DESIGN.md §9.27)他のマスタと
# 同列になったため、マスタ管理画面を持つeditモードからも書けるようにする。
# scheduleモードはBlueprintの既定(_WRITE_ALLOWED_MODES)で元から書ける。
# これらは設定値であって作業予定(運用データ)ではないため、editへ開いても
# 共有スケジュールDBの排他制御(§4.2)には一切影響しない。
_ENDPOINT_EXTRA_MODES={
 'schedule.plan_reorder':{'edit'},
 # 編集セッション(§9.211 ②、利用者の指示「スケジュール編集者が1名になる
 # まで、後から入った人は編集権を持たずREADONLY」)。現場段取り(edit)の
 # 端末も**同じ設備を並べ替える**のに、セッションの取得口がscheduleモード
 # 限定だったため、edit端末は編集権を取れず・在席にも出ず・2台で同時に
 # 並べ替えられる状態だった(守るのは`with_write()`のロックだけ)。
 # **取る・延ばす・返す・奪うの4つ**をeditへ開ける。取れるのは
 # 「現場段取りの対象設備」に限られる(画面側`sessionApplicable()`が
 # `scState.editable`を見る)ので、無関係な端末が掴むことはない。
 # 一覧(GET /api/schedule/sessions)は読むだけなのでガードの対象外。
 'schedule.session_acquire':{'edit'},
 'schedule.session_heartbeat':{'edit'},
 # **返すのはどのモードからでも通す**(§9.211 ②の追補)。モードを切り替えると
 # `switchAccessMode()`は**先にサーバーのモードを変えてから**画面を開き直す
 # ので、`syncSession()`が投げる解放は**切り替えた後のモード**で評価される。
 # editへしか開けていないと、編集モードで編集権を持っていた端末が閲覧モードへ
 # 移った瞬間の解放が403で落ち、**本人は読み取り専用の画面に居るのに、
 # 他の端末からはTTL(90秒)のあいだ「その端末が編集中」と見え続ける**
 # ——利用者の言う「抜けているのに残っていて編集権が映らない」そのもので、
 # 在席表示を出した今は全員の画面にその嘘が出る。
 # 解放は**権利を手放すだけ**で、`release_session()`が
 # `login`と`pc`の一致を見て**自分の分しか消さない**(schedule_sync.py:385)。
 # 塞いでも守るものが無く、塞ぐと幽霊の持ち主が残る。
 'schedule.session_release':{'edit','view'},
 'schedule.session_take_over':{'edit'},
 'schedule.calendar_save':{'edit'},
 'schedule.stop_reason_register':{'edit'},
 'schedule.stop_reason_update':{'edit'},
 'schedule.stop_reason_delete':{'edit'},
 'schedule.stop_category_register':{'edit'},
 'schedule.stop_category_update':{'edit'},
 'schedule.stop_category_delete':{'edit'},
 # 行の見せ方(§9.198)。**配色とアイコンだけ**で、予定にも測定データにも
 # 触れない。設備停止マスタと同じ「設定値」なので、マスタ管理を持つeditにも
 # 開ける(scheduleはBlueprintの既定で元から書ける)。
 'schedule.row_style_register':{'edit'},
 'schedule.row_style_update':{'edit'},
 'schedule.row_style_delete_route':{'edit'},
 'schedule.shift_pattern_save':{'edit'},
 'schedule.shift_pattern_delete_route':{'edit'},
 'schedule.load_factor_override_save':{'edit'},
 'masters.schedule_column_master_save':{'schedule'},
 'masters.schedule_content_master_save':{'schedule'},
 # 作業スケジュールの履歴(作業中・完了)を消す導線(§9.61)。計画外実績は
 # **バックアップ(records.sqlite3)にしか無い**行から合成されるため、
 # 測定した端末以外(=計画端末)からは消す手段が無く、別PCで作られた行や
 # 削除に失敗した残骸が「データ一覧には無いのにスケジュールには居座る」
 # 状態のまま残っていた。計画盤を整えるのは計画端末の役目なので、
 # scheduleモードにも開く。閲覧モードには開かない(既定のまま拒否)。
 'measurement.backup_delete':{'schedule'},
 # 登録フィルタ(§9.80)。一覧の絞り込み条件は**その端末のその画面の見え方**の
 # 設定で、測定データにも他マスタにも触れない。scheduleモードの端末は
 # 仕掛一覧を主に使うのに、保存だけ403で弾かれていた(しかも画面は失敗を
 # ローカル退避したうえで直後の再読込で消しており、「登録したのに出ない」
 # としか見えなかった)。列表示マスタ(masters.schedule_column_master_save)を
 # scheduleへ開けているのと同じ理由でここも開ける。
 # 対象モードごとに保存先が分かれるので、scheduleで作った条件がeditの一覧へ
 # 混ざることはない。
 'masters.filter_preset_register':{'schedule'},
 'masters.filter_preset_delete':{'schedule'},
 'masters.filter_preset_use':{'schedule'},
 # **印(いつも適用)と持ち主の切り替えも同じ**(§9.190)。ここを開け忘れていた
 # ため、scheduleモードで「いつも適用」に印を付けても403で弾かれ、画面の
 # 控えにだけ残っていた。次に登録フィルタを読み直した時点でサーバーの
 # 答え(印なし)で上書きされ、**「鍵をかけたのに画面を切り替えると外れる」**
 # という形で出ていた(実機で報告)。書込ガードは黙って弾くので、
 # **1つ開け忘れると機能だけが静かに欠ける**。
 'masters.filter_preset_marks':{'schedule'},
 'masters.filter_preset_owner':{'schedule'},
 # 一覧の見せ方(§9.88)。列の並び・幅・表示名・書式・読み替え・行間・
 # いつも使う並び順は、**その画面の見え方**の設定で、測定データにも
 # 業務マスタにも触れない。登録フィルタ・列表示マスタと同じ理由で
 # scheduleへ開ける(スケジュールモードの端末は仕掛一覧を主に使うのに、
 # 列を動かした瞬間だけ403で弾かれる、という形で出る)。
 'masters.column_layout_master_save':{'schedule'},
 'masters.list_view_master_save':{'schedule'},
 'masters.display_rule_master_save':{'schedule'},
 'masters.display_rule_master_delete':{'schedule'},
 'masters.sort_preset_register':{'schedule'},
 'masters.sort_preset_delete':{'schedule'},
 'masters.sort_preset_use':{'schedule'},
}
# 書込ではないがPOSTで受けるもの(§9.50の「今すぐ抽出」)。データを書き換えず、
# 抽出元(RNE)から読み直すだけなので、閲覧モードの端末からも実行できてよい。
# キーは「Blueprint名.関数名」。フェーズ4.1でRNEをrne.pyへ分離したため
# masters. → rne. へ更新した(合わせないと、全モードで叩けたはずの手動実行が
# editモード以外で403になる)。
# 共有DBの写し直し(§9.89)も同じ性質。一覧の「再読込」から呼ばれ、共有上の
# .sqlite3 を手元のキャッシュへ写すだけで、業務データは1行も書き換えない。
# **読むだけのPOST**。データソースの下書き確認(§9.168)は、入力中の設定で
# 実際にファイルを開いて「何ができるか」を返すだけでマスタには1件も書かない。
# 除外せず表に載せるのは、あとで本物の書込を足したときに無防備にならない
# ようにするため(CLAUDE.md「読み取り専用のPOSTしか持たないBlueprintも宣言する」)。
_READ_ONLY_POST_ENDPOINTS={'rne.rne_extract_run','tables.api_db_mirror_refresh',
                           'path_config.data_source_master_probe',
                           # クエリ結合(§9.193)。**読むだけ**——渡された鍵の値に
                           # 相手のデータを当てて返す。POSTなのはキーの組を
                           # まとめて送るためで、URLに載せると長くなりすぎる。
                           'tables.api_query_join_resolve',
                           'masters.query_join_master_probe',
                           # 共有スケジュールを手元へ取り込むだけ(§9.188)。
                           # 作業予定は書き換えないので全モードから通す。
                           'schedule.sync_now'}
# editモードで許可する際、さらに「現場段取り可否」を要求するエンドポイント。
# 作業予定を実際に動かす操作だけが対象で、設定系マスタの保存は含めない。
_FIELD_REORDER_ENDPOINTS={'schedule.plan_reorder'}

def _relayed_identity():
 """持ち主へ中継されてきたリクエストか(§9.192)。そうなら、**頼んだ端末の**
 ログインIDと端末名を返す。

 **ここを通さないと、中継した瞬間に全員が持ち主の名前になる**——ロックの
 保持者も編集セッションも「持ち主PCの誰か」になり、設備単位の排他が
 全端末で自分扱いになって一切効かなくなる。ヘッダは誰でも付けられるので、
 **合言葉を確かめてから**信じること(schedule_owner側で照合する)。"""
 try:
  from flask import request, has_request_context
  if not has_request_context():return None
  from . import schedule_owner
  return schedule_owner.relayed_identity(request.headers)
 except Exception:
  return None

def _relayed_write_ok():
 """持ち主の受け口から**入れ直された**書き込みか(§9.192)。

 中継は「頼んだ端末のFlaskが自分のモードで判定を通したあと」に起きる
 ので、持ち主側でもう一度自分のモードで判定すると**二重に弾く**ことに
 なる（持ち主はたいていeditモードなので、scheduleモードの端末からの
 予定の書き込みが全部403になる）。判定済みの依頼だけを通す。

 通してよい根拠は3つ揃っていることで、どれか1つでも欠けたら通さない:
   ①自分が持ち主である（受け口を開いているのは持ち主だけ）
   ②合言葉が一致する（目印ファイルを読める端末しか知らない）
   ③受け口が通したパスである（RELAY_PATHSのallowlist。受け口の側で判定済み）
 """
 try:
  from . import schedule_owner
  if not schedule_owner.is_owner():return False
  return schedule_owner.relayed_identity(request.headers) is not None
 except Exception:
  return False

def current_login_id():
 who=_relayed_identity()
 if who and who[0]:return who[0]
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return str(username or '').strip()

# ---------- この端末の呼び名（§9.208 ⑧、利用者の指示） ----------
# 「PC名が取得できていないようなので工夫してください。起動時に取得して
#  設定情報として保持する形で、確実に取得を」
#
# `socket.gethostname()`1本だけに頼っていたため、それが空・`localhost`・
# 例外を返す端末では**PC名が丸ごと欠けた**。PC名はアクセス権限マスタとの
# 照合・監査列（誰がどの端末で）・編集セッションの持ち主表示のすべてが
# 見ている値なので、欠けると権限も来歴も分からなくなる。
#
#  ・**出どころを複数持ち、使えた最初のものを採る**
#  ・**起動時に1回だけ決めて持ち続ける**（リクエストのたびに解決し直すと、
#    共有不調のときにそれ自体が失敗の原因になる。§9.109と同じ作法）
#  ・**設定で名乗り直せる**（共通設定の「この端末の名前」）。決め打ちの
#    自動判定だけだと、直す手立てが現場に無い
#  ・**健全な端末の答えを変えない**——`gethostname()`が使える値を返すなら
#    今までどおりそれ（既に登録済みの権限マスタの行を無効にしない）
_USELESS_PC_NAMES={'','localhost','localhost.localdomain','local','unknown',
                   '(none)','none','127.0.0.1','::1','ip6-localhost'}
_pc_name_cache={'name':'','source':'','tried':[]}
_pc_name_lock=threading.Lock()

def _usable_pc_name(v):
 t=str(v or '').strip().strip('.')
 if not t:return ''
 if t.lower() in _USELESS_PC_NAMES:return ''
 return t[:80]

def _pc_name_override():
 """共通設定の`pc_name`。**読めなくても落ちない**（マスタDBがまだ無い端末でも
 起動できること優先）。"""
 try:
  from .db_access import path_config_value
  return _usable_pc_name(path_config_value('pc_name'))
 except Exception:
  return ''

def _pc_name_candidates():
 import platform
 def env(k):
  try:return os.environ.get(k) or ''
  except Exception:return ''
 def host():
  try:return socket.gethostname()
  except Exception:return ''
 def node():
  try:return platform.node()
  except Exception:return ''
 def fqdn():
  try:return str(socket.getfqdn() or '').split('.')[0]
  except Exception:return ''
 def etc():
  try:
   with open('/etc/hostname','r',encoding='utf-8',errors='replace') as f:
    return f.read().strip()
  except Exception:
   return ''
 # 並びは「今までの答え → Windowsの正式な機械名 → 保険」の順。
 return [('設定（共通設定のPC名）',_pc_name_override()),
         ('socket.gethostname()',host()),
         ('COMPUTERNAME',env('COMPUTERNAME')),
         ('platform.node()',node()),
         ('HOSTNAME',env('HOSTNAME')),
         ('socket.getfqdn()',fqdn()),
         ('/etc/hostname',etc())]

def resolve_pc_name(force=False):
 """この端末の呼び名を決めて覚える。戻り値は {'name','source','tried'}。"""
 with _pc_name_lock:
  if not force and _pc_name_cache['name']:return dict(_pc_name_cache)
  tried=[]
  name,source='',''
  for label,raw in _pc_name_candidates():
   ok=_usable_pc_name(raw)
   tried.append({'source':label,'value':str(raw or '')[:80],'usable':bool(ok)})
   if ok and not name:name,source=ok,label
  _pc_name_cache.update({'name':name,'source':source,'tried':tried})
  return dict(_pc_name_cache)

def pc_name_info():
 """画面へ出すための素性（名前・出どころ・試した順）。"""
 info=resolve_pc_name()
 # 設定で名乗り直したときはその場で効かせる（再起動を待たせない）。
 override=_pc_name_override()
 if override and info['name']!=override:info=resolve_pc_name(force=True)
 elif not override and info['source']=='設定（共通設定のPC名）':info=resolve_pc_name(force=True)
 return info

def current_pc_name():
 who=_relayed_identity()
 if who and who[1]:return who[1]
 return pc_name_info()['name']

def _permission_flags():
 # マスタ未整備/未接続でも既定(編集可・スケジュール不可・現場段取り不可)を
 # 維持する(安全側・互換ポリシー。master_repo.permission_flagsの既定と同じ)。
 path=DBS['MASTER']['path']
 if not path.exists():
  return {'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':''}
 try:
  with connect(path,True) as c:
   return permission_flags(c,current_login_id(),current_pc_name())
 except Exception:
  return {'canEdit':True,'canSchedule':False,'canFieldReorder':False,'fieldReorderEquipment':''}

def current_permission_flags():
 # 他モジュール(schedule.pyの現場段取りAPI等)がこの端末の権限を参照する
 # ための公開版。_permission_flags()自体は毎回マスタを読み直す(再起動不要
 # ポリシー)ため、呼び出し側でキャッシュしないこと。
 return _permission_flags()

def _permitted():
 return _permission_flags()['canEdit']

def _field_reorder_permitted():
 return _permission_flags()['canFieldReorder']

def _initial_mode(flags):
 # docs/SCHEDULE_MODE_DESIGN.md §3.2の表のとおり。
 if flags['canEdit']:return 'edit'
 if flags['canSchedule']:return 'schedule'
 return 'view'

def _allowed_modes(flags):
 modes={'view'}
 if flags['canEdit']:modes.add('edit')
 if flags['canSchedule']:modes.add('schedule')
 return modes

def get_mode():
 with _lock:
  return _mode

def install(app):
 global _mode
 # **起動時に1回だけ決めて持ち続ける**(§9.208 ⑧、利用者の指示)。ここで
 # 記録に残しておくと、現地で「PC名が取れていない」と言われたときに、
 # どの出どころを試して何が返ったかがログだけで分かる。
 try:
  info=resolve_pc_name(force=True)
  from .logging_setup import app_logger
  app_logger().info('この端末の名前: %s (出どころ: %s / 試した順: %s)',
                    info['name'] or '（取得できませんでした）',info['source'] or '-',
                    ', '.join(f"{t['source']}={t['value'] or '空'}" for t in info['tried']))
 except Exception:
  pass
 with _lock:
  _mode=_initial_mode(_permission_flags())

 @app.get('/api/access-mode')
 def access_mode_get():
  flags=_permission_flags()
  return jsonify(ok=True,mode=get_mode(),canEdit=flags['canEdit'],canSchedule=flags['canSchedule'],
                 canFieldReorder=flags['canFieldReorder'],fieldReorderEquipment=flags['fieldReorderEquipment'],
                 loginId=current_login_id(),pcName=current_pc_name(),
                 pcNameSource=pc_name_info()['source'])

 @app.post('/api/access-mode')
 def access_mode_set():
  global _mode
  x=request.get_json(force=True) or {}
  mode=str(x.get('mode') or '').strip()
  if mode not in ('edit','view','schedule'):return jsonify(error='modeはedit・view・scheduleのいずれかを指定してください。'),400
  flags=_permission_flags()
  if mode not in _allowed_modes(flags):
   return jsonify(error='この端末はそのモードへ切り替える権限がありません。'),403
  with _lock:
   _mode=mode
  return jsonify(ok=True,mode=get_mode())

 @app.before_request
 def _guard_write():
  if request.method=='GET':return None
  if request.endpoint in _READ_ONLY_POST_ENDPOINTS:return None  # 読み直すだけのPOST(§9.50)
  if _relayed_write_ok():return None   # 持ち主への中継(§9.192)。判定は依頼元で済んでいる
  bp=request.blueprint
  if bp is None:return None            # app直付け(モード切替API・shutdown等)は対象外
  allowed=_WRITE_ALLOWED_MODES.get(bp)
  if allowed is None:return None       # 未宣言のBlueprintは従来どおり素通し
  mode=get_mode()
  if mode in allowed:return None
  extra=_ENDPOINT_EXTRA_MODES.get(request.endpoint)
  if extra and mode in extra:
   # 現場段取り権限を追加で要求するのは並べ替えAPIだけ(§3.1.1)。
   # 以前は「editモードで例外的に許可された非GET」すべてにこの判定を
   # かけていたため、例外を1つ増やすたびに、無関係な設定マスタの保存まで
   # 現場段取り権限が無いと403になっていた(設定系マスタをeditへ開いた
   # ときに実際に踏んだ)。判定対象をエンドポイントで明示する。
   if mode=='edit' and request.endpoint in _FIELD_REORDER_ENDPOINTS and not _field_reorder_permitted():
    return jsonify(error='この端末には現場段取り(並べ替え)の権限がありません。'),403
   return None                         # schedule.plan_reorder自身はequipment一致
                                        # チェックをハンドラ側で行う(§7.5)
  return jsonify(error='現在のモードでは、この操作は実行できません。'),403

 return app
