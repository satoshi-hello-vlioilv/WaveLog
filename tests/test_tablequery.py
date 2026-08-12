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

    ng = [x for x in R if not x[1]]
    print(f'\n== {len(R) - len(ng)}/{len(R)} PASS ==')
    sys.exit(1 if ng else 0)


main()
