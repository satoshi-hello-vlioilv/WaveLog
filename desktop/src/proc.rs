//! プロセスを PID で見る・止める・「誰がファイルを掴んでいるか」を聞く（§9.571）。
//!
//! 窓が起こしたプロセスと、本当に動いている Python は**同じとは限らない**。Microsoft Store・Python Install Manager の
//! 入口（`WindowsApps\python.exe`）は別名で、本物（`pythoncore-*\python.exe`）を子として起こす。窓が入口だけを止めると
//! 本物が残り、作業フォルダ（`program`）を掴んだまま版の入れ替えが断られた（利用者の報告・5回のうち5回）。
//! そこで本物の PID（起動の合図 `ready.pid`）を見張り、止めるときも本物が終わるのを待つ。

use std::path::PathBuf;
use std::time::{Duration, Instant};

/// まだ動いているか。開けない（もう無い）なら false。
pub fn alive(pid: u32) -> bool {
    imp::alive(pid)
}

/// 止める（無ければ何もしない）。
pub fn kill(pid: u32) {
    imp::kill(pid)
}

/// 終わるまで待つ。`wait`のうちに終われば true。
pub fn wait_gone(pid: u32, wait: Duration) -> bool {
    let end = Instant::now() + wait;
    loop {
        if !alive(pid) {
            return true;
        }
        if Instant::now() >= end {
            return false;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

/// `files`を掴んでいるプロセス（「名前（PID n）」）。Windows の Restart Manager に聞く。分からなければ空。
pub fn holders(files: &[PathBuf]) -> Vec<String> {
    imp::holders(files)
}

/// フォルダの中のファイルを、深さ優先で`max`件まで（掴んでいる物を聞くため）。
pub fn files_under(dir: &std::path::Path, max: usize) -> Vec<PathBuf> {
    let (mut out, mut stack) = (Vec::new(), vec![dir.to_path_buf()]);
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            if out.len() >= max {
                return out;
            }
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(windows)]
mod imp {
    use std::os::windows::ffi::OsStrExt;
    use std::path::PathBuf;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, WAIT_TIMEOUT};
    use windows::Win32::System::RestartManager::{RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY, RM_PROCESS_INFO};
    use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE};

    pub fn alive(pid: u32) -> bool {
        unsafe {
            let Ok(h) = OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
            let running = WaitForSingleObject(h, 0) == WAIT_TIMEOUT;
            let _ = CloseHandle(h);
            running
        }
    }

    pub fn kill(pid: u32) {
        unsafe {
            if let Ok(h) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(h, 1);
                let _ = CloseHandle(h);
            }
        }
    }

    pub fn holders(files: &[PathBuf]) -> Vec<String> {
        if files.is_empty() {
            return Vec::new();
        }
        let wide: Vec<Vec<u16>> = files.iter().map(|p| p.as_os_str().encode_wide().chain(Some(0)).collect()).collect();
        let names: Vec<PCWSTR> = wide.iter().map(|w| PCWSTR(w.as_ptr())).collect();
        let mut out = Vec::new();
        unsafe {
            let mut session = 0u32;
            let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
            if RmStartSession(&mut session, None, PWSTR(key.as_mut_ptr())).is_err() {
                return out;
            }
            if RmRegisterResources(session, Some(&names), None, None).is_ok() {
                let (mut need, mut n, mut reasons) = (0u32, 0u32, 0u32);
                let _ = RmGetList(session, &mut need, &mut n, None, &mut reasons);
                if need > 0 {
                    let mut info = vec![RM_PROCESS_INFO::default(); need as usize];
                    n = need;
                    if RmGetList(session, &mut need, &mut n, Some(info.as_mut_ptr()), &mut reasons).is_ok() {
                        for i in info.iter().take(n as usize) {
                            let end = i.strAppName.iter().position(|c| *c == 0).unwrap_or(i.strAppName.len());
                            out.push(format!("{}（PID {}）", String::from_utf16_lossy(&i.strAppName[..end]), i.Process.dwProcessId));
                        }
                    }
                }
            }
            let _ = RmEndSession(session);
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::PathBuf;

    pub fn alive(pid: u32) -> bool {
        // 終わったが親に回収されていない物（ゾンビ）は動いていない（Linux の網用）
        match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(s) => !s.rsplit(')').next().unwrap_or("").trim_start().starts_with('Z'),
            Err(_) => false,
        }
    }

    pub fn kill(pid: u32) {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }

    pub fn holders(_files: &[PathBuf]) -> Vec<String> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    #[test]
    fn grandchild_is_seen_waited_and_killed() {
        // 入口（子）が本物（孫）を起こしてすぐ終わる形: 子が終わっても孫は動いている
        let out = Command::new("sh")
            .args(["-c", "sleep 30 >/dev/null 2>&1 & echo $!"])
            .stdout(Stdio::piped())
            .output()
            .expect("sh");
        let pid: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().expect("pid");
        assert!(alive(pid), "子が終わっても孫は残る（入口だけを見ると見落とす）");
        assert!(!wait_gone(pid, Duration::from_millis(200)), "終わっていない物を終わったと言わない");
        kill(pid);
        assert!(wait_gone(pid, Duration::from_secs(5)), "止めたら終わったと分かる");
    }

    #[test]
    fn missing_pid_is_not_alive() {
        assert!(!alive(u32::MAX - 7));
        assert!(wait_gone(u32::MAX - 7, Duration::ZERO));
    }

    #[test]
    fn files_under_stops_at_max() {
        let d = std::env::temp_dir().join(format!("wl-proc-{}", std::process::id()));
        std::fs::create_dir_all(d.join("a/b")).unwrap();
        for n in ["x", "a/y", "a/b/z"] {
            std::fs::write(d.join(n), "1").unwrap();
        }
        assert_eq!(files_under(&d, 10).len(), 3);
        assert_eq!(files_under(&d, 2).len(), 2);
        let _ = std::fs::remove_dir_all(&d);
    }
}
