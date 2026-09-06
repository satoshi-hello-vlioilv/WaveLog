#!/usr/bin/env python3
"""test_patchlint.py: 「元の実装を退避しない全置換」を機械的に見つける（フェーズA）。

============================================================
なぜ要るか
------------------------------------------------------------
拡張ファイルが `既存の関数名 = function(){...}` と書くと、**元の定義を
grepで辿っても最終的な実装に行き着かない**。読む側は`index.html`の
読み込み順を知っていないと、どれが動いているのか分からない。

実際の事故:
  ・`load()` … `filters.js`が丸ごと差し替えており、「list-view.js側だけ
    直して効いていない」が**3回**(品質データ結合・キャッシュ・読み込み
    時間の計測)。§9.93でフックへ置き換え済み。
  ・`compactToleranceScale` … **3ファイルが同じ関数を定義**していた。
    読み込み順は measure-input(定義) → measure-tolerance(置換) →
    filters(置換) → measure-worklog(ラップ)。つまり真ん中の
    measure-tolerance版は**一度も実行されない死んだコード**で、
    そこを直しても何も変わらない。§9.150で図を作り直したとき、
    filters.js の置換を外して measure-input.js の定義を live に戻した
    ——**一覧の絞り込みのファイルが測定画面の図を持っていたこと自体が誤り**。

CLAUDE.mdは既に「拡張ファイルからはラップのみ可、全置換は不可」と
定めている。**規約はあったが機械的な歯止めが無かった**ので、ここで見る。

何を「ラップ」と認めるか
------------------------------------------------------------
代入の直前(数行以内)で元の実装を変数へ退避していること。

    const base=fn;  fn=function(){ ... base() ... }      ← ラップ(可)
    fn=function(){ ... }                                  ← 全置換(不可)

残っている全置換は ALLOWED に理由付きで載せる。**数を増やさないこと**が
このテストの目的なので、載せるときは理由も書く。
============================================================
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
JS = ROOT / 'static' / 'js'

# 残っている全置換。**増やさないこと。** 減らしたらここからも消す。
ALLOWED = {
    ('lot-split.js', 'compactToleranceData'):
        '分割ロットでは条ごとに公差が変わるため、index の既定値ごと差し替える。',
    ('measure-worklog.js', 'updateWorkTimePanel'):
        '作業時間パネルを worklog 側の同期処理へ置き換える。',
}

# 代入の何行前までを「退避」とみなすか
LOOKBACK = 6

ASSIGN = re.compile(r'^\s*(?:window\.)?([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b')

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def declared_functions():
    """`function 名(` で宣言されている関数名（＝置き換えられうる相手）。"""
    names = set()
    for path in JS.rglob('*.js'):
        for m in re.finditer(r'^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(',
                             path.read_text(encoding='utf-8'), re.M):
            names.add(m.group(1))
    return names


def scan():
    """(ファイル名, 関数名, 行番号, ラップか) を返す。"""
    known = declared_functions()
    out = []
    for path in sorted(JS.rglob('*.js')):
        lines = path.read_text(encoding='utf-8').split('\n')
        for i, line in enumerate(lines):
            m = ASSIGN.match(line)
            if not m:
                continue
            fn = m.group(1)
            if fn not in known:
                continue                      # 新しい名前を作っているだけ
            back = '\n'.join(lines[max(0, i - LOOKBACK):i])
            saved = re.search(r'\b(?:const|let|var)\s+\w+\s*=\s*(?:typeof\s+)?'
                              + re.escape(fn) + r'\b', back)
            out.append((path.name, fn, i + 1, bool(saved)))
    return out


DURATION_RE = re.compile(r'(?:function\s+\w+\s*\([^)]*\)|=>)[^\n]{0,200}?'
                         r'(?:\$\{[^}]*\}時間|\'時間\'|`\$\{h\}:)')


def duration_formatters():
    """所要時間を自前で書いている場所（§9.341）。

    「150分」か「2時間30分」か「2:30」かを答えるのは`WL.duration`の1箇所。
    以前は同じことをする関数が**6つ・表記4種類**あり（fmtMin 2箇所・
    fmtMinutes・fmtCompact・fmtHour・measure-worklog の fmtMin）、
    稼働状況は`150分`、作業スケジュールは`2時間30分`、その実績列だけ
    `2:30`と、**同じ数字が画面をまたぐと別の顔**になっていた。

    ここは「分と時間を組み立てる式」を探す。`WL.duration`の実装
    （base.js）と、1日を超える相対時刻（`fmtRelative`。「後」は所要時間
    ではなく到達点なので別の軸）だけが例外。
    """
    allow = {
        # 書き方そのものを持つ1箇所。
        ('base.js', 'durationText'): '`WL.duration`の実装',
        # 「いつ始まるか」は所要時間ではなく到達点。1日を超えるぶんだけ持つ。
        ('schedule-view.js', 'fmtRelative'): '相対時刻（〜後）は別の軸',
        # 「30分ごと」と「30分かかる」は別のことを言っている。
        ('master-data.js', 'clEvery'): '間隔（〜ごと）は所要時間ではない',
    }
    out = []
    for path in sorted(JS.rglob('*.js')):
        lines = path.read_text(encoding='utf-8').split('\n')
        name = ''
        for i, line in enumerate(lines):
            m = re.match(r'\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', line)
            if m:
                name = m.group(1)
            if line.lstrip().startswith(('*', '//', '/*')):
                continue
            # 所要時間の書き方は「時と分の両方」を組み立てる。片方だけの
            # 「過去8時間」「30分前」は窓の設定や時点であって、ここではない。
            if '分' not in line:
                continue
            if not re.search(r'\$\{[^}]*\}\s*時間', line):
                continue
            # 「〜前」「〜後」「〜ごと」は時点・間隔であって所要時間ではない。
            if re.search(r'時間[^`\'"]{0,12}?(前|後|ごと|以内|以降)', line):
                continue
            if (path.name, name) in allow:
                continue
            out.append(f'{path.name}:{i + 1} {name or "(無名)"}')
    return out


def main():
    found = scan()
    rec('拡張ファイルの関数差し替えを機械的に拾えている', len(found) >= 10, f'{len(found)}件')

    replaced = [(f, fn, ln) for f, fn, ln, wrapped in found if not wrapped]
    wrapped = [x for x in found if x[3]]
    rec('ラップ形式（元の実装を退避して呼ぶ）が大半を占める',
        len(wrapped) > len(replaced), f'ラップ {len(wrapped)}件 / 全置換 {len(replaced)}件')

    unknown = [(f, fn, ln) for f, fn, ln in replaced if (f, fn) not in ALLOWED]
    rec('**新しい全置換が増えていない**（増やすなら ALLOWED へ理由を書く）',
        not unknown, '; '.join(f'{f}:{ln} {fn}' for f, fn, ln in unknown))

    stale = [k for k in ALLOWED if k not in {(f, fn) for f, fn, _ in replaced}]
    rec('ALLOWED に、もう存在しない項目が残っていない（直したら消す）',
        not stale, '; '.join(f'{f}:{fn}' for f, fn in stale))

    # 同じ関数を2つ以上のファイルが**退避せずに**定義していないか。
    # 後から読まれた側が勝つので、前のものは一度も実行されない死んだコードになる。
    by_fn = {}
    for f, fn, ln in replaced:
        by_fn.setdefault(fn, []).append(f'{f}:{ln}')
    dup = {fn: v for fn, v in by_fn.items() if len(v) > 1}
    rec('同じ関数を複数のファイルが全置換していない（読み込み順で勝敗が決まる）',
        not dup, '; '.join(f'{fn} → {", ".join(v)}' for fn, v in dup.items()))

    dur = duration_formatters()
    rec('所要時間の書き方は`WL.duration`の1箇所だけが組み立てている（§9.341）',
        not dur, '; '.join(dur))

    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    print('  現状の全置換: ' + (', '.join(f'{f}:{ln} {fn}' for f, fn, ln in replaced) or 'なし'))
    sys.exit(0 if all(R) else 1)


main()
