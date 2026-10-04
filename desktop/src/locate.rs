//! 置き場所を探す: アプリの中身（program フォルダ）・Python・この PC の作業場所。
//! 決まりは Python 側（backend/paths.py の local_root）に合わせる。

use std::env;
use std::path::{Path, PathBuf};

/// 入口から版ごとの写しへ渡すときの引数（`--program <フォルダ>`・ショートカットも同じ形で渡す・§9.554）。
pub const PROGRAM_ARG: &str = "--program";
/// 最後に使った program フォルダの控え（`local_root()/desktop/program.txt`）。
const REMEMBERED: &str = "program.txt";

/// program フォルダ（sidecar.py がある所）。答えはここの1箇所。
/// 探す順: 引数 `--program`（入口・ショートカット）→ 環境変数 WAVELOG_PROGRAM_DIR（開発・網）→
/// この exe の置き場所から上へたどって `program/sidecar.py` がある所（配る exe・作る途中は3つ上）→
/// **最後に使った場所の控え**（引数の無い入口・タスクバーに留めた写し）。見つけたら控えを書き直す。
pub fn program_dir() -> Result<PathBuf, String> {
    let given = arg_value(PROGRAM_ARG).or_else(|| env::var_os("WAVELOG_PROGRAM_DIR").map(PathBuf::from));
    let found = match given {
        Some(p) if p.join("sidecar.py").is_file() => p,
        Some(p) => return Err(format!("指定された program フォルダに sidecar.py がありません: {}", p.display())),
        None => {
            let exe = env::current_exe().map_err(|e| e.to_string())?;
            match find_program_from(&exe).or_else(remembered) {
                Some(p) => p,
                None => {
                    return Err(format!(
                        "アプリの中身（program フォルダ）が見つかりません。配られた共有の入口（共有の置き場の WaveLog.exe）を一度ダブルクリックしてください（この PC へアプリを写して開きます。次からはデスクトップの起動アイコンで開けます）。\n探し始めた場所: {}",
                        exe.parent().unwrap_or(&exe).display()
                    ))
                }
            }
        }
    };
    remember(&found);
    Ok(found)
}

/// 引数 `name <値>` の値（`--name=値` も受ける）。
fn arg_value(name: &str) -> Option<PathBuf> {
    let args: Vec<String> = env::args().collect();
    let eq = format!("{name}=");
    args.iter().enumerate().find_map(
        |(i, a)| {
            if a == name {
                args.get(i + 1).map(PathBuf::from)
            } else {
                a.strip_prefix(&eq).map(PathBuf::from)
            }
        },
    )
}

fn remembered() -> Option<PathBuf> {
    let text = std::fs::read_to_string(local_root().join("desktop").join(REMEMBERED)).ok()?;
    let p = PathBuf::from(text.trim());
    p.join("sidecar.py").is_file().then_some(p)
}

/// program フォルダを控える（初回のインストールのあとも・`install::program_for()`）。
pub fn remember(p: &Path) {
    let dir = local_root().join("desktop");
    let file = dir.join(REMEMBERED);
    let text = p.display().to_string();
    if std::fs::read_to_string(&file).ok().as_deref() != Some(text.as_str()) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(file, text);
    }
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
        format!(
            "Python が見つかりません。PATH で最初に見つかる Python を使います。\n探した場所:\n{}",
            tried.join("\n")
        )
    })
}

/// 在るか。**リンクをたどらずに**見る——Microsoft Store 版の入口（WindowsApps の python.exe）は
/// 中身の無い特別なリンクで、たどって開こうとすると「無い」と答えることがある。
fn exists(p: &Path) -> bool {
    std::fs::symlink_metadata(p).is_ok()
}

/// 探す順（先にあるほど優先）。**いつも同じ Python を使う**ことが要る（以前の update.bat も同じ探し方だった）——起動前の確認の刻印と端末の控え
/// （§9.545）は Python が書き、Microsoft Store 版の Python は書いた物を自分にしか見えない写しへ回すので、違う Python
/// だと別々の物を見る。**PATH を前から見て、最初に pythonw.exe がある場所の python.exe**（並べ替えない）。
/// その前に WAVELOG_PYTHON（指定があれば・開発と CI 用）、後ろに PATH の最初の python.exe と py ランチャー。
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
        assert_eq!(c[0].exe, PathBuf::from("/given/python"), "指定された Python（WAVELOG_PYTHON）が先");
        if !cfg!(windows) {
            assert_eq!(c[1].exe, a.join("python3"), "PATH の順は並べ替えない（いつも同じ Python）");
            assert_eq!(c[2].exe, b.join("python3"));
        }
    }
}
