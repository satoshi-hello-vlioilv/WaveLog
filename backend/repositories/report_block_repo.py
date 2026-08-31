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
import copy as _copy
import json

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


def _dc(label, path, **kw):
    """既定の中身を書き下ろすときの1マス（`default_cells`のための短縮）。"""
    return _cell(label=label, path=path, **kw)


def default_cells(builtin):
    """既定の塊の中身を「マスの並び」で書き下ろす（§9.285 ②、利用者の指示）。

    「汎用化できていない部分を汎用表現を追加し編集可能範囲に取り込む」

    `寸法（オーダー／製造）`などはコードが表を組み立てているので、
    `[内容]`を白紙のまま渡すと**いま見えている形が押した瞬間に消えたように
    見える**（§9.259の「個人にするときは共通を写してから切り替える」と同じ
    理由）。ここが**いま紙に出ている形と同じ並び**を答え、画面の
    「既定の中身を写す」がそれを入れる。

    **答えるのはここ1箇所**——画面へ書き写すと、既定の絵を直したときに
    2箇所直すことになる（§9.163）。知らないキーは空（写す口を出さない）。

    **書式もここで付ける**（§9.285 ③）——コードの表は`fmtDimSafe(x,3)`の
    ように桁を決めて描いているので、書式なしで写すと**写した瞬間に桁が
    変わる**（板厚が`0.3`になる）。写したあとは1マスずつ自由に変えられる。"""
    key = str(builtin or '').strip()
    num = lambda d: {'kind': 'number', 'decimals': d}
    if key == '寸法（オーダー／製造）':
        # (見出し, 道の尾, 書式)。**桁はコードの表と同じ**（`fmtDimSafe`）。
        cols = (('材質', 'Material', None), ('調質', 'Temper', None),
                ('板厚', 'Thickness', num(3)), ('板幅', 'Width', num(1)),
                ('板丈', 'Length', num(1)))
        cells = [_cell(kind=CELL_BLANK)]
        cells += [_cell(label=h, kind=CELL_HEAD) for h, _s, _f in cols]
        for lb, pre in (('オーダー', 'order'), ('製造', 'mfg')):
            cells.append(_cell(label=lb, kind=CELL_HEAD, align='left'))
            for head, suf, fmt in cols:
                # **ラベルは日本語で**——紙には出さない（見出しと二重になる）
                # が、盤の一覧にはこの名前が並ぶ（§2「いまの値を名乗る」）。
                cells.append(_dc('%s %s' % (lb, head), 'basic.%s%s' % (pre, suf),
                                 show_label=False,
                                 align='right' if fmt else '', fmt=fmt))
        return cells
    if key == '品質等級':
        return [_dc(lb, 'qualityGrades.' + lb) for lb in QUALITY_GRADE_LABELS]
    if key == '品質情報（仕掛）':
        return [_dc('品質情報', 'qualityInfo', span=1, show_label=False)]
    if key == '母材実績／カード指示':
        heads = ('元幅', '手計算', '全長', '前オフ', '後オフ')
        cells = [_cell(kind=CELL_BLANK)]
        cells += [_cell(label=h, kind=CELL_HEAD) for h in heads]
        cells.append(_cell(label='実績', kind=CELL_HEAD, align='left'))
        # 元幅は2段ぶん（実績とカード指示で同じ値・コードの`rowspan=2`と同じ）。
        cells.append(_dc('元幅（実績）', 'basic.originalWidth', rows=2,
                         show_label=False, align='right', fmt=num(1)))
        for lb, k in (('実績 手計算', 'manual'), ('実績 全長', 'fullLength'),
                      ('実績 前オフ', 'front'), ('実績 後オフ', 'rear')):
            cells.append(_dc(lb, 'mother.' + k, show_label=False, align='right'))
        cells.append(_cell(label='カード指示', kind=CELL_HEAD, align='left'))
        for lb, k in (('カード MIN', 'minCard'), ('カード MAX', 'maxCard'),
                      ('カード 前オフ', 'frontCard'), ('カード 後オフ', 'rearCard')):
            cells.append(_dc(lb, 'mother.' + k, show_label=False, align='right'))
        return cells
    return []


# 既定の中身を写せる塊と、そのときの列数。**列数もここが答える**
# ——写した並びが別の列数で組まれると、いま見えている形と違う絵になる。
DEFAULT_CELL_COLS = {'寸法（オーダー／製造）': 6, '品質等級': 4,
                     '品質情報（仕掛）': 1, '母材実績／カード指示': 6}


def default_cell_map():
    """写せる塊 → {'content': 保存形, 'cols': 列数}（§9.285 ②）。"""
    out = {}
    for key in DEFAULT_CELL_COLS:
        cells = default_cells(key)
        if cells:
            out[key] = {'content': dump_content(cells),
                        'cols': DEFAULT_CELL_COLS[key]}
    return out


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
    # **道は`aliases`（`base.js`）の綴りで書くこと**（§9.254 ④）。以前は
    # `basic.material`／`basic.thickness`／`basic.width`と書いていたが、
    # 測定レコードの`basic`は`aliases`のキーしか持たないので、**実データでは
    # 必ず空**だった（見本だけが値を持ち、紙では出ない——§CLAUDE 6の
    # 「見本が嘘をつく」そのもの）。
    ('製造材質', 'basic.mfgMaterial'),
    ('製造調質', 'basic.mfgTemper'),
    ('製造板厚', 'basic.mfgThickness'),
    ('製造板幅', 'basic.mfgWidth'),
    ('製造板丈', 'basic.mfgLength'),
    ('オーダー材質', 'basic.orderMaterial'),
    ('オーダー調質', 'basic.orderTemper'),
    ('オーダー板厚', 'basic.orderThickness'),
    ('オーダー板幅', 'basic.orderWidth'),
    ('オーダー板丈', 'basic.orderLength'),
    ('引当番号', 'basic.allocationNo'),
    ('用途コード', 'basic.purposeCode'),
    ('設計コース', 'basic.designCourse'),
    ('実績コース', 'basic.course'),
    ('残仕掛コース', 'basic.residualCourse'),
    ('元幅（BOX実績_板幅）', 'basic.originalWidth'),
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


# ---------------------------------------------------------------------------
# 測定した値の統計（§9.242 ⑨、利用者の指示）
# ---------------------------------------------------------------------------
# 「測定したデータの計算値や集計値など、測定したデータも細かくカスタマイズ
#  できるようにしてください。特にロットごとの板厚MIN、MAXや板幅MIN、MAXや
#  板丈MIN、MAXなど測定した項目の統計値なども含めて設計できるようにしたい」
#
# **語彙はここだけが持つ**（§9.163）——値を作るのは`report-dashboard.js`の
# `rpStat()`（測定値はレコードの中にあるので、サーバーからは引けない）だが、
# 「何が選べるか」はサーバーが答える。画面へ綴りの写しを持たせない。
#
# **道は`stat.<項目>.<集計>`の2段**——`calc.*`と同じ形にしておくと、
# `rpValueAt()`の分岐が1本増えるだけで済む。
#
# 桁数は**実際に記録されている値の小数桁**にそろえる（画面側で決める）。
# 項目ごとの桁数の表をここへ持つと、測定側の丸めと2箇所になる（§CLAUDE）。
STAT_ITEMS = (
    ('thickness', '板厚'),
    ('width', '板幅'),
    ('lateral', 'ラテラルボー'),
    ('burr', 'バリ'),
    ('telescope', 'テレスコープ'),
    ('offset', '巻ずれ'),
    # 丈ごとの記録（`product.rows`）。**板丈＝「長さ」**（§9.203の丈の表）。
    ('length', '板丈'),
    ('wall', '肉厚'),
)
STAT_AGGS = (
    ('min', 'MIN'),
    ('max', 'MAX'),
    ('avg', '平均'),
    ('span', 'ばらつき（MAX−MIN）'),
    ('n', 'N数'),
)
STAT_CATALOG = tuple(
    (f'{item_label} {agg_label}', f'stat.{item_key}.{agg_key}')
    for item_key, item_label in STAT_ITEMS
    for agg_key, agg_label in STAT_AGGS)
# **2つの軸を名乗る**（§9.274）。「板厚 MIN」は行＝板厚・列＝MINなので、
# これを候補に添えておくと**盤の「表に組む」が綴りを知らずに表を作れる**
# ——画面がラベルを空白で割って推測すると、名前に空白を含む項目で必ず崩れる。
# 軸を名乗らない候補は表に組めない、と画面が言えるのもこの印があるから。
# ---------------------------------------------------------------------------
# 軸（§9.277、利用者の指示）
# ---------------------------------------------------------------------------
# 「EXCELのピボットテーブルのように自由に組めるように、表にしたときには
#  選んだ項目の中に必要な共通軸を抽出してそれを置く場所を自動もしくはその後
#  ユーザーに修正させる形で作成することで最終形の表の形をしっかり固定できる
#  はずです。軸の位置と数がわかれば表の形状がわからずに最終形の出力に困らない」
#
# §9.274では`row`/`col`という**置き場つきの名前**で持っていた。それだと
# 「板厚は行、MINは列」と**決め打ちの1通り**しか作れず、行と列を入れ替える
# ことも、3つ目の軸（対象＝子ロット）を足すこともできない。
# **軸は「名前と値」だけを持ち、置き場（行／列）は画面が決める。**
AXIS_ITEM, AXIS_AGG, AXIS_LOT = '項目', '集計', '対象'
# **既定の置き方はこの並びが決める**——1つ目を行、残りを列（§9.277）。
# `対象`を先頭に置いてあるので、子ロットごとに繰り返す塊では
# 「行＝対象／列＝項目・集計」という**今までの縦積みと同じ形**が既定になる。
PIVOT_AXES = (AXIS_LOT, AXIS_ITEM, AXIS_AGG)
STAT_AXES = {f'stat.{ik}.{ak}': {AXIS_ITEM: il, AXIS_AGG: al}
             for ik, il in STAT_ITEMS for ak, al in STAT_AGGS}

