//! 網のための「入口役の python.exe」（§9.571・CI の windows の自己診断の5回目だけが使う。配る exe には入らない）。
//!
//! 利用者の PC の Python は入口（`WindowsApps\python.exe`＝別名）が本物を子として起こしていた。窓が入力を閉じても
//! 本物は終わらず、窓が入口を止めた後も本物が`program`を掴んで、版の入れ替えが約6秒で断られた（5回のうち5回）。
//! ここはその形を作る:
//! - 本物（`WAVELOG_SHIM_TARGET`）を子として起こし、引数・出力・作業フォルダはそのまま渡す
//! - 入力は中継するが、窓が入力を閉じても**本物へは閉じたと伝えない**（入口が止められて初めて本物が入力の終わりを見る）
//! - 本物が終われば同じ終了コードで終わる

use std::io::{Read, Write};
use std::process::{Command, Stdio};

fn main() {
    let target = std::env::var_os("WAVELOG_SHIM_TARGET").expect("WAVELOG_SHIM_TARGET（本物の python.exe）が要ります");
    let mut child = Command::new(target)
        .args(std::env::args_os().skip(1))
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("本物の Python を起こせません");
    let mut to_child = child.stdin.take().expect("stdin");
    let (tx, rx) = std::sync::mpsc::channel::<std::process::ChildStdin>();
    std::thread::spawn(move || {
        let mut buf = [0u8; 64 * 1024];
        let mut input = std::io::stdin();
        loop {
            match input.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if to_child.write_all(&buf[..n]).and_then(|_| to_child.flush()).is_err() {
                        break;
                    }
                }
            }
        }
        // 入力の終わりを本物へ伝えない: 書き口を手放さずに持ち主（main）へ返す
        let _ = tx.send(to_child);
    });
    let status = child.wait().expect("wait");
    drop(rx);
    std::process::exit(status.code().unwrap_or(1));
}
