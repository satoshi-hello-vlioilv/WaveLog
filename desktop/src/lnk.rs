//! デスクトップの起動ショートカット（.lnk）を作る・読む（§9.552）。
//!
//! `.lnk` はただのファイルではなくシェルのオブジェクトなので、Windows の部品（COM の `IShellLinkW`）で作る。
//! 以前は Python が `cscript` で補助スクリプト（VBScript）を起こしていた（§9.410）が、その道には回り道が要った:
//! 補助スクリプトを英数字だけで書く（WSH は日本語を読み違える）・空の引数の代わりに印を渡す（WSH は空を数えない・§9.486）・
//! 補助スクリプトを「ほかのプログラムの置き場」へ置く（Store 版の Python の書込は写しへ回る・§9.496）。
//! ここは同じ部品を直に呼ぶので、どれも要らない。
//!
//! **決めるのは Python**（どこへ・どの名前で・上書きしてよいか・前の名前を片付けるか——`backend/desktop_shortcut.py`）。
//! ここは頼まれた1件を作る／読むだけ。頼みは標準入力の JSON 1つ、答えは標準出力の JSON 1つ（字は UTF-8・位置で読まない）。
//!
//!   `WaveLog.exe --lnk` ← `{"op":"make","path":…,"target":…,"args":…,"workdir":…,"icon":…,"iconIndex":0,"description":…}`
//!                       ← `{"op":"read","path":…}` → `{"ok":true,"target":…}`（無いファイルは空の行き先）
//!                       ← `{"op":"list","path":<フォルダ>}` → `{"ok":true,"links":[{"path":…,"target":…},…]}`
//!                         （フォルダの直下の`.lnk`を全部・読めない物は行き先を空で。比べるのは Python の`_same_path()`の1か所）

use serde_json::{json, Value};
use std::io::Read;

/// 副コマンドの印（窓を開かずに1件だけ答えて終わる）。
pub const ARG: &str = "--lnk";

/// 作る1件（Windows 以外では作らないので読まれない）。
#[cfg_attr(not(windows), allow(dead_code))]
pub struct Make<'a> {
    pub path: &'a str,
    pub target: &'a str,
    /// 行き先へ渡す引数（入口へ program フォルダを渡す `--program "…"`・§9.554）。空なら付けない
    pub args: &'a str,
    pub workdir: &'a str,
    pub icon: &'a str,
    pub icon_index: i32,
    pub description: &'a str,
}

/// 副コマンドの入口。戻り値は終了コード（0＝できた）。
pub fn run() -> i32 {
    let mut input = String::new();
    let answer = std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|e| format!("頼みを読めません: {e}"))
        .and_then(|_| serde_json::from_str::<Value>(&input).map_err(|e| format!("頼みの形が違います: {e}")))
        .and_then(|req| handle(&req));
    let (out, code) = match answer {
        Ok(v) => (v, 0),
        Err(e) => (json!({"ok": false, "error": e}), 1),
    };
    println!("{out}");
    code
}

/// 頼みを1件こなす（窓の外でも呼べる形にして網から確かめる）。
pub fn handle(req: &Value) -> Result<Value, String> {
    let text = |k: &str| req[k].as_str().unwrap_or("");
    let path = text("path");
    if path.is_empty() {
        return Err("ショートカットの置き場（path）がありません".into());
    }
    match text("op") {
        "read" => imp::read(path).map(|t| json!({"ok": true, "target": t})),
        "list" => Ok(json!({"ok": true, "links": list(std::path::Path::new(path))})),
        "make" => {
            if text("target").is_empty() {
                return Err("行き先（target）がありません".into());
            }
            let m = Make {
                path,
                target: text("target"),
                args: text("args"),
                workdir: text("workdir"),
                icon: text("icon"),
                icon_index: req["iconIndex"].as_i64().unwrap_or(0) as i32,
                description: text("description"),
            };
            imp::make(&m).map(|_| json!({"ok": true}))
        }
        other => Err(format!("知らない頼みです（op={other:?}。make／read／list のどれか）")),
    }
}

/// フォルダの直下の`.lnk`と、それぞれの行き先（§9.568）。**名前ではなく行き先で**「このアプリの起動アイコンが在るか」を
/// 確かめるために要る（利用者が名前を変えても・別の名前で作っても見つかる）。無いフォルダは空、読めない1件は行き先を空にする。
fn list(dir: &std::path::Path) -> Vec<Value> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Value> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("lnk")))
        .map(|p| {
            let path = p.display().to_string();
            json!({"path": path, "target": imp::read(&path).unwrap_or_default()})
        })
        .collect();
    out.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    out
}

