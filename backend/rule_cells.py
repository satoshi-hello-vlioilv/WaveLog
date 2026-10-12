"""rule_cells.py: 判定表（条件表）の条件の語彙と、保存の前に整える関数（§9.588 で刃組から切り出した）。

判定表は「列＝データ・行＝決まり・右端＝答え、上から最初に当たった行」の表（§9.524・§9.529）。
刃組（保持方式・刃選択）と設備停止の挿入条件（§9.588）が同じ書き方の表を持つので、**語彙と整え方は
ここ1箇所**——表ごとに違うのは「どの列（データ）を受けるか」だけで、それは呼ぶ側が`field_ok`で渡す。
判定そのものは画面の`static/js/core/rule-cells.js`の1本（`firstRule()`）。ここは判定しない。
"""
# 比べ方。**表示ルールマスタと同じ綴り**（1つのアプリに2つの演算子の語彙を作らない）。
RULE_OPS = (
    ('eq', '＝'), ('ne', '≠'), ('ge', '≧'), ('gt', '＞'),
    ('le', '≦'), ('lt', '＜'), ('between', '範囲'), ('contains', '含む'),
    # §9.533（利用者の指示「＊＊＊で始まる、＊＊＊で終わるのような前方一致、や後方一致など様々な種類」）。
    ('startsWith', 'で始まる'), ('endsWith', 'で終わる'), ('notContains', '含まない'),
    ('notStartsWith', 'で始まらない'), ('notEndsWith', 'で終わらない'),
    ('empty', '空'), ('notEmpty', '空でない'), ('regex', '正規表現'),
)
RULE_OPS_2 = ('between',)            # 右辺を2つ取るもの
RULE_OPS_0 = ('empty', 'notEmpty')   # 右辺を持たないもの
COLS_MAX = 40
_VALUE_MAX = 120
_PREFIXED_MAX = 80


def _txt(v):
    return str(v if v is not None else '').strip()


def prefixed_field(field, prefix):
    """`<接頭辞><列名>`の形か（仕掛の列のように、名前がデータに依る列）。**字の形だけ**を見る。"""
    f = _txt(field)
    return (f.startswith(prefix) and len(f) > len(prefix) and len(f) <= _PREFIXED_MAX
            and not any(ch in f for ch in '[]\r\n\t'))


def normalize_conditions(raw, field_ok):
    """保存できる条件の配列へ整える。**壊れた条件は1件だけ落とす**（表示ルールマスタと同じ理由——1つの
    入力ミスで行ごと消えると、利用者からは「保存したのに戻っている」としか見えない）。`field_ok(field)`が
    真の列だけを受ける。"""
    if not isinstance(raw, list):
        return []
    ops = {o for o, _l in RULE_OPS}
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        field = _txt(item.get('field'))
        op = _txt(item.get('op'))
        if op not in ops or not field_ok(field):
            continue
        cond = {'field': field, 'op': op, 'value': '' if op in RULE_OPS_0 else _txt(item.get('value'))[:_VALUE_MAX]}
        if op in RULE_OPS_2:
            cond['value2'] = _txt(item.get('value2'))[:_VALUE_MAX]
        # 1つのセルの中の「または」（§9.533）。真の条件から次の組が始まる——**同じ列の前の条件があるときだけ**
        # （列の頭の`or`は意味を持たないので落とす）。
        if item.get('or') is True and any(c['field'] == field for c in out):
            cond['or'] = True
        out.append(cond)
    return out


def normalize_cols(raw, field_ok):
    """表の列（データ）の並び（§9.530）。**列の並びは表そのものの設定**で、条件の出てくる順からは起こさない。
    受ける列だけ・重ねず・`COLS_MAX`まで。"""
    if not isinstance(raw, list):
        return []
    out = []
    for f in raw:
        f = _txt(f)
        if field_ok(f) and f not in out:
            out.append(f)
    return out[:COLS_MAX]


def table_cols(stored, rows, field_ok):
    """表の列の並び。**保存した並び**を先に、条件にあるのに並びに無い列（前の版で保存した表）を後ろへ足す。"""
    cols = normalize_cols(stored, field_ok)
    for r in rows:
        for c0 in r.get('conditions') or []:
            if c0['field'] not in cols:
                cols.append(c0['field'])
    return cols
