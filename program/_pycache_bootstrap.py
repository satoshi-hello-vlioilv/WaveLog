"""_pycache_bootstrap.py: .pycキャッシュをアプリ本体ではなくユーザー別
ローカル領域(%LOCALAPPDATA%\\WaveLog\\pycache)へ逃がす(仕様書2.7)。

sys.pycache_prefix は、対象のモジュールを1つでもimportする前に設定する
必要がある。そのため、このファイルを各エントリポイント
(setup_app.py/app.py/sidecar.py)の最初のimportにする
ことで、以降に読み込む backend.* などが app.py 側の __pycache__ を
汚さないようにする。

このファイル自身は「他よりも先にimportされる1つ目のモジュール」なので、
このファイル自身のバイトコードキャッシュだけはアプリ側の __pycache__ に
残る(先有り後無しの都合上避けられない、影響は無視できる程度)。
"""
import os
import sys


def _pycache_dir():
 base=os.environ.get('LOCALAPPDATA') or os.environ.get('XDG_DATA_HOME')
 if not base:
  base=os.path.join(os.path.expanduser('~'),'.local','share')
 return os.path.join(base,'WaveLog','pycache')


if sys.pycache_prefix is None:
 sys.pycache_prefix=_pycache_dir()