# ---------------------------------------------------------------------------
# 品質等級・品質情報・母材（§9.285 ②、利用者の指示）
# ---------------------------------------------------------------------------
# 「帳票ブロックの部分で汎用化できていない部分を汎用表現を追加し編集可能範囲に
#  取り込む改良」
#
# `品質等級`／`品質情報（仕掛）`／`母材実績／カード指示`／`寸法（オーダー／製造）`は
# **中身がラベルと値の並びでしかない**のに、候補にその道が1つも無かったので
# マスの並びで組み直せなかった（＝コードが持つ形のまま、書式も寄せも列数も
# 触れない）。道を候補へ出せば、既にある仕組み（§9.274のマス・§9.277の
# ピボット・書式）がそのまま効く。
#
# **等級の呼び名は画面（`measurement-view.js`の`QUALITY_GRADE_SOURCE`）と
# そろえること**——記録は`qualityGrades[<呼び名>]`なので、綴りがずれると
# 候補から選んでも必ず空欄になる。`tests/test_rbcells.py`が機械で突き合わせる。
QUALITY_GRADE_LABELS = ('生地外観', 'アルマイト', '表面処理', '付着油',
                        '方向性', '強度', 'ラテラルボー', '直角度',
                        '切断面', '板厚公差', '幅丈公差', 'フラットネス')
LOT_INFO_CATALOG = (('品質情報（仕掛）', 'qualityInfo'),)

# 母材の欄は**操業データ項目の組み込み行**（§9.232）だが、記録の置き場は
# `settings.<組み込みキー>`ではなく`mother.<キー>`（`collect()`が
# `[data-mother]`を見て書く）。候補が`settings.motherManual`を答えていたため、
# **選んでも実データでは必ず空**だった（見本だけが値を持つ・§CLAUDE 6の
# 「見本が嘘をつく」。§9.254 ④で`basic.material`が踏んだのと同じ形）。
# **道の答えはここ1箇所**——`field_catalog`が組み込みキーをこれで読み替える。
BUILTIN_PATHS = {
    'motherManual': 'mother.manual',
    'motherFullLength': 'mother.fullLength',
    'motherMinCard': 'mother.minCard',
    'motherMaxCard': 'mother.maxCard',
    'motherFront': 'mother.front',
    'motherRear': 'mother.rear',
    'motherFrontCard': 'mother.frontCard',
    'motherRearCard': 'mother.rearCard',
    # 元幅は仕掛から写した値（`basic`）。母材の欄は同じ数を出しているだけ。
    'motherOriginalWidth': 'basic.originalWidth',
}
# **記録に残らない欄**（画面で計算して`<output>`へ出すだけ。`[data-op]`も
# `[data-opauto]`も持たないので`collect()`が拾わない）。候補へ出すと
# **押せるのに必ず空欄**になるので出さない——ただし**出さない理由は書く**
# （§4。黙って消すと「探しても無い」になる）。
UNRECORDED_BUILTINS = ('motherScrapWidth', 'motherCalcLength')


def builtin_path(key):
    """操業データの組み込みキー → 記録の中の本当の置き場（§9.285 ②）。

    **答えるのはここだけ**——読み替えを画面へ書き写すと、道を1本足したときに
    2箇所直すことになる（§9.163）。知らないキーは今までどおり
    `settings.<キー>`。"""
    k = str(key or '').strip()
    if not k:
        return ''
    return BUILTIN_PATHS.get(k) or ('settings.' + k)


# ---------------------------------------------------------------------------
# 仕掛の生の行（§9.285 ④、利用者の指示）
# ---------------------------------------------------------------------------
# 「帳票ブロックマスタで仕掛情報などリンクしているデータのうち、直接アプリで
#  使用していないデータでも元データからなくなれば出ないという制限付きで出す
#  ことができるようにひっぱれるデータ範囲の拡張をしてほしい」
#
# 測定レコードは**仕掛の行をまるごと控えている**（`blankMeasure()`の
# `source: row`、保存時に`snapshot.source`へも凍らせる）。ところが候補が
# 出していたのは`aliases`で名前を付けた23件だけで、残りの200列は
# **記録の中に在るのに紙へ出す手立てが無かった**。
#
# 道は`source.<列名>`。**列名はそのまま1つの鍵**（`.`で割らない）——
# 実データの列名に`.`が入っていても壊れないようにする。
#
# **「元データからなくなれば出ない」**のは、この道が記録の中の写しを
# 素直に引くだけだから——列が消えれば空欄になる。**空欄と「無い」を
# 区別しない**のはこの道の約束で、そのことを候補の説明に書く。
SOURCE_PREFIX = 'source.'
# 見本の1行を引くときの上限。**全列を返す**（列を選べることが値打ちなので
# 絞らない）が、極端に横長な表で画面が固まらないよう頭は打っておく。
SOURCE_COLUMN_MAX = 400


def source_columns(limit=SOURCE_COLUMN_MAX):
    """仕掛の生の列名と、見本の値を1行ぶん（§9.285 ④）。

    **表の選び方は`source_capability`の1箇所**——一覧が読んでいる表と
    同じものを読まないと、「一覧に出ている列」と「紙で選べる列」が
    食い違う（§9.163）。読めなければ空（fail-open）。"""
    try:
        from .. import db_access as db
        from .. import source_capability as sc
        if not db.WORK_DB_KEY:
            return []
        return sc.sample_columns(db.WORK_DB_KEY, limit)
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 子ロット（幅分割）そのものの値（§9.247 ②）
# ---------------------------------------------------------------------------
# 繰り返し（`[繰返]='子ロット'`）にした塊では、**その回の子ロット**を指す。
# 繰り返していない塊では**親ロット自身**へ落ちるので、どちらに置いても
# 空欄にならない（§4「押せるのに何も起きない」を作らない）。
#
# **`basic.lotNo`と別に持つ**——あちらは測定レコードの親ロット番号で、
# 子ロットごとに繰り返しても値は変わらない。同じ紙に「親のロット番号」と
# 「この段の子ロット番号」が両方要ることがあるので、道を分ける。
LOT_CATALOG = (
    ('子ロット番号', 'lot.no'),
    ('子ロットの条の範囲', 'lot.range'),
    ('子ロットの条数', 'lot.strips'),
    ('子ロットの通し番号', 'lot.index'),
    ('子ロットの件数', 'lot.count'),
)


