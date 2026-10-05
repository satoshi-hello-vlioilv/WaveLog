//! 測定伝送システム（WaveLog）デスクトップ版の窓（Tauri）。設計は docs/DESKTOP_MIGRATION_DESIGN.md、記録は §9.544。
//!
//! 役割の分け方:
//!   - Rust（この exe）: 窓・起動と終了・1つだけ起動・静的ファイル・中身（Python）の監督と起こし直し・外のリンク・
//!     デスクトップのショートカット（`--lnk`・決めるのは Python・§9.552）
//!   - Python（program/sidecar.py）: 画面と API のすべて（Flask のアプリそのまま）。**共有DBの管理も Python のまま**
//!     （錠・改訂番号・写し・在席・書込役。ブラウザ版の端末と同じ作法で共有へ書くため。§9.544）
//!   - 画面（WebView2）: これまでと同じ HTML/JS/CSS。問い合わせは自前の仕組み（wavelog）で Rust が受ける
//!
//! ポートを開かないので、プロキシ・ポートの取り合い・古いサーバーの残り・ハートビートによる推し量りが無い。
//! 書込役の LAN の受け口（PORT+1）は Python が今までどおり開く（画面のポートとは別・端末どうしの約束）。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod close;
mod frame;
mod install;
mod launch;
mod lnk;
mod locate;
mod proc;
mod router;
mod sidecar;
mod update;

use router::{error_reply, After, Native, Router};
use serde_json::json;
use sidecar::{Progress, Reply, Supervisor};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

/// 自前の仕組みの名前。backend/config.py の DESKTOP_SCHEME と同じ（食い違うと URL の組み立てがずれる）。
const SCHEME: &str = "wavelog";
const TITLE: &str = "測定伝送システム";
const SELFTEST_JS: &str = include_str!("selftest.js");
const SELFTEST_LIMIT: Duration = Duration::from_secs(180);
/// 明示停止のあと、中身（Python）が片付けて終わるのを待つ長さ（片付けの持ち時間3秒＋余裕）。
const QUIT_WAIT: Duration = Duration::from_secs(6);

/// 画面の置き場。Windows（WebView2）は http://wavelog.localhost/、ほかは wavelog://localhost/ になる（Tauri の決まり）。
fn app_url(path: &str) -> Url {
    let base = if cfg!(windows) { "http://wavelog.localhost" } else { "wavelog://localhost" };
    Url::parse(&format!("{base}{path}")).expect("app url")
}

fn is_app_url(u: &Url) -> bool {
    u.scheme() == SCHEME || u.host_str() == Some("wavelog.localhost")
}

/// 起動画面（desktop/splash。Tauri が tauri://localhost で出す）
fn is_splash(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

/// 窓の記録（この PC の作業場所の logs/desktop.log）。Python の記録（launcher.log・app.log）とは別に、
/// 窓が確かめた事実（探した Python・起動の秒・終わり方）だけを残す。
fn log(line: &str) {
    let dir = locate::local_root().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("desktop.log")) {
        let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let _ = writeln!(f, "{t} {line}");
    }
}

type AppRouter = Router<Supervisor>;

/// 起動画面へ伝えること。画面が読み終わる前の分はためておき、読み終わったら流す。
#[derive(Default)]
struct Splash {
    loaded: AtomicBool,
    queue: Mutex<Vec<String>>,
}

impl Splash {
    fn say(&self, app: &AppHandle, js: String) {
        if self.loaded.load(Ordering::SeqCst) {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval(&js);
            }
        } else {
            self.queue.lock().unwrap().push(js);
        }
    }
    fn flush(&self, w: &WebviewWindow) {
        self.loaded.store(true, Ordering::SeqCst);
        for js in self.queue.lock().unwrap().drain(..) {
            let _ = w.eval(&js);
        }
    }
    fn step(&self, app: &AppHandle, id: &str, state: &str, detail: &str) {
        self.say(app, format!("splash.step(...{})", json!([id, state, detail])));
    }
    fn fail(&self, app: &AppHandle, title: &str, detail: &str) {
        log(&format!("FAIL {title}: {}", detail.replace('\n', " / ")));
        self.say(app, format!("splash.fail(...{})", json!([title, detail])));
        selftest_finish(app, &json!({"ok": false, "error": format!("{title}: {detail}")}));
    }
}

