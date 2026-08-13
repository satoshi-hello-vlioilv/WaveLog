#!/usr/bin/env python3
"""test_tablequery.py: /api/table の「要る列だけ」「先頭をまとめて」（§9.94）。

============================================================
なぜ要るか
------------------------------------------------------------
仕掛一覧の行ごとの追い判定（分割ありの子ロット確認・子カード行の親逆引き）
は、1行ごとに `/api/table` を投げていた。実データは200列を超えるため、
「そのロット番号が仕掛に居るか」を知りたいだけの問い合わせでも1回450KB。
1ページで67往復・約30MBになり、受け取ったJSONを解くたびに画面が数百ms
止まる——実機で「一覧に切り替えると固まる」と報告された症状の半分がこれ。

そこで問い合わせ側に2つ足した。

  columns=…     戻す列を絞る（**絞り込み・並べ替えの対象は絞らない**）
  starts_any    「この先頭のどれかで始まる」＝一族をまとめて1回で引く

ここで固定するのは4つ。
 1. columns= を付けると、その列だけが返る（列数もrowsのキーも）
 2. columns= は**返す量にだけ効く**（指定しなかった列で絞り込める）
 3. starts_any が複数の先頭にまたがって当たる（1件ずつと同じ結果になる）
 4. 壊れた指定で落ちない（空・実在しない列は素通し / 上限で頭打ち）
============================================================
"""
import pathlib, sys, json

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as flask_app          # noqa: E402
from backend import db_access    # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))

client = flask_app.app.test_client()
DB = db_access.WORK_DB_KEY or 'SIKALOTNOW'


def get(**params):
    q = '&'.join(f'{k}={v}' for k, v in params.items())
    r = client.get(f'/api/table?db={DB}&{q}')
    return r.status_code, (r.get_json() or {})


