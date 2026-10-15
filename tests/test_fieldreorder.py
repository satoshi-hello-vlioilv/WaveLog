"""test_fieldreorder.py: 現場段取りの対象設備は設備の改名に追従する（§9.606・利用者の報告）

利用者の報告: 「設備作業者で段取り可の状態で厳密モードの時、並び替えができない」。
並べ替えを許すかは「現場段取り可 かつ 対象設備にこの設備がある」で決まる（`field_reorder_equipment_allows`）。
対象設備は**設備名の文字列**で持つので、設備マスタで改名すると、追従の一覧
（`equipment_name_references()`）に載っていなければ旧名のまま残り、**段取り可の端末が黙って並べ替え
できなくなる**。

物差し M6: 改名した設備を、段取り可の端末がまだ並べ替えられるか（直す前 できない）。
固定するのは3つ:
  1. 対象設備（1つ・カンマ区切りの中の1つ）が新しい名前へ書き換わる
  2. 「すべての設備」（*）と、別の設備の名前は触らない
  3. 改名した設備で`field_reorder_equipment_allows`が真のまま

サーバーは要らない（1段目・§9.337）。
"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect                           # noqa: E402
from backend.repositories import master_repo as mr              # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def main():
    c = connect(Path(tempfile.mkdtemp()) / 'm.sqlite3', False, 'sqlite')
    c.execute('CREATE TABLE [アクセス権限マスタ] ([権限ID] INTEGER PRIMARY KEY, [ログインID] TEXT, [PC名] TEXT, '
              '[現場段取り可否] INTEGER, [現場段取り対象設備] TEXT)')
    rows = [('op1', 'LS4'), ('op2', 'LS3,LS4'), ('op3', '*'), ('op4', 'LS5')]
    for i, (who, eq) in enumerate(rows):
        c.execute('INSERT INTO [アクセス権限マスタ] VALUES (?,?,?,1,?)', [i + 1, who, 'pc', eq])
    c.commit()
    mr.rename_equipment_references(c, 'LS4', 'LS-4')
    c.commit()
    got = {r[0]: r[1] for r in c.execute('SELECT [ログインID],[現場段取り対象設備] FROM [アクセス権限マスタ]')}
    rec('1. 対象設備の名前が改名に追従する（1つ・カンマ区切りの中の1つ）',
        got['op1'] == 'LS-4' and got['op2'] in ('LS3,LS-4', 'LS3, LS-4'), got)
    rec('2. すべての設備（*）と別の設備は触らない', got['op3'] == '*' and got['op4'] == 'LS5', got)
    rec('3. M6: 改名した設備を、段取り可の端末がまだ並べ替えられる',
        mr.field_reorder_equipment_allows(got['op1'], 'LS-4') and mr.field_reorder_equipment_allows(got['op2'], 'LS-4'),
        got)
    c.close()
    bad = [n for n, ok in R if not ok]
    print(f'\n合計 {len(R)} 件 / 失敗 {len(bad)} 件')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
