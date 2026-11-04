//! 計算列の式（画面の `WL.formula`・`static/js/list/list-formula.js`）を、サーバーと同じ答えで計算する
//! （`backend/dashboard/formula.py` の写し・§9.636）。
//!
//! 答えの正は Python（Python は画面の JavaScript と `test_formulaparity` で突き合わせてある）。JavaScript と同じ答えにする決まり:
//! - 字は **UTF-16 の単位**で持つ（`U16`）。長さ・位置・切り出しは単位で数える（Python は surrogatepass で割れた字も持つ）
//! - 数は倍精度の実数。字にするときは JavaScript の `String(数)`（`js_num_text`）・計算の結果は 15 桁へ丸める（`tidy`）
//! - 正規表現は JavaScript の書き方を `fancy-regex` の書き方へ読み替える（`translate`）。`\d` `\w` `\b` は ASCII、`\s` は JS の空白、
//!   `.` は改行以外、`$` は字の終わり。空の照合の続け方は Python の `re.sub`・`finditer` と同じ（`matches`）
//! - 壊れた式は読むとき（`parse`）に断り、行ごとの失敗はその行だけ空（`Formula::run` が `Null`）
//!
//! SQLite へ関数として登録する所（`register`）は、接続を Rust が持つ P3 で写す。

use crate::pyish::{py_float, py_strip};
use crate::safe_regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use unicode_normalization::UnicodeNormalization;

pub const MAX_LEN: usize = 2000;
pub const RE_MAX: usize = 200;
pub const MAX_CALC: usize = 40;
const REPT_MAX: usize = 10000;
/// JavaScript の空白（`String.prototype.trim` と正規表現の `\s`）。
const JS_WS: [u16; 25] = [
    0x9, 0xa, 0xb, 0xc, 0xd, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];

/// JavaScript の字（UTF-16 の単位）。
pub type U16 = Vec<u16>;

pub fn u(s: &str) -> U16 {
    s.encode_utf16().collect()
}

