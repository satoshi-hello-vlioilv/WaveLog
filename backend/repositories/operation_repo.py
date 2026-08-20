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


# 入力欄をどこへ出すか(§9.216 ②、利用者の指示)。
#   準備     … ①準備の「操業データ」カード
#   入力内容 … ②測定の「入力内容」カードの中（畳んでおき、関係のある
#              測定項目を選んだときだけ開く）
# **置き場を増やさない**——増やすほど「どこに出るのか」を覚える手間が増える。
PLACE_PREP = '準備'
PLACE_INPUT = '入力内容'
PLACES = (PLACE_PREP, PLACE_INPUT)


def normalize_place(v):
    s = str(v or '').strip()
    return s if s in PLACES else PLACE_PREP


# 1つの群を何マスで組むか。**カードの中は12マス**（§9.218 ②、利用者の指摘
# 「マスタで表示できる列数指定もできるがバリエーションも少なく1列と2列の
#  間もほしい」）。以前は6マス・選べるのは1/2/3/6の4通りで、いちばん狭い
# 「1マス」と次の「2マス」のあいだに刻みが無く、4マス・5マスも選べなかった。
#
# **§9.135の「可能な限り粗いグリッド」に反しない。** あちらは画面の外側
# （カードの並び）の話で、「細かくするのはカードの内側だけ」と明記してある
# ——外から見えるのはカード1枚なので、中が12マスでも画面はがたつかない。
#
# 呼び名は**6マス時代の「列」**で通す（1列＝2マス）。現場は「2列ぶん」と
# 言い慣れているので、マスの数だけを出すと全部が倍になったように読める。
SPANS = tuple(range(1, 13))
GRID_COLS = 12
SPAN_UNIT = 2                      # 「1列」＝2マス（6マス時代との対応）
DEFAULT_SPAN = 4                   # 既定は「2列」＝4マス（今までの既定と同じ幅）


def normalize_span(v):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return DEFAULT_SPAN
    return n if n in SPANS else DEFAULT_SPAN


# 選ばせ方(§9.218 ②、利用者の指示「プルダウンだけでなく、ラジオボタンや
# タブっぽいボタン、フローティングモーダルみたいに選択肢が多い時に説明付きで
# 出ると選びやすい」)。**選択肢を持つ項目にだけ効く**——数値や自由記述に
# 「ラジオ」を選ばせても何も起きない（押せるのに効かない設定を作らない・§4）。
#   プルダウン … 今までどおりの`<select>`（既定）
#   ラジオ     … 縦（狭いときは折り返す）に並ぶラジオボタン。3〜5個向き
#   タブ       … 横に連なるボタン（見た目はタブ）。2〜4個向き
#   一覧       … 押すと浮き窓が開き、**説明つき**で選ぶ。選択肢が多いとき
WIDGET_SELECT = 'プルダウン'
WIDGETS = (WIDGET_SELECT, 'ラジオ', 'タブ', '一覧')
# 選択肢を持たない型では「選ばせ方」は効かない。判定はここ1箇所。
CHOICE_TYPES = ('選択',)


