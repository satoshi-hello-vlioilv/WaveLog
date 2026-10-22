#!/usr/bin/env python3
"""test_reccopyreason.py: 別の PC の測定データを写せないとき、理由が共通設定の「置き場」とログに出る（§9.619）。

============================================================
利用者の報告
------------------------------------------------------------
「測定したPCからは完了データがみられるのに、そのPC以外からは見られない」。画面（測定データの保存）は
「写し1本 / この端末が書く1本 / まだ写せていない1本」と**本数だけ**を言い、どのファイルがなぜ写せないかは
どこにも出ていなかった。写せないときに共有を直接読まない安全策（docs/SHARED_READ.md の R8）は外さない
（利用者の指示）。だから**理由を見えるところへ出し、その場で写し直せる**ようにする。

物差し（評価関数）: 別の PC が書いた共有のファイルを写せない場面を4つ作り、場面ごとに
 R1. 共通設定の置き場の答え（/api/storage-layout の「測定データ（共有）」の行）に、そのファイルの設備と理由が出るか
     （理由は元の字と、種類・人の言葉・次の一手＝`db_mirror.explain()`）
 R2. ログ（app_logger）に理由が1行残るか（同じ理由を繰り返し書かない）
を数える。理由が出ない場面の数＝0 が正。
 場面: ①書き手の印（-journal）が残っている ②写した物が SQLite として読めない ③共有の元ファイルが無い（届かない）
       ④写せた（理由は無く「写し」と出る）
 R3. 「写し直す」の口（POST /api/measurement/records/recopy）が手動の設定でも写し直し、結果の行を返す
 R4. 印を片付けたあと「写し直す」で写せ、一覧（summary）に完了の記録が入る
 R5. `-journal`が元ごと同じ形のまま`STALE_MARK_SEC`残ったら、書き手は作業中でないとみて写す（理由はログに1行）
 R6. `-journal`が動いている（書き手が書いている）あいだは見送り続ける
============================================================
"""
import json
import logging
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
from backend.logging_setup import app_logger  # noqa: E402

R = []


def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


class Keep(logging.Handler):
    def __init__(self):
        super().__init__(logging.INFO)
        self.lines = []

    def emit(self, r):
        self.lines.append(r.getMessage())


def other_pc_writes(path, rid, status):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    try:
        d.ensure_backup_table(c)
        payload = json.dumps({'id': rid, 'status': status, 'basic': {'lotNo': rid}, 'measurements': {}})
        c.execute('INSERT INTO [Web測定バックアップ] ([記録ID],[設備],[ロット番号],[検査番号],[鋳造番号],[状態],[更新日時],'
                  '[圧縮形式],[ペイロード]) VALUES (?,?,?,?,?,?,?,?,?)',
                  (rid, path.parent.name, rid, 'K', 'C', status, '2026-10-22 09:00:00', 'json-full-v32', payload))
        c.commit()
    finally:
        c.close()


def share_row(client):
    lay = client.get('/api/storage-layout').get_json() or {}
    return next((x for x in lay.get('items') or [] if x.get('key') == 'recordsShare'), {}) or {}


def file_of(row, eq):
    return next((f for f in row.get('files') or [] if f.get('equipment') == eq), None)


