# -*- coding: utf-8 -*-
"""帳票ブロックマスタ(§9.217): 帳票へ足す「自分で作った塊」。

利用者の指示:

  「内部データについても各項目ごと設計できるように、編集追加などできる
   ようにすることで設計の自由度を上げることができます。」

帳票の塊は`report-dashboard.js`の`RP_BLOCKS`が持っており、**中身の作り方は
コードの側**にある（測定表・条の図・異常位置判定のように、組み立てそのものが
仕事のものが多いため）。一方で「この値とこの値を並べて出したいだけ」という
塊は現場ごとに違い、そのたびにコードを直すのは現実的でない。

そこで**「ラベルと値の出どころを並べた塊」だけをマスタで作れる**ようにした。
1行＝1つの塊で、`[内容]`に`ラベル=出どころ`を並べる。出どころは測定レコードの
中の道（`basic.lotNo`／`settings.measureType`／`settings.opData.運転方式`…）で、
**操業データの項目もそのまま使える**（§9.216 ②で項目名が鍵になっているため）。

**幅と行数は規格の中から選ぶ**（§9.217）——紙は12マスのグリッドで、高さも
24pxを1行とする行数で持つ。自由に入れさせると、増えるたびに紙の割り付けが
崩れる（§9.135「粗いグリッドで組む」と同じ理由）。

対象設備の書式は設備停止マスタと同じ(`schedule_repo.stop_equipment_*`)。
判定を新しく書き起こさない。
"""
from .master_repo import tables

TABLE = '帳票ブロックマスタ'

# 幅（12マス基準）と高さ（行数）。**選べる数を増やさない**——粗いほど
# 左端がそろう（§9.135）。帳票の幅の選択肢（1/4・1/3・1/2・2/3・全幅）と
# 同じ数に合わせてある。
SPANS = (3, 4, 6, 8, 12)
# 5行は「ラベル貼付スペース」の既定（§9.174。枠だけの塊は「何も書いていない
# こと」が中身なので、自動高さだと1行に潰れる）。**既定を丸めて別の高さに
# しないこと**——マスタへ載せた瞬間に紙の見た目が変わる。
ROWS = (2, 3, 4, 5, 6, 8, 12)