# ---------------------------------------------------------------------------
# 見本の値（§9.250 ⑤、利用者の指示）
# ---------------------------------------------------------------------------
# 「データダミーをつかって、帳票の表示が最終的にどうなるか、操業データが
#  どうなるかといった結果をそれぞれ編集するマスタに直結させてすぐに確認
#  できる導線を準備してください」
#
# 設定窓の見本は今まで値の場所へ「値」と書いていた。**桁も文字種も分からない
# ので、幅が足りるのか・折り返すのかが確かめられない**（見本の値打ちの半分が
# 出ていなかった）。ここでダミーを1つずつ持つ。
#
# **語彙と同じ場所が持つ**（§9.163）——`FIELD_CATALOG`の隣に置けば、道を
# 1本足したときに見本も一緒に足すことになる。画面へ写すと、道が増えるたびに
# 2箇所直すことになり、片方だけ足した状態が作れる。
#
# **ありそうな値にする**（`123`ではなく`L240815-03`）——長さと文字種が
# 実物と違うと、紙に入るかどうかを見誤る（§9.130「入れ物の大きさは中身の
# 長さから決める」を確かめる道具なので、中身が嘘だと意味が無い）。
# **ロット№は7桁**（§9.254 ④、利用者の指示「ダミーデータのロット№の桁数は
# 7桁にしてください」）。実機のLotDsp検索は`linkkey`を**7文字固定幅**の
# ロット番号で組み立てる（`base.js`の`lotDspField()`）ので、7桁が実物の桁数。
# 子ロットも同じ桁数の別番号にする（分割後はそれぞれが独立したロット）。
SAMPLE_LOT_NO = 'L240815'
SAMPLE_VALUES = {
    'basic.lotNo': SAMPLE_LOT_NO,
    'basic.inspectionNo': 'K024107',
    'basic.castingNo': 'C78210',
    'basic.orderNo': 'ORD-24-00815',
    'basic.purposeName': '端子用条',
    'basic.customer': '○○電機株式会社',
    'basic.delivery': '△△工場 第2倉庫',
    # 既定の塊（基本情報・コース情報・寸法）が読む道。**`FIELD_CATALOG`に
    # 無い道もここに置く**（§9.253）——見本のロットは「全部の欄が埋まって
    # いる1件」であることが値打ちなので、`-`のままの欄を残さない。
    # 埋めないと、その塊だけ紙の上で実物より痩せて見える（§9.130）。
    'basic.allocationNo': 'A-24-0087',
    'basic.purposeCode': 'TZ-02',
    'basic.designCourse': 'S-3',
    'basic.course': 'S-3',
    'basic.residualCourse': '0',
    'basic.orderMaterial': 'C1020',
    'basic.orderTemper': '1/2H',
    'basic.orderThickness': '0.300',
    'basic.orderWidth': '30.0',
    'basic.orderLength': '2000',
    'basic.mfgMaterial': 'C1020',
    'basic.mfgTemper': '1/2H',
    'basic.mfgThickness': '0.300',
    # **条幅と元幅は辻褄を合わせる**（§9.254 ④）——製造板幅は「条1本の幅」で、
    # 元幅（BOX実績_板幅）は母材の幅。`_SAMPLE_SPLIT`の合計＋屑幅＝元幅。
    'basic.mfgWidth': '30.0',
    'basic.mfgLength': '2000',
    'basic.originalWidth': '1224.5',
    'settings.registeredEquipment': 'スリッター1号',
    'settings.measureType': '板厚',
    # 丈位置は**選択欄に実在する綴り**にする（`updateLengthOptions()`が
    # `1(頭)…N(頭)`＋`N(尾)`を作る）。`select.value`に無い値を入れると
    # 空文字へ落ちて記録が黙って消える（§9.204と同じ罠）。
    'settings.lengthPos': '1(頭)',
    'settings.verticalCount': '9',
    'settings.horizontalCount': '40',
    'settings.operator': '山田 太郎',
    'settings.inspector': '佐藤 花子',
    'settings.crewSize': '2',
    'settings.innerDiameter': '508',
    'settings.spool': 'S-12',
    # 組み込みの欄はどれも`settings.<キー>`（§9.215）。**選択肢マスタが
    # 空の端末でも見本が出るように**、ここでも1つずつ持つ。
    'settings.thicknessGauge': 'マイクロメータ-A',
    'settings.widthGauge': 'ノギス-B',
    # **選択欄に実在する綴りにすること**（§9.254 ④）。以前は`上巻`／`OS→DS`／
    # `OS`／`バリ上`と、どの選択肢にも無い値だった——長さも文字種も実物と違うので、
    # 幅を確かめる道具にならない（§9.130）。綴りは`index.html`の選択欄と
    # `operation_repo.CHOICE_SEEDS`が正。
    'settings.unwind': '上出し',
    'settings.widthOrder': '奇数条優先',
    'settings.widthDirection': '昇順',
    # **鍵は`burr`**（組み込みの欄のキー。`operation_repo.BUILTIN_*`）。
    # `burrAlign`はどこからも読まれない綴りだったので、測定条件の
    # 「バリ揃え」は見本でも既定の「指定なし」のままだった。
    'settings.burr': '上バリ揃え',
    'settings.coilStop': '内巻両面テープ',
    # 梱包員（作業班構成が読む道）。**空のままにしない**（§9.254 ④）。
    'settings.packer': '鈴木 一郎',
    # 母材の欄（§9.232）。単位はmmで、桁も実物に寄せる。
    # 母材（§9.285 ②）。**記録の鍵は`mother.<キー>`**——以前はここが
    # `settings.mother*`で、**見本だけが値を持ち実データでは必ず空**だった
    # （§CLAUDE 6「見本が嘘をつく」）。道の答えは`builtin_path()`の1箇所。
    'mother.manual': '1985',
    'mother.fullLength': '1980',
    'mother.minCard': '1975',
    'mother.maxCard': '1990',
    'mother.front': '3.0',
    'mother.rear': '2.5',
    'mother.frontCard': '3.0',
    'mother.rearCard': '2.5',
    # 品質等級（§9.285 ②）。**切断面は等級を入れる**——揃いの合否がここから
    # 出る（§9.204）ので、空だと丈別データの合否欄を紙で確かめられない。
    'qualityGrades.生地外観': 'A', 'qualityGrades.アルマイト': 'A',
    'qualityGrades.表面処理': 'なし', 'qualityGrades.付着油': '有',
    'qualityGrades.方向性': '指定なし', 'qualityGrades.強度': 'A',
    'qualityGrades.ラテラルボー': 'A', 'qualityGrades.直角度': 'A',
    'qualityGrades.切断面': '3級', 'qualityGrades.板厚公差': 'A',
    'qualityGrades.幅丈公差': 'A', 'qualityGrades.フラットネス': 'A',
    'workTime.startAt': '2026-08-27 08:15',
    'workTime.endAt': '2026-08-27 11:40',
    # **記録と同じ形（ISO・末尾Z）で持つ**（§9.285 ③）——実データの
    # `updatedAt`は`new Date().toISOString()`なので、見本だけ`'2026-08-27 11:42'`
    # のような地方時の文字列にしていると、**書式（`HH:mm:ss`・時差）が
    # 見本では確かめられない**（§CLAUDE 6「見本が嘘をつく」）。
    # 画面は`fmtDT()`で地方時へ直してから出す（§9.162）。
    'updatedAt': '2026-08-27T02:42:37.000Z',
    'calc.equipment': 'スリッター1号',
    'calc.coilStop': 'テープ止め',
    'calc.crewSize': '2名班',
    'calc.workStart': '2026-08-27 08:15',
    'calc.workEnd': '2026-08-27 11:40',
    'calc.workDuration': '3時間25分',
    'calc.status': '完了',
    'calc.updatedAt': '2026-08-27 11:42',
    'lot.no': 'L240817',
    'lot.range': '条 7〜11',
    'lot.strips': '5条',
    'lot.index': '2',
    'lot.count': '9',
}
# 統計は**項目ごとに桁が違う**（板厚は3桁・板幅は2桁・N数は整数）。
# 表で持つと項目を1つ足すたびに40行増えるので、項目の代表値と集計の作り方で持つ。
_STAT_SAMPLE = {
    'thickness': ('0.298', '0.302', '0.300', '0.004'),
    'width': ('29.96', '30.05', '30.00', '0.09'),
    'lateral': ('0.2', '0.8', '0.5', '0.6'),
    'burr': ('0.01', '0.03', '0.02', '0.02'),
    'telescope': ('0.5', '1.2', '0.8', '0.7'),
    'offset': ('0.3', '0.9', '0.6', '0.6'),
    'length': ('1998', '2002', '2000', '4'),
    'wall': ('1.48', '1.52', '1.50', '0.04'),
}
# N数は**項目ごとに違う**（§9.254 ④）。条ごとに測るもの（板幅ほか）は
# 丈×条、板厚は丈×3点、丈ごとの記録（板丈・肉厚）は丈の数——1つの数で
# 揃えると、見本を見た人が「1点でも400点でも同じ」と読んでしまう（§9.214）。
_STAT_N = {'thickness': 3 * 10, 'length': 10, 'wall': 10}
for _k, _vals in _STAT_SAMPLE.items():
    SAMPLE_VALUES[f'stat.{_k}.min'] = _vals[0]
    SAMPLE_VALUES[f'stat.{_k}.max'] = _vals[1]
    SAMPLE_VALUES[f'stat.{_k}.avg'] = _vals[2]
    SAMPLE_VALUES[f'stat.{_k}.span'] = _vals[3]
    SAMPLE_VALUES[f'stat.{_k}.n'] = str(_STAT_N.get(_k, 40 * 10))


# ---------------------------------------------------------------------------
# 見本のロット1件（§9.253、利用者の指示）
# ---------------------------------------------------------------------------
# 利用者の指示:
#
#   「全入力可能データのダミーデータを1データ、内部に持っておくこととその
#    データを活用し帳票のプレビューを帳票ブロックマスタから確認用に実際の
#    データを配置した形かつ、現在のレイアウトでのデータを見られる、試し印刷も
#    できるようにしてください」
#
# **値はここが持つ**（`SAMPLE_VALUES`と同じ1箇所・§9.163）——設定画面の
# 「見本の値」とプレビューの値が別々だと、`L240815-03`で幅を確かめたのに
# 紙には別の文字が出る、という食い違いが作れる。
#
# **形（配列の大きさ）は画面が持つ**——`ensureMeasureShape()`が丈×条へ
# 揃え直すので、ここは**使う範囲だけ**埋める。丈数・条数の定数を
# サーバーへ書き写さない。
#
# **絶対に保存しない**。このレコードは画面のメモリにしか置かず、
# `records.sqlite3`にもIndexedDBにも入れない（見本のロットが実データの
# 一覧に並ぶのは、どんな見間違いより悪い）。番号もひと目で見本と分かる
# ものにする。
SAMPLE_RECORD_ID = '__sample__'
# 見本の測定値。**実物に寄せた桁とばらつき**にする（§9.250 ⑤と同じ理由）
# ——桁が違うと紙に入るかどうかを見誤る。中心値は`_STAT_SAMPLE`と揃える。
#
# **器の上限まで埋める**（§9.254 ④、利用者の指示「最大データ数40条分
# 埋まっているなど、埋まっていないデータがないようにすべてのデータ項目で
# 表示したい」）。紙に入るかどうかを確かめる道具なので、**いちばん詰まった
# ロット**で見られないと意味が無い（8条3丈では、40条10丈の紙が何枚になるか
# 分からない）。条は`measurements`の器の幅（40）、丈は選択欄の上限
# （`updateLengthOptions()`が作る`1(頭)…9(頭)`＋`9(尾)`＝10）。
_SAMPLE_VERTICAL = 9
_SAMPLE_LENGTHS = tuple(f'{i + 1}(頭)' for i in range(_SAMPLE_VERTICAL)) + (f'{_SAMPLE_VERTICAL}(尾)',)
_SAMPLE_STRIPS = 40
_SAMPLE_SERIES = {
    # 鍵: (中心値, 1つずつずらす幅, 小数桁, 1丈あたりの本数)
    #     本数 None は「条の数だけ」（板厚だけが丈ごとに3点・§9.138）。
    'thickness': (0.300, 0.002, 3, 3),
    'width': (30.00, 0.03, 2, None),
    'lateral': (0.5, 0.1, 1, None),
    'burr': (0.02, 0.01, 2, None),
    'telescope': (0.8, 0.1, 1, None),
    'offset': (0.6, 0.1, 1, None),
}
# 平面度と備考は数の列ではないので別に持つ。**空にしない**——空欄の列が
# 1本あると、その塊だけ紙の上で実物より痩せて見える（§9.130）。
_SAMPLE_FLATNESS = ('〇', '〇', '〇', '△', '〇', '〇', '×', '〇')
_SAMPLE_COMMENTS = ('', '軽微キズ', '', '端部ダレ', '', '', '色ムラ', '')
# 子ロット（異幅分割）。**合計は条数と合わせる**——合わないと、
# `rpSplitLots()`が数える条の範囲と実際の測定値の並びがずれる。
# 幅を1つずつ変えてあるのは**異幅分割の紙**を確かめるため（等幅だと
# 子ロットごとの公差の欄が全部同じ値になり、効いているか分からない）。
# ロット№は親と同じ7桁（§9.254 ④）。**下3桁は重ねない**——条の図の
# バッジは下3桁を出すので、重なると別の子ロットが同じ札になる。
_SAMPLE_SPLIT = (
    ('L240816', 6, 32.0),
    ('L240817', 5, 31.5),
    ('L240818', 5, 31.0),
    ('L240819', 4, 30.5),
    ('L240820', 4, 30.0),
    ('L240821', 4, 29.5),
    ('L240822', 4, 29.0),
    ('L240823', 4, 28.5),
    ('L240824', 4, 28.0),
)
# 母材（元幅）と屑幅。**条幅の合計＋屑幅＝元幅**にする（辻褄が合わないと、
# 条の設計の帯も異常位置判定の図も出せない）。屑は**片寄せ**にしてある
# ——均等だと`scrapOs`／`scrapDs`を分けて持つ意味が紙で確かめられない（§9.160）。
_SAMPLE_SLIT = round(sum(n * w for _, n, w in _SAMPLE_SPLIT), 3)
_SAMPLE_SCRAP = 18.0
_SAMPLE_SCRAP_OS = 10.5
_SAMPLE_ORIGINAL_WIDTH = round(_SAMPLE_SLIT + _SAMPLE_SCRAP, 3)
# 幅の公差（親ロットの`source`と同じ値。子ロットごとの欄がここから出る）。
_SAMPLE_WIDTH_TOL = {'plus': 0.05, 'minus': 0.05}
_SAMPLE_WIDTH_TOL_ORDER = {'plus': 0.08, 'minus': 0.08}


def _sample_lanes():
    """条の並び（OS側から）。`defect-locator.js`の`lanes()`と同じ形。"""
    out, acc = [], 0.0
    i = 0
    for lot, count, width in _SAMPLE_SPLIT:
        for _ in range(count):
            out.append({'index': i, 'lot': lot, 'width': width,
                        'start': round(acc, 3), 'end': round(acc + width, 3)})
            acc += width
            i += 1
    return out


