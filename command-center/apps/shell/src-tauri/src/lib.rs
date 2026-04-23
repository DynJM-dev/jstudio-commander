// Tauri v2 shell — window host + single-instance + sidecar lifecycle + IPC
// bridge. No PTY/DB/hook/approval logic (sidecar owns those). G5: ≤150 LOC.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const SIDECAR_BIN: &str = "commander-sidecar";
const SIDECAR_TERM_GRACE: Duration = Duration::from_secs(5);

#[derive(Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

fn config_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    PathBuf::from(home).join(".jstudio-commander").join("config.json")
}

#[cfg(unix)]
fn send_sigterm(pid: u32) -> bool {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), Signal::SIGTERM).is_ok()
}

#[cfg(unix)]
fn is_alive(pid: u32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

#[cfg(not(unix))]
fn send_sigterm(_pid: u32) -> bool { false }
#[cfg(not(unix))]
fn is_alive(_pid: u32) -> bool { true }

fn spawn_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    // Dev override for unbundled runs: JSTUDIO_SIDECAR_CMD="bun /abs/path/to/index.ts"
    let command = if let Ok(explicit) = std::env::var("JSTUDIO_SIDECAR_CMD") {
        let mut parts = explicit.split_whitespace();
        let bin = parts.next().ok_or("JSTUDIO_SIDECAR_CMD empty")?;
        let args: Vec<String> = parts.map(String::from).collect();
        app.shell().command(bin).args(args)
    } else {
        app.shell().sidecar(SIDECAR_BIN).map_err(|e| format!("sidecar lookup: {e}"))?
    };
    let (mut rx, child) = command.spawn().map_err(|e| format!("sidecar spawn: {e}"))?;
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(b) => eprintln!("[sidecar] {}", String::from_utf8_lossy(&b).trim_end()),
                CommandEvent::Stderr(b) => eprintln!("[sidecar!] {}", String::from_utf8_lossy(&b).trim_end()),
                CommandEvent::Terminated(p) => { eprintln!("[sidecar] exited code={:?}", p.code); break; }
                _ => {}
            }
        }
    });
    Ok(child)
}

fn shutdown_sidecar(app: &AppHandle) {
    let Some(child) = app.state::<SidecarState>().child.lock().unwrap().take() else { return };
    let pid = child.pid();
    send_sigterm(pid);
    // Poll up to SIDECAR_TERM_GRACE for graceful exit; SIGKILL if still up.
    let deadline = Instant::now() + SIDECAR_TERM_GRACE;
    while Instant::now() < deadline {
        if !is_alive(pid) { return; }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
}

#[tauri::command]
fn get_config_path() -> String {
    config_path().to_string_lossy().to_string()
}

#[tauri::command]
fn read_config() -> Result<String, String> {
    std::fs::read_to_string(config_path()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_resource_path(app: AppHandle, name: String) -> Result<String, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name).to_string_lossy().to_string())
}

#[tauri::command]
fn show_window(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main window")?;
    w.show().map_err(|e| e.to_string())?;
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    shutdown_sidecar(&app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            get_config_path,
            read_config,
            get_resource_path,
            show_window,
            quit_app
        ])
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
