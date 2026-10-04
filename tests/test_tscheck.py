# -*- coding: utf-8 -*-
"""test_tscheck.py: 画面のJSの型と、画面↔サーバーの境界の約束を調べる（§9.566・§9.567）。

============================================================
なぜ要るか
------------------------------------------------------------
実際に起きた不具合を分類すると、**件数でいちばん多いのは JS の型・形**（17件）、次に**言語の境界**
（9件）だった（§9.563）。どちらも「書いた本人の意図と違うことが黙って起きる」形で、eslint は
型・形の10件のうち1件しか止めない（`typeof x` は no-undef の外）。

 * 型（§9.566）: 公開の型は**名乗っている式そのもの**から起こし、全ファイルを TypeScript の検査器で見る。
 * 境界（§9.567）: 約束の定義は**サーバーのコードの1か所**——道とメソッドはルート表、受け取る本文は
   `body({...})`、返す応答の鍵は `return` の字面（`tests/lib/api_contract.py` が読み出す・写しを持たない）。
   画面の `api('/api/…')` はその道の応答の型を返すので、サーバーが返さない鍵を読むと型の検査で止まる。
   呼び出しの道・メソッド・送る鍵と値の種類は、ここでルート表と本文の宣言に突き合わせる。

------------------------------------------------------------
約束
------------------------------------------------------------
 * 型の数はファイルごとに**今の件数を超えない**（`tests/fixtures/tscheck_baseline.json`）。
   減ったら上限も下げる——`python3 tests/test_tscheck.py --update`（上げる更新は断る）。
 * 境界の食い違いは**0件**（当たる道が無い・メソッドが違う・宣言に無い鍵を送る・字面の値の種類が宣言と違う）。
 * 宣言の中で解けずに any へ倒した項目は0。
 * typescript が無い環境では**落とす**（黙って通さない）。入れ方は`npm i -g typescript`。
 * 網そのものが素通りしないこと: 型の欠陥2つ・境界の欠陥3つを**記憶の中で**注ぎ、それぞれ新しく1件ずつ
   出る（本物の置き場へは書かない・§9.504。前から在る診断に当たって通らないよう、注ぐ前との差で見る）。
============================================================
"""
import collections
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests' / 'lib'))
import api_contract  # noqa: E402  （tests/lib・サーバーのコードから約束を読み出す）
from backend.routes.body import IDENTITY_KEYS  # noqa: E402  （誰が・どの端末で——どの道でも通す鍵）

TOOL = ROOT / 'tests' / 'lib' / 'js_types.js'
BASELINE = ROOT / 'tests' / 'fixtures' / 'tscheck_baseline.json'
R = []

# 網そのものを確かめる欠陥（どれも過去に実際に起きた形）。(ファイル, 前, 後, 新しく出る字)
PROBES = [
    # 型: 名前空間の項目の綴り違い（§9.355 の系統）
    ('static/js/measure/lot-split.js',
     "if(typeof WL.measureInput.toleranceDetail!=='function'",
     "if(typeof WL.measureInput.toleranceDetial!=='function'",
     'toleranceDetial'),
    # 型: 位置引数の関数をオブジェクトで呼ぶ（§9.241）
    ('static/js/schedule/schedule-view.js',
     'const frameShiftCache=WL.ttlCache(5*60*1000,12);',
     'const frameShiftCache=WL.ttlCache({ttl:5*60*1000,max:12});',
     "'{ ttl: number; max: number; }' is not assignable to parameter of type 'number'"),
    # 境界: サーバーが返さない鍵を読む（応答の鍵は `return` の字面から起こした型）
    ('static/js/master/master-data.js',
     'pathConfigState.values=r.values||{};',
     'pathConfigState.values=r.valuse||{};',
     "Property 'valuse' does not exist"),
    # 境界: 無い道を呼ぶ（以前は 404 の HTML がトーストに出た・rules-misc）
    ('static/js/core/base.js',
     "await api('/api/whoami')",
     "await api('/api/whoam')",
     '当たる道が無い'),
    # 境界: 並びと宣言した鍵へ字を送る（§9.205）
    ('static/js/master/master-data.js',
     'body:JSON.stringify({categories:[...clPicked()]})',
     "body:JSON.stringify({categories:'all'})",
     '値の種類が宣言と違う'),
]

# 字面の値の種類 → 宣言の型が受け取れるか（`body.py` の `_one()` と同じ読み方）。
ACCEPTS = {'str': {'string', 'number', 'bool'}, 'int': {'number', 'string'}, 'float': {'number', 'string'},
           'flag': {'bool', 'number', 'string'}, 'list': {'array'}, 'dict': {'object'}}


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def node_cmd():
    node = os.environ.get('WAVELOG_NODE') or shutil.which('node') or '/opt/node22/bin/node'
    return node if pathlib.Path(node).exists() or shutil.which(node) else None


def run(node, contract_path, overrides=()):
    cmd = [node, str(TOOL), '--contract', contract_path]
    for rel, src in overrides:
        cmd += ['--override', f'{rel}={src}']
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT), timeout=600)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout)[:600])
    return json.loads(r.stdout)


# ---------------------------------------------------------------- 境界の突き合わせ
def _route_rx(pattern):
    return re.compile('^' + re.escape(pattern).replace(re.escape('{*}'), '[^/]+') + '$')


def _call_rx(url):
    # 画面の `{*}` は式で決まる所——空にも（`'/api/x'+q` の q が空）、`/` を含む字にもなる
    return re.compile('^' + re.escape(url).replace(re.escape('{*}'), '.*') + '$')