def normalize_widget(v):
    s = str(v or '').strip()
    return s if s in WIDGETS else WIDGET_SELECT


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
# 準備の入力欄も「操業データの1行」にする(§9.216 ②、利用者の指示)
# ---------------------------------------------------------------------------
# 「既存のオペレータ、検査員、作業人数、内径、スプール、縦割数、横割数、
#  板厚測定器、板幅測定器、巻出し方向、など、準備で入力させている情報の
#  すべてを操業データとして、入力している項目を汎用化したい」
#
# **画面が持っている入力欄をマスタが差配する**形にする。作り直すのではなく、
# 既にある`<label data-f="...">`の**並び・群・幅・必須・置き場だけ**を
# マスタが決める——作り直すと、内径のプリセット(§9.204)・条数の上限
# (§9.210 ⑤)・オペレータ171人の実測幅(§9.130)といった、それぞれの欄が
# 持っている仕掛けを全部書き直すことになる。
#
# だから組み込みの行は**型・小数桁・上下限・選択肢名を持たない**（持っても
# 効かない＝押せるのに何も起きない欄になる。§4）。マスタ管理の画面でも
# それらは出さない。
#
# (組み込みキー, 群, 項目名, 列幅, 必須, 置き場, 群折りたたみ, 表示条件)
BUILTIN_SEEDS = (
    ('operator', '誰が測るか', 'オペレータ', 4, True, PLACE_PREP, False, ''),
    ('inspector', '誰が測るか', '検査員', 4, False, PLACE_PREP, False, ''),
    ('crewSize', '誰が測るか', '作業人数', 4, False, PLACE_PREP, False, ''),
    ('verticalCount', '測定表の形', '縦割数', 3, False, PLACE_PREP, False, ''),
    ('horizontalCount', '測定表の形', '横割数', 3, False, PLACE_PREP, False, ''),
    ('innerDiameter', '使う機材', '内径', 4, False, PLACE_PREP, False, ''),
    ('spool', '使う機材', 'スプール', 4, False, PLACE_PREP, False, ''),
    ('thicknessGauge', '使う機材', '板厚測定器', 4, False, PLACE_PREP, False, ''),
    ('widthGauge', '使う機材', '板幅測定器', 4, False, PLACE_PREP, False, ''),
    ('unwind', 'いつもと同じ設定', '巻出方向', 4, False, PLACE_PREP, True, ''),
    ('burr', 'いつもと同じ設定', 'バリ揃え', 4, False, PLACE_PREP, True, ''),
    ('coilStop', 'いつもと同じ設定', 'コイル止め', 4, False, PLACE_PREP, True, ''),
    # **条入力順と方向は準備に無関係**（§9.216 ③、利用者の指示）。条を打つ
    # ときの順番なので、置き場は②測定の「入力内容」カード。畳んでおき、
    # **条を入力する測定項目を選んだときだけ開く**。板厚は丈ごとに3点
    # （OS/CL/DS）で条に紐づかないので入っていない（§9.214）。
    ('widthOrder', '条の入力', '条入力順', 6, False, PLACE_INPUT, True,
     '板幅,ラテラルボー,バリ,テレスコープ,巻ずれ,フラットネス'),
    ('widthDirection', '条の入力', '方向', 6, False, PLACE_INPUT, True,
     '板幅,ラテラルボー,バリ,テレスコープ,巻ずれ,フラットネス'),
)
BUILTIN_KEYS = tuple(x[0] for x in BUILTIN_SEEDS)


# ---------------------------------------------------------------------------
# 選択肢マスタ
# ---------------------------------------------------------------------------
# 後から足した列(§9.218 ②)。**作り直さない**——現場では既に動いている
# （§9.180の「無ければ足す」で移行する作法）。
_CHOICE_ADDED_COLUMNS = (
    # 「選択肢が多い時に説明付きで出ると選びやすい」（利用者の指示）。
    # 一覧から選ぶ形（浮き窓）でだけ出る。空欄なら値だけが出る。
    ('説明', 'TEXT'),
)


def _ensure_choice_columns(c):
    cur = c.cursor()
    have = {r[1] for r in cur.execute(f'PRAGMA table_info([{CHOICE_TABLE}])')}
    added = False
    for name, kind in _CHOICE_ADDED_COLUMNS:
        if name not in have:
            cur.execute(f'ALTER TABLE [{CHOICE_TABLE}] ADD COLUMN [{name}] {kind}')
            added = True
    if added:
        c.commit()
    return added


