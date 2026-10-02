#!/usr/bin/env python3
"""test_lfpoints.py: 換算係数の1件ごとの実績と見積（§9.543、利用者の選択 H-1＋H-5＋H-2）。

============================================================
ここで固定すること（サーバー不要・実績の読み込みは差し替える）
------------------------------------------------------------
 1. 外れ値の判定は`outlier_flags()`の1箇所: 推定（`_fit`）が除いた件数と、点が「外れ値」と名乗る件数が同じ
 2. 点の見積は**予定と同じ`estimate_work()`**: 基準時間×係数の掛け算（網で独立に計算）と一致し、内訳の積も一致する
 3. 手動上書きが点の見積にも効く（上書きを保存し直せば点が動く）
 4. 要約（±20%に入った割合・実績÷見積の中央値・80%の帯・帯に入った数・外れ値の数）が網の正解と一致する
 5. 点は新しい順・`POINTS_MAX`まで（要約は全件で数える）。モデルが無ければ空
 6. 因子の呼び名（`FACTOR_LABELS`）が因子を全部覆う
============================================================
"""
import math, pathlib, random, statistics, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import load_factor as lf  # noqa: E402

R = []
def rec(name, ok, detail=''):
    R.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ': ' + name + ((' -- ' + detail) if detail else ''))


def rows_sample():
    rnd = random.Random(5)
    out = []
    for i in range(60):
        p = rnd.choice(['一般', '自動車', '電機'])
        th = rnd.choice([0.2, 0.25, 0.4, 0.6, 0.9, 1.2])
        hc = rnd.choice([6, 12, 20, 30])
        crew = rnd.choice(['2', '3'])
        m = 40 * {'一般': 1, '自動車': 1.2, '電機': 0.9}[p] * (1.2 if th < 0.3 else 0.85 if th > 0.8 else 1) \
            * (1.3 if hc > 25 else 1) * math.exp(rnd.gauss(0, 0.18))
        if i % 17 == 5:
            m *= 3.2
        out.append({'minutes': round(m, 1), 'equipment': 'E', 'crewSize': crew,
                    'basic': {'lotNo': f'L{i:03d}', 'purposeName': p, 'mfgThickness': str(th), 'boxHorizontalCount': str(hc)},
                    'lot': f'L{i:03d}', 'at': f'2026-07-{1 + i // 3:02d}T{8 + i % 3:02d}:00:00'})
    return out


def truth_estimate(model, row, overrides):
    est = overrides.get(('BASE', ''), model['T0'])
    for key in lf.FACTOR_KEYS:
        raw = row['crewSize'] if key == 'crewSize' else row['basic'].get(key)
        if key == 'crewSize' and raw in (None, '', '-'):
            raw = model.get('crewSizeMode')
        level = lf.level_for(key, raw, model['boundaries'])
        if level is None:
            continue
        est *= overrides.get((key, level), model['factors'].get(key, {}).get(level, 1.0))
    return est


ROWS = rows_sample()
MODEL = lf._fit(ROWS)
MODEL.update(basis='equipment', equipment='E')
orig = (lf.completed_training_rows, lf.get_model, lf.resolve_overrides, lf.POINTS_MAX)
OV = {}
try:
    lf.completed_training_rows = lambda equipment=None: [dict(r) for r in ROWS]
    lf.get_model = lambda equipment, force=False: MODEL
    lf.resolve_overrides = lambda c, equipment: dict(OV)

    got = lf.points(None, 'E')
    pts = got['points']
    # 1) 外れ値の判定は1箇所
    rec('外れ値: 点が名乗る数＝推定が除いた数（判定は outlier_flags の1箇所）',
        sum(p['outlier'] for p in pts) == MODEL['excluded'] and MODEL['excluded'] > 0,
        f"{sum(p['outlier'] for p in pts)} / {MODEL['excluded']}")
    # 2) 見積は estimate_work と同じ
    by_lot = {r['lot']: r for r in ROWS}
    bad = [p['lot'] for p in pts if abs(p['estimate'] - round(truth_estimate(MODEL, by_lot[p['lot']], {}), 1)) > 0.051]
    rec('点の見積＝基準時間×係数（網で独立に計算）', not bad and len(pts) == len(ROWS), ','.join(bad[:4]))
    prod_bad = [p['lot'] for p in pts if abs(p['base'] * math.prod(f['value'] for f in p['factors']) - p['estimate']) > 0.3]
    rec('点の内訳（基準時間×係数の積）が見積に一致する（積み上げの材料）', not prod_bad, ','.join(prod_bad[:4]))
    rec('実績は分のまま（丸めは0.1分）', all(abs(p['actual'] - round(by_lot[p['lot']]['minutes'], 1)) < 1e-9 for p in pts))
    # 3) 上書きが点にも効く
    OV = {('purposeName', '自動車'): 1.5}
    got2 = lf.points(None, 'E')
    car = [p for p in got2['points'] if by_lot[p['lot']]['basic']['purposeName'] == '自動車']
    rec('手動上書きが点の見積にも効く（自動車を×1.5）',
        car and all(abs(p['estimate'] - round(truth_estimate(MODEL, by_lot[p['lot']], OV), 1)) <= 0.051 for p in car)
        and all(any(f['source'] == 'override' for f in p['factors']) for p in car), str(len(car)))
    OV = {}
    # 4) 要約
    live = [p for p in pts if not p['outlier']]
    logs = [math.log(p['actual'] / p['estimate']) for p in live]
    band = math.exp(lf.BAND_Z * MODEL['sigmaLog'])
    s = got['summary']
    want = {'n': len(live), 'outliers': len(pts) - len(live),
            'within20': round(sum(1 for p in live if abs(p['actual'] / p['estimate'] - 1) <= 0.2) / len(live), 4),
            'ratio': round(math.exp(statistics.median(logs)), 4), 'band': round(band, 4),
            'inBand': sum(1 for x in logs if abs(x) <= math.log(band))}
    rec('要約（±20%・中央値・80%の帯・帯に入った数・外れ値）が正解と一致する',
        all(s.get(k) == v for k, v in want.items()), str({k: (s.get(k), v) for k, v in want.items() if s.get(k) != v}))
    # 5) 並びと上限・モデル無し
    ats = [p['at'] for p in pts]
    rec('点は新しい順', ats == sorted(ats, reverse=True))
    lf.POINTS_MAX = 10
    got3 = lf.points(None, 'E')
    rec('点は POINTS_MAX まで・要約は全件で数える', len(got3['points']) == 10 and got3['summary']['total'] == len(ROWS)
        and got3['summary']['n'] == want['n'], str(got3['summary']))
    lf.get_model = lambda equipment, force=False: None
    rec('モデルが無ければ点も要約も無い', lf.points(None, 'E') == {'points': [], 'summary': None})
finally:
    lf.completed_training_rows, lf.get_model, lf.resolve_overrides, lf.POINTS_MAX = orig

# 6) 呼び名
rec('因子の呼び名が因子を全部覆う（画面へ英字のキーを出さない）',
    set(lf.FACTOR_LABELS) == set(lf.FACTOR_KEYS) and all(v[0] for v in lf.FACTOR_LABELS.values()))

fails = [r for r in R if not r[1]]
print(f'\n{len(R) - len(fails)} PASS / {len(fails)} FAIL')
sys.exit(1 if fails else 0)
