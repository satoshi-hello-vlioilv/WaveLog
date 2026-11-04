//! Python と同じ答えにするための小道具（§9.634）。移す関数は Python の決まりで字を扱っていたので、その決まりを1箇所で写す。
//!
//! - [`py_str`] … `str(値)`（`None`・`True`・`1.0`・`1e-05` の書き方）
//! - [`py_float_repr`] … 小数の `repr`（最短の桁・指数は `e-05` の2桁）
//! - [`py_strip`] … `str.strip()`（`\x1c`〜`\x1f`・全角の空白も除く）
//! - [`digit_value`] … `\d` と `int()` が数字と読む字（全角・アラビア文字の数字など。Unicode の 10 進数字 68 組）
//! - [`truthy`] … `bool(値)`（空の字・0・空の並びは偽）
//!
//! 写しの正しさは試験表（`tests/fixtures/parity`）が見る。

use serde_json::Value;

/// 10 進数字の「0」の字（Unicode の Nd。どれも 0〜9 が続けて並ぶ）。Python 3.13（Unicode 15.1）の unicodedata から作った。
const DIGIT_ZEROS: [u32; 68] = [
    0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66, 0xDE6, 0xE50, 0xED0, 0xF20, 0x1040, 0x1090,
    0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90, 0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0,
    0xFF10, 0x104A0, 0x10D30, 0x11066, 0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0, 0x11650, 0x116C0, 0x11730, 0x118E0, 0x11950,
    0x11C50, 0x11D50, 0x11DA0, 0x11F50, 0x16A60, 0x16AC0, 0x16B50, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6, 0x1E140, 0x1E2F0, 0x1E4F0,
    0x1E950, 0x1FBF0,
];

/// 10 進数字ならその値（Python の `unicodedata.decimal`）。
pub fn digit_value(c: char) -> Option<u32> {
    let cp = c as u32;
    let i = DIGIT_ZEROS.partition_point(|z| *z <= cp);
    let zero = *DIGIT_ZEROS.get(i.checked_sub(1)?)?;
    (cp - zero < 10).then_some(cp - zero)
}

pub fn is_digit(c: char) -> bool {
    digit_value(c).is_some()
}

/// 数字の並びを整数へ（Python の `int(字)`。全角などの数字も読む）。数字でない字があれば None。
pub fn py_int(s: &str) -> Option<i64> {
    if s.is_empty() {
        return None;
    }
    s.chars().try_fold(0i64, |n, c| n.checked_mul(10)?.checked_add(digit_value(c)? as i64))
}

/// 数字をすべて ASCII の数字へ（`float()` へ渡す前に）。
pub fn ascii_digits(s: &str) -> String {
    s.chars().map(|c| digit_value(c).map_or(c, |d| char::from(b'0' + d as u8))).collect()
}

/// Python の `str.isspace()` が真の字。
pub fn is_py_space(c: char) -> bool {
    matches!(c, '\t'..='\r' | '\x1c'..='\x20' | '\u{85}' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}')
}

pub fn py_strip(s: &str) -> &str {
    s.trim_matches(is_py_space)
}

/// 小数の `repr`（Python と同じ: 最短の桁、10^-5 未満と 10^16 以上は指数、指数は2桁以上）。
pub fn py_float_repr(f: f64) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf".into() } else { "-inf".into() };
    }
    let sci = format!("{:e}", f.abs()); // 例: 1.5e-7・1e16・0e0
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let sign = if f.is_sign_negative() { "-" } else { "" };
    if (-4..16).contains(&exp) {
        let decpt = exp + 1;
        let body = if decpt <= 0 {
            format!("0.{}{digits}", "0".repeat((-decpt) as usize))
        } else if decpt as usize >= digits.len() {
            format!("{digits}{}.0", "0".repeat(decpt as usize - digits.len()))
        } else {
            format!("{}.{}", &digits[..decpt as usize], &digits[decpt as usize..])
        };
        format!("{sign}{body}")
    } else {
        let (head, rest) = digits.split_at(1);
        let frac = if rest.is_empty() { String::new() } else { format!(".{rest}") };
        format!("{sign}{head}{frac}e{}{:02}", if exp < 0 { '-' } else { '+' }, exp.abs())
    }
}

/// 数の `str()`（整数はそのまま・小数は `repr`）。
pub fn py_num_str(n: &serde_json::Number) -> String {
    if n.is_f64() {
        py_float_repr(n.as_f64().unwrap_or(f64::NAN))
    } else {
        n.to_string()
    }
}

