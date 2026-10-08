// The desktop shell. It owns one window and one child process: the Songbe engine (Node running the same studio the command line
// serves). The engine prints the address it listens on; the window goes there. Nothing else lives here on purpose: every feature is
// in the engine and its pages, so the app, `songbe app` and `songbe studio` can never drift apart.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

struct Engine(Mutex<Option<Child>>);
type Log = Arc<Mutex<Option<File>>>;

// Windows hands out \\?\C:\… paths, which Node's module loader does not take
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

fn note(log: &Log, line: &str) {
    if let Some(f) = log.lock().unwrap().as_mut() {
        let _ = writeln!(f, "{line}");
    }
}

// back to the opening page, which explains what went wrong
fn fail(window: &WebviewWindow, splash: &Url, what: &str, log_file: &Path) {
    let mut url = splash.clone();
    let text: String = Url::parse_with_params("x:/", &[("what", what), ("log", &log_file.to_string_lossy())])
        .map(|u| u.query().unwrap_or("").to_string())
        .unwrap_or_default();
    url.set_fragment(Some(&text));
    let _ = window.navigate(url);
}

fn start(app: &AppHandle, window: WebviewWindow, splash: Url) {
    let data = app.path().app_local_data_dir().map(|p| plain(&p)).unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&data);
    let log_file = data.join("app.log");
    if fs::metadata(&log_file).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = fs::remove_file(&log_file);
    }
    let log: Log = Arc::new(Mutex::new(OpenOptions::new().create(true).append(true).open(&log_file).ok()));

    let here = std::env::current_exe().ok().and_then(|p| p.parent().map(plain)).unwrap_or_default();
    let node = here.join(if cfg!(windows) { "node.exe" } else { "node" });
    let script = app.path().resource_dir().map(|p| plain(&p)).unwrap_or_else(|_| here.clone()).join("core").join("bin").join("songbe.mjs");
    note(&log, &format!("--- start: engine {} {}", node.display(), script.display()));
    if !node.exists() || !script.exists() {
        return fail(&window, &splash, "missing", &log_file);
    }

    let mut cmd = Command::new(&node);
    cmd.arg(&script).args(["app", "--shell"]).env("SONGBE_DATA", &data).env("SONGBE_SHELL", "tauri")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { note(&log, &format!("could not start the engine: {e}")); return fail(&window, &splash, "missing", &log_file); }
    };
    let (out, err) = (child.stdout.take(), child.stderr.take());
    *app.state::<Engine>().0.lock().unwrap() = Some(child);       // its stdin stays open for as long as the app runs; the engine quits when it closes

    if let Some(mut err) = err {
        let log = log.clone();
        thread::spawn(move || {
            let mut text = String::new();
            let mut buf = [0u8; 4096];
            while let Ok(n) = err.read(&mut buf) {
                if n == 0 { break; }
                text.push_str(&String::from_utf8_lossy(&buf[..n]));
                while let Some(i) = text.find('\n') { note(&log, text[..i].trim_end()); text.drain(..=i); }
            }
        });
    }
    if let Some(out) = out {
        thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let ready = line.strip_prefix("SONGBE_READY ").and_then(|rest| serde_json::from_str::<serde_json::Value>(rest).ok())
                    .and_then(|v| v.get("url").and_then(|u| u.as_str()).and_then(|u| Url::parse(u).ok()));
                match ready {
                    Some(url) => { note(&log, &format!("engine ready at {url}")); let _ = window.navigate(url); }
                    None => note(&log, &line),
                }
            }
            note(&log, "the engine stopped");
            fail(&window, &splash, "stopped", &log_file);
        });
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(Engine(Mutex::new(None)))
        .setup(|app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Songbe")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1060.0, 680.0)
                .center()
                // the window only ever shows the opening page and the engine on this computer
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about") || matches!(url.host_str(), Some("tauri.localhost") | Some("127.0.0.1")));
            // for automated checks of the packaged app: SONGBE_DEVTOOLS_PORT=9333 exposes the window to a DevTools client
            #[cfg(windows)]
            let builder = match std::env::var("SONGBE_DEVTOOLS_PORT").ok().and_then(|p| p.parse::<u16>().ok()) {
                Some(port) => builder.additional_browser_args(&format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}")),
                None => builder,
            };
            let window = builder.build()?;
            let splash = window.url()?;
            start(app.handle(), window, splash);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not start Songbe");
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(mut child) = app.state::<Engine>().0.lock().unwrap().take() {
                // closing its stdin asks the engine to stop what it started (a build, a poster) and leave; then make sure
                drop(child.stdin.take());
                for _ in 0..40 {
                    if matches!(child.try_wait(), Ok(Some(_))) { break; }
                    thread::sleep(Duration::from_millis(50));
                }
                let _ = child.kill();
            }
        }
    });
}
