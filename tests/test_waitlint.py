#!/usr/bin/env python3
"""test_waitlint.py: 固定待ちとハーネスの写しを「増やさない」（3-15 ④・§9.347）

固定待ち（`waitForTimeout(N)`）は速い画面では無駄に待ち、遅い画面では
足りない（§9.102）。実測で **967箇所・792秒＝通し39分の34%** だった。
置き換えは1本ずつしかできないので、ここで見張るのは**増えないこと**——
`tests/fixtures/wait_baseline.json` に本ごとの件数と合計msを固定し、
**下げる方向だけ**動かせる（`test_eslint` の baseline と同じ作法）。
減ったら `python3 tests/test_waitlint.py --update` で上限を下げる。
増えた側の更新は断る。

**わざと待つものは行に `固定待ち:` と理由を書く**（`test_scsave` の4000ms＝
遅らせた応答を待つ時間そのものが検証の材料）。印のある行は数えない。

同じ形で「ハーネスの写し」（`chromium.launch(` を自分で書いている本）も
見張る。写しが多いほど、§9.342 のような横断の変更が本数ぶんの問題になる。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests'
BASELINE = TESTS / 'fixtures' / 'wait_baseline.json'
PAT = re.compile(r'waitForTimeout\(\s*(\d+)\s*\)')
# **黙って握りつぶす待ち**（§9.360）。`waitFor…(...).catch(()=>{})` は timeout を
# 無かったことにするので、失敗が「古い値のまま比べて不一致」という**別の顔**で
# 出る——何を待っていたのかが記録に残らず、原因に辿り着けない。
# 全部が悪いわけではない（「出ないことを確かめる待ち」は正しい）ので禁止せず、
# **増えないこと**だけを固定する。減らすときは `--update` で控えを下げる。
SILENT = re.compile(
    r'waitFor(?:Function|Selector)\((?:[^()]|\([^()]*\))*\)\s*\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)',
    re.S)
MARK = '固定待ち:'
# **`waitForFunction`の述語がPromiseを返していないか**（§9.376）。Playwrightは
# 述語が返したPromiseを**待たない**——Promiseそのものが真なので、条件が
# 成立していなくても**その場で抜ける**。実測（`tests/` で確かめた）では、
# 3秒後にだけ真になる述語が**82msで`false`を返して**成立した。
# つまりその判定は**何も見ていない**のに緑になる。落ちるのではなく黙って
# 素通りする形なので、上限で許さず**0件**にする。サーバーへ聞き直す待ちは
# `tests/lib/wait.js`の`poll()`（Node側で回す）で置くこと。
ASYNC_PRED = re.compile(
    r'waitForFunction\(\s*(?:async|(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(?:'
    r'fetch\(|new\s+Promise|[A-Za-z_$][\w$.]*\s*\([^()]*\)\s*\.then))')
# **テストが素の名前で製品の関数を呼んでいないか**（§9.359 の追補）。画面のJSは
# 32本ともIIFEで閉じたので、`deleteBackupRows(...)` のような素の呼び出しは
# `ReferenceError` になる。**それを`catch`が握ると、後片付けが何もしないまま
# 緑になる**——`test_devdigits` の実績の後片付けが実際にそうで、1件ずつ
# 積み上がっていた（§9.360の指紋が名指しして初めて分かった）。
# eslintは`tests/`を見ない（§9.355）ので、**面は実物から作ってここで見る**。
NS_FILES = (('measure/records-store.js', 'records'), ('core/base.js', 'base'),
            ('list/list-view.js', 'list'), ('measure/measure-input.js', 'measureInput'),
            ('measure/measure-view.js', 'measureView'))
R = []


def strip_comments(text):
    """説明文の中の`foo()`は呼び出しではない。ここで落としておく。"""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    return re.sub(r'(?m)^\s*//.*$|(?<![:\w])//[^\n]*', '', text)


def namespace_surface():
    """`WL.<領域>`にだけ載っている名前（＝素で呼ぶと落ちる名前）。

    **実物から作る**（§9.354と同じ作法）。手で並べた一覧は、面が増えた日から
    黙って穴になる。`window.X=X`で素の名前としても公開しているものは除く。"""
    names = set()
    for rel, key in NS_FILES:
        src = (ROOT / 'static' / 'js' / rel).read_text(encoding='utf-8')
        m = (re.search(r'window\.WL\.' + key + r'\s*=\s*\{(.*?)\n\};', src, re.S)
             or re.search(r'WL\.' + key + r'\s*=\s*\{(.*?)\n\}', src, re.S))
        if not m:
            return None, rel
        names |= set(re.findall(r'(?<![\w$.])([A-Za-z_$][\w$]*)(?=\s*[,:}\n])', m.group(1)))
    published = set()
    for f in (ROOT / 'static' / 'js').rglob('*.js'):
        published |= set(re.findall(r'window\.([A-Za-z_$][\w$]*)\s*=', f.read_text(encoding='utf-8')))
    # 短い名前は同名の局所変数と見分けが付かないので見ない（`get`・`api`等）。
    return {n for n in names - published if len(n) >= 4}, ''


def bare_calls(path, surface):
    """その本の中の「素の名前での呼び出し」。自分で宣言した同名は除く。"""
    code = strip_comments(path.read_text(encoding='utf-8'))
    local = set(re.findall(r'(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)', code))
    for grp in re.findall(r'\{([^{}\n]*)\}\s*=\s*require', code):
        local |= {x.strip() for x in grp.split(',') if x.strip()}
    out = []
    for n in surface - local:
        for m in re.finditer(r'(?<![\w$.])' + re.escape(n) + r'\s*\(', code):
            out.append((code[:m.start()].count('\n') + 1, n))
    return sorted(out)


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def scan(path):
    """(件数, 合計ms, 印なしの行番号)。印のある行は数えない。"""
    n = ms = 0
    lines = []
    for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        if MARK in line:
            continue
        for m in PAT.finditer(line):
            n += 1
            ms += int(m.group(1))
            lines.append(i)
    return n, ms, lines


def measure(files):
    now = {}
    for p in files:
        n, ms, _ = scan(p)
        text = p.read_text(encoding='utf-8')
        harness = 1 if 'chromium.launch(' in text else 0
        silent = len(SILENT.findall(text))
        if n or harness or silent:
            now[p.name] = {'count': n, 'ms': ms, 'harness': harness, 'silent': silent}
    return now


def main(update=False):
    files = sorted(TESTS.glob('test_*.js'))
    rec('見る本がある', len(files) >= 100, f'{len(files)}本')
    now = measure(files)
    base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    over, under = [], []
    for name, d in now.items():
        b = base.get(name, {})
        for k in ('count', 'ms', 'harness', 'silent'):
            if d[k] > b.get(k, 0):
                over.append(f'{name} {k} {b.get(k, 0)}→{d[k]}')
            elif d[k] < b.get(k, 0):
                under.append(f'{name} {k} {b.get(k, 0)}→{d[k]}')
    for name, b in base.items():
        if name not in now and any(b.get(k, 0) for k in ('count', 'ms', 'harness', 'silent')):
            under.append(f'{name} →0')
    if update:
        if over and base:
            print('!! 上限を上げる更新はしません: ' + '; '.join(over[:10]))
        else:
            BASELINE.parent.mkdir(exist_ok=True)
            BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                encoding='utf-8')
            print(f'baseline を書き直しました: {BASELINE} ({len(now)} files)')
    tot_n = sum(d['count'] for d in now.values())
    tot_ms = sum(d['ms'] for d in now.values())
    tot_h = sum(d['harness'] for d in now.values())
    rec('固定待ちとハーネスの写しが本ごとの上限を超えていない（増えたら落ちる）',
        not over, '; '.join(over[:12]) or
        f'いま 固定待ち {tot_n}箇所 {tot_ms/1000:.0f}秒 ／ ハーネスの写し {tot_h}本')
    # **3-15 の終点を0と1で固める**（§9.451）。上限（下げる方向だけ）は置き換えの途中の
    # 見張りで、置き換え終わったら「増えなければよい」では足りない——1本足せば
    # その1本ぶん上限を上げずに済む形（新しい本は baseline に載っていない）を断つ。
    unmarked = [f'{n} {d["count"]}箇所' for n, d in now.items() if d['count']]
    rec('理由の無い固定待ちは0（残すなら行に「固定待ち:」と理由を書く・§9.451）',
        not unmarked, '; '.join(unmarked[:8]) or '0箇所')
    selfs = [n for n, d in now.items() if d['harness']]
    root = (TESTS / 'lib' / 'harness.js').read_text(encoding='utf-8')
    rec('ブラウザを起動するのは土台（tests/lib/harness.js）の1箇所だけ（本は run() を使う）',
        not selfs and 'chromium.launch(' in root, '; '.join(selfs[:8]) or 'テストの本 0本')
    if under:
        print('   注: 上限を下げられます（python3 tests/test_waitlint.py --update）: '
              + '; '.join(under[:8]) + (' …' if len(under) > 8 else ''))
    rec('baseline がある（無いと「増えた」を言えない）', BASELINE.exists(), str(BASELINE.relative_to(ROOT)))
    # **調べるための一時的な細工を網へ残さない**（§9.432 ⑤。実際に残した）。
    # 画面を撮る細工そのものは在ってよい（`test_defect.js` は見た目の確認に使う）。
    # ただし**指定が無い環境では1行も動かないこと**——`WAVELOG_SHOT` が未設定のまま
    # `path: undefined + '/x.png'` へ書こうとして落ちる。コミットまで残ると、
    # 撮る指定をしない通常の実行とCIが落ちる（実際にそうなった）。
    # 見るのは2つ: ①`/*PROBE*/` の印が残っていない ②撮る本には必ず
    # `if (process.env.WAVELOG_SHOT)` の囲いがある。
    leftovers = []
    for p in files:
        txt = p.read_text(encoding='utf-8')
        if '/*PROBE*/' in txt:
            leftovers.append(f'{p.name} 調べ用の印が残っている')
        if 'WAVELOG_SHOT' in txt and not re.search(r'if\s*\(\s*process\.env\.WAVELOG_SHOT', txt):
            leftovers.append(f'{p.name} 撮る細工に囲いが無い')
    rec('調べるための細工は指定があるときだけ動く（印も残さない）',
        not leftovers, '; '.join(leftovers[:6]))
    # 印のある行は数えない——印の書き方が変わると黙って全部が数から外れる。
    # 印のある行が実在し、かつその本の数に入っていないことを見る。
    marked = [(p.name, i) for p in files
              for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1)
              if MARK in line and PAT.search(line)]
    rec('「固定待ち:」と理由を書いた行だけが数から外れる', len(marked) >= 1,
        '; '.join(f'{n}:{i}' for n, i in marked[:5]))
    # 素通りしないこと: 固定待ちを1つ注いで数えられるか
    probe = TESTS / 'test__waitprobe.js'
    try:
        probe.write_text("await page.waitForTimeout(1234);\nawait page.waitForTimeout(5); // 固定待ち: 印の例\n",
                         encoding='utf-8')
        n, ms, _ = scan(probe)
        rec('網そのものが素通りしない（注いだ固定待ちを数え、印の行は数えない）',
            (n, ms) == (1, 1234), f'{n}件 {ms}ms')
    finally:
        try:
            probe.unlink()
        except FileNotFoundError:
            pass
    # `waitForFunction`の述語がPromiseを返していないか（§9.376）。**0件**——
    # 上限で許すと、素通りする判定がそのぶん残ることになる。
    bad_async = [(p.name, code[:m.start()].count('\n') + 1)
                 for p in files
                 for code in [strip_comments(p.read_text(encoding='utf-8'))]
                 for m in ASYNC_PRED.finditer(code)]
    rec('`waitForFunction`の述語がPromiseを返していない（返すと即座に抜ける・§9.376）',
        not bad_async,
        '; '.join(f'{n}:{i}' for n, i in bad_async[:8]) or '0件')
    # 素通りしないこと: わざと1つ書いて数えられるか。
    probe2 = TESTS / 'test__asyncprobe.js'
    try:
        probe2.write_text(
            "await page.waitForFunction(()=>fetch('/x').then(r=>r.ok),null,{timeout:1});\n"
            "await page.waitForFunction(()=>document.body.children.length>0);\n",
            encoding='utf-8')
        found = ASYNC_PRED.findall(strip_comments(probe2.read_text(encoding='utf-8')))
        rec('網そのものが素通りしない（Promiseを返す述語を1つ注いで数える）',
            len(found) == 1, f'{len(found)}件')
    finally:
        try:
            probe2.unlink()
        except FileNotFoundError:
            pass
    # 素の名前での製品の呼び出しは**0件**（増分ではなく0。落ちるのではなく
    # 黙って何もしなくなる形なので、上限で許すと意味が無い）。
    surface, bad = namespace_surface()
    rec('名前空間の面を実物から数えられる', surface is not None and len(surface) >= 50,
        f'{len(surface)}個' if surface else f'{bad} の面が読めない')
    if surface:
        bare = {p.name: bare_calls(p, surface) for p in files}
        bare = {k: v for k, v in bare.items() if v}
        rec('テストが素の名前で画面の関数を呼んでいない（§9.359。呼ぶと ReferenceError）',
            not bare, '; '.join(f'{k}:{v[0][0]} {v[0][1]}' for k, v in list(bare.items())[:6]) or '0件')
        # 素通りしないこと: 素の呼び出しを1つ注いで見つけられるか。
        one = sorted(surface)[0]
        probe2 = TESTS / 'test__bareprobe.js'
        try:
            probe2.write_text(f'/* {one}() は説明文なので数えない */\nawait {one}([1]);\n',
                              encoding='utf-8')
            found = bare_calls(probe2, surface)
            rec('網そのものが素通りしない（注いだ素の呼び出しを1件だけ数える）',
                [n for _, n in found] == [one], f'{found}')
        finally:
            try:
                probe2.unlink()
            except FileNotFoundError:
                pass
    top = sorted(((k, v) for k, v in now.items() if v['count']), key=lambda kv: -kv[1]['ms'])[:8]
    if top:
        print('  残っている上位: ' + ', '.join(f"{k} {v['ms']/1000:.1f}s/{v['count']}件" for k, v in top))
    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


if __name__ == '__main__':
    main(update='--update' in sys.argv)
