"""共有状態の指紋（表ごとの行数）を1行1件で出す。

`tests/run_all.sh` が**テストの前後で比べて、共有状態を残した本を名指しする**
ために使う（§9.360）。戻すのはランナーの `restore_master` がやるので、
ここは「誰が汚したか」を言うためだけの読み取り専用の道具。

引数を2つ渡すと、その2つのファイル（指紋を保存したもの）の差を
「表名 +N/-N」で1行にして出す。
"""
import os
import pathlib
import sqlite3
import sys

# **置き場はこのファイルの位置から決める**（カレントに依らない）。相対パスに
# すると、ランナーが `tests/` から呼んだときに**1件も読めず、黙って空振りする**
# ——「仕組みを入れたのに働いていない」の典型（§9.356 で一度踏んだ）。
ROOT = pathlib.Path(__file__).resolve().parent.parent
TARGETS = (ROOT / 'db' / 'master.sqlite3', ROOT / 'db' / 'records.sqlite3')


# **製品の「一度だけの移行が済んだ」印は数えない**（§9.360 の追補）。
# `パス設定マスタ` の `__…__` は移行フラグで、テストの置き土産ではない——
# `tests/make_fixture.py` は既定セルをまき直させるために **わざと**
# `__rb_default_cells_seeded__` を消しており、サーバーが次に読んだ瞬間に
# 書き直す。これを数えると、帳票系だけで**20本が毎回「汚した」と出る**
# ——**うるさい報告は読まれない**ので、本物の置き土産が埋もれる。
MARKER_TABLE = 'パス設定マスタ'

# **SQLite自身の帳簿は数えない**（§9.377 の追補）。`sqlite_sequence` は
# `AUTOINCREMENT` の「これまでに配った最大の番号」で、行を消しても戻らない
# ——つまり**テストには片付けようが無い**。片付けられないものを「置き土産」
# として名指しすると、後片付けを足しても消えない指摘が毎回出る（新しいマスタを
# 足した本が必ずそうなる）。上の移行フラグと同じ理由で数から外す。
IGNORED_TABLES = {'sqlite_sequence'}


def _row_count(con, table):
    """行数。移行の印は数から除く（上の理由）。"""
    if table == MARKER_TABLE:
        # `\_`はPythonのエスケープとしては未定義（3.12以降は SyntaxError）。
        # SQLへ渡したいのは「バックスラッシュ＋アンダースコア」なので、
        # **生文字列**で書く（`test_pywarn`が①②で落ちて気づいた）。
        return con.execute(
            r'SELECT COUNT(*) FROM "%s" WHERE 設定キー NOT LIKE \'\_\_%%\_\_\' ESCAPE \'\\\''
            % table).fetchone()[0]
    return con.execute('SELECT COUNT(*) FROM "%s"' % table).fetchone()[0]


# 内訳モード（`WAVELOG_FP_DETAIL=1`）。**どの対象へ残したか**まで出す。
# 「列レイアウトマスタ +59」だけでは、どこを片付ければよいか分からない——
# 後片付けを足すときの調べ物のために、行数ではなく対象ごとに数える。
DETAIL_TABLES = {'列レイアウトマスタ': '対象', 'スケジュール内容表示マスタ': '設備名'}


def _detail_rows(con, table):
    col = DETAIL_TABLES[table]
    return [('%s[%s]' % (table, k), n) for k, n in con.execute(
        'SELECT "%s", COUNT(*) FROM "%s" GROUP BY 1 ORDER BY 1' % (col, table))]


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
                if table in IGNORED_TABLES:
                    continue
                try:
                    if os.environ.get('WAVELOG_FP_DETAIL') and table in DETAIL_TABLES:
                        for label, n in _detail_rows(con, table):
                            out.append('%s|%s|%d' % (name, label, n))
                        continue
                    n = _row_count(con, table)
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
        # 片方にしか無い表は0行として比べる——**0行の表が増えた・消えただけは差ではない**
        # （サーバーが初めて使う表を作っただけ。テストには片付ける物が無い）。
        for k in sorted(set(a) | set(b)):
            x, y = a.get(k, 0), b.get(k, 0)
            if x != y:
                msg.append('%s %+d' % (k[1], y - x))
        print(' / '.join(msg[:6]))
        return
    print('\n'.join(snapshot()))


if __name__ == '__main__':
    main()
