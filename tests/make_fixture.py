# -*- coding: utf-8 -*-
"""tests/make_fixture.py: 検証用フィクスチャを既知の状態へ作り直す。

    python3 tests/make_fixture.py          # 作業予定を種データへ戻す
    python3 tests/make_fixture.py --show   # 今の中身を表示するだけ

なぜ要るか
----------
テストは共有スケジュールDB(db/test_fixture/share/schedule.sqlite3)へ
作業予定を追加する。後始末を入れる前の実行が残した分が積み上がり、
実測で1003件まで増えていた。増えると:

  * 予定の描画・実績突合が遅くなり、固定待ちのテストが時間切れで落ちる
    (実際にtest_cols/test_split_layout/test_histdelが落ちた)
  * 「先頭の予定行」を見るテストが、どの行を掴むか実行ごとに変わる
    (test_content_applyが落ちた)

安全網が実行のたびに変わるのでは安全網にならないので、既知の状態へ
戻せるようにする。仕掛(SIKALOTNOW)・品質(SIKALOTDEF)は読み取り専用で
テストが書き換えないため作り直さない。
"""
from __future__ import annotations
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARE = ROOT / 'db' / 'test_fixture' / 'share' / 'schedule.sqlite3'
NOW = ROOT / 'db' / 'test_fixture' / 'sikalotnow_test.sqlite3'

# 種データの量。テストが必要とする最低限より少し多めに置く:
#  - 並べ替え・一括追加・分割表示の各テストが複数行を前提にする
#  - 作業可否フラグの検証で「可」と「不可」の両方が要る
SEED_A = 40   # テスト設備A(主役。ほとんどのテストがこの設備を見る)
SEED_B = 6    # テスト設備B(俯瞰ボードで2設備以上あることの確認用)


def show(conn: sqlite3.Connection) -> None:
    for (name,) in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        n = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
        print(f'  {name}: {n}件')
    print('  -- 作業予定の設備別 --')
    for eq, n in conn.execute(
            'SELECT 設備名,COUNT(*) FROM 作業予定 GROUP BY 設備名 ORDER BY 設備名'):
        print(f'     {eq}: {n}')


def lots(limit: int, offset: int = 0):
    """仕掛フィクスチャから、残仕掛設備ｺｰｽ付きのロットを順に取る。
    実データと同じ形(detailに残仕掛設備ｺｰｽを持つ)で予定を作るため。"""
    with sqlite3.connect(f'file:{NOW}?mode=ro', uri=True) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            'SELECT * FROM 仕掛 ORDER BY ロット番号 LIMIT ? OFFSET ?', [limit, offset])]


def seed(conn: sqlite3.Connection) -> None:
    import json
    conn.execute('DELETE FROM 作業予定')
    conn.execute("DELETE FROM sqlite_sequence WHERE name='作業予定'")
    order = 0
    for equipment, count, offset in (('テスト設備A', SEED_A, 0),
                                     ('テスト設備B', SEED_B, SEED_A)):
        for row in lots(count, offset):
            order += 1
            # 画面から投入したときと同じ形にする(§9.67: 残仕掛設備ｺｰｽを
            # 予定側に持たせ、作業可否フラグを往復ゼロで判定できるように)。
            detail = {
                'lotNo': row['ロット番号'], 'castingNo': row['鋳造番号'],
                'mfgMaterial': row['製造材質'], 'mfgTemper': row['製造調質'],
                'purposeName': row['用途名'],
                'residualCourse': row['残仕掛設備ｺｰｽ'],
                '残仕掛設備ｺｰｽ': row['残仕掛設備ｺｰｽ'],
            }
            conn.execute(
                'INSERT INTO 作業予定 ([設備名],[表示順],[種別],[ロット番号],[検査番号],'
                '[鋳造番号],[予定名称],[明細JSON],[状態],[有効],[登録者ID],[更新者ID],'
                '[登録日時],[更新日時]) '
                # 状態・有効は schedule_repo.plan_add と同じ値にする。
                # 状態は PLAN_REORDERABLE_STATE('予定')、有効はAccess由来の
                # 真値 -1。ここを外すと行は出るのに「予定」扱いされず、
                # 開始ボタンや並べ替えの検証が静かに落ちる(実際に落ちた)。
                "VALUES (?,?,'作業',?,?,?,'',?,'予定',-1,'fixture','fixture',"
                "datetime('now'),datetime('now'))",
                [equipment, order, row['ロット番号'], row['検査番号'],
                 row['鋳造番号'], json.dumps(detail, ensure_ascii=False)])
    conn.commit()


def main() -> int:
    if not SHARE.exists():
        print(f'!! フィクスチャがありません: {SHARE}', file=sys.stderr)
        return 1
    with sqlite3.connect(SHARE) as conn:
        if '--show' in sys.argv:
            print(f'{SHARE}:')
            show(conn)
            return 0
        print('作り直す前:')
        show(conn)
        seed(conn)
        print('作り直した後:')
        show(conn)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
