#!/usr/bin/env python3
"""test_atomicio.py: 置き換えが拒まれたときの粘り方（§9.108）。

============================================================
なぜ要るか
------------------------------------------------------------
実機のログに、同じ形の失敗が2つ出た。

    スケジュール編集セッションの解放に失敗しました: [WinError 5]
      '...schedule.sessions.<uuid>.tmp' -> '...schedule.sessions.json'
    SIKALOT の写しを置き換えられませんでした: [WinError 5]
      '...db\\cache\\SIKALOT.sqlite3.tmp' -> '...db\\cache\\SIKALOT.sqlite3'

どちらも回線の不調ではない。**Windowsは、開かれているファイルへの
置き換えを拒む**(`MoveFileEx`が`ERROR_ACCESS_DENIED`)。POSIXの
`rename(2)`は誰が開いていても成功するので、**Linuxでは絶対に再現しない**。
だからここでは`os.replace`を差し替えて、その規則を持ち込んで確かめる。

固定するのは4つ。
 1. 待てば直る失敗（WinError 5/32/33/1224、EBUSY）だけを再試行する
 2. 恒久的な失敗は**再試行しない**（間違いに気づくのが遅れるだけ）
 3. 予算を使い切ったら、最後の例外をそのまま送出する（握り潰さない）
 4. 削除(unlink)は失敗しても例外にしない（どれも後始末で、次の周回で
    やり直せばよい）
============================================================
"""
import errno
import os
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import atomic_io  # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def win(code, msg='アクセスが拒否されました。'):
    e = PermissionError(13, msg)
    e.winerror = code
    return e


tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl_atomic_'))
_real_replace, _real_unlink = os.replace, os.unlink

try:
    # ---- 1) 何を「待てば直る」とみなすか ----
    for code in (5, 32, 33, 1224):
        rec(f'WinError {code} は待てば直る扱い', atomic_io.is_transient(win(code)))
    rec('WinError 2(見つからない)は待たない', not atomic_io.is_transient(win(2, 'not found')))
    rec('WinError 87(引数が不正)は待たない', not atomic_io.is_transient(win(87, 'bad param')))
    # POSIXのEACCESは本物の権限エラーであることがほとんど。ここを待つ側に
    # 入れると、権限設定の誤りが「遅くなるだけ」で表に出なくなる。
    rec('POSIXのEACCESは待たない', not atomic_io.is_transient(PermissionError(errno.EACCES, 'denied')))
    rec('POSIXのEBUSYは待つ', atomic_io.is_transient(OSError(errno.EBUSY, 'busy')))
    rec('OSErrorでないものは待たない', not atomic_io.is_transient(ValueError('x')))

    # ---- 2) 何回か拒まれても、空いたら通る ----
    atomic_io.reset_stats()
    src, dst = tmp / 'a.txt', tmp / 'b.txt'
    src.write_text('hello', encoding='utf-8')
    dst.write_text('old', encoding='utf-8')
    left = [3]

    def flaky(s, d):
        if left[0] > 0:
            left[0] -= 1
            raise win(5)
        _real_replace(s, d)

    os.replace = flaky
    try:
        n = atomic_io.replace(src, dst, budget_sec=3.0, label='t.flaky')
    finally:
        os.replace = _real_replace
    rec('拒まれても空いたら通る', dst.read_text(encoding='utf-8') == 'hello' and not src.exists(),
        f'{n}回やり直した')
    rec('やり直した回数を数えている', n == 3, f'n={n}')
    st = atomic_io.stats().get('t.flaky') or {}
    rec('実績に再試行が記録される', st.get('retried') == 1 and st.get('retries') == 3 and st.get('failed') == 0,
        str(st))

    # ---- 3) 恒久的な失敗は1回で諦める ----
    # **ここを再試行すると、間違いに気づくのが遅れるだけ**になる。
    atomic_io.reset_stats()
    calls = [0]

    def permanent(s, d):
        calls[0] += 1
        raise win(87, 'パラメーターが正しくありません。')

    src.write_text('x', encoding='utf-8')
    os.replace = permanent
    try:
        atomic_io.replace(src, dst, budget_sec=3.0, label='t.perm')
        raised = False
    except PermissionError:
        raised = True
    finally:
        os.replace = _real_replace
    rec('恒久的な失敗はそのまま送出する', raised)
    rec('恒久的な失敗は1回しか試さない', calls[0] == 1, f'{calls[0]}回')
    rec('実績に失敗が記録される', (atomic_io.stats().get('t.perm') or {}).get('failed') == 1)

    # ---- 4) 予算を使い切ったら、握り潰さずに送出する ----
    atomic_io.reset_stats()
    tries = [0]

    def always_busy(s, d):
        tries[0] += 1
        raise win(5)

    os.replace = always_busy
    try:
        atomic_io.replace(src, dst, budget_sec=0.3, label='t.busy')
        raised = False
    except PermissionError:
        raised = True
    finally:
        os.replace = _real_replace
    rec('予算切れでも例外を握り潰さない', raised)
    rec('予算のあいだ何度か試している', tries[0] >= 3, f'{tries[0]}回')
    rec('予算切れは失敗として記録される', (atomic_io.stats().get('t.busy') or {}).get('failed') == 1)

    # ---- 5) 削除は失敗しても例外にしない ----
    # 呼び出し元はどれも後始末なので、消せないこと自体で処理を止める意味が無い。
    victim = tmp / 'c.txt'
    victim.write_text('c', encoding='utf-8')
    os.unlink = lambda p, **kw: (_ for _ in ()).throw(win(5))
    try:
        ok = atomic_io.unlink(victim, budget_sec=0.2, label='t.del')
    finally:
        os.unlink = _real_unlink
    rec('消せなくても例外にしない', ok is False)
    rec('消せなかったものは残っている', victim.exists())
    rec('空いていれば消せる', atomic_io.unlink(victim, budget_sec=0.2) is True and not victim.exists())
    rec('もともと無ければ消せた扱い', atomic_io.unlink(tmp / 'nope.txt', budget_sec=0.2) is True)

    # ---- 6) 置き場がクラウド同期フォルダかを見分ける ----
    # 実機の写しの置き場は C:\boxdrive\Box\... の中だった。同期のあいだ
    # ファイルを掴まれるので、再試行では吸収しきれない。
    rec('Box Driveの中だと分かる',
        atomic_io.cloud_sync_hint(r'C:\boxdrive\Box\(D)_仕上課\...\db\cache') == 'Box Drive')
    rec('OneDriveの中だと分かる',
        atomic_io.cloud_sync_hint(r'C:\Users\me\OneDrive\WaveLog\db') == 'OneDrive')
    rec('ふつうのローカルは何も言わない',
        atomic_io.cloud_sync_hint(r'C:\WaveLog\db\cache') == '' and atomic_io.cloud_sync_hint('') == '')

finally:
    os.replace, os.unlink = _real_replace, _real_unlink
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(f' - {n} {d}')
sys.exit(1 if ng else 0)
