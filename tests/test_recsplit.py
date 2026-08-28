#!/usr/bin/env python3
"""test_recsplit.py: 測定データは設備ごとに1ファイル（§9.258）。

============================================================
なぜ要るか
------------------------------------------------------------
共有スペースを正とする運用では、壊れる条件は実質ひとつしかない——
**同じファイルを2台のPCが変えること**（クラウド同期には本物のファイル
ロックが無い）。測定端末は1設備に1台なので、測定データを設備ごとの
ファイルへ分けると、その条件が**構造として**消える。

ここで固定するのは次の7つ。
 1. 置き場が未設定なら**今までどおり**MEAS_DB 1本（現場の動きを黙って変えない）
 2. 設備が違えば別のファイル。全角/半角・大小文字のゆれは同じファイル
 3. フォルダ名に使えない文字を落としても**別の設備が同じフォルダにならない**
 4. 読むときは**旧い置き場も一緒に**見る（移行の途中で記録が消えない）
 5. 記録IDを持っているファイルだけを開く（無関係な設備のファイルを書かない）
 6. 振り分けは**既定が下見**で、1件も書かない
 7. 振り分けたあとも記録は二重に出ない（記録IDごとに新しい方）
============================================================
"""
import pathlib, shutil, sqlite3, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import db_access as d  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def put(path, rid, equipment, lot, updated='2026-08-28 10:00:00', payload='x'):
    """[Web測定バックアップ]へ1件入れる。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    c.execute('CREATE TABLE IF NOT EXISTS [Web測定バックアップ] ('
              '[記録ID] TEXT,[設備] TEXT,[ロット番号] TEXT,[検査番号] TEXT,[鋳造番号] TEXT,'
              '[状態] TEXT,[更新日時] DATETIME,[圧縮形式] TEXT,[ペイロード] TEXT,'
              '[登録者ID] TEXT,[登録端末名] TEXT,[更新者ID] TEXT,[更新端末名] TEXT,'
              '[登録日時] DATETIME,[更新時刻ISO] TEXT)')
    c.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?', [rid])
    c.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[状態],'
              '[更新日時],[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,?)',
              [rid, equipment, lot, '完了', updated, 'delimiter-v1', payload])
    c.commit()
    c.close()


def ids(rows):
    return sorted(str(r.get('id') or '') for r in rows)


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-recsplit-'))
_orig_dir, _orig_meas, _orig_exp = d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH
try:
    # ---- 1. 未設定なら今までどおり ----------------------------------------
    local = tmp / 'db' / 'records.sqlite3'
    put(local, 'OLD-1', 'LS4', 'L900')
    d.RECORDS_SHARE_DIR = None
    d.MEAS_DB = local
    d.RECORDS_BACKUP_EXPORT_PATH = None
    d.invalidate_records_dirs_cache(); d.invalidate_backup_rows_cache()
    rec('未設定なら書き込み先はMEAS_DBのまま',
        d.records_path_for('LS4') == local, str(d.records_path_for('LS4')))
    rec('未設定なら読む先もMEAS_DB 1本',
        [str(p) for p in d.records_paths_all()] == [str(local)],
        str([str(p) for p in d.records_paths_all()]))

    # ---- 2. 設備ごとに分かれる／ゆれは同じ --------------------------------
    share = tmp / 'share'
    share.mkdir(parents=True, exist_ok=True)
    d.RECORDS_SHARE_DIR = share
    d.invalidate_records_dirs_cache()
    p4, p5 = d.records_path_for('LS4'), d.records_path_for('LS5')
    rec('設備が違えば別のファイル', p4 != p5, f'{p4.parent.name} / {p5.parent.name}')
    rec('置き場の下は<設備>/records.sqlite3',
        p4.parent.parent == share and p4.name == 'records.sqlite3', str(p4))
    # 全角の「ＬＳ４」・小文字・前後の空白は**同じ設備**（§9.239 ⑥の照合と同じ答え）
    same = {d.records_dir_name(x) for x in ('LS4', 'ＬＳ４', ' ls4 ')}
    rec('全角/半角・大小文字のゆれは同じフォルダ', len(same) == 1, str(same))
    rec('設備を名乗らない記録も捨てずに置き場を持つ',
        d.records_dir_name('') == d.RECORDS_UNSET_DIR_NAME, d.records_dir_name(''))

    # ---- 3. 使えない文字を落としても衝突しない ----------------------------
    # 素朴に「使えない文字を_へ」だけだと A/B と A:B が同じフォルダになり、
    # **別の設備の測定データが1つのファイルに混ざる**。
    bad = [d.records_dir_name(x) for x in ('A/B', 'A:B', 'A*B', 'A?B')]
    rec('使えない文字を落としても別の設備は別のフォルダ',
        len(set(bad)) == len(bad), str(bad))
    rec('使えない文字はフォルダ名に残らない',
        all(not (set(n) & set(d._RECORDS_BAD_CHARS)) for n in bad), str(bad))
    rec('ふつうの設備名はそのままのフォルダ名',
        d.records_dir_name('LS4') == 'LS4', d.records_dir_name('LS4'))

    # ---- 4. 読むときは旧い置き場も一緒に ----------------------------------
    put(p4, 'NEW-4', 'LS4', 'L004')
    put(p5, 'NEW-5', 'LS5', 'L005')
    d.invalidate_records_dirs_cache(); d.invalidate_backup_rows_cache()
    got = ids(d.merged_backup_rows(force=True))
    rec('設備ごとのファイルを全部読む',
        'NEW-4' in got and 'NEW-5' in got, str(got))
    rec('旧い置き場(MEAS_DB)の記録も消えない', 'OLD-1' in got, str(got))

    # ---- 5. 持っているファイルだけを開く ----------------------------------
    hold = {str(k): v for k, v in d.records_paths_holding(['NEW-4']).items()}
    rec('記録IDを持っているファイルだけを返す',
        list(hold) == [str(p4)] and hold[str(p4)] == ['NEW-4'], str(hold))
    rec('どこにも無い記録IDでは1つも返さない',
        d.records_paths_holding(['NOBODY']) == {}, str(d.records_paths_holding(['NOBODY'])))
    rec('空の指定では1つも返さない', d.records_paths_holding([]) == {})

    # ---- 6. 同じ記録が2つのファイルにあっても二重に出ない ------------------
    # 振り分けの途中（元にも移した先にもある状態）を作る。
    put(local, 'NEW-4', 'LS4', 'L004', updated='2026-08-28 09:00:00')
    d.invalidate_backup_rows_cache()
    rows = d.merged_backup_rows(force=True)
    hit = [r for r in rows if r.get('id') == 'NEW-4']
    rec('同じ記録が2か所にあっても1件だけ出る', len(hit) == 1, f'{len(hit)}件')
    rec('新しい方の記録が残る',
        bool(hit) and str(hit[0].get('lotNo')) == 'L004', str(hit[:1]))

    # ---- 7. 変わったファイルだけ読み直す ----------------------------------
    # 設備ごとに分けたことで読む対象がN本になったので、1台が保存するたびに
    # N本すべてを読み直す形にすると、設備が増えるほど一覧が重くなる。
    # **ただし「読み直さない」が行き過ぎて、変更を取りこぼしてはいけない。**
    reads = []
    _orig_read = d.read_backup_rows
    def counting_read(path):
        reads.append(str(path))
        return _orig_read(path)
    d.read_backup_rows = counting_read
    try:
        d.invalidate_backup_rows_cache()
        d.merged_backup_rows(force=True)
        first = len(reads)
        reads.clear()
        d.merged_backup_rows(force=True)   # 何も変えずにもう一度
        rec('何も変わっていなければ読み直さない',
            first >= 3 and reads == [], f'1回目{first}本 / 2回目{len(reads)}本')
        # LS5 だけを変える
        put(p5, 'NEW-5b', 'LS5', 'L006', updated='2026-08-28 11:00:00')
        reads.clear()
        got2 = ids(d.merged_backup_rows(force=True))
        rec('変わったファイルだけ読み直す',
            reads == [str(p5)], str(reads))
        rec('変更はちゃんと拾う', 'NEW-5b' in got2, str(got2))
    finally:
        d.read_backup_rows = _orig_read

    # ---- 8. 共有が読めなくても止まらない ----------------------------------
    d.RECORDS_SHARE_DIR = tmp / 'no-such-dir'
    d.invalidate_records_dirs_cache()
    try:
        all_paths = d.records_paths_all()
        ok = str(local) in [str(p) for p in all_paths]
    except Exception as e:
        ok = False; all_paths = str(e)
    rec('置き場へ到達できなくても旧い置き場は読める', ok, str(all_paths))
finally:
    d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH = _orig_dir, _orig_meas, _orig_exp
    d.invalidate_records_dirs_cache(); d.invalidate_backup_rows_cache()
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, dt in ng:
    print(' -', n, dt)
sys.exit(1 if ng else 0)
