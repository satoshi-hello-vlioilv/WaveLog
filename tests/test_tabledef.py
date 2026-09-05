"""test_tabledef.py: マスタ1表の列定義は`TableDef`の1箇所（§9.324 R1）

以前は1つの表について CREATE／`_ADDED_COLUMNS`／SELECT／`r[N]`／UPDATE・INSERTの
5箇所が別々に列を数えており、**CREATEだけが古いまま**で新しいDBの最初の1回だけ
`no such column: 繰返`（帳票ブロック）／`役割`（操業データ項目）で落ちていた
（2回目は「無ければ足す」が足すので通る＝「リロードすると直る」）。

固定するのは4つ:
  1. `TableDef`の契約——CREATEに全列が入る／`fetch`は在る列だけで読んで無い列は
     `None`／`insert`・`update`は渡した鍵だけ書き監査列はここが書く／知らない列は断る
  2. **新しいDB**で3つのマスタ（帳票ブロック・ロール・操業データ項目／選択肢）が
     最初の1回から読めて、部分更新が他の列を消さない
  3. **読み取り専用**の古い表（列が足りない）でも選択肢が読める（§9.221 ③）
  4. `_row`／`_row_to_item`が**位置（`r[N]`）で読んでいない**こと（機械で数える・§9.96）
"""
import ast
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.db_access import connect, cols  # noqa: E402
from backend.repositories.table_def import TableDef, AUDIT  # noqa: E402
from backend.repositories import report_block_repo as rb  # noqa: E402
from backend.repositories import roll_repo as rr  # noqa: E402
from backend.repositories import operation_repo as op  # noqa: E402
from backend.repositories.master_repo import ensure_equipment_master_table  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS: ' if ok else 'FAIL: ') + name + (f' -- {detail}' if detail else ''))


def fresh():
    return Path(tempfile.mkdtemp()) / 'm.sqlite3'


# ---- 1. TableDef の契約 ----
D = TableDef('T試験', 'ID', (('名前', 'TEXT'), ('数', 'INTEGER'), ('後から', 'TEXT')),
             order_by='[数],[ID]')
sql = D.create_sql()
rec('CREATEに鍵・全列・監査列が入る',
    all(f'[{n}]' in sql for n in ('ID', '名前', '数', '後から') + tuple(n for n, _ in AUDIT)), sql)
try:
    TableDef('X', 'ID', (('a', 'TEXT'), ('a', 'TEXT')))
    rec('列名の重なりは断る', False)
except ValueError:
    rec('列名の重なりは断る', True)
try:
    TableDef('X', 'ID', (('登録者ID', 'TEXT'),))
    rec('監査列と同じ名前は断る', False)
except ValueError:
    rec('監査列と同じ名前は断る', True)

p = fresh()
with connect(p) as c:
    rec('表が無ければ fetch は空', D.fetch(c) == [])
    D.create(c)
    i1 = D.insert(c, {'名前': 'a', '数': 2}, 'u1')
    i2 = D.insert(c, {'名前': 'b', '数': 1, '後から': 'x'}, 'u1')
    rows = D.fetch(c)
    rec('insert は渡した鍵だけ書き、監査列はここが書く',
        [r['名前'] for r in rows] == ['b', 'a'] and rows[0]['登録者ID'] == 'u1'
        and rows[1]['後から'] is None, rows)
    D.update(c, i1, {'数': 0}, 'u2')
    g = D.get(c, i1)
    rec('update は渡した鍵だけ書く（他の列は残る）',
        g['数'] == 0 and g['名前'] == 'a' and g['更新者ID'] == 'u2' and g['登録者ID'] == 'u1', g)
    try:
        D.update(c, i1, {'綴り違い': 1}, 'u2')
        rec('知らない列は断る', False)
    except ValueError:
        rec('知らない列は断る', True)
    rec('get は無ければ None', D.get(c, 999) is None)
    rec('fetch の where/args', [r['ID'] for r in D.fetch(c, '[名前]=?', ['b'])] == [i2])

# 古い表（列が足りない）を在る列だけで読む
p_old = fresh()
con = sqlite3.connect(p_old)
con.execute('CREATE TABLE [T試験] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT, [名前] TEXT)')
con.execute("INSERT INTO [T試験]([名前]) VALUES ('古い')")
con.commit()
con.close()
with connect(p_old, True) as c:
    rows = D.fetch(c)
    rec('列が足りない表も在る列だけで読み、無い列は None',
        len(rows) == 1 and rows[0]['名前'] == '古い' and rows[0]['数'] is None
        and rows[0]['後から'] is None, rows)
