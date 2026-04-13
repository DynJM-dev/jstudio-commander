import type { SessionStatus } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { agentStatusService } from './agent-status.service.js';
import { eventBus } from '../ws/event-bus.js';

const POLL_INTERVAL = 5_000; // 5 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

// In-memory cache of last known statuses to avoid unnecessary DB writes
const lastKnownStatus = new Map<string, SessionStatus>();

const poll = (): void => {
  const db = getDb();
  const activeSessions = db.prepare(
    "SELECT id, tmux_session, status FROM sessions WHERE status != 'stopped'"
  ).all() as Array<{ id: string; tmux_session: string; status: string }>;

  if (activeSessions.length === 0) return;

  const tmuxNames = activeSessions.map((s) => s.tmux_session);
  const statuses = agentStatusService.detectStatusBatch(tmuxNames);

  for (const session of activeSessions) {
    const newStatus = statuses[session.tmux_session];
    if (!newStatus) continue;

    const cachedStatus = lastKnownStatus.get(session.id) ?? session.status;

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
    console.log(`[poller] Status poller started (every ${POLL_INTERVAL / 1000}s)`);
    // Run immediately, then on interval
    poll();
    pollTimer = setInterval(poll, POLL_INTERVAL);
  },

  stop(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    lastKnownStatus.clear();
    console.log('[poller] Status poller stopped');
  },
};