#[cfg(windows)]
mod imp {
    use super::Make;
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    /// COM を使えるようにして1件こなし、片付ける。
    fn with_link<T>(f: impl FnOnce(&IShellLinkW) -> windows::core::Result<T>) -> Result<T, String> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| format!("Windows の部品（COM）を使えません: {e}"))?;
            let r = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER).and_then(|l| f(&l));
            CoUninitialize();
            r.map_err(|e| e.message().to_string())
        }
    }

    pub fn make(m: &Make) -> Result<(), String> {
        with_link(|l| unsafe {
            l.SetPath(&HSTRING::from(m.target))?;
            if !m.args.is_empty() {
                l.SetArguments(&HSTRING::from(m.args))?;
            }
            l.SetWorkingDirectory(&HSTRING::from(m.workdir))?;
            l.SetDescription(&HSTRING::from(m.description))?;
            if !m.icon.is_empty() {
                l.SetIconLocation(&HSTRING::from(m.icon), m.icon_index)?;
            }
            l.cast::<IPersistFile>()?.Save(&HSTRING::from(m.path), true)
        })
        .map_err(|e| format!("ショートカットを保存できません（{}）: {e}", m.path))
    }

    pub fn read(path: &str) -> Result<String, String> {
        if !std::path::Path::new(path).is_file() {
            return Ok(String::new()); // 無いファイルは「行き先が空」（以前の WSH と同じ答え）
        }
        with_link(|l| unsafe {
            l.cast::<IPersistFile>()?.Load(&HSTRING::from(path), STGM_READ)?;
            let mut buf = vec![0u16; 32768];
            l.GetPath(&mut buf, std::ptr::null_mut(), 0)?;
            let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Ok(String::from_utf16_lossy(&buf[..n]))
        })
        .map_err(|e| format!("ショートカットを読めません（{path}）: {e}"))
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Make;
    const WHY: &str = "ショートカットは Windows でだけ作れます";
    pub fn make(_: &Make) -> Result<(), String> {
        Err(WHY.into())
    }
    pub fn read(_: &str) -> Result<String, String> {
        Err(WHY.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_request_says_why() {
        assert!(handle(&json!({"op": "make"})).unwrap_err().contains("path"));
        assert!(handle(&json!({"op": "make", "path": "x.lnk"})).unwrap_err().contains("target"));
        assert!(handle(&json!({"op": "zap", "path": "x.lnk"})).unwrap_err().contains("make／read／list"));
    }

    #[test]
    fn list_of_missing_folder_is_empty() {
        let got = handle(&json!({"op": "list", "path": "/無いフォルダ/wl"})).unwrap();
        assert_eq!(got["links"].as_array().unwrap().len(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn make_then_read_gives_same_target() {
        let dir = std::env::temp_dir().join(format!("wl_lnk_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("起動 テスト.vbs");
        std::fs::write(&target, "'x").unwrap();
        let link = dir.join("測定伝送システム.lnk");
        let (l, t) = (link.to_string_lossy().to_string(), target.to_string_lossy().to_string());
        handle(&json!({"op": "make", "path": l, "target": t, "workdir": dir, "icon": "", "description": "説明"})).unwrap();
        let got = handle(&json!({"op": "read", "path": l})).unwrap();
        // 一時フォルダは 8.3 の短い名前（runner~1）で来ることがあり、読み戻すと長い名前になる——実際の場所で比べる
        let real = |p: &str| std::fs::canonicalize(p).unwrap();
        assert_eq!(real(got["target"].as_str().unwrap()), real(&t));
        assert_eq!(handle(&json!({"op": "read", "path": dir.join("無い.lnk")})).unwrap()["target"], "");
        // 一覧は名前ではなく行き先を返す（名前を変えても見つかる・§9.568）
        let renamed = dir.join("名前を変えた.lnk");
        std::fs::rename(&link, &renamed).unwrap();
        let links = handle(&json!({"op": "list", "path": dir})).unwrap()["links"].as_array().unwrap().clone();
        assert_eq!(links.len(), 1);
        assert_eq!(real(links[0]["target"].as_str().unwrap()), real(&t));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
