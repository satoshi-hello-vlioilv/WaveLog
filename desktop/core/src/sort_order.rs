//! 列ごとの並べ替えの決まりと、表示の書式・表示ルール（`backend/sort_order.py` の写し・§9.635）。
//!
//! - 塊（空欄・数値・日付・文字列）と塊の中の並び（`bucket_rank`・`value_key`・`order_rows`）
//! - 書式（数・日時・字）と表示ルール（条件・「かつ／または」・かっこの組）→ 画面に出す字（`display_text`）
//!
//! 利用者の正規表現（表示ルールの「正規表現」）は `fancy-regex` で照合する（後読み・後方参照も読む。入れ子の繰り返しは
//! `safe_regex::risk()` で先に断る）。意味は画面（JS）にそろえる方針（§9.634）で、ここは Python と同じ答えの範囲を試験表で固める。

use crate::pyish::{is_digit, py_float, py_int, py_str, py_str_or_empty, py_str_or_none_empty, py_strip, truthy, Date};
use crate::safe_regex;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::cmp::Ordering;
use std::sync::LazyLock;

/// 塊の呼び名（画面の `WL.sortSpec.KINDS` と同じ順・同じ綴り）。
pub const KINDS: [&str; 4] = ["empty", "num", "date", "text"];

fn kind_label(k: &str) -> &'static str {
    match k {
        "empty" => "空欄",
        "num" => "数値",
        "date" => "日付",
        _ => "文字列",
    }
}

static NUM_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-+]?((\d{1,3}(,\d{3})+|\d+)(\.\d*)?|\.\d+)$").expect("数の型"));
static DATE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$").expect("日付の型"));
static DATE_PACKED_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$").expect("8 桁の型"));
static TIME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$").expect("時刻の型"));

/// `str('' if v is None else v).strip()`
fn text(v: &Value) -> String {
    py_strip(&py_str_or_none_empty(v)).to_string()
}

/// 数値として読める値なら f64（桁区切りは正しい位置のときだけ外す）。読めなければ None。
pub fn num_of(v: &Value) -> Option<f64> {
    match v {
        Value::Bool(_) => None,
        Value::Number(n) => n.as_f64(),
        _ => {
            let t = text(v);
            if t.is_empty() || !NUM_RE.is_match(&t) {
                return None;
            }
            py_float(&t.replace(',', ""))
        }
    }
}

fn caps_int(c: &regex::Captures, i: usize) -> Option<i64> {
    c.get(i).map_or(Some(0), |m| py_int(m.as_str()))
}

/// 日付として読める値なら 'YYYYMMDDHHMMSS'。8 桁の数字だけは日付として読まない（時刻まで続くときだけ）。
pub fn date_key(v: &Value) -> Option<String> {
    let t = text(v);
    if t.is_empty() {
        return None;
    }
    let c = match DATE_RE.captures(&t) {
        Some(c) => c,
        None => DATE_PACKED_RE.captures(&t).filter(|c| c.get(4).is_some())?,
    };
    let (y, mo, d) = (caps_int(&c, 1)?, caps_int(&c, 2)?, caps_int(&c, 3)?);
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
        return None;
    }
    let (hh, mi, ss) = (caps_int(&c, 4)?, caps_int(&c, 5)?, caps_int(&c, 6)?);
    if hh > 23 || mi > 59 || ss > 59 {
        return None;
    }
    Some(format!("{y:04}{mo:02}{d:02}{hh:02}{mi:02}{ss:02}"))
}

/// その値がどの塊か（空欄→数値→日付→文字列の順に見る）。
pub fn classify(v: &Value) -> &'static str {
    let t = text(v);
    let tv = Value::String(t.clone());
    if t.is_empty() {
        "empty"
    } else if num_of(&tv).is_some() {
        "num"
    } else if date_key(&tv).is_some() {
        "date"
    } else {
        "text"
    }
}