/// UTF-16 → 字（割れたサロゲートは U+FFFD。正規表現・大文字小文字・NFKC へ渡すときだけ使う）。
pub fn lossy(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

/// 式の値。
#[derive(Debug, Clone, PartialEq)]
pub enum V {
    Null,
    /// 表から来た整数（Python の int。字にすると「1200」・答えにそのまま返ることがある）
    Int(i64),
    Num(f64),
    Str(U16),
}

impl V {
    pub fn from_json(v: &Value) -> V {
        match v {
            Value::Null => V::Null,
            Value::Number(n) => n.as_i64().map(V::Int).unwrap_or_else(|| V::Num(n.as_f64().unwrap_or(f64::NAN))),
            Value::String(s) => V::Str(u(s)),
            Value::Bool(b) => V::Str(u(if *b { "True" } else { "False" })),
            other => V::Str(u(&other.to_string())),
        }
    }

    /// JSON の値へ（割れたサロゲートを持つ字は `{"$u16": [...]}`・有限でない数は `{"$float": ...}`）。
    pub fn to_json(&self) -> Value {
        match self {
            V::Null => Value::Null,
            V::Int(i) => json!(i),
            V::Num(f) if f.is_finite() => json!(f),
            V::Num(f) => json!({"$float": if f.is_nan() { "nan" } else if *f > 0.0 { "inf" } else { "-inf" }}),
            V::Str(s) => u16_json(s),
        }
    }
}

pub fn u16_json(s: &[u16]) -> Value {
    match String::from_utf16(s) {
        Ok(t) => json!(t),
        Err(_) => json!({"$u16": s}),
    }
}

/// 読めない式（理由は UTF-16 の字。使えない字がサロゲートの片方のことがある）。
#[derive(Debug, Clone, PartialEq)]
pub struct FormulaError(pub U16);

fn err<T>(msg: &str) -> Result<T, FormulaError> {
    Err(FormulaError(u(msg)))
}

// ---------------------------------------------------------------- 字（UTF-16 の単位）

fn js_trim(s: &[u16]) -> U16 {
    let ws = |c: &u16| JS_WS.contains(c);
    let a = s.iter().position(|c| !ws(c)).unwrap_or(s.len());
    let b = s.iter().rposition(|c| !ws(c)).map_or(a, |i| i + 1);
    s[a..b.max(a)].to_vec()
}

/// JavaScript の `slice` の位置（負は後ろから・小数は 0 の側へ切る・NaN は 0）。
fn at(v: Option<f64>, dflt: i64, n: i64) -> i64 {
    let Some(v) = v else { return dflt };
    if v.is_nan() {
        return 0;
    }
    if v.is_infinite() {
        return if v > 0.0 { n } else { 0 };
    }
    let v = v.trunc() as i64;
    if v < 0 {
        (n + v).max(0)
    } else {
        v.min(n)
    }
}

fn u16slice(s: &[u16], start: Option<f64>, end: Option<f64>) -> U16 {
    let n = s.len() as i64;
    let (a, b) = (at(start, 0, n), at(end, n, n));
    if a >= b {
        Vec::new()
    } else {
        s[a as usize..b as usize].to_vec()
    }
}

fn find(hay: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

fn count(hay: &[u16], needle: &[u16]) -> usize {
    let (mut i, mut n) = (0, 0);
    while i + needle.len() <= hay.len() {
        if &hay[i..i + needle.len()] == needle {
            n += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    n
}

fn split(t: &[u16], sep: &[u16]) -> Vec<U16> {
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i + sep.len() <= t.len() {
        if &t[i..i + sep.len()] == sep {
            out.push(t[start..i].to_vec());
            i += sep.len();
            start = i;
        } else {
            i += 1;
        }
    }
    out.push(t[start..].to_vec());
    out
}

fn replace_all(t: &[u16], sub: &[u16], rep: &[u16]) -> U16 {
    split(t, sub).join(rep)
}

fn order(a: &[u16], b: &[u16]) -> i32 {
    match a.cmp(b) {
        std::cmp::Ordering::Less => -1,
        std::cmp::Ordering::Equal => 0,
        std::cmp::Ordering::Greater => 1,
    }
}

// ---------------------------------------------------------------- 数と字（JavaScript と同じ）

/// 最短の桁と小数点の位置（値 = 0.桁 × 10^点）。0 は ("0", 1)。
fn shortest(f: f64) -> (String, i32) {
    let sci = format!("{:e}", f.abs());
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    (digits.to_string(), exp.parse::<i32>().unwrap_or(0) + 1)
}

/// JavaScript の `String(数)`。
pub fn js_num_text(f: f64) -> String {
    if f.is_nan() {
        return "NaN".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if f == 0.0 {
        return "0".into();
    }
    let sign = if f < 0.0 { "-" } else { "" };
    let (digits, n) = shortest(f);
    let k = digits.len() as i32;
    let out = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let frac = if k > 1 { format!(".{}", &digits[1..]) } else { String::new() };
        format!("{}{frac}e{}{}", &digits[..1], if e >= 0 { "+" } else { "-" }, e.abs())
    };
    format!("{sign}{out}")
}

fn int_text(i: i64) -> String {
    if i.unsigned_abs() >= 1 << 53 {
        js_num_text(i as f64)
    } else {
        i.to_string()
    }
}

pub fn text_of(v: &V) -> U16 {
    match v {
        V::Null => Vec::new(),
        V::Int(i) => u(&int_text(*i)),
        V::Num(f) => u(&js_num_text(*f)),
        V::Str(s) => s.clone(),
    }
}

static LOOSE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^[-+]?(?:(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]*)?|\.[0-9]+)$").expect("数の型"));

/// looseNum（字の全体が数のときだけ・3 桁区切りは正しい位置だけ）。
pub fn loose_num(v: &V) -> Option<f64> {
    let f = match v {
        V::Int(i) => *i as f64,
        V::Num(f) => *f,
        _ => {
            let t = lossy(&js_trim(&text_of(v)));
            if t.is_empty() || !LOOSE.is_match(&t) {
                return None;
            }
            t.replace(',', "").parse::<f64>().ok()?
        }
    };
    f.is_finite().then_some(f)
}

/// strictNum（整数の部分が 0 で始まらない＝'010' はコード）。
pub fn strict_num(v: &V) -> Option<f64> {
    if matches!(v, V::Int(_) | V::Num(_)) {
        return loose_num(v);
    }
    let n = loose_num(v)?;
    let t = js_trim(&text_of(v));
    let body = if matches!(t.first(), Some(&0x2b) | Some(&0x2d)) { &t[1..] } else { &t[..] };
    let whole: Vec<u16> = body.iter().take_while(|c| **c != 0x2e).cloned().collect();
    if whole.len() > 1 && whole[0] == 0x30 {
        None
    } else {
        Some(n)
    }
}

/// 計算の結果を 15 桁へ丸める（`Number(n.toPrecision(15))`。同じ近さなら 0 から遠い側）。
pub fn tidy(n: f64) -> Option<f64> {
    if !n.is_finite() {
        return None;
    }
    if n == 0.0 {
        return Some(0.0);
    }
    let a = n.abs();
    let near = format!("{a:.30e}");
    let (mant, exp) = near.split_once('e')?;
    let mut digits: Vec<u8> = mant.bytes().filter(|b| *b != b'.').collect();
    let mut exp: i32 = exp.parse().ok()?;
    let tail = &digits[15..];
    // 31 桁で丸めた形が「ちょうど半分」に見えるときだけ、正確な 10 進の桁で決める
    let up = if tail.starts_with(b"5") && tail[1..].iter().all(|d| *d == b'0') {
        let exact = format!("{a:.1100e}");
        let ex: Vec<u8> = exact.split_once('e')?.0.bytes().filter(|b| *b != b'.').collect();
        ex[15] >= b'5'
    } else {
        digits[15] >= b'5'
    };
    digits.truncate(15);
    if up {
        let mut i = 15;
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                digits.truncate(15);
                exp += 1;
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    let s = format!("{}{}.{}e{exp}", if n < 0.0 { "-" } else { "" }, digits[0] as char, std::str::from_utf8(&digits[1..]).ok()?);
    s.parse().ok()
}

fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let r = x.floor();
    if x - r >= 0.5 {
        r + 1.0
    } else {
        r
    }
}

/// 四捨五入は 0 から遠い側（Excel の ROUND）。桁は 10 進の字でずらす。
pub fn round_half_away(n: f64, d: i32) -> Option<f64> {
    let shift = |x: f64, k: i32| -> f64 {
        let t = js_num_text(x);
        let (m, e) = t.split_once('e').unwrap_or((&t, "0"));
        let e: i32 = e.trim_start_matches('+').parse().unwrap_or(0);
        py_float(&format!("{m}e{}", e + k)).unwrap_or(f64::NAN)
    };
    let sign = if n > 0.0 {
        1.0
    } else if n < 0.0 {
        -1.0
    } else {
        0.0
    };
    tidy(sign * shift(js_round(shift(n.abs(), d)), -d))
}

pub fn truthy(v: &V) -> bool {
    match loose_num(v) {
        None => !text_of(v).is_empty(),
        Some(n) => n != 0.0,
    }
}

fn ordered(a: &V, b: &V) -> bool {
    !js_trim(&text_of(a)).is_empty() && !js_trim(&text_of(b)).is_empty()
}

fn js_cmp(a: &V, b: &V) -> i32 {
    match (loose_num(a), loose_num(b)) {
        (Some(x), Some(y)) => {
            if x < y {
                -1
            } else if x > y {
                1
            } else {
                0
            }
        }
        _ => order(&text_of(a), &text_of(b)),
    }
}

// ---------------------------------------------------------------- 正規表現（JavaScript → fancy-regex）

const WORD: &str = "A-Za-z0-9_";
const LINE: &str = r"\n\r\x{2028}\x{2029}";

fn ws_class_body() -> String {
    JS_WS.iter().map(|c| format!(r"\x{{{c:X}}}")).collect()
}

/// JavaScript の正規表現の字 → fancy-regex の字（意味は Python の読み替え〈re.ASCII〉と同じ）。
pub fn translate(src: &str) -> String {
    let cs: Vec<char> = src.chars().collect();
    let n = cs.len();
    let ws = ws_class_body();
    let mut out = String::new();
    let (mut i, mut in_class) = (0, false);
    let hex = |s: &[char]| s.iter().all(|c| c.is_ascii_hexdigit());
    while i < n {
        let ch = cs[i];
        if ch == '\\' && i + 1 < n {
            let nx = cs[i + 1];
            match nx {
                's' => out.push_str(&if in_class { ws.clone() } else { format!("[{ws}]") }),
                'S' if in_class => out.push_str(r"[^ \t\n\r\x0C\x0B]"),
                'S' => out.push_str(&format!("[^{ws}]")),
                'k' if cs.get(i + 2) == Some(&'<') && cs[i + 3..].contains(&'>') => {
                    let j = i + 3 + cs[i + 3..].iter().position(|c| *c == '>').unwrap_or(0);
                    out.push_str(&format!(r"\k<{}>", cs[i + 3..j].iter().collect::<String>()));
                    i = j + 1;
                    continue;
                }
                'c' if cs.get(i + 2).is_some_and(|c| c.is_ascii_alphabetic()) => {
                    out.push_str(&format!(r"\x{{{:X}}}", (cs[i + 2] as u32) % 32));
                    i += 3;
                    continue;
                }
                'x' if i + 4 <= n && hex(&cs[i + 2..i + 4]) => {
                    out.push_str(&format!(r"\x{{{}}}", cs[i + 2..i + 4].iter().collect::<String>()));
                    i += 4;
                    continue;
                }
                'u' if i + 6 <= n && hex(&cs[i + 2..i + 6]) => {
                    out.push_str(&format!(r"\x{{{}}}", cs[i + 2..i + 6].iter().collect::<String>()));
                    i += 6;
                    continue;
                }
                '0' if !cs.get(i + 2).is_some_and(|c| c.is_numeric()) => out.push_str(r"\x{0}"),
                'd' => out.push_str(if in_class { "0-9" } else { "[0-9]" }),
                'D' => out.push_str("[^0-9]"),
                'w' => out.push_str(&if in_class { WORD.to_string() } else { format!("[{WORD}]") }),
                'W' => out.push_str(&format!("[^{WORD}]")),
                'b' if in_class => out.push_str(r"\x{8}"),
                'b' => out.push_str(&format!("(?:(?<=[{WORD}])(?![{WORD}])|(?<![{WORD}])(?=[{WORD}]))")),
                'B' => out.push_str(&format!("(?:(?<=[{WORD}])(?=[{WORD}])|(?<![{WORD}])(?![{WORD}]))")),
                'f' => out.push_str(r"\x{C}"),
                'v' => out.push_str(r"\x{B}"),
                'n' | 'r' | 't' => out.extend(['\\', nx]),
                c if c.is_numeric() => out.extend(['\\', c]),
                c if c.is_ascii_alphabetic() => out.push(c), // JavaScript では知らない英字の \ は、その字そのもの
                '<' | '>' => out.push(nx),                   // fancy-regex の \< \> は語の境目。JavaScript は字そのもの
                c if c.is_ascii() => out.extend(['\\', c]),
                c => out.push(c),
            }
            i += 2;
            continue;
        }
        if in_class {
            match ch {
                ']' => {
                    in_class = false;
                    out.push(']');
                }
                // Rust の類の中で特別な字（入れ子の類・交わり・差）を字として書く
                '[' | '&' | '~' => out.extend(['\\', ch]),
                '-' if cs.get(i + 1) == Some(&'-') => out.push_str(r"\-"),
                c => out.push(c),
            }
            i += 1;
            continue;
        }
        match ch {
            '[' => {
                let rest: String = cs[i..].iter().take(3).collect();
                if rest == "[^]" {
                    out.push_str(r"[\s\S]");
                    i += 3;
                    continue;
                }
                if rest.starts_with("[]") {
                    out.push_str("(?!)");
                    i += 2;
                    continue;
                }
                in_class = true;
                out.push('[');
                if cs.get(i + 1) == Some(&'^') {
                    out.push('^');
                    i += 1;
                }
                if cs.get(i + 1) == Some(&']') {
                    out.push_str(r"\]");
                    i += 1;
                }
            }
            '(' if cs[i..].starts_with(&['(', '?', '<']) && !matches!(cs.get(i + 3), Some('=') | Some('!')) => {
                out.push_str("(?P<");
                i += 3;
                continue;
            }
            '.' => out.push_str(&format!("[^{LINE}]")),
            '$' => out.push_str(r"\z"),
            c => out.push(c),
        }
        i += 1;
    }
    out
}

static RE_CACHE: LazyLock<Mutex<HashMap<String, fancy_regex::Regex>>> = LazyLock::new(Mutex::default);

/// JavaScript の正規表現を読む（長さ・入れ子の繰り返しは断る）。読めなければ理由の字。
pub fn js_regex(src: &str) -> Result<fancy_regex::Regex, FormulaError> {
    if let Some(r) = RE_CACHE.lock().unwrap_or_else(|e| e.into_inner()).get(src) {
        return Ok(r.clone());
    }
    if src.chars().count() > RE_MAX {
        return err(&format!("正規表現は{RE_MAX}文字までです"));
    }
    let why = safe_regex::risk(src);
    if !why.is_empty() {
        return err(why);
    }
    let rx = fancy_regex::Regex::new(&translate(src)).map_err(|e| FormulaError(u(&e.to_string())))?;
    let mut c = RE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if c.len() > 200 {
        c.clear();
    }
    c.insert(src.to_string(), rx.clone());
    Ok(rx)
}

/// 照合の並び（Python の `re.finditer`・`re.sub` と同じ続け方: 空の照合の直後は同じ位置で空にならない）。
fn matches<'t>(rx: &fancy_regex::Regex, text: &'t str) -> Vec<fancy_regex::Captures<'t, str>> {
    let (mut out, mut pos, mut must_advance) = (Vec::new(), 0usize, false);
    while pos <= text.len() {
        let Ok(Some(c)) = rx.captures_from_pos(text, pos) else { break };
        let m = c.get(0).expect("照合の全体");
        if must_advance && m.start() == pos && m.end() == pos {
            match text[pos..].chars().next() {
                Some(ch) => {
                    pos += ch.len_utf8();
                    must_advance = false;
                    continue;
                }
                None => break,
            }
        }
        must_advance = m.start() == m.end();
        pos = m.end();
        out.push(c);
    }
    out
}

fn group_names(rx: &fancy_regex::Regex) -> Vec<String> {
    rx.capture_names().flatten().map(String::from).collect()
}

/// JavaScript の置き換えの字（$1・$&・$$・$`・$'・$<名前>）。
fn js_replacement(rep: &[char], c: &fancy_regex::Captures<'_, str>, s: &str, groups: usize, names: &[String]) -> String {
    let m = c.get(0).expect("照合の全体");
    let g = |i: usize| c.get(i).map_or("", |x| x.as_str()).to_string();
    let (mut out, mut i) = (String::new(), 0);
    while i < rep.len() {
        let ch = rep[i];
        if ch != '$' || i + 1 >= rep.len() {
            out.push(ch);
            i += 1;
            continue;
        }
        let nx = rep[i + 1];
        match nx {
            '$' => {
                out.push('$');
                i += 2;
            }
            '&' => {
                out.push_str(m.as_str());
                i += 2;
            }
            '`' => {
                out.push_str(&s[..m.start()]);
                i += 2;
            }
            '\'' => {
                out.push_str(&s[m.end()..]);
                i += 2;
            }
            d if d.is_ascii_digit() => {
                let two: String = rep[i + 1..(i + 3).min(rep.len())].iter().collect();
                let two_n = two.parse::<usize>().ok().filter(|_| two.len() == 2 && two.chars().all(|c| c.is_ascii_digit()));
                match two_n {
                    Some(k) if (1..=groups).contains(&k) => {
                        out.push_str(&g(k));
                        i += 3;
                    }
                    _ => {
                        let k = d.to_digit(10).unwrap_or(0) as usize;
                        if (1..=groups).contains(&k) {
                            out.push_str(&g(k));
                        } else {
                            out.push('$');
                            out.push(d);
                        }
                        i += 2;
                    }
                }
            }
            '<' if !names.is_empty() && rep[i + 2..].contains(&'>') => {
                let j = i + 2 + rep[i + 2..].iter().position(|c| *c == '>').unwrap_or(0);
                let name: String = rep[i + 2..j].iter().collect();
                if names.contains(&name) {
                    out.push_str(c.name(&name).map_or("", |x| x.as_str()));
                }
                i = j + 1;
            }
            _ => {
                out.push('$');
                i += 1;
            }
        }
    }
    out
}

// ---------------------------------------------------------------- 字句解析・構文解析（list-formula.js と同じ）

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Col(String),
    Str(String),
    Num(f64),
    Op(String),
    LParen,
    RParen,
    Comma,
    Name(String),
}

