"""make_split_fixture.py: 仕掛フィクスチャへ「分割あり」のロットを1組足す（§9.83）

    python3 tests/make_split_fixture.py

なぜ別スクリプトか
------------------------------------------------------------------
`make_fixture.py` は**共有スケジュールDB**を毎回作り直す(テスト1本ごとに
reseedされる)。こちらが触るのは仕掛(SIKALOTNOW)側で、そちらは読み取り専用
として扱う原本なので、実行するのは「フィクスチャの中身を増やしたいとき」
だけ。結果の .sqlite3 はそのままコミットする。

何を足すか
------------------------------------------------------------------
元のフィクスチャには分割の判定材料(親子管理_子カード* / コンマ5本分割_
切断巾*)の列自体が無く、「分割あり」の経路をまったく通せなかった。

  L9000   … 親。子カード1=1, 子カード2=2, 切断巾1=500, 切断巾2=480
  L90001  … 子(ｺﾝﾏ5本ｶｰﾄﾞ区分=3)
  L90002  … 子(ｺﾝﾏ5本ｶｰﾄﾞ区分=3)

ロット番号を L9000 台にするのは、既存の L0001〜L2000 と混ざらないため
(先頭5桁で子ロットを探すので、既存ロットの検索に引っかからない番号帯に
分けておく)。子ロット番号は「親の先頭6桁 + 連番」という実データの規則
(lot-split.js の childLotNumbersFromCard)に合わせてある。

**このスクリプトは何度実行しても同じ結果になる**(列も行も、無ければ足し
あれば上書きする)。
"""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / 'db' / 'test_fixture' / 'sikalotnow_test.sqlite3'
EQUIPMENT = 'テスト設備A'
PARENT = 'L9000'
CHILDREN = [
    # (ロット番号, 製造板幅, BOX設計_横割数)
    (PARENT + '1', 500.0, 2),
    (PARENT + '2', 480.0, 1),
]
# 分割の判定材料。実カラム名は全角/半角のゆれがあるが、フィクスチャは
# lot-split.js が最初に見る表記(親子管理_子カードN / コンマ5本分割_切断巾N)で持つ。
CARD_COLS = [f'親子管理_子カード{i}' for i in range(1, 11)]
CUT_COLS = [f'コンマ5本分割_切断巾{i}' for i in range(1, 11)]
# **寸法・公差の列は足さない。**
# SQLiteの列はテーブル全体に効くので、足すと既存2000行では値がNULLになる。
# ところが lot-split.js の numberFromRow は `Number(null)` を 0 と読む
# (finiteなので採用してしまう)ため、
#   - 製造板幅 が 0
#   - 板幅公差_製造_ﾌﾟﾗｽ/ﾏｲﾅｽ が ±0（公差の幅が消える）
# として全ロットに効いてしまい、測定画面の公差スケールが壊れた
# (test_tolscale の「先読みリングの高さ」「条の並び」が実際に落ちた)。
# 分割の**検出**に要るのは子カードと切断巾だけなので、足すのはそこまでにする。
# 実機の仕掛には製造板幅・公差の列が元からあるため、子ロットの幅・公差は
# 実機では表示される(フィクスチャでは出ない)。
CHILD_COLS = []


def ensure_columns(cur):
    have = {r[1] for r in cur.execute('PRAGMA table_info(仕掛)')}
    added = []
    for name in CARD_COLS + CUT_COLS:
        if name not in have:
            cur.execute(f'ALTER TABLE 仕掛 ADD COLUMN [{name}] REAL')
            added.append(name)
    for name, typ in CHILD_COLS:
        if name not in have:
            cur.execute(f'ALTER TABLE 仕掛 ADD COLUMN [{name}] {typ}')
            added.append(name)
    return added


def upsert(cur, lot, values):
    cur.execute('SELECT count(*) FROM 仕掛 WHERE ロット番号=?', [lot])
    if cur.fetchone()[0]:
        cur.execute('UPDATE 仕掛 SET ' + ','.join(f'[{k}]=?' for k in values) +
                    ' WHERE ロット番号=?', list(values.values()) + [lot])
    else:
        cols = ['ロット番号'] + list(values)
        cur.execute('INSERT INTO 仕掛 (' + ','.join(f'[{c}]' for c in cols) + ') VALUES (' +
                    ','.join('?' * len(cols)) + ')', [lot] + list(values.values()))


def main() -> int:
    if not DB.exists():
        print(f'!! {DB} がありません', file=sys.stderr)
        return 1
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    added = ensure_columns(cur)

    common = {'鋳造番号': 'C900', '製造材質': 'A5052', '製造調質': 'H34',
              '用途名': '分割検証用', 'BOX設計_設備名': EQUIPMENT,
              '検査番号': 'K900', 'オーダー番号': 'O900',
              '取引先': '検証商事', '納入先': '検証工場',
              # 作業可否(§9.51)が立つよう、残仕掛設備ｺｰｽをこの設備で始める
              '設計_設備ｺｰｽ': EQUIPMENT, '実績_設備ｺｰｽ': EQUIPMENT,
              '残仕掛設備ｺｰｽ': EQUIPMENT}

    parent = dict(common)
    parent['親子管理_子カード1'] = 1
    parent['親子管理_子カード2'] = 2
    parent['コンマ5本分割_切断巾1'] = 500.0
    parent['コンマ5本分割_切断巾2'] = 480.0
    upsert(cur, PARENT, parent)

    for lot, _width, _strips in CHILDREN:
        row = dict(common)
        # 子カードは子ロット自身には無い(親だけが持つ)。3=分割済みの子カード。
        row['ｺﾝﾏ5本ｶｰﾄﾞ区分'] = 3
        upsert(cur, lot, row)

    conn.commit()
    n = cur.execute('SELECT count(*) FROM 仕掛').fetchone()[0]
    conn.close()
    print(f'列を追加: {len(added)}件 / 仕掛の行数: {n}')
    print(f'親 {PARENT} / 子 ' + '・'.join(c[0] for c in CHILDREN))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
