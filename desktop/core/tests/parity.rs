//! 試験表（`tests/fixtures/parity/*.json`・§9.634）の問いに、Rust が Python と同じ答えを返すか。
//!
//! 表は Python が作る（`python3 tests/lib/parity_cases.py --write`）。**答えの正は Python**。1つでも違えば、
//! どの領域のどの問いで何が違ったかを全部並べて落ちる（最初の1件で止めない）。

use serde_json::{json, Value};
use std::path::PathBuf;
use wavelog_core::{datetext, flags, num_expr, rule_cells, safe_regex, textnorm};

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/parity")
}

/// 有限でない数は Python の表と同じく `{"$float": "inf"}` の形で比べる。
fn float(f: f64) -> Value {
    if f.is_nan() {
        json!({"$float": "nan"})
    } else if f.is_infinite() {
        json!({"$float": if f > 0.0 { "inf" } else { "-inf" }})
    } else {
        json!(f)
    }
}

/// 試験の列の見分け（Python の表の `_field_ok` と同じ）。
fn field_ok(f: &str) -> bool {
    ["板厚", "材質", "幅"].contains(&f) || rule_cells::prefixed_field(&json!(f), "source.")
}

fn call(area: &str, fun: &str, a: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Value::Null);
    Ok(match (area, fun) {
        ("textnorm", "normalize_equipment_name") => json!(textnorm::normalize_equipment_name(&arg(0))),
        ("textnorm", "search_fold") => json!(textnorm::search_fold(&arg(0))),
        ("flags", "flag_of") => json!(flags::flag_of(&arg(0), flags::OFF_WORDS)),
        ("flags", "text_or") => flags::text_or(arg(0).as_object().ok_or("辞書でない")?, arg(1).as_str().unwrap_or("")),
        ("datetext", "sort_key") => match datetext::sort_key(&arg(0)) {
            datetext::SortKey::Empty => Value::Null,
            datetext::SortKey::Num(f) => float(f),
            datetext::SortKey::Same(v) => v,
            datetext::SortKey::Text(s) => json!(s),
        },
        ("datetext", "to_date") => json!(datetext::to_date(&arg(0))),
        ("datetext", "to_minutes") => json!(datetext::to_minutes(&arg(0)).map(|(h, m, s)| vec![h, m, s])),
        ("datetext", "to_datetime") => json!(datetext::to_datetime(&arg(0), &arg(1))),
        ("safe_regex", "risk") => json!(safe_regex::risk(arg(0).as_str().unwrap_or(""))),
        ("num_expr", "compile_expr") => {
            let (f, msg, text) = num_expr::compile_expr(&arg(0));
            let outs = f.map(|f| {
                arg(1)
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|x| f.apply(x.as_f64().unwrap_or(f64::NAN)).map_or(Value::Null, float))
                    .collect::<Vec<_>>()
            });
            json!([outs, msg, text])
        }
        ("rule_cells", "prefixed_field") => json!(rule_cells::prefixed_field(&arg(0), arg(1).as_str().unwrap_or(""))),
        ("rule_cells", "normalize_conditions") => json!(rule_cells::normalize_conditions(&arg(0), &field_ok)),
        ("rule_cells", "normalize_cols") => json!(rule_cells::normalize_cols(&arg(0), &field_ok)),
        ("rule_cells", "table_cols") => json!(rule_cells::table_cols(&arg(0), &arg(1), &field_ok)),
        _ => return Err(format!("Rust に {area}.{fun} がありません")),
    })
}

#[test]
fn every_case_matches_python() {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir()).expect("試験表の置き場").filter_map(|e| e.ok().map(|e| e.path())).collect();
    files.retain(|p| p.extension().is_some_and(|x| x == "json"));
    files.sort();
    assert!(!files.is_empty(), "試験表が1つも無い");
    let (mut n, mut bad) = (0, Vec::new());
    for p in &files {
        let area = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let cases: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(p).expect("読める")).expect("JSON");
        for c in cases {
            n += 1;
            let (fun, args, want) = (c["fn"].as_str().unwrap_or(""), c["args"].as_array().cloned().unwrap_or_default(), &c["want"]);
            match call(&area, fun, &args) {
                Ok(got) if &got == want => {}
                Ok(got) => bad.push(format!("{area}.{fun}({}) → Rust {got} / Python {want}", Value::Array(args))),
                Err(e) => bad.push(e),
            }
        }
    }
    assert!(bad.is_empty(), "{} / {n} 問が Python と違う:\n{}", bad.len(), bad.join("\n"));
    eprintln!("試験表 {n} 問・{} 領域が Python と同じ", files.len());
}
