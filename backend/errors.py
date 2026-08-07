"""errors.py: 想定外の例外を「調べられる形」で返す。

Flaskの既定は英語1行の `Internal Server Error` だけで、原因も出所も画面に
残らない。実際に別端末から「アプリ起動に Internal Server Error が出る」と
だけ報告が上がり、tracebackがどこにも無いため切り分けができなかった。
`/api/tables` で同じ問題を踏んだとき(§9.75)と同じ対処を、**全経路へ**広げる。

ここでやることは3つ。
  ・必ず traceback を app.log へ残す（後から追える）
  ・画面には日本語で「何が起きたか」「次に何を見ればよいか」を出す
  ・API(`/api/…`)にはJSONで返す（フロントのapi()がそのまま拾える）

**握りつぶさない**。状態は500のままにして、成功したように見せない。
"""
from flask import request, jsonify, Response
from werkzeug.exceptions import HTTPException
import html
import traceback

from .logging_setup import app_logger
from .paths import logs_dir


# ネットワーク共有まわりのWindowsエラー。番号だけ出されても分からないので、
# 何を確認すればよいかまで添える(§9.75で /api/tables へ入れたものを共用)。
_WIN_NET_ERRORS={
 59:'予期しないネットワークエラー',
 64:'指定されたネットワーク名は利用できません',
 53:'ネットワークパスが見つかりません',
 55:'指定されたネットワークリソースは利用できません',
 67:'ネットワーク名が見つかりません',
 1231:'ネットワークの場所へ到達できません',
}


def os_error_hint(e):
 """画面へ出す一言の手がかり。原因の切り分けを現地でできるようにする。"""
 win=getattr(e,'winerror',None)
 if win in _WIN_NET_ERRORS:
  return (f'ネットワーク共有への問い合わせが失敗しました'
          f'（WinError {win}: {_WIN_NET_ERRORS[win]}）。'
          '共有への到達性・SMBの設定・ウイルス対策の除外設定を確認してください。'
          '一時的な断であれば、再読込で回復することがあります。'
          ' /api/db-diagnose?db=SIKALOTNOW を開くと、どの段階で失敗しているかが分かります。')
 if isinstance(e,FileNotFoundError):
  return ('必要なファイルが見つかりません。アプリ一式が揃っているか'
          '（コピー漏れ・ウイルス対策による隔離が無いか）と、'
          'マスタ管理 > パス設定 の指定を確認してください。')
 if isinstance(e,PermissionError):
  return 'ファイルへのアクセスが拒否されました。読み取り権限と、他プロセスによる排他を確認してください。'
 return ''


# 差し込みは str.format ではなく置換で行う。**CSSの波かっこを書式指定と
# 誤解される**ため(実際に format() が KeyError:'margin' で落ちた)。
_PAGE="""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>測定伝送システム — エラー</title><style>
 body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#eef2f4;color:#173842;font-family:"Segoe UI","Meiryo",system-ui,sans-serif;font-size:14px;line-height:1.5}
 .card{width:min(92vw,640px);background:#fff;border:1px solid #b7c7cc;border-radius:12px;
  padding:26px 30px;box-shadow:0 2px 16px rgba(23,56,66,.12)}
 h1{margin:0 0 6px;font-size:18px;color:#c92c2c}
 p{margin:0 0 12px}
 .hint{padding:11px 13px;border-radius:8px;background:#fdf7ec;border:1px solid #e6cf9e}
 dl{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;margin:16px 0 0;font-size:13px}
 dt{color:#5d757e;white-space:nowrap}
 dd{margin:0;word-break:break-all}
 code{font-family:Consolas,monospace;background:#eef2f4;padding:1px 5px;border-radius:4px}
 button{margin-top:18px;width:100%;padding:10px;font-size:14px;font-family:inherit;color:#fff;
  background:#087c89;border:0;border-radius:8px;cursor:pointer}
</style></head><body><div class="card">
<h1>処理中にエラーが発生しました</h1>
<p>この画面が出たとき、詳しい内容（traceback）は必ずログへ記録されています。</p>
@HINT@
<dl>
<dt>要求</dt><dd><code>@METHOD@ @PATH@</code></dd>
<dt>内容</dt><dd>@KIND@: @MESSAGE@</dd>
<dt>ログ</dt><dd><code>@LOGDIR@</code> の <code>app.log</code></dd>
</dl>
<button type="button" onclick="location.reload()">再読込</button>
</div></body></html>"""


def install(app):
 @app.errorhandler(Exception)
 def _unhandled(e):
  # 404/405などのHTTP例外は想定内。既定の応答をそのまま返す。
  if isinstance(e,HTTPException):return e
  app_logger().exception('%s %s で未処理の例外が発生しました',request.method,request.path)
  hint=os_error_hint(e)
  kind=type(e).__name__
  message=str(e) or '(メッセージなし)'
  # フロントのapi()はJSONのerrorを読んでトーストに出す。API経路はJSONで返す。
  if request.path.startswith('/api/') or request.accept_mimetypes.best=='application/json':
   return jsonify(error=f'{kind}: {message}',hint=hint,path=request.path,
                  traceback=traceback.format_exc().splitlines()[-6:]),500
  page=_PAGE
  for token,value in (
   ('@HINT@',f'<p class="hint">{html.escape(hint)}</p>' if hint else ''),
   ('@METHOD@',html.escape(request.method)),
   ('@PATH@',html.escape(request.path)),
   ('@KIND@',html.escape(kind)),
   ('@MESSAGE@',html.escape(message[:400])),
   ('@LOGDIR@',html.escape(str(_log_dir_safe())))):
   page=page.replace(token,value)
  return Response(page,mimetype='text/html',status=500)


def _log_dir_safe():
 try:return logs_dir()
 except Exception:return '(場所を特定できませんでした)'
