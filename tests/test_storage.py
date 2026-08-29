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
 9. `local.json` を**読めなかったことを黙らない**（§9.271）
10. 置き場は**フォルダで書いてもよい**（マスタ・測定データ・作業予定とも）
11. 「これから効く値」も「作る先」も**環境変数を展開してから**答える
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

    # ---- マスタDBは1回しか開かない（§9.268の追補） -------------------
    # 以前は行ごとに`_saved_of()`が開いており、`/api/storage-layout`1回で
    # **11回**開いて11回statしていた（9行＋`items()`の明示2回）。手元に
    # 置いている端末では実害が出ないが、共有へ移すとそのぶん往復が増える。
    from backend import db_access as _da
    _real_connect = _da.connect
    opens = []

    def _counting_connect(path, readonly=False, engine=None):
        opens.append(str(path))
        return _real_connect(path, readonly, engine)

    _real_read = sl._read_path_config
    reads = []

    def _counting_read():
        reads.append(1)
        return _real_read()

    sl._read_path_config = _counting_read
    _da.connect = _counting_connect
    try:
        rows_n = len(sl.layout()['items'])
    finally:
        _da.connect = _real_connect
        sl._read_path_config = _real_read
    master_opens = [x for x in opens if x.endswith('master.sqlite3')
                    or x.endswith('master.local.sqlite3')]
    # **行の数だけ開かない**のが要点。以前は行ごとに開いており、9行＋明示2回で
    # 11回だった。
    rec('パス設定マスタを読むのは1回だけ（行の数だけ読まない）',
        len(reads) == 1, f'{len(reads)}回 / 行{rows_n}件')
    # 全体でも2回を超えない。もう1回は`rne_scheduler.assets_dir()`が呼ぶ
    # `path_config_value`（あちらは「都度読み直す」設計で、この節の外の話）。
    rec('マスタDBを開く回数が行の数で増えない',
        len(master_opens) <= 2, f'{len(master_opens)}回 / 行{rows_n}件 / 全{len(opens)}回')
    # **`exists()`を`connect()`の前に置かない**（CLAUDE.md）——共有越しでは
    # statだけ失敗してopenは成功することがあり、確認のつもりの1行が唯一の
    # 失敗原因になる。**ソースの字を見る網は当てにならない**ので
    # （最初そう書いて、切り出す位置を1つ間違えたまま素通りした）、
    # 実際に`exists()`が呼ばれるかで見る。
    _real_exists = pathlib.Path.exists
    seen = []

    def _watched_exists(self):
        seen.append(str(self))
        return _real_exists(self)

    pathlib.Path.exists = _watched_exists
    try:
        sl._read_path_config()
    finally:
        pathlib.Path.exists = _real_exists
    rec('パス設定マスタは存在確認せずに開く（確認そのものが失敗原因になる）',
        not seen, ','.join(seen[:3]))

    # ---- 環境変数で書ける（§9.268の追補、利用者の指摘） ---------------
    # 「%LOCALAPPDATA%\\WaveLog みたいな感じで考えていました」——書けなかった。
    # `Path('%LOCALAPPDATA%\\WaveLog')`は**相対パス扱いの文字列**で、
    # `%LOCALAPPDATA%`という名前のフォルダをアプリの隣に作りに行っていた。
    import os as _os
    _os.environ['WL_TEST_ROOT'] = str(tmp)
    rec('%VAR% を展開する（Windowsの書き方。検証はLinuxで走る）',
        sl.paths.expand_path(r'%WL_TEST_ROOT%\WaveLog') == str(tmp) + r'\WaveLog',
        sl.paths.expand_path(r'%WL_TEST_ROOT%\WaveLog'))
    rec('$VAR と ~ も展開する',
        sl.paths.expand_path('$WL_TEST_ROOT/x') == str(tmp) + '/x'
        and sl.paths.expand_path('~').startswith('/'),
        sl.paths.expand_path('$WL_TEST_ROOT/x'))
    # **未定義の変数は残す**——消すと「フォルダ名の一部が抜けたパス」に化けて、
    # 身に覚えのない場所へ書きに行く。
    rec('未定義の変数はそのまま残す（別の場所へ書きに行かない）',
        sl.paths.expand_path(r'%WL_NO_SUCH_VAR%\x') == r'%WL_NO_SUCH_VAR%\x',
        sl.paths.expand_path(r'%WL_NO_SUCH_VAR%\x'))
    # **保存するのは書いたまま**——展開して保存すると端末ごとに違う文字列に
    # なり、同じ config/local.json を全端末へ配れない（変数で書きたい理由）。
    got = sl.validate_local_config({'db_dir': r'%WL_TEST_ROOT%\WaveLog'})
    rec('保存するのは書いたまま（同じlocal.jsonを全端末へ配れる）',
        got['db_dir'] == r'%WL_TEST_ROOT%\WaveLog', got['db_dir'])
    try:
        sl.validate_local_config({'db_dir': r'%WL_NO_SUCH_VAR%\x'})
        rec('中身が空の変数は断る', False, '通ってしまった')
    except sl.LocalConfigError as e:
        rec('中身が空の変数は断る（理由を言い分ける）', '環境変数' in str(e), str(e))
    _os.environ.pop('WL_TEST_ROOT', None)

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

    # ---- 9. local.json を読めなかったことを黙らない（§9.271）----------
    # 実機の報告「master_db_path を書いたのに正しく読み込んでいない」。
    # 以前は `except Exception: return {}` で握り潰しており、**BOM付き・
    # ANSI(CP932)・カンマの打ち過ぎ**のどれでも「1つも書かれていない」のと
    # まったく同じ結果になり、画面にもログにも何も出なかった。
    from backend import paths as _paths
    body = ('{\n  "master_db_path": "\\\\\\\\srv\\\\share\\\\master.sqlite3"\n}\n')

    def load_with(data_bytes):
        lc_path.parent.mkdir(parents=True, exist_ok=True)
        lc_path.write_bytes(data_bytes)
        got = _paths.load_local_config()
        return got, _paths.local_config_error()

    got, err = load_with(body.encode('utf-8'))
    rec('ふつうのUTF-8は読める', got.get('master_db_path') and not err, str(err or got))

    # メモ帳などが付けるBOM。**読めること**（現場が手で書くファイルなので）。
    got, err = load_with(b'\xef\xbb\xbf' + body.encode('utf-8'))
    rec('BOM付きで保存されていても読める', bool(got.get('master_db_path')) and not err,
        str(err or got))

    # 日本語のコメントを入れて「ANSI」で保存した場合（日本語WindowsはCP932）。
    got, err = load_with('{\n  "_説明": "マスタの置き場",\n  "master_db_path": "C:\\\\x\\\\m.sqlite3"\n}'.encode('cp932'))
    rec('ANSI(CP932)で保存されていても読める', bool(got.get('master_db_path')) and not err,
        str(err or got))

    # 打ち間違い。**読めないのは仕方がないが、黙るのは駄目**。
    got, err = load_with(b'{\n  "master_db_path": "x",\n}\n')
    rec('壊れたJSONは空として返す', got == {}, str(got))
    rec('壊れたJSONは理由を返す（黙らない）', bool(err), str(err))
    rec('理由にファイルの場所が入っている', bool(err) and 'local.json' in str(err), str(err)[:60])

    got, err = load_with(body.encode('utf-8'))
    rec('直せば理由は消える', not err and bool(got.get('master_db_path')), str(err))

    # **画面まで届くこと**——理由を作っても渡し忘れれば黙るのと同じ。
    load_with(b'{\n  "master_db_path": "x",\n}\n')
    lay = sl.layout()
    rec('読めなかった理由は画面の答えに入る', bool(lay.get('localConfigError')),
        str(lay.get('localConfigError'))[:60])
    load_with(body.encode('utf-8'))
    rec('読めていれば理由は空', sl.layout().get('localConfigError') == '',
        str(sl.layout().get('localConfigError')))

    # ---- 10. 置き場はフォルダで書いてもよい（§9.271）-------------------
    from backend.db_access import resolve_db_file, resolve_schedule_share
    folder = '\\\\srv\\共有\\Records'
    rec('マスタ: フォルダを書いたら master.sqlite3 を足す',
        str(resolve_db_file(folder, 'master.sqlite3')).endswith('master.sqlite3'),
        str(resolve_db_file(folder, 'master.sqlite3')))
    rec('測定データ: フォルダを書いたら records.sqlite3 を足す',
        str(resolve_db_file(folder, 'records.sqlite3')).endswith('records.sqlite3'),
        str(resolve_db_file(folder, 'records.sqlite3')))
    rec('作業予定: 今までどおりフォルダを書ける',
        str(resolve_schedule_share(folder)).endswith('schedule.sqlite3'),
        str(resolve_schedule_share(folder)))
    keep = resolve_db_file(folder + '\\master.sqlite3', 'master.sqlite3')
    rec('ファイル名まで書いてあればそのまま', str(keep).endswith('master.sqlite3')
        and not str(keep).endswith('master.sqlite3/master.sqlite3'), str(keep))
    rec('空欄は None（既定へ落とす）', resolve_db_file('', 'master.sqlite3') is None)
    # **3つとも同じ関数が答えること**——別々に持つと、片方だけフォルダを
    # 受ける状態が作れる（実際にマスタと測定データだけが受けていなかった）。
    rec('3つとも同じ1箇所が答える',
        resolve_schedule_share(folder) == resolve_db_file(folder, 'schedule.sqlite3'))

    # **本体が実際にそこを開くこと**まで見る。上の3つは「答えられる」だけで、
    # 本体が答えを使っていなければ素通りする（§9.268で実際に踏んだ形）。
    # 起動時に1回だけ決まる値なので、別のプロセスで読み直して確かめる。
    import subprocess
    box = tmp / 'folderstyle'
    lc_path.write_text(json.dumps({'master_db_path': str(box)}, ensure_ascii=False),
                       encoding='utf-8')
    out = subprocess.run(
        [sys.executable, '-c',
         'from backend import db_access; print(db_access._MASTER_PATH_CONFIGURED)'],
        cwd=str(ROOT), capture_output=True, text=True, timeout=120)
    got = (out.stdout or '').strip().splitlines()[-1] if out.stdout.strip() else ''
    rec('本体もフォルダ指定でその中の master.sqlite3 を開く',
        got == str(box / 'master.sqlite3'), got or (out.stderr or '')[-160:])

    # ---- 11. 環境変数を展開してから答える（§9.271）--------------------
    import os as _os
    _os.environ['WLTESTHOME'] = str(tmp / 'expand')
    rec('「これから効く値」は展開してから答える',
        sl._planned_of('master', '%WLTESTHOME%', '') == str(tmp / 'expand' / 'master.sqlite3'),
        sl._planned_of('master', '%WLTESTHOME%', ''))
    # **例外で止めずに報告する**——ここで送出させると、以降の確認が1つも
    # 走らないまま検証そのものが終わる（§9.269と同じ罠）。
    try:
        plan = sl.prepare_path('%WLTESTHOME%/WaveLog/master.sqlite3', mode='file', apply=False)
        made, why = plan['path'], ''
    except Exception as e:
        made, why = '', f'断られた: {e}'
    rec('「無いので作る」も展開してから答える',
        made == str(tmp / 'expand' / 'WaveLog' / 'master.sqlite3'), why or made)
    rec('下見では1つも作っていない', not (tmp / 'expand').exists())
    try:
        sl.prepare_path('%WL_NOT_DEFINED_VAR%/x', mode='dir')
        why = ''
    except sl.LocalConfigError as e:
        why = str(e)
    rec('未定義の変数は理由を言い分ける', '空でした' in why, why[:70])
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
