# -*- coding: utf-8 -*-
"""datetext.py: 字で届く日時・並べ替えの鍵の読み方（§9.628。LotScope の services/sqlite_ro.py の読み方を移したもの）。

SQL からも同じ読み方で呼べるよう、`sqlite_io.connect()` が ToDate(列)・ToDateTime(列)・SortKey(列) として登録する
（一覧の条件「N 日以内」「日付で決める」・ダッシュボードの集計の日付の段・期間）。
    to_date      … 'YYYY-MM-DD' か None（2026/9/5・2026年9月28日・20260928・26/09/28 の2桁の年も）
    to_datetime  … 'YYYY-MM-DD HH:MM:SS'（時刻が無ければ 'YYYY-MM-DD'）か None。14 桁（20261002081500）・午前／午後も読む
    sort_key     … 並べ替えの鍵（空欄は None・数に読める字は数・ほかは前後の空白を除いた字）
"""
import datetime as _dt
import re


def _cstr(v):
    return "" if v is None else str(v)


_NUM_CHARS = frozenset("0123456789.eE+-")


def sort_key(v):
    """並べ替えの鍵（SQL では SortKey(列)）。一覧の「並び・まとめ」で同じ値と見る物を、並べ替えでも隣へ寄せる:
    空欄（NULL・空白だけ）は NULL、数と数に読める字（' 54'・'1e-05'）は数、ほかは前後の空白を除いた字。
    画面（lotlist.js の sortKey）とデスクトップ版（desktop/src/lotlist.rs の sort_key）も同じ見分け。"""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = _cstr(v).strip()
    if not s:
        return None
    if set(s) <= _NUM_CHARS and any(ch.isdigit() for ch in s):
        try:
            return float(s)
        except ValueError:
            pass
    return s


_DATE_PATTERNS = (
    # 2026/09/28 10:00・2026-9-5・2026.09.28・2026-09-28T10:00
    re.compile(r"^\s*(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$"),
    # 2026年9月28日
    re.compile(r"^\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日.*$"),
    # 20260928（8桁）
    re.compile(r"^\s*(\d{4})(\d{2})(\d{2})(?:\s.*)?$"),
    # 26/09/28 23:48:54（LotDsp などの2桁の年＝2000年代）
    re.compile(r"^\s*(\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$"),
)


def to_date(v):
    """値を日付として読めれば 'YYYY-MM-DD'、読めなければ None（SQL では ToDate(列)）。"""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    for rx in _DATE_PATTERNS:
        m = rx.match(s)
        if m:
            y, mo, d = (int(x) for x in m.groups())
            if y < 100:
                y += 2000
            try:
                return _dt.date(y, mo, d).isoformat()
            except ValueError:
                return None
    return None


_TIME_TAIL = re.compile(r"(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:[AaPp]\.?[Mm]\.?)?\s*$")


def to_minutes(v):
    """値の終わりの時刻（8:15・08:15:30・1899/12/30 8:15:00 の時刻の所）→ (時, 分, 秒)。読めなければ None。"""
    if v is None:
        return None
    m = _TIME_TAIL.search(str(v).strip())
    if not m:
        return None
    h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3) or 0)
    return (h, mi, s) if h < 24 and mi < 60 and s < 60 else None


# よくある形（2026/10/01 8:15:00・2026-10-01・2026-10-01T08:15）を 1 回の照合で読む近道（版 3.43.0。ダッシュボードの集計は
# 1 行ずつ日時を読むので、そこがいちばん重かった）。当たらない形は下の読み方（to_date・to_minutes）。答えは同じ
_FAST_DT = re.compile(r"(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?")
_DAYS = {}


def _iso_day(y, mo, d):
    k = (y, mo, d)
    hit = _DAYS.get(k)
    if hit is None:
        try:
            hit = _dt.date(int(y), int(mo), int(d)).isoformat()
        except ValueError:
            hit = ""
        if len(_DAYS) > 20000:
            _DAYS.clear()
        _DAYS[k] = hit
    return hit or None


