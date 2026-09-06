#!/usr/bin/env python3
"""test_rawmaster.py: 専用タブを持たないマスタを階層の中で編集する（§9.249 ②）。

============================================================
なぜ要るか
------------------------------------------------------------
「テーブル生データ」からしか見られなかった表を、マスタ管理の階層へ出して
**編集できる**ようにした。ここで守るのは4つ。

 1. **対応表が腐っていない**——`COVERED_BY`が指すタブのキーが
    `master-defs.js`の`MASTER_DEFS`に実在すること。タブを消したり
    キーを変えたりすると、その表は「専用タブがある」と言われたまま
    **どこからも開けない**行き止まりになる。
 2. **触れるのはマスタDBだけ**——仕掛・品質・共有スケジュールへ向いた
    口が無いこと。
 3. **書ける列は自分のものだけ**——主キー・監査列は送っても書き換わらず、
    知らない列名は黙って捨てる（打ち間違いが保存されない）。
 4. **CRUDの4本が実在する**——画面の汎用CRUDは`endpoint`＋`/update`＋
    `/delete`を決め打ちで呼ぶ（`tests/test_crudroutes.py`と同じ理由）。

**材料は自分で注ぎ込む**——実行環境のマスタDBにどの表が在るかは端末で
違うので、「無ければ素通り」の書き方だと直す前でも通る。
============================================================
"""
import json
import pathlib
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

API = 'http://127.0.0.1:5029'
R = []


def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + str(detail)) if detail else ''))


def set_mode(m):
    call('/api/access-mode', {'mode': m})


def call(path, body=None):
    url = API + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={'Content-Type': 'application/json'} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}')
        except Exception:
            return e.code, {}


from backend.routes import master_tables as mt  # noqa: E402

# ---- 1) 対応表が腐っていない ----------------------------------------
# §9.324 R3: 定義は master-defs.js（盤の master-maint.js とは別ファイル）
js = (ROOT / 'static/js/master/master-defs.js').read_text(encoding='utf-8')
def_keys = set(re.findall(r"\bkey:'([A-Za-z][\w]*)'", js))
missing = sorted(v for v in set(mt.COVERED_BY.values()) if v not in def_keys)
rec('COVERED_BY が指すタブが master-defs.js に実在する', not missing, f'見つからない: {missing}')
# 逆向き: 専用タブを持つのに対応表へ載っていない表は「内部データ」へ二重に出る。
rec('対応表と移行済み・別画面の表が重なっていない',
    not (set(mt.COVERED_BY) & set(mt.RETIRED)) and not (set(mt.COVERED_BY) & set(mt.EDITED_FROM)),
    str(sorted((set(mt.COVERED_BY) & set(mt.RETIRED)) | (set(mt.COVERED_BY) & set(mt.EDITED_FROM)))))
rec('短い呼び名は1行に収まる長さ（10文字以内）',
    all(len(v) <= 10 for v in mt.SHORT_LABELS.values()),
    str([v for v in mt.SHORT_LABELS.values() if len(v) > 10]))

# ---- 1b) 移行済みの表は「無ければ作らない」（§9.255 ①、利用者の報告） ----
# 「移行済みデータをすべて消したはずが、復活しました。
#   旧マスタは無ければ表示しない形にしたいです」
#
# 中身は§9.221 ③で選択肢マスタへ移したのに、`ensure_*_table()`が
# **「無ければ作る」のまま**だった——測定画面を1回開くだけで7つとも空の表
# として作り直され、マスタ管理の「移行済み」から消えなかった（＝消せない
# マスタ）。**一覧は`master_repo.RETIRED_TABLES`の1箇所**（§9.163）。
from backend.repositories import master_repo as mr  # noqa: E402
from backend.repositories import operation_repo as op  # noqa: E402
from backend.repositories import schedule_repo as sr  # noqa: E402

rec('「移行済み」の一覧が説明文と食い違っていない（§9.163）',
    set(mr.RETIRED_TABLES) == set(mt.RETIRED),
    str(sorted(set(mr.RETIRED_TABLES) ^ set(mt.RETIRED))))

_master = ROOT / 'db/master.sqlite3'


