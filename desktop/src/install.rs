//! 初回のインストール（§9.559、利用者の指示「初回に配布する際に、ショットカット(アドレス)だけ渡すという形に
//! できないか…必要なものはそこから初回起動でコピーされ、アプリのショートカットがデスクトップになければ、許可を求め
//! つくられる」）。
//!
//! 配る版を決めると、共有の置き場の直下に**配る入口**（`<置き場>\WaveLog.exe`）が置かれる（`backend/app_update.py`の
//! `place_entry()`）。新しい PC にはこの exe へのアドレスだけを渡す。起こされたら:
//!   1. 入口（共有）: 自分をこの PC の版ごとの写し（`launch::desktop_dir()`）へ写し、`--install-from <置き場>`を付けて
//!      渡して終わる（共有の exe を掴み続けない・§9.554 と同じ理由）。`shared_entry_dir()`・`handoff_from_share()`
//!   2. 写しの窓: アプリの中身がまだ無ければ、この PC の決まった場所（`home_app()`＝`%USERPROFILE%\WaveLog`）へ
//!      **配る版を写す**（`run()`）——写し方と確かめ方（sha256）は更新（`update::check_and_apply()`）と同じ道。
//!      その前に新しい PC へ渡す設定（`<置き場>\install.json`＝共有のマスタの置き場）を`config\local.json`へ写す。
//!   3. そのまま起動する。デスクトップの起動アイコンは、画面が「作りますか」と聞く（`desktop_shortcut.offer()`）。
//!
//! **写す先を AppData の外にする理由**（利用者の選択）: Microsoft Store 版の Python は`AppData`への書込をその
//! Python だけに見える写しへ回す（§9.318）。アプリのフォルダの`config\update.json`は Python が書いて窓が読むので、
//! `AppData`の下に置くと窓から見えない。
//!
//! すでにこの PC にアプリがあれば（前に使った program フォルダ・`home_app()`）写さず、そのまま使う。

use crate::{launch, locate, update};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

/// 配る入口の名前（`backend/app_update.py`の`ENTRY_EXE`と同じ字）。
pub const ENTRY: &str = "WaveLog.exe";
/// 新しい PC へ渡す設定（`app_update.SEED`と同じ字）。
pub const SEED: &str = "install.json";
/// 渡す鍵（`app_update.SEED_KEYS`と同じ並び）。共有のマスタの置き場だけ——ほかはその PC の物。
pub const SEED_KEYS: [&str; 2] = ["master_db_path", "master_share_mode"];
/// 写しへ渡すときの引数（どの置き場から入れるか）。
pub const ARG: &str = "--install-from";

/// いま動いている exe が**共有の配る入口**なら、その置き場。入口の印は「同じフォルダに`release.json`と`versions`が在る」こと
/// （アプリのフォルダの`program\WaveLog.exe`や、この PC の写しとは取り違えない）。
pub fn shared_entry_dir(me: &Path) -> Option<PathBuf> {
    let name = me.file_name()?.to_str()?;
    if !name.eq_ignore_ascii_case(ENTRY) {
        return None;
    }
    let dir = me.parent()?;
    (dir.join("release.json").is_file() && dir.join("versions").is_dir()).then(|| dir.to_path_buf())
}

/// 写す先（この PC の決まった場所）。`WAVELOG_INSTALL_ROOT`は網と開発のため。
pub fn home_app() -> PathBuf {
    if let Some(p) = std::env::var_os("WAVELOG_INSTALL_ROOT") {
        return PathBuf::from(p);
    }
    let home =
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    home.join("WaveLog")
}

/// アプリの中身が在るか（program フォルダの印は`locate`と同じ`sidecar.py`）。
pub fn installed(app: &Path) -> bool {
    app.join("program").join("sidecar.py").is_file()
}

/// 引数`--install-from <置き場>`の値。
pub fn from_arg() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == ARG).and_then(|i| args.get(i + 1)).map(PathBuf::from)
}

/// 共有の入口から起こされたときの行き先。
#[derive(Debug, PartialEq)]
pub enum FromShare {
    /// 共有の入口ではない
    No,
    /// この PC の写しへ渡した（呼ぶ側はすぐ終わる）
    HandedOff,
    /// 写せない・起こせないので、ここ（共有の exe）で動いて入れる
    Here(PathBuf),
}

/// 共有の入口から起こされたら（手順の1）、この PC の写しへ`--install-from <置き場>`を付けて渡す。
/// 写せない・起こせないときは**そのまま動く**（共有から動いて入れる・窓が出ないよりよい）。理由は記録に残す。
pub fn handoff_from_share(log: &dyn Fn(&str)) -> FromShare {
    let Ok(me) = std::env::current_exe() else { return FromShare::No };
    let Some(dir) = shared_entry_dir(&me) else { return FromShare::No };
    let Some(st) = launch::stamp(&me) else { return FromShare::Here(dir) };
    let dst = launch::desktop_dir().join(st).join(launch::EXE);
    if !dst.is_file() {
        if let Err(e) = launch::install(&me, &dst) {
            log(&format!("INSTALL 入口を写せないので、共有から動きます: {e}"));
            return FromShare::Here(dir);
        }
    }
    match std::process::Command::new(&dst).arg(ARG).arg(&dir).spawn() {
        Ok(_) => {
            log(&format!("INSTALL 共有の入口から渡しました: {} → {}", me.display(), dst.display()));
            FromShare::HandedOff
        }
        Err(e) => {
            log(&format!("INSTALL 写しを起こせないので、共有から動きます（{}）: {e}", dst.display()));
            FromShare::Here(dir)
        }
    }
}

