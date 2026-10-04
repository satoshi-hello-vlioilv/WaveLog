//! 入口（§9.554）——exe 自身が毎日の入口になる。Start.vbs（WSH）を通らない。
//!
//! 配る exe は共有（Box）の `program\WaveLog.exe` 1本。そこから直に動かすと Windows が exe を掴み、その PC が開いている
//! あいだ更新で上書きできない（§9.546）。だから**この PC へ写して、写した版で動く**。以前は Start.vbs が写していたが、
//! 写し方（`CopyFile`）が「インターネットから来た」印（Mark of the Web）ごと写すので、更新のたびに Start.vbs と写した
//! exe で**実行前の警告が2回**出た（利用者の報告）。いまは exe がここで写し、**写した物から印を外す**（自分で写した、
//! 出どころの分かっている物だけ）。
//!
//! 置き場（`local_root()/desktop`）:
//!   `WaveLog.exe`          … **入口**（ショートカットの行き先・いつも同じ場所）。起こされたら版ごとの写しへ渡して終わる
//!   `<大きさ-更新時刻>\WaveLog.exe` … 版ごとの写し（窓として動くのはこちら・古い版は動いている版が片付ける）
//!   `program.txt`          … 最後に使った program フォルダ（引数の無い入口でも中身を探せる・`locate::program_dir()`）
//!
//! 決めるのは `plan()` の1箇所（純粋な関数・網が直に確かめる）。動かすのは `handoff()`。

use crate::locate;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// 入口・版ごとの写しの名前（配る exe と同じ名前）。
pub const EXE: &str = "WaveLog.exe";

/// 写しの置き場（`local_root()/desktop`）。
pub fn desktop_dir() -> PathBuf {
    locate::local_root().join("desktop")
}

/// 入口（ショートカットの行き先）。
pub fn entry_path() -> PathBuf {
    desktop_dir().join(EXE)
}

/// 配ってある exe の版の印（大きさ＋更新時刻の秒）。ZIP で上書きすると変わる。
pub fn stamp(src: &Path) -> Option<String> {
    let m = std::fs::metadata(src).ok()?;
    let t = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(format!("{}-{t}", m.len()))
}

/// 起動のはじめに何をするか。
#[derive(Debug, PartialEq)]
pub enum Step {
    /// このまま窓として動く（写した版そのもの・作る途中の exe・配る exe が無い）
    Stay,
    /// 写してある版へ渡す
    Run(PathBuf),
    /// 写してから渡す
    Copy(PathBuf),
}

/// 同じファイルか（短い名前・大文字小文字・`\\?\`の違いをならしてから比べる）。
fn same(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => a == b,
    }
}

/// 何をするか決める。`me`＝いま動いている exe、`src`＝配ってある exe（`program\WaveLog.exe`）、`dir`＝写しの置き場。
///
/// **入口の役目を持つのは、配る exe・入口・版ごとの写しの3つだけ**——作る途中（`desktop/target/`）や手で置いた exe は
/// そのまま動く（開発の道を変えない）。配る exe が無ければ写す元が無いので、そのまま動く。
pub fn plan(me: &Path, src: &Path, dir: &Path) -> Step {
    let Some(st) = stamp(src) else { return Step::Stay };
    let managed = same(me, src) || me.starts_with(dir) || canonical_starts_with(me, dir);
    if !managed {
        return Step::Stay;
    }
    let dst = dir.join(&st).join(EXE);
    if same(me, &dst) {
        Step::Stay
    } else if dst.is_file() {
        Step::Run(dst)
    } else {
        Step::Copy(dst)
    }
}

fn canonical_starts_with(p: &Path, dir: &Path) -> bool {
    match (std::fs::canonicalize(p), std::fs::canonicalize(dir)) {
        (Ok(x), Ok(y)) => x.starts_with(y),
        _ => false,
    }
}

/// 「インターネットから来た」印（NTFS の別の流れ `Zone.Identifier`）を外す。外したら true。
/// **自分で写した物にだけ使う**（出どころは配った program フォルダ）。Windows 以外には印が無い。
pub fn strip_mark(p: &Path) -> bool {
    if !cfg!(windows) {
        return false;
    }
    let mut s = p.as_os_str().to_owned();
    s.push(":Zone.Identifier");
    std::fs::remove_file(PathBuf::from(s)).is_ok()
}

/// `src` を `dst` へ置く（途中のファイルへ写し → 印を外す → 名前を変えて入れ替える）。途中で落ちても半端な exe を残さない。
pub fn install(src: &Path, dst: &Path) -> Result<bool, String> {
    if let Some(d) = dst.parent() {
        std::fs::create_dir_all(d).map_err(|e| format!("置き場を作れません（{}）: {e}", d.display()))?;
    }
    let tmp = dst.with_extension("exe.tmp");
    std::fs::copy(src, &tmp).map_err(|e| format!("写せません（{} → {}）: {e}", src.display(), tmp.display()))?;
    let stripped = strip_mark(&tmp);
    std::fs::rename(&tmp, dst).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("置き換えられません（{}）: {e}", dst.display())
    })?;
    Ok(stripped)
}

