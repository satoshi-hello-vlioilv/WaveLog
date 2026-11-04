//! 一覧の絞り込みの条件 → SQL の WHERE（`backend/filter_sql.py` の写し・§9.635）。
//!
//! **答えはここ1箇所**——一覧・スライサー・色付けの数・ダッシュボードの集計が同じ読み方・同じ SQL を使う。
//! 条件は `[{column, op, value}]`。値はいつも `?` で渡し、SQL の字へは列の名前（`qi()` で囲む）しか入れない。
//! SQL の中の `CStr`・`NumOf`・`ToDate` は接続へ登録する関数（Python は `sqlite_io.connect()`。Rust は P3 で同じ物を登録する）。

use crate::pyish::{py_dumps, py_float, py_str, py_str_or_empty, py_str_or_none_empty, py_strip, truthy, Date};
use crate::sort_order::num_of;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// 「どれかと同じ」の値の数の上限
pub const IN_MAX: usize = 1000;
/// 1回の問い合わせで当てる条件の数の上限
pub const FILTERS_MAX: usize = 60;
/// 計算列のスライサーが渡す列の数の上限
pub const TUPLE_COLUMNS_MAX: usize = 4;
pub const SLICE_KEYS: [&str; 3] = ["date", "month", "year"];
/// 今日から N 単位以内（op → 単位）
pub const RELATIVE_OPS: [(&str, &str); 4] =
    [("within_days", "days"), ("within_weeks", "weeks"), ("within_months", "months"), ("within_years", "years")];
const TEXT_OPS: [&str; 11] = ["contains", "not_contains", "eq", "neq", "starts", "starts_any", "ends", "gt", "gte", "lt", "lte"];
const OTHER_OPS: [&str; 6] = ["empty", "not_empty", "in", "not_in", "date_range", "tuple_in"];

fn allowed(op: &str) -> bool {
    TEXT_OPS.contains(&op) || OTHER_OPS.contains(&op) || RELATIVE_OPS.iter().any(|(o, _)| *o == op)
}

/// 列の名前を SQL の字に（`[名前]`・`]` は `]]`）。
pub fn qi(s: &str) -> String {
    format!("[{}]", s.replace(']', "]]"))
}

