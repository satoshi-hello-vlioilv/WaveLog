"""core.py: システム系ルート — トップページ・起動確認・バージョン情報。

app.pyから移設。ロジックは変更していない(移動のみ)。
"""
from flask import Blueprint, render_template, request, jsonify, Response
import json, os, re, subprocess

from ..config import APP_ID, PORT
from ..changelog_data import APP_VERSION, CHANGELOG
from ..paths import APP_ROOT as BASE

bp=Blueprint('core',__name__)

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
 asset_files=list((BASE/'static'/'js').glob('*.js'))+[BASE/'static'/'app.css']
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
