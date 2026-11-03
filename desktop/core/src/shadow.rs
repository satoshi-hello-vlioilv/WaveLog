//! 影の比較（§9.633・計画 §3.3）——同じ問い合わせへの Python の答えと Rust の答えを比べ、違いだけ残す。
//! **不一致が 0件になってから表で Serve に切り替える**（物差しの1つ）。
//!
//! 比べ方は [`compare`] の1箇所: 状態コード → Content-Type → 本文（両方 JSON なら値として＝鍵の順は見ない・
//! 数の 1 と 1.0 は違う物として扱う。Python は `1.0` と書き、画面は字のまま見せる所がある）。

use crate::routes::Route;
use crate::{Ask, Reply};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// 違いの記録のファイルの上限（越えたら数えるだけにする。網や長い運用で積み上がらない）。
const LOG_MAX: u64 = 5 << 20;
/// 1件の違いの説明の長さの上限。
const DIFF_MAX: usize = 2000;

/// 2つの答えを比べる。同じなら `None`、違えば最初の違いの場所と中身。
pub fn compare(py: &Reply, rs: &Reply) -> Option<String> {
    if py.status != rs.status {
        return Some(format!("状態コード: Python {} / Rust {}", py.status, rs.status));
    }
    let ct = |r: &Reply| r.header("Content-Type").unwrap_or("").split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if ct(py) != ct(rs) {
        return Some(format!("Content-Type: Python {} / Rust {}", ct(py), ct(rs)));
    }
    match (serde_json::from_slice::<Value>(&py.body), serde_json::from_slice::<Value>(&rs.body)) {
        (Ok(a), Ok(b)) => diff_value("$", &a, &b),
        _ if py.body == rs.body => None,
        _ => Some(format!("本文（{} バイト / {} バイト）が違う", py.body.len(), rs.body.len())),
    }
}

fn diff_value(at: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => diff_map(at, x, y),
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Some(format!("{at}: 長さ Python {} / Rust {}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().find_map(|(i, (p, q))| diff_value(&format!("{at}[{i}]"), p, q))
        }
        // 数は字として比べる（1 と 1.0 を同じにしない）
        (Value::Number(p), Value::Number(q)) if p.to_string() == q.to_string() => None,
        _ if a == b => None,
        _ => Some(format!("{at}: Python {} / Rust {}", short(a), short(b))),
    }
}

fn diff_map(at: &str, x: &Map<String, Value>, y: &Map<String, Value>) -> Option<String> {
    let only = |p: &Map<String, Value>, q: &Map<String, Value>| p.keys().filter(|k| !q.contains_key(*k)).cloned().collect::<Vec<_>>();
    let (lack, extra) = (only(x, y), only(y, x));
    if !lack.is_empty() || !extra.is_empty() {
        return Some(format!("{at}: 鍵が Rust に無い {lack:?}・Rust にだけある {extra:?}"));
    }
    x.iter().find_map(|(k, v)| diff_value(&format!("{at}.{k}"), v, &y[k]))
}

fn short(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 200 {
        format!("{}…", s.chars().take(200).collect::<String>())
    } else {
        s
    }
}

/// 影の数と違いの記録。
pub struct ShadowLog {
    path: Option<PathBuf>,
    counts: Mutex<BTreeMap<String, (u64, u64)>>,
}

impl ShadowLog {
    pub fn new(path: Option<PathBuf>) -> ShadowLog {
        ShadowLog { path, counts: Mutex::default() }
    }

    pub fn record(&self, route: &Route, ask: &Ask, py: &Reply, rs: &Reply) {
        let key = format!("{} {}", route.method, route.path);
        let diff = compare(py, rs);
        {
            let mut c = self.counts.lock().unwrap_or_else(|e| e.into_inner());
            let e = c.entry(key.clone()).or_default();
            if diff.is_some() {
                e.1 += 1;
            } else {
                e.0 += 1;
            }
        }
        let (Some(diff), Some(path)) = (diff, &self.path) else { return };
        if std::fs::metadata(path).map(|m| m.len()).unwrap_or(0) > LOG_MAX {
            return;
        }
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let mut diff = diff;
        if diff.len() > DIFF_MAX {
            let cut = (0..=DIFF_MAX).rev().find(|i| diff.is_char_boundary(*i)).unwrap_or(0);
            diff.truncate(cut);
        }
        let line = json!({"t": t, "route": key, "path": ask.path, "query": ask.query, "diff": diff});
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(f, "{line}");
        }
    }

    /// ルートごとの {same, diff}。
    pub fn counts(&self) -> Value {
        let c = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        Value::Object(c.iter().map(|(k, (s, d))| (k.clone(), json!({"same": s, "diff": d}))).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn j(v: Value) -> Reply {
        Reply::json(200, &v)
    }

    #[test]
    fn what_counts_as_the_same() {
        assert_eq!(compare(&j(json!({"a": 1, "b": "x"})), &j(json!({"b": "x", "a": 1}))), None, "鍵の順は見ない");
        assert!(compare(&j(json!({"a": 1})), &j(json!({"a": 1.0}))).unwrap().contains("$.a"), "1 と 1.0 は違う");
        assert!(compare(&j(json!({"a": [1, 2]})), &j(json!({"a": [1]}))).unwrap().contains("長さ"));
        assert!(compare(&j(json!({"a": 1})), &j(json!({"a": 1, "z": 0}))).unwrap().contains("Rust にだけある"));
        let mut e = j(json!({}));
        e.status = 404;
        assert!(compare(&j(json!({})), &e).unwrap().contains("状態コード"));
        let text =
            |b: &str| Reply { status: 200, headers: vec![("content-type".into(), "text/html; charset=utf-8".into())], body: b.into() };
        assert_eq!(compare(&text("<p>"), &text("<p>")), None);
        assert!(compare(&text("<p>"), &text("<b>")).is_some());
        assert!(compare(&text("{}"), &j(json!({}))).unwrap().contains("Content-Type"));
    }

    #[test]
    fn writes_only_the_differences() {
        fn h(_: &Ask) -> Reply {
            Reply::json(200, &json!({}))
        }
        let dir = std::env::temp_dir().join(format!("wl-shadow-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let log = ShadowLog::new(Some(dir.join("shadow.jsonl")));
        let r = Route { method: "GET", path: "/api/x", mode: crate::routes::Mode::Shadow, handler: h };
        let ask = Ask { method: "GET", path: "/api/x", query: "q=1", headers: vec![], body: b"" };
        log.record(&r, &ask, &j(json!({"a": 1})), &j(json!({"a": 1})));
        assert!(!dir.join("shadow.jsonl").exists(), "同じなら書かない");
        log.record(&r, &ask, &j(json!({"a": 1})), &j(json!({"a": "1"})));
        let text = std::fs::read_to_string(dir.join("shadow.jsonl")).unwrap();
        let line: Value = serde_json::from_str(text.trim()).unwrap();
        assert_eq!((line["route"].as_str(), line["query"].as_str()), (Some("GET /api/x"), Some("q=1")));
        assert_eq!(log.counts()["GET /api/x"], json!({"same": 1, "diff": 1}));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