/// `str(値)`。並び・辞書は JSON の字（移す関数はそこを使わない）。
pub fn py_str(v: &Value) -> String {
    match v {
        Value::Null => "None".into(),
        Value::Bool(b) => if *b { "True" } else { "False" }.into(),
        Value::Number(n) => py_num_str(n),
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// `bool(値)`。
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// `str(値 or '')`。
pub fn py_str_or_empty(v: &Value) -> String {
    if truthy(v) {
        py_str(v)
    } else {
        String::new()
    }
}

/// `str(値 if 値 is not None else '')`。
pub fn py_str_or_none_empty(v: &Value) -> String {
    if v.is_null() {
        String::new()
    } else {
        py_str(v)
    }
}

/// 字の先頭から n 字（Python の `s[:n]`。字の単位で切る）。
pub fn take_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// `'%g' % f`（有効数字 6 桁・指数は 10^-5 未満と 10^6 以上・末尾の 0 を落とす）。
pub fn py_g(f: f64) -> String {
    if f.is_nan() {
        return "nan".into();
    }
    if f.is_infinite() {
        return if f > 0.0 { "inf".into() } else { "-inf".into() };
    }
    if f == 0.0 {
        return if f.is_sign_negative() { "-0".into() } else { "0".into() };
    }
    let sci = format!("{f:.5e}"); // 有効数字 6 桁へ丸めた形（例 1.23457e6）
    let (mant, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let trim = |t: String| -> String {
        if t.contains('.') {
            t.trim_end_matches('0').trim_end_matches('.').to_string()
        } else {
            t
        }
    };
    if (-4..6).contains(&exp) {
        trim(format!("{f:.*}", (5 - exp) as usize))
    } else {
        format!("{}e{}{:02}", trim(mant.to_string()), if exp < 0 { '-' } else { '+' }, exp.abs())
    }
}

/// `float(字)`（前後の空白・全角などの数字・数字のあいだの `_`・inf／nan も読む）。読めなければ None。
pub fn py_float(s: &str) -> Option<f64> {
    let t = ascii_digits(py_strip(s));
    let b = t.as_bytes();
    for (i, c) in b.iter().enumerate() {
        if *c == b'_' && !(i > 0 && b[i - 1].is_ascii_digit() && b.get(i + 1).is_some_and(u8::is_ascii_digit)) {
            return None;
        }
    }
    let t = t.replace('_', "");
    let body = t.trim_start_matches(['+', '-']);
    if t.len() - body.len() > 1 {
        return None;
    }
    let word = body.to_ascii_lowercase();
    if matches!(word.as_str(), "inf" | "infinity" | "nan") {
        return t.parse().ok();
    }
    // 数字・小数点・指数だけ（Rust が受けて Python が受けない形を落とす）
    let ok = !body.is_empty() && body.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'));
    if !ok || !body.starts_with(|c: char| c.is_ascii_digit() || c == '.') {
        return None;
    }
    t.parse().ok()
}

/// `json.dumps(値, ensure_ascii=False)`（区切りは `", "`・`": "`、小数は Python の書き方。辞書は鍵の名前順＝`sort_keys=True` の形）。
pub fn py_dumps(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) if n.is_f64() => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            if f.is_finite() {
                py_float_repr(f)
            } else if f.is_nan() {
                "NaN".into()
            } else if f > 0.0 {
                "Infinity".into()
            } else {
                "-Infinity".into()
            }
        }
        Value::Number(n) => n.to_string(),
        Value::String(s) => serde_json::to_string(s).unwrap_or_default(),
        Value::Array(a) => format!("[{}]", a.iter().map(py_dumps).collect::<Vec<_>>().join(", ")),
        Value::Object(o) => {
            let parts: Vec<String> =
                o.iter().map(|(k, x)| format!("{}: {}", serde_json::to_string(k).unwrap_or_default(), py_dumps(x))).collect();
            format!("{{{}}}", parts.join(", "))
        }
    }
}

/// 暦の日（`datetime.date`）。年は 1〜9999。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Date {
    pub y: i64,
    pub m: i64,
    pub d: i64,
}

impl Date {
    pub fn new(y: i64, m: i64, d: i64) -> Option<Date> {
        ((1..=9999).contains(&y) && (1..=12).contains(&m) && d >= 1 && d <= month_days(y, m)).then_some(Date { y, m, d })
    }