/// 共有の置き場の「新しい PC へ渡す設定」（`<置き場>\install.json`）を、この PC の`config\install.json`へ写す（§9.568）。
/// **写しの書き手は窓だけ**・`config\local.json`は書かない（その PC が決めた値の書き手は Python の1言語・§9.563）。
/// 置き場に`install.json`が無ければ空の`{}`を置く——「共有の置き場から入れた PC」の印になり、Python はマスタの置き場を
/// 既定（利用者の指定の共有の場所）で決める（`paths.seed_value()`）。届かなければ前の写しのまま（触らない）。
/// 置き場が既定でなければ、置き場の控え（`config\update.json`）へ**入れた元**として印（`from: install`）を付けて書く。
pub fn seed_config(app: &Path, from: &Path) -> Vec<String> {
    let mut said = vec![];
    let conf = app.join("config");
    let _ = std::fs::create_dir_all(&conf);
    said.extend(mirror_seed(&conf, from));
    let mirror = conf.join(update::MIRROR);
    if from != Path::new(update::DEFAULT_DIR) && !mirror.exists() {
        let text = serde_json::json!({ update::CONFIG_KEY: from.display().to_string(), "from": "install" }).to_string();
        let _ = std::fs::write(&mirror, text);
    }
    said
}

/// `<置き場>\install.json` → `config\install.json`（渡す鍵だけ・`SEED_KEYS`）。届いたときだけ書く。→ 言うこと。
pub fn mirror_seed(conf: &Path, from: &Path) -> Vec<String> {
    let src = from.join(SEED);
    let seed: Value = match std::fs::read(&src) {
        Ok(b) => serde_json::from_slice(b.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&b)).unwrap_or(Value::Null),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && from.is_dir() => Value::Null,
        Err(_) => return vec![], // 届かない——前の写しのまま
    };
    let vals: Map<String, Value> = SEED_KEYS
        .iter()
        .filter_map(|k| seed[*k].as_str().filter(|s| !s.trim().is_empty()).map(|s| (k.to_string(), Value::from(s.trim()))))
        .collect();
    let text = serde_json::to_string_pretty(&Value::Object(vals.clone())).unwrap_or_default();
    let dst = conf.join(SEED);
    if std::fs::read_to_string(&dst).ok().as_deref() == Some(text.as_str()) {
        return vec![];
    }
    match std::fs::write(&dst, &text) {
        Ok(_) if vals.is_empty() => vec!["共有の置き場に新しい PC へ渡す設定がありません（マスタは既定の共有の場所を使います）".into()],
        Ok(_) => vec![format!("共有の置き場から渡す設定を写しました（{}）", dst.display())],
        Err(e) => vec![format!("渡す設定を写せません（{}）: {e}", dst.display())],
    }
}

/// この PC へ配る版を写す（手順の2・中身が無いときだけ）。→ 使う program フォルダ。
/// 写し方は更新と同じ（`update::check_and_apply()`＝写して sha256 を確かめ、項目ごとに置く・途中で失敗したら戻す）。
pub fn run(app: &Path, from: &Path, log: &dyn Fn(&str), progress: &dyn Fn(&str)) -> Result<PathBuf, String> {
    if installed(app) {
        return Ok(app.join("program"));
    }
    std::fs::create_dir_all(app).map_err(|e| format!("写す先を作れません（{}）: {e}", app.display()))?;
    for s in seed_config(app, from) {
        log(&format!("INSTALL {s}"));
    }
    match update::check_and_apply(app, log, progress) {
        update::Outcome::Applied { to, .. } => {
            log(&format!("INSTALL 版 {to} を写しました: {}", app.display()));
            Ok(app.join("program"))
        }
        update::Outcome::UpToDate(_) if installed(app) => Ok(app.join("program")),
        update::Outcome::Skipped(why) | update::Outcome::Failed(why) => Err(why),
        update::Outcome::UpToDate(v) => Err(format!("版 {v} の中身が見つかりません")),
    }
}

