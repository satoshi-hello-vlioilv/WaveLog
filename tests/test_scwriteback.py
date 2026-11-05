"""test_scwriteback.py: 入れた位置が共有で書き戻されない・狙った位置からずれない（§9.638）

============================================================
利用者の報告
------------------------------------------------------------
「スケジュールにロットや設備停止など登録する際に位置が狙い通りに入らずズレたり一番下に入る」
「D&Dで入れるので、一回入った位置が共有で書き戻しされる原因を疑ってほしいです」

物差し（**直す前にも同じ物差しで測った**・前の値は §9.638 の決定記録）:
 W1. 共有ファイルが一時的に読めないとき、書込は古い手元の写しへ書いて共有へ戻すか（＝書き戻し）
 W2. 反映の直前に共有の版の番号が読めないとき、書込は確かめないまま共有へ戻すか
 W3. 状態欄が空の予定の行（前の版の行）を狙うと、その前に入るか（前は一番下）
 W4. 狙った行が書く前に始まっていたら、その次の予定の前に入るか（前は一番下）
 W5. 狙った行が書く前に完了していても同じ（次の予定の前）。次の予定が無ければ一番下
 W9. 共有は読めるのに、手元の写しを置き換えられない（Windows で読んでいる最中・WinError 5）とき、
     書込は通り（共有へ届く）、読みも新しい中身を返すか（§9.639。前は「保存できませんでした」が続いた）

**材料は自分で作る**（一時フォルダの共有ファイルと手元の写し）。サーバーは要らない（純粋な網）。
============================================================
"""
import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import schedule_sync as ss  # noqa: E402 パスを通してから読む
from backend.repositories import schedule_repo as sr  # noqa: E402 パスを通してから読む
from backend.sqlite_io import connect  # noqa: E402 パスを通してから読む

R = []


def rec(name, ok, detail=''):
    R.append(bool(ok))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


EQ = '書き戻し試験設備'
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_writeback_'))
shared = tmp / 'share' / 'schedule.sqlite3'
cache = tmp / 'cache' / 'schedule.sqlite3'
lockdir = tmp / 'share'
ss.SCHEDULE_SHARE_PATH = shared
ss.SCHEDULE_CACHE_PATH = cache
ss._lock_verify_delay_sec = lambda: 0.0


def orders():
    c = connect(shared, True)
    try:
        return [(r[0], r[2], r[11]) for r in sr.plan_rows(c, EQ)]
    finally:
        c.close()


def add(c, title, position='end'):
    return sr.plan_add(c, EQ, 'コメント', 'test', position=position, title=title)