def ensure_choice_table(c):
    names = tables(c)
    if CHOICE_TABLE not in names:
        cur = c.cursor()
        cur.execute('CREATE TABLE [操業データ選択肢マスタ] ('
                    '[選択肢ID] INTEGER PRIMARY KEY AUTOINCREMENT, [選択肢名] TEXT, [値] TEXT, '
                    '[説明] TEXT, [表示順] INTEGER, [有効] INTEGER, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_choices(c)
        return True
    _ensure_choice_columns(c)
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
    cur.execute('SELECT [選択肢ID],[選択肢名],[値],[表示順],[有効],[説明] '
                'FROM [操業データ選択肢マスタ] ORDER BY [選択肢名],[表示順],[選択肢ID]')
    out = []
    for r in cur.fetchall():
        on = True if r[4] is None else bool(r[4])
        if not on and not include_disabled:
            continue
        out.append({'id': r[0], 'name': str(r[1] or '').strip(),
                    'value': str(r[2] or ''), 'order': r[3], 'enabled': on,
                    'note': str(r[5] or '')})
    return out


def choice_notes(c):
    """{選択肢名: {値: 説明}}。**説明のあるものだけ**——空を並べると、画面が
    「説明が無い」のか「まだ読めていない」のか区別できない。"""
    out = {}
    for r in choice_rows(c):
        if r['name'] and r['note']:
            out.setdefault(r['name'], {})[r['value']] = r['note']
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


def choice_usage(c):
    """{選択肢名: [その選択肢を使っている項目名,...]}(§9.216 ④、利用者の指示
    「相互リンク、連携を強めてより登録の負荷を下げて汎用性を向上させて
    ほしい」)。

    **使い道の見えない選択肢は消してよいのか判断できない**——消すと項目側は
    `choiceMissing`になって黙って空の欄になる（§9.215で「項目は残す」と
    決めてあるぶん、気づきにくい）。読むだけなので失敗させない。"""
    out = {}
    try:
        for it in item_rows(c, True):
            if it['choice']:
                out.setdefault(it['choice'], []).append(it['name'])
    except Exception:
        return {}
    return out


def choice_upsert(c, name, value, uid, order=None, choice_id=None, enabled=True, note=None):
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
        if note is None:
            cur.execute('SELECT [説明] FROM [操業データ選択肢マスタ] WHERE [選択肢ID]=?',
                        [int(choice_id)])
            hit = cur.fetchone()
            note = (hit or [''])[0] or ''
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [選択肢名]=?,[値]=?,[説明]=?,[表示順]=?,'
                    '[有効]=?,[更新者ID]=?,[更新日時]=Now() WHERE [選択肢ID]=?',
                    [name, value, str(note or ''), order, -1 if enabled else 0, uid,
                     int(choice_id)])
        c.commit()
        return int(choice_id)
    # 自然キーは(選択肢名,値)。同じ値を2つ並べない——どちらを選んでも同じ。
    cur.execute('SELECT [選択肢ID],[表示順],[説明] FROM [操業データ選択肢マスタ] '
                'WHERE [選択肢名]=? AND [値]=?', [name, value])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [表示順]=?,[説明]=?,[有効]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [選択肢ID]=?',
                    [hit[1] if order is None else order,
                     str((hit[2] if note is None else note) or ''),
                     -1 if enabled else 0, uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [操業データ選択肢マスタ] WHERE [選択肢名]=?', [name])
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
    cur.execute('INSERT INTO [操業データ選択肢マスタ] '
                '([選択肢名],[値],[説明],[表示順],[有効],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,Now(),Now())',
                [name, value, str(note or ''), order, -1 if enabled else 0, uid, uid])
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
# 後から足した列(§9.216 ②)。共有ではなく各端末の`master.sqlite3`だが、
# 現場では既に動いているので**作り直さない**——「無ければ足す」で移行する
# （§9.180の`作業予定`・`Web測定バックアップ`と同じ作法）。
_ITEM_ADDED_COLUMNS = (
    ('組み込みキー', 'TEXT'),      # 画面が持っている入力欄の名前（自由項目は空）
    ('置き場', 'TEXT'),            # 準備 / 入力内容
    ('列幅', 'INTEGER'),           # カードの中の12マスグリッドで何マスぶんか
    ('群折りたたみ', 'INTEGER'),   # その群を畳んで出すか
    ('表示条件', 'TEXT'),          # 畳んだ群を自動で開く測定項目（カンマ区切り）
    ('入力方法', 'TEXT'),          # プルダウン / ラジオ / タブ / 一覧（§9.218 ②）
)


def _ensure_item_columns(c):
    cur = c.cursor()
    have = {r[1] for r in cur.execute(f'PRAGMA table_info([{ITEM_TABLE}])')}
    added = False
    # **マスの数え方が変わったことの目印は「列そのもの」**（§9.218 ②）。
    # 6マス→12マスにしたので、保存済みの`[列幅]`は倍にしないと**全部が
    # 半分の幅になる**。専用の目印を別に持つと、それを消したときに二重に
    # 掛かる——`[入力方法]`が無い＝12マスへ移る前の行、という1つの事実で
    # 判断する（列を足す作業そのものが1度きりなので、目印として確実）。
    grow = '入力方法' not in have and '列幅' in have
    for name, kind in _ITEM_ADDED_COLUMNS:
        if name not in have:
            cur.execute(f'ALTER TABLE [{ITEM_TABLE}] ADD COLUMN [{name}] {kind}')
            added = True
    if grow:
        cur.execute(f'UPDATE [{ITEM_TABLE}] SET [列幅]=[列幅]*{SPAN_UNIT} '
                    'WHERE [列幅] IS NOT NULL AND [列幅]>0')
    if added:
        c.commit()
    return added


def _seed_builtins(c):
    """準備の入力欄をマスタの行として置く。**1度だけ**（組み込みの行が
    1つも無いときだけ）——利用者が消した行を毎回作り直すと、消せない設定に
    なってしまう。"""
    cur = c.cursor()
    cur.execute(f"SELECT COUNT(*) FROM [{ITEM_TABLE}] "
                "WHERE [組み込みキー] IS NOT NULL AND [組み込みキー]<>''")
    if (cur.fetchone() or [0])[0]:
        return False
    # **組み込みは先頭へ**。自由項目（挙がっていた26項目）は既に並んでいるので、
    # そのぶんを後ろへ送ってから前を空ける（並びの意味は変えない）。
    cur.execute(f'UPDATE [{ITEM_TABLE}] SET [表示順]=COALESCE([表示順],0)+1000')
    for i, (key, group, name, span, req, place, fold, when) in enumerate(BUILTIN_SEEDS):
        cur.execute(f'INSERT INTO [{ITEM_TABLE}] '
                    '([設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],'
                    '[選択肢名],[単位],[必須],[備考],[有効],[組み込みキー],[置き場],[列幅],'
                    '[群折りたたみ],[表示条件],[入力方法],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    "VALUES (?,?,?,?,'',NULL,NULL,NULL,'','',?,'',-1,?,?,?,?,?,'',?,?,Now(),Now())",
                    ['*', group, name, (i + 1) * 10, -1 if req else 0,
                     key, place, span, -1 if fold else 0, when,
                     'migrate:seed', 'migrate:seed'])
    c.commit()
    return True


def ensure_item_table(c):
    names = tables(c)
    if ITEM_TABLE not in names:
        cur = c.cursor()
        cur.execute('CREATE TABLE [操業データ項目マスタ] ('
                    '[項目ID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, [群] TEXT, '
                    '[項目名] TEXT, [表示順] INTEGER, [型] TEXT, [小数桁] INTEGER, '
                    '[最小値] REAL, [最大値] REAL, [選択肢名] TEXT, [単位] TEXT, '
                    '[必須] INTEGER, [備考] TEXT, [有効] INTEGER, '
                    '[組み込みキー] TEXT, [置き場] TEXT, [列幅] INTEGER, '
                    '[群折りたたみ] INTEGER, [表示条件] TEXT, [入力方法] TEXT, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_items(c)
        _seed_builtins(c)
        return True
    _ensure_item_columns(c)
    _seed_builtins(c)
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
    builtin = str(r[14] or '').strip()
    return {'id': r[0], 'equipment': str(r[1] or '').strip(), 'group': str(r[2] or '').strip(),
            'name': str(r[3] or '').strip(), 'order': r[4],
            'type': normalize_item_type(r[5]), 'decimals': r[6],
            'min': r[7], 'max': r[8], 'choice': str(r[9] or '').strip(),
            'unit': str(r[10] or '').strip(),
            'required': bool(r[11]) if r[11] is not None else False,
            'note': str(r[12] or ''), 'enabled': True if r[13] is None else bool(r[13]),
            # **組み込みの入力欄か**(§9.216 ②)。空なら自由項目（画面が作る）。
            'builtin': builtin,
            'place': normalize_place(r[15]),
            'span': normalize_span(r[16]),
            'fold': bool(r[17]) if r[17] is not None else False,
            # 畳んだ群を自動で開く測定項目。空＝いつも畳んだまま。
            'showWhen': [x for x in str(r[18] or '').replace('、', ',').split(',') if x.strip()],
            # 選ばせ方(§9.218 ②)。選択肢を持たない型では効かないので、
            # **画面へ「効かない」と伝えるためにここで潰す**——設定は残す
            # （型を「選択」へ戻したときに選び直させない）。
            'widget': normalize_widget(r[19]),
            'widgetLive': (normalize_widget(r[19])
                           if normalize_item_type(r[5]) in CHOICE_TYPES or builtin
                           else WIDGET_SELECT)}


_ITEM_SELECT = ('SELECT [項目ID],[設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],'
                '[選択肢名],[単位],[必須],[備考],[有効],'
                '[組み込みキー],[置き場],[列幅],[群折りたたみ],[表示条件],[入力方法] '
                'FROM [操業データ項目マスタ] ORDER BY [表示順],[項目ID]')


def item_rows(c, include_disabled=False):
    ensure_item_table(c)
    cur = c.cursor()
    cur.execute(_ITEM_SELECT)
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
                required=False, note='', enabled=True, item_id=None,
                place=None, span=None, fold=None, show_when=None, builtin=None,
                widget=None):
    ensure_item_table(c)
    name = str(name or '').strip()
    if not name:
        raise ValueError('項目名を入力してください。')
    equipment = str(equipment or '').strip() or '*'
    kind = normalize_item_type(kind)
    cur = c.cursor()
    # **組み込みの行は付け替えられない**（§9.216 ②）。組み込みキーは画面が
    # 持っている入力欄そのものを指すので、後から書き換えると「どの欄の設定
    # なのか」が決まらなくなる。既存行のキーはそのまま残す。
    cur_builtin = ''
    if item_id is not None:
        cur.execute('SELECT [組み込みキー] FROM [操業データ項目マスタ] WHERE [項目ID]=?',
                    [int(item_id)])
        hit = cur.fetchone()
        cur_builtin = str((hit or [''])[0] or '').strip()
    if builtin is None:
        builtin = cur_builtin
    builtin = str(builtin or '').strip()
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
            -1 if required else 0, str(note or ''), -1 if enabled else 0,
            builtin, normalize_place(place), normalize_span(span),
            -1 if fold else 0,
            ','.join(x.strip() for x in (show_when or []) if str(x).strip())
            if isinstance(show_when, (list, tuple)) else str(show_when or ''),
            normalize_widget(widget)]
    if item_id is not None:
        cur.execute('UPDATE [操業データ項目マスタ] SET [設備名]=?,[群]=?,[項目名]=?,[表示順]=?,'
                    '[型]=?,[小数桁]=?,[最小値]=?,[最大値]=?,[選択肢名]=?,[単位]=?,[必須]=?,'
                    '[備考]=?,[有効]=?,[組み込みキー]=?,[置き場]=?,[列幅]=?,[群折りたたみ]=?,'
                    '[表示条件]=?,[入力方法]=?,[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
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
                    '[組み込みキー]=?,[置き場]=?,[列幅]=?,[群折りたたみ]=?,[表示条件]=?,'
                    '[入力方法]=?,[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
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
                '[単位],[必須],[備考],[有効],[組み込みキー],[置き場],[列幅],[群折りたたみ],'
                '[表示条件],[入力方法],[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
                args + [uid, uid])
    c.commit()
    return int(cur.lastrowid)