def boundary(contract, calls):
    """画面の呼び出しを約束に突き合わせる → [(種類, 呼び出し, 詳しく)]。"""
    found = []
    for c in calls:
        cr = _call_rx(c['url'])
        hits = [r for r in contract
                if _route_rx(r['pattern']).match(c['url'].replace('{*}', 'X1')) or cr.match(r['pattern'].replace('{*}', 'X1'))]
        if not hits:
            found.append(('当たる道が無い', c, ''))
            continue
        ok = [r for r in hits if c['method'] == '?' or c['method'] in r['methods']]
        if not ok:
            found.append(('メソッドが違う', c, sorted({m for r in hits for m in r['methods']})))
            continue
        if c['body'] not in ('literal', 'partial'):
            continue
        specs = [r['body'] for r in ok]
        if any(not isinstance(s, dict) or not s for s in specs):
            continue   # 宣言が字面でない／本文をそのまま読む道は鍵を比べられない
        spec = {k: t for s in specs for k, t in s.items()}
        for k, kind in c['keys']:
            if k not in spec and k not in IDENTITY_KEYS:
                found.append(('宣言に無い鍵を送る', c, k))
            elif k in spec and kind != 'other' and spec[k] in ACCEPTS and kind not in ACCEPTS[spec[k]]:
                found.append(('値の種類が宣言と違う', c, f'{k}: {kind} → {spec[k]}'))
    return found


def main(update=False):
    node = node_cmd()
    rec('node が使える', bool(node))
    if not node:
        return
    contract = api_contract.contract(api_contract.load_app())
    kinds = collections.Counter(r['reply']['kind'] for r in contract)
    fd, cpath = tempfile.mkstemp(suffix='.json')
    os.close(fd)
    pathlib.Path(cpath).write_text(json.dumps(contract, ensure_ascii=False), encoding='utf-8')
    tmp = [cpath]
    try:
        try:
            res = run(node, cpath)
        except RuntimeError as e:
            rec('typescript が使える（無ければ npm i -g typescript）', False, e)
            return
        rec('typescript が使える', True, f"{res['files']}本・WL の項目 {res['wlCount']}・土台の名前 {res['globCount']}")
        rec('起こした宣言に any へ倒した項目が無い（倒れると見張りが黙る）', not res['anyNames'], res['anyNames'])
        print(f"   約束: 道 {len(contract)}本（応答の鍵が字面で読める {kinds['closed']}・一部 {kinds['open']}・"
              f"分からない {kinds['unknown']}）／型にした道 {res['apiTyped']}／画面の呼び出し {len(res['calls'])}")

        # ---- 型の件数（ファイルごとの上限）
        now = dict(sorted(collections.Counter(d['file'] for d in res['diagnostics']).items()))
        base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
        over = [f'{f} {base.get(f, 0)}→{n}' for f, n in now.items() if n > base.get(f, 0)]
        under = [f'{f} {b}→{now.get(f, 0)}' for f, b in base.items() if now.get(f, 0) < b]
        if over:
            for d in res['diagnostics']:
                if any(line.startswith(d['file'] + ' ') for line in over):
                    print(f"  {d['file']}:{d['line']} TS{d['code']} {d['msg'][:200]}")
        if update:
            if over and base:   # 最初の1回（baseline が無い）だけは書き下ろせる
                print('!! 上限を上げる更新はしません: ' + '; '.join(over))
            else:
                BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
                print(f'baseline を書き直しました: {BASELINE} ({sum(now.values())}件)')
        rec('型: ファイルごとの件数が上限を超えていない（増えたら落ちる）', not over,
            '; '.join(over[:20]) or f'いま {sum(now.values())}件')
        if under and not update:
            print('   注: 上限を下げられます（python3 tests/test_tscheck.py --update）: '
                  + '; '.join(under[:10]) + (' …' if len(under) > 10 else ''))

        # ---- 境界（0件）
        bad = boundary(contract, res['calls'])
        rec('境界: 画面の呼び出しが道・メソッド・本文の宣言と食い違っていない', not bad,
            '; '.join(f"{k} {c['file']}:{c['line']} {c['method']} {c['url']} {d}" for k, c, d in bad[:20]))

        # ---- 素通りしないこと（記憶の中の差し替えだけで注ぐ）
        overrides, by_file = [], {}
        for rel, old, new, _ in PROBES:
            src = by_file.get(rel, (ROOT / rel).read_text(encoding='utf-8'))
            if old not in src:
                rec(f'注ぐ場所が在る（{rel}）', False, old)
                return
            by_file[rel] = src.replace(old, new, 1)
        for rel, src in by_file.items():
            fd, p = tempfile.mkstemp(suffix='.js')
            os.close(fd)
            pathlib.Path(p).write_text(src, encoding='utf-8')
            tmp.append(p)
            overrides.append((rel, p))
        got = run(node, cpath, overrides)
        key = lambda d: (d['file'], d['code'], d['msg'])
        new = [f'{f}|{m}' for f, _, m in (collections.Counter(map(key, got['diagnostics']))
                                         - collections.Counter(map(key, res['diagnostics']))).elements()]
        new += [f"{c['file']}|{k}" for k, c, _ in boundary(contract, got['calls'])]
        for rel, _, _, needle in PROBES:
            hit = [x for x in new if x.startswith(rel + '|') and needle in x]
            rec(f'網そのものが素通りしない（{needle[:40]}）', len(hit) == 1, (hit or new)[:2])
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
