import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config, refuseBindWithoutPin, CORS_ORIGINS } from './config.js';
import { getDb, closeDb } from './db/connection.js';
import { acquireInstanceLock, releaseInstanceLock } from './db/instance-lock.js';
import { detectExistingCommander, printDuplicateBanner } from './preflight.js';
import { sessionRoutes } from './routes/session.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { projectRoutes } from './routes/project.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
// Phase P.3 H4 — Terminal stack removed. Future xterm.js/node-pty
// rebuild is a separate phase; the half-built PTY preview is gone
// along with its deps (@xterm/*, node-pty).
import { tunnelRoutes } from './routes/tunnel.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { hookEventRoutes } from './routes/hook-event.routes.js';
import { sessionTickRoutes } from './routes/session-tick.routes.js';
import { teammatesRoutes } from './routes/teammates.routes.js';
import { maintenanceRoutes } from './routes/maintenance.routes.js';
import { preferencesRoutes } from './routes/preferences.routes.js';
import { cityRoutes } from './routes/city.routes.js';
import { uploadRoutes } from './routes/upload.routes.js';
import { preCompactRoutes } from './routes/pre-compact.routes.js';
import { teamConfigService } from './services/team-config.service.js';
import { sessionService } from './services/session.service.js';
import { tunnelService } from './services/tunnel.service.js';
import { pinAuthMiddleware } from './middleware/pin-auth.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { projectScannerService } from './services/project-scanner.service.js';
import { fileWatcherService } from './services/file-watcher.service.js';
import { statusPollerService } from './services/status-poller.service.js';
import { systemStatsService } from './services/system-stats.service.js';
import { setupWebSocket, stopWebSocketTimers } from './ws/index.js';
import { setupWatcherBridge } from './services/watcher-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Preflight: if another Commander is already serving the signed health
// endpoint on our configured port, exit cleanly with a friendly banner
// instead of bubbling up EADDRINUSE. A non-signed response (e.g. an
// unrelated service on the same port) falls through to the normal bind
// path, where Fastify's own error handling + the instance-lock below
// cover the remaining cases.
if (await detectExistingCommander(config.port)) {
  printDuplicateBanner(config.port);
  process.exit(0);
}

const app = Fastify({
  logger: {
    level: 'info',
  },
});

// Phase P.1 C1 — refuse to bind a non-loopback host without a PIN. The
// tunnel service already enforces this for Cloudflare exposure; mirror
// the same guard at server boot so the `bindHost`/`COMMANDER_HOST`
// opt-in requires the operator to have consciously configured a PIN.
if (refuseBindWithoutPin(config.host, config.pin)) {
  console.error(
    `[startup] Refusing to bind ${config.host}: non-loopback exposure requires a PIN.\n` +
    `Set a numeric PIN in ~/.jstudio-commander/config.json (field: "pin") or unset ` +
    `COMMANDER_HOST / bindHost to stay on 127.0.0.1.`,
  );
  process.exit(1);
}

// CORS for dev — Commander's Vite runs on :11573 (unique port to
// avoid collisions with default :5173 when other projects are also
// in dev). Keep the legacy :5173 entry too so pre-Phase-E.2 local
// bookmarks / tabs still authorize during the migration window.
await app.register(cors, { origin: CORS_ORIGINS });

// Phase S — multipart uploads for chat attachments. Hard-capped at
// 10 MB per file (5 MB per image) inside the route; we also set a
// plugin-level ceiling here so a multi-GB upload attempt can't chew
// RAM before our per-chunk check kicks in. `files: 5` is the same
// per-request cap the route enforces — belt-and-braces.
await app.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 0 },
});

// Serve client dist — production only. In dev, Vite serves the UI
// from :11573 with HMR; letting fastify-static win there silently
// shadowed the dev bundle with a stale build on 2026-04-17 (three
// Wave 2 features appeared to "regress" because the server served
// an Apr-14 `client/dist` frozen from before the feature shipped).
// Explicit NODE_ENV gate prevents recurrence — if dist exists in
// dev, we warn and skip.
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction && existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
  });
} else if (existsSync(clientDist)) {
  console.warn(
    `[dev] client/dist exists at ${clientDist} but NODE_ENV !== production — ` +
      'skipping fastify-static so Vite (:11573) serves the UI. ' +
      "If you want the built bundle, run with NODE_ENV=production or remove client/dist.",
  );
}

