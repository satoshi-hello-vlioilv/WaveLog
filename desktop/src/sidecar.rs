//! アプリの中身（Python・program/sidecar.py・§9.544）を子プロセスで起こし、パイプの枠で問い合わせる。**ポートは使わない**。
//!
//! - 問い合わせごとに番号（id）を付けて送り、答えは読み手の糸が番号で持ち主へ返す（長い問い合わせが短いものを待たせない）
//! - 窓が終わればこの値が捨てられ、標準入力が閉じる → Python は入力の終わりを見て自分で終わる
//!   （親が強制終了されてもパイプは OS が閉じるので、子は残らない）
//! - 子が途中で止まったら、待っている問い合わせへ失敗を返し、Supervisor が次の問い合わせで起こし直す
//! - 枠の約束の版（`protocol`）が窓と違えば起こさない（exe は手元へ写し、Python は共有から読むので、更新で版がずれうる）

use crate::frame::{read_frame, write_frame};
use crate::locate::Python;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// 答え（HTTP の答えと同じ中身）。
#[derive(Debug, Clone)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// 問い合わせ（窓が受けた HTTP の問い合わせを、そのまま渡す形）。
pub struct Ask<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: &'a str,
    pub headers: Vec<(String, String)>,
    pub body: &'a [u8],
}

/// 枠の約束の版。program/sidecar.py の PROTOCOL と同じ数（枠の形を変えたら両方を1つ上げる）。
pub const PROTOCOL: u64 = 1;
/// 片付け（書込役・編集セッション・在席）に Python が使う持ち時間は3秒（watchdog.TEARDOWN_BUDGET_SEC）。
/// 入力を閉じてからこれだけ待ち、終わらなければ止める（片付けの途中で止めない）。
const STOP_WAIT: Duration = Duration::from_millis(5000);

/// 起動の途中の知らせ（起動前の確認の進み具合）を受ける係。
pub type Progress = Arc<dyn Fn(&Value) + Send + Sync>;

pub struct Sidecar {
    /// 書き口。終わるときに先に閉じる（閉じれば Python は入力の終わりを見て自分で終わる）
    stdin: Mutex<Option<BufWriter<ChildStdin>>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>,
    next: AtomicU64,
    alive: Arc<AtomicBool>,
    child: Mutex<Child>,
    /// 準備できたときの知らせ（版・指紋・Python の場所・起動にかかった秒）
    pub ready: Value,
}

impl Sidecar {
    /// 起こして「準備できた」を待つ。起動できない理由（Python の誤り）はそのまま返す。
    pub fn spawn(py: &Python, program: &Path, log_dir: &Path, wait: Duration, progress: &Progress) -> Result<Sidecar, String> {
        std::fs::create_dir_all(log_dir).ok();
        let err_log = log_dir.join("sidecar_stderr.log");
        let stderr = std::fs::File::create(&err_log).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
        let mut cmd = Command::new(&py.exe);
        cmd.args(&py.args)
            .arg("-X")
            .arg("utf8")
            .arg(program.join("sidecar.py"))
            .current_dir(program)
            .env("PYTHONIOENCODING", "utf-8")
            .env("WAVELOG_SHELL", "desktop")
            // 窓が何から作られたか・どこで動いているか（§9.552。答えは backend/desktop_shell.py の1箇所）
            .env("WAVELOG_SHELL_COMMIT", env!("WAVELOG_BUILD_COMMIT"))
            .env("WAVELOG_SHELL_EXE", std::env::current_exe().unwrap_or_default())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn().map_err(|e| format!("Python を起動できません（{}）: {e}", py.exe.display()))?;
        let stdin = child.stdin.take().ok_or("標準入力を開けません")?;
        let mut out = BufReader::with_capacity(1 << 16, child.stdout.take().ok_or("標準出力を開けません")?);

        // 「準備できた」か「起動できない」まで読む。その前の「起動前の確認」の進み具合は起動画面へ流す。
        // 待つのは**知らせが途切れてから** wait まで（部品の導入は長くかかるが、進んでいる間は待つ）
        let (tx, rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            loop {
                let f = read_frame(&mut out);
                let done = !matches!(&f, Ok(Some(fr)) if fr.head["event"] == "progress");
                let _ = tx.send(f.map(|f| f.map(|f| f.head)));
                if done {
                    break;
                }
            }
            out
        });
        let first = loop {
            match rx.recv_timeout(wait) {
                Ok(Ok(Some(head))) if head["event"] == "progress" => progress(&head),
                other => break other,
            }
        };
        let ready = match first {
            Ok(Ok(Some(head))) if head["event"] == "ready" && head["protocol"].as_u64() != Some(PROTOCOL) => {
                let _ = child.kill();
                return Err(format!(
                    "窓とアプリの中身の版が食い違っています（窓 {PROTOCOL} / 中身 {}）。アプリを閉じて、Start.vbs から開き直してください。",
                    head["protocol"]
                ));
            }
            Ok(Ok(Some(head))) if head["event"] == "ready" => head,
            Ok(Ok(Some(head))) => {
                let _ = child.kill();
                return Err(format!("アプリの中身（Python）が起動できませんでした: {}", head["error"].as_str().unwrap_or("理由不明")));
            }
            Ok(Ok(None)) | Ok(Err(_)) => {
                let _ = child.wait();
                return Err(format!("アプリの中身（Python）がすぐに終わりました。\n{}", tail(&err_log, 12)));
            }
            Err(_) => {
                let _ = child.kill();
                return Err(format!("アプリの中身（Python）が {} 秒たっても準備できません。\n{}", wait.as_secs(), tail(&err_log, 12)));
            }
        };
        let out = reader.join().map_err(|_| "読み手の糸が止まりました")?;

