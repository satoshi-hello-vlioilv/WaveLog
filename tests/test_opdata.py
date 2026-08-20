# -*- coding: utf-8 -*-
"""操業データの2つのマスタ(§9.215)。

利用者の指示: 「項目自体をマスタ化し他の設備でも使えるように設備ごとに
持たせ、変更できるようにする、設定値も必要に応じてマスタ化して関連付け。
各項目ごと、入力方式や入力上限値、入力データの型を選べるようにする」。

ここで固定すること:
 1. 初回アクセスで**挙がった項目が入っている**（空のマスタから始めない）
 2. 選択肢は**名前で結ぶ**——IDで結ぶと別PCで連番が食い違う(§9.171)
 3. 設備で絞れる（`*`＝すべての設備の行も一緒に出る）
 4. 型は6つに丸める（知らない型は`文字`。例外にして入力を塞がない）
 5. 並び順を送らなければ**今の並びが残る**（空欄で保存して先頭へ飛ばない）
 6. 選択肢が消えても項目は残る（`choiceMissing`でそう言う）
 7. 4本のCRUDが全部ある（GET/POST/update/delete。§CLAUDE）
"""
import os, sys, json, urllib.request, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://127.0.0.1:5029'
EQ = 'テスト設備A'
TAG = 'test-op-%d' % os.getpid()

R = []
def rec(n, ok, d=''):
    R.append(bool(ok)); print(('PASS' if ok else 'FAIL') + ': ' + n + (' -- ' + str(d) if d else ''))

def get(path):
    with urllib.request.urlopen(B + path, timeout=30) as r:
        return json.loads(r.read())

