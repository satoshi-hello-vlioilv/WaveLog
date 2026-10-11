"""core.py: システム系ルート — トップページ・起動確認・バージョン情報・
   デスクトップのショートカット（§9.410）。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, render_template, request, jsonify, Response
import subprocess, time

from ..config import APP_ID, PORT
from .. import app_icon, app_update, boot_status, desktop_shell, desktop_shortcut, terminal_store
# 更新者IDは名乗るだけ・答えるのは1箇所（§9.276 ③）。**読み込み時に入れる**
# ——関数の中の import を増やさない（§9.349）。輪は作らない（access_mode は
# routes を知らない）。
from ..access_mode import current_login_id, current_permission_flags
from ..repositories.master_repo import ROLE_DEFAULT, role_can
from ..changelog_data import APP_VERSION, CHANGELOG, is_dev
from ..paths import APP_ROOT as BASE
from ..logging_setup import app_logger
from ..quiet import quiet
from .body import body, flag
from .common import api_guard

bp=Blueprint('core',__name__)

# CSSは画面ごとに static/css/ へ分けてあるが、**ブラウザへは1本にまとめて返す**。
# 分割の目的は「人が読み書きしやすいこと」なので、配信まで分ける必要はない。
# <link>を16本並べたところ、1ページ表示ごとに16往復増え、起動直後の一覧取得と
# 競合してテストが13件落ちた(索引のページ送りが1ページで止まる等)。
#
# **この並びがカスケードの順序そのもの**。同じ@layerの中では今も
# 「後に書いたほうが勝つ」が効くので、順番を変えると見た目が変わる。
# 並びの唯一の定義はここで、tests/test_csslint.py が同じ並びを固定している。
# **起動用の小さな束**(§9.86)。この2本だけは描画をブロックして先に読ませる。
# 起動オーバーレイ(#appBoot)を最初の描画で出すために必要な最小限で、
# 残り(BODY_CSS_FILES)は描画をブロックしない形で後から読む。
# 分けた理由は実測: 全部を1本のブロッキングCSSにしていると、アプリ本体の
# 最初の描画までブラウザは**何も描かない**(白いまま)。起動待機画面から
# 引き渡した直後の「一瞬の白」がこれだった。
BOOT_CSS_FILES=[
 '00-base.css',        # レイヤの宣言 + トークン + 素の要素
 '95-boot.css',        # 起動オーバーレイ(組み上がるまで本体を見せない)
]
BODY_CSS_FILES=[
 '10-roles.css',       # 役割ごとの寸法・文字(唯一の決定場所)
 '20-shell.css',       # 骨格・左ナビ・ヘッダー・一覧・タブ・ページャ
 '30-measure.css',     # 測定画面
 '35-split.css',       # 条割変更モーダル
 '40-records.css',     # データ一覧・設備設定・保存オーバーレイ
 '45-tolerance.css',   # 公差数直線・フィルタ
 '50-master.css',      # マスタ管理
 '55-quality.css',     # 品質データ分析
 '60-report.css',      # 測定帳票(画面)・ダッシュボード
 '62-actuals.css',     # 実績データリスト・操業データ表(紙とプレビュー)
 '65-calendar.css',    # 実績カレンダー
 '70-schedule.css',    # 作業スケジュール・勤務体系
 '72-bladeset.css',    # 刃組ガイダンス（§9.377）
 '75-master-paths.css',# マスタ管理(パス設定・RNE抽出)
 '80-defect.css',      # 異常位置判定(画面と専用帳票)
 '85-headerbar.css',   # ヘッダーの操作列
 '88-logs.css',        # ログ・診断(ログビュワー)
 '89-loaders.css',     # 読み込み中の見せ方（loaders.css を同梱・§9.421）
 '90-state.css',       # state / mode / print / utility
]
# カスケードの順序そのもの。**起動用が先、本体が後**の並びで読み込まれる。
CSS_FILES=BOOT_CSS_FILES+BODY_CSS_FILES
# アプリのJSの**読み込み順**（§9.324 R3）。起動ローダー（templates/index.html）は
# この並びをそのまま順に挿す（`async=false`）。依存があるので順番が意味を持つ:
#   base.js が先頭（WL・registerView）、access-mode.js が末尾（入口ガード）、
#   master-defs.js → master-maint.js → master-{report,data,opdata}.js
#   （定義 → 盤 → 専用画面。専用画面は盤の `WL.mm` を受け取り、登録簿へ名乗る）。
# **ここが唯一の一覧**——index.htmlへ書き写さない。`tests/test_loadorder.py`が
# 「static/js の全部が1度ずつ載っている」「順の約束」を固定する。
JS_FILES=[
 # 端末の控え（§9.545）。**いちばん先**——画面のJSが localStorage を読む前に、
 # 控えの設定（もう一方の窓で直したもの）を当てておく。
 'core/terminal-sync.js',
 'core/base.js',
 # 失敗を「開発へ報告できる形」で残す（§9.373）。**base のすぐ後**——
 # どの画面よりも先に在れば、読み込みの途中で起きた失敗も拾える。
 'core/feedback.js',
 'core/wl-window.js',
 # 浮きメニューの器のふるまい（§9.448）。置き場所・外クリック・Esc・
 # 矢印キー・role を1箇所で持つ。**画面より先**——どの面も開くときに呼ぶ。
 'core/pop-menu.js',
 'list/list-view.js',
 'list/list-formula.js',
 'list/list-columns.js',
 'list/list-rules.js',
 'measure/measure-view.js',
 'measure/measure-input.js',
 'measure/records-store.js',
 'measure/measure-tolerance.js',
 'measure/lot-split.js',
 'measure/measure-progress.js',
 'measure/measure-opdata.js',
 'measure/measure-steps.js',
 'measure/defect-locator.js',
 'list/filters.js',
 'measure/measure-worklog.js',
 'master/master-defs.js',      # マスタ管理: 定義（MASTER_DEFS / MASTER_GROUPS）
 'master/master-maint.js',     # マスタ管理: 盤（WL.mm を作る）
 'master/master-report.js',    # マスタ管理: 帳票ブロック・帳票レイアウト
 'master/master-data.js',      # マスタ管理: データと接続・作業スケジュール・管理
 'master/master-opdata.js',    # マスタ管理: 操業データ項目・選択肢・記録した値
 'master/master-roll.js',      # マスタ管理: ロールマスタの表の計算の列（1周の長さ・見分けにくい相手・§9.537）
 'master/master-loadfactor.js', # マスタ管理: 換算係数の散布図・積み上げ・係数の図（§9.543）
 'master/master-equse.js',     # マスタ管理: 設備の使い分けの表と効き先の図（§9.542）
 'master/master-access.js',    # マスタ管理: アクセス権限の見張りのタブと行の「できること」（§9.538）
 'master/master-update.js',    # マスタ管理: 共通設定の段「アプリの更新」（版を置く・配る版を選ぶ・§9.555）
 'list/quality-analysis.js',
 # 紙まわりの共通核（§9.332）。用紙の表・@page・mm換算・下限つき比例配分・
 # 刷り出しの段取りを持つ。**紙を出す3本より先に読むこと。**
 'core/print-core.js',
 'report/report-dashboard.js',
 'schedule/calendar-view.js',
 'schedule/schedule-view.js',
 # §9.368: 選んだ予定のロット番号をつないでコピーする（ICASコピー）。
 # schedule-view.js が右クリックメニューから `WL.lotCopy` を呼ぶ。
 'schedule/lot-copy.js',
 'schedule/schedule-print.js',
 # §9.514: 実際の時刻を手で入れる小窓。予定の画面（時刻を入れる）と段「履歴」（時刻を直す）の
 # 両方が`WL.scheduleTimes.open()`を呼ぶ。**履歴より先**に読む。
 'schedule/schedule-times.js',
 # §9.502: 作業スケジュールの過去履歴（段「履歴」）。schedule-view.js が段を切り替えたときに
 # `WL.scheduleHistory.show()` を呼ぶ（読み込んだ時点では何もしない）。
 'schedule/schedule-history.js',
 # §9.580: 初期画面（仕掛一覧）の上の「作業予定」の帯。数え方と始め方は`WL.scheduleView`の口を読むので、その後。
 'schedule/plan-strip.js',
 # 刃組ガイダンス（§9.377）。計算（`blade-core.js`）→ 画面（`blade-view.js`）の順。
 # 画面は`WL.bladeSet`を呼ぶので、この順でしか動かない。
 'bladeset/blade-core.js',
 # 立体図（§9.377 追補）。three.js は**同梱せずCDNから遅延読み込み**するので、
 # このファイル自体は小さい。画面（blade-view.js）より先に読み、`WL.bladeSolid`を
 # 名乗らせる——画面は `attach()` を呼ぶだけになる。
 # 刃組のマスタの盤（§9.529）。共有の作り（頭・2ペイン・判定表）が先、盤が後。
 'bladeset/board-kit.js',    # 刃組: 盤の共有の作り（設備の頭・一覧＋詳細の2ペイン・2択の札）
 'bladeset/rule-table.js',   # 刃組: 判定表の部品（保持方式・刃のカテゴリ・刃厚が共有）
 'bladeset/hold-pick.js',    # 刃組: 保持方式マスタの盤（フィンガー／ゴムリングの判定表）
 'bladeset/blade-pick.js',   # 刃組: 刃選択マスタの盤（刃のカテゴリ・刃厚の2つの判定表。hold-pick の後）
 'bladeset/blade-board.js',  # 刃組: 刃マスタの盤（セットごとのカテゴリ・使用状態と刃厚ごとの行）
 'bladeset/ring-board.js',   # 刃組: ゴムリングの盤（色ごと・幅ごとの本数）
 'bladeset/spacer-outlook.js', # 刃組: スペーサーの在庫の見通し（札・浮く図・全幅の図。stock-board が呼ぶ）
 'bladeset/stock-board.js',  # 刃組: スペーサー・フィンガーの盤（寸法ごとの在庫をその場で直す）
 'bladeset/standard-figs.js', # 刃組: 刃組基準値の節ごとの図（standard-board の前）
 'bladeset/standard-board.js', # 刃組: 刃組基準値の盤（2ペイン・節ごとの図＋欄）
 'bladeset/blade-3d.js',
 'bladeset/blade-view.js',
 # §9.553: 段組の配置（段×24マスの盤・答え・画面の2段組）。紙（opsheet-print）と一覧（actuals-view）が読む。
 'report/record-layout.js',
 'report/actuals-view.js',
 'report/opsheet-print.js',
 'core/log-view.js',
 'core/access-mode.js',
]
_CSS_CACHE={'token':None,'body':''}
_BOOT_CSS_CACHE={'token':None,'body':''}

def _css_dir(): return BASE/'static'/'css'

def _newest_mtime(paths,what):
 """更新時刻の最大値。**ここで例外を出さない**。

 アプリ本体が共有フォルダー上に置かれている場合、stat()はネットワーク越しの
 問い合わせになり、共有が一瞬応答しないだけで失敗し得る(WinError 59 等。
 §9.75と同じ事故が、DBではなく静的ファイルの側で起きる)。この値は
 ブラウザのキャッシュを捨てさせるためだけのものなので、取れなかった
 ファイルは黙って飛ばし、**画面は必ず出す**。全部失敗したときだけ
 バージョン番号で代用する(更新時に必ず変わるので実用上困らない)。"""
 newest=0;failed=[]
 for p in paths:
  try:
   v=p.stat().st_mtime_ns
   if v>newest:newest=v
  except OSError as e:
   failed.append(f'{p.name}({e})')
 if failed:
  app_logger().warning('%sの更新時刻を取得できませんでした(%d件): %s',
                       what,len(failed),' / '.join(failed[:5]))
 return str(newest) if newest else APP_VERSION

def _css_token():
 """CSSの更新時刻。連結結果のキャッシュ鍵と、<link>のキャッシュ破棄に使う。"""
 d=_css_dir()
 return _newest_mtime([d/n for n in CSS_FILES],'CSS')

def _css_bundle(files,cache):
 """指定のCSSを連結して返す。読めない1枚で画面を落とさない。"""
 tok=_css_token()
 if cache['token']!=tok:
  d=_css_dir()
  parts=[];failed=[]
  for n in files:
   try:parts.append(f'/* ===== {n} ===== */\n'+(d/n).read_text(encoding='utf-8'))
   except OSError as e:failed.append(f'{n}({e})')
  if failed:
   # 1枚でも読めなければ見た目は崩れるが、**画面を出さないよりはよい**。
   # 直前に読めた内容が残っていればそちらを使う(共有の一瞬の断で崩さない)。
   app_logger().error('CSSを読み込めませんでした(%d件): %s',len(failed),' / '.join(failed[:5]))
   if cache['body']:
    # 読めなかった回の内容は**キャッシュさせない**(次の表示で直っていて
    # ほしいので、長期キャッシュの対象から外す)。**`no-store`で言うこと**
    # ——`app.py`のcache_policyはこれを「ビューが明示的に降りた」合図として
    # 見る(`no-cache`はFlaskの静的配信が既定で付けるので、合図に使えない)。
    return Response(cache['body'],mimetype='text/css',headers={'Cache-Control':'no-store'})
  cache.update(token=tok,body='\n'.join(parts))
 # URLに更新時刻(?t=)が入っているので、内容が変わればURLごと変わる。
 # **だから長期キャッシュしてよい。** 以前は no-cache で毎回取り直して
 # おり、起動のたびに数百KBを読み直すうえ、media=print から all へ移す
 # ときに再取得(実測30ms)まで発生していた。
 return Response(cache['body'],mimetype='text/css',
                 headers={'Cache-Control':'public, max-age=31536000, immutable'})

@bp.get('/css/boot.css')
def boot_css():
 """起動オーバーレイを最初の描画で出すための最小の束(§9.86)。
 **これだけが描画をブロックする。** 小さいほど白い画面が短くなる。"""
 return _css_bundle(BOOT_CSS_FILES,_BOOT_CSS_CACHE)

@bp.get('/css/app.css')
def app_css():
 """画面本体のCSS。描画をブロックしない形で読み込まれ、読み終わってから
 アプリのJSを動かす(順序は templates/index.html の起動ローダーが持つ)。"""
 return _css_bundle(BODY_CSS_FILES,_CSS_CACHE)

def _git_version():
 # 参考情報(ツールチップ用)。git非対応の配布環境では取得できないため
 # 失敗しても画面表示自体には影響しないようベストエフォートにする。
 try:
  rev=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  when=subprocess.check_output(['git','log','-1','--format=%cI'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip())
  return {'commit':rev,'commit_at':when,'dirty':dirty}
 except Exception as _e:
  quiet('gitの版を読めない（版は空で返す）',_e)
  return {'commit':'','commit_at':'','dirty':False}
GIT_VERSION=_git_version()

@bp.get('/')
def home():
 # **最初の1リクエストで落とさない。** ここは起動直後に必ず通る経路で、
 # 例外を出すと画面が一切出ない(実際に別端末から「起動時にInternal Server
 # Error」とだけ報告が上がった)。更新時刻はキャッシュ破棄のための値なので、
 # 取得できないファイルがあっても飛ばして進む(_newest_mtime)。
 try:js=list((BASE/'static'/'js').rglob('*.js'))   # 領域フォルダ（§9.334）
 except OSError as e:
  app_logger().warning('静的JSの一覧を取得できませんでした: %s',e);js=[]
 token=_newest_mtime(js+[_css_dir()/n for n in CSS_FILES],'静的ファイル')
 # バージョンは起動オーバーレイが最初の描画で出すため、APIを待たずに埋め込む
 # (画面本体のバッジは従来どおり /api/build を読んで差し替える)。
 return render_template('index.html', build='current', asset_token=token, app_version=APP_VERSION,
                        js_files=JS_FILES, terminal=_terminal_settings(),
                        boot_phases=boot_status.PHASES,
                        boot_keys=' '.join(k for k, _ in boot_status.BROWSER_STEPS))


def _terminal_settings():
 """端末の控えの設定（§9.545）。画面のHTMLへ埋めて渡す——画面のJSが読む前に当てるため
 （取りに行くと、その往復のあいだに画面が古い設定で組み上がる）。
 **読めなくても画面は出す**（控えが無いだけで、ブラウザの保存領域はいつもどおり使える）。"""
 try:
  return terminal_store.settings(0)
 except Exception as e:
  app_logger().warning('端末の控えを読めませんでした（画面は控えなしで開きます）: %s',e)
  return None
# ========================================================================
# 「更新は届いたが、まだ再起動していない」の検出(§9.200)
# ------------------------------------------------------------------------
# **JS/CSSはリクエストのたびにディスクから配られるが、Pythonはプロセス起動
# 時に読み込んだきり**。そのため更新後に再起動を忘れると、**新しい画面が
# 古いサーバーへ話しかける**という食い違いが起きる。実機では、新設したAPIを
# 新しいJSが呼び、古いサーバーが404を返し、画面には
# 「<!doctype html> ... 404 Not Found」がそのまま出た(利用者から報告)。
# 原因が「再起動していないこと」だと画面から分からないのが問題なので、
# **サーバー自身に気づかせて画面に出す**。判定は「起動より後に更新された
# .pyがあるか」の1点。**失敗しても黙って「分からない」にする**
# ——stat()は共有越しで落ちうるので、これを理由に /api/build を失敗させない
# ========================================================================
_STARTED_AT=time.time()
def _python_sources():
 out=[]
 try:out.extend(BASE.glob('*.py'))
 except OSError:pass
 try:out.extend((BASE/'backend').rglob('*.py'))
 except OSError:pass
 return [p for p in out if '__pycache__' not in p.parts]

def _python_changed():
 """`.py`が起動より後に更新されたか。True／False／None(確かめられなかった)。"""
 newest=0.0;seen=False
 for p in _python_sources():
  try:
   v=p.stat().st_mtime
   seen=True
   if v>newest:newest=v
  except OSError:
   continue
 if not seen:return None
 # 1秒の余裕。書き出しと起動が同じ秒に重なるだけで「要再起動」にしない。
 return newest>(_STARTED_AT+1.0)

def _restart_needed():
 """戻り値: (要再起動か, 理由)。要再起動か＝True／False／None(確かめられなかった)。

 理由は2つ（§9.552）——`python`＝中身の`.py`が起動より後に更新された／`window`＝窓（exe）が
 配ってある exe より古い（窓は中身を起こし直すので、Python だけ新しくなることがある）。
 **どちらかが真なら真**。中身を確かめられなければ None（「分からない」を「不要」と言わない。
 窓の側の None は「窓の外・比べる名乗りが無い」なので、不要と同じに扱う）。"""
 try:py=_python_changed()
 except Exception as _e:quiet('中身の更新を確かめられない',_e);py=None
 try:win=desktop_shell.stale()
 except Exception as _e:quiet('窓の版を確かめられない',_e);win=None
 if py:return True,'python'
 if win:return True,'window'
 if py is None:return None,''
 return False,''

@bp.get('/api/build')
def build():
 restart,why=_restart_needed()
 return jsonify(build='current', version=APP_VERSION, feature='measurement-workflow-current',
                port=PORT, app_id=APP_ID, restartNeeded=restart, restartWhy=why, startedAt=_STARTED_AT,
                **desktop_shell.summary(), **GIT_VERSION)

@bp.get('/api/whoami')
def whoami():
 # この端末(各測定端末)で実行しているアプリのOSログインユーザー名を返す。
 # マスタ更新記録(登録者ID)に、手入力させず自動で使うためのもの。
 # **答えるのは`access_mode.current_login_id()`の1箇所**（§9.276 ③）——
 # 以前はここにも同じ判定を書き写しており、**権限の照合に使う値と画面が
 # 名乗る値が食い違いうる**状態だった（片方だけ手当てすると、画面には
 # IDが出ているのに権限は空のIDで判定される、が作れる）。
 return jsonify(username=current_login_id())
# ========================================================================
# デスクトップの起動ショートカット（§9.410、利用者の指示⑤）
# ------------------------------------------------------------------------
# 「デスクトップにWaveLogの起動ショートカットを作成する機能が欲しいです。
#   アイコンも設定できますか？」
#
# **判定と組み立ては`desktop_shortcut.py`の1箇所**（§9.163）——画面はここの
# 答えをそのまま出す。作れない端末（Windows以外・入口が無い）は`supported`が
# `false`で理由を持って返るので、画面は**ボタンを出さずに理由を書く**
# （押せるのに何も起きない的を残さない・§CLAUDE 4）。
# ========================================================================
@bp.get('/api/app/shortcut')
@api_guard('ショートカットの状態を読めません')
def app_shortcut_status():
 return jsonify(**desktop_shortcut.status(request.args.get('name','')))

@bp.get('/api/app/icon.png')
@api_guard('アイコンを描けません')
def app_icon_png():
 """既定のアイコンの**見本**（§9.410）。設定の画面が「どの絵で作るか」を
    見せるのに使う——**見本は実物と同じ物で描く**（§9.374）。`.ico`の中身を
    描いているのと同じ`app_icon.render()`を通すので、絵を書き写さない。"""
 size=48
 try:size=max(16,min(256,int(request.args.get('size',48))))
 except (TypeError,ValueError) as e:
  quiet('見本の大きさを読めない（既定の48で描く）',e)
 return Response(app_icon.png(size),mimetype='image/png',
                 headers={'Cache-Control':'public, max-age=3600'})

@bp.post('/api/app/shortcut')
@api_guard('ショートカットを作れません')
def app_shortcut_create():
 """作る（既に在れば作り直す）。**この端末のデスクトップにしか触らない**ので、
    どのモードの端末からでも通す（`access_mode._ENDPOINT_EXTRA_MODES`）。"""
 # `overwrite`＝同じ名前の**別の**ショートカットに上書きしてよいか（§9.446）。
 # 自分が作った物の上書き（作り直し）には要らない——断るのは「他人の物」だけ。
 x=body({'name':str,'icon':str,'overwrite':flag},strict=True)
 # **作ったときの名前と絵は残す**（§9.445）。更新者IDは名乗るだけで、
 # 答えるのは`current_login_id()`の1箇所（§9.276）。
 out=desktop_shortcut.create(x.name,x.icon,current_login_id(),x.overwrite is True)
 if not out.get('ok'):
  # **断る理由は画面へそのまま出す**（§CLAUDE 4・6）。作れない理由は
  # 端末ごとに違う（WSHが無効・デスクトップが同期中・指定の絵が無い）。
  # **確認すれば進めるもの**は、そのことと行き先まで返す（画面が聞き直す）。
  return jsonify(error=out.get('error') or 'ショートカットを作れませんでした',
                 needConfirm=bool(out.get('needConfirm')),
                 linkTarget=out.get('linkTarget') or '',
                 link=out.get('link') or ''),400
 return jsonify(**out)

@bp.post('/api/app/shortcut/decline')
@api_guard('断ったことを控えられません')
def app_shortcut_decline():
 """起動したあとの「デスクトップに起動アイコンを作りますか」を断った（§9.559）。次からは聞かない。
    この端末の控えにしか触らないので、どのモードからでも通す。"""
 return jsonify(ok=desktop_shortcut.decline())

# ========================================================================
# アプリの更新（§9.555、利用者の指示「バージョンごとのデータをこの場所に保存し、
# アップデートを行う機能を組み込みたい」）
# ------------------------------------------------------------------------
# **判定と置き方は`app_update.py`の1箇所**。画面はここの答えを出すだけ。版を置く・配る版を
# 決めるのは開発者・メンテナンス者（`role_can('app:release')`）——全PCの中身が入れ替わる操作。
# 各PCがそろえるのは窓（`desktop/src/update.rs`）の役目で、ここ（動いている Python）は入れ替えない。
# ========================================================================
def _release_role():
 role=(current_permission_flags() or {}).get('role') or ROLE_DEFAULT
 return role,role_can(role,'app:release')

@bp.get('/api/app/update')
@api_guard('更新の状態を読めません')
def app_update_status():
 role,can=_release_role()
 return jsonify(**app_update.status(),role=role,canRelease=can)

@bp.post('/api/app/update/publish')
@api_guard('版を置けません')
def app_update_publish():
 """ZIP（本文そのまま）を検めて置き場へ置く。ファイル名は`?name=`（記録に残すだけ）。"""
 role,can=_release_role()
 if not can:
  return jsonify(error=f'版を置けるのは開発者・メンテナンス者だけです（この端末は「{role}」）。'),403
 data=request.get_data(cache=False)
 if not data:
  return jsonify(error='ZIP ファイルが届いていません。'),400
 out=app_update.run_publish(data,request.args.get('name',''),current_login_id())
 return jsonify(**out),(200 if out.get('ok') else 409 if out.get('busy') else 400)

@bp.get('/api/app/update/progress')
@api_guard('進み具合を読めません')
def app_update_progress():
 """いま置いている版の進み具合（画面は置き終わるまでこれを問い合わせて描く・§9.556）。"""
 return jsonify(**app_update.progress())

@bp.post('/api/app/update/release')
@api_guard('配る版を決められません')
def app_update_release():
 role,can=_release_role()
 if not can:
  return jsonify(error=f'配る版を決められるのは開発者・メンテナンス者だけです（この端末は「{role}」）。'),403
 x=body({'version':str},strict=True)
 out=app_update.set_release(x.text('version'),current_login_id())
 return jsonify(**out),(200 if out.get('ok') else 400)

@bp.get('/api/changelog')
def changelog():
 # 「開発の記録か」は changelog_data.is_dev() の1箇所が答える(§9.336)。
 # **画面へ判定を写さない**——写すと、宣言を足したのに画面だけ古い規則で
 # 分け続ける状態が作れる。
 rows=[dict(e, dev=is_dev(e)) for e in CHANGELOG]
 return jsonify(version=APP_VERSION, entries=rows,
                devCount=sum(1 for e in rows if e['dev']))
