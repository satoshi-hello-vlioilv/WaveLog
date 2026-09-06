#!/usr/bin/env python3
"""test_docindex.py: 知識の置き場が「規則」と「経緯」に分かれたままであること。

============================================================
なぜ要るか（§9.335、REVIEW 3-11）
------------------------------------------------------------
以前は `CLAUDE.md`（680KB・474項目）と `docs/SCHEDULE_MODE_DESIGN.md`
（1.6MB・§9が287節）の2つが**同じことを別の言葉で持って**いた。
読む側は「いま守るべき規則」を探すのに480項目の物語を読むしかない。

いまは
  ・`CLAUDE.md` … **規則の表**（守ること／固定する網／くわしく）だけ
  ・`docs/decisions/9.xxx.md` … **経緯**（なぜ・実測値・撤回した案・踏んだ罠）
  ・`docs/SCHEDULE_MODE_DESIGN.md` … スケジュール機能そのものの設計（§1〜§13）

分けたものは**放っておくとまた混ざる**。混ざり方は2通りあって、どちらも
静かに起きる——①CLAUDE.md の表へ長い経緯を書き戻す ②決定記録を足したのに
索引へ載せ忘れる（**索引を見た人ほど気づけない**。そこに無いのだから探さない）。

**旧テストはこの②を見張っていたつもりで、見張れていなかった**——
`^### (9...)` しか数えておらず、あとから足された `## §9.29x` 形式の16節を
1件も見ていなかった（索引に無いまま14番号が放置されていた）。
数え落としは**緩む側に壊れる**ので、通ったこと自体が証拠にならない。
だからここでは「ディレクトリの実体」と突き合わせる。
============================================================
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEC = ROOT / 'docs' / 'decisions'
IX = DEC / 'README.md'
CL = ROOT / 'CLAUDE.md'
DOC = ROOT / 'docs' / 'SCHEDULE_MODE_DESIGN.md'

# CLAUDE.md の上限。**規則の表だけ**なら十分に収まる（現状 81KB）。
CLAUDE_MAX = 120 * 1024

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def main():
    files = sorted(p for p in DEC.glob('*.md') if p.name != 'README.md')
    ix = IX.read_text(encoding='utf-8')
    cl = CL.read_text(encoding='utf-8')
    doc = DOC.read_text(encoding='utf-8')

    rec('決定記録が1節1ファイルで置かれている', len(files) >= 280, f'{len(files)}ファイル')

    # ---- 索引と実体の突き合わせ（両方向） ----
    linked = set(re.findall(r'\]\(([0-9A-Za-z.\-]+\.md)\)', ix))
    names = {p.name for p in files}
    rec('索引に載っていないファイルが無い（足したら載せる）',
        not (names - linked), ', '.join(sorted(names - linked)[:6]))
    rec('索引が実在しないファイルを指していない',
        not (linked - names), ', '.join(sorted(linked - names)[:6]))

    # ---- 見出しと索引の題が一致している ----
    stale = []
    for p in files:
        head = p.read_text(encoding='utf-8').split('\n', 1)[0]
        m = re.match(r'^# (?:§[0-9.]+ )?(.*)$', head)
        title = (m.group(1) if m else '').strip()
        if title and f']({p.name}) {title}' not in ix:
            stale.append(p.name)
    rec('索引の題が本文の見出しと一致している', not stale, ', '.join(stale[:6]))

    # ---- どのファイルからも戻れる ----
    noback = [p.name for p in files
              if '索引: [決定記録](README.md)' not in p.read_text(encoding='utf-8')]
    rec('どの決定記録からも索引へ戻れる', not noback, ', '.join(noback[:6]))

    # ---- 仕様/経緯の印 ----
    marks = re.findall(r'^- (仕様|経緯)｜', ix, re.M)
    rec('主題別の索引に仕様/経緯の印が付いている', len(marks) >= 250, f'{len(marks)}件')
    rec('仕様と経緯の両方が使われている',
        0 < marks.count('経緯') < len(marks), f'経緯{marks.count("経緯")} / 全{len(marks)}')

    # ---- CLAUDE.md は規則の表だけ ----
    rec('CLAUDE.md に「作業の進め方」が残っている', '## 作業の進め方' in cl)
    rec('CLAUDE.md に「画面を作るときの基準」が残っている', '## 画面を作るときの基準' in cl)
    rec('CLAUDE.md は規則の表になっている', '## 必ず守ること（不変条件の表）' in cl)
    size = CL.stat().st_size
    rec(f'CLAUDE.md が上限（{CLAUDE_MAX // 1024}KB）に収まっている',
        size <= CLAUDE_MAX, f'{size // 1024}KB')

    # 表の「くわしく」が全部たどれる
    dead = sorted({t for t in re.findall(r'\]\(docs/decisions/([0-9A-Za-z.\-]+\.md)\)', cl)
                   if t not in names and t != 'README.md'})
    rec('表の「くわしく」が全部たどれる', not dead, ', '.join(dead[:6]))
    rows = re.findall(r'^\| (?!守ること|---)(.+?) \| (.+?) \| (.+?) \|$', cl, re.M)
    rec('表の行を読めている', len(rows) >= 400, f'{len(rows)}行')
    nolink = [r[0][:28] for r in rows if '](docs/decisions/' not in r[2]]
    rec('どの規則にも「くわしく」の行き先がある', not nolink, ', '.join(nolink[:4]))
    # **経緯を表へ書き戻さない**——1行が長くなったら、それは本文が戻ってきた合図
    longs = [r[0][:30] for r in rows if len(r[0]) > 90]
    rec('表の1行に本文を書き戻していない（見出しだけ）', not longs, ', '.join(longs[:4]))

    # ---- 設計書に §9 が戻っていない ----
    back = re.findall(r'^(?:### 9(?:\.\d+)+|## §9(?:\.\d+)+) ', doc, re.M)
    rec('設計書に §9 の節が戻っていない', not back, f'{len(back)}節')
    rec('設計書が decisions を指している', 'decisions/README.md' in doc)

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print(f'  CLAUDE.md {size // 1024}KB / 決定記録 {len(files)}ファイル / 索引 {len(linked)}リンク')
    sys.exit(0 if all(R) else 1)


main()