def normalize_span(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 6
    return min(SPANS, key=lambda s: abs(s - n))


def normalize_rows(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return 0
    if n <= 0:
        return 0                      # 0＝中身なり（自動で測る）
    return min(ROWS, key=lambda s: abs(s - n))


# 画面が「出どころ」を選ばせるための見本。**ここに無い道も書ける**
# （測定レコードの形は増えるので、選択肢で塞がない）。
FIELD_CATALOG = (
    ('ロット番号', 'basic.lotNo'),
    ('検査番号', 'basic.inspectionNo'),
    ('鋳造番号', 'basic.castingNo'),
    ('オーダー番号', 'basic.orderNo'),
    ('用途名', 'basic.purposeName'),
    ('取引先', 'basic.customer'),
    ('納入先', 'basic.delivery'),
    ('製造材質', 'basic.material'),
    ('製造板厚', 'basic.thickness'),
    ('製造板幅', 'basic.width'),
    ('登録設備', 'settings.registeredEquipment'),
    ('入力内容', 'settings.measureType'),
    ('丈位置', 'settings.lengthPos'),
    ('縦割数', 'settings.verticalCount'),
    ('横割数', 'settings.horizontalCount'),
    ('オペレータ', 'settings.operator'),
    ('検査員', 'settings.inspector'),
    ('作業人数', 'settings.crewSize'),
    ('内径', 'settings.innerDiameter'),
    ('スプール', 'settings.spool'),
    ('作業開始時刻', 'workTime.startAt'),
    ('作業終了時刻', 'workTime.endAt'),
    ('更新日時', 'updatedAt'),
)


# 計算した値（`rpCalc`が作るもの）。**画面と同じ綴り**でここに並べる
# ——組み立ては`report-dashboard.js`が持つが、「何が選べるか」はサーバーが
# 答える（§9.163「判定を画面にも書かない」）。
CALC_CATALOG = (
    ('登録設備', 'calc.equipment'),
    ('コイル止め（旧データ込み）', 'calc.coilStop'),
    ('作業人数（N名班）', 'calc.crewSize'),
    ('作業開始時刻', 'calc.workStart'),
    ('作業終了時刻', 'calc.workEnd'),
    ('実働時間', 'calc.workDuration'),
    ('状態', 'calc.status'),
    ('更新日時', 'calc.updatedAt'),
)


def field_catalog(c, equipment=''):
    """塊に載せられる項目の一覧(§9.226 ④、利用者の指示)。

    「帳票ブロックを新規登録が難しすぎて作成できない。入力データ(汎用入力
     データも含む)の中から選んで組み合わせたり配置する方式で、直感的に
     組み合わせてデータブロックを作ることができるようにしてほしい」

    以前は`[内容]`に`ラベル=basic.lotNo`と**手で書かせて**いた。道の綴りを
    知らないと1行も書けないので、実際には誰も作れない（§4の裏返しで、
    「できると書いてあるのにできない」状態だった）。

    ここが**選べるものの唯一の一覧**。**操業データの項目はマスタから引く**
    ので、現場が項目を足せばそのまま候補に増える（コードへ項目名を書かない
    ・§9.215）。出どころごとに分けて返し、画面はそれをそのまま並べる。

    **読めなかった塊は飛ばす**（fail-open）——1つ読めないだけで候補が
    丸ごと空になると、作る手立てが消える。"""
    groups = [
        {'group': '仕掛（ロットの情報）',
         'note': '測定を始めたときに仕掛データから写した値です。',
         'items': [{'label': l, 'path': p} for l, p in FIELD_CATALOG
                   if p.startswith('basic.')]},
    ]
    prep, opdata = [], []
    try:
        from . import operation_repo as op
        # **設備を指定していないときは全部の項目**（マスタ管理の一覧から
        # 開いたときは設備が決まっていない。候補が空だと1つも選べない）。
        rows = (op.items_for_equipment(c, equipment, True) if str(equipment or '').strip()
                else op.item_rows(c, True))
        seen = set()
        for it in rows:
            name = str(it.get('name') or '').strip()
            if not name:
                continue
            if name in seen:
                continue
            seen.add(name)
            builtin = str(it.get('builtin') or '').strip()
            unit = str(it.get('unit') or '').strip()
            row = {'label': name, 'unit': unit,
                   'note': (it.get('group') or '') + (f'／{unit}' if unit else '')}
            if builtin:
                # 組み込みの欄は画面がもともと持っている置き場（`settings.<キー>`）。
                row['path'] = 'settings.' + builtin
                prep.append(row)
            else:
                # 自由項目は**項目名が鍵**（§9.215）。
                row['path'] = 'settings.opData.' + name
                opdata.append(row)
    except Exception:
        pass
    if prep:
        groups.append({'group': '準備で決めた値',
                       'note': '測定画面がもともと持っている入力欄です。',
                       'items': prep})
    if opdata:
        groups.append({'group': '操業データ（現場で足した項目）',
                       'note': '操業データ項目マスタで足した入力欄です。項目を足すとここにも増えます。',
                       'items': opdata})
    groups.append({'group': '作業時間',
                   'note': '測定の開始・終了の記録です。',
                   'items': [{'label': l, 'path': p} for l, p in FIELD_CATALOG
                             if p.startswith('workTime.') or p == 'updatedAt']})
    groups.append({'group': '計算した値',
                   'note': '実働時間・状態など、いくつかの値から作るものです。',
                   'items': [{'label': l, 'path': p} for l, p in CALC_CATALOG]})
    return [g for g in groups if g['items']]


# ---------------------------------------------------------------------------
# 既定の塊も**マスタに登録された状態**にする（§9.219 ②、利用者の指示
# 「既定の帳票ブロックについても編集ができるように、マスタに登録されている
#  状態に汎用化してください」）。
#
# **中身の作り方はコードのまま**（測定表・条の図・異常位置判定は組み立てその
# ものが仕事）。マスタが持つのは**名前・幅・行数・並び・出す/出さない・対象
# 設備**で、`操業データ項目マスタ`の組み込み行と同じ境界の引き方
# （§9.216 ②「作り直さず、割り付けだけを差配する」）。
#
# ただし**「ラベルと値の出どころを並べただけ」の塊は`[内容]`も編集できる**
# ——ここが「内部データについても各項目ごと設計できるように」（§9.217の
# 利用者の指示）に対する答えで、現場ごとに違う項目を足し引きできる。
# 導出のある値（実働時間・状態・作業人数の「N名班」・コイル止めの旧データ）は
# `calc.*`という道で引けるようにしてあるので、内容へ書ける。
#
# 種は (組み込みキー, 幅, 行数, 内訳列数, 内容) 。**キーがそのまま塊の名前**
# ——列レイアウトマスタ（対象`report:<設備>`）が名前を鍵に並び・幅・高さを
# 持っているため、キーを変えると保存済みの設定が全部外れる（§9.113）。
BUILTIN_SEEDS = (
    ('ラベル貼付スペース', 3, 5, 0, ''),
    ('基本情報', 6, 0, 0,
     'ロット番号=basic.lotNo\n検査番号=basic.inspectionNo\n鋳造番号=basic.castingNo\n'
     'オーダー番号=basic.orderNo\n引当番号=basic.allocationNo\n用途コード=basic.purposeCode\n'
     '用途名=basic.purposeName\n取引先=basic.customer\n納入先=basic.delivery'),
    ('コース情報', 3, 0, 1,
     '設計コース=basic.designCourse\n実績コース=basic.course\n残コース=basic.residualCourse'),
    ('寸法（オーダー／製造）', 4, 0, 0, ''),
    ('品質等級', 4, 0, 0, ''),
    ('品質情報（仕掛）', 4, 0, 0, ''),
    ('測定条件', 8, 0, 4,
     '登録設備=calc.equipment\n入力内容=settings.measureType\n丈位置=settings.lengthPos\n'
     '縦割数=settings.verticalCount\n横割数=settings.horizontalCount\n巻出方向=settings.unwind\n'
     '内径=settings.innerDiameter\nスプール=settings.spool\n板厚測定器=settings.thicknessGauge\n'
     '板幅測定器=settings.widthGauge\n条入力順=settings.widthOrder\n方向=settings.widthDirection\n'
     'バリ揃え=settings.burr\nコイル止め=calc.coilStop'),
    ('作業班構成', 4, 0, 0,
     'オペレータ=settings.operator\n検査員=settings.inspector\n梱包員=settings.packer\n'
     '作業人数=calc.crewSize'),
    ('母材実績／カード指示', 6, 0, 0, ''),
    ('丈別データ', 6, 0, 0, ''),
    ('板厚の測定データ', 12, 0, 0, ''),
    ('板幅ほかの測定データ', 12, 0, 0, ''),
    ('測定データ・板幅', 6, 0, 0, ''),
    ('測定データ・ラテラルボー', 4, 0, 0, ''),
    ('測定データ・バリ', 4, 0, 0, ''),
    ('測定データ・巻ずれ', 4, 0, 0, ''),
    ('測定データ・テレスコープ', 4, 0, 0, ''),
    ('測定データ・フラットネス', 4, 0, 0, ''),
    ('測定データ・備考', 4, 0, 0, ''),
    ('異常位置判定', 12, 0, 0, ''),
    ('作業時間', 6, 0, 0,
     '開始時刻=calc.workStart\n終了時刻=calc.workEnd\n実働時間=calc.workDuration'),
    ('登録状態', 6, 0, 0,
     '状態=calc.status\n更新日時=calc.updatedAt\nNG回数=settings.ngCount'),
)
BUILTIN_KEYS = tuple(x[0] for x in BUILTIN_SEEDS)
# **中身をマスタで書き換えてよい塊**（＝ラベルと出どころを並べただけのもの）。
# ここに無い塊の`[内容]`は効かないので、画面は欄ごと出さずに理由を書く（§4）。
CONTENT_EDITABLE = frozenset(k for k, _s, _r, _c, content in BUILTIN_SEEDS if content)


def parse_content(text):
    """`ラベル=出どころ`の並びを読む。改行でもカンマでも区切れる。

    **壊れた行は1行だけ落とす**（§9.88の読み替えルールと同じ約束）——
    1行の書き間違いで塊ごと消えると、どこが悪いのか分からなくなる。
    `=`が無い行は「ラベルも道も同じ」として扱う（`basic.lotNo`だけ書いても
    出る）。"""
    out = []
    for raw in str(text or '').replace('、', ',').replace('\r', '\n').replace(',', '\n').split('\n'):
        s = raw.strip()
        if not s:
            continue
        if '=' in s:
            label, _, path = s.partition('=')
            label, path = label.strip(), path.strip()
        else:
            label, path = s, s
        if not path:
            continue
        out.append({'label': label or path, 'path': path})
    return out


def _row(r):
    builtin = str(r[9] or '').strip()
    return {'id': r[0], 'equipment': str(r[1] or '').strip(),
            'name': str(r[2] or '').strip(), 'order': r[3],
            'span': normalize_span(r[4]), 'rows': normalize_rows(r[5]),
            'content': str(r[6] or ''), 'fields': parse_content(r[6]),
            'note': str(r[7] or ''), 'enabled': True if r[8] is None else bool(r[8]),
            # **画面から入切できる形でも返す**（§9.219 ②）。マスタ管理の
            # 汎用フォームは文字列の選択欄しか持たないので、真偽値のままだと
            # 欄を出せない——**欄が無いと既定の塊を紙から外す手立てが消える**
            # （消せない・無効にもできない行き止まりになる）。
            'enabledText': '有効' if (r[8] is None or bool(r[8])) else '無効',
            # 既定の塊（§9.219 ②）。空なら現場が足した塊。
            'builtin': builtin,
            # 節の中を何列で並べるか（`reportSection`の第3引数）。0＝既定。
            'cols': int(r[10] or 0) if str(r[10] or '').strip() != '' else 0,
            # **中身を書き換えてよいか。** 中身の作り方が仕事の塊
            # （測定表・条の図・異常位置判定）は書き換えても効かないので、
            # 画面は欄ごと出さずに理由を書く（§4）。
            'contentEditable': (not builtin) or (builtin in CONTENT_EDITABLE)}


# 後から足した列（§9.180「無ければ足す」で移行する。共有DBは現場で動いて
# いるので作り直さない）。
_ADDED_COLUMNS = (
    ('組み込みキー', 'TEXT'),      # 既定の塊はどのコードの塊か（自作は空）
    ('内訳列数', 'INTEGER'),       # 節の中を何列で並べるか（0＝既定）
)


def _ensure_columns(c):
    cur = c.cursor()
    have = {r[1] for r in cur.execute(f'PRAGMA table_info([{TABLE}])')}
    added = False
    for name, kind in _ADDED_COLUMNS:
        if name not in have:
            cur.execute(f'ALTER TABLE [{TABLE}] ADD COLUMN [{name}] {kind}')
            added = True
    if added:
        c.commit()
    return added


def _seed_builtins(c):
    """既定の塊をマスタの行として置く。**足りないキーだけ**入れる。

    `operation_repo._seed_builtins`は「組み込みの行が1つでもあれば何もしない」
    ——利用者が消した行を作り直さないためだが、**こちらは既定の塊を消せない**
    （`block_delete`が断る）ので、その心配が無い。代わりに**コードへ塊を1つ
    足したときに、既にあるDBへも行が入る**ほうが大事——入らないと、その塊
    だけがマスタに出ず、名前も幅も変えられない（画面には出るのに設定できない、
    という分かりにくい形になる）。"""
    cur = c.cursor()
    cur.execute(f"SELECT [組み込みキー] FROM [{TABLE}] "
                "WHERE [組み込みキー] IS NOT NULL AND [組み込みキー]<>''")
    have = {str(r[0] or '').strip() for r in cur.fetchall()}
    todo = [x for x in BUILTIN_SEEDS if x[0] not in have]
    if not todo:
        return False
    if not have:
        # **初回だけ既定を先頭へ。** 自作の塊は既に並んでいるので後ろへ送る。
        cur.execute(f'UPDATE [{TABLE}] SET [表示順]=COALESCE([表示順],0)+1000')
        base = 0
    else:
        cur.execute(f'SELECT MAX([表示順]) FROM [{TABLE}]')
        base = int((cur.fetchone() or [0])[0] or 0)
    for i, (key, span, rows, cols, content) in enumerate(todo):
        cur.execute(f'INSERT INTO [{TABLE}] '
                    '([設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
                    '[組み込みキー],[内訳列数],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    "VALUES (?,?,?,?,?,?,'',-1,?,?,?,?,Now(),Now())",
                    ['*', key, base + (i + 1) * 10, span, rows, content, key, cols,
                     'migrate:seed', 'migrate:seed'])
    c.commit()
    return True


def ensure_table(c):
    if TABLE not in tables(c):
        cur = c.cursor()
        cur.execute('CREATE TABLE [帳票ブロックマスタ] ('
                    '[ブロックID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, '
                    '[ブロック名] TEXT, [表示順] INTEGER, [幅] INTEGER, [行数] INTEGER, '
                    '[内容] TEXT, [備考] TEXT, [有効] INTEGER, '
                    '[組み込みキー] TEXT, [内訳列数] INTEGER, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_builtins(c)
        return True
    _ensure_columns(c)
    _seed_builtins(c)
    return False


_SELECT = ('SELECT [ブロックID],[設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
           '[組み込みキー],[内訳列数] '
           f'FROM [{TABLE}] ORDER BY [表示順],[ブロックID]')


def block_rows(c, include_disabled=False):
    ensure_table(c)
    cur = c.cursor()
    cur.execute(_SELECT)
    out = []
    for r in cur.fetchall():
        b = _row(r)
        if not b['enabled'] and not include_disabled:
            continue
        out.append(b)
    return out


def blocks_for_equipment(c, equipment):
    """その設備で使う塊だけ。判定は設備停止マスタと**同じ関数**を通す。"""
    from . import schedule_repo as sr
    eq = str(equipment or '').strip()
    out = []
    for b in block_rows(c):
        target = b['equipment']
        if not target or target == '*':
            out.append(b)
            continue
        if eq and sr.stop_equipment_matches(target, eq):
            out.append(b)
    return out


def builtin_off(c, equipment):
    """この設備で**出さない**既定の塊（無効にした／別の設備のもの）。

    `operation_repo.form_for_equipment`の`builtinOff`と同じ役割
    （§9.216 ②）——画面はコードの側にも既定の塊を持っているので、
    「無効にした」を名指しで伝えないと**その塊だけが今までどおり出たまま**に
    なる（マスタで外したつもりの塊が消えない、という分かりにくい壊れ方）。"""
    live = {b['builtin'] for b in blocks_for_equipment(c, equipment) if b['builtin']}
    known = {b['builtin'] for b in block_rows(c, True) if b['builtin']}
    return sorted(known - live)


def block_upsert(c, uid, equipment='*', name='', order=None, span=6, rows=0,
                 content='', note='', enabled=True, block_id=None,
                 builtin=None, cols=None):
    ensure_table(c)
    name = str(name or '').strip()
    if not name:
        raise ValueError('ブロック名を入力してください。')
    equipment = str(equipment or '').strip() or '*'
    cur = c.cursor()
    # **組み込みの印は付け替えられない**（§9.219 ②、`item_upsert`と同じ約束）。
    # 既定の塊はコードの`RP_BLOCKS`のどれかを指しているので、後から書き換えると
    # 「どの塊の設定なのか」が決まらなくなる。渡し忘れでも消えないよう、
    # 既存行の値を引き継ぐ。
    cur_builtin = ''
    cur_cols = 0
    if block_id is not None:
        cur.execute(f'SELECT [組み込みキー],[内訳列数] FROM [{TABLE}] WHERE [ブロックID]=?',
                    [int(block_id)])
        hit = cur.fetchone()
        cur_builtin = str((hit or ['', 0])[0] or '').strip()
        cur_cols = int((hit or ['', 0])[1] or 0)
    if builtin is None:
        builtin = cur_builtin
    builtin = str(builtin or '').strip()
    if cols is None:
        cols = cur_cols
    try:
        cols = max(0, min(6, int(cols or 0)))
    except (TypeError, ValueError):
        cols = 0
    # **並び順を渡していないときは今の値を残す**（§9.212 ②と同じ約束）。
    if order is None:
        if block_id is not None:
            cur.execute('SELECT [表示順] FROM [帳票ブロックマスタ] WHERE [ブロックID]=?', [int(block_id)])
        else:
            cur.execute('SELECT [表示順] FROM [帳票ブロックマスタ] WHERE [設備名]=? AND [ブロック名]=?',
                        [equipment, name])
        hit = cur.fetchone()
        if hit:
            order = hit[0]
    args = [equipment, name, order, normalize_span(span), normalize_rows(rows),
            str(content or ''), str(note or ''), -1 if enabled else 0, builtin, cols]
    if block_id is not None:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [設備名]=?,[ブロック名]=?,[表示順]=?,[幅]=?,'
                    '[行数]=?,[内容]=?,[備考]=?,[有効]=?,[組み込みキー]=?,[内訳列数]=?,'
                    '[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [ブロックID]=?', args + [uid, int(block_id)])
        c.commit()
        return int(block_id)
    # 自然キーは(設備名,ブロック名)。**同じ設備に同じ名前を2つ置かない**
    # ——塊の並び・幅・高さは名前を鍵に列レイアウトマスタへ入るので、
    # 2つあるとどちらの設定か決まらない（§9.113と同じ理由）。
    cur.execute('SELECT [ブロックID] FROM [帳票ブロックマスタ] WHERE [設備名]=? AND [ブロック名]=?',
                [equipment, name])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [表示順]=?,[幅]=?,[行数]=?,[内容]=?,[備考]=?,'
                    '[有効]=?,[組み込みキー]=?,[内訳列数]=?,[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [ブロックID]=?', args[2:] + [uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [帳票ブロックマスタ]')
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
        args[2] = order
    cur.execute('INSERT INTO [帳票ブロックマスタ] '
                '([設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
                '[組み込みキー],[内訳列数],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())', args + [uid, uid])
    c.commit()
    return int(cur.lastrowid)


def block_delete(c, block_id, uid):
    """**既定の塊は消せない**（§9.219 ②）。中身の作り方はコードの側にあるので、
    行を消しても塊そのものは残る——消えたように見えて出続けるほうが分かり
    にくい。出したくないときは`[有効]`を外す（`builtin_off`が画面へ伝える）。"""
    ensure_table(c)
    cur = c.cursor()
    cur.execute(f'SELECT [組み込みキー] FROM [{TABLE}] WHERE [ブロックID]=?', [int(block_id)])
    hit = cur.fetchone()
    if hit and str(hit[0] or '').strip():
        raise ValueError('既定の帳票ブロックは消せません。紙へ出したくないときは'
                         '「有効」を外してください（中身の作り方は画面側にあるため、'
                         '行を消しても塊そのものは無くなりません）。')
    cur.execute('DELETE FROM [帳票ブロックマスタ] WHERE [ブロックID]=?', [int(block_id)])
    c.commit()
    return cur.rowcount