try:
    # 材料: 予定3行（A B C）を共有へ
    ss.with_write('t', 'PC-A', 'test', lambda c: [add(c, n) for n in 'ABC'])
    rows = orders()
    rec('材料: 予定が3行', len(rows) == 3, rows)

    # ---- W1: 別の PC が共有へ D を足した後、こちらの手元の写しは古いまま・共有が一時的に読めない ----
    stale = cache.read_bytes()            # 3行のときの手元の写し
    ss.with_write('t', 'PC-B', 'test', lambda c: add(c, 'D'))   # 別の PC が足した（共有は4行）
    cache.write_bytes(stale)
    real_connect = ss.connect
    calls = {'n': 0}

    def flaky(path, ro=False, *a, **k):
        # 共有ファイルを読む口だけ一時的に失敗させる（Box の同期中に開けない形）
        if pathlib.Path(path) == shared and ro:
            calls['n'] += 1
            raise OSError('共有ファイルを開けない（同期中）')
        return real_connect(path, ro, *a, **k)
    ss.connect = flaky
    err = ''
    try:
        ss.with_write('t', 'PC-A', 'test', lambda c: add(c, 'E'))
    except Exception as e:
        err = type(e).__name__ + ': ' + str(e)
    finally:
        ss.connect = real_connect
    c = connect(shared, True)
    try:
        names = [r[7] for r in sr.plan_rows(c, EQ)]
    finally:
        c.close()
    rec('W1 共有が読めないときは書かない（古い写しで別の PC の D を消さない）',
        'D' in names and 'E' not in names and bool(err), {'names': names, 'err': err[:120]})

    # ---- W2: 取り直しはできたが、反映の直前に共有の版の番号が読めない ----
    # 取り直し（1回目の共有の読み）は通し、反映の直前の確かめ（2回目）だけ失敗させる。
    opened = {'n': 0}

    def flaky2(path, ro=False, *a, **k):
        if pathlib.Path(path) == shared and ro:
            opened['n'] += 1
            if opened['n'] >= 2:
                raise OSError('版の番号を読めない（同期中）')
        return real_connect(path, ro, *a, **k)
    ss.connect = flaky2
    err2 = ''
    try:
        ss.with_write('t', 'PC-A', 'test', lambda c: add(c, 'F'))
    except Exception as e:
        err2 = type(e).__name__ + ': ' + str(e)
    finally:
        ss.connect = real_connect
    c = connect(shared, True)
    try:
        names2 = [r[7] for r in sr.plan_rows(c, EQ)]
    finally:
        c.close()
    rec('W2 版の番号を確かめられないときは書かない（ほかの PC の書込を踏まない）',
        'F' not in names2 and bool(err2), {'names': names2, 'err': err2[:120]})

    # ---- W9: 共有は読めるが、手元の写しを置き換えられない（§9.639） ----
    # Windows は開いているファイルを置き換えられない（§9.108）。画面の読み（GET）や見張りが手元の写しを開いている
    # あいだに取り直すと、写した一時ファイルで写しを置き換えられず WinError 5 になる。Linux では起きないので、
    # 置き換えの口を「手元の写しへの置き換えだけ失敗する」形にして同じ状態を作る。
    real_replace = ss.atomic_io.replace
    denied = {'n': 0}

    def locked_cache(src, dst, **k):
        if pathlib.Path(dst) == cache:
            denied['n'] += 1
            e = PermissionError(13, 'アクセスが拒否されました')
            e.winerror = 5
            raise e
        return real_replace(src, dst, **k)
    ss.with_write('t', 'PC-B', 'test', lambda c: add(c, 'G'))     # 別の PC が足した（手元の写しは持っていない）
    cache.write_bytes(stale)
    ss.atomic_io.replace = locked_cache
    err9 = ''
    try:
        ss.with_write('t', 'PC-A', 'test', lambda c: add(c, 'H'))
    except Exception as e:
        err9 = type(e).__name__ + ': ' + str(e)
    try:
        cache.write_bytes(stale)
        read_path, read_stale = ss.fetch_snapshot(force=True)
    finally:
        ss.atomic_io.replace = real_replace
    c = connect(shared, True)
    try:
        names9 = [r[7] for r in sr.plan_rows(c, EQ)]
    finally:
        c.close()
    rec('W9 手元の写しを置き換えられなくても書込は通る（別の PC の G も残る）',
        'H' in names9 and 'G' in names9 and 'D' in names9 and not err9 and denied['n'] > 0,
        {'names': names9, 'err': err9[:120], 'denied': denied['n']})
    c = connect(read_path, True)
    try:
        read_names = [r[7] for r in sr.plan_rows(c, EQ)]
    finally:
        c.close()
    rec('W9 読みも新しい中身を返す（古い写しと言わない）', not read_stale and 'H' in read_names, {'stale': read_stale, 'names': read_names})

    # ---- W3〜W5: 狙った行の前へ（サーバーの位置の決め方） ----
    work = tmp / 'pos.sqlite3'
    c = connect(work, False)
    sr.ensure_plan_table(c)
    sr.ensure_plan_table(c)
    pid = {n: add(c, n) for n in 'PQRST'}
    c.commit()

    def seq():
        return [r[7] for r in sr.plan_rows(c, EQ)]

    # W3: 状態欄が空（前の版の行）。画面と並べ替えは「予定」と読む行
    c.execute('UPDATE [作業予定] SET [状態]=NULL WHERE [予定ID]=?', [pid['R']])
    add(c, 'w3', position=f"before:{pid['R']}")
    s3 = seq()
    rec('W3 状態欄が空の予定の行を狙うと、その行の前に入る', s3.index('w3') == s3.index('R') - 1, s3)

    # W4: 狙った行が書く前に始まった
    c.execute("UPDATE [作業予定] SET [状態]='着手' WHERE [予定ID]=?", [pid['S']])
    add(c, 'w4', position=f"before:{pid['S']}")
    s4 = seq()
    rec('W4 狙った行が始まっていたら、その次の予定の前に入る（一番下へ落とさない）',
        s4.index('w4') == s4.index('T') - 1, s4)

    # W5: 狙った行が完了・次の予定が無い
    c.execute("UPDATE [作業予定] SET [状態]='完了' WHERE [予定ID]=?", [pid['T']])
    add(c, 'w5', position=f"before:{pid['T']}")
    s5 = seq()
    rec('W5 狙った行の後ろに予定が無ければ一番下', s5[-1] == 'w5', s5)
    c.close()

    # ---- W6: 後ろの作業が始まった後に入れた設備停止は、すぐ完了にしない（§9.638） ----
    from datetime import datetime, timedelta
    from backend import schedule_calc as sc
    now = datetime.now()
    started = (now - timedelta(hours=1)).isoformat(timespec='seconds')

    def ents(created):
        return [{'id': 1, 'kind': '設備停止', 'state': '予定', 'createdAt': created},
                {'id': 2, 'kind': '作業', 'state': '着手', 'actual': {'startAt': started}}]
    late = ents(now.isoformat(timespec='seconds'))
    sc._settle_passed_stops(late, now, lambda e: 30)
    early = ents((now - timedelta(hours=2)).isoformat(timespec='seconds'))
    sc._settle_passed_stops(early, now, lambda e: 30)
    # W8: 後から実績を入れた（停止を先に入れ、作業の行が後から入って開始をさかのぼって登録した）停止は今までどおり完了
    retro = [{'id': 1, 'kind': '設備停止', 'state': '予定', 'createdAt': (now - timedelta(minutes=5)).isoformat(timespec='seconds')},
             {'id': 2, 'kind': '作業', 'state': '着手', 'createdAt': now.isoformat(timespec='seconds'),
              'actual': {'startAt': started}}]
    sc._settle_passed_stops(retro, now, lambda e: 30)
    rec('W8 停止の後に作業の行が入り、開始をさかのぼって登録したときは、その停止は完了（時刻の登録を促す・§9.514）',
        retro[0]['state'] == '完了', retro[0]['state'])
    rec('W6 後ろの作業が始まった後に入れた停止は予定のまま・始まる前からあった停止は完了',
        late[0]['state'] == '予定' and early[0]['state'] == '完了', [late[0]['state'], early[0]['state']])
    # W7: 完了したロットの上の停止へ時刻を入れる決まり（§9.605）も、完了したロットが始まった後に入れた停止には当てない
    done_ents = [{'id': 1, 'kind': '設備停止', 'state': '予定', 'createdAt': now.isoformat(timespec='seconds'), 'order': 1},
                 {'id': 2, 'kind': '作業', 'state': '完了', 'lotNo': 'L1', 'order': 2,
                  'actual': {'startAt': started, 'endAt': (now - timedelta(minutes=30)).isoformat(timespec='seconds')}}]
    sc._settle_stop_times(done_ents, lambda e: 30)
    rec('W7 完了したロットが始まった後に入れた停止は、完了で自動の時刻を入れない（共有へ書き戻さない）',
        done_ents[0]['state'] == '予定' and 'stopTimesToSave' not in done_ents[0],
        {k: done_ents[0].get(k) for k in ('state', 'doneReason')})
finally:
    shutil.rmtree(tmp, ignore_errors=True)

print(f'== {sum(R)}/{len(R)} PASS ==')
sys.exit(0 if all(R) else 1)