# 異常位置判定（§9.254 ④、利用者の指示「条の異常位置判定がある場合なども
# 異常データがあるものとして、異常情報もあるものとして設定を」）。
#
# 帳票が読むのは**保存されたスナップショット**（`settings.defectLocation.saved`）
# だけで、`defect-locator.js`は「保存した時点の判定」をそのまま描く——つまり
# ここが持つのは**凍った1件の記録**であって、判定の処理ではない（現場の
# 保存済みデータとまったく同じ立場。§CLAUDE「同じ処理を2つ持たない」に
# 触れない）。数字は`compute()`と同じ式でここに書き下してある。
_SAMPLE_DEFECT_BASIS = 'os'          # OSからの距離で指す
_SAMPLE_DEFECT_DISTANCE = 620.0      # mm
_SAMPLE_DEFECT_WIDTH = 40.0          # mm（3条にまたがる幅にしてある）
_SAMPLE_DEFECT_MEMO = 'OS側 620mm付近に連続した打痕。ロール起因の疑い。'


def _sample_defect_saved():
    """凍らせた異常位置判定1件。**該当条が必ず出る**ように作る。"""
    lanes = _sample_lanes()
    # 基準幅は元幅（屑を含む）。条1のOS端はOS側の屑幅だけ内側（compute()と同じ）。
    base_width = _SAMPLE_ORIGINAL_WIDTH
    pos = round(_SAMPLE_DEFECT_DISTANCE - _SAMPLE_SCRAP_OS, 3)
    lo = round(pos - _SAMPLE_DEFECT_WIDTH / 2, 3)
    hi = round(pos + _SAMPLE_DEFECT_WIDTH / 2, 3)
    hits = [dict(l, fromLaneOs=round(max(0.0, min(l['width'], pos - l['start'])), 3))
            for l in lanes if l['end'] > lo and l['start'] < hi]
    inp = {'basis': _SAMPLE_DEFECT_BASIS, 'distance': str(_SAMPLE_DEFECT_DISTANCE),
           'widthBasis': 'original', 'defectWidth': str(_SAMPLE_DEFECT_WIDTH),
           'memo': _SAMPLE_DEFECT_MEMO}
    return {'savedAt': SAMPLE_VALUES.get('updatedAt', ''), 'input': inp,
            'basis': _SAMPLE_DEFECT_BASIS, 'widthBasis': 'original',
            'distance': _SAMPLE_DEFECT_DISTANCE, 'defectWidth': _SAMPLE_DEFECT_WIDTH,
            'memo': _SAMPLE_DEFECT_MEMO,
            'baseWidth': base_width, 'original': _SAMPLE_ORIGINAL_WIDTH,
            'scrap': _SAMPLE_SCRAP, 'scrapOs': _SAMPLE_SCRAP_OS,
            'scrapDs': round(_SAMPLE_SCRAP - _SAMPLE_SCRAP_OS, 3), 'scrapBiased': True,
            'slit': _SAMPLE_SLIT, 'pos': pos, 'lo': lo, 'hi': hi,
            'lanes': lanes, 'hits': hits}


_SAMPLE_DEFECT = _sample_defect_saved()


def _put_path(out, path, value):
    """`a.b.c` を入れ子の辞書へ入れる。**道の綴りは`SAMPLE_VALUES`が正**
    なので、ここでキー名を並べ直さない（並べると2箇所になる）。"""
    parts = str(path or '').split('.')
    if len(parts) == 1:
        out[parts[0]] = value
        return
    cur = out
    for k in parts[:-1]:
        nxt = cur.get(k)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[k] = nxt
        cur = nxt
    cur[parts[-1]] = value


def sample_record(c=None, equipment=''):
    """帳票の見本に使う**ダミーのロット1件**（§9.253）。

    **`SAMPLE_VALUES`の道をそのまま入れ子へ広げる**ので、`FIELD_CATALOG`に
    在る道は**全部**値を持つ（道を1本足したら見本も一緒に足すことになる）。
    操業データの項目は設備ごとに違うので、マスタから引いて`sample_for()`で
    埋める——現場が項目を足せば、見本のロットにもその欄が増える。

    `equipment` を渡すと登録設備をそれにする（帳票の配置は
    `report:<設備>`なので、**どの設備の配置で見るか**がこれで決まる）。
    """
    rec = {}
    for path, value in SAMPLE_VALUES.items():
        # `calc.*`/`stat.*`/`lot.*` は**レコードから導かれる値**なので入れない
        # （入れると、計算した値と食い違う写しが1つ増える）。
        if path.split('.')[0] in ('calc', 'stat', 'lot'):
            continue
        _put_path(rec, path, value)
    basic = rec.setdefault('basic', {})
    st = rec.setdefault('settings', {})
    eq = str(equipment or '').strip()
    if eq:
        st['registeredEquipment'] = eq
    rec['registeredEquipment'] = st.get('registeredEquipment', '')
    # 数で持つもの（画面が`Number()`で扱う）。文字のままだと条数が1になる。
    # **丈数は「頭の数」**（`lengthLabels()`が`N(尾)`を`N`番目として読む）ので、
    # 丈の札の数（頭N＋尾1）とは1つずれる。
    st['verticalCount'] = _SAMPLE_VERTICAL
    st['horizontalCount'] = _SAMPLE_STRIPS
    # 子ロット。**基準幅と公差まで入れる**（§9.254 ④）——`widthRowContext()`が
    # ここから子ロットごとの公差の範囲を作るので、入れないと紙の
    # 「範囲下限／範囲上限」が親ロットの公差で全部同じ値になる。
    st['splitGroups'] = [{'lot': lot, 'count': n,
                          'base': {'width': w, 'lotNo': lot},
                          'tol': {'width': {'manufacturing': dict(_SAMPLE_WIDTH_TOL),
                                            'order': dict(_SAMPLE_WIDTH_TOL_ORDER)}},
                          'missing': False}
                         for lot, n, w in _SAMPLE_SPLIT]
    # 条→子ロットの対応（`defect-locator.js`の`lanes()`が見る）。**これが
    # 無いと条幅が分からず**、条の設計の図も異常位置判定の図も出せない。
    pos_group = []
    for gi, (_lot, n, _w) in enumerate(_SAMPLE_SPLIT):
        pos_group.extend([gi] * n)
    st['splitPositionGroup'] = pos_group
    # 屑幅の片寄せ（§9.160）。**OS側の実寸そのもの**を持つ。
    st['scrapOsWidth'] = _SAMPLE_SCRAP_OS
    # 異常位置判定（§9.254 ④）。入力と、帳票へ載る**保存済みの判定**の両方。
    st['defectLocation'] = {'basis': _SAMPLE_DEFECT_BASIS,
                            'distance': str(_SAMPLE_DEFECT_DISTANCE),
                            'widthBasis': 'original',
                            'defectWidth': str(_SAMPLE_DEFECT_WIDTH),
                            'memo': _SAMPLE_DEFECT_MEMO,
                            'lanes': [{'index': h['index'], 'lot': h['lot'],
                                       'width': h['width']}
                                      for h in _SAMPLE_DEFECT['hits']],
                            'position': _SAMPLE_DEFECT['pos'],
                            'updatedAt': SAMPLE_VALUES.get('updatedAt', ''),
                            # **写しを配る**——画面はこのレコードを書き換えるので、
                            # 使い回すと2回目に開いた見本が前回の続きになる。
                            'saved': _copy.deepcopy(_SAMPLE_DEFECT)}
    # 長手方向（ロールを特定）の入力（§9.239 ⑥）。**こちらも埋める**
    # ——同じ窓の②が空だと、判定の材料がそろった1件にならない。
    st['defectRoll'] = {'pitch': 314.2, 'tol': 3, 'face': '上面', 'harmonics': 3,
                        'memo': '打痕の繰り返し間隔（実測3点の平均）',
                        'updatedAt': SAMPLE_VALUES.get('updatedAt', '')}
    # 母材・品質等級（§9.285 ②）。**見本も記録と同じ道から作る**
    # ——`SAMPLE_VALUES`と別に値を並べると、候補の見本と紙の見本が
    # 食い違いうる（§9.163）。
    rec['mother'] = {k.split('.', 1)[1]: v for k, v in SAMPLE_VALUES.items()
                     if k.startswith('mother.')}
    rec['qualityGrades'] = {k.split('.', 1)[1]: v
                            for k, v in SAMPLE_VALUES.items()
                            if k.startswith('qualityGrades.')}
    # 仕掛の生の行。**公差はここから読む**（`toleranceRangeLocal`）ので、
    # 入れないと測定値の表に公差の範囲が出ず、幅が実物と違って見える。
    #
    # **実データの1行を土台にする**（§9.285 ④）——`source.<列名>`で200列を
    # 選べるようにした以上、見本が8列しか持たないと**選んだ列がほとんど空欄**
    # になり、紙に入るかどうかを確かめられない（§CLAUDE 6「見本が嘘をつく」の
    # 裏返し。実データでは値があるのに見本だけ空）。読めなければ今までどおり。
    src = {}
    try:
        for x in source_columns():
            if x.get('sample') != '':
                src[x['name']] = x['sample']
    except Exception:
        src = {}
    # 公差は**見本の値で上書きする**——測定値の表の範囲がここで決まるので、
    # 現場のデータ次第で見本の絵が変わると、幅の確かめに使えない。
    src.update({
        '板厚公差_製造_プラス': 0.005, '板厚公差_製造_マイナス': 0.005,
        '板幅公差_製造_プラス': 0.05, '板幅公差_製造_マイナス': 0.05,
        '板厚公差_オーダー_プラス': 0.008, '板厚公差_オーダー_マイナス': 0.008,
        '板幅公差_オーダー_プラス': 0.08, '板幅公差_オーダー_マイナス': 0.08,
    })
    rec['source'] = src
    # **異常情報も「有る」ほうで持つ**（§9.254 ④、利用者の指示「異常情報も
    # あるものとして設定を」）——「異常情報なし」だと、その欄が紙で何行に
    # なるのか確かめられない（§9.130）。
    rec['qualityInfo'] = ('OS側 620mm付近に打痕（19〜21条）。ロール起因の疑いで'
                          '異常位置判定を保存済み。該当条は要選別。')
    rec['status'] = '完了'
    rec['id'] = SAMPLE_RECORD_ID
    rec['createdAt'] = SAMPLE_VALUES.get('updatedAt', '')
    # 測定値。**使う範囲だけ**（丈×条）。残りは画面の`ensureMeasureShape()`が
    # 空で埋める——丈の総数(LENGTH_SLOTS)をここへ書き写さない。
    ms = {}
    for key, (base, step, digits, points) in _SAMPLE_SERIES.items():
        width = points if points else _SAMPLE_STRIPS
        rows = []
        for li in range(len(_SAMPLE_LENGTHS)):
            row = []
            for si in range(width):
                # 上下に振る（同じ値が並ぶと「1つも測っていない」ように見える）
                k = ((li * width + si) % 5) - 2
                row.append(('%.' + str(digits) + 'f') % (base + step * k))
            rows.append(row)
        ms[key] = rows
    # 平面度と備考。**全部同じにしない**（§9.254 ④）——1種類だけだと、
    # 異常の印が紙でどう出るのか確かめられない。
    ms['flatness'] = [[_SAMPLE_FLATNESS[(li + si) % len(_SAMPLE_FLATNESS)]
                       for si in range(_SAMPLE_STRIPS)] for li in range(len(_SAMPLE_LENGTHS))]
    ms['comments'] = [[_SAMPLE_COMMENTS[(li + si) % len(_SAMPLE_COMMENTS)]
                       for si in range(_SAMPLE_STRIPS)] for li in range(len(_SAMPLE_LENGTHS))]
    rec['measurements'] = ms
    # 丈ごとのデータ（板丈・肉厚・揃い）。**丈位置の名前も入れる**——
    # 空だと「どの丈の行か」が紙で分からない。
    # **どの丈も埋める**（§9.254 ④）。エッジ形状は3通りを回して、
    # 合否（OK／NG）と内訳の欄が**両方**紙に出るようにする（§9.204）。
    _EDGE = ('揃い綺麗', 'のこぎり状', 'テレスコ状')
    rec['product'] = {'rows': [{
        'productLength': ('%d' % (1998 + (i % 5))),
        'wallThickness': ('%.2f' % (1.48 + 0.01 * (i % 5))),
        'edgeShape': _EDGE[i % 3],
        'occurrencePosition': '' if i % 3 == 0 else ('端部' if i % 3 == 1 else '中央'),
        'regularity': '' if i % 3 == 0 else ('一定' if i % 3 == 1 else '不定'),
        'direction': '' if i % 3 == 0 else ('OS' if i % 3 == 1 else 'DS'),
        'pitch': '' if i % 3 == 0 else ('120' if i % 3 == 1 else '245'),
        'alignmentValue': '' if i % 3 == 0 else ('1.2' if i % 3 == 1 else '2.8'),
        'note': ('良' if i % 3 == 0 else ('要観察' if i % 3 == 1 else '選別対象')),
    } for i in range(len(_SAMPLE_LENGTHS))]}
    rec['workTime'] = rec.get('workTime') or {}
    # 操業データ（§9.215）。**項目は設備ごとのマスタが決める**ので並べない。
    if c is not None:
        try:
            from . import operation_repo as op
            bag = st.setdefault('opData', {})
            for it in op.items_for_equipment(c, eq):
                if not it.get('enabled', True):
                    continue
                name = str(it.get('name') or '').strip()
                if not name or name in bag:
                    continue
                bag[name] = sample_for('settings.opData.' + name, it)
        except Exception:
            # **見本が作れないことを失敗にしない**（§9.163の判定と同じ作法）
            # ——操業データが読めなくても、帳票の見本そのものは出せる。
            pass
    return rec


