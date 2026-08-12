#!/usr/bin/env python3
"""test_docindex.py: 設計書の主題別索引が本文とずれない（フェーズE）。

============================================================
なぜ要るか
------------------------------------------------------------
`docs/SCHEDULE_MODE_DESIGN.md` は4,400行・§9だけで79節あり、**本文の並びは
番号順ですらない**(実装の順に積み上がったため)。読む側は目当ての節を
探せないので、先頭に主題別の索引を置いた。

索引は**手で書いた対応表**なので、節を足したときに載せ忘れる。載せ忘れた
節は「無い」のと同じで、しかも**索引を見た人ほど気づけない**(そこに
無いのだから探さない)。節を足したら落ちるようにしておく。

§番号は振り直せない——コードとテストから§番号で参照されているため。
だから索引は「並べ替えの代わり」であって、番号の付け替えではない。
============================================================
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / 'docs' / 'SCHEDULE_MODE_DESIGN.md'

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def main():
    text = DOC.read_text(encoding='utf-8')
    head, _, body = text.partition('## 1. 目的と範囲')
    rec('索引が本文より前にある', bool(body) and '## 0. 主題別索引' in head)

    sections = {m.group(1): m.group(2).strip()
                for m in re.finditer(r'^### (9(?:\.\d+)+) (.+)$', body, re.M)}
    listed = {m.group(2): m.group(3).strip()
              for m in re.finditer(r'^- (仕様|経緯)｜§(9(?:\.\d+)+) (.+)$', head, re.M)}
    marks = re.findall(r'^- (仕様|経緯)｜§', head, re.M)

    rec('本文の§9を読めている', len(sections) >= 70, f'{len(sections)}節')
    missing = sorted(set(sections) - set(listed), key=lambda s: [int(x) for x in s.split('.')])
    rec('索引に載っていない節が無い（足したら載せる）', not missing, ', '.join('§' + x for x in missing))
    ghost = sorted(set(listed) - set(sections))
    rec('本文に無い節を索引が指していない', not ghost, ', '.join('§' + x for x in ghost))

    # 見出しを書き換えたのに索引が古いまま、を防ぐ
    stale = [f'§{n}: 索引「{listed[n]}」 / 本文「{sections[n]}」'
             for n in sorted(set(sections) & set(listed)) if listed[n] != sections[n]]
    rec('索引の見出しが本文と一致している', not stale, ' | '.join(stale[:3]))

    rec('どの節にも仕様/経緯の印が付いている', len(marks) == len(listed), f'{len(marks)} / {len(listed)}')
    # 印が片方へ寄っていたら、分類していないのと同じ
    keireki = marks.count('経緯')
    rec('仕様と経緯の両方が使われている', 0 < keireki < len(marks), f'経緯{keireki} / 全{len(marks)}')

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


main()
