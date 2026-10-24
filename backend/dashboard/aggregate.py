# -*- coding: utf-8 -*-
"""集計の値の決め方（版 3.39.0。services/pivot.py の値〈measures〉の 1 か所）。

値の種類（agg）は、ためる物で 4 つに分かれる（要る物だけをためる。1 つの値に 1 つの器 Acc）:
    数え方   … count（行の数）・lots（ロット数: pivot がロットの鍵の集まりで数える）
    足し算   … sum・avg・min・max・n（数に読める値の数）・range（最大−最小）
    ばらつき … sd（標準偏差。標本）・var（分散）・cv（変動係数 %）・cpk（工程能力。規格 lsl・usl） … Welford の方法で平均と偏差の 2 乗の和をためる
               （大きな値の小さな差でも桁が落ちない）
    並び     … median（中央値）・q1（25% 点）・q3（75% 点）・iqr（四分位範囲）・pct（p% 点。p は 1〜99）・mode（最頻値） … 値の並びをためる
    種類     … distinct（種類の数。数に限らず、どの列でも。空欄は数えない）
    比       … ratio（合計の比＝列の合計 ÷ per の列の合計。§9.630: 生産性＝良品重量の合計 ÷ 作業時間の合計。
               1 行ずつの比の平均にしない＝短い作業の比が効きすぎる。両方が数に読める行だけを足す）
表し方（show。値ごと）: ""（そのまま）・pct_total（総計に対する %）・pct_row（行の計に対する %）・pct_col（列の計に対する %）・
    cum（累計）・diff（前との差）・rank（順位。大きい順に 1〜） … 数え終えたセルの値から決める（apply_show）。
    累計・差・順位は、同じ親（1 つ上の段の鍵）の中で、行の並び（orders）の順に決める
桁（dec。値ごと。版 3.50.1）: 小数の桁 0〜6。値は丸めず、見せる字だけをその桁にそろえる（表・グラフ・Excel の表示形式。Excel のセルの書式と同じ考え）。
計算（expr。値ごと。版 3.50.0）: 数え終えたセルの値に四則演算を当てる（÷1000・×100・(値−10)×2 など。services/num_expr.py）。
    小計・総計のセルにも同じ式を当てる。表し方（割合・累計など）は、計算した後の値から決める（apply_expr → apply_show）
"""
from __future__ import annotations

import math
from collections import Counter

from . import num_expr

COUNTS = ("count", "lots")
SIMPLE = ("sum", "avg", "min", "max", "n", "range")
SPREAD = ("sd", "var", "cv", "cpk")
ORDERED = ("median", "q1", "q3", "iqr", "pct", "mode")
KINDS = ("distinct",)
RATIOS = ("ratio",)
AGGS = COUNTS + SIMPLE + SPREAD + ORDERED + KINDS + RATIOS
NUMERIC = SIMPLE + SPREAD + ORDERED + RATIOS  # 数の列が要る
ADDITIVE = ("count", "lots", "sum", "n")     # 下の段から足し上げられる（積み上げ・割合・ドーナツに使える）
SHOWS = ("", "pct_total", "pct_row", "pct_col", "cum", "diff", "rank")
LABEL = {"count": "件数", "lots": "ロット数", "sum": "合計", "avg": "平均", "min": "最小", "max": "最大", "n": "個数", "range": "範囲",
         "sd": "標準偏差", "var": "分散", "cv": "変動係数(%)", "cpk": "Cpk", "median": "中央値", "q1": "25%点", "q3": "75%点",
         "iqr": "四分位範囲", "pct": "%点", "mode": "最頻値", "distinct": "種類の数", "ratio": "合計の比"}
