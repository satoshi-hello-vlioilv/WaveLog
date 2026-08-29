# -*- coding: utf-8 -*-
"""test_hintlint.py: 説明文に生のHTMLタグを書かない（§9.276 ④、利用者の報告）。

利用者の報告:

  「アクセス権限マスタの説明文(モーダルも含む)が<b>タグが見えていて正しく
   エンコードされていないので構文エラーになっていないか確認してください」

**構文エラーではない。** `hintHtml()`は**エスケープしてから**`**強調**`だけを
`<b>`へ変える（§9.222 ⑧）——マスタへ入れた文字列の中のHTMLがそのまま効かない
ようにするための順番なので、この順番は変えられない。だから説明文へ生の`<b>`を
書くと、**画面に`<b>`という字がそのまま出る**。

書き間違いは**目で数えない**（§CLAUDE「見張りは機械で数える」）。
`hint:` / `hintShort:` / `more:` / `note:` の文字列リテラルに`<...>`が
入っていないかを、ソースを読んで数える。

**なぜ画面の網では足りないか**——説明はマスタごと・欄ごとに散っており、
全部を開いて回る網は遅いうえ、**開き忘れた1つは永久に見られない**。
ここは字を見るだけなので1秒で終わり、しかも新しいマスタを足した瞬間から
対象になる。
"""
import io
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ['static/js/master-maint.js']
# 説明として画面に出る（＝`hintHtml()`か`esc()`を通る）キー。
KEYS = ('hint', 'hintShort', 'more')
TAG = re.compile(r'</?[a-zA-Z][a-zA-Z0-9]*\s*/?>')

R = []


def rec(name, ok, detail=''):
    R.append((name, ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


def hint_lines(lines):
    """`hint:'…'` とその継続行（`+'…'`）を拾う。→ [(行番号, 本文)]

    **継続行まで見ること**——`more:`は3行に割って書いてあり、生のタグは
    2行目・3行目に居た（1行目だけ見る網は素通りする）。
    """
    out, inside = [], False
    for i, line in enumerate(lines, 1):
        st = line.strip()
        starts = any(re.search(r'\b%s\s*:\s*[\'"]' % k, line) for k in KEYS)
        # **続きは「次の行が`+'`で始まるか」で見る**——書き手は1行目を`'`で
        # 閉じてから次の行を`+'…'`で足すので、「行末が`+`」では拾えない。
        cont = inside and (st.startswith("+'") or st.startswith('+"'))
        if starts or cont:
            out.append((i, line))
            inside = True
        else:
            inside = False
    return out


bad = []
scanned = 0
for rel in TARGETS:
    p = ROOT / rel
    for ln, line in hint_lines(io.open(p, encoding='utf-8')):
        scanned += 1
        for m in TAG.finditer(line):
            bad.append('%s:%d %s' % (rel, ln, m.group(0)))

rec('前提: 説明文の行を実際に拾えている', scanned > 40, '%d行' % scanned)
rec('① 説明文に生のHTMLタグを書いていない（画面に字のまま出る）',
    not bad, ' / '.join(bad[:6]))

# ---- ② 網が素通りしないこと -------------------------------------------
probe = ["   hint:'これは<b>強調</b>です。',\n"]
found = [m.group(0) for line in probe for m in TAG.finditer(line)]
rec('② 生のタグを入れれば捕まえる', found == ['<b>', '</b>'], found)
ok_line = ["   hint:'これは**強調**です。（1 < 2 の比較は素通しでよい）',\n"]
rec('② `**強調**`と不等号は捕まえない（誤検出しない）',
    not [m.group(0) for line in ok_line for m in TAG.finditer(line)])

# ---- ③ 継続行まで見ていること -----------------------------------------
# **1行目だけを見る網は素通りする**（`more:`は3行に割って書いてある）。
# 実物の書き方をそのまま食わせて確かめる。
sample = ["   {k:'x',label:'y',\n",
          "    more:'1行目。'\n",
          "         +'2行目に<b>タグ</b>を書いた。'\n",
          "         +'3行目。'},\n",
          "   {k:'z'},\n"]
got = hint_lines(sample)
hits = [m.group(0) for _ln, t in got for m in TAG.finditer(t)]
rec('③ 継続行（`+\'…\'`）まで読んでいる', len(got) == 3 and hits == ['<b>', '</b>'],
    '拾った行=%d / 見つけたタグ=%s' % (len(got), hits))
# **続きでない行まで拾わないこと**（拾うと、説明でない行のタグで落ちる）。
rec('③ 続きでない行は拾わない', all(ln <= 4 for ln, _t in got), [ln for ln, _t in got])

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print('%d/%d passed' % (len(R) - len(ng), len(R)))
for n, _o in ng:
    print(' -', n)
sys.exit(1 if ng else 0)
