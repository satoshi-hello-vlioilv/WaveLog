#!/usr/bin/env python3
"""test_recmirror.py: 測定データの閲覧も手元の写しから（§9.268）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の指摘:
  「書き込みについてはある程度制約を設けて制御している設計ですが、
   スケジュールや測定データを閲覧するときは、ローカルにコピーしてから
   見る設計になっているでしょうか。閲覧は複数人が同時にアクセスするため、
   直接閲覧はデータ書き込み更新を阻害する要因になるはずです。」

そのとおりだった。作業予定（`fetch_snapshot`）・仕掛/品質（`db_mirror`）・
マスタ（§9.263）は手元の写しから読む形になっていたが、**測定データだけが
共有を直接開いていた**。SQLiteの読み手は読んでいるあいだSHAREDロックを
持つので、閲覧端末が増えるほど測定端末の書込（EXCLUSIVEが要る）が
待たされる。SMB越しのロックは元々当てにならない。

ここで固定するのは次の7つ。
 1. 共有の設備ファイルが**写す対象**に載る
 2. 読む先は**写し**（写しがあれば）
 3. **写しがまだ無ければ実物**（fail-open。写せるまで画面が止まらない）
 4. **自分が書いたファイルは写さない・実物から読む**
    （写しは間隔ぶん古いので、自分の書込が自分に見えなくなる）
 5. **書く先・消す先は実物のまま**（写しへ書いて共有へ反映されない事故を防ぐ）
 6. 置き場が未設定なら**何も変わらない**（今までどおりMEAS_DB 1本）
 7. 写しを通しても**中身が同じに読める**
============================================================
"""
import pathlib, shutil, sqlite3, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db_access as d  # noqa: E402
from backend import db_mirror as m  # noqa: E402

R = []
def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


def seed(path, rid, eq):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    c.execute('CREATE TABLE IF NOT EXISTS [Web測定バックアップ] '
              '([記録ID] TEXT,[設備] TEXT,[ロット番号] TEXT,[検査番号] TEXT,'
              '[鋳造番号] TEXT,[状態] TEXT,[更新日時] DATETIME,[圧縮形式] TEXT,[ペイロード] TEXT)')
    c.execute('INSERT INTO [Web測定バックアップ] VALUES (?,?,?,?,?,?,?,?,?)',
              (rid, eq, 'L1', 'K1', 'C1', '完了', '2026-08-29 01:00:00', 'json', '{}'))
    c.commit()
    c.close()


share = pathlib.Path(tempfile.mkdtemp(prefix='wl-recmirror-share-'))
work = pathlib.Path(tempfile.mkdtemp(prefix='wl-recmirror-work-'))
orig = (d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH,
        set(d._records_written_here))