EXPR_MAX = 60
DEC_MAX = 6
SHOW_LABEL = {"pct_total": "総計に対する%", "pct_row": "行の計に対する%", "pct_col": "列の計に対する%", "cum": "累計", "diff": "前との差", "rank": "順位"}


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def clean(m, has_column):
    """画面から来た値 → {agg, column, p?, lsl?, usl?, show?, expr?}。has_column(列) → その列があるか。合わなければ ValueError（理由の字）"""
    agg = str(m.get("agg") or "count")
    if agg not in AGGS:
        agg = "count"
    col = str(m.get("column") or "") if agg not in COUNTS else ""
    if agg not in COUNTS and not has_column(col):
        raise ValueError(f"値の列「{col}」がありません。")
    out = {"agg": agg, "column": col}
    if agg == "pct":
        p = _num(m.get("p"))
        out["p"] = int(min(99, max(1, round(p)))) if p is not None else 90
    if agg == "cpk":
        lsl, usl = _num(m.get("lsl")), _num(m.get("usl"))
        if lsl is None and usl is None:
            raise ValueError(f"「{col}」の Cpk には、規格の下限か上限が要ります。")
        if lsl is not None and usl is not None and lsl >= usl:
            raise ValueError(f"「{col}」の Cpk の規格は、下限 < 上限にしてください。")
        out.update({k: v for k, v in (("lsl", lsl), ("usl", usl)) if v is not None})
    if agg == "ratio":
        per = str(m.get("per") or "")
        if not has_column(per):
            raise ValueError(f"「{col}」の合計の比には、割る列（per）が要ります（「{per}」がありません）。")
        out["per"] = per
    show = str(m.get("show") or "")
    if show in SHOWS and show:
        out["show"] = show
    expr = str(m.get("expr") or "").strip()[:EXPR_MAX]
    if expr:
        _fn, err, _text = num_expr.compile_expr(expr)
        if err:
            raise ValueError(f"「{name(out)}」の計算「{expr}」が読めません（{err}）。")
        out["expr"] = expr
    dec = _num(m.get("dec"))
    if dec is not None:
        out["dec"] = int(min(DEC_MAX, max(0, round(dec))))
    return out


def name(m):
    """値の見せる名前（件数・ロット数・〇〇の平均・〇〇の90%点・〇〇の平均（累計））"""
    agg = m["agg"]
    base = LABEL[agg] if agg in COUNTS else f"{m['column']}÷{m.get('per', '')}" if agg == "ratio" else f"{m['column']}の{m['p'] if agg == 'pct' else ''}{LABEL[agg]}"
    return base + (f"（{SHOW_LABEL[m['show']]}）" if m.get("show") else "") + (f"［{expr_text(m['expr'])}］" if m.get("expr") else "")


def expr_text(expr):
    """計算の見せ方（÷1000 → 値÷1000）。画面の measLabel と同じ字"""
    return num_expr.compile_expr(expr)[2] or str(expr)


def apply_expr(cells, measures):
    """計算（expr）を当てる。cells … [{r, c, v}]。数でない値（None・字）はそのまま"""
    fns = [(j, num_expr.compile_expr(m["expr"])[0]) for j, m in enumerate(measures) if m.get("expr")]
    fns = [(j, f) for j, f in fns if f]
    for x in cells if fns else ():
        for j, f in fns:
            v = x["v"][j]
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                x["v"][j] = f(v)
    return cells


