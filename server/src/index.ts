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

  // 1b. Heal UUID-shaped session IDs (the PM/lead pattern): when a row's id
  // is a Claude UUID and claude_session_id is empty, backfill it so future
  // hook events match via the fast path instead of fighting over cwd.
  const uuidShaped = db.prepare(
    "SELECT id FROM sessions WHERE claude_session_id IS NULL AND id LIKE '________-____-____-____-____________'"
  ).all() as Array<{ id: string }>;
  for (const row of uuidShaped) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id)) continue;
    db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ? AND claude_session_id IS NULL')
      .run(row.id, row.id);
  }

  // 1c. Clear stale transcript_path entries that point to a JSONL whose
  // UUID doesn't match the row's claude_session_id — collateral damage from
  // the old cwd-matching hook route. Cleared rows will re-link on next hook.
  const misaligned = db.prepare(
    "SELECT id, claude_session_id, transcript_path FROM sessions WHERE transcript_path IS NOT NULL AND claude_session_id IS NOT NULL"
  ).all() as Array<{ id: string; claude_session_id: string; transcript_path: string }>;
  for (const row of misaligned) {
    const name = row.transcript_path.split('/').pop()?.replace(/\.jsonl$/, '') ?? '';
    if (name !== row.claude_session_id) {
      db.prepare('UPDATE sessions SET transcript_path = NULL WHERE id = ?').run(row.id);
      console.log(`[startup] cleared stale transcript_path on ${row.id.slice(0, 30)}`);
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