with connect(p_old) as c:
    added = D.add_missing(c)
    rec('add_missing は無い列だけ足す（監査列も）',
        set(added) >= {'数', '後から', '登録者ID'} and '名前' not in added, added)
    rec('2度目は何も足さない', D.add_missing(c) == [])

# ---- 2. 新しいDBで最初の1回から読める ----
p = fresh()
with connect(p) as c:
    try:
        n = len(rb.block_rows(c))
        rec('帳票ブロック: 新しいDBの最初の1回で読める', n > 0, n)
    except Exception as e:
        rec('帳票ブロック: 新しいDBの最初の1回で読める', False, repr(e))
    try:
        rows = op.item_rows(c)
        rec('操業データ項目: 新しいDBの最初の1回で読める',
            len(rows) > 0 and any(r['builtin'] for r in rows), len(rows))
        rec('操業データ選択肢: 新しいDBの最初の1回で読める', len(op.choice_rows(c)) > 0)
    except Exception as e:
        rec('操業データ項目: 新しいDBの最初の1回で読める', False, repr(e))
    try:
        ensure_equipment_master_table(c)
        c.cursor().execute("INSERT INTO [設備マスタ]([設備名],[表示順],[有効]) VALUES ('TD設備',1,1)")
        c.commit()
        rec('ロール: 新しいDBの最初の1回で読める', rr.roll_rows(c) == [])
    except Exception as e:
        rec('ロール: 新しいDBの最初の1回で読める', False, repr(e))
    # **CREATEに全列が入っていること**を直接見る——`fetch`は在る列だけで読むので
    # 「読める」だけを見る網は、CREATEが古くても通る（実際に素通りした）。
    for label, d in (('帳票ブロック', rb.DEF), ('操業データ項目', op.ITEM_DEF),
                     ('操業データ選択肢', op.CHOICE_DEF), ('ロール', rr.DEF)):
        missing = [n for n in d.all_names() if n not in set(cols(c, d.table))]
        rec(f'{label}: 新しいDBの表に全列が入っている（CREATEが古くない）', not missing, missing)

    # 部分更新が他の列を消さない（§9.212 ②）
    bid = rb.block_upsert(c, 'u1', equipment='TD設備', name='TD塊', content='a=b|2',
                          repeat='子ロット', full='最大')
    rb.block_upsert(c, 'u2', block_id=bid, name='TD塊', note='memo')
    hit = [r for r in rb.block_rows(c, True) if r.get('id') == bid]
    rec('帳票ブロック: 備考だけ直しても内容・繰返・最大表示は残る',
        bool(hit) and hit[0].get('content') == 'a=b|2' and hit[0].get('repeat') == '子ロット'
        and hit[0].get('full') == '最大', hit and {k: hit[0].get(k) for k in ('content', 'repeat', 'full')})

    rid = rr.roll_upsert(c, 'u1', equipment='TD設備', name='TDロール', contact_face='上',
                         dia_max='100', dia_min='90', ref_no='B1', note='n')
    rr.roll_upsert(c, 'u2', roll_id=rid, note='n2')
    r = [x for x in rr.roll_rows(c) if x['id'] == rid][0]
    rec('ロール: 備考だけ直しても径・基準番号は残る',
        r['diaMax'] == 100.0 and r['diaMin'] == 90.0 and r['refNo'] == 'B1' and r['note'] == 'n2', r)

    iid = op.item_upsert(c, 'u1', equipment='*', group='TD', name='TD項目', kind='数値',
                         auto_formula='[条数]*2', record_show=False, inline_add=True,
                         free_text=True, choice='X', widget='プルダウン')
    # 専用の口が書く列（設備別レイアウト・記録群・記録順）を item_upsert が触らないこと
    c.cursor().execute('UPDATE [操業データ項目マスタ] SET [設備別レイアウト]=?,[記録群]=?,[記録順]=? '
                       'WHERE [項目ID]=?', ['{"EQ":{"span":6}}', 'RG', 7, iid])
    c.commit()
    op.item_upsert(c, 'u2', item_id=iid, name='TD項目', note='memo')
    it = [x for x in op.item_rows(c, True) if x['id'] == iid][0]
    rec('操業データ項目: 備考だけ直しても式・記録表示・間接登録・上書きは残る',
        it['autoFormula'] == '[条数]*2' and it['recordShow'] is False and it['inlineAddSaved']
        and it['overrides'] == {'EQ': {'span': 6}} and it['recordGroup'] == 'RG'
        and it['recordOrder'] == 7 and it['note'] == 'memo',
        {k: it[k] for k in ('autoFormula', 'recordShow', 'inlineAddSaved', 'overrides',
                            'recordGroup', 'recordOrder', 'note')})
    same = op.item_upsert(c, 'u1', equipment='*', name='TD項目', kind='文字', note='自然キー')
    it = [x for x in op.item_rows(c, True) if x['id'] == iid][0]
    rec('操業データ項目: 自然キーで同じ行へ（鍵は書き換えない）',
        same == iid and it['note'] == '自然キー' and it['equipment'] == '*', (same, iid))

    cid = op.choice_upsert(c, 'TDまとまり', '値1', 'u1', reading='よみ', parent_value='親')
    cid2 = op.choice_upsert(c, 'TDまとまり', '値1', 'u1', note='説明だけ')
    ch = [x for x in op.choice_rows(c, True) if x['id'] == cid][0]
    rec('操業データ選択肢: 説明だけ直してもよみ・親の値は残る',
        cid == cid2 and ch['reading'] == 'よみ' and ch['parentValue'] == '親'
        and ch['note'] == '説明だけ' and ch['enabled'], ch)
    op.choice_upsert(c, 'TDまとまり', '値1', 'u1', choice_id=cid, enabled=False)
    ch = [x for x in op.choice_rows(c, True) if x['id'] == cid][0]
    rec('操業データ選択肢: IDで無効にしてもよみ・親の値は残る',
        not ch['enabled'] and ch['reading'] == 'よみ' and ch['parentValue'] == '親', ch)

