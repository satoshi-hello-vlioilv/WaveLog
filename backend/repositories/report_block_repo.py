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
SAMPLE_VALUES = {
    'basic.lotNo': 'L240815-03',
    'basic.inspectionNo': 'K0241',
    'basic.castingNo': 'C7821',
    'basic.orderNo': 'ORD-24-00815',
    'basic.purposeName': '端子用条',
    'basic.customer': '○○電機株式会社',
    'basic.delivery': '△△工場 第2倉庫',
    'basic.material': 'C1020-1/2H',
    'basic.thickness': '0.300',
    'basic.width': '1250',
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
    'basic.orderWidth': '12.5',
    'basic.orderLength': '2000',
    'basic.mfgMaterial': 'C1020',
    'basic.mfgTemper': '1/2H',
    'basic.mfgThickness': '0.300',
    'basic.mfgWidth': '12.5',
    'basic.mfgLength': '2000',
    'settings.registeredEquipment': 'スリッター1号',
    'settings.measureType': '板厚',
    'settings.lengthPos': '中',
    'settings.verticalCount': '3',
    'settings.horizontalCount': '8',
    'settings.operator': '山田 太郎',
    'settings.inspector': '佐藤 花子',
    'settings.crewSize': '2',
    'settings.innerDiameter': '508',
    'settings.spool': 'S-12',
    # 組み込みの欄はどれも`settings.<キー>`（§9.215）。**選択肢マスタが
    # 空の端末でも見本が出るように**、ここでも1つずつ持つ。
    'settings.thicknessGauge': 'マイクロメータ-A',
    'settings.widthGauge': 'ノギス-B',
    'settings.unwind': '上巻',
    'settings.widthOrder': 'OS→DS',
    'settings.widthDirection': 'OS',
    'settings.burrAlign': 'バリ上',
    'settings.coilStop': 'テープ止め',
    # 母材の欄（§9.232）。単位はmmで、桁も実物に寄せる。
    'settings.motherOriginalWidth': '1250',
    'settings.motherScrapWidth': '18.0',
    'settings.motherCalcLength': '1980',
    'settings.motherManual': '1985',
    'settings.motherFullLength': '1980',
    'settings.motherMinCard': '1975',
    'settings.motherMaxCard': '1990',
    'settings.motherFront': '3.0',
    'settings.motherRear': '2.5',
    'settings.motherFrontCard': '3.0',
    'settings.motherRearCard': '2.5',
    'workTime.startAt': '2026-08-27 08:15',
    'workTime.endAt': '2026-08-27 11:40',
    'updatedAt': '2026-08-27 11:42',
    'calc.equipment': 'スリッター1号',
    'calc.coilStop': 'テープ止め',
    'calc.crewSize': '2名班',
    'calc.workStart': '2026-08-27 08:15',
    'calc.workEnd': '2026-08-27 11:40',
    'calc.workDuration': '3時間25分',
    'calc.status': '完了',
    'calc.updatedAt': '2026-08-27 11:42',
    'lot.no': 'L240815-03-2',
    'lot.range': '条 5〜8',
    'lot.strips': '4条',
    'lot.index': '2',
    'lot.count': '3',
}
# 統計は**項目ごとに桁が違う**（板厚は3桁・板幅は2桁・N数は整数）。
# 表で持つと項目を1つ足すたびに40行増えるので、項目の代表値と集計の作り方で持つ。
_STAT_SAMPLE = {
    'thickness': ('0.298', '0.302', '0.300', '0.004'),
    'width': ('12.48', '12.53', '12.50', '0.05'),
    'lateral': ('0.2', '0.8', '0.5', '0.6'),
    'burr': ('0.01', '0.03', '0.02', '0.02'),
    'telescope': ('0.5', '1.2', '0.8', '0.7'),
    'offset': ('0.3', '0.9', '0.6', '0.6'),
    'length': ('1998', '2002', '2000', '4'),
    'wall': ('1.48', '1.52', '1.50', '0.04'),
}
for _k, _vals in _STAT_SAMPLE.items():
    SAMPLE_VALUES[f'stat.{_k}.min'] = _vals[0]
    SAMPLE_VALUES[f'stat.{_k}.max'] = _vals[1]
    SAMPLE_VALUES[f'stat.{_k}.avg'] = _vals[2]
    SAMPLE_VALUES[f'stat.{_k}.span'] = _vals[3]
    SAMPLE_VALUES[f'stat.{_k}.n'] = '80'


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
_SAMPLE_LENGTHS = ('1(頭)', '中', '尾')
_SAMPLE_STRIPS = 8
_SAMPLE_SERIES = {
    # 鍵: (中心値, 1つずつずらす幅, 小数桁, 1丈あたりの本数)
    #     本数 None は「条の数だけ」（板厚だけが丈ごとに3点・§9.138）。
    'thickness': (0.300, 0.002, 3, 3),
    'width': (12.50, 0.02, 2, None),
    'lateral': (0.5, 0.1, 1, None),
    'burr': (0.02, 0.01, 2, None),
    'telescope': (0.8, 0.1, 1, None),
    'offset': (0.6, 0.1, 1, None),
}
# 子ロット（分割あり）。**合計は条数と合わせる**——合わないと、
# `rpSplitLots()`が数える条の範囲と実際の測定値の並びがずれる。
_SAMPLE_SPLIT = (('L240815-03-1', 3), ('L240815-03-2', 3), ('L240815-03-3', 2))


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
    st['verticalCount'] = len(_SAMPLE_LENGTHS)
    st['horizontalCount'] = _SAMPLE_STRIPS
    st['splitGroups'] = [{'lot': lot, 'count': n} for lot, n in _SAMPLE_SPLIT]
    # 母材は記録の鍵が `mother.<キー>`（§9.232。`settings.mother*`は
    # 操業データ項目としての道で、**どちらの道で組んだ塊もある**ので両方入れる）。
    rec['mother'] = {
        'fullLength': SAMPLE_VALUES.get('settings.motherFullLength', ''),
        'manual': SAMPLE_VALUES.get('settings.motherManual', ''),
        'minCard': SAMPLE_VALUES.get('settings.motherMinCard', ''),
        'maxCard': SAMPLE_VALUES.get('settings.motherMaxCard', ''),
        'front': SAMPLE_VALUES.get('settings.motherFront', ''),
        'rear': SAMPLE_VALUES.get('settings.motherRear', ''),
        'frontCard': SAMPLE_VALUES.get('settings.motherFrontCard', ''),
        'rearCard': SAMPLE_VALUES.get('settings.motherRearCard', ''),
    }
    # 品質等級（既定の塊が`x.qualityGrades`から読む）。**切断面は等級を入れる**
    # ——揃いの合否がここから出る（§9.204）ので、空だと「基準なし」になり、
    # 丈別データの合否欄が紙で確かめられない。
    rec['qualityGrades'] = {
        '生地外観': 'A', 'アルマイト': 'A', '表面処理': 'なし', '付着油': '有',
        '方向性': '指定なし', '強度': 'A', 'ラテラルボー': 'A', '直角度': 'A',
        '切断面': '3級', '板厚公差': 'A', '幅丈公差': 'A', 'フラットネス': 'A',
    }
    # 仕掛の生の行。**公差はここから読む**（`toleranceRangeLocal`）ので、
    # 入れないと測定値の表に公差の範囲が出ず、幅が実物と違って見える。
    rec['source'] = {
        '板厚公差_製造_プラス': 0.005, '板厚公差_製造_マイナス': 0.005,
        '板幅公差_製造_プラス': 0.05, '板幅公差_製造_マイナス': 0.05,
        '板厚公差_オーダー_プラス': 0.008, '板厚公差_オーダー_マイナス': 0.008,
        '板幅公差_オーダー_プラス': 0.08, '板幅公差_オーダー_マイナス': 0.08,
    }
    rec['qualityInfo'] = '異常情報なし'
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
    ms['flatness'] = [['〇'] * _SAMPLE_STRIPS for _ in _SAMPLE_LENGTHS]
    ms['comments'] = [[''] * _SAMPLE_STRIPS for _ in _SAMPLE_LENGTHS]
    rec['measurements'] = ms
    # 丈ごとのデータ（板丈・肉厚・揃い）。**丈位置の名前も入れる**——
    # 空だと「どの丈の行か」が紙で分からない。
    rec['product'] = {'rows': [{
        'productLength': ('%d' % (2000 + i)),
        'wallThickness': ('%.2f' % (1.50 + 0.01 * (i - 1))),
        'edgeShape': '揃い綺麗' if i == 0 else 'のこぎり状',
        'occurrencePosition': '' if i == 0 else '端部',
        'regularity': '' if i == 0 else '一定',
        'direction': '' if i == 0 else 'OS',
        'pitch': '' if i == 0 else '120',
        'alignmentValue': '' if i == 0 else '1.2',
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
            # 見本の値（§9.250 ⑤）。**行そのものから作る**——項目名も型も
            # 選択肢も現場が決めるので、道の表では持てない。
            row['sample'] = sample_for(row['path'], it)
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
                   'items': [{'label': l, 'path': p, 'sample': sample_for(p)}
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
# **中身をマスタで書き換えてよい塊**（＝ラベルと出どころを並べただけのもの）。
# ここに無い塊の`[内容]`は効かないので、画面は欄ごと出さずに理由を書く（§4）。
CONTENT_EDITABLE = frozenset(k for k, _s, _r, _c, content, _kd, _tx in BUILTIN_SEEDS if content)


# 1つの項目が横に何マス使うか（§9.245）。**1〜12**——内訳の列数は最大4だが、
# 「1マス」の意味は列数で決まるので、丸めは読む側（画面）が列数を見て行う。
SPAN_MIN, SPAN_MAX = 1, 12


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
        |1                        … 空きマス（何も出さずに場所だけ取る）

    空きマスは**道もラベルも持たない行**で表す。`,`と`、`は区切りに使って
    いるので**マス数の区切りに使えない**（`|`にした理由）。"""
    out = []
    for raw in str(text or '').replace('、', ',').replace('\r', '\n').replace(',', '\n').split('\n'):
        s = raw.strip()
        if not s:
            continue
        span = 1
        if '|' in s:
            s, _, tail = s.partition('|')
            s = s.strip()
            try:
                span = max(SPAN_MIN, min(SPAN_MAX, int(str(tail).strip() or 1)))
            except (TypeError, ValueError):
                span = 1
        if '=' in s:
            label, _, path = s.partition('=')
            label, path = label.strip(), path.strip()
        else:
            label, path = s, s
        if not path:
            # 空きマス。**落とさない**——場所を取ることが役目なので、
            # 消すとマトリクスが1マスずつ詰まって崩れる。
            out.append({'label': '', 'path': '', 'blank': True, 'span': span})
            continue
        out.append({'label': label or path, 'path': path, 'blank': False, 'span': span})
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
                normalize_repeat(r[13] if len(r) > 13 else ''), _LABEL_BY_REPEAT[''])}


# 後から足した列（§9.180「無ければ足す」で移行する。共有DBは現場で動いて
# いるので作り直さない）。
_ADDED_COLUMNS = (
    ('組み込みキー', 'TEXT'),      # 既定の塊はどのコードの塊か（自作は空）
    ('内訳列数', 'INTEGER'),       # 節の中を何列で並べるか（0＝既定）
    ('種別', 'TEXT'),              # ''＝項目の並び／'エリア'＝場所を空けるだけ
    ('文字', 'TEXT'),              # エリアに置く文字（改行できる）
    ('繰返', 'TEXT'),              # ''＝1回だけ／'子ロット'＝分割後の子ロットごと
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
           '[組み込みキー],[内訳列数],[種別],[文字],[繰返] '
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
                 builtin=None, cols=None, kind=None, text=None, repeat=None):
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
    if block_id is not None:
        cur.execute(f'SELECT [組み込みキー],[内訳列数],[種別],[文字],[繰返] FROM [{TABLE}] '
                    'WHERE [ブロックID]=?', [int(block_id)])
        hit = cur.fetchone() or ['', 0, '', '', '']
        cur_builtin = str(hit[0] or '').strip()
        cur_cols = int(hit[1] or 0)
        cur_kind = normalize_kind(hit[2])
        cur_text = str(hit[3] or '')
        cur_repeat = normalize_repeat(hit[4] if len(hit) > 4 else '')
    if builtin is None:
        builtin = cur_builtin
    builtin = str(builtin or '').strip()
    if cols is None:
        cols = cur_cols
    # **渡していなければ今の値を引き継ぐ**（§9.212 ②。全置換なので、呼ぶ側が
    # 1つ渡し忘れるとその設定だけが黙って消える）。
    kind = cur_kind if kind is None else normalize_kind(kind)
    text = cur_text if text is None else str(text or '')
    repeat = cur_repeat if repeat is None else normalize_repeat(repeat)
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
    # **新しい列は必ず末尾へ足す**（§9.234 ⑤）——下のUPDATEの1本は
    # `args[2:]`という**位置スライス**なので、途中へ入れると値が別の列へ入る。
    # SET・VALUES・argsの**4箇所**（UPDATE2本＋INSERT1本＋この行）を同じ順に。
    args = [equipment, name, order, normalize_span(span), normalize_rows(rows),
            str(content or ''), str(note or ''), -1 if enabled else 0, builtin, cols,
            kind, text, repeat]
    if block_id is not None:
        cur.execute('UPDATE [帳票ブロックマスタ] SET [設備名]=?,[ブロック名]=?,[表示順]=?,[幅]=?,'
                    '[行数]=?,[内容]=?,[備考]=?,[有効]=?,[組み込みキー]=?,[内訳列数]=?,'
                    '[種別]=?,[文字]=?,[繰返]=?,'
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
                    '[更新者ID]=?,[更新日時]=Now() '
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
                '[組み込みキー],[内訳列数],[種別],[文字],[繰返],'
                '[登録者ID],[更新者ID],[登録日時],[更新日時]) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,Now(),Now())', args + [uid, uid])
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
