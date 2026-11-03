//! WaveLog の業務を Python から Rust へ移す先（計画は docs/RUST_MIGRATION_PLAN.md、土台は §9.633）。
//!
//! **窓（Tauri）も Windows も知らない**——Linux で `cargo test` が全部回る。窓（`desktop/src`）と、開発と網のための
//! HTTP の入口（`bin/serve.rs`）の両方が、同じ [`Core::answer`] を通して答える（入口で答えが変わらない）。
//!
//! 問い合わせの流れ（1箇所＝[`Core::answer`]）:
//!   1. ルートの表（[`routes::ROUTES`]）で「Rust が答える」ルート … Rust が答える
//!   2. 「影」のルート … Python が答え、Rust も同じ問い合わせに答えて違いを記録する（[`shadow`]）
//!   3. それ以外 … Python（窓では子の sidecar.py、HTTP の入口では内側の app.py）
//!
//! 移し終えたルートは表へ1行足し、Python の側を消す（同じ役目を2つ持たない）。

pub mod routes;
pub mod shadow;
pub mod statics;

use serde_json::{json, Value};
use std::path::PathBuf;

/// 答え（HTTP の答えと同じ中身）。
#[derive(Debug, Clone, PartialEq)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    /// JSON の答え（Python の `jsonify` と同じ Content-Type）。
    pub fn json(status: u16, v: &Value) -> Reply {
        Reply { status, headers: vec![("Content-Type".into(), "application/json".into())], body: serde_json::to_vec(v).unwrap_or_default() }
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// 問い合わせ（窓・HTTP の入口が受けた問い合わせを、そのまま渡す形）。
pub struct Ask<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: Vec<(String, String)>,
    pub body: &'a [u8],
}

/// 表に無い問い合わせを答える係（いまは Python）。窓は子の sidecar.py、HTTP の入口は内側の app.py。
pub trait Backend: Send + Sync {
    fn ask(&self, ask: &Ask) -> Reply;
}

/// 誤りの答え（画面の `api()` が読む形 `{"error", "kind"}`）。
pub fn error_reply(status: u16, kind: &str, message: &str) -> Reply {
    Reply::json(status, &json!({"error": message, "kind": kind}))
}

/// 誰が答えたか（`X-WaveLog-By` の字。自己診断・網・不具合の切り分けに使う）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum By {
    Rust,
    Python,
}

impl By {
    pub fn word(self) -> &'static str {
        match self {
            By::Rust => "rust",
            By::Python => "python",
        }
    }
}

/// 移行の状態を答える道（物差しの口・`tests/rust_progress.py` と網が読む）。
pub const STATUS_PATH: &str = "/__rust/status";

/// 業務の入口。ルートの表と影の記録を持つ。
pub struct Core {
    pub table: &'static [routes::Route],
    pub shadow: shadow::ShadowLog,
}

impl Core {
    /// 本番の表で作る。影の違いは `log_dir/shadow.jsonl` へ（`None` なら数えるだけ）。
    pub fn new(log_dir: Option<PathBuf>) -> Core {
        Core { table: routes::ROUTES, shadow: shadow::ShadowLog::new(log_dir.map(|d| d.join("shadow.jsonl"))) }
    }

    /// 1つの問い合わせに答える（答えを決めるのはここの1箇所）。
    pub fn answer<B: Backend + ?Sized>(&self, ask: &Ask, fallback: &B) -> (Reply, By) {
        if ask.method == "GET" && ask.path == STATUS_PATH {
            return (Reply::json(200, &self.status()), By::Rust);
        }
        match routes::find(self.table, ask.method, ask.path) {
            Some(r) if r.mode == routes::Mode::Serve => (routes::run(r, ask), By::Rust),
            Some(r) => {
                let py = fallback.ask(ask);
                let rs = routes::run(r, ask);
                self.shadow.record(r, ask, &py, &rs);
                (py, By::Python)
            }
            None => (fallback.ask(ask), By::Python),
        }
    }