# ---- 3. 読み取り専用の古い選択肢マスタ ----
p_old = fresh()
con = sqlite3.connect(p_old)
con.execute('CREATE TABLE [操業データ選択肢マスタ] ([選択肢ID] INTEGER PRIMARY KEY AUTOINCREMENT,'
            '[選択肢名] TEXT,[値] TEXT,[説明] TEXT,[表示順] INTEGER,[有効] INTEGER)')
con.execute("INSERT INTO [操業データ選択肢マスタ]([選択肢名],[値],[表示順],[有効]) VALUES ('A','v',10,-1)")
con.commit()
con.close()
with connect(p_old, True) as c:
    try:
        rows = op.choice_rows(c)
        rec('読み取り専用の古い表でも選択肢が読める（無い列は既定）',
            len(rows) == 1 and rows[0]['value'] == 'v' and rows[0]['used'] == 0
            and rows[0]['parentValue'] == '' and rows[0]['equipment'] == '', rows)
    except Exception as e:
        rec('読み取り専用の古い表でも選択肢が読める（無い列は既定）', False, repr(e))

# ---- 4. 位置で読んでいない（機械で数える） ----
def _positional(path, fn_name, arg):
    tree = ast.parse(Path(path).read_text(encoding='utf-8'))
    hits = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == fn_name:
            for sub in ast.walk(node):
                if (isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name)
                        and sub.value.id == arg and isinstance(sub.slice, ast.Constant)
                        and isinstance(sub.slice.value, int)):
                    hits.append(sub.lineno)
    return hits


for path, fn, arg in (('backend/repositories/report_block_repo.py', '_row', 'r'),
                      ('backend/repositories/roll_repo.py', '_row', 'r'),
                      ('backend/repositories/operation_repo.py', '_row_to_item', 'r'),
                      ('backend/repositories/operation_repo.py', 'choice_rows', 'r')):
    h = _positional(ROOT / path, fn, arg)
    rec(f'{path}:{fn} は位置（{arg}[N]）で読まない', not h, h[:5])

# 自己確認: 位置で読む形を注ぐと数える（網が素通りしていないこと）
src = 'def _row(r):\n    return {"a": r[0], "b": r[3]}\n'
tmp = Path(tempfile.mkdtemp()) / 'x.py'
tmp.write_text(src, encoding='utf-8')
rec('自己確認: r[N] を注ぐと数える', len(_positional(tmp, '_row', 'r')) == 2)

ng = [n for n, ok in R if not ok]
print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