def _retired_snapshot():
    """移行済みの表の作りと中身を控える（消して確かめたあと元へ戻すため）。"""
    out = {}
    con = sqlite3.connect(_master)
    for t in mr.RETIRED_TABLES:
        row = con.execute('SELECT sql FROM sqlite_master WHERE type=? AND name=?',
                          ['table', t]).fetchone()
        if not row:
            continue
        idx = [r[0] for r in con.execute(
            'SELECT sql FROM sqlite_master WHERE type=? AND tbl_name=? AND sql IS NOT NULL',
            ['index', t]).fetchall()]
        cur = con.execute(f'SELECT * FROM [{t}]')
        cols_ = [d[0] for d in cur.description]
        out[t] = {'sql': row[0], 'idx': idx, 'cols': cols_, 'rows': cur.fetchall()}
    con.close()
    return out


def _drop_retired():
    con = sqlite3.connect(_master)
    for t in mr.RETIRED_TABLES:
        con.execute(f'DROP TABLE IF EXISTS [{t}]')
    con.commit()
    con.close()


def _restore_retired(snap):
    con = sqlite3.connect(_master)
    for t, d in snap.items():
        con.execute(f'DROP TABLE IF EXISTS [{t}]')
        con.execute(d['sql'])
        for q in d['idx']:
            con.execute(q)
        if d['rows']:
            ph = ','.join('?' * len(d['cols']))
            names = ','.join(f'[{c}]' for c in d['cols'])
            con.executemany(f'INSERT INTO [{t}] ({names}) VALUES ({ph})', d['rows'])
    con.commit()
    con.close()


def _present():
    con = sqlite3.connect(_master)
    have = {r[0] for r in con.execute('SELECT name FROM sqlite_master WHERE type=?', ['table'])}
    con.close()
    return sorted(t for t in mr.RETIRED_TABLES if t in have)


_snap = _retired_snapshot()
try:
    _drop_retired()
    rec('前提: 移行済みの表を消せた', not _present(), str(_present()))
    # 以前ここで作り直していた経路を**全部**通す。**1つでも作り直すと復活する**
    # ので、まとめて通してから数える。
    op.ensure_operation_choices(_master)
    with sqlite3.connect(_master):
        pass
    from backend.db_access import connect as _connect  # noqa: E402
    with _connect(_master, False) as _c:
        sr.ensure_config_master_tables(_c)
        mr.ensure_operator_master_table(_c)
        mr.ensure_operator_equipment_table(_c)
        mr.ensure_spool_master_table(_c)
        mr.ensure_inner_master_table(_c)
        mr.ensure_device_master_table(_c)
        mr.ensure_burr_master_table(_c)
        mr.ensure_coil_stop_master_table(_c)
    rec('用意の口を通しても移行済みの表は戻らない', not _present(), str(_present()))
    # 実機の手順そのもの——**測定画面を開く**（`/api/measurement/context`）。
    try:
        with urllib.request.urlopen(API + '/api/measurement/context?lot=&equipment=',
                                    timeout=30) as _r:
            _r.read()
    except Exception:  # 読めなくても「作られていないこと」は数えられる
        pass
    rec('測定画面を開いても移行済みの表は戻らない（利用者の報告そのもの）',
        not _present(), str(_present()))
    # **画面にも出ない**——一覧は実在する表しか返さないので、消えたら消えたまま。
    _st, _cat = call('/api/master-table/catalog')
    _names = {x.get('table') for x in (_cat.get('tables') or [])}
    rec('無い旧マスタは一覧に出ない', not (_names & set(mr.RETIRED_TABLES)),
        str(sorted(_names & set(mr.RETIRED_TABLES))))
    # 選択肢は**種**から入るので、旧マスタが無くても値は在る（新規導入と同じ）。
    with _connect(_master, True) as _c2:
        _burr = op.choice_values(_c2, 'バリ揃え')
    rec('旧マスタが無くても既定の選択肢は残る（種は選択肢マスタが持つ）',
        len(_burr) >= 2, str(_burr))
finally:
    _restore_retired(_snap)