fn lex(src: &str) -> Result<Vec<Tok>, FormulaError> {
    let cs: Vec<char> = src.chars().collect();
    let (mut out, mut i) = (Vec::new(), 0);
    let ws = |c: char| (c as u32) < 0x10000 && JS_WS.contains(&(c as u16));
    while i < cs.len() {
        let ch = cs[i];
        if ws(ch) {
            i += 1;
            continue;
        }
        if ch == '[' {
            let Some(k) = cs[i + 1..].iter().position(|c| *c == ']') else { return err("列名の [ ] が閉じていません") };
            out.push(Tok::Col(cs[i + 1..i + 1 + k].iter().collect()));
            i += k + 2;
            continue;
        }
        if ch == '\'' || ch == '"' {
            let Some(k) = cs[i + 1..].iter().position(|c| *c == ch) else { return err("文字列の引用符が閉じていません") };
            out.push(Tok::Str(cs[i + 1..i + 1 + k].iter().collect()));
            i += k + 2;
            continue;
        }
        // [0-9]+(?:\.[0-9]+)?|\.[0-9]+
        let digits = |mut j: usize| {
            while j < cs.len() && cs[j].is_ascii_digit() {
                j += 1;
            }
            j
        };
        let num_end = if ch.is_ascii_digit() {
            let j = digits(i);
            if cs.get(j) == Some(&'.') && cs.get(j + 1).is_some_and(|c| c.is_ascii_digit()) {
                Some(digits(j + 1))
            } else {
                Some(j)
            }
        } else if ch == '.' && cs.get(i + 1).is_some_and(|c| c.is_ascii_digit()) {
            Some(digits(i + 1))
        } else {
            None
        };
        if let Some(j) = num_end {
            out.push(Tok::Num(cs[i..j].iter().collect::<String>().parse().unwrap_or(f64::NAN)));
            i = j;
            continue;
        }
        let two: String = cs[i..(i + 2).min(cs.len())].iter().collect();
        if ["<=", ">=", "<>", "!="].contains(&two.as_str()) {
            out.push(Tok::Op(if two == "!=" { "<>".into() } else { two }));
            i += 2;
            continue;
        }
        match ch {
            '(' => out.push(Tok::LParen),
            ')' => out.push(Tok::RParen),
            ',' => out.push(Tok::Comma),
            '+' | '-' | '*' | '/' | '%' | '=' | '<' | '>' => out.push(Tok::Op(ch.to_string())),
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut j = i;
                while j < cs.len() && (cs[j].is_ascii_alphanumeric() || cs[j] == '_') {
                    j += 1;
                }
                out.push(Tok::Name(cs[i..j].iter().collect::<String>().to_ascii_lowercase()));
                i = j;
                continue;
            }
            c => {
                // JavaScript は UTF-16 の単位 1 つを言う（U+10000 以上の字はサロゲートの前半）
                let unit = c.encode_utf16(&mut [0; 2])[0];
                let mut msg = u("使えない文字です: ");
                msg.push(unit);
                return Err(FormulaError(msg));
            }
        }
        i += 1;
    }
    Ok(out)
}