/// 自己診断の結果を書いて終わる（WAVELOG_SELFTEST が無ければ何もしない）。
fn selftest_finish(app: &AppHandle, result: &serde_json::Value) {
    if let Some(path) = std::env::var_os("WAVELOG_SELFTEST") {
        let _ = std::fs::write(&path, serde_json::to_vec_pretty(result).unwrap_or_default());
        let code = if result["ok"] == true { 0 } else { 1 };
        app.exit(code);
    }
}

/// 閉じる前の確かめ（`close.rs`・§9.556）。窓の×と画面の返事（`/__desktop/close`）が同じ1つを見る。
fn gate() -> &'static close::Gate {
    static G: OnceLock<close::Gate> = OnceLock::new();
    G.get_or_init(close::Gate::default)
}

/// 主の窓の×。失うものがあるかを画面に聞き、返事が無ければ待ち切って閉じる（`close.rs`）。
fn on_close_requested(w: &tauri::Window, api: &tauri::CloseRequestApi) {
    if w.label() != "main" {
        return;
    }
    match gate().request() {
        close::Decision::Ask(seq) => {
            api.prevent_close();
            if let Some(v) = w.app_handle().get_webview_window("main") {
                let _ = v.eval(close::ASK_JS);
            }
            let app = w.app_handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(close::ANSWER_WAIT);
                if gate().timeout(seq) == close::Decision::Close {
                    log("EXIT 窓を閉じた（画面が返事をしなかったので待ち切った）");
                    app.exit(0);
                }
            });
        }
        close::Decision::Hold => api.prevent_close(),
        _ => {}
    }
}

/// 窓そのものが答える問い合わせ（窓の情報・閉じる前の返事・自己診断の受け口）。
fn native(app: AppHandle, info: serde_json::Value) -> Native {
    Box::new(move |method, path, body| match (method, path) {
        ("POST", "/__desktop/close") => {
            let word = serde_json::from_slice::<serde_json::Value>(body).ok();
            let word = word.as_ref().and_then(|v| v["answer"].as_str()).unwrap_or("");
            if gate().answer(word) == close::Decision::Close {
                log("EXIT 窓を閉じた（閉じる前の確かめを通った）");
                let app = app.clone();
                std::thread::spawn(move || app.exit(0));
            }
            Some(json_reply(&json!({"received": true})))
        }
        ("GET", "/__desktop/info") => Some(json_reply(&info)),
        ("GET", "/__desktop/downloads") => Some(json_reply(&json!(downloads().lock().map(|v| v.clone()).unwrap_or_default()))),
        ("POST", "/__desktop/selftest") => {
            let result: serde_json::Value = serde_json::from_slice(body).unwrap_or_else(|e| json!({"ok": false, "error": e.to_string()}));
            selftest_finish(&app, &result);
            Some(json_reply(&json!({"received": true})))
        }
        _ => None,
    })
}

/// 中身が答えたあと: 明示停止（/api/shutdown）が受け付けられたら、中身が**片付け（書込役・編集セッション・在席）を
/// 済ませて自分で終わる**のを待ってから窓も閉じる。画面の「アプリを終了」（/api/app/quit）は §9.556 で外した（×で閉じる）。
fn after(app: AppHandle, slot: Arc<OnceLock<AppRouter>>) -> After {
    Box::new(move |method, path, status| {
        if method == "POST" && status == 200 && path == "/api/shutdown" {
            let (app, slot, path) = (app.clone(), slot.clone(), path.to_string());
            std::thread::spawn(move || {
                let end = Instant::now() + QUIT_WAIT;
                while Instant::now() < end && slot.get().is_some_and(|r| r.backend.is_running()) {
                    std::thread::sleep(Duration::from_millis(100));
                }
                log(&format!("EXIT 画面の終了（{path}）"));
                app.exit(0);
            });
        }
    })
}

fn json_reply(v: &serde_json::Value) -> Reply {
    Reply {
        status: 200,
        headers: vec![("Content-Type".into(), "application/json".into())],
        body: serde_json::to_vec(v).unwrap_or_default(),
    }
}

