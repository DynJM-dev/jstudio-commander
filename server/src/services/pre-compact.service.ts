// Phase Q — auto pre-compact assistant.
//
// Watches each session's context-window % on every tick. Transitions:
//
//   idle ──(ctx ≥ 85)──> warned ──(AI says READY_TO_COMPACT)──> compacting
//     │                                                              │
//     └──(ctx ≥ 95)──> compacting (emergency) ─────────────────────┤
//                                                                    │
//                       (ctx < 40)  ← compacting ──────── reset ─────┘
//
// `warned` means Commander injected a user-role message into the
// session's tmux pane telling the AI to save state and reply
// `READY_TO_COMPACT`. `compacting` means Commander fired `/compact`
// into the pane and is waiting for context to drop back under the
// reset threshold (the next tick will close the loop).
//
// Opt-out: `sessions.auto_compact_enabled = 0` short-circuits every
// transition — the session is never warned, never auto-compacted.
// Migrated PM / lead-PM rows default to disabled.
//
// Hysteresis: `warned` → `idle` when ctx drops back below the
// hysteresis floor (75%) without the AI ever replying READY. This
// handles transient tick spikes + the case where the user /clear'd
// or the AI compacted on its own without the ack string.
//
// Double-fire protection: the `warned` state itself IS the guard —
// a second 85%+ tick won't re-fire the inject because the machine
// isn't in `idle`. Same logic applies to emergency: once in
// `compacting`, another 95%+ tick doesn't re-inject `/compact`.
//
// Safety: `sendCommand` is gated on `tmuxService.hasSession`, so a
// dead pane just drops the transition with a warn log — the service
// never throws at the caller (tick ingest / watcher bridge).

import type { PreCompactState, PreCompactStateChangedEvent } from '@commander/shared';
import { getDb } from '../db/connection.js';
import { eventBus } from '../ws/event-bus.js';
import { tmuxService } from './tmux.service.js';

export const WARN_THRESHOLD = 85;
export const EMERGENCY_THRESHOLD = 95;
export const RESET_THRESHOLD = 40;
export const HYSTERESIS_FLOOR = 75;

// Exact string the session's AI must emit (as a user-visible message
// body) to trigger auto-compact. Case-sensitive per the spec —
// false positives from chat prose ("ready to compact?") or tool
// output would be dangerous.
export const READY_PHRASE = 'READY_TO_COMPACT';

interface SessionPreCompactState {
  state: PreCompactState;
  warnedAt: number | null;
  readyAt: number | null;
  lastCtxPct: number | null;
}

// In-memory map. Reset on server restart is fine — the next tick
// for each session re-evaluates the threshold, so the service
// self-heals without persisting state.
const states = new Map<string, SessionPreCompactState>();

const getOrInit = (sessionId: string): SessionPreCompactState => {
  let s = states.get(sessionId);
  if (!s) {
    s = { state: 'idle', warnedAt: null, readyAt: null, lastCtxPct: null };
    states.set(sessionId, s);
  }
  return s;
};

interface SessionRow {
  id: string;
  status: string;
  tmux_session: string;
  auto_compact_enabled: number | null;
}

// Fetch only the columns the service cares about. Cheaper than a
// full rowToSession hydrate when we're called on every tick.
const loadRow = (sessionId: string): SessionRow | null => {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, status, tmux_session, auto_compact_enabled FROM sessions WHERE id = ?',
  ).get(sessionId) as SessionRow | undefined;
  return row ?? null;
};

const isOptedIn = (row: SessionRow): boolean => {
  // Null column value (shouldn't happen post-migration, but be safe
  // with legacy rows) defaults to enabled so coder/teammate sessions
  // never silently skip the watcher.
  if (row.auto_compact_enabled === null) return true;
  return Number(row.auto_compact_enabled) !== 0;
};

const buildWarningMessage = (ctxPct: number): string => {
  const display = Math.round(ctxPct);
  return [
    `⚠️ Your context is at ${display}%. To avoid losing state, please:`,
    '',
    '1. Update CODER_BRAIN.md + STATE.md with any durable findings from this session.',
    '2. Save any memories to your ~/.claude memory system.',
    '3. Commit pending changes.',
    '',
    'When ready, reply with a single line: READY_TO_COMPACT',
    '',
    'I will then auto-compact your session.',
  ].join('\n');
};

const injectIntoPane = (tmuxName: string, text: string): boolean => {
  if (!tmuxService.hasSession(tmuxName)) return false;
  try {
    tmuxService.sendKeys(tmuxName, text);
    return true;
  } catch {
    return false;
  }
};

const emitTransition = (
  sessionId: string,
  state: PreCompactState,
  ctxPct: number | null,
  reason: PreCompactStateChangedEvent['reason'],
): void => {
  eventBus.emitPreCompactStateChanged({
    sessionId,
    state,
    ctxPct,
    timestamp: new Date().toISOString(),
    reason,
  });
};

