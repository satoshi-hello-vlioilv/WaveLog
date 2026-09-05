"""tests/wait_report.py: テストに書かれた固定待ち（`waitForTimeout(N)`）を数える（§9.324 R5）

    python3 tests/wait_report.py          # 本ごとの合計(ms)と件数を多い順に
    python3 tests/wait_report.py test_x   # その本の1件ずつ（行番号つき）

固定待ちは所要時間にそのまま乗る（tests/README.md「待ち方」）。**まず測る**——
どの本のどの待ちが大きいかを数字で見てから、条件待ち（tests/lib/wait.js）へ
置き換える。ループの中の待ちは回数ぶん掛かるので、ここの数は**下限**。
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAT = re.compile(r'waitForTimeout\((\d+)\)')


def scan(p):
    out = []
    for i, line in enumerate(p.read_text(encoding='utf-8').splitlines(), 1):
        for m in PAT.finditer(line):
            out.append((i, int(m.group(1))))
    return out


def main(argv):
    files = sorted((ROOT / 'tests').glob('test_*.js'))
    if argv:
        for a in argv:
            p = ROOT / 'tests' / (a if a.endswith('.js') else a + '.js')
            hits = scan(p)
            print(f'{p.name}: {sum(ms for _, ms in hits)}ms / {len(hits)}件')
            for ln, ms in hits:
                print(f'  {ln:5d}: {ms}ms')
        return 0
    rows = [(sum(ms for _, ms in scan(p)), len(scan(p)), p.name) for p in files]
    rows.sort(reverse=True)
    total = sum(r[0] for r in rows)
    print(f'固定待ちの合計: {total/1000:.1f}s / {sum(r[1] for r in rows)}件 / {len(rows)}本')
    for ms, n, name in rows[:25]:
        print(f'  {ms/1000:6.1f}s {n:4d}件  {name}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
