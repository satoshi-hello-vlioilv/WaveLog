#!/usr/bin/env python3
"""test_recfresh.py: 別の PC が完了した測定データは、この PC で一覧を開いたその時に届く（§9.618）。

============================================================
利用者の報告
------------------------------------------------------------
「測定データ一覧の部分で、『完了』タブを押したときに出るはずの完了ロットが測定したPC以外で見ることが
 できない。なぜか編集中のデータについては他のPCでも見ることができるのに、完了するとみられなくなります」。

原因: 他の PC が書く共有の測定データは**手元の写し**から読む（§9.268・§9.582）。写しを取り直すのは裏の係の
周回（既定60秒）だけで、一覧を開いたとき（`merged_backup_rows()`）は係を起こすだけで待たず、前の写しで
答えていた。編集中は保存が続くので遅れが目立たないが、**完了は最後の1回**——完了した直後に一覧を開くと
前の写しの「編集中」で答え、完了の一覧に出なかった（開き直しても20秒の覚えと周回の間隔ぶん古いまま）。

物差し（評価関数）: 写しの係を動かしたまま（周回は来ない間隔にして）、別の PC が共有へ書いた記録を
この PC の一覧の口が**開いたその時**に返すかを数える。
 F1. 別の PC が「編集中」を書いた → 一覧に「編集中」で出る
 F2. 同じ記録を別の PC が「完了」にした直後に開く → 一覧（編集モードの見出し）は「完了」で出す
 F3. 閲覧・スケジュールモードの一覧も「完了」（中身の状態も完了）
 F4. 1件を開く口（backup/get）も完了の中身を返す
 F5. 新しい設備のフォルダへの初めての保存が通る（以前は表を作った直後に列が足りず 500 だった）
============================================================
"""
import json
import pathlib
import shutil
import sqlite3
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app  # noqa: E402 パスを通してから読む
from backend import db_access as d  # noqa: E402
from backend import db_mirror as m  # noqa: E402

R = []
RID = 'LS4|L9|K9|C9'


def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


def other_pc_writes(path, status, at):
    """別の PC の保存と同じ形（1記録1行・消してから入れ直す）。この端末は書いていない＝写しから読む側。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    try:
        d.ensure_backup_table(c)
        c.execute('DELETE FROM [Web測定バックアップ] WHERE [記録ID]=?', (RID,))
        payload = json.dumps({'id': RID, 'status': status, 'basic': {'lotNo': 'L9'}, 'measurements': {}})
        c.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],'
                  '[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,?,?,?)',
                  (RID, 'LS4', 'L9', 'K9', 'C9', status, at, 'json-full-v32', payload))
        c.commit()
    finally:
        c.close()


def state_in(items):
    hit = [x for x in items or [] if x.get('id') == RID]
    return hit[0].get('status') if hit else '（無い）'


share = pathlib.Path(tempfile.mkdtemp(prefix='wl-recfresh-share-'))
work = pathlib.Path(tempfile.mkdtemp(prefix='wl-recfresh-work-'))
orig = (d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH, set(d._records_written_here))
orig_cache_dir, orig_interval = m.cache_dir, m.interval_sec
client = flask_app.app.test_client()
try:
    d.RECORDS_SHARE_DIR = share
    d.MEAS_DB = work / 'records.sqlite3'
    d.RECORDS_BACKUP_EXPORT_PATH = None
    d._records_written_here.clear()
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir = lambda: work / 'mirror'
    src = share / 'LS4' / 'records.sqlite3'
    other_pc_writes(src, '編集中', '2026-10-22 09:00:00')
    # 写しの係は動かす（本番と同じ）。周回は来ない間隔にして「一覧を開いた時」だけを見る。
    m.interval_sec = lambda: 3600
    m.start()
    s1 = client.get('/api/measurement/backup/summary').get_json() or {}
    rec('F1. 別の PC が書いた「編集中」が一覧に出る', state_in(s1.get('items')) == '編集中', state_in(s1.get('items')))

    time.sleep(1.1)  # 元ファイルの更新時刻が変わる幅をあける（同じ秒・同じ大きさだと署名で区別できない）
    other_pc_writes(src, '完了', '2026-10-22 09:05:00')
    t0 = time.time()
    s2 = client.get('/api/measurement/backup/summary').get_json() or {}
    lag = time.time() - t0
    rec('F2. 別の PC が完了にした直後に開いた一覧（編集モード）は「完了」で出す',
        state_in(s2.get('items')) == '完了', f'{state_in(s2.get("items"))}（応答 {lag:.2f}秒）')
    s3 = client.get('/api/measurement/backup/list-view').get_json() or {}
    hit = [x for x in s3.get('items') or [] if x.get('id') == RID]
    body = json.loads(hit[0]['payload']).get('status') if hit else ''
    rec('F3. 閲覧・スケジュールモードの一覧も「完了」（中身の状態も完了）',
        state_in(s3.get('items')) == '完了' and body == '完了', f'{state_in(s3.get("items"))} / 中身 {body}')
    s4 = client.get('/api/measurement/backup/get?id=' + RID).get_json() or {}
    got = json.loads((s4.get('item') or {}).get('payload') or '{}').get('status')
    rec('F4. 1件を開く口も完了の中身を返す', got == '完了', str(got))

    # F5. 新しい設備のフォルダへの初めての保存（この端末が書く側）。
    fresh = {'id': 'LS7|L1|K1|C1', 'equipment': 'LS7', 'lotNo': 'L1', 'inspectionNo': 'K1', 'castingNo': 'C1',
             'status': '編集中', 'codec': 'json-full-v32', 'payload': json.dumps({'id': 'LS7|L1|K1|C1'}),
             'updated_at_iso': '2026-10-22T00:00:00.000Z'}
    client.post('/api/access-mode', json={'mode': 'edit'})
    r5 = client.post('/api/measurement/backup', json=fresh)
    rec('F5. 新しい設備のフォルダへの初めての保存が通る', r5.status_code == 200,
        f'{r5.status_code} {(r5.get_json() or {}).get("error", "")}')
finally:
    d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH = orig[0], orig[1], orig[2]
    d._records_written_here.clear()
    d._records_written_here.update(orig[3])
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir, m.interval_sec = orig_cache_dir, orig_interval
    shutil.rmtree(share, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)

fails = [r for r in R if not r[1]]
print(f'=== SUMMARY === {len(R) - len(fails)}/{len(R)} PASS')
sys.exit(1 if fails else 0)
