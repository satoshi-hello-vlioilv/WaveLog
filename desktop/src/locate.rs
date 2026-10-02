//! 置き場所を探す: アプリの中身（program フォルダ）・Python・この PC の作業場所。
//! 決まりは Python 側（backend/paths.py の local_root）と Start.vbs に合わせる。

use std::env;
use std::path::{Path, PathBuf};

/// program フォルダ（sidecar.py がある所）。
/// 探す順: 環境変数 WAVELOG_PROGRAM_DIR（Start.vbs が exe を手元へ写して起動するときに渡す）→
/// この exe の置き場所から上へたどって `program/sidecar.py` がある所（作る途中: desktop/target/release/ から3つ上）。
pub fn program_dir() -> Result<PathBuf, String> {
    if let Some(p) = env::var_os("WAVELOG_PROGRAM_DIR") {
        let p = PathBuf::from(p);
        return if p.join("sidecar.py").is_file() {
            Ok(p)
        } else {
            Err(format!("WAVELOG_PROGRAM_DIR に sidecar.py がありません: {}", p.display()))
        };
    }
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    find_program_from(&exe).ok_or_else(|| {
        format!(
            "アプリの中身（program フォルダ）が見つかりません。Start.vbs の「desktop」から起動してください。\n探し始めた場所: {}",
            exe.parent().unwrap_or(&exe).display()
        )
    })
}

pub fn find_program_from(start: &Path) -> Option<PathBuf> {
    start.ancestors().skip(1).take(6).map(|d| d.join("program")).find(|p| p.join("sidecar.py").is_file())
}

/// この PC の作業場所（backend/paths.py の local_root と同じ決まり: LOCALAPPDATA → XDG_DATA_HOME → ~/.local/share）。
pub fn local_root() -> PathBuf {
    if let Some(p) = env::var_os("WAVELOG_LOCAL_ROOT") {
        return PathBuf::from(p);
    }
    let base = env::var_os("LOCALAPPDATA")
        .or_else(|| env::var_os("XDG_DATA_HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".local").join("share"));
    base.join("WaveLog")
}

fn home() -> PathBuf {
    env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

/// Python の起こし方（exe と、前に付ける引数。py ランチャーは -3）。
#[derive(Clone, Debug, PartialEq)]
pub struct Python {
    pub exe: PathBuf,
    pub args: Vec<String>,
}

/// Python を探す。見つからなければ、探した場所を添えて誤り。
pub fn python() -> Result<Python, String> {
    let path: Vec<PathBuf> = env::var_os("PATH").map(|p| env::split_paths(&p).collect()).unwrap_or_default();
    let cands = python_candidates(env::var_os("WAVELOG_PYTHON").map(PathBuf::from), &path);
    cands.iter().find(|c| exists(&c.exe)).cloned().ok_or_else(|| {
        let tried: Vec<String> = cands.iter().map(|c| format!("  {}", c.exe.display())).collect();
        format!("Python が見つかりません。ブラウザ版（Start.vbs）と同じ Python を使います。\n探した場所:\n{}", tried.join("\n"))
    })
}

/// 在るか。**リンクをたどらずに**見る——Microsoft Store 版の入口（WindowsApps の python.exe）は
/// 中身の無い特別なリンクで、たどって開こうとすると「無い」と答えることがある。
fn exists(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

/// 探す順（先にあるほど優先）。**ブラウザ版と同じ Python を使う**ことが要る——端末の控え（§9.545）は
/// Python が書き、Microsoft Store 版の Python は書いた物を自分にしか見えない写しへ回すので、違う Python だと
/// 2つの版が別々の控えを見る。Start.vbs は PATH の順に最初の `pythonw.exe` を起こすので、ここも
/// **PATH を前から見て、最初に pythonw.exe がある場所の python.exe**（並べ替えない）。
/// その前に WAVELOG_PYTHON（Start.vbs が渡す）、後ろに PATH の最初の python.exe と py ランチャー。
pub fn python_candidates(given: Option<PathBuf>, path: &[PathBuf]) -> Vec<Python> {
    let plain = |exe: PathBuf| Python { exe, args: vec![] };
    let mut out = Vec::new();
    if let Some(p) = given {
        out.push(plain(p));
    }
    if cfg!(windows) {
        for dir in path {
            if exists(&dir.join("pythonw.exe")) {
                out.push(plain(dir.join("python.exe")));
            }
        }
        out.extend(path.iter().map(|d| plain(d.join("python.exe"))));
        let windir = env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        out.push(Python { exe: windir.join("py.exe"), args: vec!["-3".into()] });
    } else {
        out.extend(path.iter().map(|d| plain(d.join("python3"))));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_program_next_to_the_exe_or_above() {
        let tmp = env::temp_dir().join(format!("wl-locate-{}", std::process::id()));
        let prog = tmp.join("program");
        std::fs::create_dir_all(&prog).unwrap();
        std::fs::write(prog.join("sidecar.py"), "").unwrap();
        let deep = tmp.join("desktop").join("target").join("release");
        std::fs::create_dir_all(&deep).unwrap();
        assert_eq!(find_program_from(&tmp.join("WaveLog.exe")), Some(prog.clone()), "exe と program が並ぶ");
        assert_eq!(find_program_from(&deep.join("WaveLog.exe")), Some(prog.clone()), "作る途中（3つ上）");
        assert_eq!(find_program_from(&env::temp_dir().join("nowhere").join("x.exe")), None);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn given_python_comes_first_and_path_order_is_kept() {
        let a = PathBuf::from("/opt/a");
        let b = PathBuf::from("/opt/b");
        let c = python_candidates(Some(PathBuf::from("/given/python")), &[a.clone(), b.clone()]);
        assert_eq!(c[0].exe, PathBuf::from("/given/python"), "Start.vbs が渡した Python が先");
        if !cfg!(windows) {
            assert_eq!(c[1].exe, a.join("python3"), "PATH の順は並べ替えない（ブラウザ版と同じ Python）");
            assert_eq!(c[2].exe, b.join("python3"));
        }
    }
}
