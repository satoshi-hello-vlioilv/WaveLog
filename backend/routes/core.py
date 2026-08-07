"""core.py: システム系ルート — トップページ・起動確認・バージョン情報。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, render_template, request, jsonify, Response
import json, os, re, subprocess

from ..config import APP_ID, PORT
from .. import boot_status
from ..changelog_data import APP_VERSION, CHANGELOG
from ..paths import APP_ROOT as BASE

bp=Blueprint('core',__name__)

# CSSは画面ごとに static/css/ へ分けてあるが、**ブラウザへは1本にまとめて返す**。
# 分割の目的は「人が読み書きしやすいこと」なので、配信まで分ける必要はない。
# <link>を16本並べたところ、1ページ表示ごとに16往復増え、起動直後の一覧取得と
# 競合してテストが13件落ちた(索引のページ送りが1ページで止まる等)。
#
# **この並びがカスケードの順序そのもの**。同じ@layerの中では今も
# 「後に書いたほうが勝つ」が効くので、順番を変えると見た目が変わる。
# 並びの唯一の定義はここで、tests/test_csslint.py が同じ並びを固定している。
CSS_FILES=[
 '00-base.css',        # レイヤの宣言 + トークン + 素の要素
 '10-roles.css',       # 役割ごとの寸法・文字(唯一の決定場所)
 '20-shell.css',       # 骨格・左ナビ・ヘッダー・一覧・タブ・ページャ
 '30-measure.css',     # 測定画面
 '35-split.css',       # 条割変更モーダル
 '40-records.css',     # データ一覧・設備設定・保存オーバーレイ
 '45-tolerance.css',   # 公差数直線・フィルタ
 '50-master.css',      # マスタ管理
 '55-quality.css',     # 品質データ分析
 '60-report.css',      # 測定帳票(画面)・ダッシュボード
 '65-calendar.css',    # 実績カレンダー
 '70-schedule.css',    # 作業スケジュール・勤務体系
 '75-master-paths.css',# マスタ管理(パス設定・RNE抽出)
 '80-defect.css',      # 異常位置判定(画面と専用帳票)
 '85-headerbar.css',   # ヘッダーの操作列
 '90-state.css',       # state / mode / print / utility
]
_CSS_CACHE={'token':None,'body':''}

def _css_dir(): return BASE/'static'/'css'
def _css_token():
 """CSSの更新時刻。連結結果のキャッシュ鍵と、<link>のキャッシュ破棄に使う。"""
 d=_css_dir()
 return str(max((d/n).stat().st_mtime_ns for n in CSS_FILES))

@bp.get('/css/app.css')
def app_css():
 tok=_css_token()
 if _CSS_CACHE['token']!=tok:
  d=_css_dir()
  parts=[f'/* ===== {n} ===== */\n'+(d/n).read_text(encoding='utf-8') for n in CSS_FILES]
  _CSS_CACHE.update(token=tok,body='\n'.join(parts))
 return Response(_CSS_CACHE['body'],mimetype='text/css',
                 headers={'Cache-Control':'no-cache'})

def _git_version():
 # 参考情報(ツールチップ用)。git非対応の配布環境では取得できないため
 # 失敗しても画面表示自体には影響しないようベストエフォートにする。
 try:
  rev=subprocess.check_output(['git','rev-parse','--short','HEAD'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  when=subprocess.check_output(['git','log','-1','--format=%cI'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip()
  dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=BASE,stderr=subprocess.DEVNULL).decode().strip())
  return {'commit':rev,'commit_at':when,'dirty':dirty}
 except Exception:
  return {'commit':'','commit_at':'','dirty':False}
GIT_VERSION=_git_version()

@bp.get('/')
def home():
 asset_files=list((BASE/'static'/'js').glob('*.js'))+[_css_dir()/n for n in CSS_FILES]
 token=str(max(f.stat().st_mtime_ns for f in asset_files))
 return render_template('index.html', build='current', asset_token=token)
@bp.get('/api/build')
def build(): return jsonify(build='current', version=APP_VERSION, feature='measurement-workflow-current', port=PORT, app_id=APP_ID, **GIT_VERSION)

# ========================================================================
# 起動完了の確認(待機画面 loading.html 用)
# loading.htmlはサーバーより先に開かれるためfile://から読み込まれる。
# file://からhttp://127.0.0.1へのfetchはCORSで応答を読めないが、script要素
# なら生成元をまたいで読み込めるため、JSONP形式でアプリ識別情報を返す。
# 待機画面はこれを受け取って初めてアプリ本体へ遷移する。ブラウザとサーバーの
# どちらが先に立ち上がっても成立するので、起動順序に依存しない。
# cbはコールバック関数名としてそのままJavaScriptへ埋め込むため、JSの識別子
# として妥当な文字列以外は拒否する(任意コード混入の防止)。
# ========================================================================
_JS_IDENTIFIER=re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*\Z')
@bp.get('/api/ready.js')
def ready_js():
 cb=request.args.get('cb','')
 if not _JS_IDENTIFIER.match(cb):return Response('/* invalid callback */',mimetype='application/javascript',status=400)
 info=json.dumps({'app':APP_ID,'ready':True,'version':APP_VERSION,'pid':os.getpid(),'url':f'http://127.0.0.1:{PORT}/'})
 # ここまで来たら起動は完了している。待機画面の段階表示用に書き出していた
 # 進捗ファイルは役目を終えたので消す(次回起動時に前回の内容が一瞬見えるのを防ぐ)。
 boot_status.clear()
 return Response(f'{cb}({info});',mimetype='application/javascript')
@bp.get('/api/whoami')
def whoami():
 # この端末(各測定端末)で実行しているアプリのOSログインユーザー名を返す。
 # マスタ更新記録(登録者ID)に、手入力させず自動で使うためのもの。
 try:username=os.getlogin()
 except Exception:username=os.environ.get('USERNAME') or os.environ.get('USER') or os.environ.get('LOGNAME') or ''
 return jsonify(username=str(username or '').strip())
@bp.get('/api/changelog')
def changelog(): return jsonify(version=APP_VERSION, entries=CHANGELOG)