/// 式の木。
#[derive(Debug, Clone)]
pub enum Node {
    Num(f64),
    Str(U16),
    Col(String),
    Neg(Box<Node>),
    Not(Box<Node>),
    And(Box<Node>, Box<Node>),
    Or(Box<Node>, Box<Node>),
    Cmp(String, Box<Node>, Box<Node>),
    Bin(String, Box<Node>, Box<Node>),
    Call(String, Vec<Node>),
}

/// 引数の数が決まっている関数。
fn arity(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "cmp" | "round" | "left" | "right" | "find" | "match" | "contains" | "startswith" | "endswith" | "count" | "regcount" | "rept" => {
            (2, 2)
        }
        "num" | "text" | "abs" | "len" | "trim" | "upper" | "lower" | "hankaku" | "lenb" | "int" | "ceil" | "sqrt" | "isnum"
        | "isblank" | "year" | "month" | "day" | "hour" | "minute" | "weekday" | "date" => (1, 1),
        "replace" | "regreplace" | "split" => (3, 3),
        "mid" | "extract" | "padleft" | "datediff" => (2, 3),
        "roundup" | "rounddown" | "kamadate" => (1, 2),
        "ifs" => (2, 40),
        "switch" => (3, 41),
        "min" | "max" | "sum" | "avg" => (1, 30),
        _ => return None,
    })
}

/// 関数の顔ぶれ（画面の `WL.formula.sigs` と同じ。`if` は別に読む）。
pub const FUNCS: [&str; 52] = [
    "num",
    "text",
    "abs",
    "round",
    "len",
    "left",
    "right",
    "trim",
    "upper",
    "lower",
    "concat",
    "coalesce",
    "mid",
    "find",
    "replace",
    "extract",
    "match",
    "regreplace",
    "split",
    "contains",
    "cmp",
    "startswith",
    "endswith",
    "hankaku",
    "padleft",
    "count",
    "regcount",
    "lenb",
    "rept",
    "min",
    "max",
    "sum",
    "avg",
    "int",
    "ceil",
    "roundup",
    "rounddown",
    "sqrt",
    "isnum",
    "isblank",
    "ifs",
    "switch",
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "weekday",
    "date",
    "datediff",
    "kamadate",
    "_",
];

const REGEX_FUNCS: [&str; 4] = ["extract", "match", "regreplace", "regcount"];

fn known(name: &str) -> bool {
    name != "_" && FUNCS.contains(&name)
}

fn check_call(name: &str, args: &[Node]) -> Result<(), FormulaError> {
    if name != "if" && !known(name) {
        return err(&format!("知らない関数です: {name}"));
    }
    if name == "if" && args.len() < 2 {
        return err("if は if(条件, 真のとき, 偽のとき) です");
    }
    if let Some((lo, hi)) = arity(name) {
        if lo == hi && args.len() != lo {
            return err(&format!("{name} は引数が{lo}個です（{}個でした）", args.len()));
        }
        if !(lo..=hi).contains(&args.len()) {
            return err(&format!("{name} は引数が{lo}〜{hi}個です（{}個でした）", args.len()));
        }
    }
    if REGEX_FUNCS.contains(&name) {
        if let Node::Str(s) = &args[1] {
            if let Err(e) = js_regex(&lossy(s)) {
                let mut msg = u(&format!("{name} の正規表現として読めません: "));
                msg.extend(e.0);
                return Err(FormulaError(msg));
            }
        }
    }
    Ok(())
}

