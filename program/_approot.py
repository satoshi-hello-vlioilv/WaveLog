"""_approot.py: `program/`から実行されたとき、リポジトリ直下をimportの
探索先へ入れる（§9.404）。

`python program\\start_app.py`のように実行すると、Pythonは`sys.path[0]`へ
**そのファイルのあるフォルダ**（＝`program/`）を入れる。`backend`パッケージは
リポジトリ直下に在るので、そのままでは見つからない。

**答えはここ1箇所。** 各エントリポイント（`app.py`／`start_app.py`／
`setup_app.py`／`process_manager.py`／`sidecar.py`）がこれをimportする——同じ3行を
5箇所へ書き写すと、1つ直したときに残りとずれる。

読む順は`_pycache_bootstrap`の**次**（§9.406）。あちらは`program/`の隣に
在るので探索先の用意が要らず、**先に読むほどこのファイル自身の`.pyc`も
端末側の置き場へ回る**——`program/__pycache__`に残るのは`_pycache_bootstrap`
自身の1個だけになる（自分より先に自分の置き場は決められない）。
"""
import os
import sys

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
