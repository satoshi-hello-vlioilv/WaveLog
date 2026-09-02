# -*- coding: utf-8 -*-
"""選択肢の親子（リンクマスタ）(§9.306、利用者の指示)。

「選択肢の値マスタ同士を親子関係として紐づけるためにリンクさせ、リンク
 させた場合、子となったマスタは登録内容毎、どの親か親マスタから選ぶことが
 できるようにしたい。したがって、汎用性を向上させるために『リンクマスタ』の
 追加に伴い『選択肢の値マスタ』にはカテゴリを追加できるようにし、親マスタの
 選択肢から選んで登録することができるように改良が必要になります」

利用者に確かめたこと:
 ・親の欄をまだ選んでいないとき → **全部出す**（今までどおり）
 ・親子は **1段だけ**（親→子。孫は作らない）
 ・子の1つの値は **複数の親に属し得る**（カンマ区切り）

ここで固定すること:
 1. リンクは**子で一意**（1つの子に親は1つ）
 2. **1段だけ**——あるまとまりが親と子を兼ねられない。断るときは
    **どのリンクを外せばよいか**まで言う（§4）
 3. `[親の値]`が**空欄＝どの親でも出る**——リンクを張っただけでは
    候補が1つも減らない（§9.132）
 4. **親を選んでいないときは絞らない**（利用者の指示）
 5. カンマ区切りで**複数の親**に属せる／`'*'`はすべての親
 6. 測定画面の定義（`/api/operation-form`）が、親の欄と
    **親の値ごとの候補**を先に解いて渡す（画面に書式の読み方を持たせない）
 7. リンクを外しても**値の`[親の値]`は消さない**（また繋げば続きから）
 8. 4本のCRUDが全部ある（§CLAUDE）

**素通りに注意**: 「リンクが保存できた」だけを見る網は、候補が1つも
絞られない実装でも通る。**実際に返る値の並び**で見る。
"""
import os, sys, json, urllib.request, urllib.error, urllib.parse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = 'http://127.0.0.1:5029'
EQ = 'テスト設備A'
TAG = 'CL%d' % os.getpid()
PARENT = TAG + '親'
CHILD = TAG + '子'

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

made_choices, made_links, made_items = [], [], []

def add_value(group, value, parent_value=None):
    body = {'name': group, 'value': value, 'user_id': 'tests'}
    if parent_value is not None:
        body['parentValue'] = parent_value
    code, j = post('/api/operation-choice-master', body)
    if j.get('id'):
        made_choices.append(j['id'])
    return code, j

