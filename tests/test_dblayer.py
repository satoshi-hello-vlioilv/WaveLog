# -*- coding: utf-8 -*-
"""test_dblayer.py: `db_access`の層と、読み込みの副作用を固定する
（§9.329、REVIEW 3-2）。

============================================================
なぜ要るか
------------------------------------------------------------
`backend/db_access.py`は「SQLiteの開き方」と「置き場の答え（DBS・パス設定
マスタ）」を1つのファイルで持っており、しかも**読み込んだだけでマスタDBへ
書いていた**（旧`config/local.json`の一度きりの移行）。そのため

 * 接続の仕方だけが要る`db_mirror`・`master_share`・`master_repo`が、
   置き場の答えごと読み込むことになり、その答えは`db_mirror`を必要とする
   ——輪。輪は関数の中へimportを逃がして避けていたが、逃がすと
   **誰が誰を必要とするかがファイルの頭から読めなくなる**。
 * `import backend.db_access`にファイル書込という副作用があり、呼ぶ側からは
   何が起きるか読めない（検証も「importしない」以外に避けようがない）。

------------------------------------------------------------
約束
------------------------------------------------------------
 * `backend/sqlite_io.py`は**置き場を知らない**（`db_access`も`DBS`も
   パス設定マスタも読まない）。ここへ持ち込んだら分けた意味が無くなる。
 * `db_access`の関数の中のbackend宛importは、理由付きの一覧のものだけ。
 * `db_access`と`access_mode`／`master_share`／`master_repo`の相互importは0。
 * **`import backend.db_access`はどのファイルも変えない**（別プロセスで
   `db/`の中身をハッシュして突き合わせる）。書くのは`bootstrap()`だけで、
   それを呼ぶのは`app.py`の1箇所。
 * 網そのものが素通りしないことを確かめる（欠陥を注いで落ちる）。
============================================================
"""
import ast
import collections
import hashlib
import os
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BACKEND = ROOT / 'backend'
R = []

# db_access の関数の中から読んでよいbackendのモジュールと、その理由。
# **増やすときは理由を書くこと**（理由の書けない遅延importは、輪を隠して
# いるだけ）。
DEEP_ALLOW = {
    'backend.db_mirror':
        '写し（読む先）を引く。db_mirrorは逆に置き場の答え（DBS・パス設定）を'
        '必要とするので、この1組だけは残っている。解くには置き場の答えを'
        '別モジュールへ出す必要がある（REVIEW 3-2 の②。未実施）',
}
NO_CYCLE_WITH = ('backend.access_mode', 'backend.master_share',
                 'backend.repositories.master_repo')


def rec(name, ok, detail=''):
    R.append(ok)
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def modules(root):
    out = {}
    for f in root.rglob('*.py'):
        rel = f.relative_to(root).with_suffix('')
        out['backend.' + '.'.join(rel.parts)] = f
    return out


def targets(mod, node, known):
    """import文が指すbackendのモジュール名（解決できたものだけ）。"""
    out = []
    if isinstance(node, ast.ImportFrom):
        if node.level:
            base = mod.split('.')
            base = base[:len(base) - node.level]
            pre = '.'.join(base + ([node.module] if node.module else []))
        else:
            pre = node.module or ''
        if not pre.startswith('backend'):
            return out
        for a in node.names:
            cand = pre + '.' + a.name
            out.append(cand if cand in known else pre)
    else:
        for a in node.names:
            if a.name.startswith('backend'):
                out.append(a.name)
    return [o for o in out if o in known and o != mod]


def graph(root):
    """(頭のimport, 関数の中のimport) をモジュール名→集合で返す。"""
    known = modules(root)
    top = collections.defaultdict(set)
    deep = collections.defaultdict(set)
    for name, f in known.items():
        tree = ast.parse(f.read_text(encoding='utf-8'))
        for n in ast.walk(tree):
            if not isinstance(n, (ast.Import, ast.ImportFrom)):
                continue
            box = top if any(n is c for c in tree.body) else deep
            for d in targets(name, n, known):
                box[name].add(d)
    return top, deep


def mutual(g):
    out = set()
    for a in g:
        for b in g[a]:
            if a in g.get(b, ()):
                out.add(tuple(sorted((a, b))))
    return out


def db_digest():
    """db/ の中身の指紋（ファイル名→中身のハッシュ）。"""
    d = ROOT / 'db'
    out = {}
    if not d.exists():
        return out
    for f in sorted(d.rglob('*')):
        if f.is_file():
            try:
                out[str(f.relative_to(d))] = hashlib.sha1(f.read_bytes()).hexdigest()
            except OSError:
                out[str(f.relative_to(d))] = 'unreadable'
    return out