// Dev-mode convenience: the .app launcher + any bookmark hits the
// server port directly. In production, fastify-static serves /. In
// dev, / has no handler unless we add one — bookmarks + Commander.app
// would 404. Redirect / → Vite so the user lands on the live UI
// regardless of which URL they opened. Respects VITE_URL env override
// in case Vite moves off :11573.
if (!isProduction) {
  const VITE_URL = process.env.VITE_URL ?? 'http://localhost:11573';
  app.get('/', async (_req, reply) => reply.redirect(VITE_URL, 302));
}

// Security headers — runs on every response, including static assets.
app.addHook('onRequest', securityHeadersMiddleware);

// PIN auth for remote access
app.addHook('onRequest', pinAuthMiddleware);

// Singleton lock — exits with code 1 if another Commander instance is
// already pointed at this dataDir. Must run before getDb() to keep the
// SQLite file from being touched by a second writer.
acquireInstanceLock();

// Initialize database
getDb();

// Phase W — one-shot migration from per-PM `split-state.*` preferences
// to the single global `pane-state` row. Idempotent after first run.
// Runs before any route can read/write pane state so clients never see
// a half-migrated view.
const { migrateLegacySplitState } = await import('./services/pane-state-migration.js');
migrateLegacySplitState();

// WebSocket server (must register before routes that need it)
await setupWebSocket(app);

// Register routes
await app.register(systemRoutes);
await app.register(sessionRoutes);
await app.register(chatRoutes);
await app.register(projectRoutes);
await app.register(analyticsRoutes);
await app.register(tunnelRoutes);
await app.register(authRoutes);
await app.register(hookEventRoutes);
await app.register(sessionTickRoutes);
await app.register(teammatesRoutes);
await app.register(maintenanceRoutes);
await app.register(preferencesRoutes);
await app.register(cityRoutes);
await app.register(uploadRoutes);
await app.register(preCompactRoutes);

// Initial project scan
await projectScannerService.runInitialScan();

// Start file watchers + bridge to event bus
fileWatcherService.start();
setupWatcherBridge();

// Start status poller
statusPollerService.start();

// Phase O — host CPU + memory sampler (2s cadence). Broadcasts
// `system:stats` on the `system` WS channel for the HeaderStatsWidget.
systemStatsService.start();

// Phase N.2 boot-time self-heal: retire session rows whose team_name
// references a team directory that no longer exists on disk. Runs BEFORE
// teamConfigService.start() so live reconciles can claim real panes
// without hitting UNIQUE(tmux_session) from an orphan row that still
// holds the pane id. See sessionService.healOrphanedTeamSessions.
{
  const retired = sessionService.healOrphanedTeamSessions();
  if (retired > 0) console.log(`[startup-heal] retired ${retired} orphan team session row(s)`);
}

// Phase S.1 Patch 2 — heal legacy `tmux_session = <session-name>` rows
// into pane-id rows. Runs AFTER orphaned-team retirement (so we don't
// waste work on rows about to be stopped) and BEFORE cross-session
// teammate heal (so its ownership comparisons operate on already-
// corrected targets). See sessionService.healLegacySessionNameTmuxTargets.
{
  const { healed, stopped } = sessionService.healLegacySessionNameTmuxTargets();
  if (healed > 0 || stopped > 0) {
    console.log(
      `[startup-heal] tmux_session: ${healed} row(s) → pane id, ${stopped} row(s) → stopped`,
    );
  }
}

// Watch team config files and emit teammate:spawned / teammate:dismissed
teamConfigService.start();

// Heal any teammate row whose pane actually belongs to another Commander
// PM's tmux session. Runs ONCE at boot and is idempotent — after the
// Bundle 1 cross-session guard in reconcile lands, these rows shouldn't
// be created anew, but existing corrupt state needs cleanup. See
// detectCrossSessionPaneOwner in session.service.ts for the check.
{
  const healed = sessionService.healCrossSessionTeammates();
  if (healed > 0) console.log(`[startup-heal] dismissed ${healed} cross-session teammate reference(s)`);
}

