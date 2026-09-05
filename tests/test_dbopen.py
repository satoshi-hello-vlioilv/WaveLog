#!/usr/bin/env python3
"""test_dbopen.py: 共有DBを開くまでの手順が、余計なファイルアクセスで
   失敗しないことを固定する（§9.75）。

   ============================================================
   背景（実際に起きた不具合）
   ------------------------------------------------------------
   ある端末でだけ「仕掛一覧」が

     [WinError 59] 予期しないネットワーク エラーが発生しました。
     \\Nlmsrvngy03\\Read\\【New】仕掛\\SQL\\SIKALOTNOW.sqlite3

   で開けなくなった。その端末では
     ・共有フォルダへアクセスできる
     ・当該ファイルをエクスプローラ／メモ帳で開ける
     ・python から sqlite3.connect() が成功する
   ことが確認できていた。**開けるのに開けない**という矛盾に見えるが、
   原因は接続ではなく「接続の前に入れていた存在確認」だった。

   pathlib の Path.exists() は OSError のうち
     ENOENT / ENOTDIR / EBADF / ELOOP と WinError 21 / 123 / 1921
   だけを「無い」と読み替え、**それ以外はそのまま送出する**。
   ネットワーク共有では WinError 59 のように「一時的に問い合わせできない」
   種類のエラーが起こり、これは送出される。つまり os.stat() だけが失敗し、
   実際のファイルオープンは成功する状況で、確認のつもりの1行が唯一の
   失敗原因になっていた。しかもメッセージが「ファイルが無い」ではなく
   生のネットワークエラーになるため、原因の見当がつかない。

   ここでは Path.exists / Path.stat / Path.resolve を WinError 59 相当で
   失敗させた状態で、それでもDBを開けることを確かめる。
   ============================================================
"""
import sqlite3, sys, pathlib, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.db_access import connect, tables, path_exists_safe   # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

def net_error():
    """WinError 59 相当の OSError。Windows以外でも winerror 属性を持たせて
       同じ分岐を通す（判定は errno ではなく winerror を見るため）。"""
    e = OSError(5, '予期しないネットワーク エラーが発生しました。')
    e.winerror = 59
    return e

# 検証用のDBを1つ作る
tmp = pathlib.Path(tempfile.mkdtemp()) / 'probe.sqlite3'
c = sqlite3.connect(str(tmp))
c.execute('CREATE TABLE [仕掛] ([ロット番号] TEXT)')
c.execute("INSERT INTO [仕掛] VALUES ('L0001')")
c.commit(); c.close()

# ---- 1) 通常の読み取り接続 ----
try:
    with connect(tmp, True) as conn:
        names = tables(conn)
    rec('読み取り専用で開いてテーブル一覧を取れる', names == ['仕掛'], str(names))
except Exception as e:
    rec('読み取り専用で開いてテーブル一覧を取れる', False, f'{type(e).__name__}: {e}')

# ---- 2) 存在確認・stat・resolve が落ちても開ける（本題） ----
orig_exists, orig_stat, orig_resolve = pathlib.Path.exists, pathlib.Path.stat, pathlib.Path.resolve
def boom(self, *a, **k): raise net_error()
pathlib.Path.exists = boom
pathlib.Path.stat = boom
pathlib.Path.resolve = boom
try:
    with connect(tmp, True) as conn:
        names = tables(conn)
    rec('存在確認(os.stat)がネットワークエラーでも接続できる', names == ['仕掛'], str(names))
except Exception as e:
    rec('存在確認(os.stat)がネットワークエラーでも接続できる', False, f'{type(e).__name__}: {e}')

# path_exists_safe は例外を外へ出さず「判定できなかった(None)」を返す
try:
    v = path_exists_safe(tmp)
    rec('存在を確かめられないときは例外ではなくNoneを返す', v is None, repr(v))
except Exception as e:
    rec('存在を確かめられないときは例外ではなくNoneを返す', False, f'{type(e).__name__}: {e}')
finally:
    pathlib.Path.exists, pathlib.Path.stat, pathlib.Path.resolve = orig_exists, orig_stat, orig_resolve

# ---- 3) 本当に無いファイルは、これまでどおり分かる言葉で伝える ----
missing = tmp.parent / 'not-exist.sqlite3'
try:
    with connect(missing, True):
        pass
    rec('存在しないファイルは理由の分かるエラーになる', False, '例外が出なかった')
except FileNotFoundError as e:
    rec('存在しないファイルは理由の分かるエラーになる', 'データベースが見つかりません' in str(e), str(e)[:70])
except Exception as e:
    rec('存在しないファイルは理由の分かるエラーになる', False, f'{type(e).__name__}: {e}')

# ---- 4) URIの組み立て: 絶対パスにresolve()を掛けない ----
# resolve()はWindowsでは実ファイルアクセス(GetFinalPathNameByHandle)で、
# 共有が不安定だとここでも落ちる。UNCを別表記へ書き換えもする。
from backend.db_access import _sqlite_ro_uri   # noqa: E402
pathlib.Path.resolve = boom
try:
    uri = _sqlite_ro_uri(tmp)
    rec('絶対パスならresolve()を呼ばずにURIを作れる', uri.startswith('file:') and 'mode=ro' in uri, uri[:80])
except Exception as e:
    rec('絶対パスならresolve()を呼ばずにURIを作れる', False, f'{type(e).__name__}: {e}')
finally:
    pathlib.Path.resolve = orig_resolve

# ---- 5) UNC共有は4スラッシュ形式(authorityを空にする) ----
# 2スラッシュ形式(file://server/share/...)はサーバー名をURIのauthorityと
# 解釈され、SQLITE_ALLOW_URI_AUTHORITY無しのsqlite3では拒否される。
class _FakeUNC(type(pathlib.Path())):
    """Windowsでなくても as_posix() が //server/share/... を返す偽物。"""
    def is_absolute(self): return True
    def as_posix(self): return '//Nlmsrvngy03/Read/【New】仕掛/SQL/SIKALOTNOW.sqlite3'
try:
    uri = _sqlite_ro_uri(_FakeUNC(tmp))
    rec('UNC共有は file://// の4スラッシュ形式で組み立てる',
        uri.startswith('file:////'), uri[:90])
except Exception as e:
    rec('UNC共有は file://// の4スラッシュ形式で組み立てる', False, f'{type(e).__name__}: {e}')

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(' -', n, d)
sys.exit(1 if ng else 0)
