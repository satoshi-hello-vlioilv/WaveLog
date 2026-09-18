# -*- coding: utf-8 -*-
"""Access(pyodbc)経路を廃止したことの確認。

分岐を消すだけだと、古いパス設定(.accdb)が残った端末で「なぜ繋がらないのか」
分からないまま失敗する。理由と対処を添えて弾くことをここで固定する。
あわせて、SQLite側へ残したAccess方言のSQL関数(Now/Nz/CStr/Val)が
消えていないことも確認する——これはmasters.pyのSQLが今も使っているため、
Access接続の廃止と一緒に消してはいけない。
"""
from __future__ import annotations
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.db_access import connect, DBS   # noqa: E402
from backend import config as app_config     # noqa: E402

R = []


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


# ---- .accdb は理由を添えて弾く ----------------------------------------
for suffix in ('.accdb', '.mdb'):
    try:
        connect(Path(f'/tmp/dummy{suffix}'), True)
        rec(f'{suffix} は弾かれる', False, '例外が出ずに接続を試みた')
    except RuntimeError as e:
        msg = str(e)
        rec(f'{suffix} は弾かれる', True)
        rec(f'{suffix}: 理由が分かる文言', 'Accessファイルへは接続できません' in msg, msg[:60])
        rec(f'{suffix}: 対処が書いてある', 'パス設定' in msg and '.sqlite3' in msg, msg[-60:])
    except Exception as e:      # pyodbcが無い環境でImportError等になっていないこと
        rec(f'{suffix} は弾かれる', False, f'{type(e).__name__}: {e}')

# ---- 未対応エンジンを明示指定した場合 ----------------------------------
try:
    connect(Path('/tmp/dummy.sqlite3'), True, engine='access')
    rec("engine='access' を拒否する", False, '例外が出なかった')
except ValueError as e:
    rec("engine='access' を拒否する", True, str(e)[:50])
except Exception as e:
    rec("engine='access' を拒否する", False, f'{type(e).__name__}: {e}')

# ---- SQLiteは従来どおり開ける ------------------------------------------
with tempfile.TemporaryDirectory() as d:
    p = Path(d) / 'x.sqlite3'
    with connect(p, False) as c:
        c.execute('CREATE TABLE t([名称] TEXT,[有効] INTEGER)')
        c.execute("INSERT INTO t VALUES ('あ',-1)")
        c.commit()
    rec('SQLiteは書き込みで開ける', p.exists())
    with connect(p, True) as c:
        rec('SQLiteは読み取り専用で開ける', c.execute('SELECT COUNT(*) FROM t').fetchone()[0] == 1)
        # Access方言のSQL関数がSQLite側に登録されたままであること
        # (masters.pyのSQLが今も使っているので、接続統一と一緒に消さない)
        got = c.execute("SELECT Nz(NULL,'x'),CStr(12),Val('34.5')").fetchone()
        rec('Nz/CStr/Val が使える', got == ('x', '12', 34.5), str(got))
        rec('Now() が使える', bool(c.execute('SELECT Now()').fetchone()[0]))

# ---- 起動時の必須パッケージから pyodbc が外れている ---------------------
rec('必須パッケージにpyodbcを含まない',
    'pyodbc' not in app_config.REQUIRED_PACKAGES, str(app_config.REQUIRED_PACKAGES))
# **program/requirements.txt からも外れていること。** `REQUIRED_PACKAGES`は
# `('flask',)`だけなので普段は誰も気づかないが、**flaskが入っていない端末では
# `pip install -r program/requirements.txt` が走る**（`setup_check.ensure_packages`）
# ——そこに残っていると、使っていないpyodbcまで入れに行く。まさに
# 「依存を増やさない」で避けたかった失敗の芽で、実際に残っていた。
_req = (Path(__file__).resolve().parent.parent / 'program' / 'requirements.txt').read_text(encoding='utf-8')
_req_names = [x.strip().split('==')[0].split('>=')[0].strip().lower()
              for x in _req.splitlines()
              if x.strip() and not x.strip().startswith('#')]
rec('program/requirements.txt にもpyodbcを残さない',
    'pyodbc' not in _req_names, ','.join(_req_names))
# **一覧そのものが増えていないこと**（§CLAUDE「依存を足さない」）。
# 増やすなら、この網を書き直すところまでが1組。
rec('必要な部品はflaskだけ', _req_names == ['flask'], ','.join(_req_names))

# ---- 既定の接続先はすべてSQLite ----------------------------------------
engines = {k: v['engine'] for k, v in DBS.items()}
rec('全DBの接続先がsqlite', set(engines.values()) == {'sqlite'}, str(engines))

print('\n=== SUMMARY ===')
print('%d/%d passed' % (sum(R), len(R)))
sys.exit(0 if all(R) else 1)
