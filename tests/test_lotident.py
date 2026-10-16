"""test_lotident.py: 同じロットを見分ける決まり（ロットの見分け方・§9.612）

============================================================
利用者の指示
------------------------------------------------------------
「仕掛一覧から作業スケジュールを組み込む際に、ロットを消し込む処理の条件も見えないので、こちらも設定ができるように
 汎用化して組み込んでください。過去の完了ロットと同じ番号が来たら同じロットナンバーを表示できない可能性もあるので
 条件も、ロット番号、鋳造番号、製造材質、BOX番号といった組み合わせかつ複数回同一工程を通るものでも正しく
 スケジューリングで区別できるようにしたい」
答え: 「区別の列も設定で選ぶ」（鍵の列の組と、回数を見分ける列の両方を設定で選ぶ）。

物差し（**直す前にも同じ材料で測った**・前の値は §9.612 の決定記録）:
 L1. 同じロットを2回目に組んだ予定は、1回目の測定の記録で「完了」にならない（予定のまま）
 L2. 2回目の記録が来たら、1回目の予定は1回目の記録・2回目の予定は2回目の記録に当たる（1件の記録は1本の予定にだけ）
 L3. 見分け方の答えは1箇所（`lot_identity.identity()`）。既定は ロット番号・鋳造番号・製造材質
 L4. 鍵の列はデータソース（役割「作業」）の行で変えられる（BOX番号を足す・区別の列を足す）
 L5. 鍵は書き方の違いを同じと読む（全角・半角・大小・前後の空白）・区別の列の値が違えば別の回
 L6. 予定の行は鍵（`lotKey`）を持ち、仕掛一覧の行（`/api/table`の`__lotKey`）も同じ1箇所で作る（画面は鍵を作らない）

**材料は自分で作る**（一時フォルダの共有DB・設定DB）。サーバーは要らない（1段目・純粋な網）。
============================================================
"""
import json
import pathlib
import shutil
import sys
import tempfile
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import schedule_calc as sc  # noqa: E402 パスを通してから読む
from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr  # noqa: E402 パスを通してから読む
from backend.repositories import master_repo as mr  # noqa: E402 パスを通してから読む

try:
    from backend import lot_identity as li  # noqa: E402 パスを通してから読む
except ImportError:
    li = None

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


EQ = '見分け試験設備'
NOW = datetime.now().replace(second=0, microsecond=0)
sc.actual_match.lookup = lambda detail, entry, defs=None: {'missing': False, 'reason': ''}
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_lotident_'))
mc = connect(tmp / 'master.sqlite3', False)
mr.ensure_equipment_master_table(mc)
mr.ensure_equipment_master_table(mc)
mc.execute('INSERT INTO [設備マスタ] ([設備名],[表示順],[有効]) VALUES (?,10,-1)', [EQ])
mc.commit()


def plan_db(name, rows):
    """rows は (鍵, ロット, 入れた時刻)。戻り値: (接続, 鍵→予定ID)。"""
    c = connect(tmp / name, False)
    sr.ensure_plan_table(c)
    sr.ensure_plan_table(c)
    ids = {}
    for key, lot, at in rows:
        cur = c.cursor()
        cur.execute('INSERT INTO [作業予定] ([設備名],[表示順],[種別],[ロット番号],[鋳造番号],[予定名称],[明細JSON],[見積分],[状態],[有効],[登録日時]) '
                    'VALUES (?,?,?,?,?,?,?,?,?,1,?)',
                    [EQ, len(ids) + 1, '作業', lot, 'C1', '',
                     json.dumps({'lotNo': lot, 'castingNo': 'C1', 'mfgMaterial': 'A5052', 'ロット番号': lot, '鋳造番号': 'C1',
                                 '製造材質': 'A5052'}, ensure_ascii=False), 60, '予定', at.strftime('%Y-%m-%d %H:%M:%S')])
        ids[key] = cur.lastrowid
    c.commit()
    return c, ids


def record(rid, lot, start, minutes=50):
    return {'id': rid, 'status': '完了', 'updated_at': (start + timedelta(minutes=minutes)).isoformat(), 'equipment': EQ,
            'payload': json.dumps({'basic': {'lotNo': lot, 'castingNo': 'C1', 'mfgMaterial': 'A5052'},
                                   'settings': {'registeredEquipment': EQ},
                                   'createdAt': start.isoformat(),
                                   'workTime': {'startAt': start.isoformat(), 'endAt': (start + timedelta(minutes=minutes)).isoformat()}})}


def expand(c, recs):
    idx = sc._build_actual_index(recs)
    out = sc._expand_plan_with(c, mc, EQ, NOW, sr.plan_rows(c, EQ), include_unplanned=False, actual_index=idx)
    return {e['id']: e for e in out['entries']}


