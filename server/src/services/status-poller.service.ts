import type { SessionStatus } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { agentStatusService } from './agent-status.service.js';
import { rotationDetectorService } from './rotation-detector.service.js';
import { eventBus } from '../ws/event-bus.js';

const POLL_INTERVAL = 5_000; // 5 seconds
const ROTATION_INTERVAL = 15_000; // 15 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setInterval> | null = null;

// In-memory cache of last known statuses to avoid unnecessary DB writes
const lastKnownStatus = new Map<string, SessionStatus>();
// Cooldown: when transitioning working → idle, wait before committing
// Prevents flickering when Claude pauses briefly between tool calls
const idleSince = new Map<string, number>();
const IDLE_COOLDOWN_MS = 8000; // 8 seconds (2 poll cycles) before confirming idle

const poll = (): void => {
  const db = getDb();
  // Poll non-stopped rows PLUS any row whose tmux_session looks like a pane
  // (e.g. "%35"). The pane may have come back alive after being transiently
  // marked stopped by a prior glitch — if tmux still reports it live, we
  // must re-probe and un-stick it. jsc-* session names stay filtered by
  // status because those are Commander-created and stopping is authoritative.
  const activeSessions = db.prepare(
    "SELECT id, tmux_session, status FROM sessions WHERE status != 'stopped' OR tmux_session LIKE '\\%%' ESCAPE '\\'"
  ).all() as Array<{ id: string; tmux_session: string; status: string }>;

  if (activeSessions.length === 0) return;

  // Teammates with no discoverable tmux target (config had an empty
  // tmuxPaneId) are stored with an "agent:" sentinel. There's nothing to
  // probe via tmux so the poller must NOT touch them — leave their status
  // to whatever hook events or explicit API calls set.
  const pollable = activeSessions.filter((s) => !s.tmux_session.startsWith('agent:'));
  if (pollable.length === 0) return;

  const tmuxNames = pollable.map((s) => s.tmux_session);
  const statuses = agentStatusService.detectStatusBatch(tmuxNames);

  for (const session of activeSessions) {
    const newStatus = statuses[session.tmux_session];
    if (!newStatus) continue;

    const cachedStatus = lastKnownStatus.get(session.id) ?? session.status;

    // Cooldown: working → idle/waiting requires sustained idle state
    if (cachedStatus === 'working' && (newStatus === 'idle' || newStatus === 'waiting')) {
      const now = Date.now();
      if (!idleSince.has(session.id)) {
        // First detection of idle — start the cooldown
        idleSince.set(session.id, now);
        continue; // Don't update yet
      }
      const elapsed = now - idleSince.get(session.id)!;
      if (elapsed < IDLE_COOLDOWN_MS) {
        continue; // Still in cooldown — keep showing working
      }
      // Cooldown passed — commit the idle transition
      idleSince.delete(session.id);
    } else {
      // Not a working→idle transition — clear any pending cooldown
      idleSince.delete(session.id);
    }

    if (newStatus !== cachedStatus) {
      // Update DB
      db.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newStatus, session.id);

      // Update cache
      lastKnownStatus.set(session.id, newStatus);

      // Emit event
      eventBus.emitSessionStatus(session.id, newStatus);
    } else {
      // Cache the current status even if unchanged (first run)
      lastKnownStatus.set(session.id, newStatus);
    }
  }
};

export const statusPollerService = {
  start(): void {
    console.log(`[poller] Status poller started (every ${POLL_INTERVAL / 1000}s, rotation sweep every ${ROTATION_INTERVAL / 1000}s)`);
    // Run immediately, then on interval
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
    rotationTimer = setInterval(() => {
      try { rotationDetectorService.sweep(); }
      catch (err) { console.warn('[poller] rotation sweep failed:', (err as Error).message); }
    }, ROTATION_INTERVAL);
  },

  stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (rotationTimer) {
      clearInterval(rotationTimer);
      rotationTimer = null;
    }
    lastKnownStatus.clear();
    console.log('[poller] Status poller stopped');
  },
};
