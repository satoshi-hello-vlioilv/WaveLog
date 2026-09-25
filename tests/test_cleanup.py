#!/usr/bin/env python3
"""test_cleanup.py: 不要ファイルの掃除（§9.249 ①）。

============================================================
なぜ要るか
------------------------------------------------------------
「掃除」は**消す道具**なので、網が守るのは「消えること」より先に
**消してはいけないものが対象に入っていないこと**。

固定するのは6つ。
 1. 本物のデータ（master.sqlite3 / records.sqlite3 / 共有スケジュール）が
    **どの種別にも1件も出てこない**
 2. いま読んでいる写しの世代・いま書いているログは**残す理由つきで残る**
 3. 一時ファイルは**若いうちは触らない**（書いている最中かもしれない）
 4. `dry_run`は数えるだけで消さない（押す前の下見・§9.193）
 5. 自動掃除の対象は`auto=True`の種別だけ（バイトコードを勝手に消さない）
 6. 決まり（間隔・世代・日数）に下限が効く

**材料は自分で注ぎ込む**——実行環境に古い世代やログが在る保証は無く、
「無ければ素通り」の書き方だと**直す前でも通る**（CLAUDE.md の繰り返しの
教訓）。ここでは置き場を丸ごと差し替えて、確かめたい形を自分で作る。
============================================================
"""
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import file_cleanup  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def touch(path, size=16, age_days=0.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'x' * size)
    if age_days:
        t = time.time() - age_days * 86400
        os.utime(path, (t, t))
    return path


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_cleanup_'))
cache = tmp / 'cache'
logs = tmp / 'logs'
backup = tmp / 'backup' / 'rne_extract'
work = tmp / 'work'
dbdir = tmp / 'db'
for d in (cache, logs, backup, work, dbdir):
    d.mkdir(parents=True, exist_ok=True)

# ---- 材料を注ぎ込む -------------------------------------------------
# 写し: 3世代。台帳が g3 を指しているので g3 だけが残るのが正しい。
for gen in (1, 2, 3):
    touch(cache / f'SIKALOTNOW.g{gen}.sqlite3', 1000 * gen, age_days=10 - gen)
(cache / '_mirror.json').write_text(
    json.dumps({'SIKALOTNOW': {'signature': {}, 'file': 'SIKALOTNOW.g3.sqlite3'}}),
    encoding='utf-8')
# 一時ファイル: 古いものと、たった今できたもの。
touch(cache / 'SIKALOTNOW.sqlite3.tmp', 500, age_days=1)
touch(cache / 'fresh.sqlite3.tmp', 500)
# ログ: いま書いているものと、世代送りしたもの5本。
touch(logs / 'app.log', 800)
for i in range(1, 6):
    touch(logs / f'app.log.{i}', 100 * i, age_days=i * 10)
# RNE の控え: 5世代。
for i in range(5):
    touch(backup / 'sikalotnow' / f'sikalotnow_2026010{i}_000000.sqlite3', 300, age_days=30 + i)
# 本物のデータ（**掃除の対象に出てはいけない**）。
touch(dbdir / 'master.sqlite3', 4096)
touch(dbdir / 'records.sqlite3', 4096)
touch(dbdir / 'schedule.sqlite3', 4096)

_real = {}


def patch():
    _real['cache'] = file_cleanup._cache_dir
    _real['logs'] = file_cleanup._logs_dir
    _real['backup'] = file_cleanup._rne_backup_dir
    _real['work'] = file_cleanup._work_dir
    _real['db'] = file_cleanup._db_dir
    _real['pycache'] = file_cleanup._pycache_dir
    _real['root'] = file_cleanup._local_root
    _real['cfg'] = file_cleanup._cfg
    file_cleanup._cache_dir = lambda: cache
    file_cleanup._logs_dir = lambda: logs
    file_cleanup._rne_backup_dir = lambda: backup
    file_cleanup._work_dir = lambda: work
    file_cleanup._db_dir = lambda: dbdir
    file_cleanup._pycache_dir = lambda: tmp / 'pycache'
    file_cleanup._local_root = lambda: tmp
    # 決まりは既定のまま（保存済みの設定に左右されない網にする）。
    file_cleanup._cfg = lambda key, default: default


def unpatch():
    file_cleanup._cache_dir = _real['cache']
    file_cleanup._logs_dir = _real['logs']
    file_cleanup._rne_backup_dir = _real['backup']
    file_cleanup._work_dir = _real['work']
    file_cleanup._db_dir = _real['db']
    file_cleanup._pycache_dir = _real['pycache']
    file_cleanup._local_root = _real['root']
    file_cleanup._cfg = _real['cfg']


