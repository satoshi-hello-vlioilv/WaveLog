"""masters/_base.py: この段たちが共有する Blueprint と、マスタDBの開き方。

**なぜ`__init__.py`ではなくここか**——`__init__.py`が`bp`を作って末尾で段を
import する形にすると、段の側は「まだ作りかけのパッケージ」から`bp`を引く
ことになる。動きはするが、読む人には**どちらが先に走るのか**が見えない。
`bp`だけを持つ小さな段を1つ置けば、依存は一方向（段 → `_base`）になる。

**Blueprint名は`'masters'`のまま**（§9.333）。`access_mode`の
`_WRITE_ALLOWED_MODES`／`_ENDPOINT_EXTRA_MODES`・`master_share`の
`WRITING_BLUEPRINTS`はどれも**Blueprint名と関数名**で書いてあるので、
ファイルを分けても鍵は1つも変わらない——**それがこの分け方の値打ち**で、
権限表を触らずに済む（`tests/test_modeguard.py`が固定）。
"""
from flask import Blueprint
from ...db_access import DBS, connect

bp = Blueprint('masters', __name__)


def _op_read(fn):
 path=DBS['MASTER']['path']
 with connect(path,False) as c:
  return fn(c)
