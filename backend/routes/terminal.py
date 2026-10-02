"""terminal.py（ルート）: 端末の控え（§9.545・`backend/terminal_store.py`）。

画面（ブラウザ版・デスクトップ版のどちら）も、端末の保存領域へ書くのと同じときに
ここへも書き、開いたときにここと突き合わせる。**控えは端末の手元にしか無い**
（共有ではない）ので、モードでも切断（§9.272）でも塞がない——塞ぐと、共有へ
送れないときにこそ要る控えが取れなくなる（`access_mode`で3モードとも許してある）。
"""
from flask import Blueprint, jsonify, request

from .. import terminal_store
from .body import any_, body
from .common import api_guard

bp = Blueprint('terminal', __name__)


def _origin(x):
    return x.text('origin') or request.headers.get('Origin') or ''


@bp.get('/api/terminal/records')
@api_guard('端末の控えを読めませんでした')
def terminal_records():
    """見出しだけ（中身は運ばない。要る記録は`/get`で取る）。"""
    return jsonify(ok=True, items=terminal_store.index())


@bp.post('/api/terminal/records/get')
@api_guard('端末の控えを読めませんでした')
def terminal_records_get():
    """指定した記録の中身。**読むだけ**なので、どのモードでも通る（段ごと3モードに開けてある）。"""
    x = body({'ids': any_})
    ids = x.get('ids')
    if not isinstance(ids, list):
        return jsonify(error='idsは配列で送ってください。'), 400
    return jsonify(ok=True, items=terminal_store.records(ids))


@bp.post('/api/terminal/records/put')
@api_guard('端末の控えへ書けませんでした')
def terminal_records_put():
    x = body({'records': any_, 'origin': str})
    recs = x.get('records')
    if not isinstance(recs, list):
        return jsonify(error='recordsは配列で送ってください。'), 400
    out = terminal_store.put_records(recs)
    terminal_store.note_origin(_origin(x), records_sent=out['stored'])
    return jsonify(ok=True, **out)


@bp.post('/api/terminal/records/delete')
@api_guard('端末の控えから消せませんでした')
def terminal_records_delete():
    x = body({'ids': any_, 'deletedAt': str, 'origin': str})
    ids = x.get('ids')
    if not isinstance(ids, list):
        return jsonify(error='idsは配列で送ってください。'), 400
    n = terminal_store.delete_records(ids, x.text('deletedAt'))
    terminal_store.note_origin(_origin(x))
    return jsonify(ok=True, deleted=n)


@bp.get('/api/terminal/settings')
@api_guard('端末の設定の控えを読めませんでした')
def terminal_settings():
    try:
        since = int(request.args.get('since') or 0)
    except ValueError:
        since = 0
    return jsonify(ok=True, **terminal_store.settings(since))


@bp.post('/api/terminal/settings')
@api_guard('端末の設定を控えられませんでした')
def terminal_settings_put():
    x = body({'values': any_, 'origin': str}, silent=True)
    values = x.get('values')
    if not isinstance(values, dict):
        return jsonify(error='valuesは名前と値の組で送ってください。'), 400
    rev = terminal_store.put_settings(values)
    terminal_store.note_origin(_origin(x), settings_sent=len(values))
    return jsonify(ok=True, rev=rev)


@bp.get('/api/terminal/status')
@api_guard('端末の控えの様子を読めませんでした')
def terminal_status():
    return jsonify(ok=True, **terminal_store.status())