/// 数字混じりの文字列を人の読む順にする鍵（数字の並びを 20 桁へ 0 埋め）。
pub fn natural_key(s: &Value) -> String {
    let src = py_str_or_empty(s);
    let mut out = String::new();
    let mut run = String::new();
    let flush = |run: &mut String, out: &mut String| {
        let n = run.chars().count();
        if n > 0 {
            out.push_str(&"0".repeat(20usize.saturating_sub(n)));
            out.push_str(run);
            run.clear();
        }
    };
    for c in src.chars() {
        if is_digit(c) {
            run.push(c);
        } else {
            flush(&mut run, &mut out);
            out.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// 並べ替えの設定（`normalize_spec` の答え）。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Spec {
    pub buckets: Vec<String>,
    pub on_display: bool,
    pub natural: bool,
}

impl Spec {
    pub fn to_value(&self) -> Value {
        json!({"buckets": self.buckets, "on": if self.on_display { "display" } else { "raw" }, "natural": self.natural})
    }

    /// 並べ替えの鍵に使う形（保存された設定・画面から来た設定のどちらでも）。
    pub fn of(v: &Value) -> Spec {
        let o = v.as_object();
        // 字でない要素も位置は残す（Python の `buckets.index(kind)` は位置で答える）
        let buckets = o
            .and_then(|o| o.get("buckets"))
            .and_then(Value::as_array)
            .map(|a| a.iter().map(|x| x.as_str().map_or_else(|| "\u{0}".to_string(), String::from)).collect())
            .unwrap_or_default();
        Spec {
            buckets,
            on_display: o.is_some_and(|o| o.get("on") == Some(&json!("display"))),
            natural: o.is_some_and(|o| o.get("natural").is_some_and(truthy)),
        }
    }
}

/// 保存された／画面から来た並べ替え設定を正す。**何も指定が無ければ None**（今までどおり SQL の ORDER BY）。
pub fn normalize_spec(x: &Value) -> Option<Spec> {
    let parsed;
    let x = match x {
        Value::Null => return None,
        Value::String(s) if s.is_empty() => return None,
        Value::String(s) => {
            parsed = serde_json::from_str::<Value>(s).ok()?;
            &parsed
        }
        other => other,
    };
    let o = x.as_object()?;
    if o.is_empty() {
        return None;
    }
    let raw_buckets = o.get("buckets").filter(|b| truthy(b));
    // `for k in (x.get('buckets') or [])`: 並びは要素、辞書は鍵、字は1字ずつ
    let items: Vec<Value> = match raw_buckets {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(m)) => m.keys().map(|k| json!(k)).collect(),
        Some(Value::String(s)) => s.chars().map(|c| json!(c.to_string())).collect(),
        _ => Vec::new(),
    };
    let mut buckets: Vec<String> = Vec::new();
    for k in &items {
        let k = py_strip(&py_str_or_empty(k)).to_string();
        if KINDS.contains(&k.as_str()) && !buckets.contains(&k) {
            buckets.push(k);
        }
    }
    if !buckets.is_empty() {
        for k in KINDS {
            if !buckets.iter().any(|b| b == k) {
                buckets.push(k.to_string());
            }
        }
    }
    let on_display = o.get("on").map(py_str_or_empty).as_deref() == Some("display");
    let natural = o.get("natural").is_some_and(truthy);
    if buckets.is_empty() && !on_display && !natural {
        return None;
    }
    Some(Spec { buckets, on_display, natural })
}

/// マスタへ入れる文字列（指定なしは空文字）。
pub fn spec_json(spec: &Value) -> String {
    normalize_spec(spec).map(|s| crate::pyish::py_dumps(&s.to_value())).unwrap_or_default()
}

/// 塊の順番。指定が無ければ全部同じ。
pub fn bucket_rank(spec: &Spec, value: &Value) -> usize {
    if spec.buckets.is_empty() {
        return 0;
    }
    let kind = classify(value);
    spec.buckets.iter().position(|b| b == kind).unwrap_or(spec.buckets.len())
}

/// 塊の中の並びの鍵（どの塊とも比べられる3つ組）。
#[derive(Debug, Clone, PartialEq)]
pub struct ValueKey(pub i64, pub f64, pub String);

impl Eq for ValueKey {}

impl PartialOrd for ValueKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ValueKey {
    fn cmp(&self, o: &Self) -> Ordering {
        self.0.cmp(&o.0).then(self.1.partial_cmp(&o.1).unwrap_or(Ordering::Equal)).then_with(|| self.2.cmp(&o.2))
    }
}

pub fn value_key(spec: &Spec, value: &Value) -> ValueKey {
    let t = text(value);
    if t.is_empty() {
        return ValueKey(0, 0.0, String::new());
    }
    let tv = Value::String(t.clone());
    if let Some(n) = num_of(&tv) {
        return ValueKey(0, n, String::new());
    }
    if let Some(d) = date_key(&tv) {
        return ValueKey(1, 0.0, d);
    }
    ValueKey(1, 0.0, if spec.natural { natural_key(&tv) } else { t })
}

/// keys の順に並べる（安定な並べ替えを後ろの鍵から重ねる）。`value_of(行, 鍵)` が並べ替えに使う値。
pub fn order_rows<R: Clone>(rows: &[R], keys: &[Value], value_of: &dyn Fn(&R, &Value) -> Value) -> Vec<R> {
    let mut out = rows.to_vec();
    for k in keys.iter().rev() {
        let spec = Spec::of(k.get("spec").unwrap_or(&Value::Null));
        let desc = k.get("dir").map(py_str_or_empty).unwrap_or_default().to_lowercase() == "desc";
        let mut keyed: Vec<(ValueKey, R)> = out.into_iter().map(|r| (value_key(&spec, &value_of(&r, k)), r)).collect();
        if desc {
            keyed.sort_by(|a, b| b.0.cmp(&a.0));
        } else {
            keyed.sort_by(|a, b| a.0.cmp(&b.0));
        }
        out = keyed.into_iter().map(|(_, r)| r).collect();
        if !spec.buckets.is_empty() {
            let mut ranked: Vec<(usize, R)> = out.into_iter().map(|r| (bucket_rank(&spec, &value_of(&r, k)), r)).collect();
            ranked.sort_by_key(|x| x.0);
            out = ranked.into_iter().map(|(_, r)| r).collect();
        }
    }
    out
}

/// 設定を1行の日本語で。
pub fn describe(spec: &Value) -> String {
    let Some(s) = normalize_spec(spec) else { return "既定（種類で分けない）".into() };
    let mut out = Vec::new();
    if !s.buckets.is_empty() {
        out.push(s.buckets.iter().map(|k| kind_label(k)).collect::<Vec<_>>().join(" → "));
    }
    if s.natural {
        out.push("数字混じりは人の読む順".into());
    }
    out.push(if s.on_display { "変換後の文字で並べる" } else { "生の値で並べる" }.to_string());
    out.join("／")
}

// ---- 書式 ------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default)]
struct Parts {
    y: Option<i64>,
    mo: Option<i64>,
    d: Option<i64>,
    h: i64,
    mi: i64,
    s: i64,
}

fn parts(v: &Value) -> Option<Parts> {
    let t = text(v);
    if t.is_empty() {
        return None;
    }
    if let Some(c) = DATE_RE.captures(&t).or_else(|| DATE_PACKED_RE.captures(&t)) {
        let (y, mo, d) = (caps_int(&c, 1)?, caps_int(&c, 2)?, caps_int(&c, 3)?);
        if !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
            return None;
        }
        let (h, mi, s) = (caps_int(&c, 4)?, caps_int(&c, 5)?, caps_int(&c, 6)?);
        if h > 23 || mi > 59 || s > 59 {
            return None;
        }
        return Some(Parts { y: Some(y), mo: Some(mo), d: Some(d), h, mi, s });
    }
    let c = TIME_RE.captures(&t)?;
    let (h, mi, s) = (caps_int(&c, 1)?, caps_int(&c, 2)?, caps_int(&c, 3)?);
    if h > 23 || mi > 59 || s > 59 {
        return None;
    }
    Some(Parts { y: None, mo: None, d: None, h, mi, s })
}

