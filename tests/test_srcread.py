#!/usr/bin/env python3
"""test_srcread.py: 読み取り専用のデータソースは写しから読む（§9.317）。

============================================================
なぜ要るか
------------------------------------------------------------
利用者の報告（実機）:
  「測定画面を開けません: [WinError 5] アクセスが拒否されました。:
    '\\\\Nlmsrvngy03\\Read\\【New】仕掛\\台帳\\SIKADEF.sqlite3'」
  「書き込み権限がないところにある品質ファイルを読んでいるので開き方に
    問題があるのでしょうか？…競合を避けるため、そもそもローカル一次領域に
    コピーしてから読んでいるはずです。」
  「いずれにしても編集モードでの測定作業に影響がないようにしてほしいです。」

そのとおりで、欠陥は2つ重なっていた。

 ① **`DBS`から直に引いていた**（`/api/measurement/context`・
    `/api/quality/analysis`）。`DBS`が持つのは設定に書いてある元のパス＝
    **共有そのもの**で、`cfg()`が`db_mirror`の写しへ差し替える。一覧
    （`/api/table`）は`cfg()`を通るので、**同じ端末でも一覧は出るのに
    測定画面だけ開けない**という分かりにくい形になっていた。

 ② **開く前に`Path.exists()`を置いていた**。`Path.exists()`が「無い」と
    読み替えるのは ENOENT/ENOTDIR/EBADF/ELOOP と WinError 21/123/1921
    だけで、**WinError 5（アクセスが拒否されました）はそのまま送出する**。
    読み取り専用の共有では、ファイルは読めるのに属性の問い合わせだけが
    5で断られることがあり、**確認のつもりの1行が唯一の失敗原因**になる。

さらに、品質情報が読めないだけで**測定画面ごと開けなくなっていた**
（例外が`loadMeasurementContext`まで伝わり、記録の初回保存も走らない）。

ここで固定するのは次の6つ。
 1. 読み取り専用のデータソースを`DBS`から直に引かない（許可一覧の外で）
 2. 測定コンテキストは**写しから読む**（写しと実物の中身を食い違わせて見分ける）
 3. 品質データ分析も**写しから読む**
 4. **存在確認で送出しない**——`Path.exists()`がWinError 5を投げても開ける
 5. **品質が読めなくても測定は続く**（200で返り、理由がdiagnosticsに載る）
 6. 読めなかったことを黙らない（理由とパスを返す）

2・3は**中身をわざと食い違わせる**（§9.268）。「読む先を答える関数」だけを
見る網は、呼ぶ側がその答えを使っていなくても通る。
============================================================
"""
import ast
import pathlib
import sqlite3
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import apppath  # noqa: F401 `program/` を探索先へ（§9.404）
import app as flask_app                                     # noqa: E402
from backend import db_access as d                          # noqa: E402
from backend import db_mirror as m                          # noqa: E402

R = []
def rec(n, ok, x=''):
    R.append((n, ok, x))
    print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(x) if x else ''))


client = flask_app.app.test_client()

# ------------------------------------------------------------------
# 1. lint: 読み取り専用のデータソースを DBS から直に引かない
# ------------------------------------------------------------------
# **許可は理由付きで数える**（§9.96 と同じ作法）。`DBS['MASTER']`は
# 対象外——マスタは role!='readonly' で、共有に置いたときの写しは
# `master_share`が`_MASTER_PATH`ごと差し替えるので`cfg()`を通らない。
ALLOWED = {
    # 設定そのものを見せる画面。**効いている値**を出すのが役目なので、
    # 写しではなく DBS が正しい。
    'backend/routes/path_config.py': '共通設定の「いま効いている値」',
    'backend/routes/tables.py': 'データソース一覧・接続診断（設定を出す側）',
    'backend/routes/logs.py': '起動の状況（§9.316。見に行っている先を出す）',
    'backend/source_capability.py': '登録内容の下見（保存前の設定も見る）',
    'backend/query_join.py': 'cfg()へ委譲する窓口（source_cfg）',
    'backend/db_mirror.py': '写しを作る側',
    'backend/db_access.py': 'cfg() の定義そのもの',
    'backend/storage_layout.py': '置き場の一覧（設定を出す側）',
    'backend/access_mode.py': 'マスタDB（MASTERのみ）',
    'backend/repositories/schedule_repo.py': 'マスタDB（MASTERのみ）',
}


def _dbs_lookups(path):
    """そのファイルの `DBS[...]` / `DBS.get(...)` のうち、
    **'MASTER' 以外**を引いているものを数える。"""
    try:
        tree = ast.parse(path.read_text(encoding='utf-8'))
    except SyntaxError:
        return []
    out = []

    def is_dbs(node):
        return (isinstance(node, ast.Name) and node.id in ('DBS', '_DBS'))

    for n in ast.walk(tree):
        key = None
        if isinstance(n, ast.Subscript) and is_dbs(n.value):
            key = n.slice
        elif (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
              and n.func.attr == 'get' and is_dbs(n.func.value) and n.args):
            key = n.args[0]
        if key is None:
            continue
        if isinstance(key, ast.Constant) and key.value == 'MASTER':
            continue
        out.append(getattr(n, 'lineno', 0))
    return out


