import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';

// PID-based singleton lockfile. Port-bind already prevents two Commander
// instances from listening on the same socket, but a stray instance pointed
// at the same SQLite file (different port, parallel `pnpm dev`) would
// silently corrupt state via interleaved writes. This makes the conflict
// loud and explicit at boot.

const LOCK_PATH = join(config.dataDir, 'commander.lock');

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export const acquireInstanceLock = (): void => {
  mkdirSync(dirname(LOCK_PATH), { recursive: true });

  if (existsSync(LOCK_PATH)) {
    const raw = readFileSync(LOCK_PATH, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pid !== process.pid && isProcessAlive(pid)) {
      console.error(
        `\n[lock] Another JStudio Commander instance is already running (pid ${pid}).\n` +
          `[lock] Lockfile: ${LOCK_PATH}\n` +
          `[lock] Stop the other instance, or remove the lockfile if you're sure it's stale, then retry.\n`,
      );
      process.exit(1);
    }
    // Stale (process gone or our own pid from a crashed prior run) — overwrite.
  }

  writeFileSync(LOCK_PATH, String(process.pid), 'utf-8');
};

export const releaseInstanceLock = (): void => {
  try {
    if (!existsSync(LOCK_PATH)) return;
    const raw = readFileSync(LOCK_PATH, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    // Only delete if the file is ours — protects against a race where a
    // newer instance overwrote the file between our boot and shutdown.
    if (pid === process.pid) unlinkSync(LOCK_PATH);
  } catch {
    /* best-effort */
  }
};