// Startup recovery — fix stale statuses, mark gone sessions, discover orphans
{
  const db = getDb();
  const { agentStatusService } = await import('./services/agent-status.service.js');
  const { tmuxService: tmux } = await import('./services/tmux.service.js');
  const now = new Date().toISOString();

  // 1. Check all non-stopped DB sessions against live tmux
  const activeSessions = db.prepare(
    "SELECT id, tmux_session, status FROM sessions WHERE status != 'stopped'"
  ).all() as Array<{ id: string; tmux_session: string; status: string }>;

  for (const row of activeSessions) {
    // Teammate sessions without a real tmux target (agent: sentinel) can't
    // be probed — leave them alone here; teamConfigService.reconcile owns
    // their lifecycle.
    if (row.tmux_session.startsWith('agent:')) continue;

    if (!tmux.hasSession(row.tmux_session)) {
      // Tmux session gone — mark as stopped
      db.prepare("UPDATE sessions SET status = 'stopped', stopped_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, row.id);
      console.log(`[startup] Session ${row.id.slice(0, 8)} tmux gone → stopped`);
    } else {
      // Tmux alive — detect current status
      const liveStatus = agentStatusService.detectStatus(row.tmux_session);
      if (liveStatus !== row.status) {
        db.prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
          .run(liveStatus, now, row.id);
        console.log(`[startup] Session ${row.id.slice(0, 8)} status: ${row.status} → ${liveStatus}`);
      }
    }
  }

  // Phase R L4 — transcript_path consolidation used to live here.
  // Moved into connection.ts as a one-shot schema migration that
  // runs BEFORE the column is dropped on the same boot. This block
  // is intentionally gone; no replacement needed.

  // 2. Discover orphaned jsc- tmux sessions not in the DB
  const liveTmuxSessions = tmux.listSessions().filter((s) => s.name.startsWith('jsc-'));
  const knownTmuxNames = new Set(
    (db.prepare('SELECT tmux_session FROM sessions').all() as Array<{ tmux_session: string }>)
      .map((r) => r.tmux_session)
  );

  const { sessionService } = await import('./services/session.service.js');
  for (const tmuxSession of liveTmuxSessions) {
    if (!knownTmuxNames.has(tmuxSession.name)) {
      // Orphaned tmux session — add to DB via the single write surface so
      // defaults stay consistent with every other path. Phase S.1 Patch 1:
      // resolve the session's first pane id and store THAT in
      // `tmux_session` so later send-keys target a specific pane instead
      // of whichever pane happens to be active (OvaGas bug class).
      const id = tmuxSession.name.replace('jsc-', '') + '-0000-0000-0000-000000000000';
      const liveStatus = agentStatusService.detectStatus(tmuxSession.name);
      const paneId = tmux.resolveFirstPaneId(tmuxSession.name);
      if (!paneId) {
        console.warn(
          `[startup] orphan tmux ${tmuxSession.name} — resolveFirstPaneId returned null; ` +
          `skipping adoption to avoid storing a session-name target.`,
        );
        continue;
      }
      // Phase S.1 hotfix: a real session row may already own this pane id
      // (e.g. the PM row for OvaGas at `04bb12d7-…` already has tmux_session=%58;
      // the orphan-adoption path previously stored `jsc-04bb12d7` so it never
      // collided — after the pane-id normalization in Patch 1 we must skip
      // adoption when the pane is already claimed, or UNIQUE crashes boot.
      if (knownTmuxNames.has(paneId)) {
        console.log(
          `[startup] orphan tmux ${tmuxSession.name} → pane ${paneId} already claimed by another session row; skipping adoption.`,
        );
        continue;
      }
      sessionService.upsertSession({
        id,
        name: `recovered-${tmuxSession.name}`,
        tmuxSession: paneId,
        status: liveStatus,
      });
      knownTmuxNames.add(paneId);
      console.log(`[startup] Discovered orphaned tmux session: ${tmuxSession.name} (${paneId}) → added as ${liveStatus}`);
    }
  }

  // 3. Sweep stopped teammate rows older than 7 days. Top-level sessions
  // are preserved as user history; this only prunes child rows whose tmux
  // is long gone.
  const removed = sessionService.cleanupStaleTeammates();
  if (removed > 0) console.log(`[cleanup] removed ${removed} stale teammate rows`);
}

// Graceful shutdown
const shutdown = async () => {
  console.log('\n[server] Shutting down...');
  statusPollerService.stop();
  systemStatsService.stop();
  teamConfigService.stop();
  stopWebSocketTimers();
  fileWatcherService.stop();
  tunnelService.cleanup();
  closeDb();
  releaseInstanceLock();
  await app.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`[server] JStudio Commander running on http://localhost:${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
