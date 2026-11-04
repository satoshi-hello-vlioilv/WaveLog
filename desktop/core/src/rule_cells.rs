//! 判定表（条件表）の条件の語彙と、保存の前に整える関数（`backend/rule_cells.py` の写し・§9.634）。
//! 表ごとに違うのは「どの列（データ）を受けるか」だけで、それは呼ぶ側が `field_ok` で渡す。判定はしない。

use crate::pyish::{py_str_or_none_empty, py_strip, take_chars};
use serde_json::{json, Map, Value};

/// 比べ方（表示ルールマスタと同じ綴り）。
pub const RULE_OPS: &[(&str, &str)] = &[
    ("eq", "＝"),
    ("ne", "≠"),
    ("ge", "≧"),
    ("gt", "＞"),
    ("le", "≦"),
    ("lt", "＜"),
    ("between", "範囲"),
    ("contains", "含む"),
    ("startsWith", "で始まる"),
    ("endsWith", "で終わる"),
    ("notContains", "含まない"),
    ("notStartsWith", "で始まらない"),
    ("notEndsWith", "で終わらない"),
    ("empty", "空"),
    ("notEmpty", "空でない"),
    ("regex", "正規表現"),
];
/// 右辺を2つ取るもの
pub const RULE_OPS_2: &[&str] = &["between"];
/// 右辺を持たないもの
pub const RULE_OPS_0: &[&str] = &["empty", "notEmpty"];
pub const COLS_MAX: usize = 40;
const VALUE_MAX: usize = 120;
const PREFIXED_MAX: usize = 80;

fn txt(v: Option<&Value>) -> String {
    py_strip(&py_str_or_none_empty(v.unwrap_or(&Value::Null))).to_string()
}

/// `<接頭辞><列名>` の形か（名前がデータに依る列）。**字の形だけ**を見る。
pub fn prefixed_field(field: &Value, prefix: &str) -> bool {
    let f = txt(Some(field));
    let n = f.chars().count();
    f.starts_with(prefix) && n > prefix.chars().count() && n <= PREFIXED_MAX && !f.chars().any(|c| "[]\r\n\t".contains(c))
}

/// 保存できる条件の配列へ整える。**壊れた条件は1件だけ落とす**。`field_ok(field)` が真の列だけを受ける。
pub fn normalize_conditions(raw: &Value, field_ok: &dyn Fn(&str) -> bool) -> Vec<Value> {
    let Some(items) = raw.as_array() else { return Vec::new() };
    let mut out: Vec<Map<String, Value>> = Vec::new();
    for item in items {
        let Some(item) = item.as_object() else { continue };
        let field = txt(item.get("field"));
        let op = txt(item.get("op"));
        if !RULE_OPS.iter().any(|(o, _)| *o == op) || !field_ok(&field) {
            continue;
        }
        let value = if RULE_OPS_0.contains(&op.as_str()) { String::new() } else { take_chars(&txt(item.get("value")), VALUE_MAX) };
        let mut cond = Map::new();
        cond.insert("field".into(), json!(field));
        cond.insert("op".into(), json!(op));
        cond.insert("value".into(), json!(value));
        if RULE_OPS_2.contains(&op.as_str()) {
            cond.insert("value2".into(), json!(take_chars(&txt(item.get("value2")), VALUE_MAX)));
        }
        // 1つのセルの中の「または」。同じ列の前の条件があるときだけ
        if item.get("or") == Some(&Value::Bool(true)) && out.iter().any(|c| c["field"] == json!(field)) {
            cond.insert("or".into(), json!(true));
        }
        out.push(cond);
    }
    out.into_iter().map(Value::Object).collect()
}

/// 表の列（データ）の並び。受ける列だけ・重ねず・`COLS_MAX` まで。
pub fn normalize_cols(raw: &Value, field_ok: &dyn Fn(&str) -> bool) -> Vec<String> {
    let Some(items) = raw.as_array() else { return Vec::new() };
    let mut out: Vec<String> = Vec::new();
    for f in items {
        let f = txt(Some(f));
        if field_ok(&f) && !out.contains(&f) {
            out.push(f);
        }
    }
    out.truncate(COLS_MAX);
    out
}

/// 表の列の並び。**保存した並び**を先に、条件にあるのに並びに無い列を後ろへ足す。
pub fn table_cols(stored: &Value, rows: &Value, field_ok: &dyn Fn(&str) -> bool) -> Vec<String> {
    let mut cols = normalize_cols(stored, field_ok);
    for r in rows.as_array().map(Vec::as_slice).unwrap_or_default() {
        for c0 in r.get("conditions").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default() {
            if let Some(f) = c0.get("field").and_then(Value::as_str) {
                if !cols.iter().any(|c| c == f) {
                    cols.push(f.to_string());
                }
            }
        }
    }
    cols
}