bad = []
for f in sorted((ROOT / 'backend').rglob('*.py')):
    rel = f.relative_to(ROOT).as_posix()
    if rel in ALLOWED:
        continue
    hits = _dbs_lookups(f)
    if hits:
        bad.append(f'{rel}:{",".join(map(str, hits))}')
rec('読み取り専用のデータソースをDBSから直に引いていない（cfg()を通す）',
    not bad, ' / '.join(bad) if bad else '許可: ' + str(len(ALLOWED)) + '件')

# ------------------------------------------------------------------
# 材料を自分で用意する（§9.291 ①）
# ------------------------------------------------------------------
QKEY = d.QUALITY_DB_KEY
tmp = pathlib.Path(tempfile.mkdtemp(prefix='wl-srcread-'))
SHARE = tmp / 'share' / 'SIKADEF.sqlite3'
MIRROR = tmp / 'mirror' / 'SIKADEF.mirror.sqlite3'


def seed(path, lot, comment):
    path.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(path))
    c.execute('CREATE TABLE [品質情報] ([ロット番号] TEXT,[発生設備] TEXT,'
              '[登録日時] TEXT,[異常内容] TEXT,[コメント] TEXT,'
              '[最終処置] TEXT,[保留設定日] TEXT,[保留解除] TEXT)')
    c.execute('INSERT INTO [品質情報] VALUES (?,?,?,?,?,?,?,?)',
              (lot, 'EQ', '2026-09-03 10:00:00', 'キズ', comment, '', '', ''))
    c.commit()
    c.close()


LOT = 'SRCREAD1'
# **中身を食い違わせる**——どちらを読んだかは中身でしか見分けられない。
seed(SHARE, LOT, '共有を直接読んだ')
seed(MIRROR, LOT, '写しから読んだ')

orig_entry = dict(d.DBS.get(QKEY) or {}) if QKEY else None
orig_read_path = m.read_path
ok_setup = bool(QKEY and orig_entry)
if ok_setup:
    d.DBS[QKEY] = dict(orig_entry, path=SHARE, role='readonly', preferred='品質情報')
    m.read_path = lambda key, remote: (MIRROR if key == QKEY else orig_read_path(key, remote))
rec('検証の材料を用意できた（役割「品質」のデータソースが在る）', ok_setup,
    f'key={QKEY}')


def context(lot=LOT):
    return client.get(f'/api/measurement/context?lot={lot}&equipment=')


try:
    # --- 2. 測定コンテキストは写しから読む ---
    r = context()
    j = r.get_json() or {}
    got = [q.get('コメント') for q in (j.get('quality') or [])]
    rec('測定コンテキストは写しから読む（共有を直接開かない）',
        r.status_code == 200 and got == ['写しから読んだ'],
        f'{r.status_code} {got} {j.get("diagnostics",{}).get("quality_error","")}')

    # --- 3. 品質データ分析も写しから読む ---
    r = client.get('/api/quality/analysis?table=品質情報&group_col=コメント'
                   '&metric=count&dimension=category')
    j = r.get_json() or {}
    labels = [str(x.get('label') or x.get('name') or '') for x in (j.get('rows') or j.get('data') or [])]
    txt = str(j)
    rec('品質データ分析も写しから読む',
        r.status_code == 200 and '写しから読んだ' in txt and '共有を直接読んだ' not in txt,
        f'{r.status_code} {labels or txt[:80]}')

    # --- 4. Path.exists が WinError 5 を投げても開ける ---
    real_exists = pathlib.Path.exists
    denied = {'n': 0}

    def boom(self, *a, **k):
        # 共有の読み取り専用フォルダーで実際に起きる形（WinError 5）。
        if str(self) in (str(SHARE), str(MIRROR)):
            denied['n'] += 1
            raise PermissionError(5, 'アクセスが拒否されました。', str(self))
        return real_exists(self, *a, **k)

    pathlib.Path.exists = boom
    try:
        r = context()
        j = r.get_json() or {}
        got = [q.get('コメント') for q in (j.get('quality') or [])]
    finally:
        pathlib.Path.exists = real_exists
    rec('存在確認が WinError 5 でも測定コンテキストは開ける',
        r.status_code == 200 and got == ['写しから読んだ'],
        f'{r.status_code} exists呼び出し={denied["n"]} {got}')

    # --- 5. 品質が読めなくても測定は続く（理由は返す） ---
    m.read_path = lambda key, remote: (tmp / 'missing' / 'none.sqlite3') if key == QKEY else orig_read_path(key, remote)
    r = context()
    j = r.get_json() or {}
    diag = j.get('diagnostics') or {}
    rec('品質が読めなくても測定コンテキストは200で返る（測定を止めない）',
        r.status_code == 200, f'{r.status_code}')
    rec('読めなかった理由とパスを返す（黙って0件にしない）',
        bool(diag.get('quality_error')) and bool(diag.get('quality_path')),
        str(diag.get('quality_error'))[:70])
    rec('マスタ由来の中身は今までどおり返る（品質の失敗に巻き込まれない）',
        isinstance(j.get('max_strips'), int) and 'tables' in diag,
        f'max_strips={j.get("max_strips")} tables={len(diag.get("tables") or [])}')
finally:
    if ok_setup:
        d.DBS[QKEY] = orig_entry
    m.read_path = orig_read_path
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)

ng = [x for x in R if not x[1]]
print(f'\n== {len(R)-len(ng)}/{len(R)} PASS ==')
sys.exit(1 if ng else 0)
