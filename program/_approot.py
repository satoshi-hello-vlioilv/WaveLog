"""_approot.py: `program/`から実行されたとき、リポジトリ直下をimportの
探索先へ入れる（§9.404）。

`python program\\start_app.py`のように実行すると、Pythonは`sys.path[0]`へ
**そのファイルのあるフォルダ**（＝`program/`）を入れる。`backend`パッケージも
`_pycache_bootstrap`もリポジトリ直下に在るので、そのままでは見つからない。

**答えはここ1箇所。** 各エントリポイント（`app.py`／`start_app.py`／
`setup_app.py`／`process_manager.py`）は、いちばん最初にこれをimportする
——同じ3行を4箇所へ書き写すと、1つ直したときに残りとずれる。

`_pycache_bootstrap`より**前**に読むこと（あちらはリポジトリ直下に在り、
探索先が通っていないと見つからない）。
"""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
