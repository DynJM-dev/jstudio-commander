import { SIDECAR_VERSION, loadOrCreateConfig } from './config';
import { countTables, openDb, runMigrations } from './db/client';
import { createLogger } from './logger';
import { migrateIdentityFilesOnBoot } from './migrations/commander-json-identity';
import { SIDECAR_PORT_RANGE, scanPort } from './port-scan';
import { createServer } from './server';

async function main() {
  const logger = createLogger();
  logger.info({ v: SIDECAR_VERSION }, 'sidecar boot');

  const port = await scanPort();
  if (!port) {
    logger.error({ range: SIDECAR_PORT_RANGE }, 'no available port in sidecar range — aborting');
    process.exit(1);
  }

  // Pass the boot logger so loadOrCreateConfig emits preserved/minted trace
  // — lets future bearer-rotation incidents be diagnosed from logs alone.
  // Pino's Logger + Fastify's FastifyBaseLogger both structurally satisfy
  // `@commander/shared.Logger` (Debt 16 closed N3 T0).
  const config = await loadOrCreateConfig(port, logger);

  let dbHandles: ReturnType<typeof openDb>;
  try {
    dbHandles = openDb();
    runMigrations(dbHandles.raw);
    const n = countTables(dbHandles.raw);
    logger.info({ tables: n }, 'migrations applied');
    if (n < 9) {
      logger.error({ tables: n }, 'expected 9 tables post-migration — aborting');
      process.exit(2);
    }
  } catch (err) {
    logger.error({ err }, 'migration failed — sidecar exiting');
    process.exit(2);
  }

  // N4 T1 identity-file migration (KB-P1.5 + OS §20.LL-L16). Runs AFTER
  // schema migration but BEFORE server accepts requests, so the frontend
  // and MCP never see half-migrated state. Boot-halt on failure per
  // dispatch §4 G10 + SPEC §9 "migration-failure" error path.
  try {
    const ok = await migrateIdentityFilesOnBoot(dbHandles.db, logger);
    if (!ok) {
      logger.error({}, 'identity migration failed on one or more rows — sidecar exiting');
      process.exit(4);
    }
  } catch (err) {
    logger.error({ err }, 'identity migration threw — sidecar exiting');
    process.exit(4);
  }

  const server = createServer({
    config,
    raw: dbHandles.raw,
    db: dbHandles.db,
    logLevel: process.env.COMMANDER_LOG_LEVEL ?? 'info',
  });

  try {
    await server.listen({ port, host: '127.0.0.1' });
  } catch (err) {
    logger.error({ err, port }, 'fastify listen failed');
    process.exit(3);
  }

  logger.info(
    {
      port,
      bearerTokenPreview: `${config.bearerToken.slice(0, 8)}…`,
      pid: process.pid,
    },
    'sidecar ready',
  );

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'graceful shutdown');
    try {
      await server.close();
    } catch (err) {
      logger.warn({ err }, 'server.close failed');
    }
    try {
      dbHandles.raw.close();
    } catch (err) {
      logger.warn({ err }, 'db.close failed');
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Parent-death watchdog — if the Rust shell exits without cleanly SIGTERM'ing
  // us (AppleScript Quit / force-quit / crash), process.ppid flips to 1 on
  // launchd re-parenting. Self-terminate to avoid zombie orphans that would
  // otherwise hold the sidecar port range on next launch.
  const originalPpid = process.ppid;
  const parentWatcher = setInterval(() => {
    if (process.ppid !== originalPpid) {
      logger.warn(
        { originalPpid, currentPpid: process.ppid },
        'parent re-parented (shell exited) — self-terminating',
      );
      clearInterval(parentWatcher);
      void shutdown('SIGTERM' as NodeJS.Signals);
    }
  }, 1000);
}

main().catch((err) => {
  console.error('sidecar fatal:', err);
  process.exit(1);
});