    /// 移行の状態（表の顔ぶれ・Rust が書き手の事実・影の数）。
    pub fn status(&self) -> Value {
        let routes: Vec<Value> = self.table.iter().map(|r| json!({"method": r.method, "path": r.path, "mode": r.mode.word()})).collect();
        json!({
            "routes": routes,
            "serve": self.table.iter().filter(|r| r.mode == routes::Mode::Serve).count(),
            "shadow": self.shadow.counts(),
            "owns": routes::OWNS,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Py(AtomicUsize, Reply);
    impl Backend for Py {
        fn ask(&self, _: &Ask) -> Reply {
            self.0.fetch_add(1, Ordering::SeqCst);
            self.1.clone()
        }
    }

    fn ask<'a>(method: &'a str, path: &'a str) -> Ask<'a> {
        Ask { method, path, query: "", headers: vec![], body: b"" }
    }

    fn hello(_: &Ask) -> Reply {
        Reply::json(200, &json!({"a": 1, "b": [1, 2]}))
    }
    fn boom(_: &Ask) -> Reply {
        panic!("試しに止まる")
    }

    static TABLE: &[routes::Route] = &[
        routes::Route { method: "GET", path: "/api/rs", mode: routes::Mode::Serve, handler: hello },
        routes::Route { method: "GET", path: "/api/shadow/{id}", mode: routes::Mode::Shadow, handler: hello },
        routes::Route { method: "GET", path: "/api/boom", mode: routes::Mode::Serve, handler: boom },
    ];

    fn core() -> Core {
        Core { table: TABLE, shadow: shadow::ShadowLog::new(None) }
    }

    #[test]
    fn each_kind_goes_to_its_place() {
        let c = core();
        let py = Py(AtomicUsize::new(0), Reply::json(200, &json!({"b": [1, 2], "a": 1})));
        let (r, by) = c.answer(&ask("GET", "/api/rs"), &py);
        assert_eq!((by, r.status, py.0.load(Ordering::SeqCst)), (By::Rust, 200, 0), "表で Rust のルートは Python を呼ばない");
        let (_, by) = c.answer(&ask("POST", "/api/rs"), &py);
        assert_eq!(by, By::Python, "メソッドが違えば表に無い");
        let (_, by) = c.answer(&ask("GET", "/api/none"), &py);
        assert_eq!(by, By::Python);
        let (r, by) = c.answer(&ask("GET", "/api/shadow/7"), &py);
        assert_eq!((by, r.body.clone()), (By::Python, py.1.body.clone()), "影は Python の答えを返す");
        assert_eq!(c.shadow.counts()["GET /api/shadow/{id}"], json!({"same": 1, "diff": 0}), "鍵の順だけ違う JSON は同じ");
    }

    #[test]
    fn a_panic_becomes_500_not_a_crash() {
        let c = core();
        let py = Py(AtomicUsize::new(0), Reply::json(200, &json!({})));
        let (r, by) = c.answer(&ask("GET", "/api/boom"), &py);
        assert_eq!((r.status, by), (500, By::Rust), "Rust の中で止まっても窓は落ちず 500 で返す");
        assert!(String::from_utf8_lossy(&r.body).contains("rust_panic"));
    }

    #[test]
    fn status_says_the_table() {
        let c = core();
        let py = Py(AtomicUsize::new(0), Reply::json(200, &json!({})));
        let (r, by) = c.answer(&ask("GET", STATUS_PATH), &py);
        let v: Value = serde_json::from_slice(&r.body).unwrap();
        assert_eq!((by, v["serve"].as_u64(), v["routes"].as_array().map(Vec::len)), (By::Rust, Some(2), Some(3)));
    }

    #[test]
    fn production_table_is_sound() {
        routes::check(routes::ROUTES).unwrap();
    }
}