def item_layout_save(c, uid, rows):
    """並び・群・列幅・置き場・必須・出す/出さないを**まとめて1回で**書く
    (§9.216 ②)。D&Dで並べ替える画面なので1行ずつのPOSTでは往復が増え、
    途中で切れると**並びが半分だけ変わった状態**が残る。

    渡された順がそのまま`[表示順]`になる（10刻み。あとから1つ挟める）。
    **渡された行だけを書く**——一覧に出していない設備の行を巻き添えに
    しない（§9.212 ②と同じ約束）。"""
    ensure_item_table(c)
    cur = c.cursor()
    n = 0
    for i, r in enumerate(rows or []):
        try:
            item_id = int(r.get('id'))
        except (TypeError, ValueError):
            continue
        when = r.get('showWhen')
        if isinstance(when, (list, tuple)):
            when = ','.join(str(x).strip() for x in when if str(x).strip())
        cur.execute('UPDATE [操業データ項目マスタ] SET [群]=?,[表示順]=?,[列幅]=?,[置き場]=?,'
                    '[必須]=?,[有効]=?,[群折りたたみ]=?,[表示条件]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
                    [str(r.get('group') or '').strip(), (i + 1) * 10,
                     normalize_span(r.get('span')), normalize_place(r.get('place')),
                     -1 if r.get('required') else 0,
                     0 if r.get('enabled') is False else -1,
                     -1 if r.get('fold') else 0,
                     str(when or ''), uid, item_id])
        n += cur.rowcount
    c.commit()
    return n