struct Parser {
    ts: Vec<Tok>,
    p: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.ts.get(self.p)
    }

    fn eat(&mut self, t: &Tok) -> bool {
        if self.peek() == Some(t) {
            self.p += 1;
            true
        } else {
            false
        }
    }

    /// 二項の演算子の段（弱い順）: or → and → 比べる → + - → * / %。左から結ぶ
    fn level_hit(level: usize, t: &Tok) -> bool {
        match (level, t) {
            (0, Tok::Name(n)) => n == "or",
            (1, Tok::Name(n)) => n == "and",
            (2, Tok::Op(o)) => ["=", "<>", "<", "<=", ">", ">="].contains(&o.as_str()),
            (3, Tok::Op(o)) => o == "+" || o == "-",
            (4, Tok::Op(o)) => o == "*" || o == "/" || o == "%",
            _ => false,
        }
    }

    fn binary(&mut self, level: usize) -> Result<Node, FormulaError> {
        if level >= 5 {
            return self.unary();
        }
        let mut n = self.binary(level + 1)?;
        while let Some(t) = self.peek().cloned().filter(|t| Self::level_hit(level, t)) {
            self.p += 1;
            let b = Box::new(self.binary(level + 1)?);
            let a = Box::new(n);
            n = match (level, t) {
                (0, _) => Node::Or(a, b),
                (1, _) => Node::And(a, b),
                (2, Tok::Op(o)) => Node::Cmp(o, a, b),
                (_, Tok::Op(o)) => Node::Bin(o, a, b),
                _ => unreachable!("段の印"),
            };
        }
        Ok(n)
    }

    fn unary(&mut self) -> Result<Node, FormulaError> {
        match self.peek() {
            Some(Tok::Op(o)) if o == "-" => {
                self.p += 1;
                Ok(Node::Neg(Box::new(self.unary()?)))
            }
            Some(Tok::Name(n)) if n == "not" => {
                self.p += 1;
                Ok(Node::Not(Box::new(self.unary()?)))
            }
            _ => self.atom(),
        }
    }

    fn call(&mut self, name: String) -> Result<Node, FormulaError> {
        if !self.eat(&Tok::LParen) {
            return err(&format!("関数の ( が必要です: {name}"));
        }
        let mut args = Vec::new();
        if !self.eat(&Tok::RParen) {
            args.push(self.binary(0)?);
            while self.eat(&Tok::Comma) {
                args.push(self.binary(0)?);
            }
            if !self.eat(&Tok::RParen) {
                return err(") が必要です");
            }
        }
        check_call(&name, &args)?;
        Ok(Node::Call(name, args))
    }

    fn atom(&mut self) -> Result<Node, FormulaError> {
        let Some(t) = self.peek().cloned() else { return err("式が途中で終わっています") };
        self.p += 1;
        match t {
            Tok::Num(f) => Ok(Node::Num(f)),
            Tok::Str(s) => Ok(Node::Str(u(&s))),
            Tok::Col(c) => Ok(Node::Col(c)),
            Tok::LParen => {
                let n = self.binary(0)?;
                if !self.eat(&Tok::RParen) {
                    return err(") が必要です");
                }
                Ok(n)
            }
            Tok::Name(n) => self.call(n),
            _ => {
                self.p -= 1;
                err("式として読めません")
            }
        }
    }
}

pub fn parse(src: &str) -> Result<Node, FormulaError> {
    if src.chars().count() > MAX_LEN {
        return err(&format!("式が長すぎます({MAX_LEN}文字まで)"));
    }
    let mut ps = Parser { ts: lex(src)?, p: 0 };
    let node = ps.binary(0)?;
    if ps.p < ps.ts.len() {
        return err("式の後ろに余分なものがあります");
    }
    Ok(node)
}

// ---------------------------------------------------------------- 関数（list-formula.js の FUNCS と同じ）

/// 計算の途中の失敗（Python で例外になる所。その行だけ空にする）。
struct Fail;

fn num(v: &V) -> Option<f64> {
    loose_num(v)
}

fn num0(v: &V) -> f64 {
    num(v).filter(|n| *n != 0.0).unwrap_or(0.0)
}

fn n_or(v: Option<f64>) -> V {
    v.map_or(V::Null, V::Num)
}

fn pos(v: &V) -> i64 {
    num(v).map_or(1, |n| (n.floor() as i64).max(1))
}

fn digits_arg(v: &V) -> i32 {
    num0(v).clamp(0.0, 8.0) as i32
}

fn days(y: i64, m: i64, d: i64) -> i64 {
    let y = y - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

/// (年, 月, 日, 時, 分, 秒, 日付がある)
type When = (i64, i64, i64, i64, i64, i64, bool);

static D_YMD: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r"^([0-9]{4})[-/.年]([0-9]{1,2})[-/.月]([0-9]{1,2})日?(?:[T \x{3000}]+([0-9]{1,2})[:時]([0-9]{1,2})(?:[:分]([0-9]{1,2})(?:\.[0-9]+)?秒?)?)?$",
    )
    .expect("年月日の型")
});
static D_YY: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^([0-9]{2})/([0-9]{1,2})/([0-9]{1,2})(?:[T \x{3000}]+([0-9]{1,2}):([0-9]{1,2})(?::([0-9]{1,2}))?)?$")
        .expect("2桁の年の型")
});
static D_8: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^([0-9]{4})([0-9]{2})([0-9]{2})$").expect("8桁の型"));
static D_T: LazyLock<regex::Regex> = LazyLock::new(|| regex::Regex::new(r"^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?$").expect("時刻の型"));

fn when(v: &V) -> Option<When> {
    let t = lossy(&js_trim(&text_of(v)));
    let g = |c: &regex::Captures, i: usize| c.get(i).map_or(0, |m| m.as_str().parse::<i64>().unwrap_or(0));
    let (y, mo, d, h, mi, s, has) = if let Some(c) = D_YMD.captures(&t).or_else(|| D_8.captures(&t)) {
        (g(&c, 1), g(&c, 2), g(&c, 3), g(&c, 4), g(&c, 5), g(&c, 6), true)
    } else if let Some(c) = D_YY.captures(&t) {
        (g(&c, 1) + 2000, g(&c, 2), g(&c, 3), g(&c, 4), g(&c, 5), g(&c, 6), true)
    } else {
        let c = D_T.captures(&t)?;
        (1970, 1, 1, g(&c, 1), g(&c, 2), g(&c, 3), false)
    };
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let dim = match mo {
        2 if leap => 29,
        1..=12 => [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(mo - 1) as usize],
        _ => 0,
    };
    (1 <= d && d <= dim && h <= 23 && mi <= 59 && s <= 59).then_some((y, mo, d, h, mi, s, has))
}

fn sec(w: &When) -> i64 {
    days(w.0, w.1, w.2) * 86400 + w.3 * 3600 + w.4 * 60 + w.5
}

fn kama_day(y: i64, m: i64, week: i64, wd: i64) -> Option<i64> {
    let first = days(y, m, 1);
    let last = if m == 12 { days(y + 1, 1, 1) } else { days(y, m + 1, 1) } - first;
    let sw = (first.rem_euclid(7) + 4) % 7;
    let mut n = 0;
    for d in 1..=last {
        let dw = (sw + d - 1) % 7 + 1;
        if n == 0 || dw == 1 {
            n = if n == 5 { 1 } else { n + 1 };
        }
        if n == week && dw == wd {
            return Some(d);
        }
    }
    None
}

/// 今日（基準日を省いた kamadate）。**UTC の日付**——Python は端末の地方時の日付（`date.today()`）。地方時を読む部品を
/// 足すまでは違いうる（§9.636）。
fn today() -> (i64, i64, i64) {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let d = crate::pyish::Date::from_ordinal(secs.div_euclid(86400) + 719_163).unwrap_or(crate::pyish::Date { y: 1970, m: 1, d: 1 });
    (d.y, d.m, d.d)
}

