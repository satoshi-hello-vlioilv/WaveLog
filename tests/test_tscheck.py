# -*- coding: utf-8 -*-
"""test_tscheck.py: 画面のJSを TypeScript の検査器で調べる（§9.566・§9.563 の次の段 2）。

============================================================
なぜ要るか
------------------------------------------------------------
実際に起きた不具合を分類すると、**件数でいちばん多いのは JS の型・形**（17件・§9.563）——
無い名前を`typeof`で確かめて一度も通らない（§9.354）、閉じたあとも古い素の名前で呼ぶ（§9.355）、
公開し忘れ（`makeFloatingWindow`）、位置引数の関数をオブジェクトで呼ぶ（§9.241）、
`S`の鍵の綴り違い（§9.327）。eslint はこのうち 1件しか止めない（`typeof x` は no-undef の外）。

過去の10件を今のコードへ1件ずつ注いで数えた（§9.566）: eslint 1／この網 7。
残る3件のうち2件は`null`・`undefined`の扱い（strict が要る）で、この網の外だと決めてある。

------------------------------------------------------------
約束
------------------------------------------------------------
 * 検査は`tests/lib/js_types.js`の1本（公開の型は**名乗っている式そのもの**から起こす。
   宣言を手で書いた写しは持たない）。
 * 数はファイルごとに**今の件数を超えない**（`tests/fixtures/tscheck_baseline.json`）。
   減ったら上限も下げる——`python3 tests/test_tscheck.py --update`（上げる更新は断る）。
   新しく書く物は0件で足す。いまの件数は**推し量りの狭さ**が大半で、取り違えではない。
 * 宣言の中で解けずに any へ倒した項目は0（倒れたら見張りが黙るので数えて落とす）。
 * typescript が無い環境では**落とす**（黙って通さない）。入れ方は`npm i -g typescript`。
 * 網そのものが素通りしないこと: 名前空間の綴り違いと、位置引数の関数をオブジェクトで呼ぶ形を
   記憶の中で注いで、両方が数えられる（本物の置き場へは書かない・§9.504）。
============================================================
"""
import collections
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOL = ROOT / 'tests' / 'lib' / 'js_types.js'
BASELINE = ROOT / 'tests' / 'fixtures' / 'tscheck_baseline.json'
R = []

# 網そのものを確かめる2つの欠陥（どちらも過去に実際に起きた形）。
PROBES = [
    ('static/js/measure/lot-split.js',
     "if(typeof WL.measureInput.toleranceDetail!=='function'",
     "if(typeof WL.measureInput.toleranceDetial!=='function'",
     'toleranceDetial'),
    ('static/js/schedule/schedule-view.js',
     'const frameShiftCache=WL.ttlCache(5*60*1000,12);',
     'const frameShiftCache=WL.ttlCache({ttl:5*60*1000,max:12});',
     "'{ ttl: number; max: number; }' is not assignable to parameter of type 'number'"),
]


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def node_cmd():
    node = os.environ.get('WAVELOG_NODE') or shutil.which('node') or '/opt/node22/bin/node'
    return node if pathlib.Path(node).exists() or shutil.which(node) else None


def run(node, overrides=()):
    cmd = [node, str(TOOL)]
    for rel, src in overrides:
        cmd += ['--override', f'{rel}={src}']
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), timeout=600)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout)[:600])
    return json.loads(r.stdout)


def counts(diags):
    c = collections.Counter(d['file'] for d in diags)
    return dict(sorted(c.items()))


def main(update=False):
    node = node_cmd()
    rec('node が使える', bool(node))
    if not node:
        return
    try:
        res = run(node)
    except RuntimeError as e:
        rec('typescript が使える（無ければ npm i -g typescript）', False, e)
        return
    rec('typescript が使える', True, f"{res['files']}本・WL の項目 {res['wlCount']}・土台の名前 {res['globCount']}")
    rec('起こした宣言に any へ倒した項目が無い（倒れると見張りが黙る）', not res['anyNames'], res['anyNames'])

    now = counts(res['diagnostics'])
    base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    over = [f'{f} {base.get(f, 0)}→{n}' for f, n in now.items() if n > base.get(f, 0)]
    under = [f'{f} {b}→{now.get(f, 0)}' for f, b in base.items() if now.get(f, 0) < b]
    if over:
        by = collections.defaultdict(list)
        for d in res['diagnostics']:
            by[d['file']].append(f"  {d['file']}:{d['line']} TS{d['code']} {d['msg'][:160]}")
        for line in over[:5]:
            print('\n'.join(by[line.split(' ')[0]][:8]))
    if update:
        if over and base:   # 最初の1回（baseline が無い）だけは書き下ろせる
            print('!! 上限を上げる更新はしません: ' + '; '.join(over))
        else:
            BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
            print(f'baseline を書き直しました: {BASELINE} ({sum(now.values())}件)')
    rec('ファイルごとの件数が上限を超えていない（増えたら落ちる）', not over,
        '; '.join(over[:20]) or f'いま {sum(now.values())}件')
    if under and not update:
        print('   注: 上限を下げられます（python3 tests/test_tscheck.py --update）: '
              + '; '.join(under[:10]) + (' …' if len(under) > 10 else ''))

    # 素通りしないこと（記憶の中の差し替えだけで注ぐ）
    tmp = []
    try:
        overrides = []
        for rel, old, new, _ in PROBES:
            src = (ROOT / rel).read_text(encoding='utf-8')
            if old not in src:
                rec(f'注ぐ場所が在る（{rel}）', False, old)
                return
            fd, p = tempfile.mkstemp(suffix='.js')
            os.close(fd)
            pathlib.Path(p).write_text(src.replace(old, new, 1), encoding='utf-8')
            tmp.append(p)
            overrides.append((rel, p))
        key = lambda d: (d['file'], d['code'], d['msg'])
        new = list((collections.Counter(map(key, run(node, overrides)['diagnostics']))
                    - collections.Counter(map(key, res['diagnostics']))).elements())
        for rel, _, _, needle in PROBES:
            # 前から在る診断に当たって通らないよう、**注いで新しく出た物**だけを見る
            hit = [m for f, _, m in new if f == rel and needle in m]
            rec(f'網そのものが素通りしない（{rel} に注いだ欠陥が新しく1件出る）', len(hit) == 1, (hit or new)[:1])
    finally:
        for p in tmp:
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass   # 消えていれば片付けは済んでいる


if __name__ == '__main__':
    main(update='--update' in sys.argv)
    print(f"\n合計: {sum(R)}/{len(R)} PASS")
    sys.exit(0 if all(R) else 1)
