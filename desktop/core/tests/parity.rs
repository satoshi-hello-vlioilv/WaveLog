//! 試験表（`tests/fixtures/parity/*.json`・§9.634）の問いに、Rust が Python と同じ答えを返すか。
//!
//! 表は Python が作る（`python3 tests/lib/parity_cases.py --write`）。**答えの正は Python**。1つでも違えば、
//! どの領域のどの問いで何が違ったかを全部並べて落ちる（最初の1件で止めない）。

use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use wavelog_core::formula::{self as fx, V};
use wavelog_core::pyish::Date;
use wavelog_core::{datetext, filter_sql, flags, num_expr, rule_cells, safe_regex, sort_order, textnorm};

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
        ("sort_order", _) => sort_call(fun, a)?,
        ("filter_sql", _) => filter_call(fun, a)?,
        ("formula", _) => formula_call(fun, a)?,
        _ => return Err(format!("Rust に {area}.{fun} がありません")),
    })
}

fn strs(v: &Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn arr(v: &Value) -> Vec<Value> {
    v.as_array().cloned().unwrap_or_default()
}

fn obj(v: &Value) -> serde_json::Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}

fn exprs(v: &Value) -> BTreeMap<String, String> {
    obj(v).into_iter().map(|(k, x)| (k, x.as_str().unwrap_or("").to_string())).collect()
}

fn day(v: &Value) -> Result<Date, String> {
    Date::parse_iso(v.as_str().unwrap_or("")).ok_or_else(|| format!("日付でない: {v}"))
}

fn sort_call(fun: &str, a: &[Value]) -> Result<Value, String> {
    use sort_order as so;
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Value::Null);
    let spec = |i: usize| so::Spec::of(&arg(i));
    Ok(match fun {
        "num_of" => json!(so::num_of(&arg(0))),
        "date_key" => json!(so::date_key(&arg(0))),
        "classify" => json!(so::classify(&arg(0))),
        "natural_key" => json!(so::natural_key(&arg(0))),
        "normalize_spec" => so::normalize_spec(&arg(0)).map_or(Value::Null, |s| s.to_value()),
        "spec_json" => json!(so::spec_json(&arg(0))),
        "describe" => json!(so::describe(&arg(0))),
        "value_key" => {
            let k = so::value_key(&spec(0), &arg(1));
            json!([k.0, k.1, k.2])
        }
        "bucket_rank" => json!(so::bucket_rank(&spec(0), &arg(1))),
        "format_value" => json!(so::format_value(&arg(0), &arg(1))),
        "rule_test" => json!(so::rule_test(&arg(0), &obj(&arg(1)), arg(2).as_str().unwrap_or(""))),
        "rule_match" => so::rule_match(&arr(&arg(0)), &obj(&arg(1)), arg(2).as_str().unwrap_or("")).cloned().unwrap_or(Value::Null),
        "rules_need_formula" => json!(so::rules_need_formula(&arr(&arg(0)))),
        "rule_leaves" => json!(so::rule_leaves(&arr(&arg(0)))),
        "display_text" => json!(so::display_text(&arg(0), &arg(1), &arr(&arg(2)), &obj(&arg(3)), arg(4).as_str().unwrap_or(""))),
        "order_rows" => {
            let rows = arr(&arg(0));
            let col = |r: &Value, k: &Value| r.get(k["col"].as_str().unwrap_or("")).cloned().unwrap_or(Value::Null);
            json!(so::order_rows(&rows, &arr(&arg(1)), &col).iter().map(|r| r["id"].clone()).collect::<Vec<_>>())
        }
        _ => return Err(format!("Rust に sort_order.{fun} がありません")),
    })
}

fn filter_call(fun: &str, a: &[Value]) -> Result<Value, String> {
    use filter_sql as fs;
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Value::Null);
    Ok(match fun {
        "safe_filters" => json!(fs::safe_filters(&arg(0), &strs(&arg(1)), &strs(&arg(2)))),
        "build_filter_where" => {
            let (p, q) = fs::build_filter_where(&arr(&arg(0)), day(&arg(1))?, &exprs(&arg(2)));
            json!([p, q])
        }
        "cutoff_date" => json!(fs::cutoff_date(arg(0).as_str().unwrap_or(""), &arg(1), day(&arg(2))?)),
        "date_range" => {
            let (lo, hi) = fs::date_range(&arg(0));
            json!([lo, hi])
        }
        "slice_key" => json!(fs::slice_key(arg(0).as_str().unwrap_or(""), arg(1).as_str().unwrap_or(""))),
        "search_filter_where" => {
            let (p, q) = fs::search_filter_where(&strs(&arg(0)), &arg(1), &arg(2), day(&arg(3))?, &exprs(&arg(4)));
            json!([p, q])
        }
        "ignored_filter_columns" => json!(fs::ignored_filter_columns(&arg(0), &strs(&arg(1)), &strs(&arg(2)))),
        _ => return Err(format!("Rust に filter_sql.{fun} がありません")),
    })
}

