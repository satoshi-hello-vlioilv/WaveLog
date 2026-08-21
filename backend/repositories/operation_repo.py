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
# §9.219 ③（利用者の指示「UIの種類を増やしたり」）で**数値と自由記述にも**
# 入力方法を持たせた。選択肢を持たない項目に「ラジオ」は効かないが、
# 「ステッパー」「キーパッド」は効く——効く型が違うだけで、考え方は同じ
# （値を持つのは今までどおり`<select>`／`<input>`で、その上に器を被せる）。
#   ステッパー … −／＋の2つのボタンで増減する。1〜9程度の整数向き
#   スライダー … 目盛を引いて決める。上下限のある数値向き
#   キーパッド … 押すと浮き窓のテンキー。キーボードの無い端末向き
#   メモ       … 複数行で書ける。自由記述向き
#
# §9.220 ①（利用者の指示「ラジオボタンやタブがほぼ同じデザインになっている。
# ラジオボタンは丸ぽちみたいなのを想像してました…セグメンテッドコントロールや
# ボタングループなど、もう少しスタイリッシュモダンなデザインで」）で
# **形の違うものを別の名前にした**。以前は`ラジオ`と`タブ`が同じ角ばった
# ボタンで、違いは「連なっているか」だけ——名前が2つあるのに見た目が
# ほぼ同じでは、選ぶ意味が無い（選ばせる手間だけが残る）。
#   ラジオ     … 丸ぽち＋文字。**縦に読む**もの。3〜5個向き
#   セグメント … 1本の帯を仕切った形（つまみが動く）。2〜4個の排他向き
#   タブ       … 下線で示す見出し。段を切り替える感覚のもの
#   ボタン群   … 独立した丸みのある札。数が多くても折り返して読める
WIDGETS = (WIDGET_SELECT, 'ラジオ', 'セグメント', 'タブ', 'ボタン群', '一覧',
           'ステッパー', 'スライダー', 'キーパッド', 'メモ')
# 選択肢を持つ型。判定はここ1箇所。
CHOICE_TYPES = ('選択',)
NUMBER_TYPES = ('整数', '正の整数', '数値', '正の数')
# 型ごとに選べる入力方法。**その型に効かないものは画面へ出さない**（§4
# 「できないことは、できないと書く」——押せるのに何も起きない設定を作らない）。
# `プルダウン`はどの型でも「標準の欄」の意味で使う。**保存値の既定を型ごとに
# 変えないこと**——型を切り替えた瞬間に「知らない値」になって設定が消える。
WIDGET_FAMILIES = {
    'choice': (WIDGET_SELECT, 'ラジオ', 'セグメント', 'タブ', 'ボタン群', '一覧'),
    'number': (WIDGET_SELECT, 'ステッパー', 'スライダー', 'キーパッド'),
    'text': (WIDGET_SELECT, 'メモ'),
}
# 組み込みの欄が選択肢を持つのか数値なのかは、**画面(index.html)が持っている
# 入力欄の実体**で決まる。マスタの`[型]`は組み込み行では空なので、ここが答える。
# 挙げていないキーは`<select>`＝choice。
BUILTIN_FAMILIES = {'verticalCount': 'number', 'horizontalCount': 'number'}


def widget_family(kind, builtin=''):
    """その項目がどの入力方法の仲間か。**判定はここ1箇所**（画面にも同じ
    判定を書かない——2つの答えが出る）。"""
    if str(builtin or '').strip():
        return BUILTIN_FAMILIES.get(str(builtin).strip(), 'choice')
    if kind in CHOICE_TYPES:
        return 'choice'
    if kind in NUMBER_TYPES:
        return 'number'
    return 'text'


def normalize_widget(v):
    s = str(v or '').strip()
    return s if s in WIDGETS else WIDGET_SELECT


def normalize_step(v):
    """ステッパー・スライダーの1回ぶん(§9.220 ⑤)。**0と負は「未設定」**へ
    倒す——0にすると押しても動かない道具になり、負だと＋で減る。未設定は
    `None`で返し、読む側（`measure-opdata.js`の`stepOf`）が小数桁から作る
    今までの動きへ落ちる。"""
    if v is None or v == '':
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


