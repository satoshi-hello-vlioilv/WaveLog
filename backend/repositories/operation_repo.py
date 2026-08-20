# -*- coding: utf-8 -*-
"""操業データ(§9.215): 設備ごとに「何を記録するか」を持つ2つのマスタ。

利用者の指示:

  「項目自体をマスタ化し他の設備でも使えるように設備ごとに持たせ、変更
   できるようにする、設定値も必要に応じてマスタ化して関連付け。各項目ごと、
   入力方式や入力上限値、入力データの型を選べるようにする」

設備が変われば記録したいものが変わる。**コードへ項目名を書かない**
——書くと、設備を1つ足すたびにこのファイルを直すことになる。

  - `操業データ項目マスタ` … 1行＝1つの入力欄（設備・群・名前・型・上限…）
  - `操業データ選択肢マスタ` … 1行＝1つの選択肢（名前でひとまとまり）

**選択肢は「名前」で参照する**(`[選択肢名]`)。IDで結ぶと、別のPCへ持ち出した
ときに連番が食い違って**無関係な選択肢が当たる**（フィルタの印で実際に
起きた・§9.171）。名前が見つからないときは**選択肢なし**として扱い、
項目そのものは残す（読み替えルールと同じ約束・§9.88）。

**対象設備の書式は設備停止マスタと同じ**(`schedule_repo.stop_equipment_*`)
——`'A'` / `'A,B,C'` / `'*'`(すべての設備)。判定を新しく書き起こさない。

値そのものは**測定レコードの中**(`settings.opData`)に入る。マスタへは
入れない——1ロット1枚の記録なので、レコードと一緒に運ばれるのが正しい
（子ロットデータと同じ扱い・§9.91）。
"""
from .master_repo import tables

ITEM_TABLE = '操業データ項目マスタ'
CHOICE_TABLE = '操業データ選択肢マスタ'

# 入力の型。**この6つから増やさない**——増やすほど「どれを選べばよいか」を
# 決める手間が増え、画面側の入力の作り分けも比例して増える。
#   整数     … 小数点なし（マイナス可）
#   正の整数 … 小数点なし・0以上
#   数値     … 小数可（マイナス可）
#   正の数   … 小数可・0以上
#   選択     … 選択肢マスタから選ぶ
#   文字     … 自由記述
ITEM_TYPES = ('整数', '正の整数', '数値', '正の数', '選択', '文字')
NUMERIC_TYPES = ('整数', '正の整数', '数値', '正の数')
POSITIVE_TYPES = ('正の整数', '正の数')
INTEGER_TYPES = ('整数', '正の整数')


def normalize_item_type(v):
    """知らない型は`文字`へ倒す。**例外にしない**——型を1つ打ち間違えただけで
    操業データの入力が丸ごと開けなくなるのは行き過ぎ。"""
    s = str(v or '').strip()
    return s if s in ITEM_TYPES else '文字'


# ---------------------------------------------------------------------------
# 初期値(§9.215、利用者から挙がった項目)。**初回作成時だけ**入れる。
# 対象設備は`*`(すべての設備)——「他の設備でも使えるように」という指示なので、
# まず全設備で使える形にし、設備ごとに変えたい現場が行を足す。
# ---------------------------------------------------------------------------
CHOICE_SEEDS = (
    ('運転方式', ('D', 'SD')),
    ('MDライナー主', ('28.4', '28.8', '29.2', '29.5')),
    ('MDライナーミニ', ('27.2', '29.1')),
    ('リコイラーモード', ('押', '-10')),
    ('出側デフライナー', ('152', '180', '202')),
    ('リール径', ('300', '400', '508')),
    ('内巻', ('テープ', 'チャック')),
    # 利用者の一覧では「テープ,青,パック,テープ」と**テープが2回**あった。
    # 同じ選択肢が2つ並ぶと「どちらを選べばよいか」が決められないので、
    # 1つにまとめてある（別物であれば名前を分けて登録できる）。
    ('後端', ('テープ', '青', 'パック')),
    ('台車', ('A', 'B')),
    ('刃厚', ('5', '10')),
    ('刃セット', ('A', 'B', 'C')),
    ('R/F', ('R', 'F')),
    # 大径・小径で同じ色を使うので**1つの選択肢を2つの項目が参照する**。
    ('リング色', ('茶', 'ピンク', '赤', '水', '黒')),
)

