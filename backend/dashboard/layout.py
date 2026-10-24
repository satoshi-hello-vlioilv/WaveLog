# -*- coding: utf-8 -*-
"""layout.py: ダッシュボードの組み（グリッド・パネル・セット・組み込み）の決まり（§9.628。LotScope の services/dashboard.py と
services/pivot_presets.py の置き場の決まりを移したもの）。

パネルの数は、どの形もサーバーの集計 1 か所（pivot.query_many）で数える（routes/dashboard.py の /api/dashboard/query）。
ここはダッシュボードの組みの決まりと、組み込みの標準。

置き場の決まり（集計表の組み方のプリセットと同じ。LotScope の pivot_presets）:
    共通デフォルト … 全員の分の既定。書けるのは開発者だけ（アクセス権限の区分）
    共通 … 全員の分。書けるのはマスタを書ける端末
    ID   … ログイン ID ごとの分。その ID の本人だけが見て・書ける
    組み込み … このコードに書いた共通デフォルト（だれも書き換えられない。直して保存すると入れ替える）
    標準 … 範囲ごとに 1 つ。その ID の標準 → 共通の標準 → 共通デフォルトの標準
マスタの行: {id, 名前, 元, 範囲, ログインID, 標準, 中身, 備考, rev, updated_at, updated_by}（backend/repositories/dashboard_repo.py）
"""
from __future__ import annotations

import json
import re

from . import aggregate, formula
from .pivot import MAX_MEASURES, PERIODS  # noqa: F401  MAX_MEASURES は画面へ渡す（パネルの値の数の上限）

# 元の名前（§9.628）: src:<データソースのキー>（表を選ぶなら src:<キー>:<表>）・role:<役割>（その役割のデータソース。組み込みが使う）・
# rec（測定データ）・plan（作業予定）
_SOURCE = re.compile(r"src:[^:\s]{1,40}(?::[^\s]{1,80})?|role:(?:仕掛|品質|実績)|rec|plan")


def is_source(src):
    """パネルの元の名前として正しいか（形だけ。在るかは数えるときに確かめる）"""
    return bool(_SOURCE.fullmatch(str(src or "")))


FIELDS = ["名前", "元", "範囲", "ログインID", "標準", "中身", "備考"]
SCOPES = {"default": "共通デフォルト", "all": "共通", "me": "ID"}          # 画面の言葉 → マスタの値（並びは標準を決める順の逆）
MAX_BYTES = 64 * 1024
NAME_MAX = 40
# グラフの形（画面の CHARTS と同じ鍵。版 3.27.0 で 5 → 14・版 3.39.0 で 24・版 3.48.0 で積み上げ横棒の 2 つを足して 26・版 3.50.0 でウォーターフォールを足して 27。登録は lotlist-pivot-charts.js の DEFS）
CHARTS = ("time", "line", "area", "control", "xbar", "swimlane", "column", "bar", "lollipop", "pareto", "stack", "stack100", "hstack", "hstack100", "stackarea", "donut",
          "treemap", "sankey", "hist", "box", "violin", "heat", "scatter", "bubble", "diag45", "combo", "waterfall", "none")


class PresetError(ValueError):
    pass


def _dims(v):
    if not isinstance(v, list):
        return []
    out = []
    for d in v[:3]:
        if isinstance(d, dict) and isinstance(d.get("column"), str) and d["column"]:
            x = {"column": d["column"][:200], "part": str(d.get("part") or "")[:10]}
            for k in ("width", "origin"):
                if isinstance(d.get(k), (int, float)) and not isinstance(d.get(k), bool):
                    x[k] = d[k]
            out.append(x)
    return out


def clean_row(data, login, partial=False, body_text=None, source_ok=None):
    """画面から来た値 → マスタの行。scope は all（共通）か me（その ID）。partial は直すとき（来た物だけ）。
    body_text … 中身を確かめて JSON 字にする関数（既定は組み方の clean_body。ダッシュボード〈services/dashboard.py〉は自分の形で）"""
    d = data or {}
    row = {}
    if not partial or "name" in d:
        name = str(d.get("name") or "").strip()
        if not name:
            raise PresetError("名前を入れてください。")
        if len(name) > NAME_MAX:
            raise PresetError(f"名前は {NAME_MAX} 字までです。")
        row["名前"] = name
    if not partial:
        src = d.get("source")
        if not source_ok(src):
            raise PresetError("元が違います。")
        scope = d.get("scope")
        if scope not in SCOPES:
            raise PresetError("置き場（all か me）が違います。")
        if scope == "me" and not login:
            raise PresetError("ログイン ID が分からないので、ID ごとには保存できません。")
        row.update({"元": src, "範囲": SCOPES[scope], "ログインID": login if scope == "me" else ""})
    if not partial or "body" in d:
        row["中身"] = body_text(d.get("body"))
    if not partial or "standard" in d:
        row["標準"] = "1" if d.get("standard") else ""
    if not partial or "note" in d:
        row["備考"] = str(d.get("note") or "")[:200]
    return row


def scope_of(row):
    return next((k for k, v in SCOPES.items() if v == row.get("範囲")), "me")


def group_of(row):
    """名前・標準を 1 つに決める組（元・範囲・持ち主）"""
    return (row.get("元"), row.get("範囲"), row.get("ログインID") if row.get("範囲") == SCOPES["me"] else "")


def visible(row, login):
    """この ID に見せる行か（共通デフォルト・共通は全員・ID の分は本人だけ）"""
    return row.get("範囲") in (SCOPES["all"], SCOPES["default"]) or (bool(login) and row.get("範囲") == SCOPES["me"] and row.get("ログインID") == login)


def can_edit(row, login, common_ok, default_ok=False):
    """書いてよいか（共通デフォルトは開発者・共通はマスタの権限・ID の分は本人）"""
    scope = scope_of(row)
    return default_ok if scope == "default" else common_ok if scope == "all" else (bool(login) and row.get("ログインID") == login)


def view(row, login="", common_ok=False, default_ok=False, body_of=None):
    """マスタの行 → 画面の形。中身が壊れていれば body は {}（body_of は中身の字 → dict）。"""
    try:
        body = body_of(row.get("中身") or "{}")
    except ValueError:
        body = {}
    return {"id": row.get("id"), "name": row.get("名前", ""), "source": row.get("元", ""), "scope": scope_of(row),
            "login": row.get("ログインID", ""), "standard": row.get("標準") == "1", "body": body, "note": row.get("備考", ""),
            "rev": row.get("rev", 1), "updatedAt": row.get("updated_at", ""), "updatedBy": row.get("updated_by") or {},
            "canEdit": can_edit(row, login, common_ok, default_ok), "builtin": False}


def standard_for(rows, source, login):
    """この ID・この元で当てる標準（ID の標準 → 共通の標準 → 共通デフォルトの標準 → 無し）。rows はマスタの行"""
    mine = [r for r in rows if r.get("元") == source and r.get("標準") == "1" and visible(r, login)]
    for scope in ("me", "all", "default"):
        hit = next((r for r in mine if r.get("範囲") == SCOPES[scope]), None)
        if hit:
            return hit
    return None



MAX_FILTERS = 20
PERIODS_KEYS = tuple(PERIODS)