/// 窓を作る（主の窓・別の窓で同じ決まり: 外のリンクはいつものブラウザで開く）。
fn window(app: &AppHandle, label: &str, url: WebviewUrl, splash: Arc<Splash>) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let nav = app.clone();
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title(TITLE)
        .inner_size(1600.0, 1000.0)
        .min_inner_size(1100.0, 700.0)
        .maximized(label == "main")
        .background_color(tauri::window::Color(0x0d, 0x20, 0x29, 0xff))
        // マスタの取り込みはエクスプローラーからのファイルのドロップを画面が読む（master-maint.js）。
        // Tauri は既定で窓へのドロップを横取りするので切る（§9.544・設計書 §4-4）
        .disable_drag_drop_handler()
        .on_navigation(move |u| {
            let inside = is_app_url(u) || is_splash(u) || matches!(u.scheme(), "about" | "blob" | "data");
            if !inside {
                open_outside(&nav, u);
            }
            inside
        })
        .on_new_window(move |u, _features| {
            if is_app_url(&u) {
                let app = handle.clone();
                let s = Arc::new(Splash::default());
                let label =
                    format!("w{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
                // 窓は作り終えてから（呼ばれている最中に作ると止まることがある）
                std::thread::spawn(move || {
                    let _ = window(&app, &label, WebviewUrl::External(u), s);
                });
            } else {
                open_outside(&handle, &u);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |w, p| {
            if p.event() != PageLoadEvent::Finished {
                return;
            }
            if is_splash(p.url()) {
                splash.flush(&w);
            } else if is_app_url(p.url()) && p.url().path() == "/" && std::env::var_os("WAVELOG_SELFTEST").is_some() {
                let _ = w.eval(SELFTEST_JS);
            }
        });
    // 自己診断のときだけ保存を記録する（利用者の起動では WebView2 の既定の案内のまま・上の downloads()）
    let builder = if std::env::var_os("WAVELOG_SELFTEST").is_some() { builder.on_download(|_, ev| record_download(ev)) } else { builder };
    builder.build()
}

/// LotDsp など外のページは、いつものブラウザ（Edge）で開く（ログイン・LotData-Link はそちらにある・§9.521）。
fn open_outside(app: &AppHandle, u: &Url) {
    if matches!(u.scheme(), "http" | "https" | "mailto" | "file") {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().open_url(u.as_str(), None::<&str>);
    }
}

/// 保存（ダウンロード）の記録。**自己診断のときだけ**付ける受け手（`record_download`）が書き、
/// `/__desktop/downloads` が画面の自己診断へ渡す（§9.551）。利用者の起動では受け手を付けない——付けると
/// WebView2 の既定の保存の案内（右上の小窓）が出なくなる（wry が DownloadStarting の Handled を立てる）。
fn downloads() -> &'static Mutex<Vec<serde_json::Value>> {
    static D: OnceLock<Mutex<Vec<serde_json::Value>>> = OnceLock::new();
    D.get_or_init(Mutex::default)
}

/// 保存の始まりと終わりを残す（終わりは置いた先・大きさ・先頭4バイト）。保存先は変えない（既定の「ダウンロード」）。
fn record_download(ev: DownloadEvent<'_>) -> bool {
    let row = match ev {
        DownloadEvent::Requested { url, destination } => {
            json!({"state": "requested", "url": url.as_str(), "path": destination.display().to_string()})
        }
        DownloadEvent::Finished { url, path, success } => {
            let body = path.as_ref().and_then(|p| std::fs::read(p).ok()).unwrap_or_default();
            let head: String = body.iter().take(4).map(|b| format!("{b:02x}")).collect();
            json!({"state": "finished", "url": url.as_str(), "path": path.map(|p| p.display().to_string()),
                   "success": success, "bytes": body.len(), "head": head})
        }
        _ => return true,
    };
    log(&format!("DOWNLOAD {row}"));
    if let Ok(mut v) = downloads().lock() {
        v.push(row);
    }
    true
}

/// 手元へ写した古い版の exe を片付ける（入口が版ごとのフォルダへ写す・`launch.rs`・設計書 §7）。
/// 入口（`desktop\\WaveLog.exe`）と控え（`program.txt`）はファイルなので触らない（消すのはフォルダだけ）。
/// **動いている版は消せない**（Windows は動いている exe を掴む）ので、消せたものだけ消す。
fn cleanup_old_copies() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(mine) = exe.parent() else { return };
    let Some(root) = mine.parent() else { return };
    if root.file_name().and_then(|n| n.to_str()) != Some("desktop") || !root.starts_with(locate::local_root()) {
        return; // 手元へ写した形でなければ触らない（作る途中・ほかの置き場）
    }
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let p = e.path();
        if p.is_dir() && p != mine && std::fs::remove_dir_all(&p).is_ok() {
            log(&format!("CLEAN 古い版の写しを消しました: {}", p.display()));
        }
    }
}