# (群, 項目名, 型, 小数桁, 最小, 最大, 選択肢名, 単位)
ITEM_SEEDS = (
    ('ラフレベラー', 'ラフレベラー 入', '整数', 0, None, None, '', ''),
    ('ラフレベラー', 'ラフレベラー 出', '整数', 0, None, None, '', ''),
    ('ワインダーテンション', 'ワインダーテンション トータルユニット', '正の数', 1, None, None, '', ''),
    ('巻取り', '運転方式', '選択', 0, None, None, '運転方式', ''),
    ('巻取り', '設定張力 アンコイラ', '正の数', 1, None, None, '', ''),
    ('巻取り', '設定張力 MD', '正の数', 1, None, None, '', ''),
    ('巻取り', 'MDライナー 主', '選択', 0, None, None, 'MDライナー主', ''),
    ('巻取り', 'MDライナー ミニ', '選択', 0, None, None, 'MDライナーミニ', ''),
    ('巻取り', 'セパレータ クリアランス', '正の数', 1, None, None, '', ''),
    ('巻取り', 'セパレータ リコイラーモード', '選択', 0, None, None, 'リコイラーモード', ''),
    ('巻取り', '反り 入側ピンチ圧', '正の数', 1, None, None, '', ''),
    ('巻取り', '反り 出側デフライナー', '選択', 0, None, None, '出側デフライナー', ''),
    ('巻取り', 'その他 速度', '正の整数', 0, None, None, '', ''),
    ('巻取り', 'リール径', '選択', 0, None, None, 'リール径', 'mm'),
    ('巻取り', 'リコイラ拡大圧', '正の数', 1, None, None, '', ''),
    ('製品', '製品 内巻', '選択', 0, None, None, '内巻', ''),
    ('製品', '製品 後端', '選択', 0, None, None, '後端', ''),
    ('スリット', 'スリット 台車', '選択', 0, None, None, '台車', ''),
    ('スリット', 'スリット 刃厚', '選択', 0, None, None, '刃厚', ''),
    ('スリット', 'スリット 刃セット', '選択', 0, None, None, '刃セット', ''),
    ('スリット', 'スリット 刃径', '正の数', 1, None, None, '', 'mm'),
    ('スリット', 'スリット クリアランス', '正の数', 1, None, None, '', ''),
    # 利用者の一覧でここだけ「正の数」ではなく「数値」だった＝**マイナスも入る**。
    ('スリット', 'スリット 実ラップ', '数値', 1, None, None, '', ''),
    ('スリット', 'スリット R/F', '選択', 0, None, None, 'R/F', ''),
    ('スリット', 'スリット 大径リング色', '選択', 0, None, None, 'リング色', ''),
    ('スリット', 'スリット 小径リング色', '選択', 0, None, None, 'リング色', ''),
)


