// Tauri v2 entry. Real sidecar lifecycle + IPC bridge wiring lands in Task 4.
// Scope strictly bounded to ARCHITECTURE_SPEC v1.2 §2.1 five categories;
// LOC budget ≤150 per §2.5. This Task 2 scaffold is <10 LOC.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jstudio_commander_shell_lib::run();
}