class Acc:
    """1 つのセル・1 つの値の器（値の種類で、ためる物を決める）"""
    __slots__ = ("agg", "n", "sum", "lo", "hi", "mean", "m2", "vals", "kinds", "den")

    def __init__(self, agg):
        self.agg = agg
        self.n, self.sum, self.lo, self.hi, self.mean, self.m2, self.den = 0, 0.0, None, None, 0.0, 0.0, 0.0
        self.vals = [] if agg in ORDERED else None
        self.kinds = set() if agg == "distinct" else None

    def add(self, f, raw=None, den=None):
        """f … 数に読めた値（読めなければ None）・raw … 元の値（種類の数）・den … 合計の比の割る列の値（数に読めた物か None）"""
        if self.agg == "ratio":
            if f is not None and den is not None:
                self.n += 1
                self.sum += f
                self.den += den
            return
        if self.kinds is not None:
            t = "" if raw is None else str(raw).strip()
            if t:
                self.kinds.add(t)
            return
        if f is None:
            return
        self.n += 1
        self.sum += f
        self.lo = f if self.lo is None or f < self.lo else self.lo
        self.hi = f if self.hi is None or f > self.hi else self.hi
        d = f - self.mean
        self.mean += d / self.n
        self.m2 += d * (f - self.mean)
        if self.vals is not None:
            self.vals.append(f)

    def _sd(self):
        return math.sqrt(self.m2 / (self.n - 1)) if self.n > 1 else None

    def value(self, m):
        agg = self.agg
        if agg == "distinct":
            return len(self.kinds)
        if agg == "n":
            return self.n
        if not self.n:
            return None
        if agg == "sum":
            return self.sum
        if agg == "ratio":
            return self.sum / self.den if self.den else None
        if agg == "avg":
            return self.sum / self.n
        if agg == "min":
            return self.lo
        if agg == "max":
            return self.hi
        if agg == "range":
            return self.hi - self.lo
        if agg in ("sd", "var", "cv", "cpk"):
            sd = self._sd()
            if sd is None:
                return None
            if agg == "sd":
                return sd
            if agg == "var":
                return sd * sd
            if agg == "cv":
                return sd / abs(self.mean) * 100 if self.mean else None
            if not sd:
                return None
            sides = [(m["usl"] - self.mean) / (3 * sd)] if "usl" in m else []
            sides += [(self.mean - m["lsl"]) / (3 * sd)] if "lsl" in m else []
            return min(sides)
        xs = sorted(self.vals)
        if agg == "mode":
            c = Counter(xs)
            top = max(c.values())
            return min(x for x, k in c.items() if k == top)
        q = {"median": 0.5, "q1": 0.25, "q3": 0.75, "pct": m.get("p", 90) / 100}.get(agg)
        if q is not None:
            return quantile(xs, q)
        return quantile(xs, 0.75) - quantile(xs, 0.25)      # iqr


def quantile(xs, p):
    """並べた値の p 点（両端を含む直線の補い。Excel の PERCENTILE.INC と同じ。pivot.describe と同じ決め方）"""
    i = (len(xs) - 1) * p
    lo = math.floor(i)
    return xs[lo] + (xs[min(lo + 1, len(xs) - 1)] - xs[lo]) * (i - lo)


def apply_show(cells, measures, nr, nc, orders):
    """表し方（show）を当てる。cells … [{r, c, v}]（v は値ごとの並び）。orders … 段ごとの鍵の並び（行は 0〜nr-1）"""
    js = [(j, m["show"]) for j, m in enumerate(measures) if m.get("show")]
    if not js:
        return cells
    at = {(tuple(x["r"]), tuple(x["c"])): x["v"] for x in cells}
    rank = [{k: i for i, k in enumerate(orders[i] or [])} for i in range(nr)]
    raw = {k: list(v) for k, v in at.items()}             # 割合・累計は、当てる前の値から
    for j, show in js:
        if show in ("pct_total", "pct_row", "pct_col"):
            for (r, c), v in at.items():
                base = raw.get(((), ()) if show == "pct_total" else (r, ()) if show == "pct_row" else ((), c))
                b = base[j] if base else None
                v[j] = v[j] / b * 100 if isinstance(v[j], (int, float)) and b else None
            continue
        # 累計・差・順位: 行の段の深さ a ごと、同じ親（r[:a-1]）・同じ列の中で、行の並びの順に
        groups = {}
        for (r, c) in at:
            if r:
                groups.setdefault((len(r), r[:-1], c), []).append(r)
        for (a, _parent, c), rs in groups.items():
            rs.sort(key=lambda r: rank[a - 1].get(r[-1], 1e9))
            vals = [raw[(r, c)][j] for r in rs]
            if show == "cum":
                s = 0
                out = []
                for v in vals:
                    s = s + v if isinstance(v, (int, float)) else s
                    out.append(s if isinstance(v, (int, float)) else None)
            elif show == "diff":
                out = [None] + [b - a if isinstance(a, (int, float)) and isinstance(b, (int, float)) else None for a, b in zip(vals, vals[1:])]
            else:
                order = sorted((v for v in vals if isinstance(v, (int, float))), reverse=True)
                out = [order.index(v) + 1 if isinstance(v, (int, float)) else None for v in vals]
            for r, v in zip(rs, out):
                at[(r, c)][j] = v
        if show == "rank":
            for (r, c), v in at.items():
                if not r:
                    v[j] = None
    return cells