    /// 'YYYY-MM-DD'（`date.fromisoformat` の形だけ）。
    pub fn parse_iso(s: &str) -> Option<Date> {
        let b = s.as_bytes();
        if b.len() != 10 || b[4] != b'-' || b[7] != b'-' || !b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit()) {
            return None;
        }
        Date::new(s[..4].parse().ok()?, s[5..7].parse().ok()?, s[8..].parse().ok()?)
    }

    pub fn iso(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.y, self.m, self.d)
    }

    /// 0001-01-01 を 1 とする通し日（`date.toordinal()`）。
    pub fn ordinal(&self) -> i64 {
        let y = self.y - 1;
        let before = y * 365 + y / 4 - y / 100 + y / 400;
        let in_year: i64 = (1..self.m).map(|m| month_days(self.y, m)).sum();
        before + in_year + self.d
    }

    pub fn from_ordinal(n: i64) -> Option<Date> {
        if n < 1 {
            return None;
        }
        // 400 年の周期で寄せてから 1 年ずつ
        let mut y = (n - 1) / 146_097 * 400 + 1;
        let mut left = (n - 1) % 146_097 + 1;
        loop {
            let len = if is_leap(y) { 366 } else { 365 };
            if left <= len {
                break;
            }
            left -= len;
            y += 1;
        }
        let mut m = 1;
        while left > month_days(y, m) {
            left -= month_days(y, m);
            m += 1;
        }
        Date::new(y, m, left)
    }

    pub fn add_days(&self, days: i64) -> Option<Date> {
        Date::from_ordinal(self.ordinal() + days)
    }

    /// 曜日（`isoweekday() % 7`＝日曜 0〜土曜 6）。
    pub fn weekday_sun0(&self) -> usize {
        (self.ordinal() % 7) as usize
    }
}

pub fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

pub fn month_days(y: i64, m: i64) -> i64 {
    match m {
        2 if is_leap(y) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float_repr_like_python() {
        for (f, want) in [
            (1.0, "1.0"),
            (1.5, "1.5"),
            (1e-5, "1e-05"),
            (0.0001, "0.0001"),
            (1e16, "1e+16"),
            (1e15, "1000000000000000.0"),
            (123456789.125, "123456789.125"),
            (-0.0, "-0.0"),
            (0.1 + 0.2, "0.30000000000000004"),
            (1.5e-7, "1.5e-07"),
            (2.5e300, "2.5e+300"),
            (-3.0, "-3.0"),
        ] {
            assert_eq!(py_float_repr(f), want, "{f}");
        }
    }

    #[test]
    fn digits_and_space() {
        assert_eq!(digit_value('７'), Some(7));
        assert_eq!(digit_value('٣'), Some(3));
        assert_eq!(digit_value('a'), None);
        assert_eq!(digit_value('/'), None);
        assert_eq!(py_int("２０２６"), Some(2026));
        assert_eq!(py_strip("\x1c\u{3000} a \u{3000}\x1f"), "a");
    }

    #[test]
    fn g_float_dumps_dates() {
        for (f, want) in [
            (1234567.891, "1.23457e+06"),
            (0.0001, "0.0001"),
            (0.00001234, "1.234e-05"),
            (12.5, "12.5"),
            (100000.0, "100000"),
            (1e6, "1e+06"),
        ] {
            assert_eq!(py_g(f), want, "{f}");
        }
        assert_eq!(py_float(" 1_0 "), Some(10.0));
        assert_eq!(py_float("1__0"), None);
        assert_eq!(py_float("２.５"), Some(2.5));
        assert_eq!(py_float("e5"), None);
        assert_eq!(py_float("--1"), None);
        assert_eq!(py_dumps(&serde_json::json!(["a", 1.0, null, {"b": true}])), r#"["a", 1.0, null, {"b": true}]"#);
        let d = Date::new(2024, 2, 29).unwrap();
        assert_eq!(Date::from_ordinal(d.ordinal()), Some(d));
        assert_eq!(Date::new(1, 1, 1).unwrap().ordinal(), 1);
        assert_eq!(Date::new(2026, 8, 2).unwrap().weekday_sun0(), 0, "2026-08-02 は日曜");
        assert_eq!(d.add_days(1).unwrap().iso(), "2024-03-01");
    }
}