export const preCompactService = {
  /**
   * Called from session-tick.service.ingest after the tick is
   * upserted. `ctxPct` is the context_used_pct field (0-100) — null
   * when the tick didn't carry that field, in which case we skip.
   */
  onTickReceived(sessionId: string, ctxPct: number | null): void {
    if (ctxPct === null) return;

    const row = loadRow(sessionId);
    if (!row) return;
    if (row.status === 'stopped') return;
    if (!isOptedIn(row)) return;

    const s = getOrInit(sessionId);
    s.lastCtxPct = ctxPct;

    // State transitions driven by the incoming tick. Order matters:
    // emergency gate fires BEFORE the warn gate so a session whose
    // first observed ctx is already > 95% auto-compacts instead of
    // going through the warn path.
    if (s.state === 'idle') {
      if (ctxPct >= EMERGENCY_THRESHOLD) {
        const now = Date.now();
        console.log(`[pre-compact] EMERGENCY session=${sessionId.slice(0, 30)} ctx=${ctxPct.toFixed(1)}% → auto-compacting`);
        s.state = 'compacting';
        s.readyAt = now;
        emitTransition(sessionId, 'compacting', ctxPct, 'emergency');
        injectIntoPane(row.tmux_session, '/compact');
        return;
      }
      if (ctxPct >= WARN_THRESHOLD) {
        const now = Date.now();
        console.log(`[pre-compact] WARN session=${sessionId.slice(0, 30)} ctx=${ctxPct.toFixed(1)}% → injecting warning`);
        s.state = 'warned';
        s.warnedAt = now;
        emitTransition(sessionId, 'warned', ctxPct, 'warn-threshold');
        injectIntoPane(row.tmux_session, buildWarningMessage(ctxPct));
        return;
      }
      return;
    }

    if (s.state === 'warned') {
      // Hysteresis: ctx fell back under the floor before the AI
      // replied READY. Could be /clear, or a transient spike. Reset
      // to idle so the next 85%+ re-warns.
      if (ctxPct < HYSTERESIS_FLOOR) {
        console.log(`[pre-compact] HYSTERESIS session=${sessionId.slice(0, 30)} ctx=${ctxPct.toFixed(1)}% → resetting to idle`);
        s.state = 'idle';
        s.warnedAt = null;
        emitTransition(sessionId, 'idle', ctxPct, 'hysteresis');
        return;
      }
      // Emergency escalation — the AI is either slow to reply or
      // something is wrong; don't let the session blow past 95%
      // waiting on an ack.
      if (ctxPct >= EMERGENCY_THRESHOLD) {
        const now = Date.now();
        console.log(`[pre-compact] ESCALATE session=${sessionId.slice(0, 30)} ctx=${ctxPct.toFixed(1)}% → emergency compact`);
        s.state = 'compacting';
        s.readyAt = now;
        emitTransition(sessionId, 'compacting', ctxPct, 'emergency');
        injectIntoPane(row.tmux_session, '/compact');
        return;
      }
      return;
    }

    if (s.state === 'compacting') {
      // Reset once ctx drops below the reset threshold — the compact
      // succeeded. The /compact slash command resets Claude's
      // context, so the next tick typically lands in the 5-20%
      // range and closes the loop here.
      if (ctxPct < RESET_THRESHOLD) {
        console.log(`[pre-compact] RESET session=${sessionId.slice(0, 30)} ctx=${ctxPct.toFixed(1)}% → back to idle`);
        s.state = 'idle';
        s.warnedAt = null;
        s.readyAt = null;
        emitTransition(sessionId, 'idle', ctxPct, 'reset');
      }
      return;
    }
  },

  /**
   * Called from watcher-bridge per new chat message parsed out of
   * the JSONL. Only user-role messages (the session's AI replying)
   * with content-block text exactly matching READY_PHRASE transition
   * warned → compacting. Case-sensitive.
   */
  onChatMessageReceived(sessionId: string, content: string): void {
    const s = states.get(sessionId);
    if (!s || s.state !== 'warned') return;
    if (!content.includes(READY_PHRASE)) return;

    const row = loadRow(sessionId);
    if (!row) return;
    if (row.status === 'stopped') return;
    if (!isOptedIn(row)) return;

    const now = Date.now();
    console.log(`[pre-compact] READY session=${sessionId.slice(0, 30)} → auto-compacting`);
    s.state = 'compacting';
    s.readyAt = now;
    emitTransition(sessionId, 'compacting', s.lastCtxPct, 'ready-ack');
    injectIntoPane(row.tmux_session, '/compact');
  },

  /**
   * Snapshot for GET /api/pre-compact/status. Reads live opt-in
   * state from the DB per-session so toggles reflect instantly,
   * even for sessions the in-memory map has no entry for yet.
   */
  getSnapshot(): Array<{
    sessionId: string;
    state: PreCompactState;
    warnedAt: string | null;
    readyAt: string | null;
    lastCtxPct: number | null;
    autoCompactEnabled: boolean;
  }> {
    const out: Array<{
      sessionId: string;
      state: PreCompactState;
      warnedAt: string | null;
      readyAt: string | null;
      lastCtxPct: number | null;
      autoCompactEnabled: boolean;
    }> = [];
    for (const [sessionId, s] of states) {
      const row = loadRow(sessionId);
      out.push({
        sessionId,
        state: s.state,
        warnedAt: s.warnedAt ? new Date(s.warnedAt).toISOString() : null,
        readyAt: s.readyAt ? new Date(s.readyAt).toISOString() : null,
        lastCtxPct: s.lastCtxPct,
        autoCompactEnabled: row ? isOptedIn(row) : true,
      });
    }
    return out;
  },

  getSessionState(sessionId: string): PreCompactState {
    return states.get(sessionId)?.state ?? 'idle';
  },

  // Test helper — reset the entire state map between cases. Callers
  // in tests also need to reset the session-tick dedup window.
  _resetForTests(): void {
    states.clear();
  },
};
