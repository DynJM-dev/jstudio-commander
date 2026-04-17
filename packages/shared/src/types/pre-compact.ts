// Phase Q — pre-compact auto-assistant state, wire-format across REST
// + WebSocket.

// States per session. `idle` is the default and carries no payload
// client-side. `warned` means Commander injected the "save state +
// reply READY_TO_COMPACT" message; the session's AI is expected to
// reply. `compacting` means Commander tmux-injected `/compact` and
// is waiting for context to drop back under RESET_THRESHOLD.
export type PreCompactState = 'idle' | 'warned' | 'compacting';

// Shape broadcast on the `sessions` WS channel when a transition
// fires. `ctxPct` is the tick % that triggered the transition (or
// the reset threshold when closing the loop). `timestamp` is ISO-8601.
export interface PreCompactStateChangedEvent {
  sessionId: string;
  state: PreCompactState;
  ctxPct: number | null;
  timestamp: string;
  // 'warned' → 'compacting' transitions distinguish between the
  // explicit READY_TO_COMPACT ack and the emergency 95% path. Useful
  // for UI copy + telemetry.
  reason: 'warn-threshold' | 'ready-ack' | 'emergency' | 'reset' | 'hysteresis';
}

// Full-state snapshot returned by GET /api/pre-compact/status. One
// entry per session Commander is tracking (empty when Commander has
// just booted and seen no ticks yet).
export interface PreCompactStatusSnapshot {
  sessions: Array<{
    sessionId: string;
    state: PreCompactState;
    warnedAt: string | null;
    readyAt: string | null;
    lastCtxPct: number | null;
    autoCompactEnabled: boolean;
  }>;
}
