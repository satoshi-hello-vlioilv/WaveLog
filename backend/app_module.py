"""app_module.py: Flask本体（`program/app.py`）を手に入れる1箇所（§9.404）。

`backend`の中から素で`from app import app`と書くと、**入口の隣に在ること**に
頼ることになる——`program/start_app.py`から起動したときは`program/`が
`sys.path[0]`になるので読めるが、**入口を通らない経路**（テストが`backend`
だけを読み込む、別の道具から呼ぶ）では`No module named 'app'`で落ちる。

実際に落ちた: 中継の受け口（`schedule_owner`）がその場で`from app import app`
していたため、`program/`へ移した直後の通しで**書き込みが500**になった
（`{'error': "No module named 'app'"}`）。素の名前で読めるかどうかが
**呼ばれ方で変わる**のが原因なので、答えをここ1箇所に置く。

「どこに在るか」は`paths.PROGRAM_DIR`が答え、**足りなければ自分で足す**。
読むのは**呼ばれたとき**で、モジュールの読み込み時ではない——`app`は
`backend`を読むので、先に読むと輪になる（§9.329で0にした輪を戻さない）。
"""
import sys

from .paths import PROGRAM_DIR


def flask_app():
    """Flask本体（`program/app.py`の`app`）。呼ばれた時点で読む。"""
    where = str(PROGRAM_DIR)
    if where not in sys.path:
        sys.path.insert(0, where)
    from app import app  # 遅延: appがbackendを読むので、読み込み時に読むと輪になる
    return app
