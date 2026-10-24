# -*- coding: utf-8 -*-
"""ops.py: 設備の稼働（§9.628。LotScope の services/operation.py）。作業の記録（測定データ・作業予定）の作業開始・作業終了から、設備ごとの
稼働の区間（ガントチャート）・勤務時間・稼働率と、品種ごとの ABC 分析・換算係数を数える。画面は static/js/dash/dash-ops.js（gantt・abc）。
勤務時間と作業日・直は勤務体系の1箇所（`shifts.Clock`＝作業スケジュールの`resolve_shift_info()`）から決める。

作業（1 本）
    作業開始が同じ行は、その工程で幅・丈で分割したロット（作業は 1 回。work_summary と同じ決まり）。作業の区間は
    [作業開始, その行たちの作業終了のいちばん遅い時刻)。作業終了が無い・作業開始より前・MAX_HOURS を超える作業は区間を持たない（noEnd に数え、
    理由ごとの数を why に。版 3.47.0）。日時は選んだ列 → 同じ言葉のほかの日時の列（年月日時分秒）→ 日付＋時刻の列の順に読む（stamp_columns）。
    日を跨いだ作業で作業終了の日付が作業開始の日のままなら翌日と読む
ガントの見る範囲（版 3.48.0）
    期間（既定は前日）の作業日の区切り（work_days。現場歴なら交替勤務の 7:00〜翌 7:00・太陽暦なら 0 時〜翌 0 時）。範囲の外へ出る作業は端で切る。
    期間より前に始まって期間にも動いている作業（carry）と、作業終了がまだ無い
    いちばん新しい作業（running: いままで）も棒にする（数・作業時間・換算係数には入れない）
稼働率（利用者が決めた: 分母は勤務時間＝直の時間）
    勤務時間 … その設備の勤務体系（マスタ管理の「勤務体系」。設備を書いた体系 → 全設備共通）の区分を、期間の作業日（現場歴か太陽暦）ごとに並べた時間。
               日を跨ぐ区分は 0 時で 2 つに分け、それぞれの作業日を shifts.Clock.place で決める（作業日・直の決め方と同じ 1 か所）
    稼働時間 … 作業の区間を重ねて（同じ時刻に 2 つ動いても 1 と数える）、勤務時間と重なる分。勤務時間の外の稼働は outside に別に数える
    稼働率   … 稼働時間 ÷ 勤務時間。勤務体系が無い設備は出さない（None）
換算係数（利用者が決めた: 作業時間から自動で出す）
    品種（選んだ列の値か、いくつかの列の値の組み合わせ。合金・板厚の区分など）ごとの 1 本あたりの平均作業時間 ÷ 基準の作業時間。基準は
    avg（その設備の全作業の 1 本あたりの平均）・top（いちばん本数の多い品種の平均）・値（その品種の平均）。換算量＝本数 × 係数
ABC 分析
    品種を量（本数・作業時間・数の列の合計）の大きい順に並べ、累積構成比が A の線（既定 70%）までを A、B の線（既定 90%）までを B、残りを C
全設備の作業時間（版 3.48.0）
    各設備の作業時間の積み上げ（sum）か、ロットごとのリードタイム（lead: 全設備の作業開始の MIN〜作業終了の MAX。lead_ops）
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta

from ..datetext import to_datetime
from ..sqlite_io import qi, tables
from . import answer, sources
from .layout import abc_lims
from .pivot import PERIODS, PivotError, calc_exprs, columns, connect_ro, lot_column, period_prefilter, period_range, pick_table, search_filter_where
from .shifts import Clock
from .values import start_column, time_column, work_key

_HM = re.compile(r"^(\d{1,2}):(\d{2})")


def hm(v):
    """'8:15' → 495（0 時からの分）。読めなければ 0（勤務区分の時刻はマスタが確かめてある）。"""
    m = _HM.match(str(v or "").strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else 0

END_CANDIDATES = ("BOX実績_作業終了_日付", "作業終了日時", "作業終了")
MAX_HOURS = 168           # 1 作業の長さの上限（これより長いのは読み違い・書き忘れとみなし、区間を持たせない）。版 3.47.0 で 48 → 168（7 日）: 焼鈍炉（BOX）の
                          # 1 回の作業は 20〜60 時間で、48 時間を超える作業の作業時間・棒が出なかった
MAX_OPS = 1500            # 1 台のガントに出す作業の数（答えの大きさ）。超えた分は数には入れ、棒は出さない（truncated）
MAX_DAYS = 62             # ガントの期間の上限（作業日）
MAX_ROWS = 400_000
QTYS = ("lots", "time")   # 量: 本数・作業時間（分）。ほかは数の列の名前（その列の合計）
BASES = ("avg", "top")    # 換算の基準。ほかは品種の値


def end_column(cs, preferred="", start=""):
    """作業終了の列: 選んだ列（あれば）→ 既定の名前 → 作業開始の列の「開始」を「終了」にした名前 → 「作業終了」を含む日付・日時の列。無ければ ""。"""
    if preferred and preferred in cs:
        return preferred
    for c in END_CANDIDATES:
        if c in cs:
            return c
    if start and "開始" in start and start.replace("開始", "終了") in cs:
        return start.replace("開始", "終了")
    return next((c for c in cs if "作業終了" in c and ("日付" in c or "日時" in c)), "")


def _dt(stamp):
    """'YYYY-MM-DD HH:MM:SS' → datetime（時刻の無い日付・読めない字は None）"""
    if not stamp or len(stamp) < 16:
        return None
    try:
        return datetime.fromisoformat(stamp)
    except ValueError:
        return None


def _iso(t):
    return t.strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 勤務時間（直の時間帯）
def shift_windows(clock, first, last, basis="work"):
    """作業日 first〜last（'YYYY-MM-DD'。両端を含む）の勤務時間 → [(始め, 終わり, 区分の名前, 作業日)]（始めの順）。
    日を跨ぐ区分は 0 時で分け、分けたそれぞれの作業日を Clock.place で決める（作業日・直の決め方と同じ）。clock … 設備の勤務体系（shifts.Clock）"""
    segments = clock.segments
    lo, hi = date.fromisoformat(first), date.fromisoformat(last)
    out = []
    d = lo - timedelta(days=1)
    while d <= hi + timedelta(days=1):
        base = datetime(d.year, d.month, d.day)
        for seg in segments:
            s, e = hm(seg["start"]), hm(seg["end"])
            a, b = base + timedelta(minutes=s), base + timedelta(minutes=e if e > s else e + 24 * 60)
            pieces = [(a, b)] if e > s else [(a, base + timedelta(days=1)), (base + timedelta(days=1), b)]
            for x, y in pieces:
                if x >= y:
                    continue
                day, _ = clock.place(_iso(x), basis)
                if first <= day <= last:
                    out.append((x, y, seg["name"], day))
        d += timedelta(days=1)
    out.sort(key=lambda w: w[0])
    return out


def work_days(clock, first, last, basis="work"):
    """作業日 first〜last（両端を含む）の区切り → [(始め, 終わり, 作業日)]（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 4）。
    現場歴（basis="work"）は、その作業日に入る時刻（Clock.place で同じ日になる時刻）の始め〜次の作業日の始め（交替勤務なら 7:00〜翌 7:00）。
    太陽暦・勤務体系が無ければ 0 時〜翌 0 時。区分の始め・終わりの時刻の間は作業日が変わらないので、その時刻だけを調べる"""
    segments = clock.segments
    lo, hi = date.fromisoformat(first), date.fromisoformat(last)
    marks = sorted({0} | {hm(s["start"]) for s in segments} | {hm(s["end"]) for s in segments}) if segments and basis == "work" else [0]

    def begin(d):
        for c in (d - timedelta(days=1), d, d + timedelta(days=1)):
            base = datetime(c.year, c.month, c.day)
            for m in marks:
                t = base + timedelta(minutes=m)
                if clock.place(_iso(t), basis)[0] == d.isoformat():
                    return t
        return datetime(d.year, d.month, d.day)
    out, d = [], lo
    while d <= hi:
        out.append((begin(d), begin(d + timedelta(days=1)), d.isoformat()))
        d += timedelta(days=1)
    return out


def merge(spans):
    """区間 [(始め, 終わり)] を重ねる（同じ時刻に 2 つの作業が動いても 1 と数える）"""
    out = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            if b > out[-1][1]:
                out[-1][1] = b
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def overlap_minutes(spans, a, b):
    """重ねた区間 spans と [a, b) の重なり（分）"""
    t = 0.0
    for x, y in spans:
        lo, hi = max(x, a), min(y, b)
        if hi > lo:
            t += (hi - lo).total_seconds() / 60
    return t


def utilization(ops, windows, clip=None):
    """作業の並び（start・end を持つ dict）と勤務時間 → {shiftMin, busyMin, outsideMin, rate, byShift: [{day, shift, min, busy, rate}]}。
    clip（見る範囲 (始め, 終わり)）… 勤務時間の外の稼働（outside）を、その範囲の中だけで数える（期間より前から続く作業の前の分を入れない）"""
    spans = merge([(o["start"], o["end"]) for o in ops if o.get("end") and o.get("start")])
    if clip:
        spans = [(max(a, clip[0]), min(b, clip[1])) for a, b in spans if b > clip[0] and a < clip[1]]
    shift_min = sum((b - a).total_seconds() / 60 for a, b, _, _ in windows)
    by = {}
    for a, b, name, day in windows:
        x = by.setdefault((day, name), {"day": day, "shift": name, "min": 0.0, "busy": 0.0})
        x["min"] += (b - a).total_seconds() / 60
        x["busy"] += overlap_minutes(spans, a, b)
    busy = sum(x["busy"] for x in by.values())
    total = sum((b - a).total_seconds() / 60 for a, b in spans)       # 期間の作業（作業日で選んだ作業）の稼働のすべて
    rows = []
    for x in by.values():
        rows.append({**x, "min": round(x["min"], 2), "busy": round(x["busy"], 2), "rate": round(x["busy"] / x["min"], 4) if x["min"] else None})
    return {"shiftMin": round(shift_min, 2), "busyMin": round(busy, 2), "outsideMin": round(max(0.0, total - busy), 2),
            "rate": round(busy / shift_min, 4) if shift_min else None, "byShift": rows}


# ---------------------------------------------------------------- 作業を読む
# 日時を読む列（版 3.47.0。利用者の要望 2026-10-21 の 2 回目の 1・4。tools/ops-bench.py で設備ごとの書き方を確かめる）:
#   選んだ（見つけた）列で時刻まで読めない行は、同じ言葉（作業開始・作業終了）を持つほかの日付・日時の列（WaveLog の BOX実績_作業終了_年月日時分秒 など）、
#   日付と別の時刻の列の組（〜日付 ＋ 〜時刻）の順に読む。Access・Excel の日時の数（46297.34375）も読む。
#   前は選んだ列が日付だけ・14 桁・日時の数の設備で、作業が 1 つも区間を持たず、ガントの棒も換算係数も出なかった
SERIAL_RANGE = (20000.0, 80000.0)      # 日時の数として読む範囲（1954〜2119 年）
WHY = {"blank": "作業終了が空", "notime": "作業終了に時刻が無い", "unread": "作業終了が日時と読めない", "before": "作業終了が作業開始より前",
       "long": f"{MAX_HOURS // 24} 日より長い", "nostart": "作業開始が日時と読めない", "last": "最後の作業の作業終了が空"}
WHY_RANK = {"": 0, "blank": 1, "unread": 2, "notime": 3}


def stamp_columns(cs, first, word):
    """日時を読む列の順 → [(列, 時刻の列 か "")]: first → word（作業開始・作業終了）を持つほかの日付・日時の列（時刻の列そのものは除く）"""
    others = [c for c in cs if c != first and word in c and any(k in c for k in ("日付", "日時", "時分秒"))]
    return [(c, time_column(cs, c)) for c in dict.fromkeys([first] + others) if c]


def _serial(v):
    """日時の数（1899/12/30 からの日数。小数は時刻）→ 'YYYY-MM-DD HH:MM:SS'（範囲の外・数でない字は None）"""
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    if not SERIAL_RANGE[0] <= f < SERIAL_RANGE[1] or (isinstance(v, str) and "." not in v):
        return None
    return _iso(datetime(1899, 12, 30) + timedelta(seconds=round(f * 86400)))


def read_stamp(vals):
    """列の組の値 [(値, 時刻の値)] → (日時 か None, 日付だけの字 か "", 何が読めなかったか: "" / "blank" / "notime" / "unread")"""
    day, why = "", "blank"
    for v, t in vals:
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        stamp = to_datetime(v, t) if isinstance(v, str) or t else (_serial(v) or to_datetime(v, t))
        if stamp and len(stamp) == 10 and isinstance(v, str) and "." in v:
            stamp = _serial(v) or stamp
        dt = _dt(stamp)
        if dt is not None:
            return dt, stamp[:10], ""
        if stamp:
            day, why = day or stamp, "notime"
        elif why == "blank":
            why = "unread"
    return None, day, why


def read_ops(part, *, search="", filters="", today=None, calc=None, period=None, now=None, end="", cols=(), reach=False, start="", lots=False, around=0):
    """1 つの表（1 設備）→ {ops: [{start, end, key, n, values: {列: 最初の行の値}, nums: {列: 合計}, why, carry, running}], columns, start, end, range}。
    期間 period は作業日（@workday）か日付の列。作業日の範囲（range）に作業開始の作業日が入る作業だけ。cols … 作業ごとに持たせる列。
    reach（ガント）… 期間より前に始まって期間にも動いている作業（carry）と、作業終了がまだ無いいちばん新しい作業（running: いままで動いている）も読む。
    start・end … 作業開始・作業終了の列（"" は見つける）。
    lots（リードタイム）… 作業ごとに、入っているロット番号 → その行の数の列の値 {列: 値} を lots に持つ。
    around（リードタイム）… 期間の前後 around 日の作業も読み、前を carry・後を after の印にする（期間をまたぐロットの
    最初の作業開始・その後の作業を知るため。数・作業時間には入れない）"""
    work = part.work or {}
    now = now or datetime.now()
    r = _read_rows(part, work, search=search, filters=filters, today=today, calc=calc, period=period, now=now, end=end, cols=cols,
                   reach=reach, start=start, around=around)
    ops, last_any = _gather(r, work.get("clock") or Clock([]), work.get("basis", "work"), period, reach, around, lots)
    out = _settle(ops, reach, last_any, now)
    return {"ops": out, "columns": r["cs"], "start": r["start"], "end": r["stop"], "range": r["span"], "lot": r["lot"]}


_BACK = timedelta(hours=MAX_HOURS) + timedelta(days=1)       # ガントで期間より前に読む長さ（期間に続く作業の始まり）


def _span_of(period, work, now):
    clock, basis = work.get("clock") or Clock([]), work.get("basis", "work")
    day = clock.place(now.strftime("%Y-%m-%d %H:%M:%S"), basis)[0] if period["column"] == "@workday" else now.date().isoformat()
    return period_range(period["kind"], period.get("n"), day or now.date().isoformat(), period.get("from", ""), period.get("to", ""))


def _read_rows(part, work, *, search, filters, today, calc, period, now, end, cols, reach, start, around):
    """表を開いて、作業を組み立てるのに要る列だけを読む → 読んだ行と列の並びの dict"""
    with connect_ro(part.path) as c:
        names = tables(c)
        t = part.table if part.table in names else pick_table(names, part.preferred_table, part.table_candidates)
        if not t:
            raise PivotError("表が 1 つもありません。")
        raw = columns(c, t, part.path)
        exprs, broken, _ = calc_exprs(c, calc, raw)
        cs = raw + [x for x in exprs if x not in raw]
        start = start_column(cs, start or work.get("start", ""))
        if not start:
            raise PivotError("作業開始の列がありません（測定データ・作業予定で使えます。組む所の「作業開始」で選んでください）。")
        stop = end_column(cs, end, start)
        if not stop:
            raise PivotError("作業終了の列が見つかりません（組む所の「作業終了の列」で選んでください）。")
        s_cols, e_cols = stamp_columns(cs, start, "作業開始"), stamp_columns(cs, stop, "作業終了")
        lot = lot_column(cs)
        want = [x for x in dict.fromkeys(list(cols) + [lot]) if x and x in cs]      # ロット番号はいつも（棒の字の既定）
        bad = [x for x in want if x in broken]
        if bad:
            raise PivotError(f"計算列「{'」「'.join(bad)}」の式が読めません（一覧の「表示列」で式を直してください）。")
        where_parts, params = search_filter_where(raw, search, filters, today, exprs)
        span = _span_of(period, work, now) if period else None
        if period:
            pcol = start if period["column"] == "@workday" else period["column"]
            if pcol not in cs:
                raise PivotError(f"期間で絞る列「{pcol}」がありません。")
            if pcol in raw:
                lo = (date.fromisoformat(span[0]) - (timedelta(days=around) if around else _BACK)).isoformat()[:10] if reach or around else span[0]
                hi = (date.fromisoformat(span[1]) + timedelta(days=around)).isoformat() if around else span[1]
                w, wp = period_prefilter(pcol, (lo, hi))
                if w:
                    where_parts, params = where_parts + [w], params + wp
        where = (" WHERE " + " AND ".join(where_parts)) if where_parts else ""
        n = int(c.execute(f"SELECT COUNT(*) FROM {qi(t)}{where}", params).fetchone()[0])
        if n > MAX_ROWS:
            raise PivotError(f"当たる行が多すぎます（{n:,} 行。{MAX_ROWS:,} 行まで）。期間・条件で絞ってください。")
        pc = period["column"] if period and period["column"] not in ("@workday", start) else ""
        sel = [x for pair in s_cols + e_cols for x in pair] + want + ([pc] if pc else [])
        data = c.execute(f"SELECT {', '.join(exprs.get(x) or qi(x) if x else 'NULL' for x in sel)} FROM {qi(t)}{where}", params).fetchall()
    return {"data": data, "s_cols": s_cols, "e_cols": e_cols, "want": want, "lot": lot, "span": span, "pc": pc, "cs": cs, "start": start, "stop": stop}


def _pairs(row, a, k):
    return [(row[a + 2 * i], row[a + 2 * i + 1]) for i in range(k)]


def _gather(r, clock, basis, period, reach, around, lots):
    """読んだ行 → 作業（作業開始が同じ行は 1 作業）の dict と、いちばん新しい作業開始"""
    s_cols, e_cols, want, lot, span, pc = r["s_cols"], r["e_cols"], r["want"], r["lot"], r["span"], r["pc"]
    ns, ne = len(s_cols) * 2, len(e_cols) * 2
    ops = {}
    lo_carry = (datetime.fromisoformat(span[0]) - (timedelta(days=around) if around else _BACK)).date().isoformat() if span and (reach or around) else ""
    hi_after = (date.fromisoformat(span[1]) + timedelta(days=around)).isoformat() if span and around else ""
    last_any = None                       # 読んだ行でいちばん新しい作業開始（いま動いている作業を決める）
    for row in r["data"]:
        s_dt, s_day, _ = read_stamp(_pairs(row, 0, len(s_cols)))
        stamp = _iso(s_dt) if s_dt else s_day
        if s_dt and (last_any is None or s_dt > last_any):
            last_any = s_dt
        carry = after = False
        if period:
            day = (to_datetime(row[ns + ne + len(want)]) or "")[:10] if pc else (clock.place(stamp, basis)[0] if stamp else "")
            if not day:
                continue
            if not span[0] <= day <= span[1]:
                if (reach or around) and lo_carry <= day < span[0] and s_dt:
                    carry = True
                elif around and span[1] < day <= hi_after and s_dt:
                    after = True
                else:
                    continue
        k = (stamp if s_dt else work_key(row[0], row[1])) or f"#{len(ops)}"     # 作業開始が空の行は 1 行で 1 作業
        o = ops.get(k)
        if o is None:
            o = ops[k] = {"key": k, "start": s_dt, "end": None, "n": 0, "values": {}, "nums": {}, "day": clock.place(stamp, basis)[0] if stamp else "",
                          "why": "" if s_dt else "nostart", "carry": carry, **({"after": True} if after else {})}
        _take_row(o, row, ns, ne, len(e_cols), want, lot if lots else "")
    return ops, last_any


def _take_row(o, row, ns, ne, n_end, want, lot):
    """1 行を作業 o へ足す（作業終了のいちばん遅い時刻・理由・ロットごとの値・列の値と数の合計）"""
    o["n"] += 1
    e, _, why = read_stamp(_pairs(row, ns, n_end))
    if e is not None and o["start"] is not None and e < o["start"] and e.date() == o["start"].date():
        e = e + timedelta(days=1)          # 日を跨いだ作業で、作業終了の日付が作業開始の日のまま（時刻だけが翌日）
    if e is not None and (o["end"] is None or e > o["end"]):
        o["end"] = e
    elif e is None and o["end"] is None and WHY_RANK.get(why, 0) > WHY_RANK.get(o["why"], 0):
        o["why"] = why                     # 分割した行のうち、いちばん分かることの多い理由（時刻が無い ＞ 読めない ＞ 空）
    if lot:
        ln = str(row[ns + ne + want.index(lot)] or "").strip()
        if ln:
            o.setdefault("lots", {}).setdefault(ln, {c: row[ns + ne + i] for i, c in enumerate(want)})
    for i, col in enumerate(want):
        v = row[ns + ne + i]
        o["values"].setdefault(col, v)
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        o["nums"][col] = o["nums"].get(col, 0.0) + f


def _settle(ops, reach, last_any, now):
    """作業の区間を決める（作業終了が無い・前・長すぎる作業は区間を持たない）→ 作業開始の順の並び"""
    out = []
    for o in ops.values():
        if o["start"] is None:
            o.update(end=None, why="nostart")
        elif o["end"] is not None:
            o["why"] = "before" if o["end"] <= o["start"] else "long" if o["end"] - o["start"] > timedelta(hours=MAX_HOURS) else ""
            if o["why"]:
                o["end"] = None
        elif not o["why"]:
            o["why"] = "blank"
        out.append(o)
    out.sort(key=lambda o: (o["start"] is None, o["start"] or datetime.min))
    # いま動いている作業: 読んだ中でいちばん新しく始まり、作業終了がまだ空で、始まって MAX_HOURS 以内（いままでの区間にする）
    newest = next((o for o in reversed(out) if o["start"] is not None), None)
    if reach and newest and newest["end"] is None and newest["why"] == "blank" and newest["start"] == last_any \
            and timedelta(0) < now - newest["start"] <= timedelta(hours=MAX_HOURS):
        newest.update(end=now, running=True, why="")
    if reach:
        out = [o for o in out if not (o["carry"] and o["end"] is None)]      # 期間より前に始まり、区間の分からない作業は出さない（数にも入れない）
    return out



def minutes(o):
    return (o["end"] - o["start"]).total_seconds() / 60 if o.get("end") and o.get("start") and not o.get("running") else None


def reasons(ops):
    """区間を出せない作業の理由ごとの数 → {理由の字: 本数}（多い順）"""
    by = {}
    for o in ops:
        if o.get("end") is None and o.get("why"):
            by[o["why"]] = by.get(o["why"], 0) + 1
    return {WHY.get(k, k): n for k, n in sorted(by.items(), key=lambda x: -x[1])}


# ---------------------------------------------------------------- ガントチャート
def view_of(read, days):
    """見る範囲（横の時間）: 期間の作業日の区切り（work_days。現場歴なら 7:00〜翌 7:00 など）の最初の始め〜最後の終わり（版 3.48.0。
    利用者の要望 2026-10-21 の 3 回目の 4: 前は勤務時間の最初〜最後を作業の始め・終わりまで広げ、現場歴の日と範囲がずれた）。
    範囲の外へ出る作業は、画面が端で切って「続く」の印を付ける"""
    if days:
        return days[0][0], days[-1][1]
    r = read["range"]
    if r:
        return datetime.fromisoformat(r[0]), datetime.fromisoformat(r[1]) + timedelta(days=1)
    return None


def gantt(name, read, windows, *, label="", color="", days=()):
    """1 台の答え → {name, ops: [[始め, 終わり, 字, 色の値, 本数, 印]], windows: [[始め, 終わり, 直, 作業日]], days: [[始め, 終わり, 作業日]], view, noEnd, why, count, carry, truncated, …稼働率}。
    印 … "c"＝期間より前から続く・"r"＝いま動いている（作業終了がまだ無い）・""。棒は見る範囲（view）に掛かる作業だけ。
    days … 作業日の区切り（work_days。画面は日の境の線と日付の札をここに引く）"""
    ops = read["ops"]
    view = view_of(read, days)
    mine = [o for o in ops if not o.get("carry")]
    u = utilization(ops, windows, clip=view)
    bars = []
    for o in ops:
        if o["end"] is None or (view and (o["end"] <= view[0] or o["start"] >= view[1])):
            continue
        if len(bars) < MAX_OPS:
            text = str(o["values"].get(label) if label else "") if label else ""
            bars.append([_iso(o["start"]), _iso(o["end"]), "" if text in ("None",) else text, str(o["values"].get(color) or "") if color else "", o["n"],
                         "r" if o.get("running") else "c" if o.get("carry") else ""])
    no_end = sum(1 for o in mine if o["end"] is None)
    return {"name": name, **u, "ops": bars, "windows": [[_iso(a), _iso(b), s, d] for a, b, s, d in windows], "view": [_iso(view[0]), _iso(view[1])] if view else None,
            "days": [[_iso(a), _iso(b), d] for a, b, d in days],
            "noEnd": no_end, "why": reasons(mine), "count": len(mine), "carry": sum(1 for o in ops if o.get("carry")),
            "truncated": len([o for o in ops if o["end"] is not None]) > MAX_OPS}


# ---------------------------------------------------------------- 全設備のリードタイム（版 3.48.0。利用者の要望 2026-10-21 の 3 回目の 6）
# 全設備の ABC 分析・換算係数の作業時間の取り方:
#   sum  … 各設備の作業時間の積み上げ（作業 1 本ずつ。今までどおり）
#   lead … リードタイム: 同じロット番号の、全設備の作業開始のいちばん早い時刻〜作業終了のいちばん遅い時刻（MIN と MAX の差）。1 本＝1 ロット
SPANS = ("sum", "lead")
LEAD_AROUND_DAYS = 62     # リードタイムで期間の前後に読む日数（期間をまたぐロットの最初の作業開始・期間の後の作業を知る）


def lead_ops(reads):
    """設備ごとの read_ops（lots=True で読んだ物）→ ロットごとの作業 1 本の並び（abc にそのまま渡せる形）。
    作業開始はいちばん早い作業開始・作業終了はいちばん遅い作業終了。いちばん後に始まった作業の作業終了が分からなければ、区間を持たない（why last）。
    品種・数の列の値は、そのロットのいちばん早い作業の行の値（同じロットを設備ごとに足さない）。
    期間の前後も読んだとき（read_ops の around。版 3.49.0）: ロットは、いちばん後に始まった作業（最後の工程）が期間に入る物だけ（その期間に
    できあがったロット）。期間の前の作業も最初の作業開始に入れる（前は期間の中の作業だけで、期間をまたぐロットの LT が短く出た）"""
    by = {}
    for r in reads:
        for o in r["ops"]:
            for ln, vals in (o.get("lots") or {}).items():
                by.setdefault(ln, []).append((o, vals))
    out = []
    for ln, xs in by.items():
        timed = [x for x in xs if x[0]["start"] is not None]
        if not timed:
            if all(x[0].get("carry") or x[0].get("after") for x in xs):
                continue
            out.append({"key": ln, "start": None, "end": None, "n": 1, "values": xs[0][1], "nums": _nums(xs[0][1]), "why": "nostart", "steps": len(xs)})
            continue
        timed.sort(key=lambda x: x[0]["start"])
        first, last = timed[0], timed[-1]
        if last[0].get("carry") or last[0].get("after"):
            continue                           # 最後の工程が期間の外（前の期間・後の期間にできあがったロット）
        a = first[0]["start"]
        ends = [x[0]["end"] for x in timed if x[0]["end"] is not None]
        b, why = (max(ends), "") if ends and last[0]["end"] is not None else (None, "last" if len(timed) > 1 else last[0]["why"] or "blank")
        if b is not None and b <= a:
            b, why = None, "before"
        out.append({"key": ln, "start": a, "end": b, "n": 1, "values": first[1], "nums": _nums(first[1]), "why": why, "steps": len(timed)})
    out.sort(key=lambda o: (o["start"] is None, o["start"] or datetime.min))
    return out


def _nums(vals):
    out = {}
    for k, v in (vals or {}).items():
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------- ABC 分析と換算係数
KEY_SEP = "／"          # 品種を複数の列の組み合わせで分けるとき（版 3.47.0）の鍵の区切り（A1100／H14）。parts に列ごとの値も持つ
MAX_CLS = 4             # 組み合わせる列の数の上限


def cls_list(cls):
    """品種の列（字か列の並び）→ 列の並び（空は除く・同じ列は 1 つ・MAX_CLS まで）"""
    xs = cls if isinstance(cls, (list, tuple)) else [cls]
    return [x for x in dict.fromkeys(str(c or "").strip() for c in xs) if x][:MAX_CLS]


def rank_name(i):
    """段の番号（0 から）→ 段の名前 A, B, …, Z, AA, AB, …（Excel の列の名前と同じ数え方。数に上限なし）"""
    out = ""
    i += 1
    while i > 0:
        i, r = divmod(i - 1, 26)
        out = chr(65 + r) + out
    return out


def rank_of(i, cum, limits, each=False):
    """量の大きい順で i 番目（0 から）・累積構成比 cum の品種の段の番号。
    each … 品種ごと（1 品種＝1 段。A, B, C, … と上限なく）。それ以外は累積構成比の線 limits（昇順。いくつでも）で分け、
    1 本目の線までを A・2 本目までを B … 最後の線の後を次の段に（線が 2 本なら今までの A・B・C）。いちばん大きい品種は、それだけで線を超えても A"""
    if each:
        return i
    if i == 0:
        return 0
    return next((j for j, lim in enumerate(limits) if cum <= lim + 1e-9), len(limits))


def abc(ops, cls, qty="lots", base="avg", limits=(70.0, 90.0), each=False):
    """作業の並び → 品種ごとの {key, parts（列ごとの値）, lots, timed, minutes（作業時間の合計）, avg（1 本の平均作業時間）, qty, share, cum, rank（A・B・C・D…）, ri（段の番号）, factor, conv}。
    段（版 3.51.0。利用者の要望 2026-10-22: A・B・C の 3 つに限らない）… limits は累積構成比の線をいくつでも（線の数＋1 の段）。each なら品種ごとに 1 段。
    答えの ranks … 線で分けたときの線と段の数（{each, lims, count}）。
    量の大きい順。lots は作業の本数（分割ロットは 1）。avg・factor は作業時間が分かる作業だけで出す。
    cls … 品種の列。列の並びなら、その値の組み合わせ（合金 × 調質 など。版 3.47.0）を 1 つの品種とする。
    答えの noEnd・why … 作業時間の分からない本数と理由（換算係数に入らない作業。黙って捨てない）。
    占有時間（occ。版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 2）… 本数 × 平均作業時間（リードタイムなら平均 LT）＝その品種が工場を
    占める時間の見積もり（区間の分からない作業も、その品種の平均で見積もる）。量を「作業時間」にしたときは占有時間で並べる
    （前は区間の分かる作業の作業時間を足した数で、区間の分からない作業が多い品種ほど小さく出た）。lotShare・occShare … 本数・占有時間の構成比。
    換算本数 ＝ 本数 × 換算係数 ＝ 占有時間 ÷ 基準の作業時間（換算本数の計 × 基準 ＝ 占有時間の計）"""
    cols = cls_list(cls)
    by = {}
    for o in ops:
        parts = ["" if o["values"].get(c) is None else str(o["values"].get(c)).strip() for c in cols] or [""]
        k = KEY_SEP.join(parts)
        x = by.setdefault(k, {"key": k, "parts": parts, "lots": 0, "timed": 0, "minutes": 0.0, "sum": 0.0})
        x["lots"] += 1
        m = minutes(o)
        if m is not None:
            x["timed"] += 1
            x["minutes"] += m
        if qty not in QTYS:
            x["sum"] += o["nums"].get(qty, 0.0)
    items = list(by.values())
    for x in items:
        x["avg"] = x["minutes"] / x["timed"] if x["timed"] else None
        x["occ"] = x["lots"] * x["avg"] if x["avg"] is not None else None
        x["qty"] = x["lots"] if qty == "lots" else (x["occ"] or 0.0) if qty == "time" else x["sum"]
    items.sort(key=lambda x: (-x["qty"], x["key"]))
    total = sum(x["qty"] for x in items)
    lims = sorted(float(x) for x in limits)
    run = 0.0
    for i, x in enumerate(items):
        run += x["qty"]
        x["share"] = round(x["qty"] / total * 100, 4) if total else 0.0
        x["cum"] = round(run / total * 100, 4) if total else 0.0
        x["ri"] = rank_of(i, x["cum"], lims, each)
        x["rank"] = rank_name(x["ri"])
    lots_all, occ_all = sum(x["lots"] for x in items), sum(x["occ"] or 0.0 for x in items)
    for x in items:
        x["lotShare"] = round(x["lots"] / lots_all * 100, 4) if lots_all else 0.0
        x["occShare"] = round((x["occ"] or 0.0) / occ_all * 100, 4) if occ_all else 0.0
    timed = [x for x in items if x["avg"] is not None]
    if base == "avg":
        n = sum(x["timed"] for x in timed)
        ref = sum(x["minutes"] for x in timed) / n if n else None
        ref_name = "全作業の平均"
    elif base == "top":
        top = max(timed, key=lambda x: (x["lots"], -items.index(x)), default=None)
        ref, ref_name = (top["avg"], f"いちばん多い品種「{top['key'] or '（空欄）'}」") if top else (None, "")
    else:
        hit = next((x for x in timed if x["key"] == str(base)), None)
        ref, ref_name = (hit["avg"], f"品種「{base}」") if hit else (None, f"品種「{base}」（作業がありません）")
    for x in items:
        x["factor"] = round(x["avg"] / ref, 4) if ref and x["avg"] is not None else None
        x["conv"] = round(x["lots"] * x["factor"], 4) if x["factor"] is not None else None
        x["avg"] = round(x["avg"], 2) if x["avg"] is not None else None
        x["minutes"] = round(x["minutes"], 2)
        x["occ"] = round(x["occ"], 2) if x["occ"] is not None else None
        x.pop("sum", None)
    return {"items": items, "total": total, "base": {"minutes": round(ref, 2) if ref else None, "name": ref_name},
            "conv": round(sum(x["conv"] or 0 for x in items), 4), "lots": lots_all, "occ": round(occ_all, 2),
            "noEnd": sum(1 for o in ops if minutes(o) is None), "why": reasons(ops), "cls": cols,
            "ranks": {"each": bool(each), "lims": [] if each else lims, "count": len(items) if each else len(lims) + 1}}


# ---------------------------------------------------------------- 地点 A の換算係数で地点 B を換算する（版 3.49.0。利用者の要望 2026-10-21 の 4 回目の 3）
def apply_ref(cur, ref, ref_range=None):
    """いまの期間（地点 B）の abc の答え cur に、基準の期間（地点 A）の abc の答え ref の換算係数を当てる（cur を書き換えて返す）。
    品種ごとに refFactor（A の係数）・refConv（B の本数 × A の係数）。A に無い品種（refFactor が None）は 1.00 で数え、その本数を refMissing に。
    答えに ref: {range, base, conv（B の本数を A の係数で換算した計）, missing, lots}"""
    fac = {x["key"]: x["factor"] for x in ref.get("items") or [] if x.get("factor") is not None}
    conv, missing = 0.0, 0
    for x in cur.get("items") or []:
        f = fac.get(x["key"])
        x["refFactor"] = f
        x["refConv"] = round(x["lots"] * (f if f is not None else 1.0), 4)
        conv += x["refConv"]
        if f is None:
            missing += x["lots"]
    cur["ref"] = {"range": list(ref_range) if ref_range else None, "base": ref.get("base"), "conv": round(conv, 4), "missing": missing, "lots": cur.get("lots", 0)}
    return cur


# ---------------------------------------------------------------- パネルの答え（稼働 gantt・ABC 分析 abc）
GANTT_PERIOD = {"column": "@workday", "kind": "yesterday", "n": 1}


def ops_answer(p, ctx):
    """稼働（gantt）・ABC 分析と換算係数（abc）のパネル → 設備ごとの答え（作業開始と作業終了から）。
    gantt … {kind, equips: [{name, ops, windows, shiftMin, busyMin, outsideMin, rate, byShift, noEnd, count}], range, total}
    abc   … {kind, equips: [{name, items, total, base, conv, lots}], all: 全設備を合わせた答え}。期間が無ければ全期間。
    同じ組み・同じ写し・同じ「今日」なら前の答え（answer() と同じ控え）"""
    try:
        parts, failed, name = sources.parts_for(p["source"], p.get("equips"), p["basis"])
    except sources.SourceFail as f:
        return f.answer()
    o = p.get("ops") or {}
    period = None if p["visual"] == "now" else p["period"] or (GANTT_PERIOD if p["visual"] == "gantt" else None)
    now = ctx.now
    stamp = now.strftime("%Y-%m-%d %H:%M:%S")
    days = [x.work["clock"].place(stamp, x.work["basis"])[0] if x.work else "" for x in parts]
    key = json.dumps(["ops", p, period, [[answer._file_sig(x.path), x.table] for x in parts], days, now.date().isoformat(),
                      now.hour if p["visual"] == "gantt" else 0, [f["name"] for f in failed]], ensure_ascii=False, sort_keys=True, default=str)
    if p["visual"] == "now":
        key = json.dumps(["now", p, [[answer._file_sig(x.path), x.table] for x in parts], stamp[:16]], ensure_ascii=False, sort_keys=True, default=str)
        hit = answer._remember(key, lambda: now_count(p, answer.order_parts(parts, p.get("eorder")), now))
        return hit if "error" in hit else {**hit, "failed": failed, "sourceName": name, "now": stamp}
    hit = answer._remember(key, lambda: _ops_count(p, answer.order_parts(parts, p.get("eorder")), o, period, now))
    if "error" in hit:
        return hit
    if p["visual"] == "gantt" and plan_layer(p, o):
        # 予定と実績のガントの出どころ: 予定は作業予定・実績の棒は行の実績（測定データ・手入力・取り込み…）。どこから来た時刻かを推測させない
        froms = {}
        for e in hit.get("equips") or []:
            for k, n in (e.get("from") or {}).items():
                froms[k] = froms.get(k, 0) + n
        name = f"{name}（実績: {'・'.join(sorted(froms, key=lambda k: -froms[k]))}）" if froms else name
    return {**hit, "failed": failed + hit.get("skipped", []), "sourceName": name, "now": stamp}


# ---------------------------------------------------------------- いまの作業（§9.630 ④。visual now）
# 設備ごとに、いま動いている行（状態が着手＝作業中のロットか設備停止）と、その予定完了（予定終了）。動いていなければ次の予定。
# 元は作業予定だけ（作業スケジュールの予定の行。予定完了の時刻を持つのは予定だけ）。条件（filters・search）はほかのパネルと同じに効く
NOW_COLUMNS = ("種類", "状態", sources.WORK_NAME, sources.PLAN_START, sources.PLAN_END, sources.REC_START, "遅れ（分）", "経過（分）", "見積（分）")


def due_of(x):
    """予定完了の時刻: 作業中の行は 作業開始＋見積（予定の計算では作業中の予定終了はいつも「いま」＝schedule_calc._ongoing。
    見積を超えた分は遅れ（分））。ほかは予定終了。§9.630 の採点: 予定完了がいまの時刻に張り付いて読めなかった"""
    st, est = x.get(sources.REC_START), x.get("見積（分）")
    if x.get("状態") == "着手" and st and isinstance(est, (int, float)):
        t = _dt(str(st))
        if t:
            return _iso(t + timedelta(minutes=float(est)))
    return x.get(sources.PLAN_END) or ""


def now_count(p, parts, now):
    if p.get("source") != sources.PLAN:
        return {"error": "「いまの作業」は作業予定から数えます（データを「作業予定」にしてください）。", "kind": "invalid", "status": 400}
    equips = [_now_one(p, part, now) for part in parts]
    return {"kind": "now", "equips": equips, "running": sum(1 for e in equips if e.get("cur"))}


def _now_one(p, part, now):
    try:
        with connect_ro(part.path) as c:
            names = tables(c)
            t = part.table if part.table in names else pick_table(names, part.preferred_table, part.table_candidates)
            cs = columns(c, t, part.path) if t else []
            miss = [x for x in NOW_COLUMNS if x not in cs]
            if miss:
                raise PivotError(f"作業予定に列「{'」「'.join(miss)}」がありません。")
            where, params = search_filter_where(cs, p["search"], json.dumps(p["filters"], ensure_ascii=False), now.date())
            w = (" WHERE " + " AND ".join(where)) if where else ""
            rows = c.execute(f"SELECT {', '.join(qi(x) for x in NOW_COLUMNS)} FROM {qi(t)}{w}", params).fetchall()
    except Exception as e:      # 読めない設備も行に出す（理由つき）
        return {"name": part.name, "error": str(e), "cur": None, "next": None}
    items = [dict(zip(NOW_COLUMNS, r)) for r in rows]
    one = lambda x: {"kind": x["種類"] or "", "name": str(x[sources.WORK_NAME] or ""), "start": x[sources.REC_START] or x[sources.PLAN_START] or "",   # noqa: E731
                     "end": due_of(x), "late": x["遅れ（分）"] or 0, "elapsed": x["経過（分）"], "estimate": x["見積（分）"]}
    cur = sorted((x for x in items if x["状態"] == "着手"), key=lambda x: str(x[sources.REC_START] or ""), reverse=True)
    nxt = sorted((x for x in items if x["状態"] == "予定" and x[sources.PLAN_START]), key=lambda x: str(x[sources.PLAN_START]))
    shift = push_of(cur[0], now) if cur else timedelta(0)
    n1 = one(nxt[0]) if nxt else None
    if n1 and shift:
        n1["start"] = _shifted(n1["start"], shift, now)
    return {"name": part.name, "cur": one(cur[0]) if cur else None, "next": n1, "more": max(0, len(cur) - 1),
            "left": len([x for x in items if x["状態"] == "予定"]), "rows": len(items),     # rows … 予定の行の数（0＝予定が無い・ある＝残りが無い）
            "shift": round(shift.total_seconds() / 60, 1)}


def push_of(x, now):
    """作業中の行の後ろの予定をずらす量（§9.630 の採点: 予定完了 4:57 なのに次の予定が 4:00 から始まって見えた）。
    作業スケジュールの計算は作業中の作業の後ろを「いま」から並べ直す（schedule_calc._ongoing）。ダッシュボードの予定の枠と「次」は、
    作業中の作業の予定完了（作業開始＋見積）が先ならその分だけ後ろへ見せる（作業スケジュールの計算そのものは変えない）。設備停止は計算が既に見積の終わりから並べる"""
    if x.get("種類") == "設備停止":
        return timedelta(0)
    t = _dt(str(due_of(x) or ""))
    return max(timedelta(0), t - now) if t else timedelta(0)


def _shifted(stamp, shift, now):
    """いまより後に始まる予定だけをずらす（いまより前に始まった・作業中の行は動かさない）"""
    t = _dt(str(stamp or ""))
    return _iso(t + shift) if t and t >= now - timedelta(minutes=1) else stamp


def _ops_head(p, period, rng, start_col, end_col, equips, skipped):
    # 期間はほかのパネルと同じ形（画面の periodText が読む: 名前と日の範囲）
    per = {**period, "name": PERIODS.get(period["kind"], ""), "ranges": [{"from": rng[0], "to": rng[1]}] if rng else []} if period else None
    return {"kind": p["visual"], "equips": equips, "skipped": skipped, "range": rng, "startColumn": start_col, "endColumn": end_col, "period": per,
            "basis": p["basis"]}


def _no_equips(skipped):
    return {"error": "数えられる設備がありません。" + "".join(f" {x['name']}: {x['error']}" for x in skipped[:3]), "kind": "invalid", "status": 400}


def plan_layer(p, o):
    """予定と実績を重ねるガントか（§9.630 ②）。作業予定の元のときだけ（ほかの元は予定の時刻を持たない）"""
    return bool(o.get("plan")) and p.get("source") == sources.PLAN


def _gantt_one(p, part, o, period, now):
    layered = plan_layer(p, o)
    label = o.get("label") or (sources.WORK_NAME if layered else "")
    cols = [c for c in (label, o.get("color") or "", "実績の出どころ" if layered else "") if c]
    flt = list(p["filters"])
    if layered:
        # 実績の棒: 作業開始のある行だけ（予定のままの行を「区間が分からない作業」に数えない）。時刻は予定の行の実績
        # （測定データ・手入力・完了突合で取り込んだ時刻・開始で自動。schedule_calc._actual_view の1箇所）
        flt = flt + [{"column": sources.REC_START, "op": "not_empty", "value": ""}]
    r = read_ops(part, search=p["search"], filters=json.dumps(flt, ensure_ascii=False), today=now.date(), calc=p.get("calc"),
                 period=period, now=now, end=sources.WORK_END if layered else o.get("end", ""),
                 start=sources.REC_START if layered else o.get("start", ""), cols=cols, reach=True)
    clock = (part.work or {}).get("clock") or Clock([])
    basis = (part.work or {}).get("basis", "work")
    wins = shift_windows(clock, *r["range"], basis) if clock.segments and r["range"] else []
    wd = work_days(clock, *r["range"], basis) if r["range"] else []
    g = gantt(part.name, r, wins, label=label or r["lot"] or "", color=o.get("color") or "", days=wd)
    if layered:
        nw = _now_one(p, part, now)
        g["plans"] = _plan_bars(p, part, period, now, label, g["view"], timedelta(minutes=nw.get("shift") or 0))
        g["from"] = _from_counts(r)
        # いまの作業（作業中のロットか設備停止と予定完了・次の予定）を行の名前の下に（「いまの作業」のパネルと同じ答え・§9.630 の採点:
        # 同じ設備のことを 2 枚のパネルに分けて言わない）
        if o.get("nowRow") is not False:
            g["now"] = {k: v for k, v in nw.items() if k != "name"}
    return r, {**g, "pattern": "勤務体系" if clock.segments else ""}


def _plan_bars(p, part, period, now, label, view, shift=timedelta(0)):
    """まだ終わっていない行（予定・作業中）の予定の棒 → [[始め, 終わり, 字, 状態, 遅れ（分）]]（予定開始の順・見る範囲に掛かる物だけ）。
    稼働率・本数には入れない（予定は稼働していない）"""
    flt = list(p["filters"]) + [{"column": "状態", "op": "neq", "value": "完了"}]
    r = read_ops(part, search=p["search"], filters=json.dumps(flt, ensure_ascii=False), today=now.date(), calc=p.get("calc"),
                 period=period, now=now, start=sources.PLAN_START, end=sources.PLAN_END, cols=[c for c in (label, "状態", "遅れ（分）", "見積（分）") if c], reach=True)
    lo, hi = (datetime.fromisoformat(view[0]), datetime.fromisoformat(view[1])) if view else (None, None)
    out = []
    for x in r["ops"]:
        if x["end"] is None or x.get("running") or (lo and (x["end"] <= lo or x["start"] >= hi)):
            continue
        v = x["values"]
        start, end = x["start"], x["end"]
        if v.get("状態") == "着手" and isinstance(v.get("見積（分）"), (int, float)):
            end = start + timedelta(minutes=float(v["見積（分）"]))       # 作業中の予定は 始まり＋見積（予定終了は「いま」なので）
        elif shift and start >= now - timedelta(minutes=1):
            start, end = start + shift, end + shift                     # 作業中の作業の予定完了の後ろへ（push_of）
        if lo and start >= hi:
            continue
        out.append([_iso(start), _iso(end), str(v.get(label) or "") if label else "", str(v.get("状態") or ""), v.get("遅れ（分）") or 0])
        if len(out) >= MAX_OPS:
            break
    return out


def _from_counts(r):
    """実績の棒の出どころごとの本数（凡例と説明に。どこから来た時刻かを推測させない）"""
    by = {}
    for x in r["ops"]:
        if x["end"] is not None:
            k = str(x["values"].get("実績の出どころ") or "") or "測定データ"
            by[k] = by.get(k, 0) + 1
    return by


def _ops_count(p, parts, o, period, now):
    if p["visual"] == "abc":
        return _abc_count(p, parts, o, period, now)
    equips, skipped, rng, start_col, end_col = [], [], None, "", ""
    for part in parts:
        try:
            r, g = _gantt_one(p, part, o, period, now)
        except Exception as e:      # 読めない設備も行に出す（理由をガントの行・知らせに）
            skipped.append({"name": part.name, "error": str(e)})
            equips.append({"name": part.name, "error": str(e), "ops": [], "windows": [], "view": None, "rate": None, "shiftMin": 0, "busyMin": 0,
                           "outsideMin": 0, "byShift": [], "noEnd": 0, "why": {}, "count": 0, "carry": 0, "truncated": False, "pattern": ""})
            continue
        start_col, end_col, rng = start_col or r["start"], end_col or r["end"], rng or r["range"]
        if r["range"] and (date.fromisoformat(r["range"][1]) - date.fromisoformat(r["range"][0])).days + 1 > MAX_DAYS:
            return {"error": f"ガントチャートの期間は {MAX_DAYS} 日までです（期間を短くしてください）。", "kind": "invalid", "status": 400}
        equips.append(g)
    if not any("error" not in e for e in equips):
        return _no_equips(skipped)
    sm, bm = sum(e["shiftMin"] for e in equips), sum(e["busyMin"] for e in equips)
    return {**_ops_head(p, period, rng, start_col, end_col, equips, skipped),
            "total": {"shiftMin": round(sm, 2), "busyMin": round(bm, 2), "rate": round(bm / sm, 4) if sm else None,
                      "noPattern": [e["name"] for e in equips if not e["pattern"] and "error" not in e], "noEnd": sum(e["noEnd"] for e in equips)}}


def _abc_pass(p, parts, o, period, now):
    """ABC 分析を 1 つの期間で数える → (設備ごとの答え, 全設備の答え, 読めなかった設備, 日の範囲, 作業開始の列, 作業終了の列) か {error}。
    全設備の作業時間: 各設備の積み上げ（作業 1 本ずつ）か、ロットごとのリードタイム（全設備の作業開始の MIN〜作業終了の MAX）"""
    qty = o.get("qty") or "lots"
    cls = cls_list(o.get("cls"))
    cols = [c for c in [*cls, qty if qty not in QTYS else ""] if c]
    lead = o.get("span") == "lead"
    args = (cls, qty, o.get("base") or "avg", abc_lims(o), o.get("rankBy") == "each")
    equips, skipped, every, reads, rng, start_col, end_col = [], [], [], [], None, "", ""
    for part in parts:
        try:
            r = read_ops(part, search=p["search"], filters=json.dumps(p["filters"], ensure_ascii=False), today=now.date(), calc=p.get("calc"),
                         period=period, now=now, end=o.get("end", ""), start=o.get("start", ""), cols=cols,
                         lots=lead, around=LEAD_AROUND_DAYS if lead and period else 0)
        except Exception as e:      # 読めない設備は飛ばし、理由を知らせに出す
            skipped.append({"name": part.name, "error": str(e)})
            continue
        start_col, end_col, rng = start_col or r["start"], end_col or r["end"], rng or r["range"]
        mine = [x for x in r["ops"] if not x.get("carry") and not x.get("after")]     # 設備ごとの答えは、期間の中の作業だけ
        equips.append({"name": part.name, **abc(mine, *args)})
        every += mine
        reads.append(r)
    if not equips:
        return _no_equips(skipped)
    if lead and not any(r["lot"] for r in reads):
        return {"error": "ロット番号の列が無いので、リードタイム（同じロットの最初の作業開始〜最後の作業終了）を出せません。", "kind": "invalid", "status": 400}
    return equips, abc(lead_ops(reads) if lead else every, *args), skipped, rng, start_col, end_col


def _abc_count(p, parts, o, period, now):
    """ABC 分析と換算係数。基準の期間（ops.refPeriod。地点 A）があれば、その期間の換算係数で、いまの期間（地点 B）の本数を換算する"""
    got = _abc_pass(p, parts, o, period, now)
    if isinstance(got, dict):
        return got
    equips, every, skipped, rng, start_col, end_col = got
    ref = o.get("refPeriod")
    if ref:
        a = _abc_pass(p, parts, o, ref, now)
        if isinstance(a, dict):
            return {**a, "error": "基準の期間（地点 A）: " + a["error"]}
        by = {e["name"]: e for e in a[0]}
        for e in equips:
            apply_ref(e, by.get(e["name"]) or {}, a[3])
        apply_ref(every, a[1], a[3])
    qty, cls = o.get("qty") or "lots", cls_list(o.get("cls"))
    return {**_ops_head(p, period, rng, start_col, end_col, equips, skipped), "all": every, "span": "lead" if o.get("span") == "lead" else "sum",
            "cls": KEY_SEP.join(cls), "clsList": cls, "qty": qty}
