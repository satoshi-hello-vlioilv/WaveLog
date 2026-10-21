#!/usr/bin/env python3
"""test_recshare.py: 完了した測定データはどの PC のどのモードの一覧にも届く（§9.616）。

============================================================
利用者の報告
------------------------------------------------------------
「測定完了済みのデータに関して、全PCで見られるようにしてください。自動的に同期されておらず、
 測定したそのPCでしか閲覧できないような状態になっている」。

物差し（評価関数）: 共有の置き場（設備ごとのフォルダ）に**別の PC が書いた完了**を1件置き、
各モードの一覧の口がそれを返すかを数える。返さない口の数が 0 が正。
 S1. 編集モードの一覧の見出し（`/api/measurement/backup/summary`）
 S2. 閲覧・スケジュールモードの一覧（`/api/measurement/backup/list-view`）——以前は役目を終えた
     「閲覧用の複製」1本だけを読み、共有の置き場を決めると（複製は止まる）他の PC の完了が届かなかった
 S3. 一覧は「他の PC の分も入っているか」を答える（`shared`）——置き場が未設定のとき、
     この端末の分だけなのに「共有DBの測定データ」と名乗らない
============================================================
"""
import json
import pathlib
import shutil
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app  # noqa: E402 パスを通してから読む
from backend import db_access as d  # noqa: E402
from backend import db_mirror as m  # noqa: E402

R = []


def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


def seed(path, rid, eq, status):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    c.execute('CREATE TABLE IF NOT EXISTS [Web測定バックアップ] '
              '([記録ID] TEXT,[設備] TEXT,[ロット番号] TEXT,[検査番号] TEXT,'
              '[鋳造番号] TEXT,[状態] TEXT,[更新日時] DATETIME,[圧縮形式] TEXT,[ペイロード] TEXT)')
    payload = json.dumps({'id': rid, 'status': status, 'basic': {'lotNo': 'L1'}, 'measurements': {}})
    c.execute('INSERT INTO [Web測定バックアップ] VALUES (?,?,?,?,?,?,?,?,?)',
              (rid, eq, 'L1', 'K1', 'C1', status, '2026-10-21 09:00:00', 'json-full-v32', payload))
    c.commit()
    c.close()


share = pathlib.Path(tempfile.mkdtemp(prefix='wl-recshare-share-'))
work = pathlib.Path(tempfile.mkdtemp(prefix='wl-recshare-work-'))
orig = (d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH, set(d._records_written_here))
_orig_cache_dir = m.cache_dir
client = flask_app.app.test_client()
try:
    # 別の PC（設備 LS4）が共有へ書いた完了。この端末（設備 LS5）の手元には何も無い。
    seed(share / 'LS4' / 'records.sqlite3', 'LS4|L1|K1|C1', 'LS4', '完了')
    d.RECORDS_SHARE_DIR = share
    d.MEAS_DB = work / 'records.sqlite3'
    d.RECORDS_BACKUP_EXPORT_PATH = None
    d._records_written_here.clear()
    d.invalidate_records_dirs_cache()
    m.cache_dir = lambda: work / 'mirror'
    d.invalidate_backup_rows_cache()

    s1 = client.get('/api/measurement/backup/summary').get_json() or {}
    ids1 = [x.get('id') for x in s1.get('items') or []]
    rec('S1. 編集モードの一覧の見出しに別の PC の完了が届く', 'LS4|L1|K1|C1' in ids1, str(ids1))

    d.invalidate_backup_rows_cache()
    s2 = client.get('/api/measurement/backup/list-view').get_json() or {}
    items2 = s2.get('items') or []
    hit = [x for x in items2 if x.get('id') == 'LS4|L1|K1|C1']
    rec('S2. 閲覧・スケジュールモードの一覧にも別の PC の完了が届く（中身つき）',
        bool(hit) and hit[0].get('status') == '完了' and bool(hit[0].get('payload')),
        json.dumps({k: s2.get(k) for k in ('configured', 'count', 'error')}, ensure_ascii=False))
    rec('S3a. 置き場があれば一覧は「他の PC の分も入っている」と答える',
        s1.get('shared') is True and s2.get('shared') is True,
        str({'summary': s1.get('shared'), 'listView': s2.get('shared')}))

    # 置き場が未設定 → この端末の分だけ。名乗りもそう言う。
    d.RECORDS_SHARE_DIR = None
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    s1b = client.get('/api/measurement/backup/summary').get_json() or {}
    s2b = client.get('/api/measurement/backup/list-view').get_json() or {}
    rec('S3b. 置き場が未設定なら一覧は「この端末の分だけ」と答える（共有と名乗らない）',
        s1b.get('shared') is False and s2b.get('shared') is False,
        str({'summary': s1b.get('shared'), 'listView': s2b.get('shared')}))
finally:
    d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH = orig[0], orig[1], orig[2]
    d._records_written_here.clear()
    d._records_written_here.update(orig[3])
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir = _orig_cache_dir
    shutil.rmtree(share, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)

fails = [r for r in R if not r[1]]
print(f'=== SUMMARY === {len(R) - len(fails)}/{len(R)} PASS')
sys.exit(1 if fails else 0)