_orig_cache_dir = m.cache_dir
try:
    # ---- 6. 置き場が未設定なら何も変わらない ----------------------
    d.RECORDS_SHARE_DIR = None
    d._records_written_here.clear()
    rec('置き場が未設定なら写す対象は0件（今までどおり）',
        m.records_targets() == [], str(m.records_targets()))
    rec('置き場が未設定なら読む先はこの端末の1本だけ',
        [str(p) for p in d.records_read_paths()] == [str(d.MEAS_DB)],
        str([str(p) for p in d.records_read_paths()]))

    # ---- 用意: 共有に2設備、この端末に1本 -------------------------
    seed(share / 'LS4' / 'records.sqlite3', 'LS4|L1|K1|C1', 'LS4')
    seed(share / 'LS5' / 'records.sqlite3', 'LS5|L1|K1|C1', 'LS5')
    local = work / 'records.sqlite3'
    seed(local, 'MINE|L1|K1|C1', 'ここ')
    d.RECORDS_SHARE_DIR = share
    d.MEAS_DB = local
    d.RECORDS_BACKUP_EXPORT_PATH = None
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir = lambda: work / 'cache'

    # ---- 1. 写す対象に載る ---------------------------------------
    tg = dict((k, str(p)) for k, p in m.records_targets())
    rec('共有の設備ファイルが写す対象に載る',
        set(tg) == {'records:LS4', 'records:LS5'}, ','.join(sorted(tg)))
    rec('この端末のDBは写す対象に入れない（自分が書くもの）',
        str(local) not in tg.values(), str(local))

    # ---- 3. 写しがまだ無ければ実物（fail-open） -------------------
    before = [str(p) for p in d.records_read_paths()]
    rec('写しがまだ無ければ実物を読む（画面を止めない）',
        str(share / 'LS4' / 'records.sqlite3') in before, ' / '.join(before))

    # ---- 2. 写したら写しを読む -----------------------------------
    for k, p in m.records_targets():
        m.refresh_one(k, p, force=True)
    after = [str(p) for p in d.records_read_paths()]
    rec('写したあとは写しを読む（共有を直接開かない）',
        all('cache' in x for x in after if 'LS' in x)
        and not any(str(share) in x for x in after), ' / '.join(after))
    rec('この端末のDBは写しにしない', str(local) in after, ' / '.join(after))

    # ---- 7. 中身が同じに読める -----------------------------------
    d.invalidate_backup_rows_cache()
    ids = {r['id'] for r in d.merged_backup_rows(force=True)}
    rec('写しを通しても全設備の記録が読める',
        {'LS4|L1|K1|C1', 'LS5|L1|K1|C1', 'MINE|L1|K1|C1'} <= ids,
        ','.join(sorted(ids)))

    # ---- 2'. **実際に写しから読んでいる**ことを見る -----------------
    # **「読む先を答える関数」だけを見る網では捕まらない**——読む側が
    # その答えを使っていなくても通る（実際に素通りした）。写しと実物の
    # 中身を**わざと食い違わせて**、どちらが出るかで見分ける。
    real5 = share / 'LS5' / 'records.sqlite3'
    c5 = sqlite3.connect(str(real5))
    c5.execute('INSERT INTO [Web測定バックアップ] VALUES (?,?,?,?,?,?,?,?,?)',
               ('LS5|ONLY-IN-SHARE', 'LS5', 'L9', 'K9', 'C9', '完了',
                '2026-08-29 03:00:00', 'json', '{}'))
    c5.commit()
    c5.close()
    d.invalidate_backup_rows_cache()
    ids_m = {r['id'] for r in d.merged_backup_rows(force=True)}
    rec('読むのは写し（共有だけにある行はまだ見えない）',
        'LS5|ONLY-IN-SHARE' not in ids_m,
        ','.join(sorted(x for x in ids_m if x.startswith('LS5'))))
    # 写し直せば見える（＝写しが古いだけで、取りこぼしではない）。
    m.refresh_one('records:LS5', real5, force=True)
    d.invalidate_backup_rows_cache()
    ids_m2 = {r['id'] for r in d.merged_backup_rows(force=True)}
    rec('写し直せば見える（取りこぼしではなく、写しが古いだけ）',
        'LS5|ONLY-IN-SHARE' in ids_m2,
        ','.join(sorted(x for x in ids_m2 if x.startswith('LS5'))))

    # ---- 4. 自分が書いたファイルは実物から読む -------------------
    mine = share / 'LS4' / 'records.sqlite3'
    d.note_records_written(mine)
    tg2 = [k for k, _ in m.records_targets()]
    rec('自分が書いたファイルは写す対象から外れる',
        tg2 == ['records:LS5'], ','.join(tg2))
    after2 = [str(p) for p in d.records_read_paths()]
    rec('自分が書いたファイルは実物から読む（写しは間隔ぶん古い）',
        str(mine) in after2, ' / '.join(after2))
    rec('他の設備は写しのまま（1本だけ外れる）',
        any('records_LS5' in x for x in after2), ' / '.join(after2))
    # **自分の書込が自分にすぐ見える**——これが実物から読む理由。
    seed_extra = sqlite3.connect(str(mine))
    seed_extra.execute('INSERT INTO [Web測定バックアップ] VALUES (?,?,?,?,?,?,?,?,?)',
                       ('LS4|NEW', 'LS4', 'L2', 'K2', 'C2', '完了',
                        '2026-08-29 02:00:00', 'json', '{}'))
    seed_extra.commit()
    seed_extra.close()
    d.invalidate_backup_rows_cache()
    ids2 = {r['id'] for r in d.merged_backup_rows(force=True)}
    rec('自分が書いた行は写しを待たずに見える', 'LS4|NEW' in ids2,
        ','.join(sorted(x for x in ids2 if x.startswith('LS4'))))

    # ---- 5. 書く先・消す先は実物のまま ---------------------------
    # **写しへ書くと共有へ反映されない。** 書く先を答えるのは
    # `records_path_for`、消す先を探すのは `records_paths_holding`。
    d._records_written_here.clear()
    for k, p in m.records_targets():
        m.refresh_one(k, p, force=True)
    w = d.records_path_for('LS5')
    rec('書く先は実物（写しではない）',
        str(w) == str(share / 'LS5' / 'records.sqlite3'), str(w))
    holders = {str(p) for p in d.records_paths_holding(['LS5|L1|K1|C1'])}
    rec('消す先も実物（写しを消しても共有は変わらない）',
        holders == {str(share / 'LS5' / 'records.sqlite3')}, ','.join(holders))
    rec('読む先と書く先が違う（読みは写し・書きは実物）',
        str(w) not in [str(p) for p in d.records_read_paths()], str(w))
finally:
    m.cache_dir = _orig_cache_dir
    d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH = orig[0], orig[1], orig[2]
    d._records_written_here.clear()
    d._records_written_here.update(orig[3])
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    shutil.rmtree(share, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, x in ng:
    print(' -', n, x)
sys.exit(1 if ng else 0)
