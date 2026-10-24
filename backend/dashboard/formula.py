# -*- coding: utf-8 -*-
"""計算列の式（画面の static/js/list/list-formula.js・`WL.formula`）を、サーバーでも同じ答えで計算する（§9.628）。

ダッシュボードの数はサーバー（backend/dashboard/pivot.py）が数えるので、パネルで使う計算列の式もここで計算する。
もとは LotScope（satoshi-hello-vlioilv/LotScope）の services/formula.py。**数の読み方は WaveLog の決まり（§9.581）**に替えた:
- looseNum（数として読めるか）… 字の全体が数のときだけ。前後の空白・3桁区切り（正しい位置だけ）・先頭のゼロ・「+」を許す
  （サーバーの一覧の並べ替え・絞り込みの `sort_order.num_of()` と同じ形）
- strictNum（書いてある通りに数か）… looseNum に加えて整数の部分が 0 で始まらない（'010' はコード＝字）。比較演算子と `+` が使う
- 計算の結果は 15 桁へ丸める（tidy。0.1+0.2 を 0.30000000000000004 にしない）・四捨五入は 0 から遠い側（roundHalfAway）
- 大小（< <= > >=）は、どちらかが空欄なら当たらない（ordered）

JavaScript と同じ答えにするための決まり（網: tests/test_formulaparity.py が、画面の式と同じ入力で突き合わせる）:
- 数は倍精度の実数（JavaScript の Number）。字にするときは JavaScript の String(数) と同じ書き方（js_num_text）
- 字の長さ・位置・切り出しは UTF-16 の単位で数える・前後の空白は JavaScript の空白（全角の空白 U+3000 なども）
- 正規表現（extract・match・regreplace・regcount）は JavaScript の書き方を Python の書き方へ読み替える（js_regex）
- 壊れた式は読むとき（compile）に断り、行ごとの失敗はその行だけ空（None）にする
LotScope の変換表（conv）は持ち込まない（WaveLog に変換表のマスタは無い。画面の式にも無い）。
"""
from __future__ import annotations

import datetime as _dt
import json
import math
import re
import unicodedata
from decimal import ROUND_HALF_UP, Decimal
from .. import safe_regex

MAX_LEN = 2000
RE_MAX = 200
JS_WS = "\t\n\v\f\r                  　﻿"
_WS = set(JS_WS)


class FormulaError(ValueError):
    pass


# ---------------------------------------------------------------- 字（UTF-16 の単位）
def _bmp(s):
    return not s or max(s) < "\U00010000"


def _units(s):
    return s.encode("utf-16-le", "surrogatepass")


def _from_units(b):
    return b.decode("utf-16-le", "surrogatepass")


def u16len(s):
    return len(s) if _bmp(s) else len(_units(s)) // 2


def u16slice(s, start, end=None):
    """JavaScript の String.prototype.slice（位置は UTF-16 の単位。負は後ろから。小数は 0 の側へ切る）"""
    n = u16len(s)

    def at(v, dflt):
        if v is None:
            return dflt
        if isinstance(v, float):
            if math.isnan(v):
                return 0
            if math.isinf(v):
                return n if v > 0 else 0
            v = int(v)               # 0 の側へ切る（ToIntegerOrInfinity）
        return max(n + v, 0) if v < 0 else min(v, n)
    a, b = at(start, 0), at(end, n)
    if a >= b:
        return ""
    if _bmp(s):
        return s[a:b]
    return _from_units(_units(s)[2 * a:2 * b])


def u16index(s, sub):
    if _bmp(s) and _bmp(sub):
        return s.find(sub)
    hay, needle = _units(s), _units(sub)
    i = hay.find(needle)
    while i >= 0 and i % 2:
        i = hay.find(needle, i + 1)
    return -1 if i < 0 else i // 2


def _u16order(a, b):
    """字の大小（-1/0/1）を UTF-16 の単位の順で（JavaScript の < と同じ。U+10000 以上の字は 2 つの単位で比べる）"""
    if not (_bmp(a) and _bmp(b)):
        a, b = a.encode("utf-16-be", "surrogatepass"), b.encode("utf-16-be", "surrogatepass")
    return -1 if a < b else 1 if a > b else 0


def _u16list(s):
    if _bmp(s):
        return list(s)
    b = _units(s)
    return [_from_units(b[i:i + 2]) for i in range(0, len(b), 2)]


def js_trim(s):
    return s.strip(JS_WS)


# ---------------------------------------------------------------- 数と字（JavaScript と同じ）
_REPR = re.compile(r"([0-9]+)(?:\.([0-9]*))?(?:e([+-]?[0-9]+))?")


