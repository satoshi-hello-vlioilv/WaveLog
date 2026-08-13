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
    # 写しは世代名(§9.108)。決まった名前へ上書きしないので、こちらが読んで
    # いる最中でもWindowsで置き換えを拒まれない。
    rec('写しは世代名で置かれる', '.g' in local.name and local.name.endswith('.sqlite3'),
        local.name)

    # ---- 2) 元が変わっていなければ写し直さない ----
    r2 = db_mirror.refresh_one(KEY, remote)
    rec('元が変わっていなければ写し直さない', r2.get('skipped') is True, r2['reason'])

    # ---- 3) 元が変わったら追随する ----
    make_db(remote, [('L001', 'a'), ('L002', 'b'), ('L003', 'c')])
    prev = local
    r3 = db_mirror.refresh_one(KEY, remote, force=True)
    rec('元が変わったら写し直す', r3['updated'], r3['reason'])
    local = db_mirror.mirror_path(KEY)
    rec('新しい内容が読める', len(read_rows(local)) == 3, f'{len(read_rows(local))}件')
    # 世代が進む＝**既存のファイルを上書きしていない**。ここが直したかった点。
    rec('写し直すと別の名前になる', local.name != prev.name, f'{prev.name} -> {local.name}')
    rec('前の世代は片付けられる', not prev.exists(), str(prev))

    # ---- 4) 壊れた元は採用しない(前の写しを使い続ける) ----
    # **これが本題**。書き込み途中のファイルを掴んでも、画面へは出さない。
    good = read_rows(local)
    broken = remote.read_bytes()
    # ヘッダーは残しつつ後半を潰す = 「途中まで書かれた」状態の代役
    remote.write_bytes(broken[:len(broken) // 2] + b'\x00' * (len(broken) // 2))
    r4 = db_mirror.refresh_one(KEY, remote, force=True)
    rec('壊れた元は採用しない', not r4['updated'], r4['reason'])
    rec('前の写しをそのまま読み続けられる',
        db_mirror.mirror_path(KEY) == local and read_rows(local) == good,
        f'{len(read_rows(local))}件')

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
    local = db_mirror.mirror_path(KEY)
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

    # ---- 9) 開いている写しがあっても写し直せる(§9.108) ----
    # **ここが実機で毎分失敗していたところ。** Windowsは、開かれている
    # ファイルへの置き換えを ERROR_ACCESS_DENIED(WinError 5) で拒む
    # (SQLiteは FILE_SHARE_DELETE を付けずに開くため)。Linuxのrename(2)は
    # 成功してしまい再現しないので、**その規則をここで真似る**。
    import os as _os
    held = set()
    _real_replace, _real_unlink = _os.replace, _os.unlink

    def _denied():
        e = PermissionError(13, 'アクセスが拒否されました。')
        e.winerror = 5
        return e

    def _windows_like_replace(src, dst):
        if str(dst) in held:
            raise _denied()
        _real_replace(src, dst)

    def _windows_like_unlink(path, **kw):
        # 削除も同じ規則で拒まれる(開いている間は消せない)。Path.unlink()は
        # os.unlink()を呼ぶので、ここを差し替えれば両方に効く。
        if str(path) in held:
            raise _denied()
        _real_unlink(path, **kw)

    _os.replace, _os.unlink = _windows_like_replace, _windows_like_unlink
    try:
        make_db(other, [('X999', 'z'), ('Y888', 'w')])
        cur = db_mirror.mirror_path(KEY)
        held.add(str(cur))              # 今の写しを「開いている」ことにする
        reader = sqlite3.connect(f'file:{cur.as_posix()}?mode=ro', uri=True)
        try:
            # まず、この真似が効いていることを確かめる。**両方PASSでは
            # 証拠にならない**ので、決まった名前への上書きが本当に弾かれる
            # ことを先に見る(§9.102)。
            probe = cur.with_suffix('.probe.tmp')
            probe.write_bytes(b'x')
            blocked = False
            try:
                from backend import atomic_io
                atomic_io.replace(probe, cur, budget_sec=0.2, label='probe')
            except PermissionError:
                blocked = True
            finally:
                probe.unlink(missing_ok=True)
            rec('（前提）開いている写しへの上書きは拒まれる', blocked)

            r9 = db_mirror.refresh_one(KEY, other, force=True)
            rec('開いている写しがあっても写し直せる', r9['updated'], r9['reason'])
            rec('開いたままの読み手は前の内容を読み続けられる',
                reader.execute('SELECT COUNT(*) FROM [仕掛]').fetchone()[0] == 1)
            newer = db_mirror.mirror_path(KEY)
            rec('新しい世代は別の名前になる', newer != cur, f'{cur.name} -> {newer.name}')
            rec('新しい世代には新しい内容が入る', len(read_rows(newer)) == 2)
            rec('掴まれている前の世代は消さずに残す', cur.exists(), str(cur))
        finally:
            reader.close()
            held.discard(str(cur))
        # 手を離せば、次の周回で片付く。
        db_mirror.refresh_one(KEY, other)
        rec('手を離した前の世代は次の周回で片付く', not cur.exists(), str(cur))
    finally:
        _os.replace, _os.unlink = _real_replace, _real_unlink

    # ---- 10) 世代を入れる前の写し・台帳をそのまま引き継ぐ ----
    # **引き継げないと、版を上げた瞬間に全データソースを写し直す**
    # (共有越しに数十MB × データソース数)。旧い台帳は印だけの平らな
    # 辞書で、写しは決まった名前(<キー>.sqlite3)に置かれていた。
    import json as _json
    OLD = 'LEGACY_MIRROR'
    legacy_file = (tmp / 'cache') / f'{OLD}.sqlite3'
    make_db(other, [('OLD1', 'p')])
    import shutil as _shutil
    _shutil.copyfile(other, legacy_file)
    st = other.stat()
    ledger = _json.loads((tmp / 'cache' / '_mirror.json').read_text(encoding='utf-8'))
    ledger[OLD] = {'source': str(other), 'size': st.st_size, 'mtime_ns': st.st_mtime_ns}
    (tmp / 'cache' / '_mirror.json').write_text(_json.dumps(ledger, ensure_ascii=False),
                                                encoding='utf-8')
    rec('旧い形の台帳でも写しを読む',
        pathlib.Path(db_mirror.read_path(OLD, other)) == legacy_file,
        str(db_mirror.read_path(OLD, other)))
    r10 = db_mirror.refresh_one(OLD, other)
    rec('旧い写しがあれば写し直さない', r10.get('skipped') is True, r10['reason'])
    # 一度でも写し直せば世代名へ移り、決まった名前のほうは片付けられる。
    db_mirror.refresh_one(OLD, other, force=True)
    moved = db_mirror.mirror_path(OLD)
    rec('写し直すと世代名へ移る', '.g' in moved.name, moved.name)
    rec('決まった名前の写しは片付けられる', not legacy_file.exists(), str(legacy_file))
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
