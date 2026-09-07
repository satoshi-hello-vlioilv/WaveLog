"""共有状態の指紋（表ごとの行数）を1行1件で出す。

`tests/run_all.sh` が**テストの前後で比べて、共有状態を残した本を名指しする**
ために使う（§9.360）。戻すのはランナーの `restore_master` がやるので、
ここは「誰が汚したか」を言うためだけの読み取り専用の道具。

引数を2つ渡すと、その2つのファイル（指紋を保存したもの）の差を
「表名 +N/-N」で1行にして出す。
"""
import pathlib
import sqlite3
import sys

# **置き場はこのファイルの位置から決める**（カレントに依らない）。相対パスに
# すると、ランナーが `tests/` から呼んだときに**1件も読めず、黙って空振りする**
# ——「仕組みを入れたのに働いていない」の典型（§9.356 で一度踏んだ）。
ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = (ROOT / 'db' / 'master.sqlite3', ROOT / 'db' / 'records.sqlite3')


def snapshot():
    out = []
    for f in TARGETS:
        name = f.name
        if not f.exists():
            continue
        try:
            con = sqlite3.connect(f, timeout=5)
        except sqlite3.Error as e:          # 読めないだけなら黙って飛ばす
            print('!! 指紋を取れません %s: %s' % (name, str(e)[:60]), file=sys.stderr)
            continue
        try:
            rows = con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            for (table,) in rows.fetchall():
                try:
                    n = con.execute('SELECT COUNT(*) FROM "%s"' % table).fetchone()[0]
                except sqlite3.Error:       # 壊れた表は数えない（指紋の目的外）
                    continue
                out.append('%s|%s|%d' % (name, table, n))
        finally:
            con.close()
    return out


def load(path):
    d = {}
    for line in pathlib.Path(path).read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        src, table, n = line.rsplit('|', 2)
        d[(src, table)] = int(n)
    return d


def main():
    if len(sys.argv) == 3:
        a, b = load(sys.argv[1]), load(sys.argv[2])
        msg = []
        for k in sorted(set(a) | set(b)):
            x, y = a.get(k, 0), b.get(k, 0)
            if x != y:
                msg.append('%s %+d' % (k[1], y - x))
        print(' / '.join(msg[:6]))
        return
    print('\n'.join(snapshot()))


if __name__ == '__main__':
    main()
