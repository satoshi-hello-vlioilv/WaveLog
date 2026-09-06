"""cleanup.py: 不要ファイルの掃除の口(§9.249 ①)。

判定・削除は`backend/file_cleanup.py`の1箇所が持つ(§9.163)。ここは
「今どれだけ溜まっているか」を返すのと、「消して」を受けるだけ。

**書込のBlueprintなので`access_mode._WRITE_ALLOWED_MODES`へ必ず宣言する**
——未宣言はfail-open(素通し)で、閲覧モードの端末からも消せてしまう
(`tests/test_modeguard.py`が機械で見張る)。
"""
from flask import Blueprint, jsonify

from .. import file_cleanup
from .body import body, flag

bp = Blueprint('cleanup', __name__)


@bp.get('/api/cleanup')
def cleanup_survey():
 """今どれだけ溜まっているか。**失敗しても200で返す**——掃除の画面が
 開けなくなるほうが困る(理由は本文に書く)。"""
 try:
  return jsonify(file_cleanup.survey())
 except Exception as e:
  return jsonify(categories=[], total={'files': 0, 'bytes': 0, 'removable': 0, 'removableBytes': 0},
                 policy=file_cleanup.policy(), state={}, places={}, error=str(e))


@bp.post('/api/cleanup/run')
def cleanup_run():
 """消す。`dryRun`なら数えるだけ(押す前に何件消えるかを出すため・§9.193)。"""
 x = body({'categories': list, 'dryRun': flag}, silent=True, strict=True)
 keys = x.items_of('categories')
 unknown = [k for k in keys if k not in {c['key'] for c in file_cleanup.CATEGORIES}]
 if unknown:
  return jsonify(error='知らない種別です: ' + '、'.join(str(k) for k in unknown)), 400
 try:
  return jsonify(file_cleanup.run(keys=keys, dry_run=x.flag('dryRun')))
 except Exception as e:
  return jsonify(error=str(e)), 500