/// 版の確かめ（共有の置き場・最大3秒）を裏で始める（§9.561、利用者の承認「起動の順番…同時に進める改善は、進めてよい」）。
/// 前は確かめ終わってから Python を起こしていた（起動＝確かめ＋Python の起動）。いまは同時に進め、起動＝長いほうになる。
fn peek_in_background(root: &Path) -> mpsc::Receiver<(update::Peek, Duration)> {
    let (tx, rx) = mpsc::channel();
    let (root, t0) = (root.to_path_buf(), Instant::now());
    std::thread::spawn(move || {
        let p = update::peek(&root);
        let _ = tx.send((p, t0.elapsed()));
    });
    rx
}

/// 確かめた答えに従う。配る版と違えば**Python を止めてから**入れ替え、起こし直す（動いている Python のファイルを入れ替えない）。
/// exe も変わって新しい窓で開き直すなら None（この窓は終わる）。そろえられなくても起動は止めない（理由は起動画面と記録へ）。
fn settle_update(
    app: &AppHandle,
    root: &Path,
    peek: update::Peek,
    sup: &Supervisor,
    started: Result<Arc<sidecar::Sidecar>, String>,
    splash: &Arc<Splash>,
) -> Option<Result<Arc<sidecar::Sidecar>, String>> {
    let (have, want, dir) = match peek {
        update::Peek::Same(v) => {
            splash.step(app, "update", "ok", &format!("版 {v}（配る版と同じ）"));
            return Some(started);
        }
        update::Peek::Skip(why) => {
            log(&format!("UPDATE 確かめませんでした: {why}"));
            splash.step(app, "update", "ok", &format!("確かめませんでした（{why}）。いまの版で起動します"));
            return Some(started);
        }
        update::Peek::Bad(why) => {
            log(&format!("UPDATE そろえられませんでした: {why}"));
            splash.step(app, "update", "warn", &format!("そろえられませんでした（{why}）。いまの版で起動します"));
            return Some(started);
        }
        update::Peek::Differs { have, want, dir } => (have, want, dir),
    };
    // 持っている写し（Arc）を先に手放す——残すと Supervisor が手放しても Python が終わらず、ファイルを掴んだまま入れ替えに当たる
    drop(started);
    sup.stop();
    let (a, s) = (app.clone(), splash.clone());
    let progress = move |t: &str| s.step(&a, "update", "now", t);
    match update::apply(root, &dir, &have, &want, &log, &progress) {
        update::Outcome::Applied { from, to, exe_changed } => {
            splash.step(app, "update", "ok", &format!("{from} → {to} にそろえました"));
            if exe_changed && launch::relaunch(&root.join("program"), &log) {
                splash.step(app, "open", "now", "窓も新しくなったので、開き直しています…");
                app.exit(0);
                return None;
            }
        }
        other => {
            let why = match other {
                update::Outcome::Failed(w) | update::Outcome::Skipped(w) => w,
                _ => String::new(),
            };
            log(&format!("UPDATE そろえられませんでした: {why}"));
            splash.step(app, "update", "warn", &format!("そろえられませんでした（{why}）。いまの版で起動します"));
        }
    }
    splash.step(app, "backend", "now", "新しい版の中身を読み込んでいます…");
    Some(sup.get())
}

/// 初回のインストール（§9.559）。この PC にアプリが在ればそれを使い、無ければ`%USERPROFILE%\WaveLog`へ配る版を写す。
/// 進み具合は起動画面の段「版をそろえる」に出す（写すのは更新と同じ道）。
fn first_install(app: &AppHandle, from: &Path, splash: &Arc<Splash>) -> Result<std::path::PathBuf, String> {
    splash.step(app, "update", "now", &format!("初めての起動です。共有の置き場（{}）からこの PC へアプリを写しています…", from.display()));
    let (a, s) = (app.clone(), splash.clone());
    let progress = move |t: &str| s.step(&a, "update", "now", &format!("初めての起動: {t}"));
    let program = install::program_for(from, &log, &progress)?;
    splash.step(app, "update", "ok", &format!("この PC のアプリ: {}", program.parent().unwrap_or(&program).display()));
    Ok(program)
}