# 版 3.47.0（利用者の要望 2026-10-21 の 2 回目の 1・4。tools/ops-bench.py）: 作業実績の作業開始・作業終了の書き方を広げる。
#   年月日時分秒の 14 桁（20261002201500。WaveLog の BOX実績_作業終了_年月日時分秒）と、午前・午後（2026/10/02 午後 8:15:00・8:15:00 PM）。
#   前は 14 桁を読めず、午後を午前と読んで作業終了が作業開始より前になり、ガントの棒・作業時間が出なかった。
#   日付だけの読み方（to_date）は変えない（デスクトップ版の一覧 desktop/src/pyfmt.rs の to_date と同じ答えを保つ）
_COMPACT_DT = re.compile(r"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})")
_MERIDIEM = re.compile(r"午前|午後|(?<![A-Za-z])[AaPp]\.?[Mm]\.?(?![A-Za-z])")


def _meridiem(stamp, *texts):
    """'YYYY-MM-DD HH:MM:SS' の時を、元の字の午前・午後（AM・PM）で 24 時の形に直す（12 時間の書き方でなければそのまま）"""
    if not stamp or len(stamp) < 19:
        return stamp
    m = next((x for x in (_MERIDIEM.search(t) for t in texts if isinstance(t, str)) if x), None)
    if not m:
        return stamp
    h = int(stamp[11:13])
    if h > 12:
        return stamp
    pm = m.group(0) == "午後" or m.group(0)[0] in "Pp"
    h = (h % 12) + (12 if pm else 0)
    return f"{stamp[:11]}{h:02d}{stamp[13:]}"


def to_datetime(v, time_value=None):
    """値を日時として読めれば 'YYYY-MM-DD HH:MM:SS'（時刻が無ければ 'YYYY-MM-DD'）、日付として読めなければ None（SQL では ToDateTime(列)）。
    time_value は時刻が別の列にあるとき（値に時刻が無いときだけ使う）。文字のまま並べても日時の順になる。
    年月日時分秒の 14 桁（20261002081500）と、午前・午後の書き方（午後 8:15:00・8:15:00 PM）も読む（版 3.47.0）"""
    out = _to_datetime(v, time_value)
    if out and len(out) == 19 and (isinstance(v, str) or isinstance(time_value, str)):
        return _meridiem(out, v, time_value)
    return out


def _to_datetime(v, time_value=None):
    if isinstance(v, int) and not isinstance(v, bool) and 10**13 <= v < 10**14:
        v = str(v)
    if isinstance(v, str):
        m = _COMPACT_DT.fullmatch(v.strip())
        if m:
            y, mo, dd, h, mi, sec = m.groups()
            d = _iso_day(y, mo, dd)
            return f"{d} {h}:{mi}:{sec}" if d and int(h) < 24 and int(mi) < 60 and int(sec) < 60 else None
        s = v.strip()
        m = _FAST_DT.fullmatch(s)
        if m:
            y, mo, dd, h, mi, sec = m.groups()
            d = _iso_day(y, mo, dd)
            if d is None:
                return None
            if h is not None and int(h) < 24 and int(mi) < 60 and int(sec or 0) < 60:
                return f"{d} {int(h):02d}:{mi}:{int(sec or 0):02d}"
            if h is None and time_value is not None:
                hms = to_minutes(time_value)
                return d if hms is None else f"{d} {hms[0]:02d}:{hms[1]:02d}:{hms[2]:02d}"
            if h is None:
                return d
    d = to_date(v)
    if d is None:
        return None
    hms = to_minutes(v)
    if hms is None and time_value is not None:
        hms = to_minutes(time_value)
    return d if hms is None else f"{d} {hms[0]:02d}:{hms[1]:02d}:{hms[2]:02d}"
