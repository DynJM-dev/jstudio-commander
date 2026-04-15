import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { getDb, closeDb } from './db/connection.js';
import { sessionRoutes } from './routes/session.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { projectRoutes } from './routes/project.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { terminalRoutes } from './routes/terminal.routes.js';
import { tunnelRoutes } from './routes/tunnel.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { hookEventRoutes } from './routes/hook-event.routes.js';
import { teammatesRoutes } from './routes/teammates.routes.js';
import { maintenanceRoutes } from './routes/maintenance.routes.js';
import { preferencesRoutes } from './routes/preferences.routes.js';
import { teamConfigService } from './services/team-config.service.js';
import { terminalService } from './services/terminal.service.js';
import { tunnelService } from './services/tunnel.service.js';
import { pinAuthMiddleware } from './middleware/pin-auth.js';
import { projectScannerService } from './services/project-scanner.service.js';
import { fileWatcherService } from './services/file-watcher.service.js';
import { statusPollerService } from './services/status-poller.service.js';
import { setupWebSocket, stopWebSocketTimers } from './ws/index.js';
import { setupWatcherBridge } from './services/watcher-bridge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: 'info',
  },
});

// CORS for dev
await app.register(cors, {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
});

// Serve client dist in production
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    wildcard: false,
  });
}

// PIN auth for remote access
app.addHook('onRequest', pinAuthMiddleware);

// Initialize database
getDb();

// WebSocket server (must register before routes that need it)
await setupWebSocket(app);

// Register routes
await app.register(systemRoutes);
await app.register(sessionRoutes);
await app.register(chatRoutes);
await app.register(projectRoutes);
await app.register(analyticsRoutes);
await app.register(terminalRoutes);
await app.register(tunnelRoutes);
await app.register(authRoutes);
await app.register(hookEventRoutes);
await app.register(teammatesRoutes);
await app.register(maintenanceRoutes);
await app.register(preferencesRoutes);

// Initial project scan
projectScannerService.runInitialScan();

// Start file watchers + bridge to event bus
fileWatcherService.start();
setupWatcherBridge();

// Start status poller
statusPollerService.start();

// Watch team config files and emit teammate:spawned / teammate:dismissed
teamConfigService.start();

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

  // 1b. Migrate pre-#204 single-transcript_path + claude_session_id state
  // into the new transcript_paths list. For each session row with an
  // existing transcript_path whose file still exists, ensure that path is
  // present in transcript_paths. Handles Wild-puma-style duplicates by
  // granting the file ONLY to the most-recently-created row — olders'
  // transcript_paths stay empty and will get populated when their own
  // first hook event fires.
  const legacyRows = db.prepare(
    "SELECT id, created_at, transcript_path, transcript_paths FROM sessions WHERE transcript_path IS NOT NULL",
  ).all() as Array<{ id: string; created_at: string; transcript_path: string; transcript_paths: string }>;

  const claimedBy = new Map<string, { id: string; createdAt: string }>();
  for (const row of legacyRows) {
    if (!existsSync(row.transcript_path)) continue;
    const prior = claimedBy.get(row.transcript_path);
    if (!prior || new Date(row.created_at).getTime() > new Date(prior.createdAt).getTime()) {
      claimedBy.set(row.transcript_path, { id: row.id, createdAt: row.created_at });
    }
  }
  for (const row of legacyRows) {
    const winner = claimedBy.get(row.transcript_path);
    const existing = (() => {
      try { return JSON.parse(row.transcript_paths || '[]') as string[]; } catch { return []; }
    })();
    if (winner?.id === row.id && existsSync(row.transcript_path) && !existing.includes(row.transcript_path)) {
      const next = [...existing, row.transcript_path];
      db.prepare('UPDATE sessions SET transcript_paths = ? WHERE id = ?').run(JSON.stringify(next), row.id);
      console.log(`[migrate] session=${row.id.slice(0, 30)} transcript_paths += ${row.transcript_path.split('/').pop()}`);
    }
  }

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
      // defaults stay consistent with every other path.
      const id = tmuxSession.name.replace('jsc-', '') + '-0000-0000-0000-000000000000';
      const liveStatus = agentStatusService.detectStatus(tmuxSession.name);
      sessionService.upsertSession({
        id,
        name: `recovered-${tmuxSession.name}`,
        tmuxSession: tmuxSession.name,
        status: liveStatus,
      });
      console.log(`[startup] Discovered orphaned tmux session: ${tmuxSession.name} → added as ${liveStatus}`);
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
  teamConfigService.stop();
  stopWebSocketTimers();
  fileWatcherService.stop();
  terminalService.cleanup();
  tunnelService.cleanup();
  closeDb();
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