# ---------------------------------------------------------------------------
# 選択肢マスタ
# ---------------------------------------------------------------------------
def ensure_choice_table(c):
    names = tables(c)
    if CHOICE_TABLE not in names:
        cur = c.cursor()
        cur.execute('CREATE TABLE [操業データ選択肢マスタ] ('
                    '[選択肢ID] INTEGER PRIMARY KEY AUTOINCREMENT, [選択肢名] TEXT, [値] TEXT, '
                    '[表示順] INTEGER, [有効] INTEGER, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_choices(c)
        return True
    return False


def _seed_choices(c):
    cur = c.cursor()
    for name, values in CHOICE_SEEDS:
        for i, v in enumerate(values):
            cur.execute('INSERT INTO [操業データ選択肢マスタ] '
                        '([選択肢名],[値],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                        'VALUES (?,?,?,-1,?,?,Now(),Now())',
                        [name, v, (i + 1) * 10, 'migrate:seed', 'migrate:seed'])
    c.commit()


def choice_rows(c, include_disabled=False):
    ensure_choice_table(c)
    cur = c.cursor()
    cur.execute('SELECT [選択肢ID],[選択肢名],[値],[表示順],[有効] '
                'FROM [操業データ選択肢マスタ] ORDER BY [選択肢名],[表示順],[選択肢ID]')
    out = []
    for r in cur.fetchall():
        on = True if r[4] is None else bool(r[4])
        if not on and not include_disabled:
            continue
        out.append({'id': r[0], 'name': str(r[1] or '').strip(),
                    'value': str(r[2] or ''), 'order': r[3], 'enabled': on})
    return out


def choice_map(c):
    """{選択肢名: [値,...]}。**表示順で並べる**（選ぶ順番は現場が決める）。"""
    out = {}
    for r in choice_rows(c):
        if not r['name']:
            continue
        out.setdefault(r['name'], []).append(r['value'])
    return out


def choice_names(c):
    return sorted({r['name'] for r in choice_rows(c, True) if r['name']})


def choice_upsert(c, name, value, uid, order=None, choice_id=None, enabled=True):
    ensure_choice_table(c)
    name = str(name or '').strip()
    value = str(value if value is not None else '').strip()
    if not name:
        raise ValueError('選択肢名を入力してください。')
    if not value:
        raise ValueError('値を入力してください。')
    cur = c.cursor()
    if choice_id is not None:
        # **並び順を渡していないときは今の値を残す**——空欄で保存したつもりが
        # NULLになると、その行だけ先頭へ飛ぶ（送っていない設定を消さない・§9.212 ②）。
        if order is None:
            cur.execute('SELECT [表示順] FROM [操業データ選択肢マスタ] WHERE [選択肢ID]=?',
                        [int(choice_id)])
            hit = cur.fetchone()
            order = hit[0] if hit else None
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [選択肢名]=?,[値]=?,[表示順]=?,[有効]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [選択肢ID]=?',
                    [name, value, order, -1 if enabled else 0, uid, int(choice_id)])
        c.commit()
        return int(choice_id)
    # 自然キーは(選択肢名,値)。同じ値を2つ並べない——どちらを選んでも同じ。
    cur.execute('SELECT [選択肢ID],[表示順] FROM [操業データ選択肢マスタ] '
                'WHERE [選択肢名]=? AND [値]=?', [name, value])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [表示順]=?,[有効]=?,[更新者ID]=?,'
                    '[更新日時]=Now() WHERE [選択肢ID]=?',
                    [hit[1] if order is None else order, -1 if enabled else 0, uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [操業データ選択肢マスタ] WHERE [選択肢名]=?', [name])
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
    cur.execute('INSERT INTO [操業データ選択肢マスタ] '
                '([選択肢名],[値],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,Now(),Now())',
                [name, value, order, -1 if enabled else 0, uid, uid])
    c.commit()
    return int(cur.lastrowid)


def choice_delete(c, choice_id, uid):
    ensure_choice_table(c)
    cur = c.cursor()
    cur.execute('DELETE FROM [操業データ選択肢マスタ] WHERE [選択肢ID]=?', [int(choice_id)])
    c.commit()
    return cur.rowcount


# ---------------------------------------------------------------------------
# 項目マスタ
# ---------------------------------------------------------------------------
def ensure_item_table(c):
    names = tables(c)
    if ITEM_TABLE not in names:
        cur = c.cursor()
        cur.execute('CREATE TABLE [操業データ項目マスタ] ('
                    '[項目ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [群] TEXT, '
                    '[項目名] TEXT, [表示順] INTEGER, [型] TEXT, [小数桁] INTEGER, '
                    '[最小値] REAL, [最大値] REAL, [選択肢名] TEXT, [単位] TEXT, '
                    '[必須] INTEGER, [備考] TEXT, [有効] INTEGER, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_items(c)
        return True
    return False


def _seed_items(c):
    cur = c.cursor()
    for i, (group, name, kind, dec, lo, hi, choice, unit) in enumerate(ITEM_SEEDS):
        cur.execute('INSERT INTO [操業データ項目マスタ] '
                    '([設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],'
                    '[選択肢名],[単位],[必須],[備考],[有効],'
                    '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,0,?,-1,?,?,Now(),Now())',
                    ['*', group, name, (i + 1) * 10, kind, dec, lo, hi, choice, unit, '',
                     'migrate:seed', 'migrate:seed'])
    c.commit()


def _row_to_item(r):
    return {'id': r[0], 'equipment': str(r[1] or '').strip(), 'group': str(r[2] or '').strip(),
            'name': str(r[3] or '').strip(), 'order': r[4],
            'type': normalize_item_type(r[5]), 'decimals': r[6],
            'min': r[7], 'max': r[8], 'choice': str(r[9] or '').strip(),
            'unit': str(r[10] or '').strip(),
            'required': bool(r[11]) if r[11] is not None else False,
            'note': str(r[12] or ''), 'enabled': True if r[13] is None else bool(r[13])}


def item_rows(c, include_disabled=False):
    ensure_item_table(c)
    cur = c.cursor()
    cur.execute('SELECT [項目ID],[設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],'
                '[選択肢名],[単位],[必須],[備考],[有効] '
                'FROM [操業データ項目マスタ] ORDER BY [表示順],[項目ID]')
    out = []
    for r in cur.fetchall():
        item = _row_to_item(r)
        if not item['enabled'] and not include_disabled:
            continue
        out.append(item)
    return out


def items_for_equipment(c, equipment):
    """その設備で使う項目だけ。判定は設備停止マスタと**同じ関数**を通す
    （`'*'`／カンマ区切り／名前の全角半角ゆれ。§CLAUDE）。"""
    from . import schedule_repo as sr
    eq = str(equipment or '').strip()
    out = []
    for item in item_rows(c):
        target = item['equipment']
        if not target or target == '*':
            out.append(item)
            continue
        if eq and sr.stop_equipment_matches(target, eq):
            out.append(item)
    return out


def item_upsert(c, uid, equipment='*', group='', name='', order=None, kind='文字',
                decimals=None, vmin=None, vmax=None, choice='', unit='',
                required=False, note='', enabled=True, item_id=None):
    ensure_item_table(c)
    name = str(name or '').strip()
    if not name:
        raise ValueError('項目名を入力してください。')
    equipment = str(equipment or '').strip() or '*'
    kind = normalize_item_type(kind)
    cur = c.cursor()
    # **並び順を渡していないときは今の値を残す**（§9.212 ②と同じ約束）。
    if order is None:
        if item_id is not None:
            cur.execute('SELECT [表示順] FROM [操業データ項目マスタ] WHERE [項目ID]=?',
                        [int(item_id)])
        else:
            cur.execute('SELECT [表示順] FROM [操業データ項目マスタ] '
                        'WHERE [設備名]=? AND [項目名]=?', [equipment, name])
        hit = cur.fetchone()
        if hit:
            order = hit[0]
    args = [equipment, str(group or '').strip(), name, order, kind, decimals, vmin, vmax,
            str(choice or '').strip(), str(unit or '').strip(),
            -1 if required else 0, str(note or ''), -1 if enabled else 0]
    if item_id is not None:
        cur.execute('UPDATE [操業データ項目マスタ] SET [設備名]=?,[群]=?,[項目名]=?,[表示順]=?,'
                    '[型]=?,[小数桁]=?,[最小値]=?,[最大値]=?,[選択肢名]=?,[単位]=?,[必須]=?,'
                    '[備考]=?,[有効]=?,[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
                    args + [uid, int(item_id)])
        c.commit()
        return int(item_id)
    # 自然キーは(設備名,項目名)。同じ設備に同じ名前を2つ置かない
    # ——値はこの名前を鍵にレコードへ入るので、2つあるとどちらの値か決まらない。
    cur.execute('SELECT [項目ID] FROM [操業データ項目マスタ] WHERE [設備名]=? AND [項目名]=?',
                [equipment, name])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [操業データ項目マスタ] SET [群]=?,[表示順]=?,[型]=?,[小数桁]=?,'
                    '[最小値]=?,[最大値]=?,[選択肢名]=?,[単位]=?,[必須]=?,[備考]=?,[有効]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
                    args[1:2] + args[3:] + [uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [操業データ項目マスタ]')
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
        args[3] = order
    cur.execute('INSERT INTO [操業データ項目マスタ] '
                '([設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],[選択肢名],'
                '[単位],[必須],[備考],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
                args + [uid, uid])
    c.commit()
    return int(cur.lastrowid)


def item_delete(c, item_id, uid):
    ensure_item_table(c)
    cur = c.cursor()
    cur.execute('DELETE FROM [操業データ項目マスタ] WHERE [項目ID]=?', [int(item_id)])
    c.commit()
    return cur.rowcount


# ---------------------------------------------------------------------------
# 画面へ渡す形
# ---------------------------------------------------------------------------
def form_for_equipment(c, equipment):
    """その設備の入力欄の定義一式。**選択肢は名前で解決してから渡す**
    ——画面が2度目の問い合わせをしなくて済む（測定画面は開いた瞬間に要る）。
    **名前が見つからない選択肢は空のまま返し、項目は残す**（設定の途中でも
    入力欄が丸ごと消えないように）。"""
    items = items_for_equipment(c, equipment)
    cmap = choice_map(c)
    out = []
    for it in items:
        row = dict(it)
        row['choices'] = list(cmap.get(it['choice'], [])) if it['choice'] else []
        row['choiceMissing'] = bool(it['choice']) and it['choice'] not in cmap
        out.append(row)
    return out