const WEEK: [&str; 7] = ["日", "月", "火", "水", "木", "金", "土"];
/// 書式の字の部品（Python の `_TOKEN_RE` と同じ順。長いものから）。
const TOKENS: [&str; 18] = ["yyyy", "yy", "MM", "M", "dddd", "ddd", "dd", "d", "HH", "H", "hh", "h", "mm", "m", "ss", "s", "tt", "'"];

/// 書式の字（yyyy/MM/dd…）へ当てる。書式が求めた部分がその値に無ければ None。
fn stamp(p: &Parts, pattern: &str) -> Option<String> {
    let cs: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let h12 = || {
        let h = p.h % 12;
        if h == 0 {
            12
        } else {
            h
        }
    };
    while i < cs.len() {
        let rest: String = cs[i..].iter().collect();
        let Some(tok) = TOKENS.iter().find(|t| rest.starts_with(**t)) else {
            out.push(cs[i]);
            i += 1;
            continue;
        };
        if *tok == "'" {
            // '[^']*' ——閉じの「'」が無ければ部品ではない（字のまま）
            match cs[i + 1..].iter().position(|c| *c == '\'') {
                Some(k) => {
                    out.extend(&cs[i + 1..i + 1 + k]);
                    i += k + 2;
                }
                None => {
                    out.push('\'');
                    i += 1;
                }
            }
            continue;
        }
        let piece = match *tok {
            "yyyy" => format!("{:04}", p.y?.abs()),
            "yy" => format!("{:02}", p.y?.abs() % 100),
            "MM" => format!("{:02}", p.mo?.abs()),
            "M" => p.mo?.to_string(),
            "dddd" | "ddd" => {
                let w = WEEK[Date::new(p.y?, p.mo?, p.d?)?.weekday_sun0()];
                if *tok == "dddd" {
                    format!("{w}曜日")
                } else {
                    w.to_string()
                }
            }
            "dd" => format!("{:02}", p.d?.abs()),
            "d" => p.d?.to_string(),
            "HH" => format!("{:02}", p.h.abs()),
            "H" => p.h.to_string(),
            "hh" => format!("{:02}", h12()),
            "h" => h12().to_string(),
            "mm" => format!("{:02}", p.mi.abs()),
            "m" => p.mi.to_string(),
            "ss" => format!("{:02}", p.s.abs()),
            "s" => p.s.to_string(),
            _ => (if p.h < 12 { "午前" } else { "午後" }).to_string(),
        };
        out.push_str(&piece);
        i += tok.chars().count();
    }
    Some(out)
}

