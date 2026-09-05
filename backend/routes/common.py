"""common.py: ルート層の「失敗の受け方」を1箇所に持つ（§9.324 R2）。

以前は55本のルートが、それぞれの末尾に

    try:
     ...
    except ValueError as e:return jsonify(error=str(e)),400
    except Exception as e:return jsonify(error=f'◯◯に失敗しました: {e}'),500

を**手で書き写して**いた。形は同じでも書く場所が55あると、①1本だけ
`except ValueError`を書き忘れて断りが500になる ②文言の書式が揺れる
③失敗の受け方を変えたい（たとえば traceback を残す）ときに55箇所直す、
が起きる。`api_guard()`がその定型を1つで受け持つ。

約束:
  ・**Exception は 500 で `f'{fail}: {e}'`**——今までの文言そのまま。
    `fail`には「◯◯に失敗しました」までを渡す（末尾の `: {e}` はここが足す）。
  ・**`bad` を渡したときだけ**、その例外は `bad_status`（既定400）で
    `str(e)` をそのまま返す（repoが理由を書いた `ValueError` を画面へ通す道）。
    渡していないルートでは今までどおり `Exception` として500へ倒す
    （挙動を1本も変えないため、既定で `ValueError` を拾わない・§9.132）。
  ・**Flask の `HTTPException`（`abort()`・壊れたJSONの400）は素通しする**
    ——あれは失敗ではなく「意図した応答」で、`errors.py` の全体の受けと
    同じ扱い（`if isinstance(e,HTTPException):return e`）。
  ・`functools.wraps` で名前を残す——Flask のエンドポイント名は関数名なので、
    ここを落とすと `_ENDPOINT_EXTRA_MODES`（`Blueprint名.関数名`）が当たらなくなる。
  ・**中で `return jsonify(...),4xx` と断った応答はそのまま通る**（例外では
    ないので触らない）。

置く位置は `@bp.post(...)` の**下**（関数のすぐ上）。上に置くとFlaskへ登録される
のが素の関数になり、デコレータが一度も通らない。
固定は `tests/test_apiguard.py`——写しが `backend/routes` に残っていないことも
機械で数える（§9.96）。
"""
import functools
from flask import jsonify
from werkzeug.exceptions import HTTPException


def api_guard(fail, bad=None, bad_status=400):
 """`fail`: 500のときの文言（`: {e}` はここが足す）。
    `bad`: そのまま断る例外の型（省略＝拾わない）。`bad_status`: その状態コード。"""
 def deco(fn):
  @functools.wraps(fn)
  def wrapped(*a, **kw):
   try:
    return fn(*a, **kw)
   except HTTPException:
    raise
   except Exception as e:
    if bad is not None and isinstance(e, bad):
     return jsonify(error=str(e)), bad_status
    return jsonify(error=f'{fail}: {e}'), 500
  return wrapped
 return deco
