//! 更新（§9.555）——共有の置き場で「配る版」を読み、手元のアプリのフォルダをその版にそろえる。
//!
//! 置き場（`update_dir()`・既定は利用者の指定した共有フォルダ）:
//!   `release.json`          … 配る版（`{"version": "2.442.0", …}`）。決めるのはメンテナンス者（`backend/app_update.py`）
//!   `versions\<版>\`         … 版ごとの中身と `manifest.json`（全ファイルの道・大きさ・sha256・入れ替える項目 `payload`）
//!
//! 窓が起動画面の中で、**中身（Python）を起こす前に**行う（動いている Python のファイルを入れ替えない）:
//!   1. `release.json` を読む（届かなければ `REACH` で打ち切ってそのまま起動・共有が無い日も開ける）
//!   2. 手元の版（`backend\changelog_data.py` の `APP_VERSION`）と同じなら何もしない
//!   3. 違えば `<アプリ>\.update\<版>.stage\` へ写して **大きさと sha256 を全部確かめる**
//!   4. `payload` の項目ごとに入れ替える（今の物は `<アプリ>\.update\<前の版>.old\` へ）。途中で失敗したら**戻す**
//!
//! **データ（`db`・`config`）は `payload` に入らないので触らない**。前の版へ戻すのも同じ道（配る版を選び直すだけ）。
//! 開発の作業ツリー（`.git` が在る）は入れ替えない。

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// 置き場の既定（利用者の指定・`backend/app_update.py` の `DEFAULT_DIR` と同じ字）。
pub const DEFAULT_DIR: &str = r"\\nlmsrvngy03\工場内共有\検査データ\Records\アプリメンテナンス\WaveLog";
/// `config/local.json` で置き場を変える鍵（Python と同じ）。
pub const CONFIG_KEY: &str = "update_dir";
/// 共有に届くのを待つ長さ。届かない UNC は OS が数十秒待たせることがある（起動を待たせない）。
pub const REACH: Duration = Duration::from_secs(3);
/// 手元の作業場所（`<アプリ>\.update`）。
pub const WORK: &str = ".update";

/// 何が起きたか（起動画面と記録が言う）。
#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// 配る版と同じ（何もしない）
    UpToDate(String),
    /// 確かめなかった・そろえなかった理由（届かない・配る版が無い・開発の作業ツリー）
    Skipped(String),
    /// そろえた。exe も変わったか（変わったら新しい exe で開き直す）
    Applied { from: String, to: String, exe_changed: bool },
    /// そろえられなかった（前の版のまま起動する）
    Failed(String),
}

