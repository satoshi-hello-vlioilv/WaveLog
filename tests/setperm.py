# -*- coding: utf-8 -*-
"""tests/setperm.py: この端末(PC名 vm)の現場段取り権限を書き換える。

    python3 tests/setperm.py "テスト設備A"   # 対象設備を設定して権限ON
    python3 tests/setperm.py ""              # 対象設備なし(=どの設備も不可)

test_scperm.js が「現場段取り担当は自分の担当設備だけ並べ替えられる」を
確かめるために使う。アクセスモードは PC名+ログインID で決まるので、
テスト側からは権限マスタを直接書き換えるしかない。
"""
from __future__ import annotations
import sqlite3
import sys
from pathlib import Path

MASTER = Path(__file__).resolve().parent.parent / 'db' / 'master.sqlite3'


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    with sqlite3.connect(MASTER) as c:
        c.execute('UPDATE アクセス権限マスタ SET 現場段取り可否=1,現場段取り対象設備=? '
                  "WHERE PC名='vm'", (target,))
        c.commit()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
