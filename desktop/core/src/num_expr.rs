//! 値の計算（四則演算・`backend/dashboard/num_expr.py` の写し・§9.634）。値は x（「値」「X」も同じ）。演算子から書けば
//! 前に値を置く（「÷1000」＝x÷1000）。使える物: 数・小数点・＋ − × ÷ ^（累乗）・かっこ・全角の字。式は読むだけ。
//!
//! 計算の失敗は Python と同じ所で「値なし」にする: 0 で割る・0 の負の累乗・負の数の小数の累乗（Python は複素数になる）・
//! 有限の数どうしの累乗が行き過ぎる。掛け算が行き過ぎて無限になるのは Python でも失敗ではない（最後に有限でなければ値なし）。

use crate::pyish::{ascii_digits, digit_value, is_digit, is_py_space, py_float_repr, py_str_or_none_empty, py_strip};
use serde_json::Value;

/// 書いた式 → 読む形（全角・×÷−・値 を半角の x * / - に。空白を除き、演算子から書いた式は前に x）。
pub fn normalize(src: &Value) -> String {
    let s = py_strip(&py_str_or_none_empty(src)).to_string();
    if s.is_empty() {
        return s;
    }
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let c = match c {
            '０'..='９' => char::from(b'0' + digit_value(c).unwrap_or(0) as u8),
            '．' => '.',
            '（' => '(',
            '）' => ')',
            '＋' => '+',
            '－' => '-',
            '＊' => '*',
            '／' => '/',
            '＾' => '^',
            '×' | '✕' => '*',
            '÷' => '/',
            '−' | '–' => '-',
            '値' | 'ｘ' | 'Ｘ' | 'X' => 'x',
            c => c,
        };
        if !is_py_space(c) {
            out.push(c);
        }
    }
    if out.starts_with(['*', '/', '+', '^']) || (out.starts_with('-') && !out.contains('x')) {
        out.insert(0, 'x');
    }
    out
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64, String),
    Op(char),
}

