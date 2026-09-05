"""test_scsnapread.py: 作業予定を「読む側」は写しに書かない（§9.325）

GET系ルートは共有の**写し**（`schedule_cache.sqlite3`）を開いて読む。写しは
別の要求が同時に写し直して`Path.replace()`で差し替えるので、開いたままの
ファイルへ書くとSQLiteは`SQLITE_READONLY_DBMOVED`＝
「attempt to write a readonly database」で断る。以前は`plan_rows()`が読む前に
`ensure_plan_table()`で後から足した列を**ALTERしており**、写しが差し替わった
瞬間の読みが500になっていた（画面では作業スケジュールが開けず、完了の行だけ
消えた。`test_startwork`が単独で回すと落ち、通しでは前のテストの書込が列を
足していたので通る＝順番に依存していた）。

固定するのは4つ:
  1. 後から足した列が無い写しを**読み取り専用の接続**で読める（列は足さない）
  2. 開いたまま差し替えられた写し（DBMOVED）でも読める
  3. 表そのものが無い写しは空で返す
  4. `plan_rows`／`plan_row`／`plan_child_rows`の中に`ensure_plan_table(`が無い（構文木で数える）
"""
import ast
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect, cols  # noqa: E402
from backend.repositories import schedule_repo as sr  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


OLD_DDL = ('CREATE TABLE [作業予定] ([予定ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, '
           '[表示順] INTEGER, [種別] TEXT, [ロット番号] TEXT, [検査番号] TEXT, [鋳造番号] TEXT, '
           '[予定名称] TEXT, [明細JSON] TEXT, [固定開始日時] DATETIME, [見積分] INTEGER, [状態] TEXT, '
           '[実績測定ID] TEXT, [備考] TEXT, [有効] INTEGER, [登録者ID] TEXT, [更新者ID] TEXT, '
           '[登録日時] DATETIME, [更新日時] DATETIME)')


def old_snapshot():
    """検証用フィクスチャと同じ、後から足した3列（親予定ID・登録端末名・更新端末名）を
    持たない写し。"""
    d = Path(tempfile.mkdtemp())
    p = d / 'schedule_cache.sqlite3'
    con = sqlite3.connect(p)
    con.execute(OLD_DDL)
    con.execute("INSERT INTO [作業予定]([設備名],[表示順],[種別],[ロット番号],[有効]) VALUES ('EQ1',1,'作業','L0001',1)")
    con.execute("INSERT INTO [作業予定]([設備名],[表示順],[種別],[ロット番号],[有効]) VALUES ('EQ1',2,'作業','L0002',0)")
    con.commit()
    con.close()
    return p


# ---- 1. 読み取り専用の接続で、古い写しを読める ----
p = old_snapshot()
before = cols(sqlite3.connect(p), '作業予定')
c = connect(p, True)
try:
    rows = sr.plan_rows(c, 'EQ1')
    rec('後から足した列が無い写しを読み取り専用で読める', len(rows) == 1 and rows[0][4] == 'L0001', str(rows)[:120])
    rec('無い列は None で来る（親予定ID・端末名）',
        rows[0][18] is None and rows[0][20] is None and rows[0][21] is None, str(rows[0][18:]))
    rec('include_inactive で無効の行も来る', len(sr.plan_rows(c, 'EQ1', include_inactive=True)) == 2)
    one = sr.plan_row(c, rows[0][0])
    rec('plan_row も読める', one is not None and one[4] == 'L0001', str(one)[:80])
    rec('plan_child_rows は親予定IDの列が無ければ空', sr.plan_child_rows(c, rows[0][0]) == [])
    # **読み取り専用であること**を自分で確かめる（素通りの確認・§9.200）
    try:
        c.execute('ALTER TABLE [作業予定] ADD COLUMN [x] TEXT')
        rec('自己確認: この接続は本当に読み取り専用', False, '書けてしまった')
    except sqlite3.OperationalError as e:
        rec('自己確認: この接続は本当に読み取り専用', 'readonly' in str(e), str(e))
finally:
    c.close()
after = cols(sqlite3.connect(p), '作業予定')
rec('読んだだけでは列を足さない', before == after, str(sorted(set(after) - set(before))))

# ---- 2. 開いたまま差し替えられた写し（DBMOVED）でも読める ----
p = old_snapshot()
tmp = p.with_suffix('.tmp')
shutil.copy(p, tmp)
c = connect(p, False)   # GET系ルートと同じ「書ける接続」で開く
try:
    c.execute('SELECT 1').fetchall()
    os.replace(tmp, p)  # 別の要求が写し直して差し替えた
    try:
        rows = sr.plan_rows(c, 'EQ1')
        rec('差し替えられた写しでも plan_rows は読める（書かないので DBMOVED にならない）',
            len(rows) == 1, str(rows)[:80])
    except Exception as e:
        rec('差し替えられた写しでも plan_rows は読める（書かないので DBMOVED にならない）', False, repr(e))
    # 前提: 同じ状況で**書くと**落ちる（この網が空振りしていないこと）
    try:
        c.execute('ALTER TABLE [作業予定] ADD COLUMN [y] TEXT')
        rec('前提: 差し替えられた写しへ書くと readonly で落ちる', False, '書けてしまった')
    except sqlite3.OperationalError as e:
        rec('前提: 差し替えられた写しへ書くと readonly で落ちる', 'readonly' in str(e), str(e))
finally:
    c.close()

# ---- 3. 表そのものが無い写し ----
d = Path(tempfile.mkdtemp())
p = d / 'empty.sqlite3'
sqlite3.connect(p).close()
c = connect(p, True)
try:
    rec('表が無い写しは空', sr.plan_rows(c, 'EQ1') == [] and sr.plan_row(c, 1) is None
        and sr.plan_child_rows(c, 1) == [])
finally:
    c.close()

# ---- 4. 読む側に ensure_plan_table が戻っていない（構文木で数える） ----
tree = ast.parse((ROOT / 'backend' / 'repositories' / 'schedule_repo.py').read_text(encoding='utf-8'))
bad = []
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name in ('plan_rows', 'plan_row', 'plan_child_rows'):
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call) and getattr(sub.func, 'id', '') == 'ensure_plan_table':
                bad.append(f'{node.name}:{sub.lineno}')
rec('plan_rows / plan_row / plan_child_rows は ensure_plan_table を呼ばない', not bad, str(bad))
rec('書く側（plan_add）は今までどおり ensure_plan_table を通す',
    any(isinstance(n, ast.FunctionDef) and n.name == 'plan_add'
        and any(isinstance(s, ast.Call) and getattr(s.func, 'id', '') == 'ensure_plan_table' for s in ast.walk(n))
        for n in ast.walk(tree)))

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