/// 置き場。`config/local.json` の `update_dir`（`%VAR%` を展開）→ 既定。
pub fn update_dir(app_root: &Path) -> PathBuf {
    let given = std::fs::read(app_root.join("config").join("local.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).ok())
        .and_then(|v| v[CONFIG_KEY].as_str().map(str::to_owned))
        .map(|s| expand_vars(s.trim()))
        .unwrap_or_default();
    PathBuf::from(if given.is_empty() { DEFAULT_DIR.to_string() } else { given })
}

/// `%NAME%` を環境変数で展開する（無ければそのまま残す・Python の expandvars と同じ扱い）。
fn expand_vars(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        match tail.find('%') {
            Some(j) => {
                let name = &tail[..j];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => out.push_str(&rest[i..i + j + 2]),
                }
                rest = &tail[j + 1..];
            }
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// 手元の版（`backend\changelog_data.py` の `APP_VERSION='…'`）。読めなければ None。
pub fn local_version(app_root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(app_root.join("backend").join("changelog_data.py")).ok()?;
    text.lines().find_map(|l| {
        let rest = l.strip_prefix("APP_VERSION")?.trim_start().strip_prefix('=')?.trim();
        let q = rest.chars().next().filter(|c| *c == '\'' || *c == '"')?;
        let v = &rest[1..];
        Some(v[..v.find(q)?].to_string())
    })
}

/// 版の字として使えるか（数字で始まり、英数字・点・ハイフンだけ・Python と同じ）。道に混ぜる前に確かめる。
pub fn safe_version(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 41
        && v.starts_with(|c: char| c.is_ascii_digit())
        && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// `f` を別の糸で動かし、`wait` で打ち切る（届かない共有で起動を止めない）。
fn within<T: Send + 'static>(wait: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(wait).ok()
}

/// 配る版を読む。`Ok(None)`＝決めていない、`Err`＝届かない・読めない。
pub fn release_version(dir: &Path, wait: Duration) -> Result<Option<String>, String> {
    let file = dir.join("release.json");
    let shown = file.display().to_string();
    match within(wait, move || std::fs::read(&file)) {
        None => Err(format!("{} 秒待っても置き場に届きません（{shown}）", wait.as_secs())),
        Some(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Some(Err(e)) => Err(format!("配る版を読めません（{shown}）: {e}")),
        Some(Ok(b)) => {
            let v: Value = serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b))
                .map_err(|e| format!("配る版の形が違います（{shown}）: {e}"))?;
            Ok(v["version"].as_str().map(str::to_owned).filter(|s| !s.is_empty()))
        }
    }
}

fn sha256_of(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h)?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 版のフォルダを `stage` へ写し、manifest どおりか（大きさ・sha256）を全部確かめる。戻り値は入れ替える項目。
pub fn stage(src: &Path, stage: &Path, progress: &dyn Fn(&str)) -> Result<Vec<String>, String> {
    let man: Value = serde_json::from_slice(
        &std::fs::read(src.join("manifest.json")).map_err(|e| format!("版の目録（manifest.json）を読めません: {e}"))?,
    )
    .map_err(|e| format!("版の目録の形が違います: {e}"))?;
    let payload: Vec<String> = man["payload"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(str::to_owned)).collect();
    let files = man["files"].as_array().ok_or("版の目録にファイルの並びがありません")?;
    if payload.is_empty() || payload.iter().any(|p| p.is_empty() || p.contains(['/', '\\']) || p == ".." || p == "db" || p == "config") {
        return Err(format!("入れ替える項目が正しくありません: {payload:?}"));
    }
    let _ = std::fs::remove_dir_all(stage);
    let total = files.len();
    for (i, f) in files.iter().enumerate() {
        let rel = f["path"].as_str().unwrap_or("");
        let parts: Vec<&str> = rel.split('/').collect();
        if rel.is_empty() || parts.iter().any(|p| p.is_empty() || *p == ".." || p.contains(':')) || !payload.iter().any(|p| p == parts[0]) {
            return Err(format!("目録に正しくない道があります: {rel}"));
        }
        let (from, to) = (parts.iter().fold(src.to_path_buf(), |a, p| a.join(p)), parts.iter().fold(stage.to_path_buf(), |a, p| a.join(p)));
        if let Some(d) = to.parent() {
            std::fs::create_dir_all(d).map_err(|e| format!("写す先を作れません（{}）: {e}", d.display()))?;
        }
        std::fs::copy(&from, &to).map_err(|e| format!("写せません（{rel}）: {e}"))?;
        let size = std::fs::metadata(&to).map(|m| m.len()).unwrap_or(u64::MAX);
        let sum = sha256_of(&to).map_err(|e| format!("確かめられません（{rel}）: {e}"))?;
        if Some(size) != f["size"].as_u64() || Some(sum.as_str()) != f["sha256"].as_str() {
            return Err(format!("写した物が目録と合いません（{rel}）。置き場の版が壊れているか、写す途中で切れました"));
        }
        if i % 25 == 0 {
            progress(&format!("写しています {}/{total}", i + 1));
        }
    }
    Ok(payload)
}

/// `payload` の項目を `stage` の物へ入れ替える。今の物は `old` へ。**途中で失敗したら全部戻す**。
pub fn swap(app_root: &Path, stage: &Path, old: &Path, payload: &[String]) -> Result<(), String> {
    let _ = std::fs::remove_dir_all(old);
    std::fs::create_dir_all(old).map_err(|e| format!("前の版の控えを作れません: {e}"))?;
    let mut done: Vec<(&String, bool)> = Vec::new(); // (項目, 前の物が在ったか)
    let result = (|| {
        for name in payload {
            let (cur, new, keep) = (app_root.join(name), stage.join(name), old.join(name));
            let had = cur.exists();
            if had {
                std::fs::rename(&cur, &keep).map_err(|e| format!("入れ替えられません（{name} が使用中かもしれません）: {e}"))?;
            }
            done.push((name, had));
            if new.exists() {
                std::fs::rename(&new, &cur).map_err(|e| format!("新しい {name} を置けません: {e}"))?;
            }
        }
        Ok(())
    })();
    if let Err(e) = result {
        for (name, had) in done.iter().rev() {
            let (cur, new, keep) = (app_root.join(name), stage.join(name), old.join(name));
            if cur.exists() && !new.exists() {
                let _ = std::fs::rename(&cur, &new);
            }
            if *had {
                let _ = std::fs::rename(&keep, &cur);
            }
        }
        return Err(e);
    }
    Ok(())
}

/// exe が変わったかは**中身**で見る（大きさ＋更新時刻だと、同じ大きさの exe が同じ秒に置かれたときに見落とす）。
fn exe_stamp(app_root: &Path) -> Option<String> {
    sha256_of(&app_root.join("program").join(crate::launch::EXE)).ok()
}

/// 配る版を読み、違えばそろえる（起動画面の中・Python を起こす前に1回）。
pub fn check_and_apply(app_root: &Path, log: &dyn Fn(&str), progress: &dyn Fn(&str)) -> Outcome {
    if app_root.join(".git").exists() && std::env::var_os("WAVELOG_UPDATE_FORCE").is_none() {
        return Outcome::Skipped("開発の作業ツリーなので更新しません".into());
    }
    let dir = update_dir(app_root);
    let want = match release_version(&dir, REACH) {
        Ok(Some(v)) => v,
        Ok(None) => return Outcome::Skipped("配る版が決まっていません".into()),
        Err(e) => return Outcome::Skipped(e),
    };
    if !safe_version(&want) {
        return Outcome::Failed(format!("配る版の字が正しくありません: {want:?}"));
    }
    let have = local_version(app_root).unwrap_or_default();
    if have == want {
        return Outcome::UpToDate(have);
    }
    progress(&format!("{have} → {want} にそろえています"));
    let work = app_root.join(WORK);
    let stage_dir = work.join(format!("{want}.stage"));
    let old = work.join(format!("{}.old", if safe_version(&have) { have.as_str() } else { "unknown" }));
    let before = exe_stamp(app_root);
    let payload = match stage(&dir.join("versions").join(&want), &stage_dir, progress) {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&stage_dir);
            return Outcome::Failed(e);
        }
    };
    progress("入れ替えています");
    if let Err(e) = swap(app_root, &stage_dir, &old, &payload) {
        let _ = std::fs::remove_dir_all(&stage_dir);
        return Outcome::Failed(e);
    }
    let _ = std::fs::remove_dir_all(&stage_dir);
    // 前の版の控えは1つだけ残す（直前の版。それより古い控えは消す）
    for e in std::fs::read_dir(&work).into_iter().flatten().flatten() {
        if e.path() != old && e.file_name().to_string_lossy().ends_with(".old") {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    log(&format!("UPDATE {have} → {want}（{}）", dir.display()));
    Outcome::Applied { from: have, to: want, exe_changed: exe_stamp(app_root) != before }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wl-update-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    /// 版のフォルダと目録を作る（Python の `_manifest` と同じ形）。
    fn version(share: &Path, v: &str, body: &str) {
        let root = share.join("versions").join(v);
        let files = [
            ("backend/changelog_data.py", format!("APP_VERSION='{v}'\n")),
            ("backend/a.py", body.to_string()),
            ("program/WaveLog.exe", format!("exe {v}")),
        ];
        let mut list = vec![];
        for (p, text) in &files {
            let f = root.join(p);
            fs::create_dir_all(f.parent().unwrap()).unwrap();
            fs::write(&f, text).unwrap();
            list.push(serde_json::json!({"path": p, "size": text.len(), "sha256": sha256_of(&f).unwrap()}));
        }
        let man = serde_json::json!({"version": v, "payload": ["backend", "program"], "files": list});
        fs::write(root.join("manifest.json"), man.to_string()).unwrap();
    }

    fn app(root: &Path, v: &str) {
        fs::create_dir_all(root.join("backend")).unwrap();
        fs::create_dir_all(root.join("program")).unwrap();
        fs::create_dir_all(root.join("db")).unwrap();
        fs::write(root.join("backend/changelog_data.py"), format!("# x\nAPP_VERSION='{v}'\n")).unwrap();
        fs::write(root.join("backend/old_only.py"), "old").unwrap();
        fs::write(root.join("program/WaveLog.exe"), format!("exe {v}")).unwrap();
        fs::write(root.join("db/master.sqlite3"), "data").unwrap();
    }

    fn config(root: &Path, share: &Path) {
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("config/local.json"), serde_json::json!({CONFIG_KEY: share}).to_string()).unwrap();
    }

    #[test]
    fn reads_version_and_place() {
        let t = tmp("read");
        app(&t, "2.441.0");
        assert_eq!(local_version(&t).as_deref(), Some("2.441.0"));
        assert_eq!(update_dir(&t), PathBuf::from(DEFAULT_DIR), "local.json が無ければ既定（利用者の指定した共有）");
        config(&t, Path::new("/x/share"));
        assert_eq!(update_dir(&t), PathBuf::from("/x/share"));
        assert!(safe_version("2.442.0") && !safe_version("../x") && !safe_version(""));
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn applies_the_release_and_keeps_data() {
        let t = tmp("apply");
        let (root, share) = (t.join("app"), t.join("share"));
        app(&root, "2.441.0");
        config(&root, &share);
        version(&share, "2.442.0", "new");
        fs::write(share.join("release.json"), r#"{"version":"2.442.0"}"#).unwrap();
        let out = check_and_apply(&root, &|_| {}, &|_| {});
        assert_eq!(out, Outcome::Applied { from: "2.441.0".into(), to: "2.442.0".into(), exe_changed: true });
        assert_eq!(local_version(&root).as_deref(), Some("2.442.0"));
        assert_eq!(fs::read_to_string(root.join("backend/a.py")).unwrap(), "new");
        assert!(!root.join("backend/old_only.py").exists(), "前の版だけに在った物は残らない（項目ごと入れ替える）");
        assert_eq!(fs::read_to_string(root.join("db/master.sqlite3")).unwrap(), "data", "データは触らない");
        assert!(root.join(".update/2.441.0.old/backend/old_only.py").exists(), "前の版は控えに残る");
        assert_eq!(check_and_apply(&root, &|_| {}, &|_| {}), Outcome::UpToDate("2.442.0".into()));
        // 前の版へ戻す＝配る版を選び直すだけ
        version(&share, "2.441.0", "old");
        fs::write(share.join("release.json"), r#"{"version":"2.441.0"}"#).unwrap();
        assert!(matches!(check_and_apply(&root, &|_| {}, &|_| {}), Outcome::Applied { .. }));
        assert_eq!(fs::read_to_string(root.join("backend/a.py")).unwrap(), "old");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn a_broken_version_changes_nothing() {
        let t = tmp("broken");
        let (root, share) = (t.join("app"), t.join("share"));
        app(&root, "2.441.0");
        config(&root, &share);
        version(&share, "2.442.0", "new");
        fs::write(share.join("versions/2.442.0/backend/a.py"), "tampered").unwrap();
        fs::write(share.join("release.json"), r#"{"version":"2.442.0"}"#).unwrap();
        let out = check_and_apply(&root, &|_| {}, &|_| {});
        assert!(matches!(&out, Outcome::Failed(e) if e.contains("合いません")), "{out:?}");
        assert_eq!(local_version(&root).as_deref(), Some("2.441.0"), "確かめられなければ1つも入れ替えない");
        assert!(root.join("backend/old_only.py").exists());
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn unreachable_or_undecided_is_skipped() {
        let t = tmp("skip");
        let root = t.join("app");
        app(&root, "2.441.0");
        config(&root, &t.join("nowhere"));
        assert!(matches!(check_and_apply(&root, &|_| {}, &|_| {}), Outcome::Skipped(_)), "配る版が無ければそのまま起動");
        fs::create_dir_all(root.join(".git")).unwrap();
        assert!(matches!(check_and_apply(&root, &|_| {}, &|_| {}), Outcome::Skipped(e) if e.contains("開発")));
        assert!(within(Duration::from_millis(50), || std::thread::sleep(Duration::from_secs(2))).is_none(), "待ちは打ち切る");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn swap_rolls_back_when_a_step_fails() {
        let t = tmp("swap");
        let (root, st, old) = (t.join("app"), t.join("stage"), t.join("old"));
        app(&root, "2.441.0");
        fs::create_dir_all(st.join("backend")).unwrap();
        fs::write(st.join("backend/changelog_data.py"), "APP_VERSION='9'\n").unwrap();
        // 2つ目の項目は控えへ移せない形（控えの中に親が無い道）にして、途中で失敗させる
        fs::create_dir_all(root.join("a/b")).unwrap();
        let payload = vec!["backend".to_string(), "a/b".to_string()];
        assert!(swap(&root, &st, &old, &payload).is_err());
        assert_eq!(local_version(&root).as_deref(), Some("2.441.0"), "1つ目に入れ替えた物も元へ戻す");
        assert!(root.join("backend/old_only.py").exists() && root.join("a/b").exists());
        assert!(st.join("backend/changelog_data.py").exists(), "新しい物は写した先へ戻る（半端に混ざらない）");
        let _ = fs::remove_dir_all(&t);
    }
}
