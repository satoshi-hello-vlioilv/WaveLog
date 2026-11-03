//! 字で届く日時・並べ替えの鍵の読み方（`backend/datetext.py` の写し・§9.634）。
//!
//!   to_date      … 'YYYY-MM-DD' か None（2026/9/5・2026年9月28日・20260928・26/09/28 の2桁の年も）
//!   to_datetime  … 'YYYY-MM-DD HH:MM:SS'（時刻が無ければ 'YYYY-MM-DD'）か None。14 桁・午前／午後も読む
//!   sort_key     … 並べ替えの鍵（空欄は None・数に読める字は数・ほかは前後の空白を除いた字）
//!
//! Python の `\d` は全角などの数字にも当たり、`int()` もそれを読む。ここも同じ（`pyish::digit_value`）。
//! 時・分・秒のうち、Python が字のまま書き出す所（14 桁の時分秒・短い形の分）は字のまま写す。

use crate::pyish::{py_int, py_str, py_strip};
use regex::{Captures, Regex};
use serde_json::Value;
use std::sync::LazyLock;

/// 並べ替えの鍵。
#[derive(Debug, Clone, PartialEq)]
pub enum SortKey {
    /// 空欄（NULL・空白だけ）
    Empty,
    /// 数として読めた字
    Num(f64),
    /// 数・真偽の値そのもの（字にしない）
    Same(Value),
    /// 前後の空白を除いた字
    Text(String),
}

const NUM_CHARS: &str = "0123456789.eE+-";

pub fn sort_key(v: &Value) -> SortKey {
    match v {
        Value::Null => SortKey::Empty,
        Value::Number(_) | Value::Bool(_) => SortKey::Same(v.clone()),
        _ => {
            let raw = py_str(v);
            let s = py_strip(&raw);
            if s.is_empty() {
                return SortKey::Empty;
            }
            if s.chars().all(|c| NUM_CHARS.contains(c)) && s.chars().any(|c| c.is_ascii_digit()) {
                if let Ok(f) = s.parse::<f64>() {
                    return SortKey::Num(f);
                }
            }
            SortKey::Text(s.to_string())
        }
    }
}

static DATE_PATTERNS: LazyLock<[Regex; 4]> = LazyLock::new(|| {
    [
        r"^\s*(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$",
        r"^\s*(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日.*$",
        r"^\s*(\d{4})(\d{2})(\d{2})(?:\s.*)?$",
        r"^\s*(\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T].*)?$",
    ]
    .map(|p| Regex::new(p).expect("日付の型"))
});
static TIME_TAIL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:^|[ T])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:[AaPp]\.?[Mm]\.?)?\s*$").expect("時刻の型"));
static FAST_DT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$").expect("日時の型")
});
static COMPACT_DT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$").expect("14 桁の型"));

/// 年月日が暦にあれば 'YYYY-MM-DD'。
fn iso(y: i64, mo: i64, d: i64) -> Option<String> {
    if !(1..=9999).contains(&y) || !(1..=12).contains(&mo) || d < 1 {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let last = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(mo - 1) as usize];
    (d <= last).then(|| format!("{y:04}-{mo:02}-{d:02}"))
}

fn num(c: &Captures, i: usize) -> Option<i64> {
    c.get(i).and_then(|m| py_int(m.as_str()))
}

/// 値を日付として読めれば 'YYYY-MM-DD'、読めなければ None。
pub fn to_date(v: &Value) -> Option<String> {
    if v.is_null() {
        return None;
    }
    let raw = py_str(v);
    let s = py_strip(&raw);
    if s.is_empty() {
        return None;
    }
    for rx in DATE_PATTERNS.iter() {
        if let Some(c) = rx.captures(s) {
            let (mut y, mo, d) = (num(&c, 1)?, num(&c, 2)?, num(&c, 3)?);
            if y < 100 {
                y += 2000;
            }
            return iso(y, mo, d);
        }
    }
    None
}

/// 値の終わりの時刻 → (時, 分, 秒)。読めなければ None。
pub fn to_minutes(v: &Value) -> Option<(i64, i64, i64)> {
    if v.is_null() {
        return None;
    }
    let raw = py_str(v);
    let c = TIME_TAIL.captures(py_strip(&raw))?;
    let (h, mi) = (num(&c, 1)?, num(&c, 2)?);
    let s = if c.get(3).is_some() { num(&c, 3)? } else { 0 };
    (h < 24 && mi < 60 && s < 60).then_some((h, mi, s))
}

fn iso_day(c: &Captures) -> Option<String> {
    iso(num(c, 1)?, num(c, 2)?, num(c, 3)?)
}

