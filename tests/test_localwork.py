#!/usr/bin/env python3
"""test_localwork.py: 作り直せるファイルは自動で手元へ置く（§9.109）。

============================================================
なぜ要るか
------------------------------------------------------------
実機のアプリは `C:\\boxdrive\\Box\\...\\WaveLog_v1\\` に置かれていた。
つまり `db/cache/`（共有DBの写し）も `schedule_cache.sqlite3`（共有
スケジュールの作業コピー）も**Box Driveの中**にあり、同期のあいだ掴まれて
置き換えを拒まれていた（§9.108）。

「db_dir を手元へ移してください」と設定をお願いするのではなく、
**アプリが置き場を決める**。ここで固定するのは5つ。

 1. db_dir が手元なら**何も変えない**（今までどおり db/ を使う）
 2. クラウド同期フォルダー／ネットワークの上なら、手元の領域へ逃がす
 3. **本物のデータ（マスタ・測定データ）は動かさない**——黙って移すと、
    同期されているつもりのデータが同期対象から外れる
 4. 判定は**1回だけ**（リクエストのたびに共有へ resolve/stat を掛けない）
 5. 前の置き場の後始末は**自分の生成物だけ**を触り、失敗しても落ちない
============================================================
"""
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import atomic_io, db_access, db_mirror, paths  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def decide_with(db_dir_value):
    """config/local.json の db_dir がその値だったとして判定させる。"""
    paths.load_local_config = lambda: {'db_dir': str(db_dir_value)}
    paths.reset_work_dir_cache()
    return paths._decide_work_dir()


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_work_'))
_orig_load = paths.load_local_config
_orig_is_network = paths.is_network_path
_orig_work_dir = paths.work_dir
_orig_relocated = paths.work_dir_relocated
_orig_cache_dir = db_mirror.cache_dir
_orig_db_dir_const = db_access.DB_DIR

