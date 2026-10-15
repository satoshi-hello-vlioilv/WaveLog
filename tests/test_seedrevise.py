"""test_seedrevise.py: 種の値を後から改めたもの（`SEED_REVISIONS`・§9.606）

利用者の指示: 「スリットクリアランスの入力桁数を小数点以下2桁に修正」。

物差し: スリット クリアランスへ 0.13 を打ったときに記録される値（測定画面の
`settleValue()`は小数桁で丸める）＝**小数桁**。直す前は種も既存の行も 1 で、
0.13 は 0.1 として記録されていた。

固定するのは4つ:
  1. 新しく作るマスタでは種が 2 桁
  2. 前の版で作ったマスタ（1 桁のまま）は**開いたときに 2 桁へ上がる**
  3. 2 回目は当たらない（1回きり）——直した後に利用者が 1 桁へ戻した値を上書きしない
  4. 利用者がこの版より後に選び直した行（更新日時が新しい）は触らない

サーバーは要らない（1段目・§9.337）。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect                           # noqa: E402
from backend.repositories import operation_repo as op           # noqa: E402

R = []
NAME = 'スリット クリアランス'


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def fresh():
    c = connect(Path(tempfile.mkdtemp()) / 'm.sqlite3', False, 'sqlite')
    op.ensure_item_table(c)
    return c


def dec(c):
    return [r[0] for r in c.execute(f'SELECT [小数桁] FROM [{op.ITEM_TABLE}] WHERE [項目名]=?', [NAME])]


def main():
    c = fresh()
    rec('1. 新しく作るマスタは種が2桁', dec(c) == [2], dec(c))

    # 2. 前の版のマスタ: 1桁・更新日時は昔
    c.execute(f"UPDATE [{op.ITEM_TABLE}] SET [小数桁]=1, [更新日時]='2026-10-14 05:15:31' WHERE [項目名]=?", [NAME])
    c.commit()
    n = op.revise_seeds(c)
    rec('2. 1桁のままの行は開いたときに2桁へ上がる', dec(c) == [2] and n == 1, (dec(c), n))

    # 3. 直した後に利用者が1桁へ戻した（更新日時は今）→ 2回目は当たらない
    c.execute(f'UPDATE [{op.ITEM_TABLE}] SET [小数桁]=1, [更新日時]=Now() WHERE [項目名]=?', [NAME])
    c.commit()
    n = op.revise_seeds(c)
    rec('3. 利用者が後から選んだ1桁は上書きしない（1回きり）', dec(c) == [1] and n == 0, (dec(c), n))

    # 4. 1桁以外を選んでいた行（例: 3桁）は前の版のものでも触らない
    c.execute(f"UPDATE [{op.ITEM_TABLE}] SET [小数桁]=3, [更新日時]='2026-01-01 00:00:00' WHERE [項目名]=?", [NAME])
    c.commit()
    op.revise_seeds(c)
    rec('4. 種と違う値を選んでいた行は触らない', dec(c) == [3], dec(c))
    c.close()

    bad = [n for n, ok in R if not ok]
    print(f'\n合計 {len(R)} 件 / 失敗 {len(bad)} 件')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