def main():
    st, base = get(table='仕掛', page=1, page_size=50, include_hidden=1)
    if st != 200:
        rec('仕掛を読める（この検証の前提）', False, json.dumps(base, ensure_ascii=False)[:200])
        return
    cols = base['columns']
    rec('仕掛を読める（この検証の前提）', len(cols) > 3 and len(base['rows']) > 0,
        f'{len(cols)}列 / {len(base["rows"])}行')

    lot = next((c for c in cols if 'ﾛｯﾄ' in c or 'ロット' in c), cols[0])
    other = next(c for c in cols if c != lot)

    # ---- 1. columns= を付けるとその列だけが返る ----
    st, d = get(table='仕掛', page=1, page_size=5, include_hidden=1, columns=lot)
    rec('columns= で指定した列だけが返る', st == 200 and d['columns'] == [lot],
        json.dumps(d.get('columns'), ensure_ascii=False))
    keys = set().union(*[set(r) for r in d['rows']]) if d.get('rows') else set()
    rec('行の中身も指定した列だけになる（量が減るのが目的）', keys == {lot},
        json.dumps(sorted(keys), ensure_ascii=False)[:120])
    rec('件数は絞られない（表示する列の話でしかない）', d.get('count') == base.get('count'),
        f'{d.get("count")} / {base.get("count")}')

    # ---- 2. 絞り込みは「返さない列」でも効く ----
    val = str(base['rows'][0][other])
    filt = json.dumps([{'column': other, 'op': 'eq', 'value': val}], ensure_ascii=False)
    st, d = get(table='仕掛', page=1, page_size=50, include_hidden=1,
                columns=lot, filters=filt)
    st2, d2 = get(table='仕掛', page=1, page_size=50, include_hidden=1, filters=filt)
    rec('返さない列でも絞り込みは効く（columns=は戻す量にだけ効く）',
        st == 200 and d.get('count') == d2.get('count') and d.get('count', 0) >= 1,
        f'{d.get("count")} / {d2.get("count")}')

    # ---- 3. starts_any は複数の先頭をまとめて拾う ----
    lots = [str(r[lot]) for r in base['rows'] if r.get(lot)]
    p1, p2 = lots[0][:3], next((x[:3] for x in lots if x[:3] != lots[0][:3]), lots[0][:3])
    one = []
    for p in {p1, p2}:
        f = json.dumps([{'column': lot, 'op': 'starts', 'value': p}], ensure_ascii=False)
        _, dd = get(table='仕掛', page=1, page_size=500, include_hidden=1, columns=lot, filters=f)
        one += [str(r[lot]) for r in dd.get('rows', [])]
    f = json.dumps([{'column': lot, 'op': 'starts_any', 'value': ','.join({p1, p2})}],
                   ensure_ascii=False)
    st, many = get(table='仕掛', page=1, page_size=500, include_hidden=1, columns=lot, filters=f)
    got = sorted(str(r[lot]) for r in many.get('rows', []))
    rec('starts_any は1件ずつ引いた結果と同じになる', st == 200 and got == sorted(set(one)),
        f'まとめて{len(got)}件 / 1件ずつ{len(set(one))}件')
    rec('starts_any は実際に絞れている（全件ではない）',
        0 < len(got) < base.get('count', 0), f'{len(got)} / {base.get("count")}')

    # ---- 4. 壊れた指定で落ちない ----
    st, d = get(table='仕掛', page=1, page_size=5, include_hidden=1, columns='存在しない列')
    rec('実在しない列だけを頼まれたら素通しする（空の表を返さない）',
        st == 200 and len(d.get('columns', [])) == len(cols), f'{st} / {len(d.get("columns", []))}列')
    f = json.dumps([{'column': lot, 'op': 'starts_any', 'value': ''}], ensure_ascii=False)
    st, d = get(table='仕掛', page=1, page_size=5, include_hidden=1, filters=f)
    rec('starts_any の値が空でも落ちない（0件でよい）',
        st == 200 and d.get('count') == 0, f'{st} / {d.get("count")}')

    # ---- 5. 結合した列は「名前」も返す(§9.105) ----
    # 列の設定画面が「どれが結合されてきた列か」を見分けるのに使う。
    # **件数(addedColumns)だけでは足りない**——数は分かっても、どの項目が
    # よそから来たのかは名前が無いと言えない。結合できたかどうかは環境に
    # よるので、できたときだけ中身を確かめる(できないこと自体は
    # 品質データ結合側の検証が受け持つ)。
    st, d = get(table='仕掛', page=1, page_size=5, include_hidden=1, join_quality=1)
    info = (d or {}).get('joinQuality') or {}
    rec('join_quality=1 は結合の診断情報を返す', st == 200 and isinstance(info, dict) and 'applied' in info,
        json.dumps(info, ensure_ascii=False)[:160])
    if info.get('applied'):
        names = info.get('addedColumnNames')
        rec('結合で足した列の名前を返す（件数と一致する）',
            isinstance(names, list) and len(names) == info.get('addedColumns'),
            f'{info.get("addedColumns")}列 / {type(names).__name__}')
        cs = d.get('columns') or []
        rec('返した名前は実際に列として並んでいる',
            bool(names) is False or all(n in cs for n in names),
            ','.join((names or [])[:4]))
    else:
        rec('結合できないときも理由が付く（名前が無いのは想定どおり）',
            bool(info.get('reason')), str(info.get('reason'))[:120])

    # ---- 5) 列名は必ず一意（§9.113） ----
    # **画面は列を名前で引く**(見出し・幅・書式・読み替え・並び順)。同じ名前が
    # 2つ返ると見出しもセルも二重に描かれ、実機で「カラムが増殖した」と
    # 報告された形になる。行はdictなので**どのみち1つしか持てない**——
    # 列だけ2つあると本数が食い違う。ここは絞り込み・並べ替え・結合の
    # どの組み合わせでも崩れてはいけない。
    for label, kw in (("素の一覧", {}),
                      ('絞り込みあり', {'q': 'A'}),
                      ('並べ替えあり', {'sort': cols[0], 'sort_dir': 'desc'}),
                      ('絞り込み＋並べ替え', {'q': 'A', 'sort': cols[0], 'sort_dir': 'desc'}),
                      ('結合あり', {'join_quality': 1}),
                      ('結合＋絞り込み＋並べ替え',
                       {'join_quality': 1, 'q': 'A', 'sort': cols[0], 'sort_dir': 'desc'})):
        st, d = get(table='仕掛', page=1, page_size=5, include_hidden=1, **kw)
        cs = (d or {}).get('columns') or []
        seen, dupes = set(), []
        for n in cs:
            if n in seen:
                dupes.append(n)
            seen.add(n)
        rec(f'列名が重複しない（{label}）', st == 200 and not dupes,
            f'{len(cs)}列' + (f' / 重複 {dupes[:4]}' if dupes else ''))
        # 行のキーは列の部分集合であること（列だけ増えていないことの裏取り）。
        rows = (d or {}).get('rows') or []
        extra = sorted({k for r in rows for k in r} - set(cs))
        rec(f'行のキーが列に無い、が起きない（{label}）', not extra, str(extra[:4]))

    # 重複した列名を渡したら1つに畳むこと（この関数が実際の防波堤）。
    from backend.routes.tables import _unique_columns
    rec('_unique_columns は重複を落として順序を保つ',
        _unique_columns(['a', 'b', 'a', 'c', 'b']) == ['a', 'b', 'c'],
        str(_unique_columns(['a', 'b', 'a', 'c', 'b'])))

    # **本物の重複を注ぎ込んで確かめる。** 検証用DBの列名は重なっていない
    # ので、上の「重複しない」は直す前でも通ってしまう(通るだけの網は
    # 何も確かめていない)。列名の出どころ(cols()のキャッシュ)へ同じ名前を
    # 2つ入れ、それでもAPIが一意で返すことを見る。実データでは、品質側が
    # ビューで同名の列を持っていた場合などにこの形になる。
    from backend import db_access as _dba
    key = None
    with _dba._cols_cache_lock:
        for k in list(_dba._cols_cache):
            if k[1] == '仕掛':
                key = k
                break
    if key:
        with _dba._cols_cache_lock:
            ts, orig = _dba._cols_cache[key]
            _dba._cols_cache[key] = (ts, list(orig) + [orig[0]])   # 先頭の列名をもう1つ
        try:
            st, d = get(table='仕掛', page=1, page_size=3, include_hidden=1)
            cs = (d or {}).get('columns') or []
            rec('同じ列名が2つ来ても一覧は1つに畳む（注入して確認）',
                st == 200 and cs.count(orig[0]) == 1,
                f'{orig[0]} × {cs.count(orig[0])}')
        finally:
            with _dba._cols_cache_lock:
                _dba._cols_cache[key] = (ts, list(orig))
    else:
        rec('同じ列名が2つ来ても一覧は1つに畳む（注入して確認）', False,
            'cols()のキャッシュに仕掛が見つからず、注入できなかった')

    ng = [x for x in R if not x[1]]
    print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
    sys.exit(1 if ng else 0)


main()
