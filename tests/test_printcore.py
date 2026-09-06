# -*- coding: utf-8 -*-
"""test_printcore.py: 紙まわりの写しが増えていないこと（§9.332、REVIEW 3-6）。

============================================================
なぜ要るか
------------------------------------------------------------
印刷の入口は3つ（作業予定表・操業データ表・測定帳票）＋判定書で、
**紙の性格は違ってよい**。しかし

  用紙の表 ／ 刷れる範囲 ／ `@page`の中身 ／ px→mm ／
  下限つき比例配分 ／ 紙を出して `window.print()` する段取り

は同じもので、それが写しで散っていた。§9.252では
「`opsheet-print.js`も同じ形へ揃えてある。**片方だけ直さないこと**」と
書くしかなかった——**注意書きは仕組みではない。** 実際、下限つき比例配分の
丸めは片方だけ§9.295の直し（端数は広い列から0.1mmずつ散らして引く）が入って
おり、もう片方は**いちばん広い列から一度に引く**古い形のまま残っていた。

------------------------------------------------------------
数えること
------------------------------------------------------------
 1. 用紙の寸法（`w:210`のような実寸）を持つのは `print-core.js` だけ。
 2. `@page{size:` を組み立てるのは `print-core.js` だけ
    （CSSの既定は「JSが動く前の保険」なので対象外——別の層）。
 3. px→mm の換算係数（`25.4/96`）は `print-core.js` だけ。
 4. 下限つき比例配分の本体（床に着いた列を固定して配り直す形）は
    `print-core.js` だけ。
 5. `window.print()` を呼ぶのは `print-core.js` と、**理由付きの一覧**
    （`ALLOW_PRINT`）に載っているものだけ。
 6. 網そのものが素通りしないこと（写しを注いで数える）。

**コメントと文字列は落としてから数える**（§9.328の教訓）——説明文に
`@page`や`25.4/96`と書いてあるだけで落ちる網は、直す気を削ぐだけで
何も守らない。
============================================================
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'static' / 'js'
CORE = 'print-core.js'
R = []

# `window.print()` を直に呼んでよいもの。**理由を書けないものは載せない。**
ALLOW_PRINT = {
    'quality-analysis.js': '「画面を印刷」——紙の割り付けを持たず、いま出ている画面をそのまま刷る',
    'report-dashboard.js': '§9.244のiframe印刷が使えなかったときの落とし先（刷れないより刷る）',
}


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def strip_js(src, keep_strings=False):
    """コメント（と既定では文字列も）を落とす。**正規表現リテラルを見分けること**（§9.328）
    ——`/'/` を見落とすと以降が「文字列の中」になって残り全部を数えなくなる。"""
    out = []
    i, n = 0, len(src)
    prev = ''
    while i < n:
        c = src[i]
        two = src[i:i + 2]
        if two == '//':
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if two == '/*':
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
            out.append(' ')
            continue
        if c in '\'"`' and not keep_strings:
            q, j = c, i + 1
            while j < n:
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == q:
                    break
                j += 1
            i = j + 1
            out.append('""')
            prev = '"'
            continue
        if c == '/' and prev not in ')]}' and not (prev.isalnum() or prev == '_'):
            j = i + 1
            ok = False
            while j < n and src[j] != '\n':
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '/':
                    ok = True
                    break
                j += 1
            if ok:
                i = j + 1
                out.append('/re/')
                prev = '/'
                continue
        out.append(c)
        if not c.isspace():
            prev = c
        i += 1
    return ''.join(out)


def scan(pattern, keep_strings=False):
    """コメント（と既定では文字列も）を落としたうえで当たったファイル名。

    **`@page{size:` はテンプレート文字列の中にある**ので、そこだけは文字列を
    残して数える（落とすと共通核ですら1件も当たらず、写しが増えても通る）。"""
    rx = re.compile(pattern)
    hit = []
    for f in sorted(JS.glob('*.js')):
        if rx.search(strip_js(f.read_text(encoding='utf-8'), keep_strings)):
            hit.append(f.name)
    return hit


def main():
    checks = [
        ('用紙の実寸を持つのは print-core.js だけ', r'w\s*:\s*210\b', False),
        ('@page を組み立てるのは print-core.js だけ', r'@page\{size:', True),
        ('px→mm の換算係数は print-core.js だけ', r'25\.4\s*/\s*96', False),
        ('下限つき比例配分の本体は print-core.js だけ', r'fixed\[i\]', False),
    ]
    for name, pat, keep in checks:
        hit = scan(pat, keep)
        rec(name, hit == [CORE], hit)

    hit = [f for f in scan(r'window\.print\(\)') if f != CORE]
    extra = [f for f in hit if f not in ALLOW_PRINT]
    rec('window.print() は共通核と理由付きの一覧だけ', not extra, extra)
    stale = [f for f in ALLOW_PRINT if f not in hit]
    rec('一覧に腐った例外が残っていない', not stale, stale)
    for f, why in ALLOW_PRINT.items():
        rec(f'例外 {f} に理由が書いてある', len(why.strip()) >= 12)

    # 共通核が名乗っていること（読み込み順は test_loadorder が見る）
    src = (JS / CORE).read_text(encoding='utf-8')
    rec('WL.paper と WL.printCore を公開している',
        'WL.paper=' in src and 'WL.printCore=' in src)

    # ---- 網そのものが素通りしないこと ----
    probe = JS / '_print_probe.js'
    try:
        probe.write_text(
            'const K=[{key:"a4",w:210,h:297}];\n'
            'const MM=25.4/96;\n'
            'function r(k){return `@page{size:${k}mm}`}\n'
            'function s(a){const fixed=[];if(fixed[i])return a;return a}\n'
            'function p(){window.print()}\n', encoding='utf-8')
        found = {name: (probe.name in scan(pat, keep)) for name, pat, keep in checks}
        found['window.print()'] = probe.name in scan(r'window\.print\(\)')
        rec('網が写しを実際に数えている', all(found.values()), found)
    finally:
        probe.unlink(missing_ok=True)

    # コメントの中の綴りでは落ちないこと（§9.328）
    probe2 = JS / '_print_probe2.js'
    try:
        probe2.write_text('/* @page{size: と 25.4/96 と w:210 の話 */\n'
                          '// window.print() のこと\n'
                          'const a=1;\n', encoding='utf-8')
        noisy = [n for n, pat, keep in checks if probe2.name in scan(pat, keep)]
        rec('説明文に書いてあるだけでは数えない', not noisy, noisy)
    finally:
        probe2.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:      # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    ok = sum(1 for x in R if x)
    print(f'\n{ok} PASS / {len(R) - ok} FAIL')
    sys.exit(0 if all(R) else 1)
