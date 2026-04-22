// @jstudio-commander/sidecar entrypoint.
// Per ARCHITECTURE_SPEC v1.2 §8:
//   1. Init DB (Task 3).
//   2. Build orchestrator + event bus (Tasks 6/7/9).
//   3. Bind Fastify HTTP + WS with port discovery (Task 5).
//   4. Write runtime.json + lock file.
//   5. Handle SIGTERM/SIGINT → graceful shutdown (close WS, stop pool, close
//      ptys, close DB, remove runtime files).

import { initDatabase } from '@jstudio-commander/db';
import { EventBus } from './ws/event-bus.js';
import { createServer, bindWithPortDiscovery } from './server.js';
import { UnimplementedOrchestrator, type SessionOrchestrator } from './routes/sessions.js';
import { PtyOrchestrator } from './pty/orchestrator.js';
import {
  writeRuntimeJson,
  writeLockFile,
  cleanupRuntimeFiles,
  readLockFile,
  isPidAlive,
  LOCK_FILE,
} from './runtime.js';
const SHUTDOWN_TIMEOUT_MS = 5000;

async function main() {
  // Single-instance guard at sidecar level. Rust shell has its own single-
  // instance enforcement; this catches the case where the sidecar is launched
  // standalone (dev / debugging).
  const prior = readLockFile();
  if (prior && isPidAlive(prior.pid)) {
    console.error(
      `[sidecar] prior instance alive (pid=${prior.pid}, port=${prior.port}); refusing to start`,
    );
    process.exit(2);
  }

  const db = initDatabase();
  console.error(
    `[sidecar] db ready at ${db.dbPath}; migrations applied: ${db.migrationsApplied.join(', ') || '(none new)'}`,
  );

  const bus = new EventBus();
  let orchestrator: SessionOrchestrator;
  try {
    orchestrator = new PtyOrchestrator({ db, bus });
  } catch (err) {
    console.error('[sidecar] PtyOrchestrator init failed, falling back to stub', err);
    orchestrator = new UnimplementedOrchestrator();
  }

  const app = createServer({ db, bus, orchestrator });
  const port = await bindWithPortDiscovery(app);

  writeRuntimeJson({ port, pid: process.pid });
  writeLockFile({ port, pid: process.pid, startedAt: Date.now() });
  console.error(`[sidecar] listening on http://127.0.0.1:${port} (pid=${process.pid})`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[sidecar] ${signal} received — shutting down`);
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    try {
      const maybeShutdown = (orchestrator as unknown as { shutdown?: () => Promise<void> }).shutdown;
      if (typeof maybeShutdown === 'function') {
        await maybeShutdown.call(orchestrator);
      }
      await app.close();
      bus.clear();
      db.raw.close();
    } catch (err) {
      console.error('[sidecar] shutdown error', err);
    } finally {
      cleanupRuntimeFiles();
      const remaining = deadline - Date.now();
      if (remaining < 0) {
        console.error('[sidecar] shutdown exceeded deadline; forcing exit');
      }
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    console.error('[sidecar] uncaughtException', err);
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  console.error('[sidecar] fatal startup error', err);
  try {
    cleanupRuntimeFiles();
  } catch {
    // best-effort
  }
  // Avoid leaving a stale lock behind.
  try {
    const { unlinkSync } = require('node:fs');
    unlinkSync(LOCK_FILE);
  } catch {
    // best-effort
  }
  process.exit(1);
});