def main():
    top, deep = graph(BACKEND)

    # 1) sqlite_io は置き場を知らない
    src = (BACKEND / 'sqlite_io.py').read_text(encoding='utf-8')
    tree = ast.parse(src)
    imported = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            imported |= set(targets('backend.sqlite_io', n, modules(BACKEND)))
    bad = sorted(m for m in imported
                 if m in ('backend.db_access', 'backend.db_mirror', 'backend.paths'))
    rec('sqlite_io は置き場（db_access／db_mirror／paths）を読まない', not bad, bad)
    # 実行される字として DBS が出てこないこと（説明文の中は数えない——
    # ここには「持ち込まないこと」と書いてあるので、素の文字列検索では必ず当たる）
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    rec('sqlite_io のコードに DBS が出てこない', 'DBS' not in names)

    # 2) db_access の関数の中のimport
    got = deep.get('backend.db_access', set())
    extra = sorted(got - set(DEEP_ALLOW))
    rec('db_access の関数内importは理由付きの一覧だけ', not extra, extra)
    rec('一覧に載っているものは実際に使われている（腐った例外を残さない）',
        not sorted(set(DEEP_ALLOW) - got), sorted(set(DEEP_ALLOW) - got))
    for k, why in DEEP_ALLOW.items():
        rec(f'例外 {k} に理由が書いてある', len(str(why).strip()) >= 20)

    # 3) 相互import
    both = collections.defaultdict(set)
    for g in (top, deep):
        for k, v in g.items():
            both[k] |= v
    pairs = mutual(both)
    hit = sorted(p for p in pairs if 'backend.db_access' in p
                 and (p[0] in NO_CYCLE_WITH or p[1] in NO_CYCLE_WITH))
    rec('db_access は access_mode／master_share／master_repo と相互importしない',
        not hit, hit)
    rec('頭（モジュール直下）のimportに輪が無い', not mutual(top), sorted(mutual(top)))

    # 4) import では書かない。
    #    **中身が変わったかだけを見ないこと**——移行の目印が既に書かれている
    #    端末では、読み込み時に書きに行っても「済んでいる」で早く戻るので
    #    1バイトも変わらず、網が空振りする（§9.325）。**書ける形で開いたか**
    #    そのものを別プロセスで数える。
    probe_src = (
        'import sqlite3\n'
        'opened=[]\n'
        '_real=sqlite3.connect\n'
        'def spy(*a,**k):\n'
        "    ro = bool(k.get('uri')) and 'mode=ro' in str(a[0] if a else '')\n"
        '    if not ro: opened.append(str(a[0] if a else k.get("database")))\n'
        '    return _real(*a,**k)\n'
        'sqlite3.connect=spy\n'
        'import backend.db_access\n'
        'print("WRITABLE_OPEN:"+"|".join(opened))\n')
    before = db_digest()
    r = subprocess.run([sys.executable, '-c', probe_src],
                       cwd=str(ROOT), capture_output=True, text=True, timeout=120)
    after = db_digest()
    changed = sorted(k for k in set(before) | set(after) if before.get(k) != after.get(k))
    line = [x for x in r.stdout.split('\n') if x.startswith('WRITABLE_OPEN:')]
    opened = [x for x in (line[0][len('WRITABLE_OPEN:'):].split('|') if line else []) if x]
    rec('import backend.db_access が書ける形でDBを開かない', r.returncode == 0 and not opened,
        (r.returncode, opened, r.stderr[-300:]))
    # **並列で回しているときは測れない**（§9.369）。`db/`は全部の本が共有して
    # いるので、隣の本が作った`master.sqlite3`が差分に出る——それを`import`の
    # せいにすると、直しようのない赤が毎回出る（実際にCIの1段目がそうなった）。
    # 上の「書ける形で開かない」が本命の判定で、こちらはその裏取り。
    # **測れないときは黙って通さず、測っていないと書く。**
    if os.environ.get('WAVELOG_PARALLEL'):
        rec('import backend.db_access が db/ の中身を変えない（並列中は裏取りのみ）',
            True, '並列で回しているため差分は測っていない: ' + (str(changed) or 'なし'))
    else:
        rec('import backend.db_access が db/ の中身を変えない', not changed, changed)

    # 5) 書くのは bootstrap()。呼ぶのは app.py の1箇所
    rec('db_access.bootstrap() がある', 'def bootstrap()' in (BACKEND / 'db_access.py').read_text(encoding='utf-8'))
    app = '\n'.join(l.split('#')[0] for l in (ROOT / 'app.py').read_text(encoding='utf-8').split('\n'))
    rec('app.py が bootstrap() を1回だけ呼ぶ', app.count('db_access.bootstrap()') == 1,
        app.count('db_access.bootstrap()'))

    # 6) 網そのものが素通りしないこと——欠陥を注いで落ちることを見る
    probe = BACKEND / '_dblayer_probe.py'
    try:
        probe.write_text('from . import db_access  # noqa: F401 網の確認用\n'
                         'def f():\n from . import db_mirror  # noqa: F401\n', encoding='utf-8')
        t2, d2 = graph(BACKEND)
        rec('網が「関数の中のimport」を実際に数えている',
            'backend.db_mirror' in d2.get('backend._dblayer_probe', set())
            and 'backend.db_access' in t2.get('backend._dblayer_probe', set()))
    finally:
        probe.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # 途中で止まっても件数を偽らない（§9.244）
        rec('例外で止まらない', False, repr(e))
    n_ok = sum(1 for x in R if x)
    print(f'\n{n_ok} PASS / {len(R) - n_ok} FAIL')
    sys.exit(0 if all(R) else 1)
