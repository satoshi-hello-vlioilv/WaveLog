"""test_ddllint.py: 後から足した列は「無ければ足す」——同時に走っても壊れない（§9.315）

利用者の報告:
  「起動時に *読み込みに失敗しました: 操業データ項目マスタの読込に失敗しました:
    duplicate column name: 丸め方* と出る。リロードして再度読み込みをさせると
    正しく読み込めるようになる」

現場ではマスタを作り直さず「無ければ足す」で移行する（§9.216 ②）。その処理は
どこも `PRAGMA table_info` で今ある列を読み、無い列だけ `ALTER TABLE ADD COLUMN`
する形だった——**読んでから足すまでのあいだに、別のリクエストが同じ列を足せる**。
`flask_app.run(threaded=True)`（§9.98で外さないと決めてある）なので、画面を開いた
瞬間に走る何本かの問い合わせが素直に重なる。2本とも「無い」と見て2本とも足しに
行き、後の1本が `duplicate column name` で落ちる。

**その版へ上げた最初の1回にしか起きない**（次からは列が在るのでALTERを通らない）
ので、**リロードすると直る**——原因に辿り着きにくいのはこのため。

ここで固定するのは3つ。
  1. 素の `ALTER TABLE ... ADD COLUMN` を新しく書かない（窓口は1箇所）
  2. 「足そうとしたら既に在った」は失敗にしない（同時に走っても壊れない）
  3. **それ以外の失敗は握り潰さない**（列が無いまま先へ進むほうが悪い）
"""
import os
import shutil
import sqlite3
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

import _pycache_bootstrap  # noqa: E402,F401 副作用のためのimport（.pycの置き場）
from backend import sqlite_io  # noqa: E402
from backend.db_access import DBS, add_missing_columns, connect  # noqa: E402

RESULTS = []


def rec(name, ok, detail=''):
    RESULTS.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + (' -- ' + str(detail) if detail else ''))


# ---- 1) 素の ADD COLUMN は窓口の1箇所だけ ---------------------------------
# **散らばった場所で気を付けるのではなく、入口で1回だけ落とす**（§9.113）。
# 新しいマスタを足した人がここを通さずに書くと、同じ不具合が別の列で戻る。
raw = []
for path in sorted((ROOT / 'backend').rglob('*.py')):
    text = path.read_text(encoding='utf-8', errors='ignore')
    for i, line in enumerate(text.splitlines(), 1):
        code = line.split('#')[0]
        if 'ADD COLUMN' not in code:
            continue
        if path.name == 'sqlite_io.py':
            continue          # 窓口そのもの（§9.329でdb_accessから出した）
        raw.append(f'{path.relative_to(ROOT)}:{i}')
rec('素の ALTER TABLE ADD COLUMN は窓口の外に無い（§9.315）',
    not raw, ' / '.join(raw) or 'なし')
# 窓口の中でも1文だけ（2つ持つと片方だけ直した状態が作れる）。
_dbsrc = (ROOT / 'backend' / 'sqlite_io.py').read_text(encoding='utf-8')
_hits = [l for l in _dbsrc.splitlines() if 'ADD COLUMN' in l.split('#')[0]]
rec('窓口の中の ADD COLUMN も1文だけ', len(_hits) == 1, f'{len(_hits)}件')

# ---- 2) 「もう在った」は失敗にしない -------------------------------------
# **決め打ちで確かめる**——スレッドの重なりに頼ると、速いマシンでは
# すれ違って通ってしまう（直っていなくても緑になる網は網ではない）。
# `cols()`が「無い」と答える状況を作れば、ALTERは必ず duplicate で落ちる。
tmp = Path('/tmp/wl_ddllint.sqlite3')
try:
    tmp.unlink()
except Exception:
    pass
