//! 画面から来る「入/切」を真偽へ直す（`backend/flags.py` の写し・§9.634）。**切の語彙は`OFF_WORDS`の1つ**。

use crate::pyish::{py_strip, truthy};
use serde_json::{Map, Value};

/// 画面が出しうる「切」の呼び名（`flags.OFF_WORDS` と同じ顔ぶれ・同じ順）。
pub const OFF_WORDS: &[&str] = &["無効", "出さない", "登録しない", "しない", "できない", "載せない", "false", "0", ""];

/// 呼び名／真偽値／数を真偽へ。`None` は `None` のまま（「送っていない」）。
pub fn flag_of(v: &Value, off: &[&str]) -> Option<bool> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(!off.contains(&py_strip(s))),
        other => Some(truthy(other)),
    }
}

/// `<key>Text`（呼び名）が来ていればそれ、無ければ `<key>`。
pub fn text_or(x: &Map<String, Value>, key: &str) -> Value {
    match x.get(&format!("{key}Text")) {
        Some(t) if !t.is_null() => t.clone(),
        _ => x.get(key).cloned().unwrap_or(Value::Null),
    }
}
