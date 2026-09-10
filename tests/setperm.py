# -*- coding: utf-8 -*-
"""tests/setperm.py: **この端末**の現場段取り権限を書き換える。

    python3 tests/setperm.py "テスト設備A"   # 対象設備を設定して権限ON
    python3 tests/setperm.py ""              # 対象設備なし(=どの設備も不可)

test_scperm.js が「現場段取り担当は自分の担当設備だけ並べ替えられる」を
確かめるために使う。アクセスモードは PC名+ログインID で決まるので、
テスト側からは権限マスタを直接書き換えるしかない。

**誰の・どの端末かは推測しない**（§9.370）。以前はPC名を`'vm'`と直に
書いていたので、開発機以外では**UPDATEが0行に当たって黙って何もしなかった**
——「黙って何もしない後片付けは、無い後片付けより悪い」のと同じで、
権限が変わっていないのに変えたつもりで先へ進むことになる。名乗りは
ランナーが`/api/access-mode`から取って環境変数で渡す（make_fixture.pyと
同じ口）。当たらなければ**落とす**。
"""
from __future__ import annotations
import os
import sqlite3
import sys
from pathlib import Path

MASTER = Path(__file__).resolve().parent.parent / 'db' / 'master.sqlite3'
LOGIN_ENV = 'WAVELOG_FIXTURE_LOGIN'
PC_ENV = 'WAVELOG_FIXTURE_PC'


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else ''
    login = (os.environ.get(LOGIN_ENV) or '').strip()
    pc = (os.environ.get(PC_ENV) or '').strip()
    if not login and not pc:
        print('この端末の名乗り（%s / %s）が渡っていません。' % (LOGIN_ENV, PC_ENV),
              file=sys.stderr)
        return 1
    with sqlite3.connect(MASTER) as c:
        n = c.execute('UPDATE [アクセス権限マスタ] SET [現場段取り可否]=1,'
                      '[現場段取り対象設備]=? WHERE [ログインID]=? AND [PC名]=?',
                      (target, login, pc)).rowcount
        c.commit()
    if not n:
        print('この端末の行（%s / %s）がアクセス権限マスタにありません。'
              % (login, pc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