def sample_for(path, item=None):
    """その道に入りそうな値を1つ返す（§9.250 ⑤）。

    **操業データの項目はマスタから作る**——項目名も型も選択肢も現場が
    決めるので、表では持てない。選択肢があれば先頭、数なら桁と上下限から
    それらしい数、それ以外は短い語。**知らない道でも空にしない**
    （空だと「見本が壊れている」と読まれる・§CLAUDE 6）。"""
    fixed = SAMPLE_VALUES.get(str(path or ''))
    if fixed is not None:
        return fixed
    if item:
        choices = item.get('choices') or []
        if choices:
            return str(choices[0])
        kind = str(item.get('kind') or item.get('type') or '')
        if kind in ('整数', '正の整数'):
            lo = item.get('min')
            return str(int(lo) + 1) if isinstance(lo, (int, float)) else '12'
        if kind in ('数値', '正の数'):
            try:
                d = int(item.get('decimals'))
            except (TypeError, ValueError):
                d = 1
            d = max(0, min(4, d))
            return f'{12.5:.{d}f}' if d else '12'
    return '（値）'


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
         'items': [{'label': l, 'path': p, 'sample': sample_for(p)}
                   for l, p in FIELD_CATALOG if p.startswith('basic.')]},
    ]
    prep, opdata, skipped = [], [], []
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
                # **記録に残らない欄は候補へ出さない**（§9.285 ②）——画面で
                # 計算して`<output>`へ出すだけなので、選んでも紙は必ず空欄。
                # 出さない理由は群の説明に書く（§4）。
                if builtin in UNRECORDED_BUILTINS:
                    skipped.append(name)
                    continue
                # 組み込みの欄の置き場は`builtin_path()`が答える（§9.285 ②）
                # ——母材は`settings.<キー>`ではなく`mother.<キー>`。
                row['path'] = builtin_path(builtin)
                prep.append(row)
            else:
                # 自由項目は**項目名が鍵**（§9.215）。
                row['path'] = 'settings.opData.' + name
                opdata.append(row)
            # 見本の値（§9.250 ⑤）。**行そのものから作る**——項目名も型も
            # 選択肢も現場が決めるので、道の表では持てない。
            row['sample'] = sample_for(row['path'], it)
    except Exception:
        pass
    if prep:
        note = '測定画面がもともと持っている入力欄です。'
        if skipped:
            # **出せないものは名前で言う**（§4／§CLAUDE 6）——黙って候補から
            # 落とすと「探しても無い」になり、打つ手を持てない。
            note += ('（' + '・'.join(skipped)
                     + ' は画面で計算して出すだけで記録に残らないため、'
                       '紙には出せません）')
        groups.append({'group': '準備で決めた値', 'note': note, 'items': prep})
    if opdata:
        groups.append({'group': '操業データ（現場で足した項目）',
                       'note': '操業データ項目マスタで足した入力欄です。項目を足すとここにも増えます。',
                       'items': opdata})
    # 品質等級・品質情報（§9.285 ②）。**記録の中にあるのに道が無かった**
    # ので、既定の塊の形（コードが持つ表）から動かせなかった。
    groups.append({'group': '品質等級（仕掛）',
                   'note': '仕掛データの品質グレードです。'
                           '**値が入っていない等級は空欄になります。**',
                   'items': [{'label': lb, 'path': 'qualityGrades.' + lb,
                              'sample': sample_for('qualityGrades.' + lb)}
                             for lb in QUALITY_GRADE_LABELS]})
    groups.append({'group': '品質情報（仕掛）',
                   'note': '仕掛データの異常情報です。改行を含む長い文になる'
                           'ことがあるので、**幅と高さに余裕を持たせてください**。',
                   'items': [{'label': lb, 'path': p, 'sample': sample_for(p)}
                             for lb, p in LOT_INFO_CATALOG]})
    # 仕掛の生の行（§9.285 ④）。**列が多い**ので、群を選んでから絞り込む。
    src = source_columns()
    if src:
        groups.append(
            {'group': '仕掛の生データ（%d列）' % len(src),
             'note': 'アプリが名前を付けていない列も含めて、**測定を始めた'
                     'ときの仕掛の行をそのまま**引きます。'
                     '**元データにその列が無くなれば空欄になります**'
                     '（名前の付け替え・列の削除に追随しません）。'
                     '見本は仕掛データの先頭1件の値です。',
             'items': [{'label': x['name'], 'path': SOURCE_PREFIX + x['name'],
                        'sample': x['sample'] or '（空）'}
                       for x in src]})
    groups.append({'group': '作業時間',
                   'note': '測定の開始・終了の記録です。',
                   'items': [{'label': l, 'path': p, 'sample': sample_for(p)}
                             for l, p in FIELD_CATALOG
                             if p.startswith('workTime.') or p == 'updatedAt']})
    groups.append({'group': '計算した値',
                   'note': '実働時間・状態など、いくつかの値から作るものです。',
                   'items': [{'label': l, 'path': p, 'sample': sample_for(p)}
                             for l, p in CALC_CATALOG]})
    # **測定した値の統計**（§9.242 ⑨）。ロット1件ぶんの測定値から作る。
    # **N数を必ず添えられるようにしてある**——1点と80点では当たる見込みが
    # 違うので、MIN/MAXだけを出せる形にはしない（§9.214と同じ約束）。
    groups.append({'group': '測定した値の統計',
                   'note': 'このロットで測った値から作ります（MIN・MAX・平均・'
                           'ばらつき・N数）。まだ測っていない項目は空欄になります。'
                           '**塊の「繰り返し」を「分割後の子ロットごと」にすると、'
                           'その子ロットの条だけから数えた値になります**（§9.247 ②）。'
                           '板厚・板丈・肉厚は丈ごとに測るので子ロットには割り当てられず、'
                           '「—」になります。',
                   'items': [{'label': l, 'path': p, 'sample': sample_for(p),
                              # **軸は名前と値だけ**（§9.277）。置き場（行／列）を
                              # ここで決めないので、行と列を入れ替えられる。
                              'axes': dict(STAT_AXES[p])}
                             for l, p in STAT_CATALOG]})
    # 子ロットそのものの値（§9.247 ②）。**繰り返していない塊では親ロットへ
    # 落ちる**ので、どちらに置いても空欄にならない。
    groups.append({'group': '子ロット（幅分割）',
                   'note': '塊の「繰り返し」を「分割後の子ロットごと」にしたとき、'
                           'その回の子ロットを指します。'
                           '繰り返していない塊では**このロット自身**の値になります。',
                   'items': [{'label': l, 'path': p, 'sample': sample_for(p)}
                             for l, p in LOT_CATALOG]})
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
# ---------------------------------------------------------------------------
# 塊の種別（§9.234 ⑤、利用者の指示「ラベル貼り付けエリアと同じタイプの
# エリア確保だけのタイプで文字を配置できる感じのものを追加してください」）
# ---------------------------------------------------------------------------
# ''＝ラベルと値の並び（今までの塊）／'エリア'＝**値を出さず場所を空けるだけ**
# の塊（ラベル貼付・手書き・確認印の欄）。置く文字は`[文字]`が持つ。
# **`[内容]`へ混ぜないこと**——あちらの保存形（`ラベル=出どころ`）は§9.226 ⑥で
# 「変えない」と決めてあり、混ぜると既に登録してある塊が読めなくなる。
# **語彙はここだけが持つ**（§9.163。画面へ書き写さない）。
AREA_KIND = 'エリア'
KIND_LABELS = (('', '項目の並び'), (AREA_KIND, 'エリア（枠と文字）'))
_KIND_BY_LABEL = {lb: v for v, lb in KIND_LABELS}
_LABEL_BY_KIND = {v: lb for v, lb in KIND_LABELS}


