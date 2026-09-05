"""test_apiguard.py: ルート層の「失敗の受け方」は`api_guard`の1箇所（§9.324 R2）

固定するのは3つ:
  1. デコレータの約束——Exceptionは500で`f'{fail}: {e}'`、`bad`を渡した型だけ
     `bad_status`で`str(e)`、`HTTPException`は素通し、`return jsonify(...),4xx`の
     断りはそのまま、関数名（＝Flaskのエンドポイント名）が残る。
  2. **本物のルートで**——`POST /api/schedule-column-master`が repo の
     `ValueError`を400で通し、想定外の例外を500の同じ文言で受けること。
     デコレータ単体の網では「付け忘れ」を捕まえられない。
  3. **写しが残っていない**——`backend/routes`に「tryが関数の最後で、
     `except Exception as e:return jsonify(error=f'…: {e}'),500`（＋任意で
     `except ValueError as e:return jsonify(error=str(e)),400/409`）だけの
     形」が1つも無いことを構文木で数える（§9.96。56本目が書かれた瞬間に落ちる）。
"""
import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


# ---- 1. デコレータ単体 -------------------------------------------------
from flask import Flask, jsonify, abort  # noqa: E402
from backend.routes.common import api_guard  # noqa: E402

app = Flask('apiguard-test')


@app.get('/boom')
@api_guard('壊れました')
def boom():
    raise RuntimeError('中身')


@app.get('/bad')
@api_guard('壊れました', bad=ValueError)
def bad():
    raise ValueError('理由はこれ')


@app.get('/bad409')
@api_guard('壊れました', bad=ValueError, bad_status=409)
def bad409():
    raise ValueError('重なっています')


@app.get('/nobad')
@api_guard('壊れました')
def nobad():
    raise ValueError('badを渡していないので500')


@app.get('/abort')
@api_guard('壊れました')
def abort_route():
    abort(404)


@app.get('/refuse')
@api_guard('壊れました')
def refuse():
    return jsonify(error='断り'), 403


@app.get('/ok')
@api_guard('壊れました')
def ok():
    return jsonify(ok=True)


c = app.test_client()
r = c.get('/boom')
rec('Exceptionは500・文言は fail + ": " + e', r.status_code == 500 and r.get_json() == {'error': '壊れました: 中身'}, str(r.get_json()))
r = c.get('/bad')
rec('bad=ValueError は400で str(e) そのまま', r.status_code == 400 and r.get_json() == {'error': '理由はこれ'}, str(r.get_json()))
r = c.get('/bad409')
rec('bad_status=409 が効く', r.status_code == 409 and r.get_json() == {'error': '重なっています'}, str(r.get_json()))
r = c.get('/nobad')
rec('badを渡さなければValueErrorも500（既定を変えない）', r.status_code == 500 and r.get_json()['error'].startswith('壊れました: '), str(r.get_json()))
r = c.get('/abort')
rec('HTTPException（abort）は素通し', r.status_code == 404)
r = c.get('/refuse')
rec('return jsonify(...),403 の断りはそのまま', r.status_code == 403 and r.get_json() == {'error': '断り'})
r = c.get('/ok')
rec('正常系はそのまま', r.status_code == 200 and r.get_json() == {'ok': True})
rec('関数名（エンドポイント名）が残る', boom.__name__ == 'boom' and 'boom' in app.view_functions, ','.join(app.view_functions))

# ---- 2. 本物のルートで --------------------------------------------------
import app as flask_app  # noqa: E402
from backend.routes import masters  # noqa: E402

real = flask_app.app.test_client()
# **マスタへは1行も書かない**（§9.121の置き土産を作らない）——repoの関数を
# 差し替えて「断る」「壊れる」の両方を起こし、本物のルートがどう受けるかだけを見る。
orig = masters.set_schedule_columns


def _refuse(*a, **k):
    raise ValueError('列名でない要素があります')


def _blow(*a, **k):
    raise RuntimeError('ディスクが読めない')


try:
    masters.set_schedule_columns = _refuse
    r = real.post('/api/schedule-column-master', json={'equipment': 'テスト設備A', 'columns': ['x']})
    body = r.get_json() or {}
    rec('本物のルート: repoのValueErrorは400で文言そのまま',
        r.status_code == 400 and body.get('error') == '列名でない要素があります', f'{r.status_code} {body}')
    masters.set_schedule_columns = _blow
    r = real.post('/api/schedule-column-master', json={'equipment': 'テスト設備A', 'columns': ['x']})
    body = r.get_json() or {}
    rec('本物のルート: 想定外の例外は500で「スケジュール列表示マスタ保存失敗: …」',
        r.status_code == 500 and body.get('error') == 'スケジュール列表示マスタ保存失敗: ディスクが読めない', f'{r.status_code} {body}')
finally:
    masters.set_schedule_columns = orig

# ---- 3. 写しが残っていない（構文木で数える） --------------------------------
def _fmsg(v):
    if isinstance(v, ast.JoinedStr) and len(v.values) == 2 and isinstance(v.values[0], ast.Constant) \
       and isinstance(v.values[1], ast.FormattedValue) and isinstance(v.values[1].value, ast.Name) \
       and v.values[1].value.id == 'e':
        return v.values[0].value
    return None


def _copy_of_guard(fn):
    """関数の末尾が「定型のtry/except」だけなら真（＝api_guardで書ける形）。"""
    tries = [s for s in fn.body if isinstance(s, ast.Try)]
    if len(tries) != 1 or fn.body[-1] is not tries[0]:
        return False
    t = tries[0]
    if t.finalbody or t.orelse:
        return False
    if any(isinstance(n, ast.Try) for n in ast.walk(t) if n is not t):
        return False
    shape = []
    for h in t.handlers:
        tn = getattr(h.type, 'id', None)
        b = h.body
        if len(b) != 1 or not isinstance(b[0], ast.Return) or not isinstance(b[0].value, ast.Tuple) or len(b[0].value.elts) != 2:
            return False
        call, code = b[0].value.elts
        if not (isinstance(call, ast.Call) and getattr(call.func, 'id', '') == 'jsonify' and isinstance(code, ast.Constant)):
            return False
        kws = {k.arg: k.value for k in call.keywords}
        if set(kws) != {'error'} or call.args:
            return False
        if tn == 'Exception' and code.value == 500:
            m = _fmsg(kws['error'])
            if m is None or not m.endswith(': '):
                return False
            shape.append('E')
        elif tn == 'ValueError' and code.value in (400, 409):
            v = kws['error']
            if not (isinstance(v, ast.Call) and getattr(v.func, 'id', '') == 'str'):
                return False
            shape.append('V')
        else:
            return False
    return shape in (['E'], ['V', 'E'])


left = []
for p in sorted((ROOT / 'backend' / 'routes').glob('*.py')):
    tree = ast.parse(p.read_text(encoding='utf-8'))
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and _copy_of_guard(fn):
            left.append(f'{p.name}:{fn.lineno} {fn.name}')
rec('api_guardで書ける定型のtry/exceptが backend/routes に残っていない', not left, '; '.join(left[:6]))

# 見張りが実際に数えられること（網の網・§9.200）
probe = ast.parse("def f():\n try:\n  return jsonify(ok=True)\n except Exception as e:return jsonify(error=f'x: {e}'),500\n")
rec('見張りは定型を見分けられる', _copy_of_guard(probe.body[0]))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
