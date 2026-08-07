#!/usr/bin/env python3
"""test_datasource.py: データソースマスタ（§9.79）。

============================================================
なぜ要るか
------------------------------------------------------------
参照データは「RNEから抽出 → .sqlite3 を作る → それを一覧として読む」と
いう1本の流れでしか増えない。ところが以前、その流れは3箇所に分かれて
ハードコードされていた。

  何を抽出するか  rne_scheduler.JOBS
  どこへ書くか    JOBS[].output
  どこを読むか    db_access.DBS[].path

増やすには両方を直す必要があり、しかも**別々に書ける**ため
「抽出しているのに読まない」設定が作れてしまった。1行=1データソースに
まとめ、作る側と読む側が必ず同じ行に並ぶようにしたのがこの変更。

ここで固定するのは4つ。
 1. マスタが唯一の定義場所であること（DBSも抽出ジョブもここから作られる）
 2. 既存の2件は今までどおり（初回に種を入れ、読み込み先が変わらない）
 3. 増やせること（登録すると一覧にも抽出対象にも現れる）
 4. 壊れた入力を弾くこと（キーの形式・予約語）
============================================================
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app                       # noqa: E402
from backend import db_access, rne_scheduler  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

client = flask_app.app.test_client()
KEY = 'PROBE_DS'


def sources():
    return client.get('/api/data-source-master').get_json() or {}


# ---- 1) マスタが唯一の定義場所 ----
d = sources()
rec('データソースの一覧を取得できる', d.get('ok') is True and len(d.get('items', [])) >= 2,
    f"{len(d.get('items', []))}件")
keys = [x['key'] for x in d.get('items', [])]
rec('既定の2件が入っている（初回の種）', 'SIKALOTNOW' in keys and 'SIKALOTDEF' in keys, '/'.join(keys))

# DBS はマスタから作られる（MASTER 自身を除く）
db_keys = [k for k in db_access.DBS if k != 'MASTER']
src_keys = [s['key'] for s in db_access.DATA_SOURCES]
rec('一覧(DBS)はデータソースマスタから作られる', sorted(db_keys) == sorted(src_keys),
    f'DBS={sorted(db_keys)} / マスタ={sorted(src_keys)}')

# 抽出ジョブも同じ出どころ
job_names = [j['name'] for j in rne_scheduler.jobs()]
rec('抽出ジョブも同じマスタから作られる',
    sorted(job_names) == sorted([s['key'] for s in db_access.DATA_SOURCES if s.get('rne')]),
    '/'.join(job_names))

# ---- 2) 既存の2件は今までどおり ----
# 抽出先(ジョブのoutput)と、ローカル運用で読む先が同じであること。
# ここがずれると「抽出しているのに読まない」が復活する。
for job in rne_scheduler.jobs():
    src = next((s for s in db_access.DATA_SOURCES if s['key'] == job['name']), None)
    same = src is not None and job['output'] == str(rne_scheduler._output_path(src))
    rec(f'{job["name"]}: 抽出先と出力ファイルの解決が一致する', same, job['output'])

# ---- 3) 増やせる ----
r = client.post('/api/data-source-master', json={
    'key': KEY, 'label': '検証ソース', 'rne': 'PROBE.RNE', 'table': '仕掛',
    'output': 'probe_ds.sqlite3', 'share': 'PROBE.sqlite3', 'preferred': '仕掛',
    'order': 900, 'user_id': 'test'})
rec('新しいデータソースを登録できる', r.status_code == 200 and (r.get_json() or {}).get('ok'),
    str(r.get_json())[:80])
after = sources()
row = next((x for x in after.get('items', []) if x['key'] == KEY), None)
rec('登録したものが一覧に出る', row is not None)
if row:
    # 設定と実態のずれ（資材が無い・まだ作られていない）が一目で分かること
    rec('RNEが置いてあるかを一覧で示す', 'rneExists' in row, f"rneExists={row.get('rneExists')}")
    rec('出力ファイルが出来ているかを一覧で示す', 'outputExists' in row,
        f"outputExists={row.get('outputExists')}")
    rec('いまどこを読んでいるかを一覧で示す', 'activePath' in row)
    rec('出力ファイルはファイル名だけでもdb/配下へ解決される',
        row.get('outputPath', '').replace('\\', '/').endswith('db/probe_ds.sqlite3'),
        row.get('outputPath', ''))

# 更新（同じキーで上書き。行が増えない）
before_n = len(after.get('items', []))
r = client.post('/api/data-source-master', json={'key': KEY, 'label': '検証ソース2', 'user_id': 'test'})
again = sources()
rec('同じキーで保存すると更新になる（増えない）',
    len(again.get('items', [])) == before_n
    and (next((x for x in again['items'] if x['key'] == KEY), {}) or {}).get('label') == '検証ソース2',
    f"{before_n}→{len(again.get('items', []))}")

# ---- 4) 壊れた入力を弾く ----
r = client.post('/api/data-source-master', json={'key': 'bad key!', 'label': 'x', 'user_id': 'test'})
rec('キーの形式が不正なら断る', r.status_code == 400, str(r.get_json())[:70])
r = client.post('/api/data-source-master', json={'key': 'MASTER', 'label': 'x', 'user_id': 'test'})
rec('MASTER は予約語として断る', r.status_code == 400, str(r.get_json())[:70])

# 削除は無効化（履歴を残す）
r = client.post('/api/data-source-master/delete', json={'key': KEY, 'user_id': 'test'})
rec('削除できる', r.status_code == 200)
row = next((x for x in sources().get('items', []) if x['key'] == KEY), None)
rec('削除は無効化で、記録は残る', row is not None and row.get('active') is False,
    f"active={row.get('active') if row else 'なし'}")

# ---- 5) RNE資材・接続情報の場所を設定できる ----
pc = client.get('/api/path-config-master').get_json() or {}
rec('パス設定にRNE資材の置き場がある', 'rne_assets_dir' in (pc.get('values') or {}))
rec('パス設定にsymnavim.confの場所がある', 'rne_conf_path' in (pc.get('values') or {}))
client.post('/api/path-config-master', json={'rne_assets_dir': '/tmp/wavelog_probe_assets',
                                             'rne_conf_path': '/tmp/wavelog_probe/symnavim.conf',
                                             'user_id': 'test'})
rec('資材の置き場が保存後すぐ効く（再起動不要）',
    str(rne_scheduler.assets_dir()) == '/tmp/wavelog_probe_assets', str(rne_scheduler.assets_dir()))
rec('symnavim.confの場所も保存後すぐ効く',
    str(rne_scheduler.conf_path()) == '/tmp/wavelog_probe/symnavim.conf', str(rne_scheduler.conf_path()))
rec('RNEファイルは資材の置き場のrne/配下として解決される',
    str(rne_scheduler.rne_path('X.RNE')) == '/tmp/wavelog_probe_assets/rne/X.RNE',
    str(rne_scheduler.rne_path('X.RNE')))
rec('絶対パスのRNEはそのまま使う',
    str(rne_scheduler.rne_path('/tmp/abs/Y.RNE')) == '/tmp/abs/Y.RNE')
# 空欄で既定へ戻す（他のパス設定と同じ互換ポリシー）
client.post('/api/path-config-master', json={'rne_assets_dir': '', 'rne_conf_path': '', 'user_id': 'test'})
rec('空欄で保存すると既定へ戻る',
    str(rne_scheduler.assets_dir()).endswith('config/rne_extract'), str(rne_scheduler.assets_dir()))

# ---- 6) 抽出は一覧に無いものを走らせない ----
rec('RNE未設定のデータソースは抽出対象にならない',
    all(j.get('rne') for j in rne_scheduler.jobs()))

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
