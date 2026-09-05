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
WINDOW_LIMIT = 63

# 「新しいファイル」= この一覧に無いもの。既存はそのまま(触らない方針)。
# ここに載っているファイルは、素のグローバル関数を持っていてよい。
LEGACY_FILES = {
    'base.js', 'list-view.js', 'list-columns.js', 'list-rules.js',
    'measurement-view.js', 'measurement-input.js', 'records-store.js',
    'measurement-tolerance.js', 'lot-split.js', 'measure-progress.js',
    'defect-locator.js', 'filters.js', 'measurement-worklog.js',
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
    for path in sorted(JS.glob('*.js')):
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


def main():
    windows, globals_by_file, wrapped, wl = scan()
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
    listed = re.findall(r"'([a-z0-9-]+\.js)'", block.group(1) if block else '')
    on_disk = {p.name for p in JS.glob('*.js')}
    missing = [f for f in listed if f not in on_disk]
    unlisted = sorted(on_disk - set(listed))
    rec('読み込み一覧に無いJSファイルが転がっていない',
        not unlisted, ', '.join(unlisted))
    rec('読み込み一覧のファイルが実在する', not missing, ', '.join(missing))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print(f'  window.* {total}件 / WL.* {len(wl)}件 / JS {len(on_disk)}本')
    sys.exit(0 if all(R) else 1)


main()