#[derive(Debug, Clone)]
enum Node {
    Num(f64),
    X,
    Neg(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
}

/// 計算の途中の失敗（Python で例外になる所）。
struct Fail;

impl Node {
    fn eval(&self, x: f64) -> Result<f64, Fail> {
        Ok(match self {
            Node::Num(n) => *n,
            Node::X => x,
            Node::Neg(a) => -a.eval(x)?,
            Node::Bin(op, a, b) => {
                let (a, b) = (a.eval(x)?, b.eval(x)?);
                match op {
                    '+' => a + b,
                    '-' => a - b,
                    '*' => a * b,
                    '/' if b == 0.0 => return Err(Fail),
                    '/' => a / b,
                    _ => pow(a, b)?,
                }
            }
        })
    }
}

/// Python の float の `**`。
fn pow(a: f64, b: f64) -> Result<f64, Fail> {
    if a == 0.0 && b < 0.0 {
        return Err(Fail); // ZeroDivisionError
    }
    if a < 0.0 && a.is_finite() && b.is_finite() && b.fract() != 0.0 {
        return Err(Fail); // 複素数になる
    }
    let r = a.powf(b);
    if r.is_infinite() && a.is_finite() && b.is_finite() {
        return Err(Fail); // OverflowError
    }
    Ok(r)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
    uses_x: bool,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn eat(&mut self, o: char) -> bool {
        if self.peek() == Some(&Tok::Op(o)) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn chain(&mut self, ops: &[char], next: fn(&mut Parser) -> Result<Node, String>) -> Result<Node, String> {
        let mut a = next(self)?;
        while let Some(&o) = ops.iter().find(|o| self.eat(**o)) {
            a = Node::Bin(o, Box::new(a), Box::new(next(self)?));
        }
        Ok(a)
    }

    fn total(&mut self) -> Result<Node, String> {
        self.chain(&['+', '-'], Parser::prod)
    }

    fn prod(&mut self) -> Result<Node, String> {
        self.chain(&['*', '/'], Parser::power)
    }

    fn power(&mut self) -> Result<Node, String> {
        let a = self.unary()?;
        if self.eat('^') {
            let b = self.power()?;
            return Ok(Node::Bin('^', Box::new(a), Box::new(b)));
        }
        Ok(a)
    }

    fn unary(&mut self) -> Result<Node, String> {
        if self.eat('-') {
            return Ok(Node::Neg(Box::new(self.unary()?)));
        }
        if self.eat('+') {
            return self.unary();
        }
        self.atom()
    }

    fn atom(&mut self) -> Result<Node, String> {
        match self.peek().cloned() {
            None => Err("式が途中で終わっています".into()),
            Some(Tok::Num(n, _)) => {
                self.pos += 1;
                Ok(Node::Num(n))
            }
            Some(Tok::Op('x')) => {
                self.pos += 1;
                self.uses_x = true;
                Ok(Node::X)
            }
            Some(Tok::Op('(')) => {
                self.pos += 1;
                let a = self.total()?;
                if !self.eat(')') {
                    return Err("かっこが閉じていません".into());
                }
                Ok(a)
            }
            Some(Tok::Op(o)) => Err(format!("「{o}」の前に数か値がありません")),
        }
    }

    fn whole(mut self) -> Result<Node, String> {
        let f = self.total()?;
        if let Some(t) = self.toks.get(self.pos) {
            return Err(format!("「{}」の前に演算子がありません", tok_text(t)));
        }
        if !self.uses_x {
            return Err("値（x）を使っていません。例: ÷1000・x×100".into());
        }
        Ok(f)
    }
}

fn tok_text(t: &Tok) -> String {
    match t {
        Tok::Op(o) => o.to_string(),
        Tok::Num(n, _) if n.fract() == 0.0 && n.is_finite() => format!("{n:.0}"),
        Tok::Num(n, _) => py_float_repr(*n),
    }
}

/// 字の並び → 字の部品と、使えない字（`(\d+\.?\d*|\.\d+)|([x+\-*/^()])` で拾えなかった字）。
fn tokens(s: &str) -> (Vec<Tok>, String) {
    let cs: Vec<char> = s.chars().collect();
    let (mut toks, mut bad, mut i) = (Vec::new(), String::new(), 0);
    while i < cs.len() {
        let start = i;
        let digits = |mut j: usize| {
            while j < cs.len() && is_digit(cs[j]) {
                j += 1;
            }
            j
        };
        if is_digit(cs[i]) {
            i = digits(i);
            if cs.get(i) == Some(&'.') {
                i = digits(i + 1);
            }
        } else if cs[i] == '.' && cs.get(i + 1).is_some_and(|c| is_digit(*c)) {
            i = digits(i + 1);
        } else if "x+-*/^()".contains(cs[i]) {
            toks.push(Tok::Op(cs[i]));
            i += 1;
            continue;
        } else {
            bad.push(cs[i]);
            i += 1;
            continue;
        }
        let text: String = cs[start..i].iter().collect();
        let n = ascii_digits(&text).parse::<f64>().unwrap_or(f64::NAN);
        toks.push(Tok::Num(n, text));
    }
    (toks, bad)
}

/// 読めた式。`apply` で値に当てる。
#[derive(Debug, Clone)]
pub struct Expr(Node);

impl Expr {
    /// 値に当てる。計算が失敗する・有限でなければ None。
    pub fn apply(&self, x: f64) -> Option<f64> {
        self.0.eval(x).ok().filter(|v| v.is_finite())
    }
}

/// 式 → (読めた式, 知らせの字, 読んだ式の見せ方)。空なら (None, "", "")。読めなければ (None, 理由, "")。
pub fn compile_expr(src: &Value) -> (Option<Expr>, String, String) {
    let s = normalize(src);
    if s.is_empty() {
        return (None, String::new(), String::new());
    }
    let (toks, bad) = tokens(&s);
    if !bad.is_empty() {
        let mut seen: Vec<char> = Vec::new();
        for c in bad.chars() {
            if !seen.contains(&c) {
                seen.push(c);
            }
        }
        let list: Vec<String> = seen.iter().map(|c| c.to_string()).collect();
        return (None, format!("使えない字です: {}", list.join(" ")), String::new());
    }
    match (Parser { toks, pos: 0, uses_x: false }).whole() {
        Ok(f) => {
            let text = s.replace('*', "×").replace('/', "÷").replace('x', "値");
            (Some(Expr(f)), String::new(), text)
        }
        Err(e) => (None, e, String::new()),
    }
}
