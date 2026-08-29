#!/usr/bin/env python3
"""test_storage.py: 置き場を1箇所で答える／local.json を画面から直す（§9.267）。

============================================================
なぜ要るか
------------------------------------------------------------
置き場の設定は**2つの保存先**に分かれている——`config/local.json`（マスタDB
自身の置き場を決める4つ）とパス設定マスタ（それ以外）。利用者から見ると
同じ「置き場の設定」なのに直す場所が2つあり、しかも前者は画面に一切出て
いなかった（「local.jsonの扱いがわからない」）。

ここで固定するのは次の8つ。
 1. 置き場は**1つの答え**（判定を画面へ写さない・§9.163）
 2. 保存値と「効いている値」を**混ぜない**（§9.250 ⑩の再発を防ぐ）
 3. `local.json` は**4つの鍵だけ**受ける（他は断る）
 4. 相対パスは断る（Windowsの綴りは絶対と読む）
 5. 空文字は「既定へ戻す」＝鍵ごと消す／**送っていない鍵は触らない**
 6. 書く前に控える（壊れた local.json は起動を止めうる）
 7. 作るのは**下見 → apply** の2段（下見では1つも作らない）
 8. `存在するか`は3値（True/False/**None＝確かめられなかった**）で、
    Noneを「無い」と同じに扱わない
============================================================
"""
import json, pathlib, sys, tempfile, shutil

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import storage_layout as sl  # noqa: E402
from backend import master_share as ms  # noqa: E402

R = []
def rec(n, ok, d=''):
    R.append((n, ok, d))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(d) if d else ''))

tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-storage-'))
saved_local = None
lc_path = sl.local_config_path()
try:
    saved_local = lc_path.read_text(encoding='utf-8') if lc_path.exists() else None

    # ---- 1. 置き場は1つの答え -------------------------------------
    L = sl.layout()
    keys = {x['key'] for x in L['items']}
    rec('本体3つ（マスタ・作業予定・測定データ共有）が必ず載る',
        {'master', 'schedule', 'recordsShare'} <= keys, ','.join(sorted(keys)))
    rec('この端末の測定データと作り直せるファイルも載る',
        {'recordsLocal', 'work'} <= keys, ','.join(sorted(keys)))
    groups = {x['group'] for x in L['items']}
    rec('群は3つ（この端末の中／みんなで使う／読むだけ）',
        groups <= {'terminal', 'share', 'read'} and len(groups) >= 2, ','.join(sorted(groups)))
    rec('local.json の4つも同じ答えに載る',
        [f['key'] for f in L['localConfig']]
        == ['db_dir', 'master_db_path', 'records_db_path', 'master_share_mode'],
        ','.join(f['key'] for f in L['localConfig']))
    rec('優先順位はサーバーが言う（出どころが名前で入る）',
        all(x.get('from') for x in L['items'] if x['key'] in ('master', 'recordsLocal', 'schedule')),
        json.dumps({x['key']: x.get('from') for x in L['items']}, ensure_ascii=False))
    rec('置き場の種類は文字で返る（画面で判定しない）',
        all(x['kind'] in ('network', 'cloud', 'local', '') for x in L['items']),
        ','.join(sorted({x['kind'] for x in L['items']})))
    rec('直せないものは直せないと返る（作り直せるファイル・参照データ）',
        not [x for x in L['items'] if x['key'] == 'work'][0]['editable'],
        'work.editable')

    # ---- 2. 保存値と「効いている値」を混ぜない ---------------------
    # **これが混ざると空欄の設定が画面の往復だけで焼き付く**（§9.250 ⑩）。
    master = [x for x in L['items'] if x['key'] == 'master'][0]
    rec('保存していない置き場の saved は空（効いている値を入れない）',
        master['saved'] == '' and master['path'] != '',
        f"saved={master['saved']!r} path={master['path']!r}")

    # ---- 3〜5. local.json が受ける鍵と値 ---------------------------
    try:
        sl.validate_local_config({'sikalot_source': 'local'})
        rec('知らない鍵は断る', False, '通ってしまった')
    except sl.LocalConfigError as e:
        rec('知らない鍵は断る', 'sikalot_source' in str(e), str(e))
    try:
        sl.validate_local_config({'db_dir': 'rel/ative'})
        rec('相対パスは断る', False, '通ってしまった')
    except sl.LocalConfigError as e:
        rec('相対パスは断る', '絶対パス' in str(e), str(e))
    rec('Windowsの綴りは絶対パスと読む（検証はLinuxで走る）',
        sl._is_absolute(r'C:\WaveLog') and sl._is_absolute(r'\\srv\share')
        and not sl._is_absolute('rel'),
        f"C:={sl._is_absolute(chr(67)+':'+chr(92))} UNC={sl._is_absolute(chr(92)*2+'s')}")
    try:
        sl.validate_local_config({'master_share_mode': 'yes'})
        rec('選択肢に無い値は断る', False, '通ってしまった')
    except sl.LocalConfigError as e:
        rec('選択肢に無い値は断る', 'master_share_mode' in str(e), str(e))

    lc_path.write_text('{}\n', encoding='utf-8')
    v1, _ = sl.save_local_config({'db_dir': r'C:\WaveLogData', 'master_share_mode': 'on'})
    rec('書いた値がそのまま入る', v1.get('db_dir') == r'C:\WaveLogData'
        and v1.get('master_share_mode') == 'on', json.dumps(v1, ensure_ascii=False))
    on_disk = json.loads(lc_path.read_text(encoding='utf-8'))
    rec('ファイルにも同じものが入る（読み返せる）', on_disk == v1,
        json.dumps(on_disk, ensure_ascii=False))
    v2, _ = sl.save_local_config({'records_db_path': r'D:\r.sqlite3'})
    rec('送っていない鍵は触らない（§9.212 ②）',
        v2.get('db_dir') == r'C:\WaveLogData' and v2.get('master_share_mode') == 'on',
        json.dumps(v2, ensure_ascii=False))
    v3, backup = sl.save_local_config({'db_dir': ''})
    rec('空文字は「既定へ戻す」＝鍵ごと消える', 'db_dir' not in v3,
        json.dumps(v3, ensure_ascii=False))
    # ---- 6. 控え -------------------------------------------------
    rec('書く前に控える（戻せる道を残す）',
        bool(backup) and pathlib.Path(backup).exists()
        and 'db_dir' in json.loads(pathlib.Path(backup).read_text(encoding='utf-8')),
        str(backup))

    # ---- 7. 下見 → apply -----------------------------------------
    want = tmp / 'a' / 'b' / 'c'
    plan = sl.prepare_path(str(want), 'dir', apply=False)
    rec('下見は「何を作るか」を上から順に返す',
        plan['dirs'] == [str(tmp / 'a'), str(tmp / 'a' / 'b'), str(want)],
        json.dumps(plan['dirs']))
    rec('下見では1つも作らない', not want.exists(), str(want))
    done = sl.prepare_path(str(want), 'dir', apply=True)
    rec('applyで作る', want.is_dir() and done.get('done') is True, str(want))
    rec('作ったあと書けるかまで見る', done.get('writable') is True, json.dumps(done))
    rec('作ったあとの下見は「もうあります」', sl.prepare_path(str(want), 'dir')['already'] is True)
    dbf = tmp / 'x' / 'records.sqlite3'
    sl.prepare_path(str(dbf), 'file', apply=True)
    import sqlite3
    # **開けたことで終わらせない**——`sqlite3.connect()`は遅延なので、
    # 0バイトのファイルでも例外を出さずに開ける（`touch()`だけの実装が
    # この網を素通りした）。実際に読ませて初めて差が出る。
    db_err = ''
    try:
        con = sqlite3.connect(f'file:{dbf}?mode=ro', uri=True)
        try:
            con.execute('PRAGMA schema_version').fetchone()
        finally:
            con.close()
    except Exception as e:
        db_err = str(e)
    rec('.sqlite3 は空のDBとして作る（0バイトのファイルは読めない）',
        dbf.exists() and dbf.stat().st_size > 0 and not db_err,
        f'{dbf.stat().st_size if dbf.exists() else "無い"}バイト {db_err}')
    try:
        sl.prepare_path('', 'dir')
        rec('置き場が空なら断る', False, '通ってしまった')
    except sl.LocalConfigError as e:
        rec('置き場が空なら断る', True, str(e))

    # ---- 8. 3値の存在確認 -----------------------------------------
    rec('在る/無い/確かめられない の3値',
        sl.exists_of(str(tmp)) is True and sl.exists_of(str(tmp / 'nope')) is False
        and sl.exists_of('') is None,
        f'{sl.exists_of(str(tmp))}/{sl.exists_of(str(tmp / "nope"))}/{sl.exists_of("")}')

    # ---- おまけ: マスタの書込サイクルを回さない口 -------------------
    # 置き場を作るのはファイルシステムへの操作で master.sqlite3 は触らない。
    # **載せ忘れると押すたびに共有のロックを取りに行く**（他端末を待たせる）。
    rec('置き場を作る口はマスタのロックを取らない',
        'path_config.storage_layout_prepare' in ms.NON_MASTER_ENDPOINTS
        and 'path_config.storage_layout_local_config' in ms.NON_MASTER_ENDPOINTS,
        ','.join(sorted(ms.NON_MASTER_ENDPOINTS)))

    # ---- ロックの確認待ちは置き場の種類で変える（§9.267の追補） --------
    # 一律1.5秒だと、ファイルサーバーでも**予定を1本足すたびに1.2秒**
    # よけいに待つ（ロックは設備をまたいで1本なので、他の設備を触っている
    # 人も一緒に待つ）。**明示の設定があればそちらが勝つ。**
    from backend import schedule_sync as ss
    from backend.config import (SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT,
                                SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS)
    _orig_share = ss.SCHEDULE_SHARE_PATH
    try:
        ss.SCHEDULE_SHARE_PATH = pathlib.Path(r'\\srv\share\WaveLog\schedule.sqlite3')
        net = ss._lock_verify_delay_default_ms()
        ss.SCHEDULE_SHARE_PATH = pathlib.Path(r'C:\Users\me\Box\WaveLog\schedule.sqlite3')
        cloud = ss._lock_verify_delay_default_ms()
    finally:
        ss.SCHEDULE_SHARE_PATH = _orig_share
    rec('ファイルサーバーでは確認の待ちを短くする',
        net == SCHEDULE_LOCK_VERIFY_DELAY_NETWORK_MS, f'{net}ms')
    rec('クラウド同期では今までどおり待つ（結果整合なので短くできない）',
        cloud == SCHEDULE_LOCK_VERIFY_DELAY_MS_DEFAULT, f'{cloud}ms')
    rec('置き場の種類で答えが変わる（一律に戻していない）', net != cloud, f'{net}/{cloud}')

    # ---- 同じ根の下かは「3つとも決まっているとき」だけ言う ----------
    rows = [{'key': 'master', 'path': '/s/x/master.sqlite3'},
            {'key': 'schedule', 'path': '/s/x/schedule.sqlite3'},
            {'key': 'recordsShare', 'path': '/s/x'}]
    rec('3つとも同じ場所の下なら、そう言う', sl.same_root(rows) == '/s/x', sl.same_root(rows))
    rec('1つでも未設定なら「揃っている」と言わない',
        sl.same_root(rows[:2] + [{'key': 'recordsShare', 'path': ''}]) == '')
    rec('違う場所なら言わない',
        sl.same_root(rows[:2] + [{'key': 'recordsShare', 'path': '/other'}]) == '')
finally:
    if saved_local is None:
        try:
            lc_path.unlink()
        except Exception:
            pass
    else:
        lc_path.write_text(saved_local, encoding='utf-8')
    for junk in (lc_path.with_suffix(lc_path.suffix + '.bak'),
                 lc_path.with_suffix(lc_path.suffix + '.tmp')):
        try:
            junk.unlink()
        except Exception:
            pass
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