# ---- 2) 触れるのはマスタDBだけ --------------------------------------
src = (ROOT / 'backend/routes/master_tables.py').read_text(encoding='utf-8')
rec('マスタDB以外へ向いた口が無い',
    "DBS['MASTER']" in src and not re.search(r"DBS\[\s*['\"](?!MASTER)", src)
    and 'SCHEDULE' not in src)

# ---- 3) 材料を注ぎ込んで、実際の口で確かめる ------------------------
master = ROOT / 'db/master.sqlite3'
TABLE = 'テスト内部マスタ'
c = sqlite3.connect(master)
c.execute(f'DROP TABLE IF EXISTS [{TABLE}]')
c.execute(f'CREATE TABLE [{TABLE}] ([ID] INTEGER PRIMARY KEY AUTOINCREMENT,'
          '[名前] TEXT NOT NULL,[数] INTEGER,[内容] TEXT,'
          '[登録者ID] TEXT,[更新者ID] TEXT,[登録日時] DATETIME,[更新日時] DATETIME)')
c.execute(f'INSERT INTO [{TABLE}] ([名前],[数],[内容]) VALUES (?,?,?)', ['もとの行', 1, 'あ'])
c.commit()
c.close()
enc = urllib.parse.quote(TABLE)
# **マスタの書き込みは編集モードだけ**（access_mode の `master_tables`）。
# サーバー側のテストは schedule モードで走るので、ここで切り替えて
# **finally で必ず戻す**——戻さないと後続のスケジュール系が全部落ちる。
set_mode('edit')
try:
    st, cat = call('/api/master-table/catalog')
    row = next((t for t in cat.get('tables', []) if t['table'] == TABLE), None)
    rec('知らない表も一覧に出る（足したのに場所が分からない、を作らない）',
        row is not None and row.get('kind') == 'here', str(row and row.get('kind')))
    rec('列の作り（PRAGMA）を返す', bool(row and row.get('schema')),
        str(row and [x['name'] for x in row.get('schema', [])]))
    rec('監査列と主キーに印が付いている',
        bool(row) and {x['name'] for x in row['schema'] if x['audit']}
        == {'登録者ID', '更新者ID', '登録日時', '更新日時'}
        and [x['name'] for x in row['schema'] if x['pk']] == ['ID'])
    rec('「サーバーが埋める列」の印は監査列と INTEGER PRIMARY KEY だけ',
        bool(row) and {x['name'] for x in row['schema'] if x['auto']}
        == {'ID', '登録者ID', '更新者ID', '登録日時', '更新日時'},
        str(sorted(x['name'] for x in (row or {}).get('schema', []) if x.get('auto'))))

    st, d = call('/api/master-table/' + enc)
    rec('中身を rowid つきで返す', st == 200 and d['items'] and d['items'][0]['id'] == 1, str(d)[:120])

    # 追加: 主キー・監査列・知らない列は送っても効かない
    st, d = call('/api/master-table/' + enc,
                 {'名前': '足した行', '数': 5, '内容': 'い',
                  'ID': 999, '更新者ID': 'なりすまし', '知らない列': 'x', 'user_id': 'tester'})
    rec('追加できる', st == 200 and d.get('ok'), str(d)[:120])
    new_id = d.get('id')
    st, d = call('/api/master-table/' + enc)
    added = next((x for x in d['items'] if x['id'] == new_id), None)
    rec('主キーは送っても書き換わらない', added and added['ID'] == new_id, str(added))
    rec('更新者IDはサーバーが埋める（送った値は効かない）',
        added and added['更新者ID'] == 'tester', str(added and added['更新者ID']))
    rec('登録日時・更新日時が自動で入る', bool(added and added['登録日時'] and added['更新日時']))

    st, d = call(f'/api/master-table/{enc}/update', {'id': new_id, '名前': '直した行', 'user_id': 'u2'})
    rec('更新できる', st == 200 and d.get('ok'), str(d)[:120])
    st, d = call('/api/master-table/' + enc)
    upd = next((x for x in d['items'] if x['id'] == new_id), None)
    rec('更新で送っていない列は消えない（部分更新）',
        upd and upd['名前'] == '直した行' and upd['内容'] == 'い', str(upd))
    rec('更新者IDが更新のたびに入れ替わる', upd and upd['更新者ID'] == 'u2')

    st, d = call(f'/api/master-table/{enc}/delete', {'id': new_id})
    rec('削除できる', st == 200 and d.get('ok'), str(d)[:120])
    st, d = call(f'/api/master-table/{enc}/delete', {'id': new_id})
    rec('消えている行の削除は404で理由を返す', st == 404 and d.get('error'), f'{st} {d}')

    # ---- 3b) 利用者が決める鍵（TEXT PRIMARY KEY）は編集できる ----
    # **主キーだからと一律に外さないこと**——外すと、この形の表へ1行も足せない。
    KEYED = 'テスト鍵マスタ'
    c2 = sqlite3.connect(master)
    c2.execute(f'DROP TABLE IF EXISTS [{KEYED}]')
    c2.execute(f'CREATE TABLE [{KEYED}] ([設定キー] TEXT PRIMARY KEY,[設定値] TEXT)')
    c2.commit()
    c2.close()
    enc2 = urllib.parse.quote(KEYED)
    try:
        st, cat2 = call('/api/master-table/catalog')
        r2 = next((t for t in cat2.get('tables', []) if t['table'] == KEYED), None)
        rec('TEXT PRIMARY KEY は「サーバーが埋める列」に数えない',
            bool(r2) and not next(x for x in r2['schema'] if x['name'] == '設定キー')['auto'])
        st, d2 = call('/api/master-table/' + enc2, {'設定キー': 'k1', '設定値': 'v1', 'user_id': 'tester'})
        rec('利用者が決める鍵を送って1行足せる', st == 200 and d2.get('ok'), str(d2)[:100])
        st, d2 = call('/api/master-table/' + enc2)
        rec('足した鍵がそのまま読み戻せる',
            any(x.get('設定キー') == 'k1' for x in d2.get('items', [])), str(d2.get('items'))[:100])
    finally:
        c2 = sqlite3.connect(master)
        c2.execute(f'DROP TABLE IF EXISTS [{KEYED}]')
        c2.commit()
        c2.close()

    # ---- 4) 扱えない表は断る（名前を組み立てさせない） ----
    st, d = call('/api/master-table/sqlite_master')
    rec('sqlite内部の表は断る', st == 400 and d.get('error'), f'{st} {d}')
    st, d = call('/api/master-table/' + urllib.parse.quote('存在しない表'))
    rec('実在しない表は断る（理由つき）', st == 400 and '存在しない表' in str(d.get('error', '')), f'{st} {d}')

    # ---- 4b) 書けるのは編集モードだけ（宣言が効いていること） ----
    # **未宣言のBlueprintは fail-open（素通し）**なので、宣言が外れると
    # 閲覧モードの端末からも生の表を書き換えられてしまう（tests/test_modeguard.py
    # が一覧としては見張るが、実際に弾かれるかはここで見る）。
    set_mode('view')
    st, d = call('/api/master-table/' + enc, {'名前': 'だめな行', 'user_id': 'tester'})
    rec('閲覧モードでは書けない（ガードが弾く）', st == 403, f'{st} {d}')
    set_mode('edit')

    # ---- 5) CRUDの4本が実在する（404/405で無いこと） ----
    ok4 = []
    for path, body in ((f'/api/master-table/{enc}', None),
                       (f'/api/master-table/{enc}', {'名前': 'x'}),
                       (f'/api/master-table/{enc}/update', {'id': 1, '名前': 'x'}),
                       (f'/api/master-table/{enc}/delete', {'id': 10 ** 9})):
        st, _ = call(path, body)
        ok4.append(st not in (404, 405) or path.endswith('/delete'))
    rec('汎用CRUDの4本が実在する（404/405で無い）', all(ok4), str(ok4))
finally:
    c = sqlite3.connect(master)
    c.execute(f'DROP TABLE IF EXISTS [{TABLE}]')
    c.commit()
    c.close()
    # **モードは必ず戻す**（このブロックは schedule モードで走る約束）。
    try:
        set_mode('schedule')
    except Exception:
        pass

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(f' - {n} {d}')
sys.exit(1 if ng else 0)