fn kamadate(a: &[V]) -> V {
    let k = lossy(&js_trim(&text_of(&a[0])));
    let kb = k.as_bytes();
    if kb.len() != 3 || !kb.iter().all(u8::is_ascii_digit) {
        return V::Null;
    }
    let (week, wd) = ((kb[0] - b'0') as i64, (kb[1] - b'0') as i64);
    if !(1..=5).contains(&week) || !(1..=7).contains(&wd) {
        return V::Null;
    }
    let (y, m, d0) = if a.len() > 1 {
        match when(&a[1]) {
            Some(w) if w.6 => (w.0, w.1, w.2),
            _ => return V::Null,
        }
    } else {
        today()
    };
    let base = days(y, m, d0);
    let mut best: Option<(i64, i64, i64, i64)> = None;
    for dm in [-1, 0, 1] {
        let (yy, mm) = match m + dm {
            0 => (y - 1, 12),
            13 => (y + 1, 1),
            x => (y, x),
        };
        if let Some(d) = kama_day(yy, mm, week, wd) {
            let gap = (days(yy, mm, d) - base).abs();
            if best.is_none_or(|b| gap < b.0) {
                best = Some((gap, yy, mm, d));
            }
        }
    }
    best.map_or(V::Null, |b| V::Str(u(&format!("{:04}-{:02}-{:02}", b.1, b.2, b.3))))
}

fn nums(a: &[V]) -> Vec<f64> {
    a.iter().filter_map(num).collect()
}

fn fsum(xs: &[f64]) -> f64 {
    xs.iter().fold(0.0, |t, x| t + x)
}

/// Python の `'%.15g' % x` を数へ戻した物。
fn g15(x: f64) -> f64 {
    format!("{x:.14e}").parse().unwrap_or(x)
}

fn round_dir(a: &[V], up: bool) -> V {
    let Some(n) = num(&a[0]) else { return V::Null };
    let p = 10f64.powi(if a.len() > 1 { digits_arg(&a[1]) } else { 0 });
    let t = g15(n.abs() * p);
    n_or(tidy(if n < 0.0 { -1.0 } else { 1.0 } * if up { t.ceil() } else { t.floor() } / p))
}

fn cmp_op(op: &str, a: &V, b: &V) -> V {
    if op != "=" && op != "<>" && !ordered(a, b) {
        return V::Num(0.0);
    }
    let c = match (strict_num(a), strict_num(b)) {
        (Some(x), Some(y)) => {
            if x < y {
                -1
            } else if x > y {
                1
            } else {
                0
            }
        }
        _ => order(&text_of(a), &text_of(b)),
    };
    let ok = match op {
        "=" => c == 0,
        "<>" => c != 0,
        "<" => c < 0,
        "<=" => c <= 0,
        ">" => c > 0,
        _ => c >= 0,
    };
    V::Num(if ok { 1.0 } else { 0.0 })
}

fn flag(b: bool) -> V {
    V::Num(if b { 1.0 } else { 0.0 })
}

fn s(v: Vec<u16>) -> V {
    V::Str(v)
}