fn with_hms(d: String, hms: Option<(i64, i64, i64)>) -> String {
    match hms {
        Some((h, m, s)) => format!("{d} {h:02}:{m:02}:{s:02}"),
        None => d,
    }
}

/// 値を日時として読めれば 'YYYY-MM-DD HH:MM:SS'（時刻が無ければ 'YYYY-MM-DD'）、日付として読めなければ None。
/// `time_value` は時刻が別の列にあるとき（値に時刻が無いときだけ使う）。
pub fn to_datetime(v: &Value, time_value: &Value) -> Option<String> {
    let out = to_datetime_raw(v, time_value)?;
    if out.chars().count() == 19 && (v.is_string() || time_value.is_string()) {
        let texts: Vec<&str> = [v, time_value].iter().filter_map(|t| t.as_str()).collect();
        return Some(meridiem(out, &texts));
    }
    Some(out)
}

fn to_datetime_raw(v: &Value, time_value: &Value) -> Option<String> {
    let compact_int = v.as_u64().filter(|n| (10u64.pow(13)..10u64.pow(14)).contains(n)).map(|n| Value::String(n.to_string()));
    let v = compact_int.as_ref().unwrap_or(v);
    if let Value::String(text) = v {
        let s = py_strip(text);
        if let Some(c) = COMPACT_DT.captures(s) {
            let d = iso_day(&c);
            let (h, mi, sec) = (num(&c, 4)?, num(&c, 5)?, num(&c, 6)?);
            return match d {
                Some(d) if h < 24 && mi < 60 && sec < 60 => Some(format!("{d} {}:{}:{}", &c[4], &c[5], &c[6])),
                _ => None,
            };
        }
        if let Some(c) = FAST_DT.captures(s) {
            let d = iso_day(&c)?;
            match c.get(4) {
                Some(h) => {
                    let (h, mi) = (py_int(h.as_str())?, num(&c, 5)?);
                    let sec = if c.get(6).is_some() { num(&c, 6)? } else { 0 };
                    if h < 24 && mi < 60 && sec < 60 {
                        return Some(format!("{d} {h:02}:{}:{sec:02}", &c[5]));
                    }
                }
                None if !time_value.is_null() => return Some(with_hms(d, to_minutes(time_value))),
                None => return Some(d),
            }
        }
    }
    let d = to_date(v)?;
    let hms = to_minutes(v).or_else(|| if time_value.is_null() { None } else { to_minutes(time_value) });
    Some(with_hms(d, hms))
}

/// 午前・午後（AM・PM）の印を探す。見つかれば午後か（Python の `午前|午後|(?<![A-Za-z])[AaPp]\.?[Mm]\.?(?![A-Za-z])`）。
fn find_meridiem(text: &str) -> Option<bool> {
    let cs: Vec<char> = text.chars().collect();
    let letter = |i: usize| cs.get(i).is_some_and(|c| c.is_ascii_alphabetic());
    for i in 0..cs.len() {
        match cs[i] {
            '午' if matches!(cs.get(i + 1), Some('前') | Some('後')) => return Some(cs[i + 1] == '後'),
            'A' | 'a' | 'P' | 'p' if i == 0 || !letter(i - 1) => {
                let m = if matches!(cs.get(i + 1), Some('M') | Some('m')) {
                    i + 1
                } else if cs.get(i + 1) == Some(&'.') && matches!(cs.get(i + 2), Some('M') | Some('m')) {
                    i + 2
                } else {
                    continue;
                };
                // 後ろの `\.?` は戻れるので、次が「.」なら必ず当たる。そうでなければ英字でないこと
                if cs.get(m + 1) == Some(&'.') || !letter(m + 1) {
                    return Some(matches!(cs[i], 'P' | 'p'));
                }
            }
            _ => {}
        }
    }
    None
}

/// 'YYYY-MM-DD HH:MM:SS' の時を、元の字の午前・午後で 24 時の形に直す（12 時間の書き方でなければそのまま）。
fn meridiem(stamp: String, texts: &[&str]) -> String {
    let cs: Vec<char> = stamp.chars().collect();
    let Some(pm) = texts.iter().find_map(|t| find_meridiem(t)) else { return stamp };
    let Some(h) = py_int(&cs[11..13].iter().collect::<String>()) else { return stamp };
    if h > 12 {
        return stamp;
    }
    let h = h % 12 + if pm { 12 } else { 0 };
    format!("{}{h:02}{}", cs[..11].iter().collect::<String>(), cs[13..].iter().collect::<String>())
}
