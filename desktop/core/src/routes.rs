//! ルートの表——どのルートを Rust が答えるか（§9.633）。**答えはこの表の1箇所**。
//!
//! - [`Mode::Serve`]  … Rust が答える。Python の側の同じルートは消してある（`tests/test_rustplan.py` が見張る）
//! - [`Mode::Shadow`] … Python が答え、Rust も答えて違いを記録する（切り替える前の確かめ）。**読むだけのルート**に限る
//!   （書くルートを2回走らせると2回書く。書くルートは一時の置き場で両方に流して DB の指紋を比べる・計画 §3.3）
//!
//! 道の `{名前}` は「1つの区切りなら何でも」（Flask の `<int:id>` 等に当たる）。

use crate::{error_reply, Ask, Reply};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Serve,
    Shadow,
}

impl Mode {
    pub fn word(self) -> &'static str {
        match self {
            Mode::Serve => "serve",
            Mode::Shadow => "shadow",
        }
    }
}

pub type Handler = fn(&Ask) -> Reply;

pub struct Route {
    pub method: &'static str,
    pub path: &'static str,
    pub mode: Mode,
    pub handler: Handler,
}

/// 本番の表。**P0 では 0本**（土台だけ・計画 §4）。移したら1行足す。
pub static ROUTES: &[Route] = &[];

/// 書き手を Rust へ移した事実（SQLite の表・ファイル）。**1つの事実の書き手は1言語**（`data.md`）——
/// ここに載せた物を Python が書いていたら `tests/test_rustplan.py` が落ちる。P0 では空。
pub const OWNS: &[&str] = &[];

/// 表から1本引く（メソッドと道の区切りが全部合うもの）。
pub fn find<'t>(table: &'t [Route], method: &str, path: &str) -> Option<&'t Route> {
    table.iter().find(|r| r.method == method && matches(r.path, path))
}

fn matches(pattern: &str, path: &str) -> bool {
    let (mut p, mut q) = (pattern.split('/'), path.split('/'));
    loop {
        match (p.next(), q.next()) {
            (None, None) => return true,
            (Some(a), Some(b)) if a.starts_with('{') && a.ends_with('}') => {
                if b.is_empty() {
                    return false;
                }
            }
            (Some(a), Some(b)) if a == b => {}
            _ => return false,
        }
    }
}

/// 1本を走らせる。**途中で止まっても窓ごと落とさない**（500 の答えにする）。
pub fn run(route: &Route, ask: &Ask) -> Reply {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (route.handler)(ask))) {
        Ok(r) => r,
        Err(e) => {
            let why = e.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| e.downcast_ref::<String>().cloned()).unwrap_or_default();
            error_reply(500, "rust_panic", &format!("アプリの中身（Rust）が {} {} の途中で止まりました: {why}", route.method, route.path))
        }
    }
}

/// 表の決まり（重ならない・影は読むだけ・道の形）。網と `cargo test` が見る。
pub fn check(table: &[Route]) -> Result<(), String> {
    for (i, r) in table.iter().enumerate() {
        if !r.path.starts_with('/') {
            return Err(format!("道は / で始める: {}", r.path));
        }
        if !matches!(r.method, "GET" | "POST" | "PUT" | "DELETE" | "PATCH") {
            return Err(format!("知らないメソッド: {} {}", r.method, r.path));
        }
        if r.mode == Mode::Shadow && r.method != "GET" {
            return Err(format!("影は読むだけのルート（GET）に限る: {} {}", r.method, r.path));
        }
        if table[..i].iter().any(|o| o.method == r.method && o.path == r.path) {
            return Err(format!("同じルートが2行: {} {}", r.method, r.path));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments() {
        assert!(matches("/api/a/{id}", "/api/a/12"));
        assert!(!matches("/api/a/{id}", "/api/a/"), "空の区切りは当たらない");
        assert!(!matches("/api/a/{id}", "/api/a/1/2"));
        assert!(!matches("/api/a", "/api/a/"));
        assert!(matches("/", "/"));
    }

    fn h(_: &Ask) -> Reply {
        Reply::json(200, &serde_json::json!({}))
    }

    #[test]
    fn rules_of_the_table() {
        let bad_shadow = [Route { method: "POST", path: "/api/x", mode: Mode::Shadow, handler: h }];
        assert!(check(&bad_shadow).unwrap_err().contains("影は読むだけ"));
        let dup = [
            Route { method: "GET", path: "/api/x", mode: Mode::Serve, handler: h },
            Route { method: "GET", path: "/api/x", mode: Mode::Shadow, handler: h },
        ];
        assert!(check(&dup).unwrap_err().contains("2行"));
        assert!(check(&[Route { method: "GET", path: "api/x", mode: Mode::Serve, handler: h }]).is_err());
    }
}
