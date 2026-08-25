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


made_items, made_choices, made_blocks = [], [], []
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

    # ---- 2b) 値が「この画面の外から」入る欄をサーバーが答える（§9.234 ⑦） ----
    # 利用者の指示「操業データ項目の項目カード自体に自動に入力されるものに
    # ついては配色してほしいです」。**判定はサーバーの1箇所**（§9.163）で、
    # 画面は答えを引くだけ。分類の呼び名と説明もサーバーが返す。
    fills = d.get('autoFills') or []
    rec('自動で入る欄の分類をサーバーが返す',
        [f.get('key') for f in fills] == ['computed', 'preset']
        and all(f.get('label') and f.get('note') for f in fills),
        json.dumps(fills, ensure_ascii=False))
    by_builtin = {x.get('builtin'): x for x in d.get('items', []) if x.get('builtin')}
    rec('画面が値を入れる欄は computed（母材の参考値3つ）',
        all((by_builtin.get(k) or {}).get('autoFill') == 'computed'
            for k in ('motherOriginalWidth', 'motherScrapWidth', 'motherCalcLength')),
        json.dumps({k: (by_builtin.get(k) or {}).get('autoFill')
                    for k in ('motherOriginalWidth', 'motherScrapWidth', 'motherCalcLength')},
                   ensure_ascii=False))
    rec('仕掛から初期値が入る欄は preset（内径・縦割数・横割数）',
        all((by_builtin.get(k) or {}).get('autoFill') == 'preset'
            for k in ('innerDiameter', 'verticalCount', 'horizontalCount')),
        json.dumps({k: (by_builtin.get(k) or {}).get('autoFill')
                    for k in ('innerDiameter', 'verticalCount', 'horizontalCount')},
                   ensure_ascii=False))
    rec('人が入れる欄は空のまま（全部を自動にしない）',
        all((by_builtin.get(k) or {}).get('autoFill') == ''
            for k in ('operator', 'spool', 'coilStop')),
        json.dumps({k: (by_builtin.get(k) or {}).get('autoFill')
                    for k in ('operator', 'spool', 'coilStop')}, ensure_ascii=False))
    # **境目を必ず入れる**——マスタで決めた`[初期値]`は「設定」であって
    # 「連携」ではない。ここを見ないと「全部塗る」実装が通ってしまう。
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 初期値だけ',
                      'type': '文字', 'initial': 'あ', 'user_id': 'tests'})
    if res.get('id'):
        made_items.append(res['id'])
    init_rows = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
    init_row = next((x for x in init_rows.get('items', [])
                     if x['name'] == TAG + ' 初期値だけ'), None)
    rec('マスタで決めた初期値は「自動」に数えない（§9.234 ⑦）',
        bool(init_row) and init_row.get('autoFill') == '' and init_row.get('initial') == 'あ',
        json.dumps(init_row, ensure_ascii=False) if init_row else 'なし')

    # ---- 2c) 自動で入る値・計算値の語彙（§9.234 ②） ----
    # 利用者の指示「自動で入る値、計算値についても、現在使っているものは、
    # そのリストから選んで表示設定できるようにしてください」。
    # **語彙はサーバーだけが持つ**（§9.163）——画面は一覧を引くだけ。
    autos = d.get('autoValues') or []
    rec('自動で入る値の一覧をサーバーが返す',
        len(autos) >= 10 and all(a.get('key') and a.get('label')
                                 and a.get('group') and a.get('note') for a in autos),
        json.dumps(autos[:2], ensure_ascii=False))
    rec('出どころごとに分かれている（仕掛／測定の記録／計算した値）',
        len({a.get('group') for a in autos}) >= 3,
        json.dumps(sorted({a.get('group') for a in autos}), ensure_ascii=False))
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 自動値',
                      'type': '文字', 'autoValue': 'lot.mfgThickness', 'user_id': 'tests'})
    if res.get('id'):
        made_items.append(res['id'])
    auto_id = res.get('id')

    def auto_row():
        rows = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
        return next((x for x in rows.get('items', []) if x.get('id') == auto_id), {}) or {}

    ar = auto_row()
    rec('自動で入る値の項目を足せる', code == 200 and res.get('ok'),
        json.dumps(res, ensure_ascii=False))
    # **族は`output`**＝打てる欄を作らない（§4）。型を何にしても変わらない。
    rec('自動で入る値の族は output（型より先に決まる）',
        ar.get('widgetFamily') == 'output' and ar.get('autoFill') == 'computed',
        json.dumps({'fam': ar.get('widgetFamily'), 'fill': ar.get('autoFill')},
                   ensure_ascii=False))
    rec('呼び名・群・説明が行に載る',
        ar.get('autoValueLabel') == '製造板厚' and bool(ar.get('autoValueGroup'))
        and ar.get('autoValueKnown') is True,
        json.dumps({k: ar.get(k) for k in
                    ('autoValueLabel', 'autoValueGroup', 'autoValueKnown')},
                   ensure_ascii=False))
    # **送らない更新で消えない**（§9.212 ②「送った項目だけ書く」）。設定窓は
    # `autoValue`を送らないので、触るたびに人が打つ欄へ戻っては困る。
    post('/api/operation-item-master/update',
         {'id': auto_id, 'name': TAG + ' 自動値', 'type': '文字',
          'equipment': EQ, 'group': TAG, 'user_id': 'tests'})
    rec('`autoValue`を送らない更新でも鍵が残る',
        auto_row().get('autoValue') == 'lot.mfgThickness',
        json.dumps(auto_row().get('autoValue'), ensure_ascii=False))
    # **知らない鍵は捨てない**（§9.204）——語彙を減らした版が1度読んだだけで
    # 現場の設定が消えるのを避ける。引けないことは行が言う（§4）。
    code, res = post('/api/operation-item-master',
                     {'equipment': EQ, 'group': TAG, 'name': TAG + ' 知らない鍵',
                      'type': '文字', 'autoValue': 'lot.しらない', 'user_id': 'tests'})
    if res.get('id'):
        made_items.append(res['id'])
    unk_rows = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
    unk = next((x for x in unk_rows.get('items', [])
                if x['name'] == TAG + ' 知らない鍵'), None)
    rec('知らない鍵は残したまま「引けません」と返す',
        bool(unk) and unk.get('autoValue') == 'lot.しらない'
        and unk.get('autoValueKnown') is False,
        json.dumps(unk, ensure_ascii=False) if unk else 'なし')

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

    # ---- 3b) 設備ごとのレイアウト（§9.239 ②、利用者の指示） ----
    # 「操業データ項目マスタについて、設備ごとレイアウト調整できるように」
    #
    # **行は複製しない**——型・選択肢・役割まで写ることになる。置き場・群・
    # 並び・幅だけを設備ごとに重ねる（`[設備別レイアウト]`）。
    # **設備Aで動かして設備Bが変わらないこと**まで見る（設備Aだけを見る網は、
    # 共有の行を書き換える古い実装でも通る）。
    common = next((x for x in mine['items'] if x['name'] == 'ラフレベラー 入'), None)
    rec('すべての設備(*)の行を材料にできる', bool(common),
        json.dumps(common, ensure_ascii=False) if common else 'なし')
    if common:
        base_span = common.get('span')
        base_place = common.get('place')
        # 設備Aだけ幅と置き場を変える
        code, res = post('/api/operation-item-master/layout',
                         {'equipment': EQ, 'user_id': 'tests',
                          'items': [{'id': common['id'], 'group': '設備A専用の群',
                                     'place': '入力内容', 'span': 12,
                                     'required': False, 'enabled': True}]})
        rec('設備を選んでレイアウトを保存できる', code == 200 and res.get('ok'),
            json.dumps(res, ensure_ascii=False))
        a2 = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
        b2 = get('/api/operation-item-master?equipment=' + urllib.parse.quote('テスト設備B'))
        av = next((x for x in a2['items'] if x['name'] == 'ラフレベラー 入'), None)
        bv = next((x for x in b2['items'] if x['name'] == 'ラフレベラー 入'), None)
        rec('設備Aでは上書きが効く',
            bool(av) and av.get('span') == 12 and av.get('group') == '設備A専用の群'
            and av.get('place') == '入力内容',
            json.dumps(av and {'span': av.get('span'), 'group': av.get('group'),
                               'place': av.get('place')}, ensure_ascii=False))
        rec('設備Bは共通のまま（巻き添えにしない）',
            bool(bv) and bv.get('span') == base_span and bv.get('place') == base_place
            and bv.get('group') != '設備A専用の群',
            json.dumps(bv and {'span': bv.get('span'), 'group': bv.get('group'),
                               'place': bv.get('place')}, ensure_ascii=False))
        rec('どこ由来の値かを言う（layoutFrom）',
            bool(av) and av.get('layoutFrom') == EQ
            and bool(bv) and bv.get('layoutFrom') == '共通',
            json.dumps({'A': av and av.get('layoutFrom'), 'B': bv and bv.get('layoutFrom')},
                       ensure_ascii=False))
        # 測定画面が読む口（form_for_equipment）にも効く
        fa = get('/api/operation-form?equipment=' + urllib.parse.quote(EQ))
        fav = next((x for x in fa.get('items', []) if x['name'] == 'ラフレベラー 入'), None)
        rec('測定画面の読み口にも上書きが効く',
            bool(fav) and fav.get('span') == 12,
            json.dumps(fav and {'span': fav.get('span')}, ensure_ascii=False))
        # 群のふるまいも設備ごと（以前は WHERE に [設備名] が無く全設備が畳まれた）
        code, res = post('/api/operation-item-master/group',
                         {'equipment': EQ, 'place': '入力内容', 'group': '設備A専用の群',
                          'fold': True, 'showWhen': [], 'user_id': 'tests'})
        a3 = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
        b3 = get('/api/operation-item-master?equipment=' + urllib.parse.quote('テスト設備B'))
        av3 = next((x for x in a3['items'] if x['name'] == 'ラフレベラー 入'), None)
        bv3 = next((x for x in b3['items'] if x['name'] == 'ラフレベラー 入'), None)
        rec('群を畳むのも設備ごとに効く', bool(av3) and av3.get('fold') is True,
            json.dumps(av3 and av3.get('fold')))
        rec('群を畳んでも他の設備は畳まれない', bool(bv3) and not bv3.get('fold'),
            json.dumps(bv3 and bv3.get('fold')))
        # **共通と同じ値は上書きに残さない**（§9.239 ②の追補）。
        # 盤は画面に出ている全部のカードを送るので、比べずに書くと
        # **1回並べ替えただけでその設備の全部の欄が共通から切り離される**
        # ——以降どれだけ共通を直しても、その設備には1つも届かない
        # （設定が黙って効かなくなる形・§CLAUDE 4）。
        # ここでは「設備Aで動かしていない別の項目」が、共通を直したときに
        # ちゃんと追随することを見る。**動かした項目のほうも一緒に見る**
        # ——両方見ないと「何も上書きしない」実装でも通ってしまう。
        other = next((x for x in mine['items']
                      if x['name'] != 'ラフレベラー 入' and not x.get('builtin')), None)
        if other:
            post('/api/operation-item-master/update',
                 {'id': other['id'], 'name': other['name'], 'group': '共通を直した群',
                  'user_id': 'tests'})
            a4 = get('/api/operation-item-master?equipment=' + urllib.parse.quote(EQ))
            ov4 = next((x for x in a4['items'] if x['name'] == other['name']), None)
            rec('設備Aで動かしていない項目は共通の変更に追随する',
                bool(ov4) and ov4.get('group') == '共通を直した群'
                and ov4.get('layoutFrom') == '共通',
                json.dumps(ov4 and {'group': ov4.get('group'),
                                    'from': ov4.get('layoutFrom')}, ensure_ascii=False))
            av4 = next((x for x in a4['items'] if x['name'] == 'ラフレベラー 入'), None)
            rec('動かした項目のほうは設備Aの設定のまま',
                bool(av4) and av4.get('layoutFrom') == EQ and av4.get('span') == 12,
                json.dumps(av4 and {'span': av4.get('span'),
                                    'from': av4.get('layoutFrom')}, ensure_ascii=False))
            post('/api/operation-item-master/update',
                 {'id': other['id'], 'name': other['name'],
                  'group': other.get('group') or '', 'user_id': 'tests'})
        # 後片付け: 上書きを外して共通へ戻す
        post('/api/operation-item-master/layout',
             {'equipment': EQ, 'user_id': 'tests',
              'items': [{'id': common['id'], 'group': common.get('group') or '',
                         'place': base_place, 'span': base_span,
                         'required': False, 'enabled': True}]})

    # ---- 3c) 上書きに持てる設定は「全部ちゃんと効く」（§9.239 ②の追補） ----
    # **死んだ設定を作らない**（§CLAUDE 4「できないことは、できないと書く」）。
    # `LAYOUT_OVERRIDE_KEYS`に`enabled`（出す/出さない）を入れていたが、
    # 有効/無効は`item_rows()`が**上書きを重ねる前に**落とすので、設備ごとに
    # 保存しても誰も読まなかった——**盤では保存できるのに測定画面は変わらない**
    # という一番分かりにくい形になる（設備ごとの出し分けは`[設備名]`が担う）。
    # ここは「語彙に載っている鍵は、重ねたときに実際に値が変わること」を
    # 機械で数える網。**目で数えないこと**（鍵を1つ足すたびに増える）。
    from backend.repositories import operation_repo as _op
    _base = {'place': '準備', 'group': 'g', 'order': 1, 'span': 2,
             'groupSpan': 0, 'fold': False, 'showWhen': [], 'dummy': False,
             'enabled': True, 'overrides': {}}
    _alt = {'place': '入力内容', 'group': 'ちがう群', 'order': 99, 'span': 12,
            'groupSpan': 6, 'fold': True, 'showWhen': ['板厚'], 'dummy': True}
    _dead = []
    for _k in _op.LAYOUT_OVERRIDE_KEYS:
        if _k not in _alt:
            _dead.append(_k + '（この網が試す値を持っていない）')
            continue
        _got = _op.apply_layout_override(dict(_base, overrides={EQ: {_k: _alt[_k]}}), EQ)
        if _got.get(_k) == _base.get(_k):
            _dead.append(_k)
    rec('上書きに持てる設定はすべて実際に効く（死んだ設定を作らない）',
        not _dead, '効かない鍵: ' + '、'.join(_dead) if _dead else '')
    rec('「出す/出さない」は設備ごとに持たない（[設備名]が担う）',
        'enabled' not in _op.LAYOUT_OVERRIDE_KEYS, str(_op.LAYOUT_OVERRIDE_KEYS))

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

    # ---- 8) 並べ方と群幅（§9.226 ①③、利用者の指示） ----
    # **選ばせ方の一覧と「効く形」はサーバーが答える**（画面へ写さない）。
    cat = get('/api/operation-item-master')
    widgets = cat.get('widgets') or []
    rec('選ばせ方に段階・入切・メーター・定型文が入っている',
        all(w in widgets for w in ('段階', '入切', 'メーター', '定型文')),
        json.dumps(widgets, ensure_ascii=False))
    fam = cat.get('widgetFamilies') or {}
    rec('段階・入切は選択肢の型だけ／メーターは数値／定型文は文字',
        '段階' in (fam.get('choice') or []) and '入切' in (fam.get('choice') or [])
        and 'メーター' in (fam.get('number') or []) and '定型文' in (fam.get('text') or [])
        and '段階' not in (fam.get('number') or []),
        json.dumps(fam, ensure_ascii=False))
    rec('並べ方の一覧と効く形をサーバーが答える',
        '自動' in (cat.get('layouts') or []) and '2列' in (cat.get('layouts') or [])
        and 'ボタン群' in (cat.get('layoutWidgets') or [])
        and 'プルダウン' not in (cat.get('layoutWidgets') or []),
        json.dumps({'layouts': cat.get('layouts'),
                    'layoutWidgets': cat.get('layoutWidgets')}, ensure_ascii=False))

    # 保存して読み直す。**知らない値は自動へ倒す**（入力が丸ごと開けなくなる
    # のを避ける）。**効かない形では`layout`が`自動`で返り、保存値は残る**。
    code, res = post('/api/operation-item-master', {
        'name': TAG + '-並べ方', 'type': '選択', 'user_id': 'tests', 'equipment': '*',
        'group': TAG, 'widget': 'ボタン群', 'layout': '2列', 'groupSpan': 6})
    made_items.append(res.get('id'))
    lst = get('/api/operation-item-master')
    row = [x for x in lst['items'] if x['name'] == TAG + '-並べ方']
    row = row[0] if row else {}
    rec('並べ方と群幅が保存される',
        row.get('layout') == '2列' and row.get('groupSpan') == 6,
        json.dumps({'layout': row.get('layout'), 'groupSpan': row.get('groupSpan')},
                   ensure_ascii=False))
    # 効かない形へ変えると`layout`は自動、保存値（`layoutSaved`）は残る。
    post('/api/operation-item-master/update', {
        'id': row.get('id'), 'name': TAG + '-並べ方', 'type': '選択', 'user_id': 'tests',
        'equipment': '*', 'group': TAG, 'widget': 'プルダウン', 'layout': '2列',
        'groupSpan': 6})
    lst = get('/api/operation-item-master')
    row2 = [x for x in lst['items'] if x['name'] == TAG + '-並べ方'][0]
    rec('並べる先が無い形では自動へ落とすが、保存値は残す',
        row2.get('layout') == '自動' and row2.get('layoutSaved') == '2列',
        json.dumps({'layout': row2.get('layout'),
                    'layoutSaved': row2.get('layoutSaved')}, ensure_ascii=False))
    # 群幅は**群の全部の行へ**（`/group`が書く）。渡さなければ触らない。
    post('/api/operation-item-master/group', {
        'place': '準備', 'group': TAG, 'fold': False, 'showWhen': [], 'user_id': 'tests'})
    lst = get('/api/operation-item-master')
    row3 = [x for x in lst['items'] if x['name'] == TAG + '-並べ方'][0]
    rec('群幅を送らなければ触らない（畳むを押しただけで消えない）',
        row3.get('groupSpan') == 6, json.dumps(row3.get('groupSpan')))
    post('/api/operation-item-master/group', {
        'place': '準備', 'group': TAG, 'fold': False, 'showWhen': [],
        'groupSpan': 0, 'user_id': 'tests'})
    lst = get('/api/operation-item-master')
    row4 = [x for x in lst['items'] if x['name'] == TAG + '-並べ方'][0]
    rec('群幅は群ごとまとめて戻せる', row4.get('groupSpan') == 0,
        json.dumps(row4.get('groupSpan')))

    # ---- 9) 帳票ブロックの候補（§9.226 ④） ----
    # **操業データの項目がそのまま候補に出ること**——出ないと、現場が足した
    # 項目を紙へ載せる手立てが無い（手で道を書かせない、が目的）。
    rb = get('/api/report-block-master')
    cats = rb.get('catalog') or []
    names = [g.get('group') for g in cats]
    rec('帳票ブロックの候補が出どころごとに分かれている',
        '仕掛（ロットの情報）' in names and '計算した値' in names,
        json.dumps(names, ensure_ascii=False))
    paths = [it.get('path') for g in cats for it in (g.get('items') or [])]
    rec('操業データの項目が候補に出る（項目を足せば増える）',
        any(str(p).startswith('settings.opData.') for p in paths),
        json.dumps([p for p in paths if str(p).startswith('settings.opData.')][:4],
                   ensure_ascii=False))
    rec('準備の組み込み欄は settings.<キー> の道で出る',
        'settings.operator' in paths, json.dumps(paths[:6], ensure_ascii=False))

    # ---- 10) 項目名を変えたら参照も付け替える（§9.226 ①） ----
    code, res = post('/api/report-block-master', {
        'name': TAG + '-塊', 'user_id': 'tests', 'equipment': '*',
        'content': 'テスト=settings.opData.' + TAG + '-並べ方'})
    made_blocks.append(res.get('id'))
    post('/api/operation-item-master/update', {
        'id': row.get('id'), 'name': TAG + '-改名', 'type': '選択', 'user_id': 'tests',
        'equipment': '*', 'group': TAG, 'widget': 'プルダウン'})
    rb2 = get('/api/report-block-master')
    blk = [x for x in rb2['items'] if x['name'] == TAG + '-塊']
    body = (blk[0].get('content') or '') if blk else ''
    rec('項目名を変えると帳票ブロックの参照も付け替わる',
        ('settings.opData.' + TAG + '-改名') in body, body)

    # ---- 12) 上下限の出どころ（§9.231 ②） ----
    # **語彙はサーバーだけが持つ**（§9.163）。画面へ写すと、増やしたときに
    # 2箇所直すことになり、片方だけ直った状態が作れる。
    lst = get('/api/operation-item-master')
    srcs = lst.get('limitSources') or []
    rec('上下限の出どころの一覧をサーバーが返す',
        [x.get('key') for x in srcs] == ['equipment.maxLineSpeed', 'equipment.maxStrips'],
        json.dumps(srcs, ensure_ascii=False))
    rec('出どころには呼び名と単位が付く（画面が推測しない）',
        all(x.get('label') and x.get('unit') for x in srcs),
        json.dumps([(x.get('label'), x.get('unit')) for x in srcs], ensure_ascii=False))
    code, res = post('/api/operation-item-master', {
        'name': TAG + '-上限', 'type': '正の数', 'user_id': 'tests', 'equipment': '*',
        'group': TAG, 'max': 99, 'maxFrom': 'equipment.maxStrips'})
    lim_id = res.get('id')
    made_items.append(lim_id)

    def lim_row():
        for x in get('/api/operation-item-master').get('items') or []:
            if str(x.get('id')) == str(lim_id):
                return x
        return {}

    rec('出どころを付けて登録できる', lim_row().get('maxFrom') == 'equipment.maxStrips',
        json.dumps(lim_row().get('maxFrom'), ensure_ascii=False))
    # **送られてこなければ残す**。`item_upsert`は全列を書くので、部分的な
    # JSONを送る呼び出し（盤の幅・空きの切り替えなど）が巻き添えで消す。
    post('/api/operation-item-master/update', {
        'id': lim_id, 'name': TAG + '-上限', 'type': '正の数', 'user_id': 'tests',
        'equipment': '*', 'group': TAG, 'max': 99, 'note': 'メモ'})
    rec('出どころを送らない更新では消えない（全列書き込みの巻き添えにしない）',
        lim_row().get('maxFrom') == 'equipment.maxStrips',
        json.dumps(lim_row().get('maxFrom'), ensure_ascii=False))
    # **空文字は「自分で決める」**（送っていないのとは別のこと）。
    post('/api/operation-item-master/update', {
        'id': lim_id, 'name': TAG + '-上限', 'type': '正の数', 'user_id': 'tests',
        'equipment': '*', 'group': TAG, 'max': 99, 'maxFrom': ''})
    rec('空文字を送れば「自分で決める」へ戻る', lim_row().get('maxFrom') == '',
        json.dumps(lim_row().get('maxFrom'), ensure_ascii=False))
    # **知らない鍵は入れない**——保存できてしまうと、引けない出どころを
    # 選んだまま「上限が掛かっているつもり」になる。
    post('/api/operation-item-master/update', {
        'id': lim_id, 'name': TAG + '-上限', 'type': '正の数', 'user_id': 'tests',
        'equipment': '*', 'group': TAG, 'max': 99, 'maxFrom': 'なんでも.いい'})
    rec('知らない鍵は保存しない', lim_row().get('maxFrom') == '',
        json.dumps(lim_row().get('maxFrom'), ensure_ascii=False))

    # ---- 11) IDが無ければ断る（黙って新規を作らない） ----
    code, res = post('/api/operation-item-master/update', {'name': 'x', 'user_id': 'tests'})
    rec('更新にIDが無ければ断る', code == 400, '%s %s' % (code, res.get('error')))
    code, res = post('/api/operation-item-master/delete', {'user_id': 'tests'})
    rec('削除にIDが無ければ断る', code == 400, '%s %s' % (code, res.get('error')))
    code, res = post('/api/operation-item-master', {'name': '', 'user_id': 'tests'})
    rec('名前が空なら断る', code == 400, '%s %s' % (code, res.get('error')))
finally:
    # **後始末**。db/master.sqlite3は実行をまたいで生き延びる(§9.121)。
    for i in made_blocks:
        try:
            post('/api/report-block-master/delete', {'id': i, 'user_id': 'tests'})
        except Exception:
            pass
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