# ---------------------------------------------------------------------------
# 見せ方(§9.221 ⑦、利用者の指示「単位を出す位置(外上左、外上中央、外上右、
# 内部、外下左、外中央、外下右)、出し方、データの表示方法、桁数、左詰め、
# 右詰め、中央寄せなど、さらにカスタマイズできるように」)
# ---------------------------------------------------------------------------
# 単位をどこへ出すか。**既定は`外下左`**——これが今までの見え方そのもの
# （欄の下に左詰めで小さく出ていた）。既定を変えると、設定を触っていない
# 現場の画面が黙って変わる（§9.194の結合方法と同じ約束）。
#
# `内部`は**欄の中の右端**に重ねる。重ねられるのは1つの箱を持つ欄
# （プルダウン・数値・文字）だけで、ラジオ・セグメント・タブ・ボタン群には
# 重ねる箱が無い——そのときは`外下左`へ落とし、**そのことを設定画面に書く**
# （§4。押せるのに効かない設定を残さない）。
UNIT_PLACE_HIDE = '出さない'
UNIT_PLACE_IN = '内部'
UNIT_PLACE_DEFAULT = '外下左'
UNIT_PLACES = ('外上左', '外上中央', '外上右', UNIT_PLACE_IN,
               '外下左', '外下中央', '外下右', UNIT_PLACE_HIDE)
# 単位を重ねられない入力方法（箱が1つではない）。
UNIT_IN_BLOCKED_WIDGETS = ('ラジオ', 'セグメント', 'タブ', 'ボタン群', '一覧',
                           'ステッパー', 'スライダー', 'キーパッド', 'メモ')


def normalize_unit_place(v):
    s = str(v or '').strip()
    return s if s in UNIT_PLACES else UNIT_PLACE_DEFAULT


# 値の寄せ。**既定は`自動`**＝今までどおりブラウザ任せ（左）。
ALIGNS = ('自動', '左', '中央', '右')


def normalize_align(v):
    s = str(v or '').strip()
    return s if s in ALIGNS else '自動'


# 値の見せ方。**打っている最中は当てない**（画面側の約束）——3桁区切りを
# 1文字ごとに入れると、カーソルが桁区切りの前後で飛ぶ。欄を離れたときと、
# 記録から読み直したときにだけ整える。
#   そのまま   … 打ったまま（既定）
#   3桁区切り … 1,234
#   ゼロ埋め   … [表示桁数]まで左を0で埋める（0012）
VALUE_FORMAT_PLAIN = 'そのまま'
VALUE_FORMATS = (VALUE_FORMAT_PLAIN, '3桁区切り', 'ゼロ埋め')


def normalize_value_format(v):
    s = str(v or '').strip()
    return s if s in VALUE_FORMATS else VALUE_FORMAT_PLAIN


def normalize_digits(v):
    """ゼロ埋めの桁数。1〜12。**0と空は未設定**（埋めない）。"""
    if v is None or v == '':
        return None
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if 1 <= n <= 12 else None


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
    # §9.221 ③で移してきた2つ。**まっさらな端末でも選べる値が要る**
    # ——移行元（バリ揃えマスタ／コイル止めマスタ）が無い新規導入では
    # 写すものが無いので、ここが唯一の種になる。オペレータ・機器・内径・
    # スプールは現場ごとの名前なので種を持たない（空で始まる）。
    ('バリ揃え', ('上バリ揃え', '下バリ揃え', '指定なし')),
    ('コイル止め', ('内巻両面テープ', '指定なし')),
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
    # --- §9.221 ③（利用者の指示「オペレータ、機器、スプール種別、内径種別、
    #     バリ揃え、コイル止めについても汎用化した操業データ項目マスタに
    #     移行させてください」）---
    # 移してくる6つのマスタのうち、**オペレータだけが名前以外の情報を持って
    # いた**（ヨミガナ・作業可能設備）。選択肢そのものへ持たせれば、
    # 「よみで探せる」「その設備のときだけ出す」はどのまとまりでも使える
    # ——汎用化とは、特定のマスタの仕掛けを全部へ広げることでもある。
    ('よみ', 'TEXT'),
    # 書式は設備停止マスタと同じ（`'A'` / `'A,B,C'` / 空＝すべて）。
    # 判定は`schedule_repo.stop_equipment_*`を借りる（新しく書き起こさない）。
    ('対象設備', 'TEXT'),
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
                    '[よみ] TEXT, [対象設備] TEXT, '
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
    """**読み取り専用の接続からも呼べること**(§9.221 ③)。測定画面の
    選択肢はここから引くが、あちらは`connect(path,True)`で開いている
    ——`ensure`が通らないからといって読めないのでは、選択肢が丸ごと消える。
    表が無ければ空、列が足りなければ在る列だけで読む。"""
    try:
        ensure_choice_table(c)
    except Exception:
        pass
    if CHOICE_TABLE not in tables(c):
        return []
    cur = c.cursor()
    try:
        cur.execute('SELECT [選択肢ID],[選択肢名],[値],[表示順],[有効],[説明],[よみ],[対象設備] '
                    'FROM [操業データ選択肢マスタ] ORDER BY [選択肢名],[表示順],[選択肢ID]')
        raw = cur.fetchall()
    except Exception:
        cur.execute('SELECT [選択肢ID],[選択肢名],[値],[表示順],[有効],[説明] '
                    'FROM [操業データ選択肢マスタ] ORDER BY [選択肢名],[表示順],[選択肢ID]')
        raw = [tuple(r) + ('', '') for r in cur.fetchall()]
    out = []
    for r in raw:
        on = True if r[4] is None else bool(r[4])
        if not on and not include_disabled:
            continue
        out.append({'id': r[0], 'name': str(r[1] or '').strip(),
                    'value': str(r[2] or ''), 'order': r[3], 'enabled': on,
                    'note': str(r[5] or ''),
                    'reading': str(r[6] or ''), 'equipment': str(r[7] or '')})
    return out


