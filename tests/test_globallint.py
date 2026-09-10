#!/usr/bin/env python3
"""test_globallint.py: ファイル間の「契約面」を増やさない（フェーズB）。

============================================================
なぜ要るか
------------------------------------------------------------
このアプリの画面側は19本のJSを順に読み込む1つの名前空間で動いている。
`window.X = …` や素のグローバル関数が増えるほど、

  ・どのファイルがどのファイルに依存しているのかが**呼び出し箇所から
    読み取れない**（素の名前で呼ぶため）
  ・読み込み順への依存が見えなくなる（後から読まれた側が勝つ）
  ・公開し忘れが**例外にならず、機能だけ静かに欠ける**
    （`typeof makeFloatingWindow==='function'` のように「あれば使う」と
     書いてある箇所が実際にあり、列の設定パネルが画面外に開いた）

CLAUDE.mdは既に方針を決めている——「既存は動いている契約なので触らない。
**新しく公開するものは`WL.*`か機能別の名前空間へ**」。
このテストはその方針が守られているかを見る**だけ**で、既存の移設は求めない
（動いているものを動かす費用に対して得るものが薄い、というのが第1次からの
判断）。上限を現在値で固定し、**増えたら落ちる**。

判定の考え方
------------------------------------------------------------
・`window.X=` の数を数える（上限）
・**`WL.*`は数えない**。そちらは増えてよい（増えるほど良い）ので、
  上限をかけると方針と逆向きの圧力になる。
・素のグローバル関数は総数が多すぎて上限が意味を持たないため、
  **新規ファイルだけ**を見る（新しく足すファイルは最初から名前空間で書く）。
============================================================
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'static' / 'js'

# 現在値。**増やさないこと。** 減らしたらこの数も下げる。
# §9.359（REVIEW 3-17）で 63 → 79 へ上げた。**増えたぶんは意図した公開**
# ——`base.js` を閉じたとき、外から使う土台18個（`$`・`esc`・`S`・`api`・
# `showToast`…）を `window.X=X` で明示的に公開したもの。名前空間へ移すと
# 2,000箇所以上が読みにくくなるだけで、衝突は起きようがない（この1本しか
# 名乗っていない）。**引き換えに、base.js の131個のうち約80個が外から
# 見えなくなった**——素のグローバルは 353→約110 へ減っている。
# ここを上げるのは「閉じた結果として公開を宣言した」ときだけにすること。
# §9.368 で 79 → 78 へ下げた。`window.scScheduledLotSet` を
# `WL.scheduleView.hiddenLotSet()` へ移したぶん（**減ったら上限も下げる**）。
WINDOW_LIMIT = 78

# 「新しいファイル」= この一覧に無いもの。既存はそのまま(触らない方針)。
# ここに載っているファイルは、素のグローバル関数を持っていてよい。
LEGACY_FILES = {
    'base.js', 'list-view.js', 'list-columns.js', 'list-rules.js',
    'measure-view.js', 'measure-input.js', 'records-store.js',
    'measure-tolerance.js', 'lot-split.js', 'measure-progress.js',
    'defect-locator.js', 'filters.js', 'measure-worklog.js',
    'master-maint.js', 'quality-analysis.js', 'report-dashboard.js',
    'calendar-view.js', 'schedule-view.js', 'access-mode.js',
}

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def scan():
    """`window.*` の公開・**本当のグローバル関数**・`WL.*` を数える。

    グローバル関数の数え方を2026-08-12に直した。以前は
    `^\\s*function NAME(` で数えており、**字下げを見ているだけ**だった——
    即時関数で包んだファイルの中の入れ子関数まで「グローバル」と数えるので、
    schedule-view.js は161個と出るのに実際のグローバルは**0個**。
    行頭(桁0)の宣言だけがグローバルになるので、そちらを数える。
    """
    windows, globals_by_file, wrapped, wl = {}, {}, {}, set()
    for path in sorted(JS.rglob('*.js')):
        text = path.read_text(encoding='utf-8')
        # `window.WL=window.WL||{}` は名前空間そのものの用意なので数えない
        # (各ファイルが書くため、数えると「名前空間を使うほど増える」ことになる)。
        w = [x for x in re.findall(r'\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)', text) if x != 'WL']
        if w:
            windows[path.name] = sorted(set(w))
        g = re.findall(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', text, re.M)
        if g:
            globals_by_file[path.name] = sorted(set(g))
        # 即時関数で丸ごと包んでいるか。包んであれば中の宣言はグローバルに
        # ならないので、**字下げされた宣言まで断る必要が無い**。
        wrapped[path.name] = '(function(' in text and text.rstrip().endswith(');')
        wl |= set(re.findall(r'\bWL\.([A-Za-z_$][\w$]*)\s*=(?!=)', text))
    return windows, globals_by_file, wrapped, wl


S_KEY = re.compile(r'\bS\.([A-Za-z_$][A-Za-z0-9_$]*)')  # 鍵はASCIIだけ（コメントの日本語を鍵に数えない）


def s_keys():
    """グローバル状態 `S`（base.js）の**宣言された鍵**と、画面・網が触っている鍵。

    §9.327（REVIEW 3-8）: `S` の鍵は base.js の1つのリテラルだけが持ち、
    `Object.seal(S)` で**後付けできない**。以前は `filters.js` が
    `S.filterPresets` 等3つ、`list-view.js` が `S.selectedRow`／`S.t`／
    `S.joinQuality`、`records-store.js` が `S.measureContextError` を後付けして
    おり（宣言11・使用19）、**綴りを間違えても静かに新しい鍵ができる**状態だった。
    宣言は「`S={` から `}` まで」を読み、`key:` の形の鍵を集める。
    """
    base = (JS / 'core' / 'base.js').read_text(encoding='utf-8')
    m = re.search(r'\bS\s*=\s*\{(.*?)\}\s*;', base, re.S)
    body = m.group(1) if m else ''
    declared = set(re.findall(r'(?:^|[{,])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:', body, re.M))
    used = {}
    for path in sorted(list(JS.rglob('*.js')) + list((ROOT / 'tests').glob('*.js'))):
        text = path.read_text(encoding='utf-8')
        if path.name == 'report-dashboard.js':
            # `const S=M0.sheet` という**別の局所変数**が1つある（紙の1枚ぶん）。
            # その関数の中だけ読み飛ばす。
            text = re.sub(r'const S=M0\.sheet.*?\n\s*\}', '', text, flags=re.S)
        for k in set(S_KEY.findall(text)):
            used.setdefault(k, []).append(path.name)
    sealed = bool(re.search(r'Object\.seal\(S\)', base))
    return declared, used, sealed


def main():
    windows, globals_by_file, wrapped, wl = scan()
    declared, used, sealed = s_keys()
    undeclared = {k: v for k, v in used.items() if k not in declared}
    rec('`S` の鍵は base.js の宣言に全部載っている（後付け0件）', declared and not undeclared,
        ', '.join(f'{k}({"/".join(v)})' for k, v in sorted(undeclared.items()))
        or f'宣言{len(declared)}・使用{len(used)}')
    unused = sorted(k for k in declared if k not in used)
    rec('宣言だけで誰も触らない鍵が無い', not unused, ', '.join(unused))
    rec('`S` は Object.seal で後付けを断っている', sealed)
    dyn = [p.name for p in list(JS.rglob('*.js')) + list((ROOT / 'tests').glob('*.js'))
           if re.search(r'\bS\[', p.read_text(encoding='utf-8'))]
    rec('`S[...]` の動的な鍵で宣言をすり抜けていない', not dyn, ', '.join(dyn))
    total = sum(len(v) for v in windows.values())
    rec('画面側のJSを読めている', len(wrapped) >= 15, f'{len(wrapped)}ファイル')

    rec(f'`window.*` への公開が増えていない（上限 {WINDOW_LIMIT}）',
        total <= WINDOW_LIMIT, f'{total}件')
    if total > WINDOW_LIMIT:
        for f, names in windows.items():
            print(f'      {f}: {", ".join(names)}')

    # 減ったら上限も下げる(緩んだままにしない)
    rec('上限が実態から離れていない（減ったら上限も下げる）',
        total >= WINDOW_LIMIT - 3, f'{total} / 上限 {WINDOW_LIMIT}')

    # WL.* は「増えてよい側」。存在と、契約として使われていることだけ見る。
    rec('`WL.*` の名前空間が使われている', len(wl) >= 20, f'{len(wl)}件')

    # 新しく足したファイルは、素のグローバル関数を作らない
    newcomers = {f: g for f, g in globals_by_file.items() if f not in LEGACY_FILES}
    rec('新しいJSファイルは素のグローバル関数を作っていない',
        not newcomers,
        '; '.join(f'{f}: {", ".join(g[:4])}' for f, g in newcomers.items()))

    # …そのうえで、**丸ごと即時関数で包む**ことも要求する。行頭の宣言だけを
    # 見る数え方は「字下げした行頭宣言」を見逃すが(字下げしてもグローバルに
    # なる)、包んであればそもそもグローバルにならないので両方で塞ぐ。
    naked = sorted(f for f, ok in wrapped.items() if not ok and f not in LEGACY_FILES)
    rec('新しいJSファイルは即時関数で包んでいる', not naked, ', '.join(naked))

    # 読み込み一覧と実ファイルが食い違っていないか。
    # 足したのに読み込まれない/消したのに残っている、はどちらも静かに壊れる。
    # §9.324 R3: 一覧は backend/routes/core.py の JS_FILES（index.html は描くだけ）。
    core_py = (ROOT / 'backend' / 'routes' / 'core.py').read_text(encoding='utf-8')
    block = re.search(r'JS_FILES=\[(.*?)\n\]', core_py, re.S)
    # 領域フォルダ（§9.334）なので `<領域>/<名前>.js` で突き合わせる。
    listed = re.findall(r"'([a-z0-9-]+/[a-z0-9-]+\.js)'", block.group(1) if block else '')
    on_disk = {p.relative_to(JS).as_posix() for p in JS.rglob('*.js')}
    missing = [f for f in listed if f not in on_disk]
    unlisted = sorted(on_disk - set(listed))
    rec('読み込み一覧に無いJSファイルが転がっていない',
        not unlisted, ', '.join(unlisted))
    rec('読み込み一覧のファイルが実在する', not missing, ', '.join(missing))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print(f'  window.* {total}件 / WL.* {len(wl)}件 / JS {len(on_disk)}本')
    sys.exit(0 if all(R) else 1)


main()
