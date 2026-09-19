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
RULES = ROOT / '.claude' / 'rules'
RULES_IX = RULES / 'README.md'
DOC = ROOT / 'docs' / 'SCHEDULE_MODE_DESIGN.md'

# CLAUDE.md の上限（§9.414、利用者の指示「200行以下目標」「.claude/rules/ に
# よる分散管理も活用したい」）。**入口だけ**なら十分に収まる（現状 111行）。
# 行で見るのは、利用者がそう言ったからであり、かつ**読む側が一息で読めるか**は
# バイト数ではなく行数で決まるから。
CLAUDE_MAX_LINES = 200

ARCH = ROOT / 'docs' / 'ARCHITECTURE.md'
CAP = ROOT / 'tests' / 'visual' / 'capture.js'
SRC_DIRS = [ROOT / 'static' / 'js', ROOT / 'templates']

# ARCHITECTURE.md が名前で指しているが、リポジトリに無くてよいもの。
# **理由の書けるものだけ**残す（`test_dblayer` の `DEEP_ALLOW` と同じ作法）。
# 理由が「旧名」なら本文にも「旧」と書いてあること。
ARCH_ALLOW = {
    'app.css': '連結して返す束の名前（`/css/app.css`）。実体は static/css/NN-*.css',
    'boot_status.js': '起動時に端末の runtime/ へ書き出す（§9.225）',
    'instance.json': '起動中インスタンスの控え。実行時に作る',
    '_mirror.json': '共有DBの写しの台帳（§9.89）。db_mirror が実行時に作る',
    'config/local.json': '端末ごとの設定。.gitignore（雛形は local.example.json）',
    'masters.py': '3-10 で分けた旧ファイル。「から分離」の経緯として残す',
    'launch_guard.py': '旧名（いまは backend/launcher/guard.py）。「旧」と併記',
    'setup.bat': '旧名（いまは update.bat・§9.405）。「旧名」と併記',
    'count_io.py': 'scratchpad の計測道具。経緯として残す',
    'probe_scale3/4.js': 'scratchpad の計測道具。経緯として残す',
}
# capture.js の選択子のうち、値がソースに無くてよい属性（値はマスタの行）。
SEL_ALLOW_ATTR = {'data-db-key': '値はデータソースマスタのキー（フィクスチャ）'}

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


_NAME_RE = re.compile(r'`([A-Za-z0-9_./\-]+\.(?:py|js|css|html|bat|sh|json|md|mjs|txt))`')
# 押す口（click 等）の引数だけでなく、配列に並べた `'#…'`／`'[data-…'` の文字列も拾う
# ——配列で回す形を見落とすと 6 件のうち 2 件が素通りした（実測）。
_SEL_RE = re.compile(r"'((?:#|\[data-)[^']+)'")
_ID_DEF = ('id="%s"', "id='%s'", "id:'%s'", 'id:"%s"', ".id='%s'", '.id="%s"',
           "getElementById('%s')", 'getElementById("%s")')


def _exists(name):
    """名前（パスでも basename でも）がリポジトリに実在するか。"""
    if (ROOT / name).exists():
        return True
    base = name.rsplit('/', 1)[-1]
    for p in ROOT.rglob(base):
        if 'node_modules' in p.parts or '.git' in p.parts:
            continue
        return True
    return False


def missing_names(text):
    """文書が `名前` で指しているファイルのうち、実在せず、除外にも無いもの。
    先頭が `/` のものは URL（アプリが返す道）であってファイルではない。"""
    out = set()
    for name in set(_NAME_RE.findall(text)):
        if name.startswith('/') or name in ARCH_ALLOW:
            continue
        if not _exists(name):
            out.add('`' + name + '`')
    return sorted(out)


def _source_text():
    parts = []
    for d in SRC_DIRS:
        for p in sorted(d.rglob('*')):
            if p.suffix in ('.js', '.html'):
                parts.append(p.read_text(encoding='utf-8', errors='ignore'))
    return '\n'.join(parts)