def normalize_kind(v):
    """種別の保存形。**知らない値は「項目の並び」へ倒す**（§9.215と同じ作法。
    例外にすると帳票ブロックマスタが丸ごと開けなくなる）。画面は文字列の
    選択欄しか持たないので、**呼び名でも受ける**（`enabledText`と同じ）。"""
    s = str(v or '').strip()
    if s in _KIND_BY_LABEL:
        s = _KIND_BY_LABEL[s]
    return s if s == AREA_KIND else ''


# ---------------------------------------------------------------------------
# 繰り返し（§9.247 ②、利用者の指示）
# ---------------------------------------------------------------------------
# 「帳票ブロックマスタに異幅分割ありのロットでロット番号が1ロット内に複数
#  混在するパターンにおいても各分割ロット単位ごとに統計データが出てくるように
#  対応をお願いします」
#
# 異幅分割のロットは、**1件の測定レコードの中に子ロットが複数**ある
# （`settings.splitGroups`。条を先頭から積んで区切る）。ところが塊は
# レコード1件につき1回しか描かれないので、`stat.*`（§9.242 ⑨）は
# **全部の条をまとめた1組**しか出せなかった——子ロットごとの板幅MIN/MAXを
# 紙に出す手立てが無い、というのが利用者の指摘。
#
# **塊のほうを子ロットの数だけ繰り返す**のがいちばん短い道。値の作り方
# （`rpStat`）も紙の組み方（`reportSection`）も既にあるものをそのまま使え、
# 「どの項目を出すか」は今までどおり`[内容]`が持つ。
#
# ''＝このロット全体（今までどおり）／'子ロット'＝分割後の子ロットごと。
# **分割の無いロットでは1回だけ**描く（＝今までと同じ）ので、設備の紙を
# 分割あり・無しで分ける必要が無い。
# **語彙はここだけが持つ**（§9.163。画面へ書き写さない）。
REPEAT_CHILD = '子ロット'
REPEAT_LABELS = (('', 'このロット全体（1回だけ）'),
                 (REPEAT_CHILD, '分割後の子ロットごと'))
_REPEAT_BY_LABEL = {lb: v for v, lb in REPEAT_LABELS}
_LABEL_BY_REPEAT = {v: lb for v, lb in REPEAT_LABELS}


# 繰り返しの向き（§9.277、利用者の指示「子ロット分縦に積む形が今までなので
# 縦に積むが標準で横に積むか」）。**既定は縦**——今までの見え方を変えない。
REPEAT_DIR_ROW = '横'
REPEAT_DIRS = (('', '縦に積む（既定）'), (REPEAT_DIR_ROW, '横に並べる'))
_REPEAT_DIR_BY_LABEL = {lb: v for v, lb in REPEAT_DIRS}
_LABEL_BY_REPEAT_DIR = {v: lb for v, lb in REPEAT_DIRS}


def normalize_repeat_dir(v):
    """繰り返しの向き。**知らない値は「縦」へ倒す**（`normalize_repeat`と同じ）。"""
    s = str(v or '').strip()
    if s in _REPEAT_DIR_BY_LABEL:
        s = _REPEAT_DIR_BY_LABEL[s]
    return s if s == REPEAT_DIR_ROW else ''


def normalize_repeat(v):
    """繰り返しの保存形。**知らない値は「1回だけ」へ倒す**（`normalize_kind`と
    同じ作法——例外にすると帳票ブロックマスタが丸ごと開けなくなる）。
    画面は文字列の選択欄しか持たないので、**呼び名でも受ける**。"""
    s = str(v or '').strip()
    if s in _REPEAT_BY_LABEL:
        s = _REPEAT_BY_LABEL[s]
    return s if s == REPEAT_CHILD else ''


# 種は (組み込みキー, 幅, 行数, 内訳列数, 内容, 種別, 文字)
BUILTIN_SEEDS = (
    ('ラベル貼付スペース', 3, 5, 0, '', AREA_KIND, 'ラベル貼付スペース'),
    ('基本情報', 6, 0, 0,
     'ロット番号=basic.lotNo\n検査番号=basic.inspectionNo\n鋳造番号=basic.castingNo\n'
     'オーダー番号=basic.orderNo\n引当番号=basic.allocationNo\n用途コード=basic.purposeCode\n'
     '用途名=basic.purposeName\n取引先=basic.customer\n納入先=basic.delivery', '', ''),
    ('コース情報', 3, 0, 1,
     '設計コース=basic.designCourse\n実績コース=basic.course\n残コース=basic.residualCourse', '', ''),
    ('寸法（オーダー／製造）', 4, 0, 0, '', '', ''),
    ('品質等級', 4, 0, 0, '', '', ''),
    ('品質情報（仕掛）', 4, 0, 0, '', '', ''),
    ('測定条件', 8, 0, 4,
     '登録設備=calc.equipment\n入力内容=settings.measureType\n丈位置=settings.lengthPos\n'
     '縦割数=settings.verticalCount\n横割数=settings.horizontalCount\n巻出方向=settings.unwind\n'
     '内径=settings.innerDiameter\nスプール=settings.spool\n板厚測定器=settings.thicknessGauge\n'
     '板幅測定器=settings.widthGauge\n条入力順=settings.widthOrder\n方向=settings.widthDirection\n'
     'バリ揃え=settings.burr\nコイル止め=calc.coilStop', '', ''),
    ('作業班構成', 4, 0, 0,
     'オペレータ=settings.operator\n検査員=settings.inspector\n梱包員=settings.packer\n'
     '作業人数=calc.crewSize', '', ''),
    ('母材実績／カード指示', 6, 0, 0, '', '', ''),
    ('丈別データ', 6, 0, 0, '', '', ''),
    ('板厚の測定データ', 12, 0, 0, '', '', ''),
    ('板幅ほかの測定データ', 12, 0, 0, '', '', ''),
    ('測定データ・板幅', 6, 0, 0, '', '', ''),
    ('測定データ・ラテラルボー', 4, 0, 0, '', '', ''),
    ('測定データ・バリ', 4, 0, 0, '', '', ''),
    ('測定データ・巻ずれ', 4, 0, 0, '', '', ''),
    ('測定データ・テレスコープ', 4, 0, 0, '', '', ''),
    ('測定データ・フラットネス', 4, 0, 0, '', '', ''),
    ('測定データ・備考', 4, 0, 0, '', '', ''),
    ('異常位置判定', 12, 0, 0, '', '', ''),
    ('作業時間', 6, 0, 0,
     '開始時刻=calc.workStart\n終了時刻=calc.workEnd\n実働時間=calc.workDuration', '', ''),
    ('登録状態', 6, 0, 0,
     '状態=calc.status\n更新日時=calc.updatedAt\nNG回数=settings.ngCount', '', ''),
    # 測定値の統計（§9.244）。中身の作り方が仕事になっている塊なので
    # `[内容]`は持たない（＝`CONTENT_EDITABLE`にも入らない）。**ここに載せる
    # のは、幅・高さ・出す/出さないをマスタで触れるようにするため**（§9.219 ②）
    # ——載せ忘れると`tests/test_rpmaster.js`が「マスタに無い塊」で落ちる。
    ('測定値の統計', 6, 0, 0, '', '', ''),
)
BUILTIN_KEYS = tuple(x[0] for x in BUILTIN_SEEDS)
# 組み込みキー → 種の`[内容]`と`[内訳列数]`（§9.285 ②）。
# **検証の後片付けがここを見る**（`tests/make_fixture.py`の`fix_master()`）
# ——既定の塊の中身は実行をまたいで残る（`db/master.sqlite3`はgit管理外）ので、
# 1本のテストが書き換えたまま落ちると、以降の紙がまるごと別物になる（§9.121）。
# **「触ってよいか」で絞らないこと**——§9.285 ②で`寸法（オーダー／製造）`等が
# 編集できるようになったため、`contentEditable`で絞る形では**新しく編集可能に
# した塊の置き土産だけが残る**（実際に残った）。
BUILTIN_CONTENT = {k: (content, cols)
                   for k, _s, _r, cols, content, _kd, _tx in BUILTIN_SEEDS}
# **中身をマスタで書き換えてよい塊**（＝ラベルと出どころを並べただけのもの）。
# ここに無い塊の`[内容]`は効かないので、画面は欄ごと出さずに理由を書く（§4）。
#
# **既定の中身を写せる塊も入る**（§9.285 ②）——`寸法（オーダー／製造）`
# などはコードが表を組み立てているので種を持てないが、`default_cells()`が
# 同じ形をマスの並びで答えられる。写した時点からはふつうの「ラベル＝
# 出どころ」の塊と同じように並び・書式・列数を触れる。
CONTENT_EDITABLE = (
    frozenset(k for k, _s, _r, _c, content, _kd, _tx in BUILTIN_SEEDS if content)
    | frozenset(DEFAULT_CELL_COLS))


# 1つの項目が横に何マス使うか（§9.245）。**1〜12**——内訳の列数は最大6だが、
# 「1マス」の意味は列数で決まるので、丸めは読む側（画面）が列数を見て行う。
SPAN_MIN, SPAN_MAX = 1, 12
# 縦に何マス使うか（§9.255 ②、利用者の指示「『紙での並び』の部分は単純に
# 何列何行だけでなく、データ内もグリッドに対応する形で細かく調整できる
# ようにしてください」）。**横と同じ数え方**——器の中のマス目の話なので、
# 上限も同じにしておく（紙そのものの段数＝`RP_PAGE_ROW_CHOICES`とは別物）。
ROWSPAN_MIN, ROWSPAN_MAX = 1, 12
# 節の中を何列で並べるか。**紙（`reportSection`）が受ける上限と同じ数**
# （§9.277）——以前はここだけ6で、ピボットに組むと列が足りずに黙って
# 6へ丸められていた（`対象`を行にすると「1＋項目×集計」で簡単に超える）。
CONTENT_COLS_MAX = 12


