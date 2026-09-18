"""apppath.py: テストから `import app` を通すための1箇所（§9.404）。

直接実行する4本は`program/`へ移した。テストは Flask 本体を
`import app` の素の名前で読むので、**探索先に`program/`を足す**必要がある。
18本が同じ2行を持つと、次に置き場が動いたとき直す場所が18になるので、
**答えはここ1つ**にする。

使い方（`tests/`がスクリプトの置き場なので、素の名前で読める）:

    import apppath  # noqa: F401  (`program/` を探索先へ・§9.404)
    import app as flask_app  # noqa: E402

リポジトリ直下も一緒に足す——`app.py`は`backend`を読むし、
`_pycache_bootstrap`も直下に在る（§9.404）。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROGRAM = ROOT / 'program'

for _p in (str(PROGRAM), str(ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)
