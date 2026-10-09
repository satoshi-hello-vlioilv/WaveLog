#!/usr/bin/env python3
"""test_mastershare.py: マスタを共有に置くための書込サイクル（§9.263）。

============================================================
なぜ要るか
------------------------------------------------------------
測定データは設備ごとに分けて「1ファイル1書き手」を満たし（§9.258）、
作業予定は**ロック→取り直し→当てる→改訂番号→丸ごと置換**の書込サイクルを
持っている（§4）。**マスタだけが取り残されていた**——全端末が同じ
master.sqlite3 へ直に書き、読むときも共有を直接開いていた。

ここで固定するのは次の7つ。
 1. 共有に置いていなければ**何も変わらない**（手元の端末の動きはそのまま）
 2. 共有に置くと、開くのは**手元の写し**（共有を直接読まない）
 3. 書込サイクル: ロックを取り、当てる前に取り直し、改訂番号を上げ、押し出す
 4. ロックは他端末を待たせず理由を返す（誰が・あと何秒）
 5. 何も変わっていなければ押し出さない（共有への往復を増やさない）
 6. 共有へ届かなくても**読みは続く**（前の写しで読める）
 7. マスタへ書くBlueprintが**書込サイクルの一覧に全部載っている**
    （載せ忘れるとそのAPIだけ素通しになる）
 8. **ファイルを開いたままにしない・写しを rename しない**（§9.270）
 9. **書き出せなかった変更を次の取り直しで消さない**（§9.576）——写しに残し、
    次の書込・起動で送り直す。共有が先に進んでいたら控えへ逃がして知らせる。
    画面へは応答の頭（`X-WL-Master-Notice`）で言う

8について。実機で「起動時の取り込みも保存も全部 WinError 32」になった。
原因は `with connect(...) as c:` が**閉じない**こと——`sqlite3.Connection`
は参照の輪を作るので、`with` を抜けてもハンドルは**GCが回るまで開いたまま**
残る（`__exit__` はコミット／ロールバックだけで close ではない）。
Linux では開いているファイルも `rename`／`unlink` できるので**何も起きず**、
Windows だけが落ちる。**だから「動いた」ことを見る網では捕まらない**——
開いているハンドルの数そのものと、写しの inode（＝名前を差し替えたか）を見る。
============================================================
"""
import ast, gc, os, pathlib, re, shutil, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import master_share as ms  # noqa: E402
from backend.db_access import connect  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def make_master(path, value='v1'):
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path, False) as c:
        cur = c.cursor()
        cur.execute('CREATE TABLE IF NOT EXISTS [試験] ([キー] TEXT PRIMARY KEY,[値] TEXT)')
        cur.execute('INSERT OR REPLACE INTO [試験] VALUES (?,?)', ['k', value])
        c.commit()


