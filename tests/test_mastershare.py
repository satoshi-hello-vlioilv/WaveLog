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
============================================================
"""
import pathlib, re, shutil, sys, tempfile

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
    for f in (ROOT / 'backend' / 'routes').glob('*.py'):
        src = f.read_text(encoding='utf-8')
        if "DBS['MASTER']['path']" not in src:
            continue
        # 読み取り専用しか無い段は対象外。`connect(path,True)`だけかを見る。
        writes = re.search(r"connect\((?:path|master|DBS\['MASTER'\]\['path'\])\s*,\s*False\)", src) \
            or re.search(r"connect\(DBS\['MASTER'\]\['path'\]\)", src)
        if not writes:
            continue
        bp = f.stem
        if bp not in ms.WRITING_BLUEPRINTS:
            missing.append(bp)
    rec('マスタへ書く段は全部 WRITING_BLUEPRINTS に載っている',
        not missing, '載っていない: ' + ','.join(missing) if missing else
        '/'.join(sorted(ms.WRITING_BLUEPRINTS)))
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