try:
    patch()
    # 台帳は db_mirror 経由で読むので、そちらの置き場も同じところへ向ける。
    from backend import db_mirror
    _real_mirror_cache = db_mirror.cache_dir
    db_mirror.cache_dir = lambda: cache

    d = file_cleanup.survey()
    by = {c['key']: c for c in d['categories']}

    # ---- 1) 本物のデータが対象に出てこない ----
    names = set()
    for cat in file_cleanup.CATEGORIES:
        for it in (cat['scan']() or []):
            names.add(pathlib.Path(it['path']).name)
    holy = {'master.sqlite3', 'records.sqlite3', 'schedule.sqlite3'}
    rec('本物のデータ(master/records/共有スケジュール)がどの種別にも出てこない',
        not (names & holy), f'見えたもの: {sorted(names & holy)}')

    # ---- 2) いま読んでいる世代・いま書いているログは残る ----
    mir = {pathlib.Path(i['path']).name: i for i in file_cleanup._scan_mirror()}
    rec('いま読んでいる写しの世代は残す（理由つき）',
        bool(mir.get('SIKALOTNOW.g3.sqlite3', {}).get('keep')),
        str(mir.get('SIKALOTNOW.g3.sqlite3')))
    rec('古い写しの世代は消す対象になる',
        not mir.get('SIKALOTNOW.g1.sqlite3', {}).get('keep')
        and not mir.get('SIKALOTNOW.g2.sqlite3', {}).get('keep'),
        f"g1={mir.get('SIKALOTNOW.g1.sqlite3',{}).get('keep')!r}")
    # **切り替えたばかりの世代には触らない**——台帳が次を指した後も、開いたまま
    # 読み終えていない画面がある(§9.108)。若い世代を1つ注ぎ込んで確かめる。
    touch(cache / 'SIKALOTNOW.g4.sqlite3', 900)
    fresh = {pathlib.Path(i['path']).name: i for i in file_cleanup._scan_mirror()}
    rec('切り替えたばかりの世代には触らない',
        bool(fresh.get('SIKALOTNOW.g4.sqlite3', {}).get('keep')),
        str(fresh.get('SIKALOTNOW.g4.sqlite3')))
    lg = {pathlib.Path(i['path']).name: i for i in file_cleanup._scan_logs()}
    rec('いま書いているログは残す', bool(lg.get('app.log', {}).get('keep')),
        str(lg.get('app.log')))
    rec('新しい3世代のログは残し、それより古い世代だけを消す',
        bool(lg.get('app.log.1', {}).get('keep')) and not lg.get('app.log.5', {}).get('keep'),
        f"1={lg.get('app.log.1',{}).get('keep')!r} 5={lg.get('app.log.5',{}).get('keep')!r}")

    # ---- 3) 一時ファイルは若いうちは触らない ----
    tm = {pathlib.Path(i['path']).name: i for i in file_cleanup._scan_tmp()}
    rec('できたばかりの一時ファイルには触らない',
        bool(tm.get('fresh.sqlite3.tmp', {}).get('keep')), str(tm.get('fresh.sqlite3.tmp')))
    rec('古い一時ファイルは消す対象になる',
        'SIKALOTNOW.sqlite3.tmp' in tm and not tm['SIKALOTNOW.sqlite3.tmp']['keep'])

    # ---- 4) dry_run は数えるだけ ----
    before = sorted(p.name for p in cache.iterdir())
    dry = file_cleanup.run(keys=['mirror'], dry_run=True)
    rec('下見(dry_run)は数えるだけで消さない',
        dry['removed'] == 2 and sorted(p.name for p in cache.iterdir()) == before,
        f"removed={dry['removed']}")

    # ---- 5) 自動掃除は auto=True の種別だけ ----
    auto_keys = {c['key'] for c in file_cleanup.CATEGORIES if c['auto']}
    rec('バイトコードと古い作業フォルダは自動掃除の対象外',
        'pycache' not in auto_keys and 'work' not in auto_keys, str(sorted(auto_keys)))
    touch(tmp / 'pycache' / 'usr' / 'a.pyc', 999)
    got = file_cleanup.run(dry_run=True, auto_only=True)
    rec('自動掃除の下見にバイトコードが混ざらない',
        all(r['key'] != 'pycache' for r in got['results']),
        str([r['key'] for r in got['results']]))

    # ---- 6) 実際に消える ----
    real = file_cleanup.run(keys=['mirror', 'logs'])
    left = sorted(p.name for p in cache.glob('*.sqlite3'))
    rec('掃除すると古い世代だけが消える',
        left == ['SIKALOTNOW.g3.sqlite3', 'SIKALOTNOW.g4.sqlite3'] and real['removed'] >= 2,
        f'{left} removed={real["removed"]}')
    rec('いま書いているログは掃除のあとも在る', (logs / 'app.log').exists())
    rec('本物のデータは掃除のあとも在る',
        all((dbdir / n).exists() for n in holy))

    # ---- 7) 決まりの下限 ----
    unpatch()
    file_cleanup._cfg = lambda key, default: {'cleanup_interval_sec': '10',
                                              'cleanup_keep_days': '0',
                                              'cleanup_keep_generations': '0'}.get(key, default)
    rec('掃除の間隔は下限(300秒)より短くならない', file_cleanup.interval_sec() == 300,
        str(file_cleanup.interval_sec()))
    rec('残す世代・日数は1を下回らない',
        file_cleanup.keep_days() == 1 and file_cleanup.keep_generations() == 1)
    file_cleanup._cfg = lambda key, default: 'off' if key == 'cleanup_auto_enabled' else default
    rec('定期掃除は切にできる', file_cleanup.auto_enabled() is False)

    # ---- 9) 更新のとき（update.bat）は作り直せる物を丸ごと片付ける（§9.497、利用者の指示） ----
    # 「古いデータ(一時ファイルたち)をアップデートで一旦消して、作り直した方が良い」
    # 「update.batでアップデートの版の表示追加と、古いデータの処理など」
    rt, vis = tmp / 'runtime', tmp / 'visible'
    for d0 in (rt, vis):
        for n in ('make_shortcut.vbs', 'loading.next.html', 'boot_status.js', 'x.html.tmp'):
            touch(d0 / n, 64, age_days=2)
        # **残す物**: 起動前確認の刻印・起動中の印・いまブラウザへ渡す待機画面・
        # 絵（デスクトップのショートカットが指している。作り直すのは作るときだけなので、消すと白紙になる）
        for n in ('ready.json', 'instance.json', 'loading.html', 'wavelog.ico'):
            touch(d0 / n, 64, age_days=2)
    touch(tmp / 'pycache' / 'cpython-312' / 'backend' / 'x.pyc', 64)
    patch()   # **置き場を差し替えてから**（差し替えずに回すと本物の置き場を片付ける）
    # バイトコードの見立てはアプリの置き場の`__pycache__`も拾う。リポジトリの分を消して
    # 並列で回る他の網と競らないよう、アプリの置き場も一時的な置き場へ向ける。
    from backend import paths as _paths
    _real_root = _paths.APP_ROOT
    _paths.APP_ROOT = tmp / 'app'
    has_rt = hasattr(file_cleanup, '_runtime_dirs')
    if has_rt:
        _real['rt'] = file_cleanup._runtime_dirs
        file_cleanup._runtime_dirs = lambda: [rt, vis]
    try:
        cat = next((c for c in file_cleanup.survey()['categories'] if c['key'] == 'runtime'), None)
        names = sorted({e['name'] for e in (cat or {}).get('examples', [])})
        rec('更新で作り直せる起動の部品を数える（補助スクリプト・次の待機画面・進捗・書きかけ）（§9.497）',
            cat is not None and cat['removable'] == 8 and cat['auto'] is False,
            f"{cat and cat['removable']}件 {names}")
        upd = getattr(file_cleanup, 'run_for_update', None)
        out = upd() if upd else None
        left_rt = sorted(p.name for d0 in (rt, vis) for p in d0.iterdir())
        rec('更新の片付けは作り直せる部品を消し、刻印・起動中の印・いまの待機画面・絵を残す（§9.497）',
            out is not None and left_rt == sorted(['instance.json', 'loading.html', 'ready.json', 'wavelog.ico'] * 2), str(left_rt))
        rec('更新の片付けはバイトコードも消す（直後に update.bat が作り直す）（§9.497）',
            out is not None and not (tmp / 'pycache' / 'cpython-312').exists())
        rec('更新の片付けでも本物のデータは残る（§9.497）',
            all((dbdir / n).exists() for n in ('master.sqlite3', 'records.sqlite3', 'schedule.sqlite3')))
    finally:
        if has_rt:
            file_cleanup._runtime_dirs = _real['rt']
        _paths.APP_ROOT = _real_root
        unpatch()
    from backend.launcher import ready as _ready
    vn = getattr(_ready, 'version_note', None)
    rec('版の1行は前回の版と今回の版を言い分ける（§9.497）',
        vn is not None and '2.381.0' in vn({'appVersion': '2.381.0'}) and '更新' in vn({'appVersion': '2.381.0'})
        and '同じ' in vn({'appVersion': _ready.current()['appVersion']}) and vn(None),
        vn and [vn({'appVersion': '2.381.0'}), vn({'appVersion': _ready.current()['appVersion']}), vn(None)])

    # ---- 8) 種別の作りが揃っている（画面はこの並びをそのまま出す） ----
    need = {'key', 'label', 'icon', 'note', 'why', 'auto', 'scan'}
    rec('どの種別も「呼び名・説明・消し方・自動可否」を持っている',
        all(need <= set(c) for c in file_cleanup.CATEGORIES),
        str([c['key'] for c in file_cleanup.CATEGORIES if not need <= set(c)]))
    rec('survey() が総量と決まりと置き場を返す',
        {'categories', 'total', 'policy', 'state', 'places'} <= set(d), str(sorted(d)))
finally:
    try:
        db_mirror.cache_dir = _real_mirror_cache
    except Exception:
        pass
    unpatch()
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, dd in ng:
    print(f' - {n} {dd}')
sys.exit(1 if ng else 0)
