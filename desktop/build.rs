//! 作る前の準備: アイコンを描いてから Tauri の準備へ渡す。
//! アイコンの絵は `backend/app_icon.py` の1箇所が描く（§9.410。ショートカットと同じ絵・同じ色）。
//! `.ico` をリポジトリへ置くと同じ絵が2箇所になり、片方だけ直した状態が作れるので、作るたびに書き出す。
use std::path::Path;
use std::process::Command;

const DRAW: &str = "import sys,pathlib;sys.path.insert(0,'..');from backend import app_icon;\
d=pathlib.Path('icons');d.mkdir(exist_ok=True);\
(d/'icon.ico').write_bytes(app_icon.build());(d/'icon.png').write_bytes(app_icon.png(256))";

fn main() {
    println!("cargo:rerun-if-changed=../backend/app_icon.py");
    println!("cargo:rerun-if-env-changed=WAVELOG_PYTHON");
    let py = std::env::var("WAVELOG_PYTHON").unwrap_or_else(|_| if cfg!(windows) { "python".into() } else { "python3".into() });
    let ok = Command::new(&py).args(["-c", DRAW]).env("PYTHONDONTWRITEBYTECODE", "1").status().map(|s| s.success()).unwrap_or(false);
    if !ok && !Path::new("icons/icon.ico").is_file() {
        panic!("アイコンを描けません（{py} で backend/app_icon.py を呼べません）。Python を入れるか WAVELOG_PYTHON で場所を渡してください");
    }
    tauri_build::build()
}