def dead_selectors(js):
    """道具が押す選択子のうち、`#id` がどのソースにも無い／`data-x="値"` が
    どのソースにも無いもの。`${…}` を含む（実行時に決まる）ものは見ない。"""
    hay = _source_text()
    dead = set()
    for sel in set(_SEL_RE.findall(js)):
        if '${' in sel:
            continue
        for i in re.findall(r'#([A-Za-z0-9_-]+)', sel):
            if not any((f % i) in hay for f in _ID_DEF):
                dead.add(sel)
        for attr, val in re.findall(r'\[(data-[a-z0-9-]+)="([^"]+)"\]', sel):
            if attr in SEL_ALLOW_ATTR:
                continue
            if f'{attr}="{val}"' not in hay and f"{attr}='{val}'" not in hay:
                dead.add(sel)
    return sorted(dead)


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

    # ---- CLAUDE.md は「入口」だけ（§9.414） ----
    # 利用者の指示: 200行以下・責務は別ファイルへ分散・終わったことは書かない。
    cl_lines = cl.rstrip('\n').split('\n')
    rec('CLAUDE.md に「作業の進め方」が残っている（最優先の恒久指示）',
        '## 作業の進め方' in cl)
    rec(f'CLAUDE.md が {CLAUDE_MAX_LINES} 行以下に収まっている',
        len(cl_lines) <= CLAUDE_MAX_LINES, f'{len(cl_lines)}行')
    # **入口に表を書き戻さない**——規則の表が戻ってくると、また1枚に戻る。
    # 索引の表（`| 触る場所 | 開く1枚 |`）は2列なので、3列の規則表だけを数える。
    back = re.findall(r'^\| (?!触る場所|---)(.+?) \| (.+?) \| (.+?) \|$', cl, re.M)
    rec('CLAUDE.md へ規則の表を書き戻していない', not back, f'{len(back)}行')
    rec('CLAUDE.md が規則の置き場を指している',
        '.claude/rules/README.md' in cl and '.claude/rules/ui-principles.md' in cl)

    # ---- 規則の本体は .claude/rules/（領域別） ----
    rule_files = sorted(p for p in RULES.glob('*.md') if p.name != 'README.md')
    rix = RULES_IX.read_text(encoding='utf-8')
    rec('規則が領域別に分かれている', len(rule_files) >= 14, f'{len(rule_files)}枚')
    rlinked = set(re.findall(r'\]\(([0-9A-Za-z.\-]+\.md)\)', rix))
    rnames = {p.name for p in rule_files}
    rec('規則の索引に載っていない1枚が無い（足したら載せる）',
        not (rnames - rlinked), ', '.join(sorted(rnames - rlinked)[:6]))
    rec('規則の索引が実在しない1枚を指していない',
        not (rlinked - rnames), ', '.join(sorted(rlinked - rnames)[:6]))
    # **CLAUDE.md からも全部たどれる**（索引だけに載っていても入口から行けない）
    cl_linked = set(re.findall(r'\]\(\.claude/rules/([0-9A-Za-z.\-]+\.md)\)', cl))
    rec('入口（CLAUDE.md）からどの1枚へも行ける', not (rnames - cl_linked),
        ', '.join(sorted(rnames - cl_linked)[:6]))
    noback = [p.name for p in rule_files
              if '](README.md)' not in p.read_text(encoding='utf-8')
              or '](../../CLAUDE.md)' not in p.read_text(encoding='utf-8')]
    rec('どの1枚からも索引と入口へ戻れる', not noback, ', '.join(noback[:6]))

    # ---- 規則の表そのもの（置き場が変わっても中身の決まりは同じ） ----
    rtext = '\n'.join(p.read_text(encoding='utf-8') for p in rule_files)
    dead = sorted({t for t in re.findall(r'\]\(\.\./\.\./docs/decisions/([0-9A-Za-z.\-]+\.md)\)', rtext)
                   if t not in names and t != 'README.md'})
    rec('表の「くわしく」が全部たどれる', not dead, ', '.join(dead[:6]))
    rows = re.findall(r'^\| (?!守ること|---)(.+?) \| (.+?) \| (.+?) \|$', rtext, re.M)
    rec('表の行を読めている', len(rows) >= 400, f'{len(rows)}行')
    nolink = [r[0][:28] for r in rows if '](../../docs/decisions/' not in r[2]]
    rec('どの規則にも「くわしく」の行き先がある', not nolink, ', '.join(nolink[:4]))
    # **経緯を表へ書き戻さない**——1行が長くなったら、それは本文が戻ってきた合図
    longs = [r[0][:30] for r in rows if len(r[0]) > 90]
    rec('表の1行に本文を書き戻していない（見出しだけ）', not longs, ', '.join(longs[:4]))
    # **同じ規則を2行に持たない**（§9.414。置き場を分けると気づきにくくなる）
    seen, dup = {}, []
    for r in rows:
        k = re.sub(r'[\s`*（）()「」、。]', '', r[0])
        if k in seen:
            dup.append(r[0][:30])
        seen[k] = 1
    rec('同じ規則を2行に持っていない', not dup, ', '.join(dup[:4]))

    # ---- 3-20（§9.349）: 構成の説明と撮る道具が腐っていない ----
    # 「規則」と「経緯」は分けたが、**構成の説明（ARCHITECTURE.md）と撮る道具
    # （tests/visual/capture.js）は誰も見ていなかった**。実測: ARCHITECTURE が
    # 指す名前のうち無いもの 11、capture.js の押せない選択子 6（3段化・条の設計の
    # カード化で消えた `#openSplit`／`data-infotab`／`data-lefttab`）。押せない
    # 選択子は「撮れなかった」を「変わっていない」と読ませる——腐った道具は
    # 無いより悪い。
    miss = missing_names(ARCH.read_text(encoding='utf-8'))
    rec('構成の説明（ARCHITECTURE.md）が指す名前は実在する（旧名・実行時の物は理由つきで除外）',
        not miss, ', '.join(miss[:8]))
    gone = [k for k in ARCH_ALLOW if _exists(k)]
    if gone:
        print('   注: 除外していた名前が実在するようになっています（除外を外せます）: ' + ', '.join(gone))
    rec('網そのものが素通りしない（無い名前を1つ注ぐと見つける）',
        missing_names('`zz_not_here.py` と `backend/zz_gone.js`') == ['`backend/zz_gone.js`', '`zz_not_here.py`'])
    dead_sel = dead_selectors(CAP.read_text(encoding='utf-8'))
    rec('撮る道具（tests/visual/capture.js）の選択子は実在する（#id と data-*="値"）',
        not dead_sel, ', '.join(dead_sel[:8]))
    rec('網そのものが素通りしない（無い選択子を注ぐと見つける）',
        dead_selectors("""click('#zzNoSuchId'); click('[data-zz="nope"]'); click('#openSchedule')""")
        == ['#zzNoSuchId', '[data-zz="nope"]'])

    # ---- 設計書に §9 が戻っていない ----
    back = re.findall(r'^(?:### 9(?:\.\d+)+|## §9(?:\.\d+)+) ', doc, re.M)
    rec('設計書に §9 の節が戻っていない', not back, f'{len(back)}節')
    rec('設計書が decisions を指している', 'decisions/README.md' in doc)

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print(f'  CLAUDE.md {len(cl_lines)}行 / 規則 {len(rule_files)}枚 {len(rows)}行'
          f' / 決定記録 {len(files)}ファイル / 索引 {len(linked)}リンク')
    sys.exit(0 if all(R) else 1)


main()