# ================================================================== ダッシュボードの組み（版 3.37.0）
# 利用者の要望: グリッドにパネルを置き、大きさを変え、パネルごとにデータ・条件・グラフや表を組む（Power BI のように）。
# 1 つのダッシュボード＝{rows: グリッドの段の数, panels: [パネル]}。横はいつも GRID_COLS（12）列。段の高さは窓の高さを段の数で割る
# （画面はスクロールしない。どの大きさの窓でも全部のパネルが見える）。
# パネル: {id, x, y, w, h, title, visual, source, equip, body, filters, search, period, sort, top, basis}
#   visual … グラフの形（CHARTS。none は表だけ）・kpi（大きな数）・board（合わせた表。版 3.38.0。下の「合わせた表」）
#   source … lot・work・src:<キー>（データ元）。equip … 作業実績の設備のキー（空はすべての設備）
#   body   … 集計の組み方（行・列・値。集計表と同じ形。kpi は行が無くてよい）
#   filters・search … 数える行の条件（一覧と同じ形）。period … 期間（pivot.PERIODS）
#   sort   … 行の並べ方（""＝決まった順・desc＝値の大きい順・asc＝小さい順）。top … 上位いくつ（0＝パネルの大きさに合わせる）
#   basis  … 作業日の数え方（work＝現場歴・cal＝太陽暦）
#   emph   … 目立たせる（最初に見る数。淡い藍の地と藍の枠。2026-10-grid の 3 回目で決めた L）
#   calc   … 計算列（版 3.38.0）: {formulas: {列名: 式}, names: {元の列名: 表示名}}。組んだ PC の一覧の表示列の設定から、使う計算列の分だけ写す
#            （共通のダッシュボードをほかの PC で開いても同じ数になる。式は services/formula.py で画面と同じ答え）。
#            版 3.39.0 からパネルを組む所でも作れる（own: パネルで作った計算列の名前。一覧の表示列には入れない）
# 版 3.39.0（利用者の要望 2026-10）:
#   equips … 数える設備の名前の並び（空はすべて。複数選べる）。作業実績は設備のファイル、データ元は設備の列の値で見分ける
#   egroup … 設備のまとめ（合算）{mode, name, groups, set, rest}（clean_egroup）。合わせた表は表全体（行の段の設備）に効く
#   fmt    … 書式（clean_fmt。数値ラベル・横軸の日付の形・桁・単位・縦軸の範囲・凡例・補助線・基準線・色の組・系列の色・字の大きさ・数字の形と目標）
#   frame  … パネルの見せ方（FRAMES。emph は frame "emph" の前の版の書き方として読む）
#   値（measures）は services/aggregate.py の種類（統計・表し方 show・p 点・規格 lsl/usl）
# 版 3.40.0（利用者の要望 2026-10）:
#   esplit … 設備の分け方（split_of）: series（設備ごとに系列＝列の段に設備）・facet（設備ごとに小さな表・グラフを並べる）・sum（合算して 1 つ）。
#            空なら、設備を 2 つ以上選んだとき（グループでまとめたときも）は series、ほかは sum（今までどおり）
#   body.sub … 小計（表。行の段が 2 つ以上のとき。設備グループの段〈@egroup〉と設備を並べると、グループごとの小計）
#   link   … 別のデータを合わせる（clean_link。45度線管理図の目標と実績など）。データ（側）ごとに元・軸（合わせる段）・値・作り方
#            （そのまま／積み上げ）・役割（目標／実績）を決め、軸の値でそろえて 1 つの答えにする（routes/dashboard.py の _link_answer）
# 版 3.41.0（利用者の要望 2026-10）:
#   noslice … ダッシュボードのスライサー（画面の道具の行。期間・設備）に従わない。fmt.series … 系列ごとの数値ラベル・線
#   board の order.tree・glist … 行を設備グループの見出しの下にまとめる・グループの手で並べた順
# 版 3.48.0（利用者の要望 2026-10-21 の 3 回目）:
#   eorder … 設備を手で並べた順（設備の名前の並び。並びに無い設備は後ろに今の順。合わせた表は order.manual）
# 置き場: マスタ dashboards（集計表の組み方のプリセットと同じ列・同じ決まり: 共通デフォルト・共通・ID・標準。元はいつも "dash"）。
LAYOUT_NAME = "dashboards"
LAYOUT_SOURCE = "dash"
GRID_COLS = 12
ROWS_MIN, ROWS_MAX, ROWS_DEFAULT = 4, 16, 8
MAX_PANELS = 24
EXTRA_VISUALS = ("kpi", "board", "gantt", "abc", "slicer", "now")
# 版 3.52.0（利用者の要望 2026-10-23）:
#   visual slicer … パネルに置くスライサー。行の段 1 つ（body.rows[0]＝列）の値と数を出し、押した値で同じデータのほかのパネルを絞る
#                    （選んだ値はこの PC の見え方。数え方はふつうのパネルと同じ集計）
#   レイアウトの slicer … 道具の行の帯のスライサー: {off: 帯を出さない（効きもしない）, parts: 出す物 ["period"（期間の札）, "date"（日付）, "equip"（設備）] の部分}
SLICER_PARTS = ("period", "date", "equip")
OPS_VISUALS = ("gantt", "abc", "now")   # 稼働（ガントチャートと稼働率）・ABC 分析と換算係数（版 3.46.0。services/operation.py）・いまの作業（§9.630 ④）
SORTS = ("", "desc", "asc")
TOP_MAX = 60
_ID = re.compile(r"[A-Za-z0-9_-]{1,16}")


class LayoutError(PresetError):
    pass


def _int(v, lo, hi, default):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))


IN_MAX = 20000          # 値を選ぶ条件（in。値の並びの JSON）の字の長さ


def _filters(v):
    out = []
    for f in (v if isinstance(v, list) else [])[:MAX_FILTERS]:
        if isinstance(f, dict) and str(f.get("column") or "").strip() and str(f.get("op") or "").strip():
            op = str(f["op"]).strip()[:20]
            x = {"column": str(f["column"]).strip()[:200], "op": op, "value": "" if f.get("value") is None else str(f["value"])[:IN_MAX if op == "in" else 400]}
            if op == "in" and f.get("key") in ("date", "month", "year"):
                x["key"] = f["key"]
            out.append(x)
    return out


def _period(v):
    if not isinstance(v, dict) or v.get("kind") not in PERIODS_KEYS or not str(v.get("column") or "").strip():
        return None
    out = {"column": str(v["column"]).strip()[:200], "kind": v["kind"], "n": _int(v.get("n"), 1, 3660, 7)}
    if v["kind"] == "range":          # 日付で決める（版 3.49.0）
        days = [x for x in (_day(v.get("from")), _day(v.get("to"))) if x]
        if not days:
            return None
        out.update({"from": min(days), "to": max(days)})
    return out


def _day(v):
    t = str(v or "")[:10]
    return t if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t) else ""



def clean_calc(v):
    """パネルの計算列 → {formulas, names}（字だけ・数と長さを限る）。無ければ None（一覧の並べ替えと同じ: formula.clean_calc）"""
    return formula.clean_calc(v) if isinstance(v, dict) else None


def _measure(m):
    """値（services/aggregate.py の形）。列があるかは数えるときに確かめる（ここは形だけ）。合わなければ None"""
    if not isinstance(m, dict) or m.get("agg") not in aggregate.AGGS:
        return None
    m = {**m, "column": str(m.get("column") or "")[:200]}
    try:
        out = aggregate.clean(m, lambda c: bool(c))
    except ValueError:
        if not m.get("expr"):
            return None
        return _measure({k: v for k, v in m.items() if k != "expr"})     # 読めない計算は外す（値そのものは残す）
    return {k: v for k, v in out.items() if not (k == "column" and not v)}


# ---------------------------------------------------------------- 設備の選び・まとめ・書式（版 3.39.0）
MAX_EQUIPS = 200
EGROUP_MODES = ("", "sum", "panel", "master")
EGROUP_RESTS = ("keep", "other", "hide")
MAX_EGROUPS = 24
SUM_NAME = "選んだ設備の計"


def _names(v, n=MAX_EQUIPS):
    out = []
    for x in (v if isinstance(v, list) else [])[:n]:
        t = str(x or "").strip()[:120]
        if t and t not in out:
            out.append(t)
    return out


def clean_egroup(v):
    """設備のまとめ → {mode, name, groups, set, rest}。mode: ""（まとめない）・sum（選んだ設備〈無ければ全部〉を 1 つに合算。名前 name）・
    panel（このパネルで決めたグループ groups: [{name, members}]）・master（設備グループのマスタのまとめ方 set）。
    rest … どのグループにも入らない設備: keep（そのまま）・other（その他にまとめる）・hide（出さない）。まとめないなら None"""
    if not isinstance(v, dict) or v.get("mode") not in EGROUP_MODES[1:]:
        return None
    mode = v["mode"]
    out = {"mode": mode, "rest": v.get("rest") if v.get("rest") in EGROUP_RESTS else "keep"}
    if mode == "sum":
        out["name"] = str(v.get("name") or "").strip()[:40] or SUM_NAME
    elif mode == "panel":
        gs = []
        for g in (v.get("groups") if isinstance(v.get("groups"), list) else [])[:MAX_EGROUPS]:
            if isinstance(g, dict) and str(g.get("name") or "").strip():
                gs.append({"name": str(g["name"]).strip()[:40], "members": _names(g.get("members"))})
        if not gs:
            return None
        out["groups"] = gs
    else:
        out["set"] = str(v.get("set") or "").strip()[:40]
        if not out["set"]:
            return None
    return out