fn formula_call(fun: &str, a: &[Value]) -> Result<Value, String> {
    let arg = |i: usize| a.get(i).cloned().unwrap_or(Value::Null);
    let calc = || {
        let p = |a: &str, b: &str| (a.to_string(), b.to_string());
        let formulas = [
            p("区分", "if([板厚(表示)] > 1, '厚', '薄')"),
            p("倍", "[重量] * 2"),
            p("倍の倍", "[倍] * 2"),
            p("重量", "[重量] + 1"),
            p("自分", "[自分]"),
            p("壊れ", "[A"),
        ];
        fx::CalcColumns::new(&formulas, &[p("板厚", "板厚(表示)")], &["板厚".to_string(), "重量".to_string()])
    };
    Ok(match fun {
        "answer" => {
            let expr = arg(0).as_str().unwrap_or("").to_string();
            let chk = fx::check(&expr);
            if chk["ok"] != json!(true) {
                return Ok(json!({"ok": false, "error": chk["error"]}));
            }
            let row = obj(&arg(1));
            let f = fx::Formula::new(&expr).map_err(|e| format!("{e:?}"))?;
            let v = f.run(&|c: &str| row.get(c).map_or(V::Null, V::from_json));
            let text = fx::u16_json(&fx::text_of(&v));
            match v {
                V::Num(x) if !x.is_finite() => json!({"ok": true, "value": format!("#{}", fx::js_num_text(x)), "text": text}),
                other => json!({"ok": true, "value": other.to_json(), "text": text}),
            }
        }
        "calc_columns" => {
            let c = calc();
            json!({"calcs": c.calcs, "broken": c.compiled.iter().filter(|(_, f)| f.is_none()).map(|(k, _)| k.clone()).collect::<Vec<_>>()})
        }
        "calc_run" => {
            let c = calc();
            let name = arg(0).as_str().unwrap_or("").to_string();
            if c.broken(&name) {
                json!({"broken": true})
            } else {
                let vals: Vec<V> = arr(&arg(1)).iter().map(V::from_json).collect();
                json!({"deps": c.raw_deps(&name), "value": c.run(&name, &vals).to_json()})
            }
        }
        "sql_value" => fx::sql_value(&V::from_json(&arg(0))).to_json(),
        "clean_calc" => fx::clean_calc(&arg(0)).unwrap_or(Value::Null),
        "check" => fx::check(arg(0).as_str().unwrap_or("")),
        _ => return Err(format!("Rust に formula.{fun} がありません")),
    })
}

/// 式の答えの比べ方（画面との突き合わせ `test_formulaparity.same` と同じ: 壊れた正規表現の理由は前半だけ・数は実数で）。
fn same_answer(got: &Value, want: &Value) -> bool {
    if got == want {
        return true;
    }
    if got["ok"] != want["ok"] {
        return false;
    }
    if want["ok"] == json!(false) {
        let head = "の正規表現として読めません: ";
        let (g, w) = (got["error"].as_str().unwrap_or(""), want["error"].as_str().unwrap_or(""));
        return g.contains(head) && w.contains(head) && g.split(head).next() == w.split(head).next();
    }
    match (got["value"].as_f64(), want["value"].as_f64()) {
        (Some(x), Some(y)) => x == y && got["text"] == want["text"],
        _ => false,
    }
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
                Ok(got) if &got == want || (area == "formula" && fun == "answer" && same_answer(&got, want)) => {}
                Ok(got) => bad.push(format!("{area}.{fun}({}) → Rust {got} / Python {want}", Value::Array(args))),
                Err(e) => bad.push(e),
            }
        }
    }
    assert!(bad.is_empty(), "{} / {n} 問が Python と違う:\n{}", bad.len(), bad.join("\n"));
    eprintln!("試験表 {n} 問・{} 領域が Python と同じ", files.len());
}
