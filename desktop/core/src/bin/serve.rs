//! 開発と網のための HTTP の入口（§9.633・計画 §3.4）。**利用者の起動には使わない**（利用者は窓だけ・§9.548）。
//!
//! 窓と同じ答えを HTTP で返す: `/static/` はディスクから（`wavelog_core::statics`）、残りは業務の入口
//! （`Core::answer`）——ルートの表に載ったものは Rust、表に無いものは**内側の Python**（`program/app.py` を
//! `WAVELOG_HTTP_PORT` で別のポートに立てたもの）へそのまま渡す。JS の網はこの入口を叩けば、窓と同じ道を通る。
//!
//! 使い方: wavelog-serve --port 5029 --inner 5030 --static ../static [--log-dir ../tests/log]

use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use wavelog_core::{error_reply, statics::static_file, Ask, Backend, Core, Reply};

/// 同時に答える本数（窓口の sidecar.py の WORKERS と同じ）。
const WORKERS: usize = 16;
/// 長い問い合わせ（RNE の抽出・共有の書込サイクル）を待てる長さ（窓の ASK_WAIT と同じ）。
const ASK_WAIT: Duration = Duration::from_secs(600);

/// 内側の Python（HTTP）へ渡す係。
struct Inner {
    port: u16,
}

/// 渡さない見出し（この2つの間の HTTP の取り決め。本文の長さはこちらで付け直す）。
const HOP: &[&str] = &["connection", "keep-alive", "transfer-encoding", "content-length", "te", "upgrade", "proxy-connection"];

impl Backend for Inner {
    fn ask(&self, ask: &Ask) -> Reply {
        match self.forward(ask) {
            Ok(r) => r,
            Err(e) => error_reply(502, "backend_unavailable", &format!("内側の Python（127.0.0.1:{}）へ渡せません: {e}", self.port)),
        }
    }
}

impl Inner {
    fn forward(&self, ask: &Ask) -> std::io::Result<Reply> {
        let mut s = TcpStream::connect(("127.0.0.1", self.port))?;
        s.set_read_timeout(Some(ASK_WAIT))?;
        let target = if ask.query.is_empty() { ask.path.to_string() } else { format!("{}?{}", ask.path, ask.query) };
        let mut head = format!("{} {target} HTTP/1.1\r\n", ask.method);
        for (k, v) in &ask.headers {
            if !HOP.contains(&k.to_ascii_lowercase().as_str()) {
                head.push_str(&format!("{k}: {v}\r\n"));
            }
        }
        head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\n\r\n", ask.body.len()));
        s.write_all(head.as_bytes())?;
        s.write_all(ask.body)?;
        read_reply(BufReader::new(s))
    }
}

fn bad(why: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, why.to_string())
}