fn call(name: &str, a: &[V]) -> Result<V, Fail> {
    let t = |i: usize| text_of(&a[i]);
    Ok(match name {
        "num" => n_or(num(&a[0])),
        "text" => s(t(0)),
        "abs" => n_or(num(&a[0]).map(f64::abs)),
        "round" => match num(&a[0]) {
            None => V::Null,
            Some(n) => n_or(round_half_away(n, num0(&a[1]).trunc().clamp(0.0, 8.0) as i32)),
        },
        "len" => V::Num(t(0).len() as f64),
        "left" => s(u16slice(&t(0), Some(0.0), Some(num0(&a[1]).max(0.0)))),
        "right" => {
            let n = num0(&a[1]).max(0.0);
            s(if n != 0.0 { u16slice(&t(0), Some(-n), None) } else { Vec::new() })
        }
        "trim" => s(js_trim(&t(0))),
        "upper" => s(u(&lossy(&t(0)).to_uppercase())),
        "lower" => s(u(&lossy(&t(0)).to_lowercase())),
        "concat" => s(a.iter().flat_map(text_of).collect()),
        "coalesce" => a.iter().find(|v| !matches!(v, V::Null) && **v != V::Str(Vec::new())).cloned().unwrap_or(V::Str(Vec::new())),
        "mid" => {
            let (txt, st) = (t(0), pos(&a[1]) - 1);
            let n = if a.len() > 2 { num0(&a[2]).max(0.0) } else { txt.len() as f64 };
            s(u16slice(&txt, Some(st as f64), Some(st as f64 + n)))
        }
        "find" => V::Num(find(&t(0), &t(1)).map_or(0.0, |i| i as f64 + 1.0)),
        "replace" => {
            let (txt, sub, rep) = (t(0), t(1), t(2));
            s(if sub.is_empty() { txt.iter().map(|c| vec![*c]).collect::<Vec<_>>().join(&rep[..]) } else { replace_all(&txt, &sub, &rep) })
        }
        "extract" => {
            let rx = js_regex(&lossy(&t(1))).map_err(|_| Fail)?;
            let text = lossy(&t(0));
            let Ok(Some(c)) = rx.captures(&text) else { return Ok(V::Str(Vec::new())) };
            let g = if a.len() > 2 { num0(&a[2]).max(0.0) } else { 0.0 };
            if g != g.trunc() || g as usize >= c.len() {
                return Ok(V::Str(Vec::new()));
            }
            s(c.get(g as usize).map_or(Vec::new(), |m| u(m.as_str())))
        }
        "match" => {
            let rx = js_regex(&lossy(&t(1))).map_err(|_| Fail)?;
            flag(rx.is_match(&lossy(&t(0))).map_err(|_| Fail)?)
        }
        "regreplace" => {
            let rx = js_regex(&lossy(&t(1))).map_err(|_| Fail)?;
            let text = lossy(&t(0));
            let rep: Vec<char> = lossy(&t(2)).chars().collect();
            let (groups, names) = (rx.captures_len() - 1, group_names(&rx));
            let (mut out, mut last) = (String::new(), 0);
            for c in matches(&rx, &text) {
                let m = c.get(0).expect("照合の全体");
                out.push_str(&text[last..m.start()]);
                out.push_str(&js_replacement(&rep, &c, &text, groups, &names));
                last = m.end();
            }
            out.push_str(&text[last..]);
            s(u(&out))
        }
        "split" => {
            let (sep, txt) = (t(1), t(0));
            let parts = if sep.is_empty() { vec![txt] } else { split(&txt, &sep) };
            let i = (pos(&a[2]) - 1) as usize;
            s(parts.get(i).cloned().unwrap_or_default())
        }
        "contains" => flag(find(&t(0), &t(1)).is_some()),
        "cmp" => V::Num(js_cmp(&a[0], &a[1]) as f64),
        "startswith" => flag(t(0).starts_with(&t(1))),
        "endswith" => flag(t(0).ends_with(&t(1))),
        "hankaku" => s(u(&lossy(&t(0)).nfkc().collect::<String>())),
        "padleft" => {
            let txt = t(0);
            let width = num0(&a[1]).clamp(0.0, 64.0) as i64;
            let fill = if a.len() > 2 { Some(t(2)).filter(|f| !f.is_empty()).unwrap_or_else(|| u("0")) } else { u("0") };
            let need = width - txt.len() as i64;
            if need <= 0 {
                return Ok(s(txt));
            }
            let times = (need as usize) / fill.len().max(1) + 1;
            let rep: Vec<u16> = fill.repeat(times);
            let mut out = u16slice(&rep, Some(0.0), Some(need as f64));
            out.extend(txt);
            s(out)
        }
        "count" => {
            let sub = t(1);
            V::Num(if sub.is_empty() { 0.0 } else { count(&t(0), &sub) as f64 })
        }
        "regcount" => {
            let rx = js_regex(&lossy(&t(1))).map_err(|_| Fail)?;
            V::Num(matches(&rx, &lossy(&t(0))).len() as f64)
        }
        "lenb" => V::Num(t(0).iter().map(|c| if *c <= 0x7f || (0xff61..=0xff9f).contains(c) { 1.0 } else { 2.0 }).sum()),
        "rept" => {
            let txt = t(0);
            let mut n = num0(&a[1]).clamp(0.0, 1000.0) as usize;
            if !txt.is_empty() && txt.len() * n > REPT_MAX {
                n = REPT_MAX / txt.len();
            }
            s(txt.repeat(n))
        }
        "min" | "max" => {
            let xs = nums(a);
            let first = xs.first().copied();
            n_or(
                first
                    .map(|f| xs.iter().skip(1).fold(f, |m, x| if (name == "min" && *x < m) || (name == "max" && *x > m) { *x } else { m })),
            )
        }
        "sum" => {
            let xs = nums(a);
            if xs.is_empty() {
                V::Null
            } else {
                n_or(tidy(fsum(&xs)))
            }
        }
        "avg" => {
            let xs = nums(a);
            if xs.is_empty() {
                V::Null
            } else {
                n_or(tidy(fsum(&xs) / xs.len() as f64))
            }
        }
        "int" => n_or(num(&a[0]).map(f64::floor)),
        "ceil" => n_or(num(&a[0]).map(f64::ceil)),
        "roundup" => round_dir(a, true),
        "rounddown" => round_dir(a, false),
        "sqrt" => match num(&a[0]) {
            Some(n) if n >= 0.0 => n_or(tidy(n.sqrt())),
            _ => V::Null,
        },
        "isnum" => flag(strict_num(&a[0]).is_some()),
        "isblank" => flag(js_trim(&t(0)).is_empty()),
        "ifs" => {
            let mut i = 0;
            while i + 1 < a.len() {
                if truthy(&a[i]) {
                    return Ok(a[i + 1].clone());
                }
                i += 2;
            }
            if !a.len().is_multiple_of(2) {
                a[a.len() - 1].clone()
            } else {
                V::Str(Vec::new())
            }
        }
        "switch" => {
            let mut i = 1;
            while i + 1 < a.len() {
                if cmp_op("=", &a[0], &a[i]) == V::Num(1.0) {
                    return Ok(a[i + 1].clone());
                }
                i += 2;
            }
            if a.len().is_multiple_of(2) {
                a[a.len() - 1].clone()
            } else {
                V::Str(Vec::new())
            }
        }
        "year" | "month" | "day" | "hour" | "minute" => {
            let w = when(&a[0]);
            let need_date = !matches!(name, "hour" | "minute");
            match w {
                Some(w) if !need_date || w.6 => V::Num(match name {
                    "year" => w.0,
                    "month" => w.1,
                    "day" => w.2,
                    "hour" => w.3,
                    _ => w.4,
                } as f64),
                _ => V::Null,
            }
        }
        "weekday" => match when(&a[0]) {
            Some(w) if w.6 => V::Num(((days(w.0, w.1, w.2).rem_euclid(7) + 4) % 7 + 1) as f64),
            _ => V::Null,
        },
        "date" => match when(&a[0]) {
            Some(w) if w.6 => s(u(&format!("{:04}-{:02}-{:02}", w.0, w.1, w.2))),
            _ => V::Null,
        },
        "datediff" => {
            let (x, y) = (when(&a[0]), when(&a[1]));
            let unit = if a.len() > 2 { lossy(&js_trim(&t(2))).to_lowercase() } else { "d".into() };
            let per = match unit.as_str() {
                "d" | "日" => 86400.0,
                "h" | "時" | "時間" => 3600.0,
                "m" | "分" => 60.0,
                "s" | "秒" => 1.0,
                _ => return Ok(V::Null),
            };
            match (x, y) {
                (Some(x), Some(y)) => n_or(tidy((sec(&y) - sec(&x)) as f64 / per)),
                _ => V::Null,
            }
        }
        "kamadate" => kamadate(a),
        _ => V::Null,
    })
}

fn eval(n: &Node, row: &dyn Fn(&str) -> V) -> Result<V, Fail> {
    Ok(match n {
        Node::Num(f) => V::Num(*f),
        Node::Str(s) => V::Str(s.clone()),
        Node::Col(c) => row(c),
        Node::Neg(a) => n_or(num(&eval(a, row)?).map(|x| -x)),
        Node::Not(a) => flag(!truthy(&eval(a, row)?)),
        Node::And(a, b) => {
            let l = truthy(&eval(a, row)?);
            let r = truthy(&eval(b, row)?);
            flag(l && r)
        }
        Node::Or(a, b) => {
            let l = truthy(&eval(a, row)?);
            let r = truthy(&eval(b, row)?);
            flag(l || r)
        }
        Node::Cmp(op, a, b) => cmp_op(op, &eval(a, row)?, &eval(b, row)?),
        Node::Bin(op, a, b) => {
            let (a, b) = (eval(a, row)?, eval(b, row)?);
            if op == "+" {
                // 両方が書いてある通りに数のときだけ足し算、そうでなければ連結
                return Ok(match (strict_num(&a), strict_num(&b)) {
                    (Some(x), Some(y)) => n_or(tidy(x + y)),
                    _ => {
                        let mut t = text_of(&a);
                        t.extend(text_of(&b));
                        V::Str(t)
                    }
                });
            }
            let (Some(x), Some(y)) = (num(&a), num(&b)) else { return Ok(V::Null) };
            match op.as_str() {
                "-" => n_or(tidy(x - y)),
                "*" => n_or(tidy(x * y)),
                _ if y == 0.0 => V::Null,
                "/" => n_or(tidy(x / y)),
                _ => n_or(tidy(x % y)),
            }
        }
        Node::Call(name, args) if name == "if" => {
            if truthy(&eval(&args[0], row)?) {
                eval(&args[1], row)?
            } else if args.len() > 2 {
                eval(&args[2], row)?
            } else {
                V::Str(Vec::new())
            }
        }
        Node::Call(name, args) => {
            let vals = args.iter().map(|a| eval(a, row)).collect::<Result<Vec<_>, _>>()?;
            call(name, &vals)?
        }
    })
}

fn columns_used(n: &Node, out: &mut Vec<String>) {
    match n {
        Node::Col(c) => {
            if !out.contains(c) {
                out.push(c.clone());
            }
        }
        Node::Neg(a) | Node::Not(a) => columns_used(a, out),
        Node::And(a, b) | Node::Or(a, b) | Node::Cmp(_, a, b) | Node::Bin(_, a, b) => {
            columns_used(a, out);
            columns_used(b, out);
        }
        Node::Call(_, args) => args.iter().for_each(|a| columns_used(a, out)),
        Node::Num(_) | Node::Str(_) => {}
    }
}