fn group_thousands(s: &str) -> String {
    let (neg, rest) = s.strip_prefix('-').map_or(("", s), |r| ("-", r));
    let (head, frac) = rest.split_once('.').map_or((rest, ""), |(h, f)| (h, f));
    let ok = !head.is_empty()
        && head.chars().all(is_digit)
        && (!rest.contains('.') || (!frac.is_empty() && frac.chars().all(is_digit)));
    if !ok {
        return s.to_string();
    }
    let cs: Vec<char> = head.chars().collect();
    let mut out = String::new();
    for (i, c) in cs.iter().enumerate() {
        if i > 0 && (cs.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*c);
    }
    format!("{neg}{out}{}", if rest.contains('.') { format!(".{frac}") } else { String::new() })
}

/// `int(値)`（数・数の字・真偽）。読めなければ None（Python は例外）。
fn py_int_of(v: &Value) -> Option<i64> {
    match v {
        Value::Bool(b) => Some(*b as i64),
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().filter(|f| f.is_finite()).map(|f| f.trunc() as i64)),
        Value::String(s) => {
            let t = py_strip(s).replace('_', "");
            let (neg, body) = t.strip_prefix('-').map_or((false, t.trim_start_matches('+')), |b| (true, b));
            py_int(body).map(|n| if neg { -n } else { n })
        }
        _ => None,
    }
}