# ---------------------------------------------------------------------------
# 1つのマス（セル）が持つもの（§9.274、利用者の指示）
# ---------------------------------------------------------------------------
# 「板厚MIN、板厚MAX、板幅MIN、板幅MAX、板丈MIN、板丈MAXをブロックに設定して
#  表示させると、すべて横方向に、2段のカラムで並べられます。縦にも項目を
#  並べて、横も共通軸で並べたりすることでマトリクスも整形できるように
#  したいです」
#  「配置したデータの書式変更もできるようにしてください。数値の桁数、
#   日付の書式、文字列を寄せる方向など」
#
# 今まで1マスが持てたのは「ラベル・出どころ・横×縦のマス数」だけだった。
# 表（マトリクス）を組むには**軸の見出し**——値を持たず文字だけ出すマス——が
# 要る。共通の軸で並べたときはラベルが見出しと二重になるので、
# **ラベルを出さない**も要る。書式と寄せはそこに足す。
#
#   種別 value ＝ ラベルと値／head ＝ 見出し（文字だけ）／blank ＝ 空き
#
# **`blank`は今までどおり残す**——読む側（画面・紙）が`f.blank`で見ており、
# 消すと既に登録してある塊の空きマスが値のマスとして描かれる。
CELL_VALUE, CELL_HEAD, CELL_BLANK = 'value', 'head', 'blank'
CELL_KINDS = ((CELL_VALUE, '値（ラベルと値）'), (CELL_HEAD, '見出し（文字だけ）'),
              (CELL_BLANK, '空き（場所だけ取る）'))

# 寄せ。**一覧の`[値揃え]`（§9.239 ④）と同じ綴り**——2つの言葉を覚えさせない。
ALIGNS = (('', '自動'), ('left', '左'), ('center', '中央'), ('right', '右'))
_ALIGN_SET = frozenset(v for v, _lb in ALIGNS)

# 書式。**綴りは`WL.cellFormat`（`base.js`）と同じ**——値を整えるのは画面の
# その1箇所で、ここが持つのは「何が選べるか」だけ（§9.163）。別の綴りを
# 作ると、一覧の書式と帳票の書式で覚えることが2倍になる。
FORMAT_KINDS = (('', 'そのまま'), ('number', '数値'), ('datetime', '日付・時刻'),
                ('text', '文字'))
_FORMAT_SET = frozenset(v for v, _lb in FORMAT_KINDS if v)
# 日付の書式の見本。**選ばせるだけで、手で書いてもよい**（`WL.cellFormat`が
# 受ける綴りは`yyyy/MM/dd HH:mm`の形。ここで塞ぐと現場の書き方を狭める）。
DATE_PATTERNS = ('yyyy/MM/dd', 'yyyy/MM/dd HH:mm', 'yyyy-MM-dd', 'MM/dd',
                 'M月d日', 'yyyy年M月d日', 'HH:mm', 'HH:mm:ss')
DECIMAL_MAX = 6


def normalize_align(v):
    s = str(v or '').strip()
    return s if s in _ALIGN_SET else ''


def normalize_format(spec):
    """書式の指定を整える。**知らないものはNone（そのまま）へ倒す**
    （§9.215と同じ作法——例外にすると塊が丸ごと開けなくなる）。"""
    if not isinstance(spec, dict):
        return None
    kind = str(spec.get('kind') or '').strip()
    if kind not in _FORMAT_SET:
        return None
    pre = str(spec.get('prefix') or '')[:16]
    suf = str(spec.get('suffix') or '')[:16]
    if kind == 'number':
        dec = spec.get('decimals')
        if dec in (None, ''):
            dec = None
        else:
            try:
                dec = max(0, min(DECIMAL_MAX, int(dec)))
            except (TypeError, ValueError):
                dec = None
        out = {'kind': 'number', 'decimals': dec, 'thousands': bool(spec.get('thousands'))}
    elif kind == 'datetime':
        out = {'kind': 'datetime', 'pattern': str(spec.get('pattern') or '')[:40] or 'yyyy/MM/dd'}
    else:
        out = {'kind': 'text'}
    if pre:
        out['prefix'] = pre
    if suf:
        out['suffix'] = suf
    # **既定だけの指定は持たない**——「そのまま」と同じ意味の指定を保存すると、
    # 何も変えていない塊まで保存のたびに形が変わる（`fbText`と同じ約束）。
    if kind == 'text' and not pre and not suf:
        return None
    return out


def _cell(label='', path='', span=1, rows=1, kind=CELL_VALUE,
          show_label=True, align='', fmt=None, lot=False):
    span = max(SPAN_MIN, min(SPAN_MAX, int(span or 1)))
    rows = max(ROWSPAN_MIN, min(ROWSPAN_MAX, int(rows or 1)))
    label, path = str(label or '').strip(), str(path or '').strip()
    if kind == CELL_HEAD:
        path = ''
    elif kind == CELL_BLANK:
        label, path = '', ''
    elif not path:
        # 道を持たない「値」のマスは存在できない。**空きへ落とす**
        # （落とさないと、ラベルだけのマスが値の場所に「-」を出す）。
        kind, label = CELL_BLANK, ''
    return {'label': label, 'path': path, 'blank': kind == CELL_BLANK,
            'span': span, 'rows': rows, 'kind': kind,
            'showLabel': bool(show_label) if kind == CELL_VALUE else False,
            'align': normalize_align(align), 'format': normalize_format(fmt),
            # **対象（子ロット）の軸のマス**（§9.277）。ここに印が付いた
            # 並びだけを、紙が**1つの表の中で**子ロットの数だけ複製する
            # ——塊ごと繰り返す（縦に積む）今までの形と別の道。
            # 子ロットの数は**レコードごとに違う**ので、設計のときには
            # 1つぶんの型だけを置いておき、数は紙が決める。
            'lot': bool(lot)}


def _cell_from_json(x):
    if not isinstance(x, dict):
        return None
    kind = str(x.get('kind') or '').strip()
    if kind not in (CELL_VALUE, CELL_HEAD, CELL_BLANK):
        # **知らない種別は「値」へ倒す**（`blank`が真なら空き）。
        kind = CELL_BLANK if x.get('blank') else CELL_VALUE
    return _cell(label=x.get('label'), path=x.get('path'),
                 span=x.get('span'), rows=x.get('rows'), kind=kind,
                 show_label=x.get('showLabel', True),
                 align=x.get('align'), fmt=x.get('format'), lot=x.get('lot'))


def _rich(c):
    """行の形（`ラベル=道|横x縦`）では書けないマスか。"""
    return (c['kind'] == CELL_HEAD or (c['kind'] == CELL_VALUE and not c['showLabel'])
            or c['align'] or c['format'] or c.get('lot'))


def _cell_line(c):
    """1マスを行の形へ。**1マス・ラベルありのマスは今までどおりの1行**
    （`|1`を足さない）——書き足すと、何も変えていない塊まで保存のたびに
    形が変わる（`fbText`と同じ約束）。"""
    size = ''
    if c['rows'] > 1:
        size = '|%dx%d' % (c['span'], c['rows'])
    elif c['span'] > 1:
        size = '|%d' % c['span']
    if c['kind'] == CELL_BLANK:
        return '|' + (size[1:] if size else '1')
    return '%s=%s%s' % (c['label'] or c['path'], c['path'], size)


def dump_content(cells):
    """マスの並び → `[内容]`の文字列。

    **書ける限り今までの行の形で書く**（§9.226 ⑥「保存の形は変えない」）
    ——1つでも新しい持ちもの（見出し・ラベルを出さない・寄せ・書式）を
    使っているときだけJSONへ切り替える。こうすると、**触っていない塊の
    保存値は1バイトも変わらない**。"""
    cells = [c for c in (cells or []) if isinstance(c, dict)]
    if not cells:
        return ''
    if any(_rich(c) for c in cells):
        return json.dumps([{k: v for k, v in c.items() if k != 'blank'}
                           for c in cells], ensure_ascii=False)
    return '\n'.join(_cell_line(c) for c in cells)


def parse_content(text):
    """`ラベル=出どころ`の並びを読む。改行でもカンマでも区切れる。

    **壊れた行は1行だけ落とす**（§9.88の読み替えルールと同じ約束）——
    1行の書き間違いで塊ごと消えると、どこが悪いのか分からなくなる。
    `=`が無い行は「ラベルも道も同じ」として扱う（`basic.lotNo`だけ書いても
    出る）。

    ---- マトリクス配置（§9.245、利用者の指示） ----
    「ブロックごとにデータの配置をどのようなマトリクスに並べるか視覚的に
     調整できる機能が欲しいです」

    **保存の形は`ラベル=出どころ`のまま**（§9.226 ⑥）で、後ろに`|`で
    **横に使うマス数**を足せるようにした。`|`の無い行は今までどおり1マス
    ——既に登録してある塊はそのまま読める（**足すのは任意の後置きだけ**）。

        ロット番号=basic.lotNo|2   … 横2マスぶん使う
        ロット番号=basic.lotNo|2x3 … 横2マス×縦3マスぶん使う（§9.255 ②）
        |1                        … 空きマス（何も出さずに場所だけ取る）

    縦のマス数は`x`のうしろ。**`x`が無ければ縦1**なので、`|2`だけの
    古い保存値はそのまま読める。

    空きマスは**道もラベルも持たない行**で表す。`,`と`、`は区切りに使って
    いるので**マス数の区切りに使えない**（`|`にした理由）。

    ---- 見出し・書式・寄せ（§9.274） ----
    行の形では書けない持ちもの（見出しのマス・ラベルを出さない・寄せ・書式）を
    使う塊は**JSONの配列**で持つ。読む側は`[`で始まるかどうかだけで見分ける
    ——**書き方が2つに増えたことを利用者に見せない**（盤で組むので、綴りは
    誰も打たない）。壊れたJSONは行の形として読み直す（黙って空にしない）。"""
    s = str(text or '').strip()
    if s[:1] == '[':
        try:
            data = json.loads(s)
        except Exception:
            data = None
        if isinstance(data, list):
            out = [_cell_from_json(x) for x in data]
            return [c for c in out if c]
    out = []
    for raw in str(text or '').replace('、', ',').replace('\r', '\n').replace(',', '\n').split('\n'):
        s = raw.strip()
        if not s:
            continue
        span, rows = 1, 1
        if '|' in s:
            s, _, tail = s.partition('|')
            s = s.strip()
            # `<横>` か `<横>x<縦>`。**`x`が無ければ縦1**——`|2`だけの
            # 古い保存値がそのまま読める（§9.245の約束を壊さない）。
            wide, _, tall = str(tail).strip().lower().partition('x')
            try:
                span = max(SPAN_MIN, min(SPAN_MAX, int(wide.strip() or 1)))
            except (TypeError, ValueError):
                span = 1
            try:
                rows = max(ROWSPAN_MIN, min(ROWSPAN_MAX, int(tall.strip() or 1)))
            except (TypeError, ValueError):
                rows = 1
        if '=' in s:
            label, _, path = s.partition('=')
            label, path = label.strip(), path.strip()
        else:
            label, path = s, s
        if not path:
            # 空きマス。**落とさない**——場所を取ることが役目なので、
            # 消すとマトリクスが1マスずつ詰まって崩れる。
            out.append(_cell(span=span, rows=rows, kind=CELL_BLANK))
            continue
        out.append(_cell(label=label or path, path=path, span=span, rows=rows))
    return out


