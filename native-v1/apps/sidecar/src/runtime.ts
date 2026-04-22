// Runtime discovery files per ARCHITECTURE_SPEC v1.2 §8.2 + §8.5.
//   ~/.jstudio-commander-v1/runtime.json — {port, pid} — read by Rust shell
//     (via tauri command get_sidecar_url) + by the frontend when launched
//     outside Tauri for debugging.
//   ~/.jstudio-commander-v1/sidecar.lock — {pid, port, startedAt} — single-
//     instance guard + stale-process detection on next launch.

import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const RUNTIME_DIR = join(homedir(), '.jstudio-commander-v1');
export const RUNTIME_JSON = join(RUNTIME_DIR, 'runtime.json');
export const LOCK_FILE = join(RUNTIME_DIR, 'sidecar.lock');

export interface RuntimeInfo {
  port: number;
  pid: number;
}

export interface LockInfo {
  pid: number;
  port: number;
  startedAt: number;
}

export function ensureRuntimeDir(): void {
  if (!existsSync(RUNTIME_DIR)) {
    mkdirSync(RUNTIME_DIR, { recursive: true, mode: 0o755 });
  }
}

export function writeRuntimeJson(info: RuntimeInfo): void {
  ensureRuntimeDir();
  writeFileSync(RUNTIME_JSON, JSON.stringify(info) + '\n', { mode: 0o644 });
}

export function writeLockFile(info: LockInfo): void {
  ensureRuntimeDir();
  writeFileSync(LOCK_FILE, JSON.stringify(info, null, 2) + '\n', { mode: 0o644 });
}

export function readLockFile(): LockInfo | null {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanupRuntimeFiles(): void {
  for (const f of [RUNTIME_JSON, LOCK_FILE]) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      // best-effort
    }
  }
}