def read_value(path):
    try:
        with connect(path, True) as c:
            row = c.cursor().execute('SELECT [値] FROM [試験] WHERE [キー]=?', ['k']).fetchone()
            return (row or [''])[0]
    except Exception as e:
        return 'ERR:' + str(e)


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-mshare-'))
_orig = (ms._state.copy(), ms._mode_setting, ms._looks_shared, ms.paths.work_dir)
try:
    # ---- 1. 共有に置いていなければ何も変わらない ------------------------
    plain = tmp / 'local' / 'master.sqlite3'
    make_master(plain)
    ms._looks_shared = lambda p: False
    opened = ms.configure(plain)
    rec('共有でなければ開くのは設定どおりのパス', opened == plain, str(opened))
    rec('共有でなければ shared は False', ms.is_shared() is False)
    rec('共有でなければ書込サイクルは走らない', ms.begin_write() is None)
    rec('共有でなければ どのBlueprintでも書込サイクルに入らない',
        ms.writes_master('masters', 'POST') is False)

    # ---- 2. 共有に置くと、開くのは手元の写し ----------------------------
    share = tmp / 'share' / 'master.sqlite3'
    work = tmp / 'work'
    work.mkdir(parents=True, exist_ok=True)
    make_master(share, 'shared-1')
    ms._looks_shared = lambda p: True
    ms.paths.work_dir = lambda: work
    opened = ms.configure(share)
    rec('共有なら開くのは手元の写し', opened != share and opened.parent == work, str(opened))
    rec('写しが実際に作られている', opened.exists(), str(opened))
    rec('写しの中身は共有と同じ', read_value(opened) == 'shared-1', read_value(opened))
    rec('共有のときは非GETが書込サイクルに入る',
        ms.writes_master('masters', 'POST') is True)
    rec('GETは書込サイクルに入らない（読みは写しから）',
        ms.writes_master('masters', 'GET') is False)
    rec('マスタを書かない段は書込サイクルに入らない',
        ms.writes_master('logs', 'POST') is False)

    # ---- 3. 書込サイクル ------------------------------------------------
    rev0 = ms._read_revision(opened)
    cyc = ms.begin_write('tester', 'PC1')
    rec('ロックを取れる', cyc is not None and cyc.token, str(bool(cyc and cyc.token)))
    lk = ms.lock_status()
    rec('ロック中はそのことが読める', lk.get('locked') is True and lk.get('holderLogin') == 'tester',
        str(lk))
    # ハンドラが写しへ当てる
    make_master(opened, 'written-by-me')
    pushed = cyc.end('tester')
    rec('変わっていれば押し出す', pushed is True, str(pushed))
    rec('共有へ反映されている', read_value(share) == 'written-by-me', read_value(share))
    rec('改訂番号が上がる', ms._read_revision(opened) == rev0 + 1,
        f'{rev0} -> {ms._read_revision(opened)}')
    rec('終わったらロックは解放されている', ms.lock_status().get('locked') is False,
        str(ms.lock_status()))

    # ---- 3b. **当てる前に取り直す** -------------------------------------
    # ここがサイクルの肝。取り直さずに当てると、間隔のあいだに他端末が
    # 書いた変更を**丸ごと置換で踏み潰す**（§9.188の「書込は必ずforce」と
    # 同じ理由）。他端末が共有を直接書き換えた状況を作って確かめる。
    make_master(share, 'from-other-pc')      # 別の端末が書いた、の代わり
    rec('前提: 写しはまだ古い', read_value(opened) == 'written-by-me', read_value(opened))
    cyc = ms.begin_write('tester', 'PC1')
    rec('サイクルの頭で写しを取り直す（他端末の変更が入る）',
        read_value(opened) == 'from-other-pc', read_value(opened))
    make_master(opened, 'mine-on-top')
    cyc.end('tester')
    rec('自分の変更が共有へ出る', read_value(share) == 'mine-on-top', read_value(share))

    # ---- 4. ロックは待たせず理由を返す ----------------------------------
    held = ms.acquire_lock('other', 'PC2')
    try:
        try:
            ms.acquire_lock('me', 'PC1')
            got = None
        except ms.MasterLockHeld as e:
            got = e
        rec('埋まっていれば理由付きで断る', got is not None and got.holder_login == 'other',
            str(got))
        rec('誰が握っているかを言う', bool(got) and 'other' in str(got), str(got)[:60])
        rec('あと何秒かを言う', bool(got) and got.remaining >= 1, str(getattr(got, 'remaining', None)))
    finally:
        ms.release_lock(held)
    rec('解放すればまた取れる', ms.lock_status().get('locked') is False)

    # ---- 4.5 自分の錠に自分が弾かれない（§9.384、利用者の不具合報告） ----
    # 報告: 「他の端末がマスタを更新中です（Norio-Mori／NLM-NGY-260522、あと約19秒）」
    # の**その端末が報告者自身**で、56件の変更が409で全部落ちて消えた。
    # `release_lock()` は共有・クラウド越しでは**消せないことがある**
    # （消せなくても「TTLで自動的に切れます」と警告だけ残して先へ進む）ので、
    # 残った自分の錠が自分を締め出していた。同じ端末の同時書込は
    # プロセス内の RLock が既に1本にしているので、引き継いで構わない。
    mine = ms.acquire_lock('me', 'PC1')
    try:
        again = None
        try:
            again = ms.acquire_lock('me', 'PC1')
        except ms.MasterLockHeld as e:
            again = e
        rec('自分の錠が残っていても自分は取れる（合言葉は新しくなる）',
            isinstance(again, str) and again and again != mine, str(again)[:40])
        rec('引き継いでも錠は掛かったまま（すき間を作らない）',
            ms.lock_status().get('locked') is True, str(ms.lock_status()))
        # 端末が違えば今までどおり断る（引き継ぎを広げすぎない）
        other = None
        try:
            ms.acquire_lock('me', 'PC-OTHER')
        except ms.MasterLockHeld as e:
            other = e
        rec('端末が違えば今までどおり断る', other is not None, str(other)[:60])
        # ログインが違っても断る（同じPCの別の人は別の人）
        who = None
        try:
            ms.acquire_lock('someone-else', 'PC1')
        except ms.MasterLockHeld as e:
            who = e
        rec('同じ端末でもログインが違えば断る', who is not None, str(who)[:60])
        # **名乗れない端末を「自分」と言わない**（空の呼び名で全部引き継げると、
        # 端末名を取れない環境で排他が消える）
        anon = None
        try:
            ms.acquire_lock('', '')
        except ms.MasterLockHeld as e:
            anon = e
        rec('名乗れない端末は「自分」と言わない', anon is not None, str(anon)[:60])
    finally:
        ms.release_lock(ms._read_lock().get('token') if ms._read_lock() else None)
    rec('後始末で錠は空へ戻る', ms.lock_status().get('locked') is False,
        str(ms.lock_status()))

    # ---- 5. 何も変わっていなければ押し出さない --------------------------
    before = share.stat().st_mtime_ns
    cyc = ms.begin_write('tester', 'PC1')
    pushed = cyc.end('tester')          # 何も書かずに閉じる
    rec('変わっていなければ押し出さない', pushed is False, str(pushed))
    rec('共有のファイルも触っていない', share.stat().st_mtime_ns == before)

    # ---- 6. 共有へ届かなくても読みは続く --------------------------------
    keep = read_value(opened)
    shutil.move(str(share), str(share) + '.gone')
    ms.refresh(force=True)              # **投げないこと**
    rec('共有が消えても例外にしない（読みは写しで続く）', read_value(opened) == keep,
        read_value(opened))
    shutil.move(str(share) + '.gone', str(share))

    # ---- 7. マスタへ書くBlueprintが一覧に全部載っている ------------------
    # **載せ忘れるとそのAPIだけ書込サイクルを通らない**（共有へ出ないか、
    # 取り直さずに当てる）。人手の一覧は必ず腐るので機械で数える。
    missing = []
    for f in (ROOT / 'backend' / 'routes').rglob('*.py'):   # 段は入れ子（§9.333）
        src = f.read_text(encoding='utf-8')
        if "DBS['MASTER']['path']" not in src:
            continue
        # 読み取り専用しか無い段は対象外。`connect(path,True)`だけかを見る。
        writes = re.search(r"connect\((?:path|master|DBS\['MASTER'\]\['path'\])\s*,\s*False\)", src) \
            or re.search(r"connect\(DBS\['MASTER'\]\['path'\]\)", src)
        if not writes:
            continue
        # **Blueprint名はパッケージの名前**（§9.333）——`masters/operation.py`の
        # Blueprintは`operation`ではなく`masters`。段の綴りで数えると、分けた
        # 瞬間に「載っていない」が9件出て、直しようの無い赤になる。
        bp = f.parent.name if f.parent.name != 'routes' else f.stem
        if bp not in ms.WRITING_BLUEPRINTS:
            missing.append(bp)
    rec('マスタへ書く段は全部 WRITING_BLUEPRINTS に載っている',
        not missing, '載っていない: ' + ','.join(missing) if missing else
        '/'.join(sorted(ms.WRITING_BLUEPRINTS)))

    # ---- 8. ファイルを開いたままにしない・写しを rename しない ----------
    def open_fds():
        """このモジュールが関わるファイルのうち、今この瞬間に開いている数。"""
        d = '/proc/self/fd'
        if not os.path.isdir(d):
            return None
        out = []
        for x in os.listdir(d):
            try:
                t = os.readlink(os.path.join(d, x))
            except OSError:
                continue
            # 一時ファイルは消したあとも「(deleted)」として残るので拾える。
            if 'master.local' in t or str(share) in t or '.tmp' in t:
                out.append(t)
        return out

    # **前提**: 開いているファイルを実際に数えられること。数えられていない
    # 網は、閉じ忘れを注ぎ込んでも 0 のまま通ってしまう。
    gc.collect()
    probe = connect(opened, True)
    fds = open_fds()
    rec('前提: 開いているファイルを数えられる', fds is not None and len(fds) >= 1,
        '(この環境では /proc/self/fd が読めないため8節は確かめられない)'
        if fds is None else str(len(fds)))
    probe.close()
    gc.collect()
    rec('前提: 閉じれば数は戻る', open_fds() == [], str(open_fds()))

    # 取り込みがハンドルを残さないこと。**残すと Windows では次の置き換えが
    # 必ず失敗する**（実機の WinError 32 はこれ）。
    make_master(share, 'handle-check')
    gc.collect()
    ms.refresh(force=True)
    rec('取り込みはファイルを開いたままにしない', open_fds() == [], str(open_fds()))
    rec('取り込めている', read_value(opened) == 'handle-check', read_value(opened))

    # 書込サイクル（ロック→取り直し→改訂番号→押し出し）も同じ。
    cyc = ms.begin_write('tester', 'PC1')
    make_master(opened, 'handle-check-2')
    cyc.end('tester')
    gc.collect()
    rec('書込サイクルはファイルを開いたままにしない', open_fds() == [], str(open_fds()))

    # **写しは名前を差し替えない。** アプリ側の約100箇所は `with connect(...)`
    # で開くので、写しを `os.replace` する実装に戻すと、そのうち1つでも
    # 開いたままなら Windows では取り込みが失敗する。inode が変わらない
    # ことで「中身を書き換えている」ことを固定する。
    ino0 = opened.stat().st_ino
    make_master(share, 'inode-check')
    ms.refresh(force=True)
    rec('写しは中身を書き換える（名前を差し替えない）', opened.stat().st_ino == ino0,
        f'{ino0} -> {opened.stat().st_ino}')
    rec('それでも取り込めている', read_value(opened) == 'inode-check', read_value(opened))

    # **「確かめられなかった」を「共有にまだ無い」と読まないこと。** 読むと、
    # 共有には全員のマスタがあるのに手元の写しを正とみなし、次の書込で
    # 丸ごと上書きしてしまう。
    # 差し替えるのは **master_share が読んでいる名前**（§9.329で
    # `from .sqlite_io import path_exists_safe` を頭で読むようにしたので、
    # `db_access` 側を差し替えても届かない・§CLAUDE「from ... import した
    # 名前は差し替わらない」）。
    _orig_exists = ms.path_exists_safe
    ms.path_exists_safe = lambda p: None
    try:
        try:
            ms._pull(force=True)
            got = None
        except ms.MasterShareUnavailable as e:
            got = e
        rec('共有の有無を確かめられないときは取り込みを断る', got is not None, str(got)[:70])
        try:
            ms.begin_write('tester', 'PC1')
            wrote = True
        except Exception:
            wrote = False
        rec('確かめられないときは書込サイクルに入らない（共有を上書きしない）',
            wrote is False, str(wrote))
        rec('断ったあともロックは残さない', ms.lock_status().get('locked') is False,
            str(ms.lock_status()))
    finally:
        ms.path_exists_safe = _orig_exists
    rec('共有が読めれば元どおり取り込める',
        ms.refresh(force=True) is not None and read_value(opened) == 'inode-check',
        read_value(opened))

    # ファイルを置き換える／削除する側のモジュールは `with connect(...)` を
    # **書かない**。上のfd検査は実際に通る道しか見られないので、あとから
    # 足した関数は素通りする。綴りでも見張っておく（`_opened()` を通すこと）。
    # **綴りではなく構文木で見る**——説明文の中の `with connect(...)` まで
    # 拾ってしまい、直したのに落ちたままになる（実際にそうなった）。
    leaky = []
    for name in ('master_share.py', 'schedule_sync.py', 'db_mirror.py'):
        tree = ast.parse((ROOT / 'backend' / name).read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if not isinstance(node, ast.With):
                continue
            for item in node.items:
                fn = item.context_expr
                if not isinstance(fn, ast.Call):
                    continue
                nm = (fn.func.id if isinstance(fn.func, ast.Name)
                      else fn.func.attr if isinstance(fn.func, ast.Attribute) else '')
                if nm == 'connect':
                    leaky.append(f'{name}:{fn.lineno}')
    rec('置き換える側のモジュールは with connect(...) を書かない（閉じないため）',
        not leaky, '／'.join(leaky) if leaky else 'master_share/schedule_sync/db_mirror')
    # ---- 9. 書き出せなかった変更を次の取り直しで消さない（§9.576） --------
    # 実機の報告: 内訳を足した直後の予定の追加が 400「指定のサブカテゴリが
    # 見つかりません」。同じ分に共有への書込が WinError 59／5 で落ちていた。
    # 書き出し（_push）の失敗は警告だけで画面は「保存できた」と読み、次の書込の
    # 頭の「取り直す」が写しを共有の古い中身で上書きして、足した行が消えていた。
    def fail_push():
        raise OSError(59, '予期しないネットワーク エラー')
    real_push = ms._push
    make_master(share, 'base-9'); ms.refresh(force=True)
    cyc = ms.begin_write('tester', 'PC1')
    make_master(opened, 'unpushed-9')
    ms._push = fail_push
    try:
        try:
            cyc.end('tester'); raised = False
        except OSError:
            raised = True
    finally:
        ms._push = real_push
    rec('書き出しの失敗は呼んだ側へ伝わる', raised, str(raised))
    rec('書き出せなかったことを知らせる字がある', '書き出せません' in cyc.notice, cyc.notice[:40])
    rec('書き出せなかった印が残る（写しの外）', ms.pending() is not None and ms.status().get('pending') is not None,
        str(ms.pending()))
    rec('失敗してもロックは返す', ms.lock_status().get('locked') is False, str(ms.lock_status()))
    rec('写しには変更が残る', read_value(opened) == 'unpushed-9', read_value(opened))
    cyc = ms.begin_write('tester', 'PC1')          # 次の書込（予定の追加など）
    rec('次の書込の頭で写しを消さない（送り直す）', read_value(opened) == 'unpushed-9', read_value(opened))
    rec('送り直した変更が共有へ出る', read_value(share) == 'unpushed-9', read_value(share))
    rec('送り直したら印は消える', ms.pending() is None, str(ms.pending()))
    rec('送り直したことを知らせる', '送り直しました' in cyc.notice, cyc.notice[:40])
    cyc.end('tester')

    # 9b. 送り直す前に共有が他の端末で進んでいた → 控えへ逃がして共有を取り込む
    cyc = ms.begin_write('tester', 'PC1')
    make_master(opened, 'mine-9b')
    ms._push = fail_push
    try:
        try:
            cyc.end('tester')
        except OSError:
            pass
    finally:
        ms._push = real_push
    make_master(share, 'other-9b'); ms._bump_revision(share, 'other')   # 別の端末が書いた
    cyc = ms.begin_write('tester', 'PC1')
    asides = sorted(work.glob('master.unpushed.*.sqlite3'))
    rec('ぶつかったら共有を取り込む（他の端末の変更を踏み潰さない）',
        read_value(opened) == 'other-9b', read_value(opened))
    rec('ぶつかったら自分の変更は控えのファイルに残す',
        len(asides) == 1 and read_value(asides[0]) == 'mine-9b', str(asides))
    rec('ぶつかったことを控えの場所まで言う', bool(asides) and str(asides[0]) in cyc.notice, cyc.notice[:60])
    rec('ぶつかったあと印は消える', ms.pending() is None, str(ms.pending()))
    cyc.end('tester')
    for a in asides:
        a.unlink()

    # 9c. 共有へ届かないまま再起動しても、写しを消さない
    cyc = ms.begin_write('tester', 'PC1')
    make_master(opened, 'restart-9c')
    ms._push = fail_push
    try:
        try:
            cyc.end('tester')
        except OSError:
            pass
    finally:
        ms._push = real_push
    _orig_exists = ms.path_exists_safe
    ms.path_exists_safe = lambda p: None            # 共有の応答不良のまま起動
    try:
        ms.configure(share)
        rec('届かないまま起動しても写しは消さない', read_value(opened) == 'restart-9c', read_value(opened))
        rec('届かないまま起動しても印は残す', ms.pending() is not None, str(ms.pending()))
        try:
            ms.begin_write('tester', 'PC1'); refused = False
        except ms.MasterShareUnavailable as e:
            refused = '残っています' in str(e)
        rec('届かない間の書込は理由つきで断る（写しを上書きしない）', refused, str(refused))
    finally:
        ms.path_exists_safe = _orig_exists
    ms.configure(share)                               # 届くようになって起動
    rec('届くようになった起動で送り直す', read_value(share) == 'restart-9c' and ms.pending() is None,
        read_value(share))
    rec('送り直しのあともロックは残さない', ms.lock_status().get('locked') is False, str(ms.lock_status()))

    # 9d. 画面へ言う道: 応答の頭（`X-WL-Master-Notice`）。teardownでは応答が出たあと
    # なので言えない——after_request で閉じていることを実物の Flask で確かめる。
    from urllib.parse import unquote
    from flask import Flask, Blueprint
    from backend import access_mode
    fapp = Flask('t9d')
    bp = Blueprint('masters', 't9d')

    @bp.post('/t9d/write')
    def _t9d_write():
        make_master(opened, 'via-flask-9d')
        return {'ok': True}
    fapp.register_blueprint(bp)
    access_mode.install(fapp)
    ms._push = fail_push
    try:
        r = fapp.test_client().post('/t9d/write', json={})
    finally:
        ms._push = real_push
    note = unquote(r.headers.get('X-WL-Master-Notice', ''))
    rec('書き出せなかった書込は応答の頭で画面へ言う', r.status_code == 200 and '書き出せません' in note,
        f'{r.status_code} {note[:40] or r.get_data(as_text=True)[:80]}')
    rec('応答のあとロックは残さない', ms.lock_status().get('locked') is False, str(ms.lock_status()))
    r = fapp.test_client().post('/t9d/write', json={})
    rec('次の書込で送り直したことも言う', '送り直しました' in unquote(r.headers.get('X-WL-Master-Notice', '')),
        unquote(r.headers.get('X-WL-Master-Notice', ''))[:40])
    rec('送り直した結果が共有に出ている', read_value(share) == 'via-flask-9d', read_value(share))
finally:
    ms._state.clear(); ms._state.update(_orig[0])
    ms._mode_setting, ms._looks_shared, ms.paths.work_dir = _orig[1], _orig[2], _orig[3]
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
