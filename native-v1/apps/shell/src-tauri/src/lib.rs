// Tauri v2 lib entry. Task 2 scaffold — real sidecar lifecycle, single-instance,
// updater, fs-watch wiring + #[tauri::command] app_quit() land in Task 4.
//
// Rust scope boundary (ARCHITECTURE_SPEC v1.2 §2.1):
//   1. Tauri configuration + window management
//   2. Sidecar lifecycle (spawn, crash recovery, clean shutdown)
//   3. IPC bridge for OS integrations (notifications, single-instance, quit)
//   4. Code signing + updater stub
//   5. Eventual node-pty bridge — NOT used in N1 (pty lives in sidecar per §2.4)
//
// Anything outside these five categories is scope drift — flag to PM.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