        let pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>> = Arc::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (p2, a2) = (pending.clone(), alive.clone());
        std::thread::Builder::new().name("sidecar-reader".into()).spawn(move || read_loop(out, p2, a2)).map_err(|e| e.to_string())?;
        Ok(Sidecar {
            stdin: Mutex::new(Some(BufWriter::new(stdin))),
            pending,
            next: AtomicU64::new(1),
            alive,
            child: Mutex::new(child),
            ready,
        })
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// 1つ問い合わせて答えを待つ。送れない・止まった・時間切れは誤り（画面には 503/504 で返す）。
    pub fn request(&self, ask: &Ask, wait: Duration) -> Result<Reply, RequestError> {
        if !self.is_alive() {
            return Err(RequestError::Dead);
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let mut headers = serde_json::Map::new();
        for (k, v) in &ask.headers {
            // 同じ名前が並ぶときは HTTP と同じく「, 」でつなぐ
            let joined = match headers.get(k).and_then(Value::as_str) {
                Some(prev) => format!("{prev}, {v}"),
                None => v.clone(),
            };
            headers.insert(k.clone(), Value::from(joined));
        }
        let head = json!({"id": id, "method": ask.method, "path": ask.path, "query": ask.query, "headers": headers});
        let sent = match self.stdin.lock().unwrap().as_mut() {
            Some(w) => write_frame(w, &head, ask.body),
            None => Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe)),
        };
        if sent.is_err() {
            self.pending.lock().unwrap().remove(&id);
            self.alive.store(false, Ordering::SeqCst);
            return Err(RequestError::Dead);
        }
        match rx.recv_timeout(wait) {
            Ok(r) => Ok(r),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                Err(RequestError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(RequestError::Died),
        }
    }
}

impl Drop for Sidecar {
    /// 入力を閉じて自分で終わる（片付けてから）のを待ち、終わらなければ止める。
    fn drop(&mut self) {
        if let Ok(mut w) = self.stdin.lock() {
            drop(w.take()); // 出し切ってから閉じる
        }
        let mut child = self.child.lock().unwrap();
        let end = Instant::now() + STOP_WAIT;
        while Instant::now() < end {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[derive(Debug, PartialEq)]
pub enum RequestError {
    /// 送る前から止まっている（次の問い合わせで起こし直す）
    Dead,
    /// 答えを待つ間に止まった
    Died,
    Timeout,
}

fn read_loop(mut out: BufReader<std::process::ChildStdout>, pending: Arc<Mutex<HashMap<u64, Sender<Reply>>>>, alive: Arc<AtomicBool>) {
    while let Ok(Some(f)) = read_frame(&mut out) {
        let id = f.head["id"].as_u64().unwrap_or(0);
        if id == 0 {
            continue; // 知らせ（今は ready だけ。答えではない）
        }
        let headers = f.head["headers"]
            .as_array()
            .map(|a| a.iter().filter_map(|kv| Some((kv.get(0)?.as_str()?.to_string(), kv.get(1)?.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        let reply = Reply { status: f.head["status"].as_u64().unwrap_or(500) as u16, headers, body: f.body };
        if let Some(tx) = pending.lock().unwrap().remove(&id) {
            let _ = tx.send(reply);
        }
    }
    // 止まった: 待っている問い合わせへ知らせる（送り手を捨てると受け手は Disconnected）
    alive.store(false, Ordering::SeqCst);
    pending.lock().unwrap().clear();
}

/// 記録の終わりの数行（起動できない理由を画面に出すため）。
pub fn tail(path: &PathBuf, lines: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let v: Vec<&str> = text.lines().collect();
    v[v.len().saturating_sub(lines)..].join("\n")
}

/// 中身の Python を1つ持ち、止まっていたら次の問い合わせで起こし直す係。
pub struct Supervisor {
    py: Python,
    program: PathBuf,
    log_dir: PathBuf,
    current: Mutex<Option<Arc<Sidecar>>>,
    progress: Progress,
    pub start_wait: Duration,
}

impl Supervisor {
    pub fn new(py: Python, program: PathBuf, log_dir: PathBuf, progress: Progress) -> Self {
        Supervisor { py, program, log_dir, current: Mutex::new(None), progress, start_wait: Duration::from_secs(120) }
    }

    /// いま動いているか（起こし直さずに見る）。終了ボタンのあと、中身が片付けて終わったかを待つのに使う。
    pub fn is_running(&self) -> bool {
        self.current.lock().unwrap().as_ref().is_some_and(|s| s.is_alive())
    }

    /// 動いている中身（無ければ・止まっていれば起こす）。
    pub fn get(&self) -> Result<Arc<Sidecar>, String> {
        let mut cur = self.current.lock().unwrap();
        if let Some(s) = cur.as_ref() {
            if s.is_alive() {
                return Ok(s.clone());
            }
        }
        *cur = None; // 古いものを捨てる（Drop で後始末）
        let s = Arc::new(Sidecar::spawn(&self.py, &self.program, &self.log_dir, self.start_wait, &self.progress)?);
        *cur = Some(s.clone());
        Ok(s)
    }

    /// 終わるとき: 中身を捨てる（入力を閉じる → Python が自分で終わる）。
    pub fn stop(&self) {
        self.current.lock().unwrap().take();
    }
}