def ensure_operation_choices(path):
    """書ける接続で**表と列をそろえ、6つのマスタを1度だけ写す**(§9.221 ③)。
    測定画面は読み取り専用で開くので、その前にここを1回通す
    （スプール種別マスタ等の`ensure_*`と同じ置き方）。"""
    from ..db_access import connect
    with connect(path, False) as c:
        created = ensure_choice_table(c)
        moved = migrate_legacy_choice_masters(c)
    return {'created': created, 'migrated': moved}


def choice_notes(c, equipment=None):
    """{選択肢名: {値: 説明}}。**説明のあるものだけ**——空を並べると、画面が
    「説明が無い」のか「まだ読めていない」のか区別できない。
    設備を渡したときの絞り方は`choice_map`と同じ（出ない値の説明を
    渡しても使いようがない）。"""
    out = {}
    for r in choice_rows(c):
        if not (r['name'] and r['note']):
            continue
        if equipment and not choice_matches_equipment(r['equipment'], equipment):
            continue
        out.setdefault(r['name'], {})[r['value']] = r['note']
    return out


def choice_map(c, equipment=None):
    """{選択肢名: [値,...]}。**表示順で並べる**（選ぶ順番は現場が決める）。

    **設備を渡したら`[対象設備]`で絞る**（§9.221 ③の追補）。絞らないと、
    組み込みの欄（`choice_values`を通る）では出ないオペレータが、同じ
    まとまりを参照する自由項目の欄には出る——同じ「オペレータ」という
    選択肢が欄によって違う中身になる。判定は`choice_matches_equipment`の
    1箇所を通す（空欄＝すべての設備）。"""
    out = {}
    for r in choice_rows(c):
        if not r['name']:
            continue
        if equipment and not choice_matches_equipment(r['equipment'], equipment):
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
    決めてあるぶん、気づきにくい）。読むだけなので失敗させない。

    **読めなかったときは None**（§9.117と同じ約束）——`{}`で返すと
    「どの項目も使っていない」と区別が付かず、`choice_delete_group`が
    使用中のまとまりを丸ごと消してしまう。"""
    out = {}
    try:
        for it in item_rows(c, True):
            if it['choice']:
                out.setdefault(it['choice'], []).append(it['name'])
    except Exception:
        return None
    return out


def choice_hints(c):
    """選択肢のまとまり名を勧めるための**事実**(§9.220 ④、利用者の指示
    「選択肢のまとまり名については他の入力を見て、同じものを設定することも
    多いです。入力の手間を省けるようにサジェスト機能を」)。

    {選択肢名: {'items': [使っている項目名], 'groups': [その群], 'count': n}}

    **並べる規則そのものは画面が持つ**——勧める順は「いま編集している項目の
    名前・群」との近さで決まり、その2つは**まだ保存されていない画面の状態**
    なので、サーバーからは見えない（1文字打つたびに問い合わせるのは論外）。
    ここが答えるのは「誰がどの群でどれを使っているか」という事実だけで、
    事実の出どころは1箇所のまま。"""
    out = {}
    try:
        for it in item_rows(c, True):
            nm = it['choice']
            if not nm:
                continue
            slot = out.setdefault(nm, {'items': [], 'groups': [], 'count': 0})
            slot['items'].append(it['name'])
            g = it['group']
            if g and g not in slot['groups']:
                slot['groups'].append(g)
            slot['count'] += 1
    except Exception:
        return {}
    return out


def _norm_equipment(v):
    """対象設備の保存形。**書式は設備停止マスタと同じ**（`schedule_repo`の
    1箇所が答える）——ここで書き起こすと、同じ`'A,B'`の読み方が2通りになる。
    空＝すべての設備（`'*'`と同じ扱い。行を作るたびに`*`を打たせない）。"""
    from . import schedule_repo as sr
    return sr.stop_equipment_text(v)


def choice_matches_equipment(stored, equipment):
    """その選択肢がこの設備で出るか。**空欄は「すべての設備」**。"""
    from . import schedule_repo as sr
    if not str(stored or '').strip():
        return True
    return sr.stop_equipment_matches(stored, equipment)


def builtin_choice_name(c, key):
    """組み込みの欄がどのまとまりから選ぶか(§9.221 ③)。**マスタの
    `[選択肢名]`が答える**——移行で既定を張ってあるが、現場が別のまとまりへ
    向け替えられる（それが「汎用化」の意味）。行が無い・空のときだけ既定へ
    落ちる。**測定画面はここを通す**——名前をコードへ書くと、画面から
    向け替えても効かない設定になる。"""
    fallback = dict((k, g) for g, k in LEGACY_CHOICE_GROUPS).get(str(key or ''), '')
    try:
        for it in item_rows(c, True):
            if it['builtin'] == key:
                return it['choice'] or fallback
    except Exception:
        pass
    return fallback


def choice_values(c, name, equipment=None):
    """まとまり名から**選べる値の並び**を返す(§9.221 ③)。有効な行だけを
    表示順で、`[対象設備]`が合うものに絞る。

    **オペレータの「割当が1件も無ければ制限なし」をそのまま引き継ぐ**
    ——空欄＝すべての設備、なので、移行しても現場の見え方は変わらない。

    ここが**唯一の読み口**。オペレータ・機器・スプール・内径・バリ揃え・
    コイル止めの6つは以前それぞれ専用の関数を持っていたが、同じことを
    6箇所に書いていたので、まとまり名が変わるだけの1本にまとめた。"""
    out = []
    seen = set()
    for r in choice_rows(c):
        if r['name'] != name or not r['value']:
            continue
        if equipment and not choice_matches_equipment(r['equipment'], equipment):
            continue
        key = r['value'].casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(r['value'])
    return out


# ---------------------------------------------------------------------------
# 6つのマスタの移行(§9.221 ③、利用者の指示)
# ---------------------------------------------------------------------------
# 「オペレータ、機器、スプール種別、内径種別、バリ揃え、コイル止めについても
#  汎用化した操業データ項目マスタに移行させてください」
#
# **1度だけ写す。** 元の表は消さない——現場のデータなので、写しそこねが
# あったときに戻せるようにしておく（§9.180の「共有DBは作り直さない」と
# 同じ考え方）。以後読むのは選択肢マスタだけで、元の表はもう見ない。
#
# (まとまり名, 組み込みキー)。組み込みキーは`BUILTIN_SEEDS`の欄で、
# 移行と同時に`[選択肢名]`を張っておく——張らないと、写した値がどの欄の
# 選択肢なのか誰も知らないまま残る。
LEGACY_CHOICE_GROUPS = (
    ('オペレータ', 'operator'),
    ('板厚測定器', 'thicknessGauge'),
    ('板幅測定器', 'widthGauge'),
    ('内径', 'innerDiameter'),
    ('スプール', 'spool'),
    ('バリ揃え', 'burr'),
    ('コイル止め', 'coilStop'),
)
# 検査員はオペレータと同じ名簿を見る（設備の絞り込みだけしない）。
CHOICE_GROUP_OPERATOR = 'オペレータ'
_LEGACY_MIGRATED_KEY = '__op_choice_legacy_migrated__'


def _legacy_source_rows(c):
    """元の6マスタから (まとまり名, 値, よみ, 対象設備, 表示順) を集める。
    戻りは (行, 読めなかった元表の名前) ——**読めなかった表は飛ばす**が、
    飛ばしたことは呼び出し元へ伝える（1つ無いだけで移行そのものが止まると
    残りの5つが永久に移らない。かといって黙って飛ばすと、その分は
    「移行済み」の目印の裏で永久に取り残される）。"""
    from . import master_repo as mr
    rows = []
    failed = []

    def add(group, values, reading=None, equipment=None):
        for i, v in enumerate(values):
            name = str(v or '').strip()
            if name:
                rows.append((group, name, (reading or {}).get(name, ''),
                             (equipment or {}).get(name, ''), (i + 1) * 10))

    try:
        cur = c.cursor()
        cur.execute('SELECT [オペレータID],[氏名],[ﾖﾐｶﾞﾅ],[表示順],[有効] '
                    'FROM [オペレータマスタ] ORDER BY [表示順],[氏名]')
        eqmap = mr.operator_equipment_map(c)
        names, reading, equip = [], {}, {}
        for r in cur.fetchall():
            if r[4] is not None and not bool(r[4]):
                continue
            nm = str(r[1] or '').strip()
            if not nm:
                continue
            names.append(nm)
            reading[nm] = str(r[2] or '')
            equip[nm] = _norm_equipment(eqmap.get(r[0]) or [])
        add(CHOICE_GROUP_OPERATOR, names, reading, equip)
    except Exception:
        failed.append(CHOICE_GROUP_OPERATOR)
    for group, kind in (('板厚測定器', '板厚'), ('板幅測定器', '板幅')):
        try:
            add(group, mr.read_device_names(c, kind))
        except Exception:
            failed.append(group)
    for group, fn in (('内径', 'read_inner_names'), ('スプール', 'read_spool_names'),
                      ('バリ揃え', 'read_burr_names'), ('コイル止め', 'read_coil_stop_names')):
        try:
            add(group, getattr(mr, fn)(c))
        except Exception:
            failed.append(group)
    return rows, failed


def migrate_legacy_choice_masters(c):
    """1度だけ、6つのマスタを選択肢マスタへ写す。**目印はパス設定マスタ**
    （データソースの種まきと同じ作法）——「行が無ければ写す」にすると、
    利用者が全部消した瞬間に復活する消せないマスタになる。"""
    from ..db_access import path_config_rows, set_path_config
    ensure_choice_table(c)
    if path_config_rows(c).get(_LEGACY_MIGRATED_KEY):
        return False
    rows, failed = _legacy_source_rows(c)
    for group, value, reading, equipment, order in rows:
        try:
            choice_upsert(c, group, value, 'migrate:legacy', order=order,
                          reading=reading, equipment=equipment)
        except ValueError:
            continue
    # 組み込みの欄へ**まとまり名を張る**。触っていない欄だけ（既に選ばれて
    # いれば現場の設定が勝つ）。
    ensure_item_table(c)
    cur = c.cursor()
    for group, key in LEGACY_CHOICE_GROUPS:
        cur.execute(f"UPDATE [{ITEM_TABLE}] SET [選択肢名]=? "
                    "WHERE [組み込みキー]=? AND ([選択肢名] IS NULL OR [選択肢名]='')",
                    [group, key])
    c.commit()
    # **1つでも読めなかったら目印を立てない。** 立ててしまうと、読めなかった
    # まとまり（列名のゆれ・古い版に無い列・共有越しの一時的な失敗——まさに
    # 上の except が吸収している事象）が0件のまま「移行済み」になり、次に
    # 開いたときには二度と写されない。写せたぶんは既に入っているので、
    # 次回はそこから続き（choice_upsert は同じ値を二重に作らない）。
    if failed:
        return False
    set_path_config(c, _LEGACY_MIGRATED_KEY, 'done', 'migrate:legacy')
    return True


def choice_upsert(c, name, value, uid, order=None, choice_id=None, enabled=True, note=None,
                  reading=None, equipment=None):
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
        # **送っていない項目は今の値を残す**（§9.212 ②）。1つ書き漏らすと
        # その設定だけが保存のたびに消える。
        cur.execute('SELECT [説明],[よみ],[対象設備] FROM [操業データ選択肢マスタ] '
                    'WHERE [選択肢ID]=?', [int(choice_id)])
        hit = cur.fetchone() or ['', '', '']
        if note is None:
            note = hit[0] or ''
        if reading is None:
            reading = hit[1] or ''
        if equipment is None:
            equipment = hit[2] or ''
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [選択肢名]=?,[値]=?,[説明]=?,[表示順]=?,'
                    '[有効]=?,[よみ]=?,[対象設備]=?,[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [選択肢ID]=?',
                    [name, value, str(note or ''), order, -1 if enabled else 0,
                     str(reading or ''), _norm_equipment(equipment), uid, int(choice_id)])
        c.commit()
        return int(choice_id)
    # 自然キーは(選択肢名,値)。同じ値を2つ並べない——どちらを選んでも同じ。
    cur.execute('SELECT [選択肢ID],[表示順],[説明],[よみ],[対象設備] FROM [操業データ選択肢マスタ] '
                'WHERE [選択肢名]=? AND [値]=?', [name, value])
    hit = cur.fetchone()
    if hit:
        cur.execute('UPDATE [操業データ選択肢マスタ] SET [表示順]=?,[説明]=?,[有効]=?,'
                    '[よみ]=?,[対象設備]=?,[更新者ID]=?,[更新日時]=Now() WHERE [選択肢ID]=?',
                    [hit[1] if order is None else order,
                     str((hit[2] if note is None else note) or ''),
                     -1 if enabled else 0,
                     str((hit[3] if reading is None else reading) or ''),
                     _norm_equipment(hit[4] if equipment is None else equipment),
                     uid, hit[0]])
        c.commit()
        return int(hit[0])
    if order is None:
        cur.execute('SELECT MAX([表示順]) FROM [操業データ選択肢マスタ] WHERE [選択肢名]=?', [name])
        top = cur.fetchone()[0] or 0
        order = int(top) + 10
    cur.execute('INSERT INTO [操業データ選択肢マスタ] '
                '([選択肢名],[値],[説明],[表示順],[有効],[よみ],[対象設備],'
                '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,Now(),Now())',
                [name, value, str(note or ''), order, -1 if enabled else 0,
                 str(reading or ''), _norm_equipment(equipment), uid, uid])
    c.commit()
    return int(cur.lastrowid)


def choice_rename_group(c, src, dst, uid):
    """まとまりの名前を変える(§9.221 ②)。**参照している項目の`[選択肢名]`も
    一緒に書き換える**——結び付けは名前なので(§9.215)、片方だけ変えると
    その項目の選択肢が黙って消える。

    移動先に同じ値が既にあるときは**その行を残して古いほうを消す**
    （同じ値が2つ並ぶと、どちらを選んでも同じで選ぶ意味が無い）。"""
    ensure_choice_table(c)
    src = str(src or '').strip()
    dst = str(dst or '').strip()
    if not src or not dst:
        raise ValueError('まとまり名を入力してください。')
    cur = c.cursor()
    cur.execute(f'SELECT [値] FROM [{CHOICE_TABLE}] WHERE [選択肢名]=?', [dst])
    taken = {str(r[0] or '').strip().casefold() for r in cur.fetchall()}
    cur.execute(f'SELECT [選択肢ID],[値] FROM [{CHOICE_TABLE}] WHERE [選択肢名]=?', [src])
    moved = 0
    for cid, val in cur.fetchall():
        if str(val or '').strip().casefold() in taken:
            cur.execute(f'DELETE FROM [{CHOICE_TABLE}] WHERE [選択肢ID]=?', [cid])
            continue
        cur.execute(f'UPDATE [{CHOICE_TABLE}] SET [選択肢名]=?,[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [選択肢ID]=?', [dst, uid, cid])
        moved += 1
    ensure_item_table(c)
    cur.execute(f'UPDATE [{ITEM_TABLE}] SET [選択肢名]=?,[更新者ID]=?,[更新日時]=Now() '
                'WHERE [選択肢名]=?', [dst, uid, src])
    c.commit()
    return moved


def choice_delete_group(c, name, uid):
    """まとまりごと消す。**使っている項目があれば断る**（§9.216 ④の裏返し
    ——消すとその項目は黙って空の欄になる）。"""
    ensure_choice_table(c)
    name = str(name or '').strip()
    if not name:
        raise ValueError('まとまり名がありません。')
    # **読めなかったら消さない**（§9.117）。`choice_usage`が None を返すのは
    # 「使っている項目を数えられなかった」であって「誰も使っていない」では
    # ない。取り違えると、使用中のまとまりを丸ごと物理削除して、参照して
    # いた項目が黙って空の欄になる。
    usage = choice_usage(c)
    if usage is None:
        raise ValueError('「%s」を使っている項目を確かめられませんでした。'
                         '消すと使っている項目の選択肢が黙って空になるため、'
                         '中止します。マスタ管理を開き直してからもう一度お試し'
                         'ください。' % name)
    used = usage.get(name) or []
    if used:
        raise ValueError('「%s」は %d 件の項目が使っています（%s）。先に項目側の'
                         '選択肢を差し替えてください。' % (name, len(used), '、'.join(used[:4])))
    cur = c.cursor()
    cur.execute(f'DELETE FROM [{CHOICE_TABLE}] WHERE [選択肢名]=?', [name])
    c.commit()
    return cur.rowcount


def choice_reorder(c, ids, uid):
    """1つのまとまりの中の並びをまとめて書く。**渡された行だけ**を触る
    （§9.212 ②と同じ約束）。"""
    ensure_choice_table(c)
    cur = c.cursor()
    n = 0
    for i, cid in enumerate(ids):
        try:
            key = int(cid)
        except (TypeError, ValueError):
            continue
        cur.execute(f'UPDATE [{CHOICE_TABLE}] SET [表示順]=?,[更新者ID]=?,[更新日時]=Now() '
                    'WHERE [選択肢ID]=?', [(i + 1) * 10, uid, key])
        n += cur.rowcount
    c.commit()
    return n


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
    # --- §9.220（利用者の指示）---
    ('初期値', 'TEXT'),            # ②「入力の方法によらず、初期値登録機能」
    ('手打ち可', 'INTEGER'),       # ③「候補選択のパターンでも手打ち入力が可能なモード」
    ('ステップ量', 'REAL'),        # ⑤「ステップ入力に関して、ステップ量も決められるように」
    # --- §9.221 ⑦（利用者の指示「単位を出す位置…データの表示方法、桁数、
    #     左詰め、右詰め、中央寄せなど、さらにカスタマイズできるように」）---
    ('単位位置', 'TEXT'),          # 外上左/外上中央/外上右/内部/外下左/外下中央/外下右/出さない
    ('文字寄せ', 'TEXT'),          # 自動/左/中央/右
    ('表示書式', 'TEXT'),          # そのまま/3桁区切り/ゼロ埋め
    ('表示桁数', 'INTEGER'),       # ゼロ埋めの桁数
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
                    '[初期値] TEXT, [手打ち可] INTEGER, [ステップ量] REAL, '
                    '[単位位置] TEXT, [文字寄せ] TEXT, [表示書式] TEXT, [表示桁数] INTEGER, '
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
            # 選ばせ方(§9.218 ②／§9.219 ③)。**型ごとに効く物が違う**ので、
            # 効かない設定は`widgetLive`で標準の欄へ潰す——保存値(`widget`)は
            # 残す（型を戻したときに選び直させない）。仲間分けは
            # `widget_family()`の1箇所が答える。
            'widget': normalize_widget(r[19]),
            'widgetFamily': widget_family(normalize_item_type(r[5]), builtin),
            'widgetLive': (normalize_widget(r[19])
                           if normalize_widget(r[19]) in WIDGET_FAMILIES[
                               widget_family(normalize_item_type(r[5]), builtin)]
                           else WIDGET_SELECT),
            # --- §9.220 ---
            # ② 初期値。**組み込みの欄は持たない**（内径の仕掛由来プリセット
            #    §9.204・条数の上限§9.210 ⑤といった、その欄ごとの仕掛けと
            #    どちらが勝つのか決められない。型・上下限を持たないのと同じ理由）。
            'initial': '' if builtin else str(r[20] or ''),
            # ③ 候補にない値も手で打てるか。**選択肢を持つ型だけ**に効く
            #    ——自由記述はもともと手で打つので、印を出しても意味が無い（§4）。
            'freeText': (bool(r[21]) if r[21] is not None else False)
                        and widget_family(normalize_item_type(r[5]), builtin) == 'choice',
            # ⑤ ステッパー・スライダーの1回ぶん。**未設定(None)は小数桁から作る**
            #    （今までの挙動）——0を「設定した」と読むと増減できなくなる。
            'step': (float(r[22]) if r[22] is not None and float(r[22]) > 0 else None),
            # --- §9.221 ⑦ ---
            # 単位の置き場。**重ねられない入力方法では外下左へ落とす**
            # （判定はここ1箇所。画面へ同じ判定を書かない）。
            'unitPlace': (UNIT_PLACE_DEFAULT
                          if (normalize_unit_place(r[23]) == UNIT_PLACE_IN
                              and normalize_widget(r[19]) in UNIT_IN_BLOCKED_WIDGETS)
                          else normalize_unit_place(r[23])),
            # 保存値そのもの（設定画面が「選んだが効いていない」を言うため）。
            'unitPlaceSaved': normalize_unit_place(r[23]),
            'align': normalize_align(r[24]),
            'valueFormat': normalize_value_format(r[25]),
            'digits': normalize_digits(r[26])}


_ITEM_SELECT = ('SELECT [項目ID],[設備名],[群],[項目名],[表示順],[型],[小数桁],[最小値],[最大値],'
                '[選択肢名],[単位],[必須],[備考],[有効],'
                '[組み込みキー],[置き場],[列幅],[群折りたたみ],[表示条件],[入力方法],'
                '[初期値],[手打ち可],[ステップ量],'
                '[単位位置],[文字寄せ],[表示書式],[表示桁数] '
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


def items_for_equipment(c, equipment, include_disabled=False):
    """その設備で使う項目だけ。判定は設備停止マスタと**同じ関数**を通す
    （`'*'`／カンマ区切り／名前の全角半角ゆれ。§CLAUDE）。

    **マスタ管理の盤は`include_disabled=True`で読む**（§9.219 ③）——
    「測定画面に出す」を外した項目まで落とすと、設備を選んだ状態では盤から
    消えて**戻せなくなる**（消したのではなく隠しただけなのに、隠す操作が
    取り消せない）。測定画面（`form_for_equipment`）は今までどおり落とす。"""
    from . import schedule_repo as sr
    eq = str(equipment or '').strip()
    out = []
    for item in item_rows(c, include_disabled):
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
                widget=None, initial=None, free_text=None, step=None,
                unit_place=None, align=None, value_format=None, digits=None):
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
            normalize_widget(widget),
            # §9.220 ②③⑤。初期値は**そのまま文字で持つ**——選択肢の値も
            # 数値も同じ1つの列に入るので、型ごとに解釈するのは読む側の仕事。
            str(initial or ''), -1 if free_text else 0, normalize_step(step),
            # §9.221 ⑦。見せ方は保存値をそのまま持つ（効くかどうかの判定は
            # 読む側の`_row_to_item`が1箇所で行う）。
            normalize_unit_place(unit_place), normalize_align(align),
            normalize_value_format(value_format), normalize_digits(digits)]
    if item_id is not None:
        cur.execute('UPDATE [操業データ項目マスタ] SET [設備名]=?,[群]=?,[項目名]=?,[表示順]=?,'
                    '[型]=?,[小数桁]=?,[最小値]=?,[最大値]=?,[選択肢名]=?,[単位]=?,[必須]=?,'
                    '[備考]=?,[有効]=?,[組み込みキー]=?,[置き場]=?,[列幅]=?,[群折りたたみ]=?,'
                    '[表示条件]=?,[入力方法]=?,[初期値]=?,[手打ち可]=?,[ステップ量]=?,'
                    '[単位位置]=?,[文字寄せ]=?,[表示書式]=?,[表示桁数]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
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
                    '[入力方法]=?,[初期値]=?,[手打ち可]=?,[ステップ量]=?,'
                    '[単位位置]=?,[文字寄せ]=?,[表示書式]=?,[表示桁数]=?,'
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
                '[単位],[必須],[備考],[有効],[組み込みキー],[置き場],[列幅],[群折りたたみ],'
                '[表示条件],[入力方法],[初期値],[手打ち可],[ステップ量],'
                '[単位位置],[文字寄せ],[表示書式],[表示桁数],'
                '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())',
                args + [uid, uid])
    c.commit()
    return int(cur.lastrowid)


def item_layout_save(c, uid, rows):
    """並び・群・列幅・置き場・必須・出す/出さないを**まとめて1回で**書く
    (§9.216 ②)。D&Dで並べ替える画面なので1行ずつのPOSTでは往復が増え、
    途中で切れると**並びが半分だけ変わった状態**が残る。

    **渡された行だけを書く**——一覧に出していない設備の行を巻き添えに
    しない（§9.212 ②と同じ約束）。

    **順番は「席の入れ替え」で書く**（§9.219 ③）。以前は渡された順に
    `(i+1)*10`を振っていたため、**一部の行だけを渡すと、その行が先頭へ
    集まって他の群のあいだへ割り込んだ**——同じ群が3つの帯に割れ、
    「その群へ項目を移動できない」という形で実機に出た。いま在る席
    （表示順）を集めて昇順に均し、**新しい並びでその席へ座らせる**ので、
    渡していない行との前後関係は1つも動かない。"""
    ensure_item_table(c)
    cur = c.cursor()
    todo = []
    for r in (rows or []):
        try:
            todo.append((int(r.get('id')), r))
        except (TypeError, ValueError):
            continue
    if not todo:
        return 0
    slots = []
    for item_id, _r in todo:
        cur.execute(f'SELECT [表示順] FROM [{ITEM_TABLE}] WHERE [項目ID]=?', [item_id])
        hit = cur.fetchone()
        slots.append(int(hit[0]) if hit and hit[0] is not None else 0)
    slots.sort()
    # 同じ席が2つあると順番が決まらないので、**厳密に増える形へ均す**。
    for i in range(1, len(slots)):
        if slots[i] <= slots[i - 1]:
            slots[i] = slots[i - 1] + 1
    n = 0
    for i, (item_id, r) in enumerate(todo):
        when = r.get('showWhen')
        if isinstance(when, (list, tuple)):
            when = ','.join(str(x).strip() for x in when if str(x).strip())
        cur.execute('UPDATE [操業データ項目マスタ] SET [群]=?,[表示順]=?,[列幅]=?,[置き場]=?,'
                    '[必須]=?,[有効]=?,[群折りたたみ]=?,[表示条件]=?,'
                    '[更新者ID]=?,[更新日時]=Now() WHERE [項目ID]=?',
                    [str(r.get('group') or '').strip(), slots[i],
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
    # **選択肢もこの設備のものだけ**（§9.221 ③の追補）。組み込みの欄は
    # `choice_values(c,name,equipment)`で絞られているので、ここで絞らないと
    # 同じまとまりが欄によって違う中身になる。
    cmap = choice_map(c, equipment)
    notes = choice_notes(c, equipment)
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
            'widgets': list(WIDGETS),
            'widgetFamilies': {k: list(v) for k, v in WIDGET_FAMILIES.items()},
            'places': list(PLACES)}