def _row(r):
    builtin = str(r[9] or '').strip()
    return {'id': r[0], 'equipment': str(r[1] or '').strip(),
            'name': str(r[2] or '').strip(), 'order': r[3],
            'span': normalize_span(r[4]), 'rows': normalize_rows(r[5]),
            'content': str(r[6] or ''),
            # **エリアの塊では項目として読ませない**（§9.234 ⑤）——読ませると
            # `rpMergeBuiltin`が節として描いてしまい、枠だけのはずの塊に
            # ラベルと「-」が並ぶ。
            'fields': ([] if normalize_kind(r[11] if len(r) > 11 else '') == AREA_KIND
                       else parse_content(r[6])),
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
            'contentEditable': (not builtin) or (builtin in CONTENT_EDITABLE),
            # 塊の種別（§9.234 ⑤）。'エリア'＝値を出さず場所を空けるだけの塊。
            # **画面から選べる形でも返す**（`enabledText`とまったく同じ作法）
            # ——マスタ管理の汎用フォームは文字列の選択欄しか持たない。
            'kind': normalize_kind(r[11] if len(r) > 11 else ''),
            'kindText': _LABEL_BY_KIND.get(normalize_kind(r[11] if len(r) > 11 else ''),
                                           _LABEL_BY_KIND['']),
            # エリアに置く文字（改行できる）。**値は入らない。**
            'text': str((r[12] if len(r) > 12 else '') or ''),
            # 繰り返し（§9.247 ②）。'子ロット'＝分割後の子ロットの数だけ描く。
            # **エリアの塊では繰り返さない**——値を出さない塊を子ロットの数だけ
            # 並べても、同じ枠が増えるだけ（§4。効かない設定を出さない）。
            'repeat': ('' if normalize_kind(r[11] if len(r) > 11 else '') == AREA_KIND
                       else normalize_repeat(r[13] if len(r) > 13 else '')),
            'repeatText': _LABEL_BY_REPEAT.get(
                normalize_repeat(r[13] if len(r) > 13 else ''), _LABEL_BY_REPEAT['']),
            # 繰り返しの向き（§9.277）。**繰り返さない塊では効かない**ので、
            # 画面は欄ごと出さずに理由を書く（§4）。
            'repeatDir': normalize_repeat_dir(r[14] if len(r) > 14 else ''),
            'repeatDirText': _LABEL_BY_REPEAT_DIR.get(
                normalize_repeat_dir(r[14] if len(r) > 14 else ''), _LABEL_BY_REPEAT_DIR[''])}


# 後から足した列（§9.180「無ければ足す」で移行する。共有DBは現場で動いて
# いるので作り直さない）。
_ADDED_COLUMNS = (
    ('組み込みキー', 'TEXT'),      # 既定の塊はどのコードの塊か（自作は空）
    ('内訳列数', 'INTEGER'),       # 節の中を何列で並べるか（0＝既定）
    ('種別', 'TEXT'),              # ''＝項目の並び／'エリア'＝場所を空けるだけ
    ('文字', 'TEXT'),              # エリアに置く文字（改行できる）
    ('繰返', 'TEXT'),              # ''＝1回だけ／'子ロット'＝分割後の子ロットごと
    ('繰返方向', 'TEXT'),          # ''＝縦に積む／'横'＝横に並べる（§9.277）
)


def _ensure_columns(c):
    cur = c.cursor()
    have = {r[1] for r in cur.execute(f'PRAGMA table_info([{TABLE}])')}
    added = False
    for name, kind in _ADDED_COLUMNS:
        if name not in have:
            cur.execute(f'ALTER TABLE [{TABLE}] ADD COLUMN [{name}] {kind}')
            added = True
    # **`[種別]`を足したその場だけ**、既にあるラベル貼付スペースの行を
    # エリアへ移す（§9.234 ⑤）。列は二度と追加されないので別の目印は要らない
    # ——**どの列を足したかを`added`の1つのboolで見分けないこと**（`[文字]`
    # だけが欠けている端末でも真になり、利用者が種別を変えた行を塗り潰す）。
    if '種別' not in have:
        cur.execute(f"UPDATE [{TABLE}] SET [種別]=?,"
                    "[文字]=COALESCE(NULLIF([文字],''),[ブロック名]) "
                    "WHERE [組み込みキー]='ラベル貼付スペース'", [AREA_KIND])
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
    for i, (key, span, rows, cols, content, kind, text) in enumerate(todo):
        cur.execute(f'INSERT INTO [{TABLE}] '
                    '([設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
                    '[組み込みキー],[内訳列数],[種別],[文字],'
                    '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                    "VALUES (?,?,?,?,?,?,'',-1,?,?,?,?,?,?,Now(),Now())",
                    ['*', key, base + (i + 1) * 10, span, rows, content, key, cols,
                     kind, text, 'migrate:seed', 'migrate:seed'])
    c.commit()
    return True


def ensure_table(c):
    if TABLE not in tables(c):
        cur = c.cursor()
        cur.execute('CREATE TABLE [帳票ブロックマスタ] ('
                    '[ブロックID] INTEGER PRIMARY KEY AUTOINCREMENT, [設備名] TEXT, '
                    '[ブロック名] TEXT, [表示順] INTEGER, [幅] INTEGER, [行数] INTEGER, '
                    '[内容] TEXT, [備考] TEXT, [有効] INTEGER, '
                    '[組み込みキー] TEXT, [内訳列数] INTEGER, [種別] TEXT, [文字] TEXT, '
                    '[登録者ID] TEXT, [更新者ID] TEXT, [登録日時] DATETIME, [更新日時] DATETIME)')
        c.commit()
        _seed_builtins(c)
        return True
    _ensure_columns(c)
    _seed_builtins(c)
    return False


_SELECT = ('SELECT [ブロックID],[設備名],[ブロック名],[表示順],[幅],[行数],[内容],[備考],[有効],'
           '[組み込みキー],[内訳列数],[種別],[文字],[繰返],[繰返方向] '
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
                 builtin=None, cols=None, kind=None, text=None, repeat=None,
                 repeat_dir=None):
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
    cur_kind = ''
    cur_text = ''
    cur_repeat = ''
    cur_repeat_dir = ''
    if block_id is not None:
        cur.execute(f'SELECT [組み込みキー],[内訳列数],[種別],[文字],[繰返],[繰返方向] '
                    f'FROM [{TABLE}] WHERE [ブロックID]=?', [int(block_id)])
        hit = cur.fetchone() or ['', 0, '', '', '', '']
        cur_builtin = str(hit[0] or '').strip()
        cur_cols = int(hit[1] or 0)
        cur_kind = normalize_kind(hit[2])
        cur_text = str(hit[3] or '')
        cur_repeat = normalize_repeat(hit[4] if len(hit) > 4 else '')
        cur_repeat_dir = normalize_repeat_dir(hit[5] if len(hit) > 5 else '')
    if builtin is None:
        builtin = cur_builtin
    builtin = str(builtin or '').strip()
    # **既定の塊と同じ名前の自作ブロックを作らせない**（§9.282、利用者の報告
    # 「帳票ブロックマスタでは正しく表示するのに紙は全然違う表を持ってくる」）。
    # 塊は**名前が鍵**（`k`）で、並び・幅・高さ・出す出さないは列レイアウト
    # マスタへその名前で入る（§9.113 と同じ理由）。同じ名前が2つあると
    # 紙はどちらを出すか決められず、**編集したのとは別の中身が出る**
    # ——実測では、ふつうのプレビューから既定の塊が消えて自作のほうが出た。
    # **入口で1回だけ落とす**（散らばった場所で気を付けない）。
    if not builtin and name in BUILTIN_KEYS:
        raise ValueError(
            f'「{name}」は画面がもともと持っている塊の名前です。'
            '同じ名前の塊を2つ置くと、紙がどちらを出すか決められません'
            '（並び・幅・高さは名前を鍵に覚えるため）。'
            '既定の塊を直したいならその行を編集し、別の塊なら違う名前を付けてください。')
    if cols is None:
        cols = cur_cols
    # **渡していなければ今の値を引き継ぐ**（§9.212 ②。全置換なので、呼ぶ側が
    # 1つ渡し忘れるとその設定だけが黙って消える）。
    kind = cur_kind if kind is None else normalize_kind(kind)
    text = cur_text if text is None else str(text or '')
    repeat = cur_repeat if repeat is None else normalize_repeat(repeat)
    repeat_dir = (cur_repeat_dir if repeat_dir is None
                  else normalize_repeat_dir(repeat_dir))
    try:
        cols = max(0, min(CONTENT_COLS_MAX, int(cols or 0)))
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
    # **新しい列は必ず末尾へ足す**（§9.234 ⑤）——下のUPDATEの1本は
    # `args[2:]`という**位置スライス**なので、途中へ入れると値が別の列へ入る。
    # SET・VALUES・argsの**4箇所**（UPDATE2本＋INSERT1本＋この行）を同じ順に。
    args = [equipment, name, order, normalize_span(span), normalize_rows(rows),
            str(content or ''), str(note or ''), -1 if enabled else 0, builtin, cols,
            kind, text, repeat, repeat_dir]
    if block_id is not None:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [設備名]=?,[ブロック名]=?,[表示順]=?,[幅]=?,'
                    '[行数]=?,[内容]=?,[備考]=?,[有効]=?,[組み込みキー]=?,[内訳列数]=?,'
                    '[種別]=?,[文字]=?,[繰返]=?,[繰返方向]=?,'
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
                    '[有効]=?,[組み込みキー]=?,[内訳列数]=?,[種別]=?,[文字]=?,[繰返]=?,'
                    '[繰返方向]=?,[更新者ID]=?,[更新日時]=Now() '
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
                '[組み込みキー],[内訳列数],[種別],[文字],[繰返],[繰返方向],'
                '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())', args + [uid, uid])
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