def js_num_text(f):
    """JavaScript の String(数)"""
    if isinstance(f, int) and not isinstance(f, bool):
        f = float(f) if abs(f) >= 2 ** 53 else f
        if isinstance(f, int):
            return str(f)
    if math.isnan(f):
        return "NaN"
    if math.isinf(f):
        return "Infinity" if f > 0 else "-Infinity"
    if f == 0:
        return "0"
    sign = "-" if f < 0 else ""
    m = _REPR.fullmatch(repr(abs(f)))
    ip, fp, ex = m.group(1), m.group(2) or "", int(m.group(3) or 0)
    digits, point = ip + fp, len(ip) + ex
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    k, n = len(digits), point
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def text_of(v):
    if v is None:
        return ""
    if _is_num(v):
        return js_num_text(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", "replace")
    return str(v)


# 数の読み方（§9.581。画面の looseNum と同じ形。サーバーの一覧の `sort_order.num_of()` と同じ決まり。数字は半角だけ＝JavaScript の \\d）
_LOOSE = re.compile(r"[-+]?(?:(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]*)?|\.[0-9]+)")


def loose_num(v):
    """list-formula.js の looseNum（数として読めるか。字の全体が数のときだけ・3 桁区切りは正しい位置だけ）"""
    if _is_num(v):
        f = float(v)
        return f if math.isfinite(f) else None
    t = js_trim(text_of(v))
    if not t or not _LOOSE.fullmatch(t):
        return None
    f = float(t.replace(",", ""))
    return f if math.isfinite(f) else None


num_of = loose_num


def strict_num(v):
    """list-formula.js の strictNum（書いてある通りに数か。整数の部分が 0 で始まらない＝'010' はコード）"""
    if _is_num(v):
        f = float(v)
        return f if math.isfinite(f) else None
    n = loose_num(v)
    if n is None:
        return None
    t = js_trim(text_of(v))
    whole = (t[1:] if t[:1] in "+-" else t).split(".")[0]
    return None if len(whole) > 1 and whole[0] == "0" else n


def tidy(n):
    """計算の結果を 15 桁へ丸める（JavaScript の Number(n.toPrecision(15))。toPrecision は同じ近さなら大きい側）"""
    if n is None or not math.isfinite(n):
        return None
    if n == 0:
        return 0.0
    d = Decimal(n)
    q = Decimal(1).scaleb(d.adjusted() - 14)
    return float(d.quantize(q, rounding=ROUND_HALF_UP))


def round_half_away(n, d):
    """四捨五入は 0 から遠い側（Excel の ROUND）。桁は 10 進の字でずらす（list-formula.js の roundHalfAway と同じ）"""
    def shift(x, k):
        m, _, e = js_num_text(x).partition("e")
        return float(f"{m}e{(int(e) if e else 0) + k}")
    sign = 1.0 if n > 0 else -1.0 if n < 0 else 0.0
    return tidy(sign * shift(_js_round(shift(abs(n), d)), -d))


def truthy(v):
    n = num_of(v)
    return text_of(v) != "" if n is None else n != 0


def ordered(a, b):
    """大小を比べられるか（どちらかが空欄なら比べない・§9.581）"""
    return js_trim(text_of(a)) != "" and js_trim(text_of(b)) != ""


def js_cmp(a, b):
    """表示ルールと同じ比べ方（-1/0/1）。数は looseNum で読む"""
    x, y = loose_num(a), loose_num(b)
    if x is not None and y is not None:
        return -1 if x < y else 1 if x > y else 0
    return _u16order(text_of(a), text_of(b))


# ---------------------------------------------------------------- 正規表現（JavaScript → Python）
_RE_CACHE = {}
_LINE = "\n\r  "
_CLASS_WS = re.escape(JS_WS)


def js_regex(src, flags=""):
    k = (flags, src)
    hit = _RE_CACHE.get(k)
    if hit is not None:
        return hit
    if len(src) > RE_MAX:
        raise FormulaError(f"正規表現は{RE_MAX}文字までです")
    why = safe_regex.risk(src)       # 照合が止まらなくなる形は断る（画面の式も同じ・§9.629）
    if why:
        raise FormulaError(why)
    try:
        rx = re.compile(_translate(src), re.ASCII)
    except re.error as e:
        raise FormulaError(str(e)) from None
    if len(_RE_CACHE) > 200:
        _RE_CACHE.clear()
    _RE_CACHE[k] = rx
    return rx


_KEEP_ESC = set("bBdDwWfnrtv")


def _translate(src):
    out, i, n, in_class = [], 0, len(src), False
    while i < n:
        ch = src[i]
        if ch == "\\" and i + 1 < n:
            nx = src[i + 1]
            if nx == "s":
                out.append(_CLASS_WS if in_class else f"[{_CLASS_WS}]")
            elif nx == "S":
                out.append("\\S" if in_class else f"[^{_CLASS_WS}]")
            elif nx == "k" and src[i + 2:i + 3] == "<" and ">" in src[i + 3:]:
                j = src.index(">", i + 3)
                out.append(f"(?P={src[i + 3:j]})")
                i = j + 1
                continue
            elif nx == "c" and i + 2 < n and src[i + 2].isascii() and src[i + 2].isalpha():
                out.append(re.escape(chr(ord(src[i + 2]) % 32)))
                i += 3
                continue
            elif nx == "x" and re.fullmatch(r"[0-9A-Fa-f]{2}", src[i + 2:i + 4]):
                out.append(src[i:i + 4])
                i += 4
                continue
            elif nx == "u" and re.fullmatch(r"[0-9A-Fa-f]{4}", src[i + 2:i + 6]):
                out.append(src[i:i + 6])
                i += 6
                continue
            elif nx == "0" and not src[i + 2:i + 3].isdigit():
                out.append("\\x00")
            elif nx.isdigit() or nx in _KEEP_ESC:
                out.append("\\" + nx)
            elif nx.isascii() and nx.isalpha():
                out.append(re.escape(nx))      # JavaScript では知らない英字の \ は、その字そのもの
            else:
                out.append("\\" + nx)
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            out.append(ch)
            i += 1
            continue
        if ch == "[":
            if src.startswith("[^]", i):
                out.append("[\\s\\S]")
                i += 3
                continue
            if src.startswith("[]", i):
                out.append("(?!)")
                i += 2
                continue
            in_class = True
            out.append(ch)
            if src[i + 1:i + 2] == "^":
                out.append("^")
                i += 1
            if src[i + 1:i + 2] == "]":      # [] の頭の ] は字（Python も同じ）
                out.append("\\]")
                i += 1
            i += 1
            continue
        if ch == "(" and src.startswith("(?<", i) and src[i + 3:i + 4] not in ("=", "!"):
            out.append("(?P<")
            i += 3
            continue
        if ch == ".":
            out.append(f"[^{_LINE}]")
        elif ch == "$":
            out.append("\\Z")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _js_replacement(rep):
    """JavaScript の置き換えの字（$1・$&・$$・$`・$'・$<名前>）→ 合った物ごとに字を作る関数"""
    def make(m):
        s, out, i, n = m.string, [], 0, len(rep)
        groups = m.re.groups
        while i < n:
            ch = rep[i]
            if ch != "$" or i + 1 >= n:
                out.append(ch)
                i += 1
                continue
            nx = rep[i + 1]
            if nx == "$":
                out.append("$")
                i += 2
            elif nx == "&":
                out.append(m.group(0))
                i += 2
            elif nx == "`":
                out.append(s[:m.start()])
                i += 2
            elif nx == "'":
                out.append(s[m.end():])
                i += 2
            elif nx.isdigit() and nx.isascii():
                two = rep[i + 1:i + 3]
                if len(two) == 2 and two.isdigit() and two.isascii() and 1 <= int(two) <= groups:
                    out.append(m.group(int(two)) or "")
                    i += 3
                elif 1 <= int(nx) <= groups:
                    out.append(m.group(int(nx)) or "")
                    i += 2
                else:
                    out.append("$" + nx)
                    i += 2
            elif nx == "<" and m.re.groupindex and ">" in rep[i + 2:]:
                j = rep.index(">", i + 2)
                name = rep[i + 2:j]
                out.append((m.group(name) or "") if name in m.re.groupindex else "")
                i = j + 1
            else:
                out.append("$")
                i += 1
        return "".join(out)
    return make


# ---------------------------------------------------------------- 字句解析・構文解析（list-formula.js と同じ）
_NUM = re.compile(r"[0-9]+(?:\.[0-9]+)?|\.[0-9]+")
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def _lex(src):
    out, i, s = [], 0, str(src or "")
    while i < len(s):
        ch = s[i]
        if ch in _WS:
            i += 1
            continue
        if ch == "[":
            end = s.find("]", i + 1)
            if end < 0:
                raise FormulaError("列名の [ ] が閉じていません")
            out.append(("col", s[i + 1:end]))
            i = end + 1
            continue
        if ch in "'\"":
            j = s.find(ch, i + 1)
            if j < 0:
                raise FormulaError("文字列の引用符が閉じていません")
            out.append(("str", s[i + 1:j]))
            i = j + 1
            continue
        m = _NUM.match(s, i)
        if m:
            out.append(("num", float(m.group(0))))
            i = m.end()
            continue
        two = s[i:i + 2]
        if two in ("<=", ">=", "<>", "!="):
            out.append(("op", "<>" if two == "!=" else two))
            i += 2
            continue
        if ch in "+-*/%(),":
            out.append((ch if ch in "()," else "op", ch))
            i += 1
            continue
        if ch in "=<>":
            out.append(("op", ch))
            i += 1
            continue
        m = _NAME.match(s, i)
        if m:
            out.append(("name", m.group(0).lower()))
            i = m.end()
            continue
        bad = ch if ch < "\U00010000" else chr(0xD800 + ((ord(ch) - 0x10000) >> 10))   # JavaScript は UTF-16 の単位 1 つを言う
        raise FormulaError(f"使えない文字です: {bad}")
    return out


ARITY = {"cmp": 2, "num": 1, "text": 1, "abs": 1, "round": 2, "len": 1, "left": 2, "right": 2, "trim": 1, "upper": 1, "lower": 1,
         "find": 2, "replace": 3, "match": 2, "regreplace": 3, "split": 3, "contains": 2, "startswith": 2, "endswith": 2, "hankaku": 1,
         # 版 3.46.0
         "count": 2, "regcount": 2, "lenb": 1, "rept": 2, "int": 1, "ceil": 1, "sqrt": 1, "isnum": 1, "isblank": 1,
         "year": 1, "month": 1, "day": 1, "hour": 1, "minute": 1, "weekday": 1, "date": 1}
ARITY_RANGE = {"mid": (2, 3), "extract": (2, 3), "padleft": (2, 3),
               "roundup": (1, 2), "rounddown": (1, 2), "datediff": (2, 3), "ifs": (2, 40), "switch": (3, 41), "kamadate": (1, 2),
               "min": (1, 30), "max": (1, 30), "sum": (1, 30), "avg": (1, 30)}
REGEX_FUNCS = {"extract", "match", "regreplace", "regcount"}


def _check_call(name, args):
    """関数の呼び出し1つの形（知っている関数か・引数の数・正規表現の字）を確かめる。"""
    if name != "if" and name not in FUNCS:
        raise FormulaError(f"知らない関数です: {name}")
    if name == "if" and len(args) < 2:
        raise FormulaError("if は if(条件, 真のとき, 偽のとき) です")
    if name in ARITY and len(args) != ARITY[name]:
        raise FormulaError(f"{name} は引数が{ARITY[name]}個です（{len(args)}個でした）")
    if name in ARITY_RANGE and not ARITY_RANGE[name][0] <= len(args) <= ARITY_RANGE[name][1]:
        lo, hi = ARITY_RANGE[name]
        raise FormulaError(f"{name} は引数が{lo}〜{hi}個です（{len(args)}個でした）")
    if name in REGEX_FUNCS and args[1][0] == "str":
        try:
            js_regex(args[1][1])
        except FormulaError as e:
            raise FormulaError(f"{name} の正規表現として読めません: {e}") from None


# 二項の演算子の段（弱い順）: (この段の印を見分ける, 節の形)。左から結ぶ
_LEVELS = (
    (lambda x: x == ("name", "or"), lambda x, a, b: ("or", a, b)),
    (lambda x: x == ("name", "and"), lambda x, a, b: ("and", a, b)),
    (lambda x: x[0] == "op" and x[1] in ("=", "<>", "<", "<=", ">", ">="), lambda x, a, b: ("cmp", x[1], a, b)),
    (lambda x: x[0] == "op" and x[1] in "+-", lambda x, a, b: ("bin", x[1], a, b)),
    (lambda x: x[0] == "op" and x[1] in "*/%", lambda x, a, b: ("bin", x[1], a, b)),
)


class _Parser:
    """字の並び → 式の木（list-formula.js の parse と同じ文法）。"""

    def __init__(self, ts):
        self.ts, self.p = ts, 0

    def peek(self):
        return self.ts[self.p] if self.p < len(self.ts) else None

    def eat(self, t, v=None):
        x = self.peek()
        if not x or x[0] != t or (v is not None and x[1] != v):
            return None
        self.p += 1
        return x

    def expect(self, t, v=None):
        x = self.eat(t, v)
        if not x:
            raise FormulaError(f"{v or t} が必要です")
        return x

    def binary(self, level=0):
        if level >= len(_LEVELS):
            return self.unary()
        hit, make = _LEVELS[level]
        n = self.binary(level + 1)
        while (x := self.peek()) and hit(x):
            self.p += 1
            n = make(x, n, self.binary(level + 1))
        return n

    def unary(self):
        x = self.peek()
        if x == ("op", "-"):
            self.p += 1
            return ("neg", self.unary())
        if x == ("name", "not"):
            self.p += 1
            return ("not", self.unary())
        return self.atom()

    def call(self, name):
        if not self.eat("("):
            raise FormulaError(f"関数の ( が必要です: {name}")
        args = []
        if not self.eat(")"):
            args.append(self.binary())
            while self.eat(","):
                args.append(self.binary())
            self.expect(")")
        _check_call(name, args)
        return ("call", name, args)

    def atom(self):
        x = self.peek()
        if not x:
            raise FormulaError("式が途中で終わっています")
        if x[0] in ("num", "str", "col"):
            self.p += 1
            return x
        if x[0] == "(":
            self.p += 1
            n = self.binary()
            self.expect(")")
            return n
        if x[0] == "name":
            self.p += 1
            return self.call(x[1])
        raise FormulaError("式として読めません")


def parse(src):
    if len(str(src or "")) > MAX_LEN:
        raise FormulaError(f"式が長すぎます({MAX_LEN}文字まで)")
    ps = _Parser(_lex(src))
    node = ps.binary()
    if ps.p < len(ps.ts):
        raise FormulaError("式の後ろに余分なものがあります")
    return node


# ---------------------------------------------------------------- 関数（list-formula.js の FUNCS と同じ）
def _pos(v):
    n = num_of(v)
    return 1 if n is None else max(1, math.floor(n))


def _js_round(x):
    if not math.isfinite(x):
        return x
    r = math.floor(x)
    return float(r + 1 if x - r >= 0.5 else r)


def _round(a):
    n = num_of(a[0])
    if n is None:
        return None
    return round_half_away(n, int(max(0.0, min(8.0, math.trunc(num_of(a[1]) or 0.0)))))


def _right(a):
    n = max(0.0, num_of(a[1]) or 0.0)
    return u16slice(text_of(a[0]), -n) if n else ""


def _mid(a):
    t, st = text_of(a[0]), _pos(a[1]) - 1
    n = max(0.0, num_of(a[2]) or 0.0) if len(a) > 2 else u16len(t)
    return u16slice(t, st, st + n)


def _replace(a):
    t, sub, rep = text_of(a[0]), text_of(a[1]), text_of(a[2])
    return rep.join(_u16list(t)) if sub == "" else t.replace(sub, rep)


def _extract(a):
    m = js_regex(text_of(a[1])).search(text_of(a[0]))
    if not m:
        return ""
    g = max(0.0, num_of(a[2]) or 0.0) if len(a) > 2 else 0.0
    if g != int(g) or int(g) > m.re.groups:
        return ""
    v = m.group(int(g))
    return "" if v is None else v


def _split(a):
    sep, t = text_of(a[1]), text_of(a[0])
    parts = t.split(sep) if sep else [t]
    i = _pos(a[2]) - 1
    return parts[i] if i < len(parts) else ""


def _padleft(a):
    t = text_of(a[0])
    width = int(max(0.0, min(64.0, num_of(a[1]) or 0.0)))
    fill = (text_of(a[2]) or "0") if len(a) > 2 else "0"
    need = width - u16len(t)
    if need <= 0:
        return t
    rep = fill * (need // max(1, u16len(fill)) + 1)
    return u16slice(rep, 0, need) + t


def _coalesce(a):
    for v in a:
        if v is not None and v != "":
            return v
    return ""


# ---------------------------------------------------------------- 版 3.46.0 で足した関数（利用者の要望 2026-10-21 の 5: 文字列のカウント・ほかの便利な関数）
# 画面（list-formula.js）と同じ決まり・同じ答え（tests/test_formula_parity.py が突き合わせる）
REPT_MAX = 10000          # rept の答えの長さ（UTF-16 の単位）
LENB_ONE = re.compile(r"[\x00-\x7f\uff61-\uff9f]")   # lenb で 1 と数える字（半角の英数記号・半角カナ）。ほかは 2（Excel の LENB と同じ数え方）


def _fsum(xs):
    """左から順に足す（JavaScript の reduce と同じ丸め。math.fsum は使わない）"""
    t = 0.0
    for x in xs:
        t += x
    return t


def _nums(a):
    return [n for n in map(num_of, a) if n is not None]


def _digits(v):
    """roundup・rounddown の桁（0〜8 の整数。小数は 0 の側へ切る）"""
    return int(max(0.0, min(8.0, num_of(v) or 0.0)))


def _round_dir(a, up):
    """Excel の ROUNDUP（0 から遠い側）・ROUNDDOWN（0 の側）。x×10^桁 の小さな誤差（1.1×10＝11.000000000000002）は 15 桁で丸めてから切る"""
    n = num_of(a[0])
    if n is None:
        return None
    p = float(10 ** (_digits(a[1]) if len(a) > 1 else 0))
    t = float("%.15g" % (abs(n) * p))
    return tidy((-1.0 if n < 0 else 1.0) * (math.ceil(t) if up else math.floor(t)) / p)


def _rept(a):
    t, n = text_of(a[0]), int(max(0.0, min(1000.0, num_of(a[1]) or 0.0)))
    if t and u16len(t) * n > REPT_MAX:
        n = REPT_MAX // u16len(t)
    return t * n


def _switch(a):
    """switch(x, 値1, 答え1, 値2, 答え2, …[, どれでもない時])。値は = と同じ比べ方"""
    for i in range(1, len(a) - 1, 2):
        if _cmp_op("=", a[0], a[i]):
            return a[i + 1]
    return a[-1] if len(a) % 2 == 0 else ""


def _ifs(a):
    """ifs(条件1, 答え1, 条件2, 答え2, …[, どれでもない時])"""
    for i in range(0, len(a) - 1, 2):
        if truthy(a[i]):
            return a[i + 1]
    return a[-1] if len(a) % 2 else ""


# 日時（年月日・時刻）。数字は半角だけ。区切りは - / . 年月日 と、日と時刻の間の T・空白（全角の空白も）
_D_YMD = re.compile(r"([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T \u3000]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?")
_D_YY = re.compile(r"([0-9]{2})/([0-9]{1,2})/([0-9]{1,2})(?:[T \u3000]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?")
_D_8 = re.compile(r"([0-9]{4})([0-9]{2})([0-9]{2})")
_D_T = re.compile(r"([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?")
_DIM = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _days(y, m, d):
    """1970-01-01 からの日数（Howard Hinnant の days_from_civil。整数だけで計算する: 画面の JavaScript と同じ答え）"""
    y -= m <= 2
    era = y // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    return era * 146097 + yoe * 365 + yoe // 4 - yoe // 100 + doy - 719468


def when(v):
    """値 → (年, 月, 日, 時, 分, 秒, 日付がある)。日時と読めなければ None（時刻だけは 1970-01-01 の時刻）"""
    t = js_trim(text_of(v))
    m = _D_YMD.fullmatch(t) or _D_YY.fullmatch(t) or _D_8.fullmatch(t)
    if m:
        g = [int(x) if x else 0 for x in m.groups()] + [0] * (6 - len(m.groups()))
        y = g[0] + 2000 if m.re is _D_YY else g[0]
        has = True
    else:
        m = _D_T.fullmatch(t)
        if not m:
            return None
        g, y, has = [1970, 1, 1] + [int(x) if x else 0 for x in m.groups()], 1970, False
    mo, d, h, mi, sec = g[1], g[2], g[3], g[4], g[5]
    dim = 29 if mo == 2 and (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else _DIM[mo - 1] if 1 <= mo <= 12 else 0
    if not (1 <= d <= dim and h <= 23 and mi <= 59 and sec <= 59):
        return None
    return y, mo, d, h, mi, sec, has


def _sec(w):
    return _days(w[0], w[1], w[2]) * 86400 + w[3] * 3600 + w[4] * 60 + w[5]


DATEDIFF_UNITS = {"d": 86400, "日": 86400, "h": 3600, "時": 3600, "時間": 3600, "m": 60, "分": 60, "s": 1, "秒": 1}


def _datediff(a):
    """datediff(始め, 終わり[, 単位])＝終わり−始め（d＝日〈既定〉・h＝時間・m＝分・s＝秒）"""
    x, y = when(a[0]), when(a[1])
    u = DATEDIFF_UNITS.get(js_trim(text_of(a[2])).lower() if len(a) > 2 else "d")
    if x is None or y is None or u is None:
        return None
    return tidy((_sec(y) - _sec(x)) / u)


def _part(i, need_date=True):
    def f(a):
        w = when(a[0])
        return None if w is None or (need_date and not w[6]) else float(w[i])
    return f


def _weekday(a):
    w = when(a[0])
    return None if w is None or not w[6] else float((_days(w[0], w[1], w[2]) % 7 + 4) % 7 + 1)


def _date(a):
    w = when(a[0])
    return None if w is None or not w[6] else f"{w[0]:04d}-{w[1]:02d}-{w[2]:02d}"


def _kama_day(y, m, week, wd):
    """y 年 m 月の、第 week 週・曜日 wd（日＝1 〜 土＝7）の日（無ければ None）。月初を第 1 週として日曜日で 1 つ進み、
    第 6 週は第 1 週に戻す（利用者の kama_to_date・VBA と同じ。同じ週・曜日が 2 度あれば月の早い方）"""
    first = _days(y, m, 1)
    last = (_days(y + 1, 1, 1) if m == 12 else _days(y, m + 1, 1)) - first
    sw = (first % 7 + 4) % 7          # 月初の曜日（0＝日 〜 6＝土）
    n = 0
    for d in range(1, last + 1):
        dw = (sw + d - 1) % 7 + 1
        if n == 0 or dw == 1:
            n = 1 if n == 5 else n + 1
        if n == week and dw == wd:
            return d
    return None


def _kamadate(a):
    """kamadate(釜番[, 基準日])（版 3.51.2。利用者の要望 2026-10-23）: 釜番（3 桁。1 桁目＝月の第何週・2 桁目＝曜日〈日＝1 〜 土＝7〉・
    3 桁目＝何番目〈日付には使わない〉）→ 日付（YYYY-MM-DD）。釜番は月を持たないので、基準日（省くと今日）の前の月・その月・次の月のうち、
    その週・曜日の日付が基準日にいちばん近い物（同じ近さなら前の物）。仕掛の釜番は今日の前後数週間を指し、月をまたぐため
    （例: 2026-10-23 に 141 → 11 月 4 日。10 月の第 1 週に水曜は無い）。3 桁の数字でない・週が 1〜5 でない・曜日が 1〜7 でない釜番（0 など）は空"""
    k = js_trim(text_of(a[0]))
    if not re.fullmatch(r"[0-9]{3}", k):
        return None
    week, wd = int(k[0]), int(k[1])
    if not (1 <= week <= 5 and 1 <= wd <= 7):
        return None
    if len(a) > 1:
        w = when(a[1])
        if w is None or not w[6]:
            return None
        y, m, d0 = w[0], w[1], w[2]
    else:
        t = _today()
        y, m, d0 = t.year, t.month, t.day
    base, best = _days(y, m, d0), None
    for dm in (-1, 0, 1):
        yy, mm = (y - 1, 12) if m + dm == 0 else (y + 1, 1) if m + dm == 13 else (y, m + dm)
        d = _kama_day(yy, mm, week, wd)
        if d is not None:
            gap = abs(_days(yy, mm, d) - base)
            if best is None or gap < best[0]:
                best = (gap, yy, mm, d)
    return None if best is None else f"{best[1]:04d}-{best[2]:02d}-{best[3]:02d}"


def _today():
    return _dt.date.today()


FUNCS = {
    "num": lambda a: num_of(a[0]),
    "text": lambda a: text_of(a[0]),
    "abs": lambda a: None if num_of(a[0]) is None else abs(num_of(a[0])),
    "round": _round,
    "len": lambda a: float(u16len(text_of(a[0]))),
    "left": lambda a: u16slice(text_of(a[0]), 0, max(0.0, num_of(a[1]) or 0.0)),
    "right": _right,
    "trim": lambda a: js_trim(text_of(a[0])),
    "upper": lambda a: text_of(a[0]).upper(),
    "lower": lambda a: text_of(a[0]).lower(),
    "concat": lambda a: "".join(text_of(x) for x in a),
    "coalesce": _coalesce,
    "mid": _mid,
    "find": lambda a: float(u16index(text_of(a[0]), text_of(a[1])) + 1),
    "replace": _replace,
    "extract": _extract,
    "match": lambda a: 1.0 if js_regex(text_of(a[1])).search(text_of(a[0])) else 0.0,
    "regreplace": lambda a: js_regex(text_of(a[1]), "g").sub(_js_replacement(text_of(a[2])), text_of(a[0])),
    "split": _split,
    "contains": lambda a: 1.0 if text_of(a[1]) in text_of(a[0]) else 0.0,
    "cmp": lambda a: float(js_cmp(a[0], a[1])),
    "startswith": lambda a: 1.0 if text_of(a[0]).startswith(text_of(a[1])) else 0.0,
    "endswith": lambda a: 1.0 if text_of(a[0]).endswith(text_of(a[1])) else 0.0,
    "hankaku": lambda a: unicodedata.normalize("NFKC", text_of(a[0])),
    "padleft": _padleft,
    # 版 3.46.0
    "count": lambda a: float(text_of(a[0]).count(text_of(a[1]))) if text_of(a[1]) else 0.0,
    "regcount": lambda a: float(sum(1 for _ in js_regex(text_of(a[1]), "g").finditer(text_of(a[0])))),
    "lenb": lambda a: float(sum(1 if LENB_ONE.fullmatch(c) else 2 for c in _u16list(text_of(a[0])))),
    "rept": _rept,
    "min": lambda a: min(_nums(a)) if _nums(a) else None,
    "max": lambda a: max(_nums(a)) if _nums(a) else None,
    "sum": lambda a: tidy(_fsum(_nums(a))) if _nums(a) else None,
    "avg": lambda a: tidy(_fsum(_nums(a)) / len(_nums(a))) if _nums(a) else None,
    "int": lambda a: None if num_of(a[0]) is None else float(math.floor(num_of(a[0]))),
    "ceil": lambda a: None if num_of(a[0]) is None else float(math.ceil(num_of(a[0]))),
    "roundup": lambda a: _round_dir(a, True),
    "rounddown": lambda a: _round_dir(a, False),
    "sqrt": lambda a: None if num_of(a[0]) is None or num_of(a[0]) < 0 else tidy(math.sqrt(num_of(a[0]))),
    "isnum": lambda a: 0.0 if strict_num(a[0]) is None else 1.0,
    "isblank": lambda a: 1.0 if js_trim(text_of(a[0])) == "" else 0.0,
    "ifs": _ifs,
    "switch": _switch,
    "year": _part(0), "month": _part(1), "day": _part(2), "hour": _part(3, False), "minute": _part(4, False),
    "weekday": _weekday,
    "date": _date,
    "datediff": _datediff,
    "kamadate": _kamadate,
}


def _cmp_op(op, a, b):
    """比較（=・<>・<・<=・>・>=）。どちらも書いてある通りに数なら数で、ほかは字で。大小は空欄に当たらない（§9.581）"""
    if op not in ("=", "<>") and not ordered(a, b):
        return 0.0
    x, y = strict_num(a), strict_num(b)
    c = (-1 if x < y else 1 if x > y else 0) if x is not None and y is not None else _u16order(text_of(a), text_of(b))
    ok = {"=": c == 0, "<>": c != 0, "<": c < 0, "<=": c <= 0, ">": c > 0}.get(op, c >= 0)
    return 1.0 if ok else 0.0


def _eval(n, row):
    k = n[0]
    if k in ("num", "str"):
        return n[1]
    if k == "col":
        return row(n[1])
    if k == "neg":
        a = num_of(_eval(n[1], row))
        return None if a is None else -a
    if k == "not":
        return 0.0 if truthy(_eval(n[1], row)) else 1.0
    if k == "and":
        return 1.0 if truthy(_eval(n[1], row)) and truthy(_eval(n[2], row)) else 0.0
    if k == "or":
        return 1.0 if truthy(_eval(n[1], row)) or truthy(_eval(n[2], row)) else 0.0
    if k == "cmp":
        return _cmp_op(n[1], _eval(n[2], row), _eval(n[3], row))
    if k == "bin":
        op, a, b = n[1], _eval(n[2], row), _eval(n[3], row)
        if op == "+":
            # 両方が書いてある通りに数のときだけ足し算、そうでなければ連結（'12A'+'3'・'010'+'3' は字のまま・§9.581）
            x, y = strict_num(a), strict_num(b)
            return tidy(x + y) if x is not None and y is not None else text_of(a) + text_of(b)
        x, y = num_of(a), num_of(b)
        if x is None or y is None:
            return None
        if op == "-":
            return tidy(x - y)
        if op == "*":
            return tidy(x * y)
        if op == "/":
            return None if y == 0 else tidy(x / y)
        return None if y == 0 else tidy(math.fmod(x, y))
    if k == "call":
        name, args = n[1], n[2]
        if name == "if":
            if truthy(_eval(args[0], row)):
                return _eval(args[1], row)
            return _eval(args[2], row) if len(args) > 2 else ""
        return FUNCS[name]([_eval(a, row) for a in args])
    return None


def columns_used(node, out=None):
    out = [] if out is None else out
    if isinstance(node, tuple):
        if node[0] == "col" and node[1] not in out:
            out.append(node[1])
        for x in node[1:]:
            if isinstance(x, tuple):
                columns_used(x, out)
            elif isinstance(x, list):
                for y in x:
                    columns_used(y, out)
    return out


class Formula:
    """読み解いた式（1 回だけ読み、行ごとに使い回す）。run(lookup) の lookup は 列名 → 値（無ければ None）"""

    def __init__(self, src):
        self.src = str(src or "")
        self.node = parse(self.src)
        self.columns = columns_used(self.node)

    def run(self, lookup):
        try:
            return _eval(self.node, lookup)
        except (FormulaError, ValueError, TypeError, OverflowError, IndexError, KeyError, re.error, RecursionError):
            return None      # その行だけ空（列ごと落とさない）


def compile_formula(src):
    return Formula(src)


def check(src):
    if not str(src or "").strip():
        return {"ok": False, "error": "式を入力してください"}
    try:
        return {"ok": True, "columns": Formula(src).columns}
    except FormulaError as e:
        return {"ok": False, "error": str(e)}


def sql_value(v):
    """式の答え → SQLite に返す値（整数に読める実数は整数: 字にしたとき JavaScript と同じ「1」になる）"""
    if isinstance(v, float):
        if not math.isfinite(v):
            return js_num_text(v)
        if v.is_integer() and abs(v) < 2 ** 53:
            return int(v)
    return v


# ---------------------------------------------------------------- 計算列（一覧の表示列の設定と同じ引き方）
class CalcColumns:
    """表示列の設定の式（formulas: {列名: 式}）と表示名（names: {元の列名: 表示名}）→ 計算列を値にする。
    画面（lotlist-columns.js の baseRow）と同じ引き方: [名前] は元の列 → 表示名 → 式を持つ列（その式を元の値で 1 段だけ計算）。
    計算列＝表に無い列の式。表にある列の式（元の値を作り替える式）は、計算列の中で [その列] と書いたときだけ効く（一覧と同じ）。"""

    MAX = 40

    def __init__(self, formulas, names, table_columns):
        self.cols = set(table_columns)
        self.names_rev = {str(v): str(k) for k, v in (names or {}).items() if str(v)}
        self.compiled = {}
        for k, v in list((formulas or {}).items())[:self.MAX]:
            if str(v or "").strip():
                try:
                    self.compiled[str(k)] = Formula(v)
                except FormulaError:
                    self.compiled[str(k)] = None     # 読めない式（使えば断る）
        self.calcs = [k for k in self.compiled if k not in self.cols]

    def key(self, name):
        return name if name in self.cols else self.names_rev.get(name, name)

    def broken(self, name):
        return name in self.compiled and self.compiled[name] is None

    def raw_deps(self, name):
        """計算列 name が読む表の列（表示名・ほかの式の列を 1 段たどる）。並びは決まった順"""
        f = self.compiled.get(name)
        out = []
        if not f:
            return out
        for c in f.columns:
            k = self.key(c)
            sub = self.compiled.get(k) if k != name else None
            for d in (sub.columns if sub else [k]):
                if d in self.cols and d not in out:
                    out.append(d)
        return out

    def runner(self, name):
        """計算列 name の値を出す関数（読む列の値を、raw_deps の並びで受け取る）"""
        f, deps = self.compiled[name], self.raw_deps(name)

        def run(*vals):
            raw = dict(zip(deps, vals))

            def plain(c):
                return raw.get(c)

            def look(c):
                k = self.key(c)
                if k == name:
                    return raw.get(k)
                sub = self.compiled.get(k)
                if sub:
                    return sub.run(plain)
                return raw.get(k)
            return sql_value(f.run(look))
        return run, deps


# ---------------------------------------------------------------- 計算列を SQLite の式にする（一覧の並べ替え・ダッシュボードの集計が同じ物を使う）
MAX_CALC = 40


def clean_calc(v):
    """画面が送る計算列 {formulas: {列名: 式}, names: {元の列名: 表示名}, own?: [名前]}（JSON の字でもよい）→ 字だけ・数と長さを限った形。無ければ None"""
    if isinstance(v, str):
        try:
            v = json.loads(v) if v.strip() else None
        except ValueError:
            return None
    if not isinstance(v, dict):
        return None

    def strs(d, n, size):
        items = list(d.items())[:n] if isinstance(d, dict) else []
        return {str(k)[:200]: str(x)[:size] for k, x in items if str(k).strip() and isinstance(x, str)}
    f = {k: x for k, x in strs(v.get("formulas"), MAX_CALC, MAX_LEN).items() if x.strip()}
    if not f:
        return None
    own = [str(x)[:200] for x in (v.get("own") if isinstance(v.get("own"), list) else []) if str(x) in f][:MAX_CALC]
    return {"formulas": f, "names": strs(v.get("names"), 400, 200), **({"own": own} if own else {})}


def register(conn, calc, cs, qi):
    """計算列を接続に SQLite の関数として登録する → (計算列の名前 → SQL の式, 読めない計算列の名前の並び, CalcColumns か None)。
    calc は clean_calc の形。qi は列名を括る関数（sqlite_ro.qi）。同じ値の組の答えは覚えて使い回す（20 万組まで）"""
    if not calc or not calc.get("formulas"):
        return {}, [], None
    cc = CalcColumns(calc.get("formulas"), calc.get("names"), cs)
    exprs, broken = {}, []
    for i, name in enumerate(cc.calcs):
        if cc.broken(name):
            broken.append(name)
            continue
        run, deps = cc.runner(name)
        memo = {}

        def fn(*vals, run=run, memo=memo):
            hit = memo.get(vals, memo)
            if hit is memo:
                if len(memo) > 200_000:
                    memo.clear()
                hit = memo[vals] = run(*vals)
            return hit
        conn.create_function(f"TpaCalc{i}", len(deps), fn, deterministic=True)
        exprs[name] = f"TpaCalc{i}({', '.join(qi(d) for d in deps)})"
    return exprs, broken, cc