try:
    # ---- 1) 手元の置き場なら、これまでどおり db_dir をそのまま使う ----
    # **健全な端末の挙動を変えないこと**がいちばん大事。
    plain = tmp / 'plain' / 'db'
    plain.mkdir(parents=True, exist_ok=True)
    where, why = decide_with(plain)
    rec('手元の置き場はそのまま使う', where == plain and why == '', f'{where} / {why}')

    # ---- 2) クラウド同期フォルダーの中なら手元へ逃がす ----
    boxed = tmp / 'boxdrive' / 'Box' / 'WaveLog_v1' / 'db'
    boxed.mkdir(parents=True, exist_ok=True)
    where, why = decide_with(boxed)
    rec('Boxの中なら手元へ逃がす', where != boxed and 'Box' in why, f'{where} / {why}')
    rec('逃がし先はユーザー別のローカル領域',
        str(where).startswith(str(paths.local_root())), str(where))
    rec('逃がしたことが分かる',
        paths.work_dir_relocated() is True and paths.work_dir_reason() == why, why)

    onedrive = tmp / 'Users' / 'me' / 'OneDrive' / 'WaveLog' / 'db'
    onedrive.mkdir(parents=True, exist_ok=True)
    where_od, why_od = decide_with(onedrive)
    rec('OneDriveの中でも逃がす', where_od != onedrive and 'OneDrive' in why_od, why_od)

    # ---- 3) ネットワーク上なら逃がす ----
    # is_network_path の中身（UNC判定・GetDriveTypeW）はWindows専用なので、
    # ここでは**その答えを受けてどう振る舞うか**だけを見る。
    paths.is_network_path = lambda p: True
    try:
        where_net, why_net = decide_with(plain)
        rec('ネットワーク上なら手元へ逃がす',
            where_net != plain and 'ネットワーク' in why_net, f'{where_net} / {why_net}')
    finally:
        paths.is_network_path = _orig_is_network

    # UNCは**resolve()の前に文字列で**見る。resolve()に通すと、Linuxでは
    # `\\server\share` はただのファイル名に、`//server/share` は
    # `/server/share` に潰れて判定が消える（＝この分岐をテストで踏めない）。
    # 共有が落ちていて resolve() が失敗する場合にも効く。
    rec('UNC表記(円記号)はネットワークと判定する', _orig_is_network(r'\\server\share\db') is True)
    rec('UNC表記(スラッシュ)もネットワークと判定する', _orig_is_network('//server/share/db') is True)
    rec('ふつうのローカルはネットワークではない', _orig_is_network(plain) is False)
    where_unc, why_unc = decide_with(r'\\Nlmfangyshrd\14_仕上課\db')
    rec('UNC上のdb_dirは手元へ逃がす', 'ネットワーク' in why_unc, f'{where_unc} / {why_unc}')

    # ---- 4) 別のインストールは別の置き場になる ----
    # 1台のPCに2つ入れても写しが混ざらないこと。
    a, _ = decide_with(tmp / 'boxdrive' / 'Box' / 'A' / 'db')
    b, _ = decide_with(tmp / 'boxdrive' / 'Box' / 'B' / 'db')
    rec('インストールごとに別の置き場になる', a != b, f'{a.name} / {b.name}')

    # ---- 5) 判定は1回だけ（毎回 resolve/stat しない） ----
    # 共有が不調なとき、確認のその1行が唯一の失敗原因になる（CLAUDE.md）。
    calls = [0]

    def counting(p):
        calls[0] += 1
        return False

    paths.is_network_path = counting
    try:
        paths.load_local_config = lambda: {'db_dir': str(plain)}
        paths.reset_work_dir_cache()
        for _ in range(20):
            paths.work_dir()
        rec('置き場の判定は1回しかしない', calls[0] == 1, f'{calls[0]}回')
    finally:
        paths.is_network_path = _orig_is_network

    # ---- 6) 写しの置き場は work_dir に従う。**本物のデータは動かない** ----
    moved = tmp / 'elsewhere'
    moved.mkdir(parents=True, exist_ok=True)
    paths.work_dir = lambda: moved
    try:
        rec('写しの置き場は work_dir に従う', db_mirror.cache_dir() == moved / 'cache',
            str(db_mirror.cache_dir()))
        rec('マスタDBは work_dir へ動かさない',
            pathlib.Path(db_access._MASTER_PATH).parent != moved,
            str(db_access._MASTER_PATH))
        rec('測定データDBは work_dir へ動かさない',
            pathlib.Path(db_access.MEAS_DB).parent != moved,
            str(db_access.MEAS_DB))
        # 逆に、作り直せるものは work_dir 側にある。
        rec('スケジュールの作業コピーは work_dir 側にある',
            pathlib.Path(db_access.SCHEDULE_CACHE_PATH).parent
            == pathlib.Path(db_access.WORK_DIR),
            str(db_access.SCHEDULE_CACHE_PATH))
    finally:
        paths.work_dir = _orig_work_dir

    # ---- 7) 前の置き場の後始末は「自分の生成物だけ」 ----
    old = tmp / 'old_cache'
    new = tmp / 'new_cache'
    old.mkdir(parents=True, exist_ok=True)
    new.mkdir(parents=True, exist_ok=True)
    (old / 'SIKALOT.g1.sqlite3').write_bytes(b'x')
    (old / 'SIKALOT.g2.sqlite3.tmp').write_bytes(b'x')
    (old / '_mirror.json').write_text('{}', encoding='utf-8')
    (old / 'メモ.txt').write_text('利用者のファイル', encoding='utf-8')
    db_access.DB_DIR = old.parent          # _former_cache_dir() は DB_DIR/cache
    (old.parent / 'cache').mkdir(exist_ok=True)
    for name in ('SIKALOT.g1.sqlite3', '_mirror.json', 'メモ.txt'):
        (old.parent / 'cache' / name).write_text('x', encoding='utf-8')
    db_mirror.cache_dir = lambda: new
    paths.work_dir_relocated = lambda: True
    try:
        gone = db_mirror.sweep_former_cache()
        left = sorted(p.name for p in (old.parent / 'cache').iterdir())
        rec('前の置き場の写しは片付ける', gone == 2, f'{gone}件')
        rec('利用者のファイルには触らない', left == ['メモ.txt'], str(left))

        # 消せなくても落ちないこと（共有・クラウドの上では普通に起きる）。
        (old.parent / 'cache' / 'SIKALOT.g9.sqlite3').write_text('x', encoding='utf-8')
        _orig_unlink = atomic_io.unlink
        atomic_io.unlink = lambda *a, **k: False
        try:
            gone2 = db_mirror.sweep_former_cache()
            rec('消せなくても落ちない', gone2 == 0, f'{gone2}件')
        finally:
            atomic_io.unlink = _orig_unlink

        # 逃がしていないときは何もしない（今の置き場を消したら大事故）。
        paths.work_dir_relocated = lambda: False
        rec('逃がしていなければ後始末はしない', db_mirror.sweep_former_cache() == 0)
    finally:
        paths.work_dir_relocated = _orig_relocated
        db_access.DB_DIR = _orig_db_dir_const

except Exception as e:
    import traceback
    rec('FATAL', False, repr(e))
    traceback.print_exc()

finally:
    paths.load_local_config = _orig_load
    paths.is_network_path = _orig_is_network
    paths.work_dir = _orig_work_dir
    paths.work_dir_relocated = _orig_relocated
    db_mirror.cache_dir = _orig_cache_dir
    db_access.DB_DIR = _orig_db_dir_const
    paths.reset_work_dir_cache()
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(f' - {n} {d}')
sys.exit(1 if ng else 0)
