# -*- coding: utf-8 -*-
"""test_rustplan.py: 業務の Python を Rust へ移す移行の決まりを見張る（§9.633・計画 docs/RUST_MIGRATION_PLAN.md）。

============================================================
なぜ要るか
------------------------------------------------------------
移行の途中で壊れやすいのは**境界**——同じ事実を2つの言語が書く（§9.563 の境界の不具合 9件）、
Rust に移したのに Python の側が残る（同じ役目を2つ持つ）、影で比べているつもりの道が Python に無い。
どれも黙って起きるので、ルートの表（`desktop/core/src/routes.rs`）と Python のコードを突き合わせて止める。

------------------------------------------------------------
約束
------------------------------------------------------------
 * Rust が答える（Serve）ルートは、Python のルート表に**残っていない**（移したら Python の側を消す）。
 * 影（Shadow）のルートは、Python のルート表に**ある**（比べる相手がいる）。
 * Rust が書き手の事実（`OWNS`）を、Python が**書いていない**（1つの事実の書き手は1言語・`data.md`）。
 * 書き手の対応表（`docs/RUST_WRITERS.md`）は今のコードから作った物と同じ（作り直しは
   `python3 tests/lib/rust_progress.py --write`）。移す単位はこの表で切るので、古い表で切らせない。
 * 物差しの数が読める（ルート数・業務の行数・書き手の表の数が 0 でない）。
 * 網そのものが素通りしないこと: 欠陥（Serve なのに Python に残る・OWNS を Python が書く・表が古い）を
   **記憶の中で**注ぎ、それぞれ落ちる（本物の置き場へは書かない・§9.504）。
============================================================
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests' / 'lib'))
import rust_progress as rp  # noqa: E402

PASS = FAIL = 0


def rec(name, ok, detail=''):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f'  PASS: {name}')
    else:
        FAIL += 1
        print(f'  FAIL: {name} -- {detail}')


def problems(routes, owns, py_routes, writers, md_now, md_saved):
    """決まりに外れた物を字で返す（空なら守れている）。網の本体と欠陥の注入が同じ関数を通る。"""
    out = []
    py = [(r['method'], r['path']) for r in py_routes]
    for r in routes:
        hit = any(m == r['method'] and rp.same_path(r['path'], p) for m, p in py)
        if r['mode'] == 'serve' and hit:
            out.append(f"Rust が答える {r['method']} {r['path']} が Python に残っている")
        if r['mode'] == 'shadow' and not hit:
            out.append(f"影の {r['method']} {r['path']} が Python に無い（比べる相手がいない）")
    for t in owns:
        if t in writers:
            out.append(f'Rust が書き手の {t} を Python も書いている: {sorted(writers[t])}')
    if md_now != md_saved:
        out.append('docs/RUST_WRITERS.md が今のコードと違う（python3 tests/lib/rust_progress.py --write）')
    return out


def main():
    routes, owns = rp.rust_table()
    py_routes = rp.python_routes()
    writers = rp.writers()
    md_now = rp.writers_md()
    md_saved = rp.WRITERS_MD.read_text(encoding='utf-8') if rp.WRITERS_MD.exists() else ''

    found = problems(routes, owns, py_routes, writers, md_now, md_saved)
    rec('移行の決まりを守っている', not found, '／'.join(found))

    m = rp.measure()
    print('  物差し: ' + '・'.join(f'{k}={v}' for k, v in m.items()))
    rec('物差しの数が読める', m['python_routes'] > 100 and m['python_logic_lines'] > 1000 and m['tables_written_by_python'] > 10, m)

    # 欠陥の注入（記憶の中だけ）。前から在る違反に当たって通らないよう、注ぐ前との差で見る
    base = len(found)
    some_py = py_routes[0]
    serve_left = routes + [{'method': some_py['method'], 'path': some_py['path'].replace('{*}', '{id}'), 'mode': 'serve'}]
    rec('注入: Serve なのに Python に残る → 落ちる', len(problems(serve_left, owns, py_routes, writers, md_now, md_saved)) == base + 1)
    shadow_alone = routes + [{'method': 'GET', 'path': '/api/__no_such_route__', 'mode': 'shadow'}]
    rec('注入: 影の相手が無い → 落ちる', len(problems(shadow_alone, owns, py_routes, writers, md_now, md_saved)) == base + 1)
    written = next(iter(t for t in writers if t != '(式で決まる)'))
    rec('注入: OWNS を Python が書く → 落ちる', len(problems(routes, owns + [written], py_routes, writers, md_now, md_saved)) == base + 1)
    rec('注入: 対応表が古い → 落ちる', len(problems(routes, owns, py_routes, writers, md_now, md_saved + 'x')) == base + (0 if md_now != md_saved else 1))

    print(f'\n結果: {PASS} PASS / {FAIL} FAIL')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