def resolve_egroup(eg, equips, group_rows_for):
    """パネルの設備のまとめ → 数える形（pivot.query_many の egroups）。group_rows_for(set) → [{name, members}]（マスタ）"""
    if not eg:
        return None
    if eg["mode"] == "sum":
        return {"groups": [{"name": eg["name"], "members": list(equips or [])}], "rest": "other", "other": eg["name"]}
    groups = eg["groups"] if eg["mode"] == "panel" else group_rows_for(eg["set"])
    if not groups:
        return None
    return {"groups": groups, "rest": eg["rest"]}


FRAMES = ("card", "emph", "accent", "plain", "tint")
LABELS = ("auto", "none", "top", "inside", "both")
XDATES = ("auto", "md", "mdw", "d", "dw", "ymd", "ym", "w")
XROTS = ("auto", "0", "45", "90")
UNITS = ("auto", "none", "k", "man", "m", "oku")
LEGENDS = ("auto", "none", "top", "bottom")
SIZES = ("s", "m", "l")
PALETTES = ("", "vivid", "calm", "cud", "mono", "warm", "cool")
KPI_LOOKS = ("num", "bar", "gauge")
MAX_REFS = 4
MAX_COLORS = 40
SERIES_LABELS = ("top", "below", "off")
SERIES_KINDS = ("bar", "line", "area")        # 系列ごとの形（版 3.46.0。組み合わせのグラフ。どの推移・組み合わせの形でも効く）
SERIES_AXES = ("left", "right")
# 値の表示形式と見せ方（版 3.43.0。Excel のセルの書式設定の「表示形式」「配置」「フォント」に当たる。画面は static/js/num-format.js）
NUM_MAX = 160
NUM_CATS = ("num", "cur", "pct", "sci", "custom")
NUM_NEGS = ("minus", "tri", "paren", "red", "redtri")
ALIGNS = ("left", "center", "right")
VALIGNS = ("top", "middle", "bottom")
NSIZES = ("s", "l", "xl")


