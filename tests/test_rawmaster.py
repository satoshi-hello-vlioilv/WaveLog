#!/usr/bin/env python3
"""test_rawmaster.py: 専用タブを持たないマスタを階層の中で編集する（§9.249 ②）。

============================================================
なぜ要るか
------------------------------------------------------------
「テーブル生データ」からしか見られなかった表を、マスタ管理の階層へ出して
**編集できる**ようにした。ここで守るのは4つ。

 1. **対応表が腐っていない**——`COVERED_BY`が指すタブのキーが
    `master-maint.js`の`MASTER_DEFS`に実在すること。タブを消したり
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
js = (ROOT / 'static/js/master-maint.js').read_text(encoding='utf-8')
def_keys = set(re.findall(r"\bkey:'([A-Za-z][\w]*)'", js))
missing = sorted(v for v in set(mt.COVERED_BY.values()) if v not in def_keys)
rec('COVERED_BY が指すタブが master-maint.js に実在する', not missing, f'見つからない: {missing}')
# 逆向き: 専用タブを持つのに対応表へ載っていない表は「内部データ」へ二重に出る。
rec('対応表と移行済み・別画面の表が重なっていない',
    not (set(mt.COVERED_BY) & set(mt.RETIRED)) and not (set(mt.COVERED_BY) & set(mt.EDITED_FROM)),
    str(sorted((set(mt.COVERED_BY) & set(mt.RETIRED)) | (set(mt.COVERED_BY) & set(mt.EDITED_FROM)))))
rec('短い呼び名は1行に収まる長さ（10文字以内）',
    all(len(v) <= 10 for v in mt.SHORT_LABELS.values()),
    str([v for v in mt.SHORT_LABELS.values() if len(v) > 10]))

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

    # ---- 4) 扱えない表は断る（名前を組み立てさせない） ----
    st, d = call('/api/master-table/sqlite_master')
    rec('sqlite内部の表は断る', st == 400 and d.get('error'), f'{st} {d}')
    st, d = call('/api/master-table/' + urllib.parse.quote('存在しない表'))
    rec('実在しない表は断る（理由つき）', st == 400 and '存在しない表' in str(d.get('error', '')), f'{st} {d}')

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

ng = [x for x in R if not x[1]]
print('\n=== SUMMARY ===')
print(f'{len(R)-len(ng)}/{len(R)} passed')
for n, _, d in ng:
    print(f' - {n} {d}')
sys.exit(1 if ng else 0)
