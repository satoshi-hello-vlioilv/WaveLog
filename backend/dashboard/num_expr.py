# -*- coding: utf-8 -*-
"""値の計算（四則演算。版 3.50.0）。画面の static/js/num-format.js の expr と同じ読み方・同じ答え
（事例の表 tests/fixtures/num_expr_cases.json で両方を突き合わせる: tests/test_num_expr.py・tools/num-format-check.mjs）。

値は x（「値」「X」も同じ）。演算子から書けば前に値を置く（「÷1000」＝x÷1000・「×100」・「+5」・「-3」）。
使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。式は読むだけ（eval を使わない）。
集計の値ごとの計算（measures の expr。services/aggregate.py）が使う: 数え終えたセルの値に当て、表し方（割合・累計）はその後で決める。
"""
from __future__ import annotations

import math
import operator
import re

_ZEN = str.maketrans("０１２３４５６７８９．（）＋－＊／＾", "0123456789.()+-*/^")
_TOKEN = re.compile(r"(\d+\.?\d*|\.\d+)|([x+\-*/^()])")


def normalize(src) -> str:
    """書いた式 → 読む形（全角・×÷−・値 を半角の x * / - に。空白を除き、演算子から書いた式は前に x）"""
    s = str("" if src is None else src).strip()
    if not s:
        return ""
    s = s.translate(_ZEN)
    s = re.sub(r"[×✕]", "*", s).replace("÷", "/")
    s = re.sub(r"[−–]", "-", s)
    s = re.sub(r"値|ｘ|Ｘ|X", "x", s)
    s = re.sub(r"\s+", "", s)
    if re.match(r"^[*/+^]", s) or (s.startswith("-") and "x" not in s):
        s = "x" + s
    return s


class _Bad(Exception):
    pass


_SUM_OPS = {"+": operator.add, "-": operator.sub}
_PROD_OPS = {"*": operator.mul, "/": operator.truediv}


class _ExprParser:
    """字の並び → 計算する関数（num-format.js の expr と同じ文法）。"""

    def __init__(self, toks):
        self.toks, self.pos, self.uses_x = toks, 0, False

    def peek(self):
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def eat(self, o):
        t = self.peek()
        if t and t[0] == "o" and t[1] == o:
            self.pos += 1
            return True
        return False

    def chain(self, nxt, ops):
        """左から順に結ぶ（a op b op c …）。ops: 演算子の字 → 計算"""
        a = nxt()
        while True:
            o = next((k for k in ops if self.eat(k)), None)
            if o is None:
                return a
            a = _join(ops[o], a, nxt())

    def total(self):
        return self.chain(self.prod, _SUM_OPS)

    def prod(self):
        return self.chain(self.power, _PROD_OPS)

    def power(self):
        a = self.unary()
        if self.eat("^"):
            b = self.power()
            return lambda x: a(x) ** b(x)
        return a

    def unary(self):
        if self.eat("-"):
            a = self.unary()
            return lambda x: -a(x)
        if self.eat("+"):
            return self.unary()
        return self.atom()

    def atom(self):
        t = self.peek()
        if not t:
            raise _Bad("式が途中で終わっています")
        if t[0] == "n":
            self.pos += 1
            return lambda x, n=t[1]: n
        if self.eat("x"):
            self.uses_x = True
            return lambda x: x
        if self.eat("("):
            a = self.total()
            if not self.eat(")"):
                raise _Bad("かっこが閉じていません")
            return a
        raise _Bad(f"「{t[1]}」の前に数か値がありません")

    def whole(self):
        f = self.total()
        if self.pos < len(self.toks):
            raise _Bad(f"「{_tok_text(self.toks[self.pos])}」の前に演算子がありません")
        if not self.uses_x:
            raise _Bad("値（x）を使っていません。例: ÷1000・x×100")
        return f


def _safe(f):
    def fn(x):
        try:
            v = f(float(x))
        except (ZeroDivisionError, OverflowError, ValueError, TypeError):
            return None
        if isinstance(v, complex) or not math.isfinite(v):
            return None
        return v
    return fn


def compile_expr(src):
    """式 → (関数 fn(x)→数か None, 知らせの字, 読んだ式の見せ方)。空なら (None, "", "")。読めなければ (None, 理由, "")"""
    s = normalize(src)
    if not s:
        return None, "", ""
    toks = []

    def take(m):
        toks.append(("n", float(m.group(1))) if m.group(1) is not None else ("o", m.group(2)))
        return ""
    bad = _TOKEN.sub(take, s)
    if bad:
        return None, "使えない字です: " + " ".join(dict.fromkeys(bad)), ""
    try:
        f = _ExprParser(toks).whole()
    except _Bad as e:
        return None, str(e), ""
    text = s.replace("*", "×").replace("/", "÷").replace("x", "値")
    return _safe(f), "", text


def _join(f, a, b):
    return lambda x: f(a(x), b(x))


def _tok_text(t):
    if t[0] == "o":
        return t[1]
    n = t[1]
    return str(int(n)) if n == int(n) else str(n)