try:
    post('/api/access-mode', {'mode': 'edit'})

    # ---- 前提: 親と子のまとまりを作る ----
    add_value(PARENT, '設備甲'); add_value(PARENT, '設備乙')
    # 子の値: 甲だけ / 乙だけ / 両方(カンマ) / 空欄(＝どの親でも)
    add_value(CHILD, '甲専用', '設備甲')
    add_value(CHILD, '乙専用', '設備乙')
    add_value(CHILD, '共用', '設備甲,設備乙')
    add_value(CHILD, 'どこでも', '')
    d = get('/api/operation-choice-master')
    names = d.get('names') or []
    rec('前提: 親と子のまとまりが作れた', PARENT in names and CHILD in names,
        json.dumps([n for n in names if n.startswith(TAG)], ensure_ascii=False))

    # ---- 1) 4本のCRUD ----
    for path, method in (('/api/choice-link-master', 'GET'),
                         ('/api/choice-link-master', 'POST'),
                         ('/api/choice-link-master/update', 'POST'),
                         ('/api/choice-link-master/delete', 'POST')):
        if method == 'GET':
            ok = True
            try:
                get(path)
            except Exception:
                ok = False
        else:
            code, _ = post(path, {})
            ok = code not in (404, 405)
        rec(f'口がある: {method} {path}', ok)

    # ---- 2) リンクを張る（張るだけでは候補は減らない・§9.132） ----
    code, j = post('/api/choice-link-master', {'parent': PARENT, 'child': CHILD,
                                               'user_id': 'tests'})
    if j.get('id'):
        made_links.append(j['id'])
    rec('親子を1本張れる', code == 200 and bool(j.get('id')), json.dumps(j, ensure_ascii=False)[:80])

    d = get('/api/choice-link-master')
    link = next((x for x in (d.get('items') or []) if x['child'] == CHILD), None)
    rec('張った親子が読み出せる', bool(link) and link['parent'] == PARENT,
        json.dumps(link, ensure_ascii=False) if link else 'なし')
    # **件数はサーバーが数える**（盤で数え直さない）。
    rec('親と子の件数もサーバーが返す',
        bool(link) and link.get('parentCount') == 2 and link.get('childCount') == 4,
        json.dumps(link, ensure_ascii=False) if link else '')

    # ---- 3) 子で一意（1つの子に親は1つ） ----
    add_value(TAG + '別親', 'X')
    code, j = post('/api/choice-link-master', {'parent': TAG + '別親', 'child': CHILD,
                                               'user_id': 'tests'})
    d = get('/api/choice-link-master')
    kids = [x for x in (d.get('items') or []) if x['child'] == CHILD]
    rec('1つの子に親は1つだけ（張り替えになる）', len(kids) == 1,
        json.dumps(kids, ensure_ascii=False))
    # 元へ戻す
    post('/api/choice-link-master', {'parent': PARENT, 'child': CHILD, 'user_id': 'tests'})

    # ---- 4) 1段だけ（親と子を兼ねられない） ----
    add_value(TAG + '孫', 'Y')
    code, j = post('/api/choice-link-master', {'parent': CHILD, 'child': TAG + '孫',
                                               'user_id': 'tests'})
    err = str(j.get('error') or '')
    rec('すでに子のまとまりは親にできない（1段だけ）', code == 400 and CHILD in err,
        f'{code} {err[:70]}')
    # **打つ手まで言う**（§4）——どのリンクを外せばよいかが読めること。
    rec('断る理由に「外すべきリンク」が書いてある', '外して' in err, err[:70])
    code, j = post('/api/choice-link-master', {'parent': TAG + '祖', 'child': PARENT,
                                               'user_id': 'tests'})
    rec('無いまとまりは名指しで断る',
        code == 400 and (TAG + '祖') in str(j.get('error') or ''),
        f'{code} {str(j.get("error") or "")[:60]}')
    code, j = post('/api/choice-link-master', {'parent': PARENT, 'child': PARENT,
                                               'user_id': 'tests'})
    rec('自分を自分の親にはできない', code == 400, f'{code} {str(j.get("error") or "")[:50]}')

    # ---- 5) 親の値で絞られる ----
    d = get('/api/operation-choice-master')
    rows = {r['value']: r for r in (d.get('items') or []) if r['name'] == CHILD}
    rec('値ごとの「親の値」が読み出せる',
        rows.get('共用', {}).get('parentValue', '').replace(' ', '') in ('設備甲,設備乙',),
        json.dumps({k: v.get('parentValue') for k, v in rows.items()}, ensure_ascii=False))
    rec('子のまとまりが自分の親を知っている',
        rows.get('甲専用', {}).get('parent') == PARENT,
        rows.get('甲専用', {}).get('parent', ''))
    # 親の値の欄が選ばせる候補もサーバーが返す。
    rec('親の値の候補（親のまとまりの値）も返る',
        sorted((d.get('parentValues') or {}).get(CHILD) or []) == ['設備乙', '設備甲'],
        json.dumps((d.get('parentValues') or {}).get(CHILD), ensure_ascii=False))

    # ==================================================================
    # 6) **実際に絞られること**——ここが本丸（§9.306）
    # ------------------------------------------------------------------
    # 「リンクが保存できた」だけを見る網は、候補が1つも絞られない実装でも
    # 通る。測定画面の定義（`/api/operation-form`）が返す**値の並びそのもの**
    # で見る。
    # ==================================================================
    # 親の欄と子の欄を1つずつ作る（どちらもこの設備で出る項目）。
    for nm, grp in ((TAG + '親欄', PARENT), (TAG + '子欄', CHILD)):
        code, j = post('/api/operation-item-master',
                       {'name': nm, 'equipment': EQ, 'group': TAG,
                        'kind': '選択', 'choice': grp, 'user_id': 'tests'})
        if j.get('id'):
            made_items.append(j['id'])
    form = get('/api/operation-form?equipment=' + urllib.parse.quote(EQ))
    items = {x['name']: x for x in (form.get('items') or [])}
    kid = items.get(TAG + '子欄') or {}
    par = items.get(TAG + '親欄') or {}
    rec('前提: 親の欄と子の欄が測定画面の定義に出る', bool(kid) and bool(par),
        json.dumps(sorted(n for n in items if n.startswith(TAG)), ensure_ascii=False))
    rec('子の欄が「親のまとまり」を知っている', kid.get('choiceParent') == PARENT,
        str(kid.get('choiceParent')))
    # **どの欄が親の値を持つか**もサーバーが答える（画面で探させない）。
    rec('親の値を持つ欄もサーバーが答える',
        (kid.get('parentField') or {}).get('name') == TAG + '親欄',
        json.dumps(kid.get('parentField'), ensure_ascii=False))

    # **親を選んでいないときは絞らない**（利用者の指示）。
    rec('親を選んでいないときは全部出す（今までどおり）',
        sorted(kid.get('choices') or []) == sorted(['甲専用', '乙専用', '共用', 'どこでも']),
        json.dumps(kid.get('choices'), ensure_ascii=False))

    by = kid.get('choicesByParent') or {}
    # 甲: 甲専用 + 共用(カンマ) + どこでも(空欄＝すべての親)
    rec('親＝設備甲では甲のものだけになる（空欄はどの親でも出る）',
        sorted(by.get('設備甲') or []) == sorted(['甲専用', '共用', 'どこでも']),
        json.dumps(by.get('設備甲'), ensure_ascii=False))
    rec('親＝設備乙では乙のものだけになる',
        sorted(by.get('設備乙') or []) == sorted(['乙専用', '共用', 'どこでも']),
        json.dumps(by.get('設備乙'), ensure_ascii=False))
    # **複数の親に属せる**（利用者の答え）——「共用」が両方に出ること。
    rec('カンマ区切りで複数の親に属せる',
        '共用' in (by.get('設備甲') or []) and '共用' in (by.get('設備乙') or []),
        json.dumps({k: v for k, v in by.items()}, ensure_ascii=False))
    # **親を持たない欄には親の情報を付けない**（余計な配線をさせない）。
    rec('親のいない欄には親子の情報を付けない',
        par.get('choiceParent') == '' and not par.get('choicesByParent'),
        json.dumps({'親': par.get('choiceParent'), '表': par.get('choicesByParent')},
                   ensure_ascii=False))

    # ---- 7) 外しても [親の値] は消さない ----
    for x in (get('/api/choice-link-master').get('items') or []):
        if x['child'] == CHILD:
            post('/api/choice-link-master/delete', {'id': x['id'], 'user_id': 'tests'})
    d = get('/api/operation-choice-master')
    kept = {r['value']: r.get('parentValue', '') for r in (d.get('items') or [])
            if r['name'] == CHILD}
    rec('親子を外しても値の「親の値」は残る（また繋げば続きから）',
        kept.get('甲専用') == '設備甲', json.dumps(kept, ensure_ascii=False))
    form = get('/api/operation-form?equipment=' + urllib.parse.quote(EQ))
    kid2 = {x['name']: x for x in (form.get('items') or [])}.get(TAG + '子欄') or {}
    rec('外すと絞り込みも止まる（候補が元へ戻る）',
        kid2.get('choiceParent') == '' and
        sorted(kid2.get('choices') or []) == sorted(['甲専用', '乙専用', '共用', 'どこでも']),
        json.dumps({'親': kid2.get('choiceParent'), '候補': kid2.get('choices')},
                   ensure_ascii=False))

except Exception as e:
    rec('FATAL', False, repr(e))
finally:
    # **後始末**（§9.121）。db/master.sqlite3 は実行をまたいで生き延びる。
    for lid in made_links:
        post('/api/choice-link-master/delete', {'id': lid, 'user_id': 'tests'})
    for d2 in (get('/api/choice-link-master').get('items') or []):
        if str(d2.get('parent', '')).startswith(TAG) or str(d2.get('child', '')).startswith(TAG):
            post('/api/choice-link-master/delete', {'id': d2['id'], 'user_id': 'tests'})
    for cid in made_choices:
        post('/api/operation-choice-master/delete', {'id': cid, 'user_id': 'tests'})
    for iid in made_items:
        post('/api/operation-item-master/delete', {'id': iid, 'user_id': 'tests'})

print('\n== %d/%d PASS ==' % (sum(1 for x in R if x), len(R)))
sys.exit(0 if all(R) else 1)
