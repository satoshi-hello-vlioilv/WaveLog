#!/usr/bin/env python3
"""test_importlint.py: 関数の中の import を「増やさない」（REVIEW 3-21・§9.349）

関数の中に書いた import は、モジュール同士の輪（循環）を**隠す**道になる。
3-2（§9.329）で読み込み時の輪を 28→0 にしたが、3-10 で関数の中の import が
**210→230 に増えた**——輪を隠す道が増えると 3-2 が戻る。

ここで見張るのは**増えないこと**。ファイルごとの件数を
`tests/fixtures/import_baseline.json` に固定し、**下げる方向だけ**動かせる
（`test_eslint`／`test_waitlint` の baseline と同じ作法）。
減ったら `python3 tests/test_importlint.py --update` で上限を下げる。

**理由が書ける「関数の中の import」は残ってよい**（例: 重いモジュールを
使う経路でだけ読む、起動を速くする）。ただし理由は**その行に書く**
（`# 遅延: 理由`）。印のある行は数えない——数から外す理由が行に無いと、
次に読む人が消してよいか判断できない。
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'backend'
BASELINE = ROOT / 'tests' / 'fixtures' / 'import_baseline.json'
PAT = re.compile(r'^[ \t]+(?:import \S|from \S+ import )')
MARK = '# 遅延:'
R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def scan(path):
    n = 0
    for line in path.read_text(encoding='utf-8').splitlines():
        if PAT.match(line) and MARK not in line:
            n += 1
    return n


def main(update=False):
    files = sorted(SRC.rglob('*.py'))
    now = {p.relative_to(ROOT).as_posix(): scan(p) for p in files}
    now = {k: v for k, v in now.items() if v}
    rec('見るファイルがある', len(files) >= 30, f'{len(files)}本')
    base = json.loads(BASELINE.read_text(encoding='utf-8')) if BASELINE.exists() else {}
    over = [f'{k} {base.get(k, 0)}→{v}' for k, v in now.items() if v > base.get(k, 0)]
    under = [f'{k} {base.get(k, 0)}→{v}' for k, v in now.items() if v < base.get(k, 0)]
    under += [f'{k} {b}→0' for k, b in base.items() if k not in now and b]
    if update:
        if over and base:
            print('!! 上限を上げる更新はしません: ' + '; '.join(over[:10]))
        else:
            BASELINE.parent.mkdir(exist_ok=True)
            BASELINE.write_text(json.dumps(now, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
                                encoding='utf-8')
            print(f'baseline を書き直しました: {BASELINE} ({len(now)} files)')
    total = sum(now.values())
    rec('関数の中の import がファイルごとの上限を超えていない（増えたら落ちる）',
        not over, '; '.join(over[:12]) or f'いま {total}箇所 / {len(now)}ファイル')
    if under:
        print('   注: 上限を下げられます（python3 tests/test_importlint.py --update）: '
              + '; '.join(under[:8]) + (' …' if len(under) > 8 else ''))
    rec('baseline がある（無いと「増えた」を言えない）', BASELINE.exists(), str(BASELINE.relative_to(ROOT)))
    probe = SRC / '_importprobe.py'
    try:
        probe.write_text('def f():\n    import json\n    from os import path  # 遅延: 印の例\n    return json, path\n',
                         encoding='utf-8')
        rec('網そのものが素通りしない（注いだ import を数え、印の行は数えない）', scan(probe) == 1, f'{scan(probe)}件')
    finally:
        try:
            probe.unlink()
        except FileNotFoundError:
            pass
    top = sorted(now.items(), key=lambda kv: -kv[1])[:6]
    print('  残っている上位: ' + ', '.join(f'{k} {v}' for k, v in top))
    print(f'\n== {sum(R)}/{len(R)} PASS ==')
    sys.exit(0 if all(R) else 1)


if __name__ == '__main__':
    main(update='--update' in sys.argv)
