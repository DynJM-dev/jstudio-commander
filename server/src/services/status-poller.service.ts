import type { SessionStatus, SessionActivity, StatusFlip } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { agentStatusService } from './agent-status.service.js';
import { tmuxService } from './tmux.service.js';
import { eventBus } from '../ws/event-bus.js';

const POLL_INTERVAL = 5_000; // 5 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

// In-memory cache of last known statuses to avoid unnecessary DB writes
const lastKnownStatus = new Map<string, SessionStatus>();
// Grace period: working → idle must be observed across 2 consecutive polls
// (≈10s) before committing. Prevents flicker to idle between tool calls
// when Claude pauses briefly. working → waiting bypasses the grace period
// because a permission prompt is urgent — don't delay surfacing it.
const idleSince = new Map<string, number>();
const IDLE_GRACE_MS = 8_000;
// Track when each session first entered 'working'. After >3min stuck in
// working we log a warning the next time classification changes — makes
// the "stuck on Thinking..." class of bug observable in server logs.
const workingSince = new Map<string, number>();
const STUCK_WORKING_WARN_MS = 3 * 60_000;

// Status-flip ring buffer per session. Phase J: debuggers hunting "why is
// this session stuck" can grep these flips with their evidence strings
// before diving into the detector source. Capped at FLIP_HISTORY_MAX per
// session; oldest entries drop first.
const statusFlipHistory = new Map<string, StatusFlip[]>();
const FLIP_HISTORY_MAX = 20;

// Latest parsed activity per session — read by the single-session / teammates
// API routes so they don't need to re-shell-out to tmux on every request.
const lastKnownActivity = new Map<string, SessionActivity | null>();

const recordFlip = (sessionId: string, flip: StatusFlip): void => {
  let arr = statusFlipHistory.get(sessionId);
  if (!arr) {
    arr = [];
    statusFlipHistory.set(sessionId, arr);
  }
  arr.push(flip);
  if (arr.length > FLIP_HISTORY_MAX) arr.splice(0, arr.length - FLIP_HISTORY_MAX);
};

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
  const detailed = agentStatusService.detectStatusDetailedBatch(tmuxNames);

  for (const session of activeSessions) {
    const detectedResult = detailed[session.tmux_session];
    if (!detectedResult) continue;

    let newStatus = detectedResult.status;
    let evidence = detectedResult.evidence;
    const activity = detectedResult.activity;

    // Keep the activity cache fresh for downstream API reads regardless of
    // whether the status itself flipped — the footer updates many times
    // per second and polling every 5s is already a coarse snapshot.
    lastKnownActivity.set(session.id, activity);

    // Pane-target safety net: if a row whose tmux_session starts with '%'
    // was classified as 'stopped' (heuristic transient miss), double-check
    // the pane via hasSession. A live pane MUST NOT be reported as stopped
    // for a teammate — transitioning them to stopped removes them from the
    // split-screen and the user loses the session.
    if (newStatus === 'stopped' && session.tmux_session.startsWith('%')) {
      if (tmuxService.hasSession(session.tmux_session)) {
        newStatus = 'idle';
        evidence = 'pane live despite stopped classification';
      }
    }

    const cachedStatus = lastKnownStatus.get(session.id) ?? (session.status as SessionStatus);

    // Grace period applies ONLY to working → idle (prevents flicker
    // between tool calls). working → waiting skips the grace: a permission
    // prompt is urgent and must surface immediately.
    if (cachedStatus === 'working' && newStatus === 'idle') {
      const now = Date.now();
      if (!idleSince.has(session.id)) {
        idleSince.set(session.id, now);
        continue;
      }
      const elapsed = now - idleSince.get(session.id)!;
      if (elapsed < IDLE_GRACE_MS) continue;
      idleSince.delete(session.id);
      evidence = `${evidence} (after ${Math.round(elapsed / 1000)}s grace)`;
    } else {
      idleSince.delete(session.id);
    }

    if (newStatus !== cachedStatus) {
      // If we were stuck in 'working' for a long time and just escaped,
      // surface it in logs — helps diagnose classification lag (#222).
      if (cachedStatus === 'working') {
        const enteredAt = workingSince.get(session.id);
        if (enteredAt && Date.now() - enteredAt > STUCK_WORKING_WARN_MS) {
          const minutes = Math.round((Date.now() - enteredAt) / 60_000);
          console.warn(
            `[poller] session ${session.id.slice(0, 8)} was 'working' for ~${minutes}m before transitioning to '${newStatus}' — possible detection lag`,
          );
        }
      }
      if (newStatus === 'working') {
        workingSince.set(session.id, Date.now());
      } else {
        workingSince.delete(session.id);
      }

      const at = new Date().toISOString();
      const from = cachedStatus as SessionStatus;
      const to = newStatus;

      // Phase J — log the flip with its rationale. Single line so log-grep
      // on `[status]` reveals the entire transition history per session.
      console.log(`[status] ${session.id.slice(0, 8)} ${from}→${to} evidence="${evidence}"`);
      recordFlip(session.id, { at, from, to, evidence });

      // Update DB
      db.prepare("UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newStatus, session.id);

      // Update cache
      lastKnownStatus.set(session.id, newStatus);

      // Emit event — richer payload on transition with the before/after
      // statuses, the parsed evidence, and the live activity snapshot.
      // The legacy `status` field stays populated to the `to` value for
      // back-compat with consumers that predate Phase J.
      eventBus.emitSessionStatus(session.id, newStatus, {
        from,
        to,
        evidence,
        activity,
        at,
      });
    } else {
      // Cache the current status even if unchanged (first run)
      lastKnownStatus.set(session.id, newStatus);
      if (newStatus === 'working' && !workingSince.has(session.id)) {
        workingSince.set(session.id, Date.now());
      }
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

  // Exposed so the routes layer can surface the ring buffer + cached
  // activity without a fresh tmux shell-out. History survives the life
  // of the process; it does NOT persist to disk — restart clears it.
  getFlipHistory(sessionId: string): StatusFlip[] {
    return (statusFlipHistory.get(sessionId) ?? []).slice();
  },

  getCachedActivity(sessionId: string): SessionActivity | null | undefined {
    return lastKnownActivity.get(sessionId);
  },
};