fn run_format(spec: &Value, raw: &Value) -> Option<String> {
    let o = spec.as_object()?;
    let get = |k: &str| o.get(k).cloned().unwrap_or(Value::Null);
    let kind = py_str_or_empty(&get("kind"));
    match kind.as_str() {
        "number" => {
            let n = num_of(raw)?;
            let dec = get("decimals");
            let mut s = if dec.is_null() || dec == json!("") {
                if n != n.trunc() {
                    crate::pyish::py_g(n)
                } else {
                    // str(int(n))（-0 は "0"）
                    let i = format!("{n:.0}");
                    if i == "-0" {
                        "0".to_string()
                    } else {
                        i
                    }
                }
            } else {
                match py_int_of(&dec).filter(|d| *d >= 0) {
                    Some(d) => format!("{n:.*}", d as usize),
                    None => crate::pyish::py_float_repr(n),
                }
            };
            if truthy(&get("thousands")) {
                s = group_thousands(&s);
            }
            Some(format!("{}{s}{}", py_str_or_empty(&get("prefix")), py_str_or_empty(&get("suffix"))))
        }
        "datetime" => {
            let p = parts(raw)?;
            let pat = get("pattern");
            let pat = if truthy(&pat) { py_str(&pat) } else { "yyyy/MM/dd".to_string() };
            stamp(&p, &pat)
        }
        "text" => Some(format!("{}{}{}", py_str_or_empty(&get("prefix")), text(raw), py_str_or_empty(&get("suffix")))),
        _ => None,
    }
}

/// 書式を1つ当てる。整形できなければ生の値の文字列。空欄は空欄のまま。
pub fn format_value(spec: &Value, raw: &Value) -> String {
    let t = py_str_or_none_empty(raw);
    if py_strip(&t).is_empty() {
        return String::new();
    }
    run_format(spec, raw).unwrap_or(t)
}

// ---- 表示ルール ------------------------------------------------------------------------------------------------------

fn operand(side: Option<&Value>, row: &Map<String, Value>, self_col: &str) -> Value {
    let Some(side) = side.filter(|s| truthy(s)) else { return json!("") };
    let kind = side.get("kind").map(py_str_or_empty).unwrap_or_default();
    match kind.as_str() {
        "self" => row.get(self_col).cloned().unwrap_or(json!("")),
        "column" => side.get("column").and_then(|c| c.as_str()).and_then(|c| row.get(c)).cloned().unwrap_or(json!("")),
        _ => side.get("value").cloned().unwrap_or(Value::Null),
    }
}

fn cmp(a: &Value, b: &Value) -> Ordering {
    if let (Some(x), Some(y)) = (num_of(a), num_of(b)) {
        return x.partial_cmp(&y).unwrap_or(Ordering::Equal);
    }
    py_str_or_none_empty(a).cmp(&py_str_or_none_empty(b))
}

fn ordered(a: &Value, b: &Value) -> bool {
    !text(a).is_empty() && !text(b).is_empty()
}

/// 条件1つ（画面の `WL.displayRules.test` と同じ判定）。
pub fn rule_test(cond: &Value, row: &Map<String, Value>, self_col: &str) -> bool {
    let l = operand(cond.get("left"), row, self_col);
    let ls = py_str_or_none_empty(&l);
    let op = cond.get("op").map(py_str_or_empty).unwrap_or_default();
    match op.as_str() {
        "empty" => return py_strip(&ls).is_empty(),
        "notEmpty" => return !py_strip(&ls).is_empty(),
        _ => {}
    }
    let r = operand(cond.get("right"), row, self_col);
    let rs = py_str_or_none_empty(&r);
    let same = || ls == rs || cmp(&l, &r) == Ordering::Equal;
    match op.as_str() {
        "eq" => same(),
        "ne" => !same(),
        "contains" => !rs.is_empty() && ls.contains(&rs),
        "startsWith" => !rs.is_empty() && ls.starts_with(&rs),
        "endsWith" => !rs.is_empty() && ls.ends_with(&rs),
        "gt" => ordered(&l, &r) && cmp(&l, &r) == Ordering::Greater,
        "ge" => ordered(&l, &r) && cmp(&l, &r) != Ordering::Less,
        "lt" => ordered(&l, &r) && cmp(&l, &r) == Ordering::Less,
        "le" => ordered(&l, &r) && cmp(&l, &r) != Ordering::Greater,
        "between" => {
            let r2 = operand(cond.get("right2"), row, self_col);
            ordered(&l, &r) && ordered(&l, &r2) && cmp(&l, &r) != Ordering::Less && cmp(&l, &r2) != Ordering::Greater
        }
        "regex" => safe_regex::risk(&rs).is_empty() && fancy_regex::Regex::new(&rs).is_ok_and(|rx| rx.is_match(&ls).unwrap_or(false)),
        _ => false,
    }
}