share = pathlib.Path(tempfile.mkdtemp(prefix='wl-reccopy-share-'))
work = pathlib.Path(tempfile.mkdtemp(prefix='wl-reccopy-work-'))
orig = (d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH, set(d._records_written_here))
orig_cache_dir, orig_mode = m.cache_dir, m.update_mode
keep = Keep()
app_logger().addHandler(keep)
client = flask_app.app.test_client()
try:
    d.RECORDS_SHARE_DIR = share
    d.MEAS_DB = work / 'records.sqlite3'
    d.RECORDS_BACKUP_EXPORT_PATH = None
    d._records_written_here.clear()
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir = lambda: work / 'mirror'
    # ① 書き手の印が残っている
    other_pc_writes(share / 'LSJ' / 'records.sqlite3', 'J1', '完了')
    (share / 'LSJ' / 'records.sqlite3-journal').write_bytes(b'')
    # ② 写した物が SQLite として読めない
    (share / 'LSB').mkdir()
    (share / 'LSB' / 'records.sqlite3').write_bytes(b'not a database' * 100)
    # ④ 写せる
    other_pc_writes(share / 'LSO' / 'records.sqlite3', 'O1', '完了')
    # ③ 一覧には見えたのに元ファイルに届かない（並べた後に消える＝共有が途切れた場面）
    other_pc_writes(share / 'LSU' / 'records.sqlite3', 'U1', '完了')
    d.invalidate_records_dirs_cache()
    d.records_paths_all()   # 置き場の並びを控えてから消す
    (share / 'LSU' / 'records.sqlite3').unlink()
    # 係のいない呼び出し（網）は読むときにその場で写す。3回読んでも理由のログは1行のまま。
    for _ in range(3):
        d.records_read_plan()

    row = share_row(client)
    cases = [('①書き手の印が残っている', 'LSJ', r'journal|書き手', 'busy'), ('②SQLiteとして読めない', 'LSB', r'正しくない|開けません|読めません', 'broken'),
             ('③元ファイルに届かない', 'LSU', r'到達|届か|見つから', 'unreachable')]
    import re
    shown = logged = 0
    for name, eq, pat, kind in cases:
        f = file_of(row, eq)
        ok1 = bool(f and f.get('state') == 'waiting' and re.search(pat, f.get('reason') or '')
                   and (f.get('why') or {}).get('kind') == kind and (f.get('why') or {}).get('say'))
        shown += ok1
        rec(f'R1. {name}: 置き場の行にその設備と理由が出る', ok1, json.dumps(f, ensure_ascii=False)[:200] if f else '（行に無い）')
        hits = [x for x in keep.lines if eq in x and re.search(pat, x)]
        logged += bool(hits)
        rec(f'R2. {name}: ログに理由が残る（繰り返さない）', len(hits) == 1, f'{len(hits)}行')
    fo = file_of(row, 'LSO')
    rec('R1. ④写せた: 「写し」と出て理由は無い', bool(fo and fo.get('state') == 'copied' and not fo.get('reason')),
        json.dumps(fo, ensure_ascii=False)[:200] if fo else '（行に無い）')
    print(f'MEASURE: 理由が置き場に出た {shown}/3・ログに残った {logged}/3')

    # R5・R6. 残ったままの印（同じ形）は写す・動いている印は見送る。待つ長さはこの網だけ縮める。
    import time
    orig_stale = m.STALE_MARK_SEC
    m.STALE_MARK_SEC = 0.3
    try:
        other_pc_writes(share / 'LSS' / 'records.sqlite3', 'S1', '完了')
        (share / 'LSS' / 'records.sqlite3-journal').write_bytes(b'')
        other_pc_writes(share / 'LSM' / 'records.sqlite3', 'M1', '完了')
        jm = share / 'LSM' / 'records.sqlite3-journal'
        jm.write_bytes(b'')
        d.invalidate_records_dirs_cache()
        lines0 = len(keep.lines)
        for i in range(4):
            jm.write_bytes(b'x' * (i + 1))   # 書き手が書いている＝印の形が動く
            d.records_read_plan()
            time.sleep(0.15)
        row = share_row(client)
        fs, fm = file_of(row, 'LSS'), file_of(row, 'LSM')
        noted = [x for x in keep.lines[lines0:] if 'LSS' in x and '作業中でない' in x]
        rec('R5. 同じ形のまま残った -journal は、書き手は作業中でないとみて写す（ログに1行）',
            bool(fs and fs.get('state') == 'copied') and len(noted) == 1, f'{json.dumps(fs, ensure_ascii=False)[:160]} / ログ{len(noted)}行')
        rec('R6. 動いている -journal のあいだは見送り続ける', bool(fm and fm.get('state') == 'waiting'),
            json.dumps(fm, ensure_ascii=False)[:160] if fm else '（行に無い）')
    finally:
        m.STALE_MARK_SEC = orig_stale

    # R3・R4. 印を片付けて、手動の設定のまま「写し直す」
    (share / 'LSJ' / 'records.sqlite3-journal').unlink()
    m.update_mode = lambda: 'manual'
    client.post('/api/access-mode', json={'mode': 'edit'})
    r = client.post('/api/measurement/records/recopy', json={})
    body = r.get_json() or {}
    fj = next((f for f in body.get('files') or [] if f.get('equipment') == 'LSJ'), None)
    rec('R3. 「写し直す」は手動の設定でも写し直し、結果の行を返す', r.status_code == 200 and bool(fj and fj.get('state') == 'copied'),
        f'{r.status_code} {json.dumps(fj, ensure_ascii=False)[:160] if fj else body}')
    items = (client.get('/api/measurement/backup/summary').get_json() or {}).get('items') or []
    rec('R4. 写し直したあと、一覧に別の PC の完了の記録が入る', any(x.get('id') == 'J1' and x.get('status') == '完了' for x in items),
        str([x.get('id') for x in items]))
finally:
    app_logger().removeHandler(keep)
    d.RECORDS_SHARE_DIR, d.MEAS_DB, d.RECORDS_BACKUP_EXPORT_PATH = orig[0], orig[1], orig[2]
    d._records_written_here.clear()
    d._records_written_here.update(orig[3])
    d.invalidate_records_dirs_cache()
    d.invalidate_backup_rows_cache()
    m.cache_dir, m.update_mode = orig_cache_dir, orig_mode
    shutil.rmtree(share, ignore_errors=True)
    shutil.rmtree(work, ignore_errors=True)

fails = [r for r in R if not r[1]]
print(f'=== SUMMARY === {len(R) - len(fails)}/{len(R)} PASS')
sys.exit(1 if fails else 0)