with connect(tmp) as c:
    c.cursor().execute('CREATE TABLE [T] ([id] INTEGER PRIMARY KEY, [a] TEXT)')
    c.commit()
    real_cols = sqlite_io.cols
    try:
        # 差し替えるのは **sqlite_io の名前**（§9.329で窓口ごと移した。
        # db_access 側を差し替えても届かず、この節が素通りする）。
        sqlite_io.cols = lambda _c, _t: ['id']        # [a] を「無い」と答える
        # **前提を確かめること**——差し替えが届いていないと ALTER そのものが
        # 走らず、「落ちない」も「戻り値が空」も**素通りで真になる**
        # （§9.329で窓口を移したとき、実際にこの形で通った）。
        rec('前提: cols の差し替えが窓口へ届いている',
            sqlite_io.cols(c, 'T') == ['id'], str(sqlite_io.cols(c, 'T')))
        got, raised = None, ''
        try:
            got = add_missing_columns(c, 'T', (('a', 'TEXT'),))
        except Exception as e:
            raised = f'{type(e).__name__}: {e}'
        rec('同時に足されていても落ちない（duplicate column name を失敗にしない）',
            not raised, raised)
        rec('自分が足したことにはしない（戻り値に入れない）', got == [], str(got))
    finally:
        sqlite_io.cols = real_cols
    # ふつうに足せることも見る（前提）。
    added = add_missing_columns(c, 'T', (('c', 'TEXT'),))
    rec('前提: 無い列はふつうに足せる', added == ['c'], str(added))
# **それ以外の失敗は握り潰さない**——列が無いまま先へ進むと、別の場所で
# 「そんな列は無い」と落ちて原因が遠くなる。読み取り専用で開けば、ALTERは
# 必ず本物の失敗になる（duplicate ではない）。
raised2 = ''
with connect(tmp, True) as c:
    try:
        add_missing_columns(c, 'T', (('d', 'TEXT'),))
    except Exception as e:
        raised2 = f'{type(e).__name__}: {e}'
rec('本物の失敗はそのまま返す（黙って進まない）',
    'readonly' in raised2.lower(), raised2 or '送出しなかった')
try:
    tmp.unlink()
except Exception:
    pass

# ---- 3) 報告そのもの: 起動時の同時読み込みで落ちない ----------------------
# **本物のマスタの写しで、本物の`ensure_*`を同時に走らせる**（§9.315）。
# 「丸め方」を落とした状態＝その版へ上げた直後の端末を作ってから測る
# ——落とさずに測ると ALTER を一度も通らず、直す前でも通ってしまう。
work = Path('/tmp/wl_ddllint_master.sqlite3')
src = DBS['MASTER']['path']
if not Path(src).exists():
    rec('マスタDBが見つからないため③は測っていない', False, str(src))
else:
    shutil.copyfile(src, work)
    from backend.repositories import operation_repo as op   # noqa: E402
    dropped = ''
    with connect(work) as c:
        try:
            c.cursor().execute('ALTER TABLE [操業データ項目マスタ] DROP COLUMN [丸め方]')
            c.commit()
        except Exception as e:
            dropped = str(e)
    with connect(work, True) as c:
        have = {r[1] for r in c.cursor().execute('PRAGMA table_info([操業データ項目マスタ])')}
    rec('前提: 「丸め方」が無い端末を作れている（この版へ上げた直後の姿）',
        '丸め方' not in have, dropped or f'sqlite {sqlite3.sqlite_version}')

    errs = []
    bar = threading.Barrier(2)

    def work_one(n):
        try:
            bar.wait()
            with connect(work) as c2:
                op.ensure_item_table(c2)
        except Exception as e:
            errs.append(f'{n}: {type(e).__name__}: {e}')
    ths = [threading.Thread(target=work_one, args=(i,)) for i in range(2)]
    for t in ths:
        t.start()
    for t in ths:
        t.join()
    rec('起動時に同時に読み込んでも「duplicate column name」で落ちない（§9.315）',
        not errs, ' / '.join(errs) or 'なし')
    with connect(work, True) as c:
        have2 = {r[1] for r in c.cursor().execute('PRAGMA table_info([操業データ項目マスタ])')}
    rec('列はちゃんと足されている', '丸め方' in have2)
    try:
        work.unlink()
    except Exception:
        pass

ng = len([r for r in RESULTS if not r])
print(f'\n{len(RESULTS) - ng} PASS / {ng} FAIL')
sys.exit(1 if ng else 0)
