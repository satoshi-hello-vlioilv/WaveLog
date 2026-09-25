"""path_config.py: パス設定マスタを読む。**読み込んでも何も起きない**（§9.497の追補3）。

`db_access`は読み込んだだけでデータソースの設定を読み、共有に置いたマスタの写しを作り直す
（`master_share.configure()`）。アプリの中ではそれが正しいが、update.bat の片付けのように
**アプリの外から設定を1つ読みたい**側がそれを通ると、起動中のアプリの書込と錠なしで競る。
ここは「どのファイルを開くか」（`paths.master_db_file()`→`master_share.local_path_of()`）と
「表をどう読むか」だけを持つ。表の読み方の答えもここ1箇所（`db_access`は再公開するだけ）。
"""
from pathlib import Path

from . import master_share, paths
from .quiet import quiet
from .sqlite_io import connect, tables

PATH_CONFIG_TABLE = 'パス設定マスタ'


def rows(c):
    """{設定キー: 設定値}を返す。テーブル未作成なら空(読み取り専用接続からも
    安全に呼べる。CREATE/ALTERは行わない)。"""
    if PATH_CONFIG_TABLE not in tables(c):
        return {}
    cur = c.cursor()
    cur.execute('SELECT [設定キー],[設定値] FROM [パス設定マスタ]')
    return {str(k): str(v) for k, v in cur.fetchall() if k and v not in (None, '')}


def read(path=None):
    """パス設定マスタの全部。`path`を渡さなければ**この端末が開くマスタ**（共有なら手元の写し）。
    ファイル／表がまだ無い・読めないときは空（既定で動く）。接続は**必ず閉じる**（§9.270）。"""
    target = Path(path) if path else master_share.local_path_of(paths.master_db_file())
    try:
        if not target.exists():
            return {}
        c = connect(target, True)
        try:
            return rows(c)
        finally:
            c.close()
    except Exception as _e:
        quiet('マスタの設定を読めない（既定で続ける）', _e)
        return {}


def value(key, default=None, path=None):
    """1項目。空なら`default`。呼ぶたびに開き直す（頻繁に呼ぶ用途には使わない）。"""
    v = read(path).get(key)
    return v if v not in (None, '') else default