def _float(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


EXPR_MAX = 60
UNIT_MAX = 12
# 数の計算に使える字（数・小数点・値〈x・X・値・全角〉・四則と累乗・かっこ・空白。全角の数と記号も）
_EXPR = re.compile(r"[0-9.xX値ｘＸ+\-*/^()×÷−–✕＋－＊／＾（）０-９．\s]+")


def clean_fmt(v):
    """書式 → 既定と違う物だけの dict（無ければ None）。
    labels（数値ラベル: auto・none・top〈上〉・inside〈棒の中。積み上げはそれぞれの段〉・both）・xdate（横軸の日付の形）・xrot（横軸の字の向き）・
    digits（小数の桁。-1＝自動）・unit（単位: auto〈万・億〉・none・k〈千〉・man〈万〉）・ymin/ymax（縦軸の範囲）・legend・grid（補助線）・
    refs（基準線 [{value, label, color}]）・palette（色の組）・colors（系列・項目の名前 → 色）・size（字の大きさ）・kpi（数字の形）・target（目標）・
    series（版 3.41.0。系列の名前 → {label: top〈上〉・below〈下〉・off〈出さない〉, dash: True〈破線〉, kind: bar・line・area〈形。版 3.46.0〉, axis: left・right}）・
    num（版 3.43.0。表示形式: Excel の書式コード）と numUi（その選び {cat, dec, sep, neg, pre, suf}）・align（横の配置）・valign（縦の配置）・
    nsize（字の大きさ s・l・xl）・bold（off で太字にしない）・ncolor（字の色）"""
    if not isinstance(v, dict):
        return None
    out = {}
    for k, choices in (("labels", LABELS), ("xdate", XDATES), ("xrot", XROTS), ("unit", UNITS), ("legend", LEGENDS), ("size", SIZES),
                       ("palette", PALETTES), ("kpi", KPI_LOOKS)):
        x = str(v.get(k) or "")
        if x in choices and x not in ("auto", "", "m", "num"):
            out[k] = x
    d = _int(v.get("digits"), -1, 4, -1)
    if d >= 0:
        out["digits"] = d
    for k in ("ymin", "ymax", "target"):
        f = _float(v.get(k))
        if f is not None:
            out[k] = f
    if "ymin" in out and "ymax" in out and out["ymin"] >= out["ymax"]:
        out.pop("ymax")
    if v.get("grid") is False:
        out["grid"] = False
    refs = []
    for r in (v.get("refs") if isinstance(v.get("refs"), list) else [])[:MAX_REFS]:
        f = _float((r or {}).get("value")) if isinstance(r, dict) else None
        if f is not None:
            c = str(r.get("color") or "")
            refs.append({"value": f, "label": str(r.get("label") or "").strip()[:20], "color": c if _COLOR.fullmatch(c) else ""})
    if refs:
        out["refs"] = refs
    cs = {str(k)[:120]: str(c) for k, c in list((v.get("colors") if isinstance(v.get("colors"), dict) else {}).items())[:MAX_COLORS]
          if str(k).strip() and _COLOR.fullmatch(str(c))}
    if cs:
        out["colors"] = cs
    ss = {}
    for k, x in list((v.get("series") if isinstance(v.get("series"), dict) else {}).items())[:MAX_COLORS]:
        one = {**({"label": x["label"]} if x.get("label") in SERIES_LABELS else {}), **({"dash": True} if x.get("dash") is True else {}),
               **({"kind": x["kind"]} if x.get("kind") in SERIES_KINDS else {}), **({"axis": x["axis"]} if x.get("axis") in SERIES_AXES else {})} if isinstance(x, dict) else {}
        if str(k).strip() and one:
            ss[str(k)[:120]] = one
    if ss:
        out["series"] = ss
    code = str(v.get("num") or "").strip()[:NUM_MAX]
    if code:
        out["num"] = code
        ui = v.get("numUi") if isinstance(v.get("numUi"), dict) else {}
        if ui.get("cat") in NUM_CATS:
            out["numUi"] = {"cat": ui["cat"], "dec": _int(ui.get("dec"), 0, 6, 0), "sep": ui.get("sep") is not False,
                            "neg": ui.get("neg") if ui.get("neg") in NUM_NEGS else "minus",
                            "pre": str(ui.get("pre") or "")[:12], "suf": str(ui.get("suf") or "")[:12]}
    for k, choices in (("align", ALIGNS), ("valign", VALIGNS), ("nsize", NSIZES)):
        if v.get(k) in choices:
            out[k] = v[k]
    if v.get("bold") == "off":
        out["bold"] = "off"
    c = str(v.get("ncolor") or "")
    if _COLOR.fullmatch(c):
        out["ncolor"] = c
    # 版 3.45.0: expr（数の計算。画面が読む式〈num-format.js の expr〉。使える字だけ）・utext（数字の後ろの単位。空＝単位を出さない）
    e = str(v.get("expr") or "").strip()[:EXPR_MAX]
    if e and _EXPR.fullmatch(e):
        out["expr"] = e
    if isinstance(v.get("utext"), str):
        out["utext"] = v["utext"].strip()[:UNIT_MAX]
    return out or None


ESPLITS = ("", "series", "facet", "sum")
MAX_FACETS = 24


def split_of(p):
    """パネルの設備の分け方（esplit が空なら決める）→ series・facet・sum・""（分けない: 段に設備・設備グループがある・設備を見分けない形）"""
    body = p.get("body") or {}
    if p.get("link") or any(d.get("column") in ("@equip", "@egroup") for d in (body.get("rows") or []) + (body.get("cols") or [])):
        return ""
    eg = p.get("egroup") or {}
    if eg.get("mode") == "sum":
        return "sum"
    want = p.get("esplit") or ""
    if want:
        return want
    return "series" if len(p.get("equips") or []) >= 2 or eg.get("mode") in ("panel", "master") else "sum"


# ---------------------------------------------------------------- 別のデータを合わせる（版 3.40.0。link）
# 利用者の要望（2026-10）: 45度線管理図などの 2 つのデータが要る形は、1 つのデータの中の 2 つの値ではなく、別のデータ（例: 計画のデータ元と作業実績）
# から取る。どの段で軸を合わせるか・合わせた後にそのまま出すか積み上げる（累計）か・どちらが目標でどちらが実績かを、データ（側）ごとに決める。
#   link: {sides: [side（2〜4）], extra: [diff（実績−目標）・rate（実績÷目標 %）]}
#   side: {title, role: target（目標）・actual（実績）・base（基準＝比べる相手。全設備の平均など・§9.628）・""（比べる）, build: as（そのまま）・cum（積み上げ）, key: 段（軸。日付の列・作業日・設備など）,
#          measure: 値 1 つ, source・equip・equips・filters・search・period・basis・calc（ふつうのパネルと同じ）}
# 軸の値は、日（作業日の日・日付の列の年月日）・年月・年・設備名・字の値で、データが違っても同じ値なら同じ行にそろう（routes の _link_key）
LINK_ROLES = ("target", "actual", "base", "")
LINK_BUILDS = ("as", "cum")
LINK_EXTRAS = ("diff", "rate")
MAX_SIDES = 4


def clean_link(v, what):
    """パネルの link → 置く形（無ければ None）。データが 2 つ未満・軸が無ければ LayoutError"""
    if not isinstance(v, dict):
        return None
    raw = v.get("sides") if isinstance(v.get("sides"), list) else []
    if not raw:
        return None
    if not 2 <= len(raw) <= MAX_SIDES:
        raise LayoutError(f"{what}の合わせるデータは 2〜{MAX_SIDES} つです。")
    sides = []
    for i, x in enumerate(raw):
        if not isinstance(x, dict):
            raise LayoutError(f"{what}の合わせるデータの形が違います。")
        key = _dims([x.get("key")] if isinstance(x.get("key"), dict) else [])
        if not key:
            raise LayoutError(f"{what}の合わせるデータ {i + 1} に、軸（合わせる段）がありません。")
        m = _measure(x.get("measure")) or {"agg": "lots"}
        m.pop("show", None)            # 表し方（割合・累計など）は使わない（積み上げは build で決める）
        sides.append({**_data(x, f"{what}の合わせるデータ {i + 1}"), "title": str(x.get("title") or "").strip()[:40],
                      "role": x.get("role") if x.get("role") in LINK_ROLES else "", "build": x.get("build") if x.get("build") in LINK_BUILDS else "as",
                      "key": key[0], "measure": m})
    extra = [e for e in LINK_EXTRAS if e in (v.get("extra") if isinstance(v.get("extra"), list) else [])]
    return {"sides": sides, **({"extra": extra} if extra else {})}


def side_query(link, i, panel):
    """合わせるデータ i → ふつうのパネルと同じ形（数えるため）。パネルの絞り込み（設備・条件）は、どのデータにも足す"""
    x = link["sides"][i]
    return {**{k: x[k] for k in ("source", "equip", "search", "period", "basis") if k in x}, **({"calc": x["calc"]} if x.get("calc") else {}),
            **({"equips": panel.get("equips") or x["equips"]} if panel.get("equips") or x.get("equips") else {}),
            "filters": (x.get("filters") or []) + (panel.get("filters") or []),
            "visual": "none", "body": {"rows": [x["key"]], "cols": [], "measures": [x["measure"]], "sub": False, "grand": True}}


def _data(p, what):
    """数える元と行の決め方（パネルと、合わせた表の列のまとまりで同じ形）: source・equip・filters・search・period・basis・calc"""
    src = str(p.get("source") or "")
    if not is_source(src):
        raise LayoutError(f"{what}のデータ（src:<キー>・rec・plan）が違います。")
    out = {"source": src, "equip": str(p.get("equip") or "")[:40], "filters": _filters(p.get("filters")), "search": str(p.get("search") or "").strip()[:200],
           "period": _period(p.get("period")), "basis": "cal" if p.get("basis") == "cal" else "work"}
    eq = _names(p.get("equips"))
    if eq:
        out["equips"] = eq
    calc = clean_calc(p.get("calc"))
    if calc:
        out["calc"] = calc
    return out


# ---------------------------------------------------------------- 合わせた表（版 3.38.0。visual board）
# 行の段（rows。既定は設備）を共通にして、列のまとまり（groups。1〜4）を横に並べる 1 枚の表。まとまりごとにデータ・値・列の段・期間・条件を
# ほかのパネルと同じ組み方で決める（数え方もほかのパネルと同じ 1 か所）。行は行の段の鍵（設備なら設備名）でそろえる。
#   group: {title, source, equip, filters, search, period, basis, calc, measure: {agg, column}, cols: [段]（0〜2）,
#           look: bar（棒と数）・heat（数と濃淡）・num（数だけ）・stack（列の内訳を 1 本の帯に積む）・share（行の計に対する割合 %）・
#                 dot（点と数）・signal（しきい値で 3 色の信号）・spark（列の段〈日など〉の移りを小さな線で）,
#           total: 列の段があるとき計の列を出す, zero: 計が 0 の行に印（ほかのまとまりに数がある行）,
#           color: 色（"" ＝データの種類の色・#rrggbb）, limits: {warn, alert, dir: high〈大きいと悪い〉・low}（信号・濃淡の色の境）}
#   order: {by: value（まとまり group の計の大きい・小さい順 dir）・name（名前の順）・equip（作業実績の設備の並び〈マスタ管理で決めた順〉）・
#           manual（手で並べた list の順。list に無い行は後ろに名前の順）, group, dir: desc|asc, list: [行の鍵], hide: [隠す行の鍵]}
BOARD_LOOKS = ("bar", "heat", "num", "stack", "share", "dot", "signal", "spark")   # 版 3.39.0 で 3 → 8
BOARD_ORDERS = ("value", "name", "equip", "manual")
MAX_GROUPS = 4
MAX_ORDER = 200
_COLOR = re.compile(r"#[0-9a-fA-F]{6}")


def _keys(v):
    return [str(x)[:120] for x in (v if isinstance(v, list) else [])[:MAX_ORDER] if str(x).strip()]


def clean_group(g, i):
    if not isinstance(g, dict):
        raise LayoutError("列のまとまりの形が違います。")
    title = str(g.get("title") or "").strip()[:40]
    out = {"title": title, **_data(g, f"列のまとまり「{title or i + 1}」"),
           "measure": _measure(g.get("measure")) or {"agg": "lots"}, "cols": _dims(g.get("cols"))[:2],
           "look": g.get("look") if g.get("look") in BOARD_LOOKS else "num", "total": bool(g.get("total", True)), "zero": bool(g.get("zero")),
           "color": str(g.get("color") or "") if _COLOR.fullmatch(str(g.get("color") or "")) else ""}
    lim = g.get("limits") if isinstance(g.get("limits"), dict) else {}
    lim = {k: f for k in ("warn", "alert") if (f := _float(lim.get(k))) is not None}, lim.get("dir")
    if lim[0]:
        out["limits"] = {**lim[0], "dir": "low" if lim[1] == "low" else "high"}
    return out


def clean_board(p, what):
    groups = p.get("groups") if isinstance(p.get("groups"), list) else []
    if not groups:
        return board_default()
    if len(groups) > MAX_GROUPS:
        raise LayoutError(f"{what}の列のまとまりは {MAX_GROUPS} つまでです。")
    rows = _dims([p.get("rows")] if isinstance(p.get("rows"), dict) else [])
    o = p.get("order") if isinstance(p.get("order"), dict) else {}
    gs = [clean_group(g, i) for i, g in enumerate(groups)]
    # noTotal（§9.628）… 見出しの「計」を出さない（同じ数を上の数字のパネルが言うとき。同じ数を 2 か所に出さない）
    extra = {k: v for k, v in (("equips", _names(p.get("equips"))), ("egroup", clean_egroup(p.get("egroup"))), ("filters", _filters(p.get("filters"))),
                               ("noTotal", p.get("noTotal") is True)) if v}
    return {**extra, "rows": rows[0] if rows else {"column": "@equip", "part": ""}, "groups": gs,
            "order": {"by": o.get("by") if o.get("by") in BOARD_ORDERS else "value", "group": _int(o.get("group"), 0, len(gs) - 1, 0),
                      "dir": "asc" if o.get("dir") == "asc" else "desc", "list": _keys(o.get("list")), "hide": _keys(o.get("hide")),
                      # tree（版 3.41.0）… 行を設備グループ（まとめ方の名前）の見出しの下にまとめる。glist … 手で並べたグループの順
                      **({"tree": str(o["tree"]).strip()[:40], "glist": _keys(o.get("glist"))} if rows_is_equip(rows) and str(o.get("tree") or "").strip() else {})}}


def rows_is_equip(rows):
    return not rows or rows[0].get("column") == "@equip"


def board_query(board, i):
    """合わせた表の列のまとまり i → ふつうのパネルと同じ形（数えるため。routes/dashboard.py が 1 つずつ数える）"""
    g = board["groups"][i]
    # 表全体の設備の選び・まとめ・条件（版 3.39.0）は、どのまとまりにも効く（条件はまとまりの条件に足す）
    whole = {k: board[k] for k in ("equips", "egroup") if board.get(k)}
    return {**{k: g[k] for k in ("source", "equip", "search", "period", "basis") if k in g}, **({"calc": g["calc"]} if g.get("calc") else {}),
            **({"equips": g["equips"]} if g.get("equips") else {}), **whole, "filters": (g.get("filters") or []) + (board.get("filters") or []),
            "visual": "none", "body": {"rows": [board["rows"]], "cols": g["cols"], "measures": [g["measure"]], "sub": False, "grand": True}}


YESTERDAY = {"column": "@workday", "kind": "yesterday"}
DONE = {"column": "状態", "op": "eq", "value": "完了"}       # 測定データ（rec）の「完了」だけ


def board_default():
    """合わせた表の既定の組み: 設備ごとの仕掛ロット数（棒・大きい順）と、前日（現場歴）の直ごとの測定の完了ロット数（濃淡・計・0 の印）。
    元は役割で書く（role:仕掛。データソースのキーを変えても同じ表が開く・backend/dashboard/sources.py が解く）"""
    return {"rows": {"column": "@equip", "part": ""},
            "groups": [{"title": "仕掛ロット数", "source": "role:仕掛", "equip": "", "filters": [], "search": "",
                        "period": None, "basis": "work", "measure": {"agg": "lots"}, "cols": [], "look": "bar", "total": True, "zero": False, "color": ""},
                       {"title": "", "source": "rec", "equip": "", "filters": [DONE], "search": "",
                        "period": dict(YESTERDAY, n=7), "basis": "work", "measure": {"agg": "lots"}, "cols": [{"column": "@shift", "part": ""}],
                        "look": "heat", "total": True, "zero": True, "color": ""}],
            "order": {"by": "value", "group": 0, "dir": "desc", "list": [], "hide": []}}


def clean_panel(p, i, rows):
    """画面から来たパネル → 置く形（知らない物は外す・大きさはグリッドに収める）。合わなければ LayoutError"""
    if not isinstance(p, dict):
        raise LayoutError("パネルの形が違います。")
    pid = str(p.get("id") or "")
    pid = pid if _ID.fullmatch(pid) else f"p{i + 1}"
    w, h = _int(p.get("w"), 1, GRID_COLS, 4), _int(p.get("h"), 1, rows, 2)
    out = {"id": pid, "x": _int(p.get("x"), 0, GRID_COLS - w, 0), "y": _int(p.get("y"), 0, rows - h, 0), "w": w, "h": h,
           "title": str(p.get("title") or "").strip()[:60]}
    visual = p.get("visual") if p.get("visual") in CHARTS + EXTRA_VISUALS else "column"
    out["visual"] = visual
    frame = p.get("frame") if p.get("frame") in FRAMES else ("emph" if p.get("emph") else "card")
    out["emph"] = frame == "emph"            # 前の版の画面のため（frame と同じ物）
    if frame != "card":
        out["frame"] = frame
    fmt = clean_fmt(p.get("fmt"))
    if fmt:
        out["fmt"] = fmt
    if p.get("noslice") is True:
        out["noslice"] = True          # ダッシュボードのスライサーに従わない（版 3.41.0）
    what = f"パネル「{out['title'] or pid}」"
    if visual == "board":
        return {**out, **clean_board(p, what)}
    body = p.get("body") if isinstance(p.get("body"), dict) else {}
    ms = [m for m in map(_measure, (body.get("measures") if isinstance(body.get("measures"), list) else [])[:MAX_MEASURES]) if m]
    rows_ = _dims(body.get("rows"))
    out.update(_data(p, what),
               # 段は集計表の組み方と同じ形（_dims）。小計は表で行の段が 2 つ以上のとき（版 3.40.0）
               body={"rows": rows_, "cols": _dims(body.get("cols")), "measures": ms or [{"agg": "lots"}],
                     "sub": bool(body.get("sub")) and visual == "none" and len(rows_) > 1, "grand": bool(body.get("grand", visual in ("none", "kpi"))),
                     "chartAt": _int(body.get("chartAt"), 0, 3, 0), "labels": bool(body.get("labels", True))},
               sort=p.get("sort") if p.get("sort") in SORTS else "", top=_int(p.get("top"), 0, TOP_MAX, 0))
    eg = clean_egroup(p.get("egroup"))
    if eg:
        out["egroup"] = eg
    if p.get("esplit") in ESPLITS[1:]:
        out["esplit"] = p["esplit"]
    eo = _names(p.get("eorder"))
    if eo:
        out["eorder"] = eo           # 設備を手で並べた順（版 3.48.0。表・グラフ・系列・ガントの行・ABC の設備の札）
    if visual in OPS_VISUALS:
        # 作業開始と作業終了の列が要る（無ければ数えるときに断る・backend/dashboard/ops.py）
        out["ops"] = clean_ops(p.get("ops"))
        out["body"]["rows"], out["body"]["cols"] = [], []
        out.pop("egroup", None)
        out.pop("esplit", None)
        return out
    link = clean_link(p.get("link"), what)
    if link:
        out["link"] = link
        return out
    if visual not in ("kpi", "none") and not out["body"]["rows"]:
        raise LayoutError(f"{what}は行の段が要ります（大きな数にするなら「数字」の形を選んでください）。")
    return out


# ---------------------------------------------------------------- 稼働・ABC 分析（版 3.46.0。visual gantt・abc）
# ops: {end: 作業終了の列（"" は見つける）, label: 棒の字の列, color: 棒の色分けの列, cls: 品種の列（ABC・換算係数。字か、組み合わせる列の並び）,
#       qty: 量（lots＝本数・time＝作業時間・数の列の名前＝その合計）, base: 換算の基準（avg・top・品種の値）, a・b: ABC の線（累積構成比 %）}
# 版 3.48.0（利用者の要望 2026-10-21 の 3 回目の 5・6・7）:
#       start: 作業開始の列（"" は見つける）・span: 全設備の作業時間の取り方（sum＝各設備の積み上げ・lead＝リードタイム。operation.SPANS）・
#       hide: ABC 分析の出さない項目（ABC_ITEMS の鍵の並び）
#       lims: ABC の線（累積構成比 % の昇順の並び。いくつでも。版 3.51.0。前の a・b は lims [a, b] として読む）・rankBy: "each"＝品種ごとに 1 段（A, B, C, … 上限なし）
ABC_A, ABC_B = 70.0, 90.0
ABC_LIMS_MAX = 50         # 線の数の上限（51 段。段の名前は A〜Z の次が AA・AB …）
# ABC 分析の表示項目（出す・出さないを選べる物）: 構成比・累積・ABC（ランク。棒の色と A・B の線も）・平均作業・換算係数・換算本数・パレート図・下の段の計
ABC_ITEMS = ("share", "occ", "lshare", "cum", "rank", "avg", "factor", "conv", "chart", "foot")     # occ・lshare（占有時間・負荷構成比）は版 3.49.0


def clean_ops(v):
    v = v if isinstance(v, dict) else {}
    col = lambda k: str(v.get(k) or "").strip()[:200]       # noqa: E731
    lims = abc_lims(v)
    out = {k: col(k) for k in ("start", "end", "label", "color") if col(k)}
    if v.get("span") == "lead":
        out["span"] = "lead"
    # 予定と実績を 1 つのガントに（§9.630 ②。作業予定の元だけ）: 実績（作業開始〜作業終了）の棒に、まだ終わっていない行の予定（予定開始〜予定終了）を重ねる
    if v.get("plan") is True:
        out["plan"] = True
    # 基準の期間（地点 A。版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 3）: この期間の換算係数で、パネルの期間（地点 B）の本数を換算する
    ref = _period({**v["refPeriod"], "column": "@workday"}) if isinstance(v.get("refPeriod"), dict) else None
    if ref:
        out["refPeriod"] = ref
    hide = [x for x in ABC_ITEMS if x in (v.get("hide") if isinstance(v.get("hide"), list) else [])]
    if hide:
        out["hide"] = hide
    # 品種の列（版 3.47.0）: 1 つなら字・いくつか（組み合わせで分ける。operation.MAX_CLS まで）なら列の並び
    cls = [str(x or "").strip()[:200] for x in v.get("cls")] if isinstance(v.get("cls"), list) else [col("cls")]
    cls = [x for x in dict.fromkeys(cls) if x][:4]
    if cls:
        out["cls"] = cls[0] if len(cls) == 1 else cls
    qty, base = col("qty"), str(v.get("base") or "").strip()[:120]
    out.update({"qty": qty or "lots", "base": base or "avg"})
    if lims != [ABC_A, ABC_B]:
        out["lims"] = lims
    if v.get("rankBy") == "each":
        out["rankBy"] = "each"
    return out


def abc_lims(v):
    """ABC の線（lims。無ければ前の a・b）→ 0 より大きく 100 以下・同じ線は 1 本・昇順の並び（ABC_LIMS_MAX 本まで）。1 本も無ければ既定の [70, 90]"""
    raw = v.get("lims") if isinstance(v.get("lims"), list) else [v.get("a", ABC_A), v.get("b", ABC_B)]
    xs = sorted({round(min(100.0, x), 4) for x in (_float(r) for r in raw) if x is not None and x > 0})
    return xs[:ABC_LIMS_MAX] or [ABC_A, ABC_B]


def clean_slicer(v):
    """レイアウトの帯のスライサーの設定（版 3.52.0）→ {off, parts}。既定（出す・期間と設備）なら空"""
    v = v if isinstance(v, dict) else {}
    parts = [x for x in SLICER_PARTS if x in (v.get("parts") if isinstance(v.get("parts"), list) else SLICER_PARTS)]
    out = {}
    if v.get("off") is True:
        out["off"] = True
    if parts != list(SLICER_PARTS):
        out["parts"] = parts
    return out


def overlaps(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def clean_layout(body):
    """ダッシュボードの中身（dict か JSON 字）→ (dict, JSON 字)。パネルが重なる・多すぎる・大きすぎれば LayoutError"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise LayoutError("中身の形が違います。") from e
    if not isinstance(body, dict):
        raise LayoutError("中身の形が違います。")
    rows = _int(body.get("rows"), ROWS_MIN, ROWS_MAX, ROWS_DEFAULT)
    raw = body.get("panels") if isinstance(body.get("panels"), list) else []
    if len(raw) > MAX_PANELS:
        raise LayoutError(f"パネルは {MAX_PANELS} 枚までです。")
    panels, ids = [], set()
    for i, p in enumerate(raw):
        x = clean_panel(p, i, rows)
        while x["id"] in ids:
            x["id"] = f"p{len(ids) + i + 2}"
        ids.add(x["id"])
        hit = next((q for q in panels if overlaps(q, x)), None)
        if hit:
            raise LayoutError(f"パネル「{x['title'] or x['id']}」と「{hit['title'] or hit['id']}」が重なっています。")
        panels.append(x)
    out = {"rows": rows, "panels": panels}
    sc = clean_slicer(body.get("slicer"))
    if sc:
        out["slicer"] = sc
    if str(body.get("replaces") or "") in BUILTIN_KEYS:
        out["replaces"] = body["replaces"]      # 組み込みのダッシュボードと入れ替えた物（版 3.48.0。その組み込みの代わりに出す）
    text = json.dumps(out, ensure_ascii=False, sort_keys=True)
    if len(text.encode("utf-8")) > MAX_BYTES * 2:
        raise LayoutError("ダッシュボードが大きすぎます。")
    return out, text


def clean_layout_row(data, login, partial=False):
    """画面から来た値 → マスタ dashboards の行（集計表の組み方と同じ列・決まり。中身だけダッシュボードの形）"""
    try:
        return clean_row({**(data or {}), "source": LAYOUT_SOURCE}, login, partial,
                                       body_text=lambda b: clean_layout(b)[1], source_ok=lambda s: s == LAYOUT_SOURCE)
    except PresetError as e:
        raise LayoutError(str(e)) from None


def builtin_named(row):
    """組み込みと同じ名前で、自分の ID か共通デフォルトに置く行なら、その組み込みの鍵（無ければ ""）。版 3.49.0（利用者の要望 2026-10-21 の 4 回目の 1:
    組み込みの「標準」を直して同じ名前「標準」で保存しても上書きにならず、「標準」が 2 つ 3 つに増えた）。共通は組み込みより先に並ぶ別の段なので入れ替えない"""
    if row.get("範囲") not in (SCOPES["default"], SCOPES["me"]):
        return ""
    name = str(row.get("名前") or "").strip()
    return next((b["key"] for b in BUILTIN_LAYOUTS if b["name"] == name), "")


def with_builtin_replace(row, old=None):
    """行の中身に replaces（入れ替える組み込みの鍵）を入れる: 組み込みと同じ名前で置く物は、その組み込みの代わり（上書き）にする。
    old … 直すときの前の行（名前・範囲・中身の無い所を補う）。中身を書かない（名前だけ・標準だけを直す）ときも、前の中身に入れて書く"""
    whole = {**(old or {}), **row}
    key = builtin_named(whole)
    if not key:
        return row
    body = clean_layout(whole.get("中身") or "{}")[0]
    if body.get("replaces") == key:
        return row
    return {**row, "中身": clean_layout({**body, "replaces": key})[1]}


def layout_view(row, login="", common_ok=False, default_ok=False):
    """マスタの行 → 画面の形（中身が壊れていれば panels は空）"""
    v = view(row, login, common_ok, default_ok, body_of=lambda t: clean_layout(t)[0])
    return v if v["body"] else {**v, "body": {"rows": ROWS_DEFAULT, "panels": []}}


# ---------------------------------------------------------------- ダッシュボードのセット（版 3.46.0。利用者の要望 2026-10-21 の 7）
# いくつかのダッシュボードを 1 つの束（セット）にして、道具の行のタブで切り替える。置き場はダッシュボードと同じマスタ dashboards（元 "dashset"）で、
# 決まりもダッシュボード・集計表の組み方と同じ: 共通デフォルト（開発者が作る標準のセット。いくつでも）・共通・自分の ID（個人の切り替えのパターン）と、
# 範囲ごとの ★標準（アプリを開いたときのセット。自分 → 共通 → 共通デフォルトの順に決まる）。
# 中身: {items: [ダッシュボードの id（数の字）か組み込みの "b:鍵"]}（並びがタブの順。見えないダッシュボードは画面が飛ばす）
SET_SOURCE = "dashset"
MAX_SET_ITEMS = 12
_SET_ITEM = re.compile(r"\d{1,9}|b:[A-Za-z0-9_-]{1,32}")


def clean_set_body(body):
    """セットの中身（dict か JSON 字）→ (dict, JSON 字)。ダッシュボードが 1 つも無い・多すぎれば LayoutError"""
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError as e:
            raise LayoutError("セットの中身の形が違います。") from e
    raw = body.get("items") if isinstance(body, dict) else None
    items = list(dict.fromkeys(str(x) for x in (raw if isinstance(raw, list) else []) if _SET_ITEM.fullmatch(str(x))))
    if not items:
        raise LayoutError("セットに入れるダッシュボードを 1 つ以上選んでください。")
    if len(items) > MAX_SET_ITEMS:
        raise LayoutError(f"セットに入れられるダッシュボードは {MAX_SET_ITEMS} までです。")
    out = {"items": items}
    return out, json.dumps(out, ensure_ascii=False)


def clean_set_row(data, login, partial=False):
    """画面から来た値 → マスタ dashboards の行（元 dashset。名前・範囲・標準はダッシュボードと同じ決まり）"""
    try:
        return clean_row({**(data or {}), "source": SET_SOURCE}, login, partial,
                                       body_text=lambda b: clean_set_body(b)[1], source_ok=lambda s: s == SET_SOURCE)
    except PresetError as e:
        raise LayoutError(str(e)) from None


def set_view(row, login="", common_ok=False, default_ok=False):
    v = view(row, login, common_ok, default_ok, body_of=lambda t: clean_set_body(t)[0])
    return v if v["body"] else {**v, "body": {"items": []}}


# ---------------------------------------------------------------- 組み込みのダッシュボード（共通デフォルト。開発者がコードに書く）
# §9.628: 前の生産管理ダッシュボードの3つの画面（稼働状況・自設備・自由集計）を、同じグリッドのパネルで作り直した（機能を減らさない）。
# 元は鍵ではなく役割（role:仕掛）と rec（測定データ）・plan（作業予定）で書く——データソースのキーを変えても同じ表が開く。
# 自設備の設備は MINE（この端末の使用設備。画面が問い合わせる前に置き換える・static/js/dash/dashboard.js）。
MINE = "@mine"
WORK_TIME = "作業時間（分）"


def _pv(pid, x, y, w, h, title, visual, source, rows=(), cols=(), measures=({"agg": "lots"},), grand=None, **kw):
    return {"id": pid, "x": x, "y": y, "w": w, "h": h, "title": title, "visual": visual, "source": source,
            "body": {"rows": list(rows), "cols": list(cols), "measures": list(measures), "grand": visual in ("none", "kpi") if grand is None else grand,
                     "labels": True}, **kw}


# 組み込みの書式（§9.628 の採点）: 積み上げは段の数も（合計だけでは内訳が乗せないと分からない）・平均の分は整数（58.33 分と出ていた）
STACK_LABELS = {"labels": "both"}
WHOLE_MIN = {"digits": 0}
UNIT_EQUIP = {"utext": "台"}


def _f(column, op, value):
    return {"column": column, "op": op, "value": value}


def _days(n):
    return {"column": "@workday", "kind": "days", "n": n}


def _bgroup(title, measure):
    """自設備の合わせた表のまとまり 1 つ（直近 30 日の完了・棒。設備は表全体の equips＝この端末の設備）"""
    return {"title": title, "source": "rec", "equip": "", "filters": [DONE], "search": "", "period": _days(30), "basis": "work",
            "measure": measure, "cols": [], "look": "bar", "total": False, "zero": False, "color": ""}


def _side(role, title, equips):
    """自設備の比べるデータ 1 つ（直近 30 日の完了の平均作業時間）"""
    return {"title": title, "role": role, "build": "as", "source": "rec", "equips": list(equips), "filters": [DONE], "search": "",
            "period": _days(30), "basis": "work", "key": {"column": "状態", "part": ""}, "measure": {"agg": "avg", "column": WORK_TIME}}


def _status_board():
    """稼働状況の表（前の画面の「設備の稼働状況」）: 設備ごとの予定・作業中・完了の件数、残りの見込、遅れのいちばん長い作業"""
    def g(title, measure, look, filters=(), cols=(), **kw):
        return {"title": title, "source": "plan", "equip": "", "filters": list(filters), "search": "", "period": None, "basis": "work",
                "measure": measure, "cols": list(cols), "look": look, "total": True, "zero": False, "color": "", **kw}
    return {"rows": {"column": "@equip", "part": ""},
            "groups": [g("予定の件数", {"agg": "count"}, "stack", cols=[{"column": "状態", "part": ""}]),
                       g("残りの見込", {"agg": "sum", "column": "見積（分）"}, "bar", [_f("状態", "eq", "予定")]),
                       g("遅れ", {"agg": "max", "column": "遅れ（分）"}, "signal", limits={"warn": 1, "alert": 60, "dir": "high"})],
            "order": {"by": "value", "group": 2, "dir": "desc", "list": [], "hide": []}}


# ★標準が無いときに開く組み込み（§9.630 ④: 「生産の状況」。前は稼働状況・§9.64）
BUILTIN_DEFAULT = "b:home"
TODAY = {"column": "@workday", "kind": "today"}
THIS_MONTH = {"column": "@workday", "kind": "this_month"}
# 品種（§9.630 ④ 利用者の指示）: 用途名 × 縦割り数（丈数）× 横割り数（条数）。ABC 分析は 3 つの列の組み合わせで分ける
KIND_COLS = ["用途名", "縦割り数（丈数）", "横割り数（条数）"]
# 生産性: 良品重量の合計 ÷ 作業時間の合計（分）× 60 ＝ kg/時（aggregate の ratio。1 行ずつの比の平均にしない）
PRODUCTIVITY = {"agg": "ratio", "column": "良品重量", "per": WORK_TIME, "expr": "×60", "dec": 1}

BUILTIN_LAYOUTS = [
    # 最初の画面（BUILTIN_DEFAULT・§9.630 ④）: いまの作業（作業中のロットか設備停止と予定完了）・本日と今月の数・予定と実績のガント・今月の ABC
    {"key": "home", "name": "生産の状況", "body": {"rows": 8, "panels": [
        _pv("todayLots", 0, 0, 3, 1, "本日の作業ロット", "kpi", "rec", period=TODAY),
        _pv("todayWeight", 3, 0, 3, 1, "本日の良品重量", "kpi", "rec", measures=[{"agg": "sum", "column": "良品重量"}], period=TODAY, fmt={"utext": "kg"}),
        _pv("monthLots", 6, 0, 3, 1, "今月の作業本数", "kpi", "rec", period=THIS_MONTH, fmt={"utext": "本"}),
        _pv("monthRate", 9, 0, 3, 1, "今月の生産性", "kpi", "rec", measures=[PRODUCTIVITY], period=THIS_MONTH, fmt={"utext": "kg/時"}),
        _pv("now", 0, 1, 4, 3, "いまの作業", "now", "plan", measures=[{"agg": "count"}]),
        _pv("planGantt", 4, 1, 8, 3, "きょうの予定と実績", "gantt", "plan", measures=[{"agg": "count"}], period=TODAY, ops={"plan": True}),
        _pv("monthAbc", 0, 4, 12, 4, "今月の品種の ABC 分析（用途名 × 丈数 × 条数）", "abc", "rec", measures=[{"agg": "count"}], period=THIS_MONTH,
            ops={"cls": KIND_COLS, "qty": "lots"}),
    ]}},
    # 前の既定（§9.64）。前の「稼働状況」: 作業予定と進み具合（予定・作業中・遅れ）と、きょうの作業の棒（ガント）
    {"key": "status", "name": "稼働状況", "body": {"rows": 8, "panels": [
        _pv("running", 0, 0, 3, 1, "稼働中の設備", "kpi", "plan", measures=[{"agg": "distinct", "column": "設備名"}], filters=[_f("状態", "eq", "着手")],
            fmt=UNIT_EQUIP),
        _pv("pending", 3, 0, 3, 1, "残っている予定", "kpi", "plan", measures=[{"agg": "count"}], filters=[_f("状態", "eq", "予定")]),
        _pv("late", 6, 0, 3, 1, "遅れている設備", "kpi", "plan", measures=[{"agg": "distinct", "column": "設備名"}], filters=[_f("遅れ（分）", "gt", "0")], fmt=UNIT_EQUIP),
        _pv("doneToday", 9, 0, 3, 1, "本日の完了", "kpi", "rec", period={"column": "@workday", "kind": "today"}, filters=[DONE]),
        {"id": "board", "x": 0, "y": 1, "w": 6, "h": 3, "title": "設備の稼働状況", "visual": "board", "noTotal": True, **_status_board()},
        _pv("gantt", 6, 1, 6, 3, "きょうの作業", "gantt", "rec", measures=[{"agg": "count"}],
            period={"column": "@workday", "kind": "today"}),
        # 表とガントは中身なりの高さ。空いた下の段に直近の完了を設備ごとに（§9.628 の採点: 上の 2 枚の下が 6 割空いていた）
        _pv("trend14", 0, 4, 12, 4, "直近 14 日の完了（本・設備ごと）", "time", "rec", rows=[{"column": "@workday"}], cols=[{"column": "@equip"}],
            period=_days(14), filters=[DONE], fmt=STACK_LABELS),
    ]}},
    # いまの仕掛と前日・今月の完了をスクロールせずに見る（LotScope の「標準」と同じ並び。名前は中身で言う）
    {"key": "standard", "name": "仕掛と完了", "body": {"rows": 8, "panels": [
        _pv("wipTotal", 0, 0, 4, 1, "仕掛ロット数", "kpi", "role:仕掛"),
        _pv("workTotal", 4, 0, 4, 1, "前日の完了", "kpi", "rec", period=YESTERDAY, filters=[DONE]),
        _pv("workMonth", 8, 0, 4, 1, "今月の完了", "kpi", "rec", period={"column": "@workday", "kind": "this_month"}, filters=[DONE]),
        # 縦棒（§9.628 の 9 回目の採点で Y4・82 点。横棒は用途名が少ないとパネルの 7 割が空いた）
        _pv("wipPurpose", 0, 1, 5, 4, "用途名ごとの仕掛ロット数", "column", "role:仕掛", rows=[{"column": "用途名"}], sort="desc", top=15),
        _pv("workDays", 0, 5, 12, 3, "直近 14 日の完了（本）", "time", "rec", rows=[{"column": "@workday"}], period=_days(14), filters=[DONE]),
        {"id": "board", "x": 5, "y": 1, "w": 7, "h": 4, "title": "設備ごとの仕掛と前日の実績", "visual": "board", "noTotal": True, **board_default()},
    ]}},
    # 前の「自設備」: この端末の使用設備にしぼった直近 30 日の完了の実績
    {"key": "mine", "name": "自設備", "body": {"rows": 8, "panels": [
        _pv("mineLots", 0, 0, 3, 1, "完了ロット", "kpi", "rec", equips=[MINE], period=_days(30), filters=[DONE]),
        _pv("mineSum", 3, 0, 3, 1, "合計作業時間", "kpi", "rec", measures=[{"agg": "sum", "column": WORK_TIME}], equips=[MINE], period=_days(30), filters=[DONE]),
        # 前の画面の「全設備平均との差（速い・遅い）」: この端末の設備の平均を実績、全設備の平均を基準に合わせ、差を添える
        _pv("mineAvg", 6, 0, 3, 1, "平均作業時間", "kpi", "rec", measures=[{"agg": "avg", "column": WORK_TIME}],
            link={"sides": [_side("actual", "この端末の設備", [MINE]), _side("base", "全設備", [])], "extra": ["diff"]}),
        _pv("mineDays", 9, 0, 3, 1, "作業した日", "kpi", "rec", measures=[{"agg": "distinct", "column": "作業日"}], equips=[MINE], period=_days(30), filters=[DONE],
            fmt={"utext": "日"}),
        _pv("mineKind", 0, 1, 6, 4, "品種ごとの平均作業時間（分）", "bar", "rec", rows=[{"column": "品種"}], measures=[{"agg": "avg", "column": WORK_TIME}],
            equips=[MINE], period=_days(30), filters=[DONE], sort="desc", top=12, fmt=WHOLE_MIN),
        # オペレータごと: 合わせた表（ロット数と平均作業時間を棒で。前は数字だけの表で、隣の棒グラフと見比べにくかった・§9.628 の 7 回目の採点）。
        # 計は上の数字のパネル（完了ロット・平均作業時間）が言う（同じ数を 2 か所に出さない）
        {"id": "mineOp", "x": 6, "y": 1, "w": 6, "h": 4, "title": "オペレータごとの実績", "visual": "board", "noTotal": True, "equips": [MINE],
         "rows": {"column": "オペレータ", "part": ""},
         "groups": [_bgroup("完了ロット数", {"agg": "lots"}), _bgroup("平均作業時間", {"agg": "avg", "column": WORK_TIME})],
         "order": {"by": "value", "group": 0, "dir": "desc", "list": [], "hide": []}},
        _pv("mineTrend", 0, 5, 12, 3, "日ごとの完了（本）", "time", "rec", rows=[{"column": "@workday"}], equips=[MINE], period=_days(30), filters=[DONE]),
    ]}},
    # 前の「自由集計」の4つのよく使う組み合わせ（設備別効率・人数別内訳・品種別作業時間・月次推移）。自由な組み合わせはパネルを直して作る
    {"key": "analysis", "name": "作業時間の分析", "body": {"rows": 8, "panels": [
        _pv("eqEff", 0, 0, 6, 4, "設備ごとの平均作業時間（分・人数ごと）", "column", "rec", rows=[{"column": "@equip"}], cols=[{"column": "作業人数"}],
            measures=[{"agg": "avg", "column": WORK_TIME}], period={"column": "@workday", "kind": "this_month"}, filters=[DONE], fmt=WHOLE_MIN),
        # 隣の「設備ごとの平均作業時間」と同じ軸（横＝設備・色＝人数）。前は横が人数・色が設備で、2 枚を見比べるとき軸を読み替えた（§9.628 の 7 回目の採点）
        _pv("crew", 6, 0, 6, 4, "設備ごとの完了（本・人数ごと）", "stack", "rec", rows=[{"column": "@equip"}], cols=[{"column": "作業人数"}],
            period={"column": "@workday", "kind": "this_month"}, filters=[DONE], fmt=STACK_LABELS),
        _pv("kind", 0, 4, 6, 4, "品種ごとの平均作業時間（分）", "bar", "rec", rows=[{"column": "品種"}], measures=[{"agg": "avg", "column": WORK_TIME}],
            period={"column": "@workday", "kind": "this_month"}, filters=[DONE], sort="desc", top=15, fmt=WHOLE_MIN),
        _pv("monthly", 6, 4, 6, 4, "月ごとの推移（本）", "time", "rec", rows=[{"column": "@workday", "part": "ym"}], cols=[{"column": "@equip"}],
            period=_days(365), filters=[DONE], fmt=STACK_LABELS),
    ]}},
]


BUILTIN_KEYS = tuple(b["key"] for b in BUILTIN_LAYOUTS)


def builtin_layouts(skip=()):
    """組み込みのダッシュボード → 画面の形（id は "b:鍵"。中身はコードの物）。skip … 出さない組み込みの鍵（外した・入れ替えた物）"""
    return [{"id": f"b:{b['key']}", "name": b["name"], "source": LAYOUT_SOURCE, "scope": "default", "login": "", "standard": False,
             "body": clean_layout(b["body"])[0], "note": "", "rev": 0, "updatedAt": "", "updatedBy": {}, "canEdit": False, "builtin": True}
            for b in BUILTIN_LAYOUTS if b["key"] not in skip]


# ---------------------------------------------------------------- 組み込みを外す・入れ替える（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 1）
# 組み込み（コードに書いた標準）は、次の 2 つで一覧から退ける（コードは書き換えない。消した物は戻せる）:
#   入れ替える … 組み込みを直して保存すると、中身に replaces（組み込みの鍵）を持つダッシュボードとして置き、その組み込みの代わりに出す
#                （セットのタブ "b:鍵" もそれを開く）。置き場は共通デフォルト（開発者＝全員）か自分の ID（自分だけ）
#   外す     … マスタ dashboards の元 "dashoff" の行（中身 {keys: [外す組み込みの鍵]}）。共通デフォルト（開発者＝全員）・自分の ID（自分だけ）
HIDE_SOURCE = "dashoff"
HIDE_NAME = "外した組み込み"


def clean_hide_body(body):
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except ValueError:
            body = {}
    keys = [k for k in dict.fromkeys(str(x) for x in ((body or {}).get("keys") or []) if isinstance(body, dict)) if k in BUILTIN_KEYS]
    out = {"keys": keys}
    return out, json.dumps(out, ensure_ascii=False)


def clean_hide_row(data, login):
    try:
        return clean_row({**(data or {}), "source": HIDE_SOURCE}, login, False,
                                       body_text=lambda b: clean_hide_body(b)[1], source_ok=lambda s: s == HIDE_SOURCE)
    except PresetError as e:
        raise LayoutError(str(e)) from None


def hidden_rows(rows, login):
    """この ID に効く「外した組み込み」の行（共通デフォルト・自分の ID）"""
    return [r for r in rows if r.get("元") == HIDE_SOURCE and visible(r, login)]


def builtin_skip(rows, login):
    """一覧に出さない組み込みの鍵 → (外した鍵 {鍵: 範囲}, 入れ替えた鍵 set)。rows はマスタの行（見える物だけを見る）"""
    off = {}
    for r in hidden_rows(rows, login):
        for k in clean_hide_body(r.get("中身") or "{}")[0]["keys"]:
            off.setdefault(k, scope_of(r))
    swapped = set()
    for r in rows:
        if r.get("元") == LAYOUT_SOURCE and visible(r, login):
            try:
                k = json.loads(r.get("中身") or "{}").get("replaces")
            except (TypeError, ValueError, AttributeError):
                k = None
            if k in BUILTIN_KEYS:
                swapped.add(k)
            elif builtin_named(r):            # 版 3.49.0 より前に、組み込みと同じ名前で置いた物も入れ替えた物として扱う
                swapped.add(builtin_named(r))
    return off, swapped