/// 中身（Python）を探して起こし、準備できたら主の窓を画面へ切り替える（裏の糸で。窓は先に出しておく）。
fn start(app: AppHandle, slot: Arc<OnceLock<AppRouter>>, splash: Arc<Splash>, from: Option<std::path::PathBuf>) {
    let program = match from {
        // 共有の入口から（§9.559）: この PC にまだ無ければ、配る版を写してから起動する
        Some(dir) => match first_install(&app, &dir, &splash) {
            Ok(p) => p,
            Err(e) => return splash.fail(&app, "この PC へアプリを写せません", &e),
        },
        None => match locate::program_dir() {
            Ok(p) => p,
            Err(e) => return splash.fail(&app, "アプリの中身が見つかりません", &e),
        },
    };
    // 配る版の確かめ（§9.555）は裏で始め、そのあいだに中身（Python）を起こす（§9.561）。入れ替えるのは Python を止めてから
    let root = program.parent().unwrap_or(&program).to_path_buf();
    splash.step(&app, "update", "now", "共有の置き場で、配る版を確かめています…");
    let peeked = peek_in_background(&root);
    // 入口（ショートカットの行き先）をこの版にそろえる。中身（Python）がショートカットを付け替える前に置く（§9.554）
    launch::refresh_entry(&log);
    let py = match locate::python() {
        Ok(p) => p,
        Err(e) => {
            splash.step(&app, "python", "bad", "見つかりません");
            return splash.fail(&app, "Python が見つかりません", &e);
        }
    };
    let py_text = format!("{} {}", py.exe.display(), py.args.join(" ")).trim().to_string();
    log(&format!("START program={} python={py_text}", program.display()));
    splash.step(&app, "python", "ok", &py_text);
    splash.step(&app, "backend", "now", "Python でアプリの中身を読み込んでいます…");
    let (app_p, splash_p) = (app.clone(), splash.clone());
    let progress: Progress = Arc::new(move |h| {
        let text = h["text"].as_str().unwrap_or("起動前の確認をしています");
        splash_p.step(&app_p, "backend", if h["bad"] == true { "warn" } else { "now" }, text);
    });
    let sup = Supervisor::new(py, program.clone(), locate::local_root().join("logs"), progress);
    let t0 = Instant::now();
    let started = sup.get();
    let py_took = t0.elapsed();
    // 版の答えを待つ（中身の起動と重なったぶん、前より早い）。起動に失敗していても、配る版へそろえれば直ることがある
    let (peek, peek_took) = peeked.recv().unwrap_or((update::Peek::Skip("版の確かめが途中で止まりました".into()), Duration::ZERO));
    log(&format!("TIMING 版の確かめ {}ms・中身の起動 {}ms（同時に進めた）", peek_took.as_millis(), py_took.as_millis()));
    let Some(started) = settle_update(&app, &root, peek, &sup, started, &splash) else { return };
    let ready = match started {
        Ok(s) => {
            // 起こした物と本物が違えば、入口（別名の python.exe）を通っている（§9.571・止めるときは本物を待つ）
            if let (spawned, Some(real)) = s.pids() {
                log(&format!("PID 起こした {spawned}・本物の Python {real}（入口を通っている。止めるときは本物を待つ）"));
            }
            s.ready.clone()
        }
        Err(e) => {
            splash.step(&app, "backend", "bad", "起動できません");
            return splash.fail(&app, "アプリの中身（Python）が起動できません", &e);
        }
    };
    let elapsed = ready["elapsed"].as_f64().unwrap_or(0.0);
    log(&format!("READY version={} elapsed={elapsed:.2}", ready["version"].as_str().unwrap_or("?")));
    splash.step(&app, "backend", "ok", &format!("版 {} ・ {:.1} 秒", ready["version"].as_str().unwrap_or("?"), elapsed));
    let info = json!({
        "shell": "tauri", "shell_version": env!("CARGO_PKG_VERSION"), "commit": env!("WAVELOG_BUILD_COMMIT"), "protocol": sidecar::PROTOCOL,
        "program": program, "python": py_text,
        "exe": std::env::current_exe().unwrap_or_default(), "entry": launch::entry_path(), "backend": ready, "url": app_url("/").as_str(),
    });
    let static_dir = program.parent().unwrap_or(Path::new(".")).join("static");
    let _ = slot.set(Router { static_dir, backend: sup, native: native(app.clone(), info), after: after(app.clone(), slot.clone()) });
    splash.step(&app, "open", "now", "画面を開いています…");
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(app_url("/"));
    }
    std::thread::spawn(cleanup_old_copies);
}

