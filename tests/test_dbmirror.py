#!/usr/bin/env python3
"""test_dbmirror.py: 共有DBを手元へ写してから読む（§9.89）。

============================================================
なぜ要るか
------------------------------------------------------------
仕掛・品質データの .sqlite3 は**別のPCの別のアプリが更新している**。
更新と読み取りが重なると正しく読めない事象が実機で出た。SQLite自身が
「ネットワークファイルシステム上での使用は避けること」と明言しており、
SMB越しではロックが当てにならない。書き手がファイルごと置き換える運用
なら、そもそもロック以前の問題になる。

そこで読む対象を共有から切り離す。共有のファイルを手元へ写し、
**写しが正しいと確かめてから**切り替え、画面はいつも手元の写しを読む。

ここで固定するのは次の5つ。
 1. 写しが出来ていれば、読む場所は写しになる（共有を掴み続けない）
 2. 書き込み途中の壊れたファイルは**採用しない**（前の写しを使い続ける）
 3. 元が変わっていなければ写し直さない（共有への往復を増やさない）
 4. 元へ到達できなくても、前の写しで読み続けられる
 5. 自分が書くDB（マスタ・共有スケジュール）は**写さない**
============================================================
"""
import pathlib, sqlite3, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db_mirror  # noqa: E402
from backend import db_access  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def make_db(path, rows, table='仕掛'):
    c = sqlite3.connect(path)
    c.execute(f'CREATE TABLE IF NOT EXISTS [{table}] ([ロット番号] TEXT, [値] TEXT)')
    c.execute(f'DELETE FROM [{table}]')
    c.executemany(f'INSERT INTO [{table}] VALUES (?,?)', rows)
    c.commit()
    c.close()


def read_rows(path, table='仕掛'):
    c = sqlite3.connect(f'file:{pathlib.Path(path).as_posix()}?mode=ro', uri=True)
    try:
        return c.execute(f'SELECT * FROM [{table}]').fetchall()
    finally:
        c.close()


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_mirror_'))
remote = tmp / 'SHARE.sqlite3'
KEY = 'PROBE_MIRROR'
# 写しの置き場をこの検証専用へ差し替える（本番の db/cache を汚さない）。
_orig_cache = db_mirror.cache_dir
db_mirror.cache_dir = lambda: tmp / 'cache'

try:
    # ---- 1) 写しが出来ると、読む場所が写しになる ----
    make_db(remote, [('L001', 'a'), ('L002', 'b')])
    r = db_mirror.refresh_one(KEY, remote)
    rec('共有から手元へ写せる', r['updated'], r['reason'])
    local = db_mirror.mirror_path(KEY)
    rec('写しは手元の置き場に出来る', local.exists(), str(local))
    rec('写しの中身が元と一致する', read_rows(local) == read_rows(remote),
        f'{read_rows(local)}')
    rec('読む場所は写しを指す', pathlib.Path(db_mirror.read_path(KEY, remote)) == local)

    # ---- 2) 元が変わっていなければ写し直さない ----
    r2 = db_mirror.refresh_one(KEY, remote)
    rec('元が変わっていなければ写し直さない', r2.get('skipped') is True, r2['reason'])

    # ---- 3) 元が変わったら追随する ----
    make_db(remote, [('L001', 'a'), ('L002', 'b'), ('L003', 'c')])
    r3 = db_mirror.refresh_one(KEY, remote, force=True)
    rec('元が変わったら写し直す', r3['updated'], r3['reason'])
    rec('新しい内容が読める', len(read_rows(local)) == 3, f'{len(read_rows(local))}件')

    # ---- 4) 壊れた元は採用しない(前の写しを使い続ける) ----
    # **これが本題**。書き込み途中のファイルを掴んでも、画面へは出さない。
    good = read_rows(local)
    broken = remote.read_bytes()
    # ヘッダーは残しつつ後半を潰す = 「途中まで書かれた」状態の代役
    remote.write_bytes(broken[:len(broken) // 2] + b'\x00' * (len(broken) // 2))
    r4 = db_mirror.refresh_one(KEY, remote, force=True)
    rec('壊れた元は採用しない', not r4['updated'], r4['reason'])
    rec('前の写しをそのまま読み続けられる', read_rows(local) == good, f'{len(read_rows(local))}件')

    # ---- 5) 元へ到達できなくても前の写しで読み続けられる ----
    missing = tmp / 'NOT_THERE.sqlite3'
    r5 = db_mirror.refresh_one(KEY, missing, force=True)
    rec('元へ到達できなければ写しを維持する', not r5['updated'], r5['reason'])
    rec('到達できなくても写しは残る', local.exists() and read_rows(local) == good)

    # ---- 6) 書く対象は写さない ----
    # 写した先へ書くと共有へ反映されない事故になるため、対象は読み取り専用だけ。
    kinds = {k: (db_access.DBS[k] or {}).get('role') for k, _ in db_mirror.targets()}
    rec('写す対象は読み取り専用のデータソースだけ',
        all(v == 'readonly' for v in kinds.values()), f'{kinds}')
    rec('マスタDBは写さない', 'MASTER' not in dict(db_mirror.targets()))

    # ---- 7) 読み込み先を切り替えたら、前の元から作った写しは使わない ----
    # パス設定を変えた直後に前のファイルの写しを読み続けると、**別のデータを
    # 出しているのに気づけない**。写しが出来るまでは元を直接読む。
    other = tmp / 'OTHER.sqlite3'
    make_db(other, [('X999', 'z')])
    rec('読み込み先を変えたら写しを使わない',
        pathlib.Path(db_mirror.read_path(KEY, other)) == other,
        str(db_mirror.read_path(KEY, other)))
    db_mirror.refresh_one(KEY, other, force=True)
    rec('写し直したあとは新しい方の写しを読む',
        pathlib.Path(db_mirror.read_path(KEY, other)) == local
        and read_rows(local) == [('X999', 'z')], f'{read_rows(local)}')

    # ---- 8) 無効にすれば従来どおり元を読む ----
    _orig_enabled = db_mirror.enabled
    db_mirror.enabled = lambda: False
    try:
        rec('写しを無効にすると元を読む',
            pathlib.Path(db_mirror.read_path(KEY, other)) == pathlib.Path(other))
    finally:
        db_mirror.enabled = _orig_enabled
finally:
    db_mirror.cache_dir = _orig_cache
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