/// 使う program フォルダを決める（`--install-from`のとき）。前に使ったフォルダが在ればそれ、無ければ`home_app()`へ写す。
pub fn program_for(from: &Path, log: &dyn Fn(&str), progress: &dyn Fn(&str)) -> Result<PathBuf, String> {
    if let Ok(p) = locate::program_dir() {
        // 前に入れた PC でも、共有の入口から起こされたら**Python を起こす前に**渡す設定を写す（§9.568。
        // 起動のたびの写し（`update::peek()`）は Python と並んで走るので、その回の起動に間に合わないことがある）
        if let Some(app) = p.parent() {
            for s in mirror_seed(&app.join("config"), from) {
                log(&format!("INSTALL {s}"));
            }
        }
        return Ok(p);
    }
    let program = run(&home_app(), from, log, progress)?;
    locate::remember(&program);
    Ok(program)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("wl-install-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn knows_the_shared_entry() {
        let t = tmp("entry");
        let share = t.join("share");
        fs::create_dir_all(share.join("versions")).unwrap();
        fs::write(share.join(ENTRY), b"x").unwrap();
        assert_eq!(shared_entry_dir(&share.join(ENTRY)), None, "配る版が決まるまで入口ではない");
        fs::write(share.join("release.json"), r#"{"version":"2.446.0"}"#).unwrap();
        assert_eq!(shared_entry_dir(&share.join(ENTRY)), Some(share.clone()), "置き場の直下の exe は入口");
        let prog = t.join("app").join("program");
        fs::create_dir_all(&prog).unwrap();
        assert_eq!(shared_entry_dir(&prog.join(ENTRY)), None, "アプリのフォルダの exe は入口ではない");
        assert_eq!(shared_entry_dir(&share.join("other.exe")), None, "別の名前は入口ではない");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn seeds_the_config_without_overwriting() {
        let t = tmp("seed");
        let (app, share) = (t.join("app"), t.join("share"));
        fs::create_dir_all(&share).unwrap();
        fs::write(share.join(SEED), r#"{"master_db_path":"\\\\srv\\Records\\master.sqlite3","master_share_mode":"auto","db_dir":"C:\\x"}"#)
            .unwrap();
        fs::create_dir_all(app.join("config")).unwrap();
        fs::write(app.join("config/local.json"), r#"{"master_db_path":"mine"}"#).unwrap();
        seed_config(&app, &share);
        let v: Value = serde_json::from_slice(&fs::read(app.join("config").join(SEED)).unwrap()).unwrap();
        assert_eq!(v["master_db_path"], r"\\srv\Records\master.sqlite3", "共有のマスタの置き場を写しへ");
        assert!(v.get("db_dir").is_none(), "その PC の物（db_dir）は渡さない");
        assert_eq!(fs::read_to_string(app.join("config/local.json")).unwrap(), r#"{"master_db_path":"mine"}"#, "local.json は書かない（書き手は Python）");
        let mirror: Value = serde_json::from_slice(&fs::read(app.join("config").join(update::MIRROR)).unwrap()).unwrap();
        assert_eq!(mirror[update::CONFIG_KEY], share.display().to_string(), "既定でない置き場から入れたら控える");
        assert_eq!(mirror["from"], "install", "入れた元の印（Python が共有の設定の空で消さない・§9.561）");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn seed_mirror_is_empty_when_the_share_has_none_and_kept_when_unreachable() {
        let t = tmp("seed0");
        let (conf, share) = (t.join("conf"), t.join("share"));
        fs::create_dir_all(&conf).unwrap();
        fs::create_dir_all(&share).unwrap();
        mirror_seed(&conf, &share);
        assert_eq!(fs::read_to_string(conf.join(SEED)).unwrap(), "{}", "置き場に無ければ空（共有から入れた印）");
        fs::write(share.join(SEED), r#"{"master_db_path":"\\\\srv\\m.sqlite3"}"#).unwrap();
        mirror_seed(&conf, &share);
        assert!(fs::read_to_string(conf.join(SEED)).unwrap().contains("m.sqlite3"), "置き場が変われば写し直す");
        mirror_seed(&conf, &t.join("届かない"));
        assert!(fs::read_to_string(conf.join(SEED)).unwrap().contains("m.sqlite3"), "届かなければ前の写しのまま");
        let _ = fs::remove_dir_all(&t);
    }

    #[test]
    fn installs_the_release_into_an_empty_folder() {
        let t = tmp("run");
        let (app, share) = (t.join("app"), t.join("share"));
        update::tests::version(&share, "2.446.0", "new");
        fs::write(share.join("release.json"), r#"{"version":"2.446.0"}"#).unwrap();
        fs::write(share.join(SEED), r#"{"master_db_path":"\\\\srv\\m.sqlite3"}"#).unwrap();
        let out = run(&app, &share, &|_| {}, &|_| {});
        assert_eq!(out, Ok(app.join("program")), "写して program フォルダを返す");
        assert_eq!(update::local_version(&app).as_deref(), Some("2.446.0"), "配る版を写した");
        assert_eq!(fs::read_to_string(app.join("backend/a.py")).unwrap(), "new");
        assert!(app.join("config").join(SEED).is_file(), "共有のマスタの置き場も写した");
        assert!(!app.join("config/local.json").exists(), "local.json は書かない（書き手は Python・§9.568）");
        assert!(!app.join("db").exists(), "データは作らない（起動した中身が作る）");
        assert!(!app.join(update::WORK).join("2.446.0.stage").exists(), "途中の物を残さない");
        let _ = fs::remove_dir_all(&t);
    }
}