T1 = NOW - timedelta(days=3)       # 1回目を組んだ
T2 = NOW - timedelta(hours=5)      # 2回目を組んだ
try:
    # ---- L1: 2回目の予定は1回目の記録で完了にならない ----
    c1, i1 = plan_db('l1.sqlite3', [('A1', 'LX', T1), ('A2', 'LX', T2)])
    b1 = expand(c1, [record('r1', 'LX', T1 + timedelta(hours=2))])
    rec('L1: 同じロットの2回目の予定は、1回目の記録で完了にならない（予定のまま）',
        b1[i1['A1']]['state'] == '完了' and b1[i1['A2']]['state'] == '予定',
        (b1[i1['A1']]['state'], b1[i1['A2']]['state']))

    # ---- L2: 記録が2件なら、それぞれの予定に当たる ----
    b2 = expand(c1, [record('r1', 'LX', T1 + timedelta(hours=2)), record('r2', 'LX', T2 + timedelta(hours=1))])
    got = ((b2[i1['A1']].get('actualRecordId') or ''), (b2[i1['A2']].get('actualRecordId') or ''))
    rec('L2: 1回目の予定は1回目の記録・2回目の予定は2回目の記録に当たる', got == ('r1', 'r2'), got)

    # ---- L3: 答えは1箇所・既定 ----
    ident = li.identity() if li else None
    rec('L3: 見分け方の答えは lot_identity.identity() の1箇所・既定は ロット番号・鋳造番号・製造材質',
        bool(ident) and ident.get('keys') == ['ロット番号', '鋳造番号', '製造材質'] and ident.get('pass') == [], ident)

    # ---- L4・L5: 設定で変えられる・書き方の違いを同じと読む・区別の列 ----
    if li:
        conf = li.parse({'keys': ['ロット番号', '鋳造番号', '製造材質', 'BOX番号'], 'pass': ['前工程実績_作業終了_日付']})
        r_a = {'ロット番号': 'ｌｘ１ ', '鋳造番号': 'c1', '製造材質': 'A5052', 'BOX番号': 'B7', '前工程実績_作業終了_日付': '2026-10-01'}
        r_b = dict(r_a, **{'ロット番号': 'LX1'})
        r_c = dict(r_b, **{'前工程実績_作業終了_日付': '2026-10-14'})
        r_d = dict(r_b, **{'BOX番号': 'B8'})
        rec('L4: 鍵の列に BOX番号・区別の列を足せる（parse が並びを保つ）',
            conf['keys'][-1] == 'BOX番号' and conf['pass'] == ['前工程実績_作業終了_日付'], conf)
        rec('L5: 全角・半角・大小・前後の空白の違いは同じロット', li.key_of(r_a, conf) == li.key_of(r_b, conf),
            (li.key_of(r_a, conf), li.key_of(r_b, conf)))
        rec('L5: 区別の列（前工程の終了日）が違えば別の回・BOX番号が違えば別のロット',
            li.key_of(r_b, conf) != li.key_of(r_c, conf) and li.key_of(r_b, conf) != li.key_of(r_d, conf))
        bad = li.parse('壊れた{')
        rec('L4: 読めない設定は既定へ倒し、理由を言う', bad['keys'] == ['ロット番号', '鋳造番号', '製造材質'] and bad.get('note'), bad)
    else:
        rec('L4: 鍵の列に BOX番号・区別の列を足せる', False, 'lot_identity が無い')
        rec('L5: 書き方の違いは同じロット', False, 'lot_identity が無い')

    # ---- L6: 予定の行は鍵を持ち、画面の作り方と同じ答え ----
    k_py = b1[i1['A2']].get('lotKey')
    rec('L6: 予定の行は鍵（lotKey）を持つ', bool(k_py), k_py)
    if li:
        rows = [{'ロット番号': 'ｌｘ', '鋳造番号': 'ｃ1', '製造材質': ' a5052'}, {'ﾛｯﾄ番号': 'LX', 'CYNO': 'C1', 'LTA': 'A5052'}, {'ロット番号': ''}]
        li.attach(rows)
        keys = [r.get(li.ROW_KEY) for r in rows]
        rec('L6: 仕掛の行の鍵（一覧の応答の __lotKey）は予定の行と同じ作り方（別名の列でも同じ・ロット番号が空なら鍵なし）',
            keys[0] == keys[1] == k_py and keys[2] == '', keys)
    else:
        rec('L6: 仕掛の行の鍵は予定の行と同じ作り方', False, 'lot_identity が無い')
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f'=== SUMMARY === {sum(R)}/{len(R)} PASS')
sys.exit(0 if all(R) else 1)
