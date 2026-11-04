# -*- coding: utf-8 -*-
"""test_parity.py: Python→Rust の試験表（`tests/fixtures/parity/*.json`）が、今の Python の答えと同じか（§9.634）。

============================================================
なぜ要るか
------------------------------------------------------------
Rust（`desktop/core/tests/parity.rs`）は試験表の答えに合わせて書く。**答えの正は Python** なので、Python の関数を
直したのに表を作り直さないと、Rust は古い答えに合わせたまま「同じ」と言ってしまう。ここで表と今の Python を突き合わせる。
Rust の側が表と同じかは `cargo test -p wavelog-core --test parity`（手元と CI の windows）が見る。

------------------------------------------------------------
約束
------------------------------------------------------------
 * 表は `tests/lib/parity_cases.py` の問いを今の Python に通した物と1字も違わない（作り直しは `--write`）。
 * 表に無い領域のファイルを置かない（消した領域の表が残ると、Rust だけが古い答えを見続ける）。
 * どの領域も問いを持つ（空の表は「同じ」と言うだけで何も見ていない）。
 * 網そのものが素通りしないこと: 表の答えを1つ書き換えると落ちる（記憶の中だけ・本物の置き場へは書かない）。
============================================================
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests' / 'lib'))
import parity_cases as pc  # noqa: E402

PASS = FAIL = 0


def rec(name, ok, detail=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'  PASS: {name}')
    else:
        FAIL += 1
        print(f'  FAIL: {name} -- {detail}')


def stale(areas, read):
    """作り直すべき領域（今の Python の答えと違う表）の名前。"""
    return [a for a in areas if read(a) != pc.text(a)]


def main():
    areas = list(pc.cases())
    saved = {p.stem: p.read_text(encoding='utf-8') for p in pc.OUT.glob('*.json')}
    old = stale(areas, lambda a: saved.get(a))
    rec('試験表が今の Python の答えと同じ', not old, f'{old}（python3 tests/lib/parity_cases.py --write）')
    extra = sorted(set(saved) - set(areas))
    rec('表に無い領域のファイルが無い', not extra, extra)
    empty = [a for a in areas if not pc.cases()[a]]
    rec('どの領域も問いを持つ', not empty, empty)
    n = sum(len(v) for v in pc.cases().values())
    print(f'  試験表: {len(areas)} 領域・{n} 問')

    # 欠陥の注入（記憶の中だけ）: 1つの答えを書き換えた表は「古い」と言われる
    a = areas[0]
    rows = json.loads(saved.get(a, '[]'))
    if rows:
        rows[0]['want'] = '__注入__'
        bad = json.dumps(rows, ensure_ascii=False, indent=0, allow_nan=False) + '\n'
        rec('注入: 答えを書き換えた表 → 落ちる', stale([a], lambda _a: bad) == [a])

    print(f'\n結果: {PASS} PASS / {FAIL} FAIL')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