/// 起動のはじめ: 版ごとの写しへ渡すなら渡して true（呼ぶ側はすぐ終わる）。そのまま動くなら false。
/// **渡せなかったら、そのまま動く**（窓が出ないより、共有から動くほうがまし）。理由は記録に残す。
pub fn handoff(program: &Path, log: &dyn Fn(&str)) -> bool {
    let Ok(me) = std::env::current_exe() else { return false };
    let src = program.join(EXE);
    let dst = match plan(&me, &src, &desktop_dir()) {
        Step::Stay => return false,
        Step::Run(d) => d,
        Step::Copy(d) => match install(&src, &d) {
            Ok(stripped) => {
                log(&format!("LAUNCH 写しました: {}（印を外した: {stripped}）", d.display()));
                d
            }
            Err(e) => {
                log(&format!("LAUNCH 写せないので、このまま動きます: {e}"));
                return false;
            }
        },
    };
    match std::process::Command::new(&dst).arg(locate::PROGRAM_ARG).arg(program).spawn() {
        Ok(_) => {
            log(&format!("LAUNCH 渡しました: {} → {}", me.display(), dst.display()));
            true
        }
        Err(e) => {
            log(&format!("LAUNCH 起こせないので、このまま動きます（{}）: {e}", dst.display()));
            false
        }
    }
}

/// 入口を、いま動いている版にそろえる（版ごとの写しとして動いているときだけ）。入口が無い・違うなら置き直す。
/// 入口は起こされるとすぐ終わるが、終わる前に当たったときのために少し待ってやり直す。
pub fn refresh_entry(log: &dyn Fn(&str)) {
    let Ok(me) = std::env::current_exe() else { return };
    let dir = desktop_dir();
    let entry = entry_path();
    let versioned = me.parent().and_then(Path::parent).is_some_and(|p| same(p, &dir));
    if !versioned || same_bytes(&me, &entry) {
        return;
    }
    for _ in 0..10 {
        match install(&me, &entry) {
            Ok(_) => return log(&format!("LAUNCH 入口をこの版にしました: {}", entry.display())),
            Err(e) if !entry.exists() => return log(&format!("LAUNCH 入口を置けません: {e}")),
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(300)),
        }
    }
    log(&format!("LAUNCH 入口が使用中のため置き直せませんでした（次の起動で置き直します）: {}", entry.display()));
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) if x.len() == y.len() => std::fs::read(a).ok() == std::fs::read(b).ok(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wl-launch-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn decides_by_where_it_runs() {
        let t = tmp("plan");
        let prog = t.join("program");
        std::fs::create_dir_all(&prog).unwrap();
        let src = prog.join(EXE);
        std::fs::write(&src, b"v1").unwrap();
        let dir = t.join("local").join("desktop");
        std::fs::create_dir_all(&dir).unwrap();
        let dst = dir.join(stamp(&src).unwrap()).join(EXE);
        assert_eq!(plan(&src, &src, &dir), Step::Copy(dst.clone()), "配る exe から起こした→写して渡す");
        assert_eq!(plan(&dir.join(EXE), &src, &dir), Step::Copy(dst.clone()), "入口から起こした→写して渡す");
        install(&src, &dst).unwrap();
        assert_eq!(plan(&dir.join(EXE), &src, &dir), Step::Run(dst.clone()), "写してあれば渡すだけ");
        assert_eq!(plan(&dst, &src, &dir), Step::Stay, "版ごとの写しそのもの→このまま動く");
        let dev = t.join("desktop").join("target").join("release").join(EXE);
        assert_eq!(plan(&dev, &src, &dir), Step::Stay, "作る途中の exe は入口の役目を持たない");
        assert_eq!(plan(&src, &prog.join("無い.exe"), &dir), Step::Stay, "配る exe が無い→このまま");
        std::fs::remove_dir_all(&t).ok();
    }

    #[test]
    fn install_replaces_without_leaving_a_half_file() {
        let t = tmp("install");
        let src = t.join("a.exe");
        std::fs::write(&src, b"new").unwrap();
        let dst = t.join("sub").join(EXE);
        install(&src, &dst).unwrap();
        std::fs::write(&src, b"newer").unwrap();
        install(&src, &dst).unwrap();
        assert_eq!(std::fs::read(&dst).unwrap(), b"newer", "入れ替わる");
        assert!(!dst.with_extension("exe.tmp").exists(), "途中のファイルを残さない");
        std::fs::remove_dir_all(&t).ok();
    }

    #[cfg(windows)]
    #[test]
    fn copied_exe_loses_the_internet_mark() {
        let t = tmp("mark");
        let src = t.join("a.exe");
        std::fs::write(&src, b"x").unwrap();
        let mut ads = src.as_os_str().to_owned();
        ads.push(":Zone.Identifier");
        std::fs::write(PathBuf::from(&ads), "[ZoneTransfer]\r\nZoneId=3\r\n").unwrap();
        let dst = t.join("b").join(EXE);
        assert!(install(&src, &dst).unwrap(), "写した物から印を外した");
        let mut dads = dst.as_os_str().to_owned();
        dads.push(":Zone.Identifier");
        assert!(!PathBuf::from(dads).exists(), "写した物に印が残っていない");
        assert!(PathBuf::from(ads).exists(), "元（配った物）の印は触らない");
        std::fs::remove_dir_all(&t).ok();
    }
}