fn main() {
    // 副コマンド: ショートカットを1件作る／読むだけで終わる（窓・1つだけ起動の仕組みより前に分ける・§9.552）
    if std::env::args().nth(1).as_deref() == Some(lnk::ARG) {
        std::process::exit(lnk::run());
    }
    // 更新で開き直したとき: 前の窓が終わるのを待つ（「1つだけ起動」が前の窓へ回さないように・§9.555）
    launch::wait_for_previous(Duration::from_secs(15));
    // 配る入口（共有の置き場の直下）から起こされたら、この PC の写しへ渡して終わる（§9.559）。
    // 写しは`--install-from`を受け、アプリが無ければ写してから起動する
    let from = match install::handoff_from_share(&log) {
        install::FromShare::HandedOff => return,
        install::FromShare::Here(dir) => Some(dir),
        install::FromShare::No => install::from_arg(),
    };
    // 入口: アプリの program\WaveLog.exe・入口から起こされたら、この PC の版ごとの写しへ渡して終わる（§9.554）。
    // 中身が見つからないときは渡さずに進み、起動画面が理由を出す（start() が同じ答えをもう一度引く）
    if let Ok(program) = locate::program_dir() {
        if launch::handoff(&program, &log) {
            return;
        }
    }
    let slot: Arc<OnceLock<AppRouter>> = Arc::default();
    let splash: Arc<Splash> = Arc::default();
    let proto_slot = slot.clone();

    let app = tauri::Builder::default()
        // 2つめを起こしたら、前の窓を前に出すだけ（ポートを見て止め直す仕組みが要らない）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        // ×: 失うもの（保存していない測定・版を置いている最中）があれば閉じる前に聞く（§9.556）
        .on_window_event(|w, ev| {
            if let WindowEvent::CloseRequested { api, .. } = ev {
                on_close_requested(w, api);
            }
        })
        // 画面からの問い合わせ（wavelog）。1つずつ別の糸で答える（長い問い合わせが画面を止めない）
        .register_asynchronous_uri_scheme_protocol(SCHEME, move |_ctx, req, responder| {
            let slot = proto_slot.clone();
            std::thread::spawn(move || {
                let resp = match slot.get() {
                    Some(r) => r.handle(&req),
                    None => {
                        let r = error_reply(503, "starting", "起動中です。");
                        let mut b = tauri::http::Response::builder().status(r.status);
                        for (k, v) in r.headers {
                            b = b.header(k, v);
                        }
                        b.body(r.body).unwrap()
                    }
                };
                responder.respond(resp);
            });
        })
        .setup({
            let slot = slot.clone();
            let splash = splash.clone();
            let from = from.clone();
            move |app| {
                let handle = app.handle().clone();
                window(&handle, "main", WebviewUrl::App("index.html".into()), splash.clone())?;
                if std::env::var_os("WAVELOG_SELFTEST").is_some() {
                    let h = handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(SELFTEST_LIMIT);
                        selftest_finish(&h, &json!({"ok": false, "error": format!("{} 秒で終わりませんでした", SELFTEST_LIMIT.as_secs())}));
                    });
                }
                std::thread::spawn(move || start(handle, slot, splash, from));
                Ok(())
            }
        })
        .build(tauri::generate_context!())
        .expect("起動できません");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            // 中身の Python を止める（入力を閉じる → 片付けて自分で終わる。終わらなければ止める）
            if let Some(r) = slot.get() {
                r.backend.stop();
            }
            log("EXIT 窓を閉じた");
        }
    });
}
