//! 名前の表記ゆれを吸収する（`backend/textnorm.py` の写し・§9.634）。**設備の同一判定はアプリ全体で1つ**（§9.239 ⑥）。

use crate::pyish::{py_str_or_empty, py_strip};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

/// 設備名を比べる形（NFKC → 前後の空白を除く → 大文字）。
pub fn normalize_equipment_name(value: &Value) -> String {
    let s: String = py_str_or_empty(value).nfkc().collect();
    py_strip(&s).to_uppercase()
}

/// 探すときの字の畳み方（全角・半角、大文字・小文字を同じに見る）。**探す側と探される側の両方**に当てる。
pub fn search_fold(value: &Value) -> String {
    let s: String = py_str_or_empty(value).nfkc().collect();
    caseless::default_case_fold_str(&s)
}