/// HTTP/1.1 の答えを読む（長さつき・chunked・閉じるまで の3つ）。
fn read_reply<R: BufRead>(mut r: R) -> std::io::Result<Reply> {
    let mut line = String::new();
    r.read_line(&mut line)?;
    let status: u16 = line.split_whitespace().nth(1).and_then(|s| s.parse().ok()).ok_or_else(|| bad("状態の行が読めません"))?;
    let mut headers = Vec::new();
    loop {
        line.clear();
        if r.read_line(&mut line)? == 0 {
            break;
        }
        let l = line.trim_end_matches(['\r', '\n']);
        if l.is_empty() {
            break;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    let get = |n: &str| headers.iter().find(|(k, _): &&(String, String)| k.eq_ignore_ascii_case(n)).map(|(_, v)| v.clone());
    let mut body = Vec::new();
    if get("Transfer-Encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
        loop {
            line.clear();
            r.read_line(&mut line)?;
            let n = usize::from_str_radix(line.trim().split(';').next().unwrap_or(""), 16).map_err(|_| bad("chunk の長さが読めません"))?;
            if n == 0 {
                break;
            }
            let mut buf = vec![0; n];
            r.read_exact(&mut buf)?;
            body.extend_from_slice(&buf);
            line.clear();
            r.read_line(&mut line)?;
        }
    } else if let Some(n) = get("Content-Length").and_then(|v| v.parse::<usize>().ok()) {
        body.resize(n, 0);
        r.read_exact(&mut body)?;
    } else {
        r.read_to_end(&mut body)?;
    }
    headers.retain(|(k, _)| !HOP.contains(&k.to_ascii_lowercase().as_str()));
    Ok(Reply { status, headers, body })
}

struct Args {
    port: u16,
    inner: u16,
    static_dir: PathBuf,
    log_dir: Option<PathBuf>,
}

fn args() -> Result<Args, String> {
    let mut a = Args { port: 5029, inner: 5030, static_dir: PathBuf::from("static"), log_dir: None };
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        let mut v = || it.next().ok_or(format!("{k} の値がありません"));
        match k.as_str() {
            "--port" => a.port = v()?.parse().map_err(|_| "--port は数")?,
            "--inner" => a.inner = v()?.parse().map_err(|_| "--inner は数")?,
            "--static" => a.static_dir = PathBuf::from(v()?),
            "--log-dir" => a.log_dir = Some(PathBuf::from(v()?)),
            _ => return Err(format!("知らない引数: {k}")),
        }
    }
    Ok(a)
}

fn answer(req: &mut tiny_http::Request, core: &Core, inner: &Inner, static_dir: &std::path::Path) -> (Reply, &'static str) {
    let method = req.method().as_str().to_string();
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    if let (true, Some(rest)) = (method == "GET" || method == "HEAD", path.strip_prefix("/static/")) {
        return (static_file(static_dir, rest, query), "shell");
    }
    let headers: Vec<(String, String)> =
        req.headers().iter().map(|h| (h.field.as_str().as_str().to_string(), h.value.as_str().to_string())).collect();
    let mut body = Vec::new();
    if let Err(e) = req.as_reader().read_to_end(&mut body) {
        return (error_reply(400, "bad_body", &format!("本文を読めません: {e}")), "shell");
    }
    let (r, by) = core.answer(&Ask { method: &method, path, query, headers, body: &body }, inner);
    (r, by.word())
}

fn main() {
    let a = match args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("wavelog-serve: {e}");
            std::process::exit(2);
        }
    };
    let server = match tiny_http::Server::http(("127.0.0.1", a.port)) {
        Ok(s) => Arc::new(s),
        Err(e) => {
            eprintln!("wavelog-serve: 127.0.0.1:{} を開けません: {e}", a.port);
            std::process::exit(1);
        }
    };
    let core = Arc::new(Core::new(a.log_dir));
    let inner = Arc::new(Inner { port: a.inner });
    let static_dir = Arc::new(a.static_dir);
    eprintln!("wavelog-serve: 127.0.0.1:{}（表に無いものは 127.0.0.1:{} の Python へ）", a.port, a.inner);
    let workers: Vec<_> = (0..WORKERS)
        .map(|_| {
            let (server, core, inner, static_dir) = (server.clone(), core.clone(), inner.clone(), static_dir.clone());
            std::thread::spawn(move || {
                while let Ok(mut req) = server.recv() {
                    let (r, by) = answer(&mut req, &core, &inner, &static_dir);
                    let mut resp = tiny_http::Response::from_data(r.body).with_status_code(r.status);
                    for (k, v) in r.headers.iter().chain([("X-WaveLog-By".to_string(), by.to_string())].iter()) {
                        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
                            resp.add_header(h);
                        }
                    }
                    let _ = req.respond(resp);
                }
            })
        })
        .collect();
    for w in workers {
        let _ = w.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_three_shapes() {
        let r = read_reply(&b"HTTP/1.1 201 CREATED\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"[..]).unwrap();
        assert_eq!((r.status, r.body.as_slice(), r.header("content-type")), (201, &b"{}"[..], Some("application/json")));
        assert_eq!(r.header("content-length"), None, "長さは付け直すので渡さない");
        let c = read_reply(&b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=1\r\nde\r\n0\r\n\r\n"[..]).unwrap();
        assert_eq!(c.body, b"abcde");
        let e = read_reply(&b"HTTP/1.0 404 NOT FOUND\r\nServer: x\r\n\r\n<html>"[..]).unwrap();
        assert_eq!((e.status, e.body.as_slice()), (404, &b"<html>"[..]));
        assert!(read_reply(&b"garbage"[..]).is_err());
    }
}