/// 条件の並び（JSON の字か並び）。読めなければ空。
fn items(text: &Value) -> Vec<Value> {
    if !truthy(text) {
        return Vec::new();
    }
    match text {
        Value::Array(a) => a.clone(),
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(Value::Array(a)) => a,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

fn text_of(item: &Map<String, Value>, key: &str, empty: &str) -> String {
    let v = item.get(key).cloned().unwrap_or(Value::Null);
    let s = if truthy(&v) { py_str(&v) } else { empty.to_string() };
    py_strip(&s).to_string()
}

/// 画面から来た条件 → 当てられる条件の並び。列が表に無い条件は落とす（落とした列は `ignored_filter_columns()` が言う）。
pub fn safe_filters(text: &Value, columns: &[String], calc: &[String]) -> Vec<Value> {
    let known = |c: &str| columns.iter().chain(calc).any(|k| k == c);
    let mut out = Vec::new();
    for item in items(text).iter().take(FILTERS_MAX) {
        let Some(item) = item.as_object() else { continue };
        let col = text_of(item, "column", "");
        let op = text_of(item, "op", "contains");
        let raw = item.get("value").cloned().unwrap_or(Value::Null);
        if op == "tuple_in" {
            let cols: Vec<String> =
                item.get("columns").and_then(Value::as_array).map(|a| a.iter().map(py_str).collect()).unwrap_or_default();
            let unique = cols.iter().enumerate().all(|(i, c)| !cols[..i].contains(c));
            if (1..=TUPLE_COLUMNS_MAX).contains(&cols.len()) && unique && cols.iter().all(|c| known(c)) {
                let value = match &raw {
                    Value::String(s) => s.clone(),
                    Value::Array(_) => py_dumps(&raw),
                    _ => "[]".into(),
                };
                out.push(json!({"column": col, "op": op, "value": value, "columns": cols}));
            }
            continue;
        }
        let value = match (&raw, op.as_str()) {
            (Value::Array(a), "in" | "not_in") => py_dumps(&Value::Array(a.iter().take(IN_MAX).map(|x| json!(py_str(x))).collect())),
            _ => py_strip(&py_str_or_none_empty(&raw)).to_string(),
        };
        if known(&col) && allowed(&op) {
            let mut f = json!({"column": col, "op": op, "value": value});
            if let (true, Some(k)) = (op == "in" || op == "not_in", item.get("key").and_then(Value::as_str)) {
                if SLICE_KEYS.contains(&k) {
                    f["key"] = json!(k);
                }
            }
            out.push(f);
        }
    }
    out
}

fn in_values(value: &str) -> Vec<String> {
    if value.is_empty() {
        return Vec::new();
    }
    let vals: Vec<String> = match serde_json::from_str::<Value>(value) {
        Ok(Value::Array(a)) => a.iter().map(py_str).collect(),
        Ok(Value::String(s)) => s.chars().map(|c| c.to_string()).collect(),
        Ok(Value::Object(o)) => o.keys().cloned().collect(),
        _ => Vec::new(),
    };
    vals.into_iter().take(IN_MAX).collect()
}

/// 値を選ぶ条件の比べる形。日付・年月・年で見せている列は日付と読める値をその形に（読めない値はそのまま）。
pub fn slice_key(col: &str, key: &str) -> String {
    let head = match key {
        "date" => format!("ToDate({col})"),
        "month" => format!("SUBSTR(ToDate({col}),1,7)"),
        "year" => format!("SUBSTR(ToDate({col}),1,4)"),
        _ => return format!("CStr({col})"),
    };
    format!("COALESCE({head},CStr({col}))")
}

fn in_where(col: &str, op: &str, value: &str, key: &str) -> (String, Vec<Value>) {
    let vals = in_values(value);
    let words: Vec<Value> = vals.iter().filter(|v| !v.is_empty()).map(|v| json!(v)).collect();
    let k = slice_key(col, key);
    let mut alts = Vec::new();
    if !words.is_empty() {
        alts.push(format!("{k} IN ({})", vec!["?"; words.len()].join(",")));
    }
    let blank = vals.iter().any(|v| v.is_empty());
    if blank {
        alts.push(format!("({col} IS NULL OR CStr({col})='')"));
    }
    let hit = if alts.is_empty() { "0=1".to_string() } else { format!("({})", alts.join(" OR ")) };
    let sql = match (op, alts.is_empty(), blank) {
        ("in", _, _) => hit,
        (_, true, _) => "1=1".into(),
        (_, _, true) => format!("NOT {hit}"),
        _ => format!("(NOT {hit} OR {col} IS NULL)"),
    };
    (sql, words)
}

/// date_range の値（'YYYY-MM-DD..YYYY-MM-DD'・片側は空でもよい）→ (始め, 終わり)。読めない側は None。
pub fn date_range(value: &Value) -> (Option<String>, Option<String>) {
    let s = py_str_or_empty(value);
    let (head, tail) = s.split_once("..").unwrap_or((&s, ""));
    let one = |x: &str| Date::parse_iso(py_strip(x)).map(|d| d.iso());
    (one(head), one(tail))
}

/// 「今日から N 単位前」の日付（'YYYY-MM-DD'）。N は 0 以上の整数（0＝今日から）。
pub fn cutoff_date(op: &str, value: &Value, today: Date) -> Option<String> {
    let n = py_float(&py_str(value)).filter(|f| !f.is_nan()).map_or(0, |f| f.trunc() as i64).max(0);
    let unit = RELATIVE_OPS.iter().find(|(o, _)| *o == op)?.1;
    match unit {
        "days" => return today.add_days(-n).map(|d| d.iso()),
        "weeks" => return today.add_days(-7 * n).map(|d| d.iso()),
        _ => {}
    }
    let months = n * if unit == "years" { 12 } else { 1 };
    let total = today.y * 12 + today.m - 1 - months;
    let (y, m) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    let last = crate::pyish::month_days(y, m);
    Date::new(y, m, today.d.min(last)).map(|d| d.iso())
}

fn tuple_where(f: &Value) -> (String, Vec<Value>) {
    let cols: Vec<String> = f["columns"].as_array().map(|a| a.iter().filter_map(Value::as_str).map(qi).collect()).unwrap_or_default();
    let raw = f["value"].as_str().unwrap_or("");
    let items: Vec<Value> = if raw.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str::<Value>(raw).ok().and_then(|v| v.as_array().cloned()).unwrap_or_default()
    };
    let ok = |x: &Value| matches!(x, Value::String(_) | Value::Number(_) | Value::Null);
    let tuples: Vec<&Vec<Value>> =
        items.iter().filter_map(Value::as_array).filter(|t| t.len() == cols.len() && t.iter().all(ok)).take(IN_MAX).collect();
    let one = format!("({})", cols.iter().map(|x| format!("{x} IS ?")).collect::<Vec<_>>().join(" AND "));
    let sql = if tuples.is_empty() { "0=1".to_string() } else { format!("({})", vec![one; tuples.len()].join(" OR ")) };
    (sql, tuples.into_iter().flatten().cloned().collect())
}

fn starts_any(col: &str, value: &str) -> (String, Vec<Value>) {
    let vals: Vec<&str> = if value.is_empty() { Vec::new() } else { value.split(',').filter(|x| !x.is_empty()).take(60).collect() };
    if vals.is_empty() {
        return ("0=1".into(), Vec::new());
    }
    (format!("({})", vec![format!("CStr({col}) LIKE ?"); vals.len()].join(" OR ")), vals.iter().map(|v| json!(format!("{v}%"))).collect())
}

fn date_where(col: &str, op: &str, value: &str, today: Date) -> (String, Vec<Value>) {
    if op == "date_range" {
        let (lo, hi) = date_range(&json!(value));
        let mut parts = vec![format!("ToDate({col}) IS NOT NULL")];
        let mut params = Vec::new();
        for (sign, v) in [(">=", lo), ("<=", hi)] {
            if let Some(v) = v {
                parts.push(format!("ToDate({col}) {sign} ?"));
                params.push(json!(v));
            }
        }
        return (format!("({})", parts.join(" AND ")), params);
    }
    (format!("ToDate({col}) >= ?"), vec![json!(cutoff_date(op, &json!(value), today))])
}

/// 条件1つ → (WHERE の式, 値の並び)。
fn one_where(f: &Value, col: &str, today: Date) -> (String, Vec<Value>) {
    let op = f["op"].as_str().unwrap_or("");
    let value = f["value"].as_str().unwrap_or("");
    let text = |sql: &str, pat: String| (sql.replace("{c}", col), vec![json!(pat)]);
    match op {
        "contains" => text("CStr({c}) LIKE ?", format!("%{value}%")),
        "not_contains" => text("(CStr({c}) NOT LIKE ? OR {c} IS NULL)", format!("%{value}%")),
        "eq" => text("CStr({c})=?", value.to_string()),
        "neq" => text("(CStr({c})<>? OR {c} IS NULL)", value.to_string()),
        "starts" => text("CStr({c}) LIKE ?", format!("{value}%")),
        "ends" => text("CStr({c}) LIKE ?", format!("%{value}")),
        "starts_any" => starts_any(col, value),
        "in" | "not_in" => in_where(col, op, value, f.get("key").and_then(Value::as_str).unwrap_or("")),
        "empty" => (format!("({col} IS NULL OR CStr({col})='')"), Vec::new()),
        "not_empty" => (format!("({col} IS NOT NULL AND CStr({col})<>'')"), Vec::new()),
        "tuple_in" => tuple_where(f),
        _ if op == "date_range" || RELATIVE_OPS.iter().any(|(o, _)| *o == op) => date_where(col, op, value, today),
        _ => {
            let sign = match op {
                "gt" => ">",
                "gte" => ">=",
                "lt" => "<",
                _ => "<=",
            };
            match num_of(&json!(value)) {
                Some(lim) => (format!("NumOf({col}) {sign} ?"), vec![json!(lim)]),
                None => ("0=1".into(), Vec::new()),
            }
        }
    }
}

/// 条件の並び（`safe_filters()` の答え）→ (WHERE の式の並び, 値の並び)。exprs … 計算列の名前 → SQL の式。
pub fn build_filter_where(filters: &[Value], today: Date, exprs: &BTreeMap<String, String>) -> (Vec<String>, Vec<Value>) {
    let (mut parts, mut params) = (Vec::new(), Vec::new());
    for f in filters {
        let name = f["column"].as_str().unwrap_or("");
        let col = exprs.get(name).filter(|e| !e.is_empty()).cloned().unwrap_or_else(|| qi(name));
        let (sql, ps) = one_where(f, &col, today);
        parts.push(sql);
        params.extend(ps);
    }
    (parts, params)
}

/// 検索の字（表の列のどれかに含む）＋条件 → (WHERE の式の並び, 値の並び)。
pub fn search_filter_where(
    cs: &[String],
    search: &Value,
    filters: &Value,
    today: Date,
    exprs: &BTreeMap<String, String>,
) -> (Vec<String>, Vec<Value>) {
    let (mut parts, mut params) = (Vec::new(), Vec::new());
    let q = py_strip(&py_str_or_empty(search)).to_string();
    if !q.is_empty() {
        parts.push(format!("({})", cs.iter().map(|x| format!("CStr({}) LIKE ?", qi(x))).collect::<Vec<_>>().join(" OR ")));
        params.extend(cs.iter().map(|_| json!(format!("%{q}%"))));
    }
    let calc: Vec<String> = exprs.keys().cloned().collect();
    let (fp, fpp) = build_filter_where(&safe_filters(filters, cs, &calc), today, exprs);
    parts.extend(fp);
    params.extend(fpp);
    (parts, params)
}

/// 条件のうち、この表に無い列。**黙って捨てない**（画面が「効いていない」と言う）。上限を越えた条件も名乗る。
pub fn ignored_filter_columns(filter_payload: &Value, cs: &[String], calc: &[String]) -> Vec<String> {
    let its = items(filter_payload);
    let mut out: Vec<String> = Vec::new();
    for it in &its {
        let Some(o) = it.as_object() else { continue };
        if o.get("op") == Some(&json!("tuple_in")) {
            continue;
        }
        let col = text_of(o, "column", "");
        if !col.is_empty() && !cs.contains(&col) && !calc.contains(&col) && !out.contains(&col) {
            out.push(col);
        }
    }
    if its.len() > FILTERS_MAX {
        out.push(format!("（{FILTERS_MAX}件を越えた{}件の条件）", its.len() - FILTERS_MAX));
    }
    out
}