/// 読み解いた式（1 回だけ読み、行ごとに使い回す）。
#[derive(Debug, Clone)]
pub struct Formula {
    pub node: Node,
    pub columns: Vec<String>,
}

impl Formula {
    pub fn new(src: &str) -> Result<Formula, FormulaError> {
        let node = parse(src)?;
        let mut columns = Vec::new();
        columns_used(&node, &mut columns);
        Ok(Formula { node, columns })
    }

    /// 行ごとに計算する（失敗はその行だけ空）。`lookup` は 列名 → 値（無ければ Null）。
    pub fn run(&self, lookup: &dyn Fn(&str) -> V) -> V {
        eval(&self.node, lookup).unwrap_or(V::Null)
    }
}

/// 画面の「式を確かめる」（{"ok", "columns"} か {"ok": false, "error"}）。
pub fn check(src: &str) -> Value {
    if py_strip(src).is_empty() {
        return json!({"ok": false, "error": "式を入力してください"});
    }
    match Formula::new(src) {
        Ok(f) => json!({"ok": true, "columns": f.columns}),
        Err(e) => json!({"ok": false, "error": u16_json(&e.0)}),
    }
}

/// 式の答え → SQLite に返す値（整数に読める実数は整数）。
pub fn sql_value(v: &V) -> V {
    match v {
        V::Num(f) if !f.is_finite() => V::Str(u(&js_num_text(*f))),
        V::Num(f) if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 => V::Int(*f as i64),
        other => other.clone(),
    }
}

// ---------------------------------------------------------------- 計算列（一覧の表示列の設定と同じ引き方）

/// 表示列の設定の式（`formulas`: 列名 → 式。並びは設定の順）と表示名（`names`: 元の列名 → 表示名）→ 計算列を値にする。
pub struct CalcColumns {
    cols: Vec<String>,
    names_rev: HashMap<String, String>,
    /// 並びは設定の順。読めない式は None
    pub compiled: Vec<(String, Option<Formula>)>,
    pub calcs: Vec<String>,
}

impl CalcColumns {
    pub const MAX: usize = 40;

    pub fn new(formulas: &[(String, String)], names: &[(String, String)], table_columns: &[String]) -> CalcColumns {
        let names_rev = names.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (v.clone(), k.clone())).collect();
        let compiled: Vec<(String, Option<Formula>)> = formulas
            .iter()
            .take(Self::MAX)
            .filter(|(_, v)| !py_strip(v).is_empty())
            .map(|(k, v)| (k.clone(), Formula::new(v).ok()))
            .collect();
        let calcs = compiled.iter().map(|(k, _)| k.clone()).filter(|k| !table_columns.contains(k)).collect();
        CalcColumns { cols: table_columns.to_vec(), names_rev, compiled, calcs }
    }

    fn get(&self, name: &str) -> Option<&Option<Formula>> {
        self.compiled.iter().find(|(k, _)| k == name).map(|(_, f)| f)
    }

    pub fn key(&self, name: &str) -> String {
        if self.cols.iter().any(|c| c == name) {
            name.to_string()
        } else {
            self.names_rev.get(name).cloned().unwrap_or_else(|| name.to_string())
        }
    }

    pub fn broken(&self, name: &str) -> bool {
        matches!(self.get(name), Some(None))
    }

    /// 計算列 name が読む表の列（表示名・ほかの式の列を 1 段たどる）。
    pub fn raw_deps(&self, name: &str) -> Vec<String> {
        let mut out = Vec::new();
        let Some(Some(f)) = self.get(name) else { return out };
        for c in &f.columns {
            let k = self.key(c);
            let sub = if k != name { self.get(&k).and_then(|x| x.as_ref()) } else { None };
            let ds = sub.map_or_else(|| vec![k.clone()], |s| s.columns.clone());
            for d in ds {
                if self.cols.contains(&d) && !out.contains(&d) {
                    out.push(d);
                }
            }
        }
        out
    }

    /// 計算列 name の値（読む列の値を `raw_deps` の並びで受け取る）。
    pub fn run(&self, name: &str, vals: &[V]) -> V {
        let Some(Some(f)) = self.get(name) else { return V::Null };
        let deps = self.raw_deps(name);
        let raw: HashMap<&str, &V> = deps.iter().map(String::as_str).zip(vals.iter()).collect();
        let plain = |c: &str| raw.get(c).map_or(V::Null, |v| (*v).clone());
        let look = |c: &str| {
            let k = self.key(c);
            if k == name {
                return plain(&k);
            }
            match self.get(&k) {
                Some(Some(sub)) => sub.run(&plain),
                _ => plain(&k),
            }
        };
        sql_value(&f.run(&look))
    }
}

/// 画面が送る計算列 {formulas, names, own?}（JSON の字でもよい）→ 字だけ・数と長さを限った形。無ければ None。
pub fn clean_calc(v: &Value) -> Option<Value> {
    let parsed;
    let v = match v {
        Value::String(s) if py_strip(s).is_empty() => return None,
        Value::String(s) => {
            parsed = serde_json::from_str::<Value>(s).ok()?;
            &parsed
        }
        other => other,
    };
    let o = v.as_object()?;
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let strs = |d: Option<&Value>, n: usize, size: usize| -> Map<String, Value> {
        d.and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .take(n)
                    .filter(|(k, x)| !py_strip(k).is_empty() && x.is_string())
                    .map(|(k, x)| (cut(k, 200), json!(cut(x.as_str().unwrap_or(""), size))))
                    .collect()
            })
            .unwrap_or_default()
    };
    let f: Map<String, Value> =
        strs(o.get("formulas"), MAX_CALC, MAX_LEN).into_iter().filter(|(_, x)| !py_strip(x.as_str().unwrap_or("")).is_empty()).collect();
    if f.is_empty() {
        return None;
    }
    let own: Vec<String> = o
        .get("own")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(crate::pyish::py_str).filter(|x| f.contains_key(x)).map(|x| cut(&x, 200)).take(MAX_CALC).collect())
        .unwrap_or_default();
    let mut out = json!({"formulas": f, "names": strs(o.get("names"), 400, 200)});
    if !own.is_empty() {
        out["own"] = json!(own);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_like_javascript() {
        for (f, want) in [
            (1e21, "1e+21"),
            (1e-7, "1e-7"),
            (123456789012.0, "123456789012"),
            (0.1 + 0.2, "0.30000000000000004"),
            (-2.5, "-2.5"),
            (1e-6, "0.000001"),
        ] {
            assert_eq!(js_num_text(f), want, "{f}");
        }
        assert_eq!(tidy(0.1 + 0.2), Some(0.3));
        assert_eq!(tidy(1.0 / 3.0), Some(0.333333333333333));
        assert_eq!(round_half_away(2.5, 0), Some(3.0));
        assert_eq!(round_half_away(-2.5, 0), Some(-3.0));
        assert_eq!(round_half_away(1.005, 2), Some(1.01));
    }
}
