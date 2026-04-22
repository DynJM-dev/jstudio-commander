// Tauri v2 shell — JStudio Commander native v1.
// Scope strictly five categories per ARCHITECTURE_SPEC v1.2 §2.1:
// (1) Tauri config + window, (2) sidecar lifecycle, (3) IPC for OS integrations,
// (4) code signing + updater stub, (5) node-pty bridge — unused in N1 (pty in sidecar, §2.4 Option A).
// LOC budget ≤150 per §2.5. Any drift outside §2.1 categories → escalate per dispatch §5.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

// N2.1 hotfix: this must match the basename used in tauri.conf.json's
// bundle.externalBin entry ("../../sidecar/bundle/sidecar-bin" → "sidecar-bin").
// Previous value "jstudio-commander-sidecar" was descriptive but did not match
// the actual externalBin name, causing app.shell().sidecar() to return ENOENT
// on production Finder-launched builds (PHASE_N2.1_REPORT §5 issue A).
const SIDECAR_BIN: &str = "sidecar-bin";
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const BACKOFFS_S: [u64; 3] = [1, 3, 9];

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    attempts: Mutex<Vec<Instant>>,
    shutting_down: Mutex<bool>,
}

fn runtime_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    PathBuf::from(home).join(".jstudio-commander-v1")
}

fn spawn_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    // Dev: JSTUDIO_SIDECAR_CMD="node /abs/path/to/index.js" override.
    // Prod: bundled externalBin via sidecar() lookup (wired in Task 10).
    let command = if let Ok(explicit) = std::env::var("JSTUDIO_SIDECAR_CMD") {
        let mut parts = explicit.split_whitespace();
        let bin = parts.next().ok_or("JSTUDIO_SIDECAR_CMD is empty")?;
        let args: Vec<String> = parts.map(String::from).collect();
        app.shell().command(bin).args(args)
    } else {
        app.shell().sidecar(SIDECAR_BIN).map_err(|e| format!("sidecar: {e}"))?
    };
    let (mut rx, child) = command.spawn().map_err(|e| format!("spawn: {e}"))?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(b) => eprintln!("[sidecar] {}", String::from_utf8_lossy(&b).trim_end()),
                CommandEvent::Stderr(b) => eprintln!("[sidecar!] {}", String::from_utf8_lossy(&b).trim_end()),
                CommandEvent::Terminated(p) => {
                    eprintln!("[sidecar] exited code={:?}", p.code);
                    on_sidecar_exit(&handle);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn on_sidecar_exit(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if *state.shutting_down.lock().unwrap() { return; }
    let mut attempts = state.attempts.lock().unwrap();
    let now = Instant::now();
    attempts.retain(|t| now.duration_since(*t) < RESTART_WINDOW);
    if attempts.len() >= BACKOFFS_S.len() {
        eprintln!("[shell] sidecar crashed {} times in 60s — giving up", attempts.len());
        return;
    }
    let backoff = BACKOFFS_S[attempts.len()];
    attempts.push(now);
    drop(attempts);
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(backoff));
        match spawn_sidecar(&handle) {
            Ok(child) => *handle.state::<SidecarState>().child.lock().unwrap() = Some(child),
            Err(e) => eprintln!("[shell] sidecar restart failed: {e}"),
        }
    });
}

fn shutdown_sidecar(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    *state.shutting_down.lock().unwrap() = true;
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill(); // sidecar handles SIGTERM for clean close; kill is best-effort fallback
    }
    let _ = std::fs::remove_file(runtime_dir().join("sidecar.lock"));
    let _ = std::fs::remove_file(runtime_dir().join("runtime.json"));
}

#[tauri::command]
fn get_sidecar_url() -> Result<String, String> {
    let raw = std::fs::read_to_string(runtime_dir().join("runtime.json"))
        .map_err(|e| format!("runtime.json unavailable: {e}"))?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let port = v.get("port").and_then(|p| p.as_u64()).ok_or("port missing")?;
    Ok(format!("http://127.0.0.1:{port}"))
}

#[tauri::command]
fn app_quit(app: AppHandle) { shutdown_sidecar(&app); app.exit(0); }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![get_sidecar_url, app_quit])
        .setup(|app| {
            let handle = app.handle().clone();
            match spawn_sidecar(&handle) {
                Ok(child) => *handle.state::<SidecarState>().child.lock().unwrap() = Some(child),
                Err(e) => eprintln!("[shell] initial sidecar spawn failed: {e}"),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Commander")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => shutdown_sidecar(app),
            RunEvent::WindowEvent { event: WindowEvent::CloseRequested { .. }, .. } => shutdown_sidecar(app),
            _ => {}
        });
}