def group_flags_save(c, uid, place, group, fold, show_when):
    """群のふるまい（畳む・開く条件）だけを、その群の全部の行へ書く
    (§9.216 ④)。

    **`item_layout_save`で代用しないこと。** あちらは行の中身をまるごと
    書くので、直前に1件だけ更新した内容（列幅など）を**古い写しで
    上書きしてしまう**（実際にそれで「列幅を変えても戻る」が起きた）。
    ここで触るのは2列だけ。"""
    ensure_item_table(c)
    if isinstance(show_when, (list, tuple)):
        show_when = ','.join(str(x).strip() for x in show_when if str(x).strip())
    cur = c.cursor()
    cur.execute(f'UPDATE [{ITEM_TABLE}] SET [群折りたたみ]=?,[表示条件]=?,'
                '[更新者ID]=?,[更新日時]=Now() '
                'WHERE COALESCE([群],\'\')=? AND COALESCE(NULLIF([置き場],\'\'),?)=?',
                [-1 if fold else 0, str(show_when or ''), uid,
                 str(group or ''), PLACE_PREP, normalize_place(place)])
    c.commit()
    return cur.rowcount


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
    notes = choice_notes(c)
    out = []
    for it in items:
        row = dict(it)
        row['choices'] = list(cmap.get(it['choice'], [])) if it['choice'] else []
        # 説明つきで選ばせるのに要る（§9.218 ②）。**説明のある値だけ**入れる。
        row['choiceNotes'] = dict(notes.get(it['choice'], {})) if it['choice'] else {}
        row['choiceMissing'] = bool(it['choice']) and it['choice'] not in cmap
        out.append(row)
    # **出さない組み込みの欄は名指しで返す**(§9.216 ②)。画面はマスタに載って
    # いる欄しか差配しないので、「無効にした」「この設備では使わない」を
    # 伝えないと**入力欄だけが今までどおり出たまま**になる（マスタで外した
    # つもりの欄が消えない、という分かりにくい壊れ方）。
    known = {x['builtin'] for x in item_rows(c, True) if x['builtin']}
    live = {x['builtin'] for x in items if x['builtin']}
    return {'items': out, 'builtinOff': sorted(known - live),
            'gridCols': GRID_COLS, 'spanUnit': SPAN_UNIT,
            'widgets': list(WIDGETS), 'places': list(PLACES)}