/// 行の中の条件を「または」で区切った群へ（`join:'or'` の条件から新しい群・「かつ」を先にまとめる）。
pub fn rule_groups(conds: &[Value]) -> Vec<Vec<Value>> {
    let mut out: Vec<Vec<Value>> = Vec::new();
    for (i, cd) in conds.iter().enumerate() {
        if i == 0 || cd.get("join") == Some(&json!("or")) {
            out.push(Vec::new());
        }
        out.last_mut().expect("最初の群").push(cd.clone());
    }
    out
}

pub fn is_rule_group(cd: &Value) -> bool {
    cd.get("kind") == Some(&json!("group"))
}

fn conds_of(v: Option<&Value>) -> Vec<Value> {
    v.and_then(Value::as_array).cloned().unwrap_or_default()
}

/// どれか1つの群の条件がすべて当たるか（かっこの組はその中を同じ決まりで見る。空の組は当たらない）。
pub fn rule_conds_true(conds: &[Value], row: &Map<String, Value>, self_col: &str) -> bool {
    rule_groups(conds).iter().any(|g| {
        g.iter().all(|cd| {
            if is_rule_group(cd) {
                rule_conds_true(&conds_of(cd.get("conditions")), row, self_col)
            } else {
                rule_test(cd, row, self_col)
            }
        })
    })
}

/// かっこの組の中まで降りて、条件（葉）だけを並べる。
pub fn rule_leaves(conds: &[Value]) -> Vec<Value> {
    conds.iter().flat_map(|cd| if is_rule_group(cd) { rule_leaves(&conds_of(cd.get("conditions"))) } else { vec![cd.clone()] }).collect()
}

/// 表示ルールが式を使っているか（式は画面の `WL.formula` だけが解く）。
pub fn rules_need_formula(rows: &[Value]) -> bool {
    rows.iter().any(|r| {
        r.get("text").and_then(Value::as_str).is_some_and(|t| t.starts_with('='))
            || rule_leaves(&conds_of(r.get("conditions"))).iter().any(|cd| {
                cd.get("op").map(py_str_or_empty).as_deref() == Some("formula")
                    || ["left", "right", "right2"].iter().any(|k| cd.get(*k).and_then(|s| s.get("kind")) == Some(&json!("calc")))
            })
    })
}

/// 当たった行（条件が空の行＝既定）。
pub fn rule_match<'a>(rows: &'a [Value], row: &Map<String, Value>, self_col: &str) -> Option<&'a Value> {
    rows.iter().find(|r| {
        let conds = conds_of(r.get("conditions"));
        conds.is_empty() || rule_conds_true(&conds, row, self_col)
    })
}

/// 1つのセルが画面に出す文字（画面の `WL.cellFormat.cell` と同じ順序: 読み替え → 書式 → 生の値）。
pub fn display_text(raw: &Value, fmt: &Value, rule_rows: &[Value], row: &Map<String, Value>, column: &str) -> String {
    if !rule_rows.is_empty() {
        if let Some(hit) = rule_match(rule_rows, row, column) {
            let t = hit.get("text").cloned().unwrap_or(Value::Null);
            if !t.is_null() && t != json!("") {
                return py_str(&t);
            }
        }
    }
    format_value(fmt, raw)
}