def post(path, body):
    req = urllib.request.Request(B + path, data=json.dumps(body, ensure_ascii=False).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

def set_mode(m):
    post('/api/access-mode', {'mode': m})


made_items, made_choices = [], []
try:
    # マスタの書き込みは**編集モードだけ**(access_mode の `masters`)。
    # サーバー側のテストはscheduleモードで走るので、ここで切り替えて
    # **finallyで必ず戻す**——戻さないと後続のスケジュール系が全部落ちる。
    set_mode('edit')
    # ---- 1) 初回から中身が入っている ----
    d = get('/api/operation-item-master')
    names = [x['name'] for x in d.get('items', [])]
    rec('挙がった項目が最初から入っている',
        'ラフレベラー 入' in names and 'スリット 実ラップ' in names
        and 'ワインダーテンション トータルユニット' in names,
        '%d件' % len(names))
    rec('型は6つ', d.get('types') == ['整数', '正の整数', '数値', '正の数', '選択', '文字'],
        json.dumps(d.get('types'), ensure_ascii=False))
    # 利用者の一覧は「テープ,青,パック,テープ」でテープが2回だった。
    ch = get('/api/operation-choice-master')
    back = [x['value'] for x in ch.get('items', []) if x['name'] == '後端']
    rec('同じ選択肢を2つ並べない（後端のテープ重複を落とす）',
        back == ['テープ', '青', 'パック'], json.dumps(back, ensure_ascii=False))
    rec('大径・小径のリング色は同じ選択肢を参照する',
        len([x for x in d['items'] if x['choice'] == 'リング色']) == 2,
        json.dumps([x['name'] for x in d['items'] if x['choice'] == 'リング色'], ensure_ascii=False))
    # 「実ラップ」だけマイナスが入る（利用者の一覧で唯一「数値」だった）。
    wrap = next((x for x in d['items'] if x['name'] == 'スリット 実ラップ'), None)
    rec('実ラップはマイナスも入る型にする', bool(wrap) and wrap['type'] == '数値',
        json.dumps(wrap, ensure_ascii=False) if wrap else 'なし')

    # ---- 2) 選択肢は名前で解決して返る（測定画面が2度目を引かない） ----
    form = get('/api/operation-form?equipment=' + urllib.parse.quote(EQ))
    mode = next((x for x in form.get('items', []) if x['name'] == '運転方式'), None)
    rec('入力欄の定義は選択肢まで解決して返る',
        bool(mode) and mode['choices'] == ['D', 'SD'],
        json.dumps(mode.get('choices') if mode else None, ensure_ascii=False))

    # ---- 3) 設備で絞れる（`*`の行も出る） ----
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 専用',
                      'type': '正の数', 'decimals': 1, 'max': 9.9, 'user_id': 'tests'})
    rec('設備を名指しした項目を足せる', code == 200 and res.get('ok'), json.dumps(res, ensure_ascii=False))
    if res.get('id'):
        made_items.append(res['id'])
    mine = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
    mineNames = [x['name'] for x in mine.get('items', [])]
    other = get('/api/operation-item-master?equipment=' + urllib.parse.quote('テスト設備B'))
    otherNames = [x['name'] for x in other.get('items', [])]
    rec('その設備の項目は出る', (TAG + ' 専用') in mineNames, '%d件' % len(mineNames))
    rec('別の設備には出ない', (TAG + ' 専用') not in otherNames, '%d件' % len(otherNames))
    rec('すべての設備(*)の行はどちらにも出る',
        'ラフレベラー 入' in mineNames and 'ラフレベラー 入' in otherNames)

    # ---- 4) 知らない型は文字へ倒す（入力を塞がない） ----
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 変な型',
                      'type': 'まったく知らない型', 'user_id': 'tests'})
    if res.get('id'):
        made_items.append(res['id'])
    again = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
    odd = next((x for x in again['items'] if x['name'] == TAG + ' 変な型'), None)
    rec('知らない型は「文字」へ倒す（例外にしない）', bool(odd) and odd['type'] == '文字',
        json.dumps(odd, ensure_ascii=False) if odd else 'なし')

    # ---- 5) 並び順を送らなければ今の並びが残る ----
    target = next((x for x in again['items'] if x['name'] == TAG + ' 専用'), None)
    before = target['order'] if target else None
    post('/api/operation-item-master/update',
         {'id': target['id'], 'equipment': EQ, 'group': TAG, 'name': TAG + ' 専用',
          'type': '正の数', 'decimals': 1, 'max': 9.9, 'user_id': 'tests'})
    after_rows = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
    after = next((x for x in after_rows['items'] if x['name'] == TAG + ' 専用'), None)
    rec('並び順を送らなければ今の並びが残る',
        before is not None and after and after['order'] == before,
        '%s -> %s' % (before, after['order'] if after else None))

    # ---- 6) 選択肢が無くても項目は残る ----
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 選択',
                      'type': '選択', 'choice': TAG + '-無い選択肢', 'user_id': 'tests'})
    if res.get('id'):
        made_items.append(res['id'])
    form2 = get('/api/operation-form?equipment=' + urllib.parse.quote(EQ))
    miss = next((x for x in form2['items'] if x['name'] == TAG + ' 選択'), None)
    rec('選択肢が見つからなくても項目は残る（黙って消さない）',
        bool(miss) and miss['choices'] == [] and miss['choiceMissing'] is True,
        json.dumps(miss, ensure_ascii=False) if miss else 'なし')

    # ---- 7) 選択肢のCRUD ----
    code, res = post('/api/operation-choice-master',
                     {'name': TAG + '-色', 'value': '金', 'user_id': 'tests'})
    rec('選択肢を足せる', code == 200 and res.get('ok'), json.dumps(res, ensure_ascii=False))
    if res.get('id'):
        made_choices.append(res['id'])
    cid = res.get('id')
    code, res = post('/api/operation-choice-master/update',
                     {'id': cid, 'name': TAG + '-色', 'value': '銀', 'user_id': 'tests'})
    rec('選択肢を直せる（/update が404でない）', code == 200 and res.get('ok'),
        json.dumps(res, ensure_ascii=False))
    vals = [x['value'] for x in get('/api/operation-choice-master')['items']
            if x['name'] == TAG + '-色']
    rec('直した値が残る', vals == ['銀'], json.dumps(vals, ensure_ascii=False))
    code, res = post('/api/operation-choice-master/delete', {'id': cid, 'user_id': 'tests'})
    rec('選択肢を消せる', code == 200 and res.get('ok'), json.dumps(res, ensure_ascii=False))
    if code == 200:
        made_choices.remove(cid)
    left = [x['value'] for x in get('/api/operation-choice-master')['items']
            if x['name'] == TAG + '-色']
    rec('消した選択肢は残らない', left == [], json.dumps(left, ensure_ascii=False))

    # ---- 8) IDが無ければ断る（黙って新規を作らない） ----
    code, res = post('/api/operation-item-master/update', {'name': 'x', 'user_id': 'tests'})
    rec('更新にIDが無ければ断る', code == 400, '%s %s' % (code, res.get('error')))
    code, res = post('/api/operation-item-master/delete', {'user_id': 'tests'})
    rec('削除にIDが無ければ断る', code == 400, '%s %s' % (code, res.get('error')))
    code, res = post('/api/operation-item-master', {'name': '', 'user_id': 'tests'})
    rec('名前が空なら断る', code == 400, '%s %s' % (code, res.get('error')))
finally:
    # **後始末**。db/master.sqlite3は実行をまたいで生き延びる(§9.121)。
    for i in made_items:
        try:
            post('/api/operation-item-master/delete', {'id': i, 'user_id': 'tests'})
        except Exception:
            pass
    for i in made_choices:
        try:
            post('/api/operation-choice-master/delete', {'id': i, 'user_id': 'tests'})
        except Exception:
            pass
    # **モードは必ず戻す**（このブロックはscheduleモードで走る約束）。
    try:
        set_mode('schedule')
    except Exception:
        pass

print('\n== %d/%d PASS ==' % (sum(1 for x in R if x), len(R)))
sys.exit(0 if all(R) else 1)
