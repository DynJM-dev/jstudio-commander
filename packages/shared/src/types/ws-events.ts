import type { Session, SessionStatus, SessionActivity, Teammate } from './session.js';
import type { SessionState } from './session-state.js';
import type { ChatMessage } from './chat.js';
import type { Project } from './project.js';
import type { TokenUsageEntry, DailyStats } from './analytics.js';
import type { SessionTick } from './session-tick.js';
import type { SystemStatsPayload, AggregateRateLimitsPayload } from './system-stats.js';
import type { PreCompactState } from './pre-compact.js';

export type WSEvent =
  | { type: 'session:created'; session: Session }
  | { type: 'session:updated'; session: Session }
  | { type: 'session:deleted'; sessionId: string }
  | {
      type: 'session:status';
      sessionId: string;
      // Kept for back-compat — existing consumers read this as the "new"
      // status. Newer consumers should prefer `to` + the richer fields.
      status: SessionStatus;
      from?: SessionStatus;
      to?: SessionStatus;
      // Human-readable rationale captured at poll time ("active-indicator
      // ✽ in tail", "numbered-choice prompt", etc.). Absent on legacy
      // emit paths that predate Phase J.
      evidence?: string;
      // Live activity snapshot at transition time; null when nothing parses.
      activity?: SessionActivity | null;
      at?: string;
      // Issue 15.3 — canonical typed state. Optional during the dual-
      // emit migration; clients that recognize it SHOULD prefer it over
      // re-deriving from `status`. Absent on legacy emit paths.
      state?: SessionState;
    }
  | { type: 'chat:message'; sessionId: string; message: ChatMessage }
  | { type: 'chat:messages'; sessionId: string; messages: ChatMessage[] }
  | { type: 'project:updated'; project: Project }
  | { type: 'project:scanned'; projects: Project[] }
  // M7 MVP — live STATE.md pane. Delivered on the session-scoped
  // `project-state:<sessionId>` channel so subscribers are structurally
  // isolated from chat channels (subscription firewall per dispatch).
  // Payload carries the FULL new content so the client hook can render
  // without a second fetch; `content: null` means the file was removed
  // or couldn't be read.
  | {
      type: 'project:state-md-updated';
      sessionId: string;
      projectPath: string;
      content: string | null;
    }
  // Phase T MVP — tmux mirror pane feed. Broadcast on the session-
  // scoped `pane-capture:<sessionId>` channel with ANSI-preserved
  // pane text captured by the status-poller tick. Server dedupes on
  // content change so idle panes don't emit every tick.
  | {
      type: 'session:pane-capture';
      sessionId: string;
      paneText: string;
      capturedAt: number;
    }
  | { type: 'terminal:data'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'analytics:token'; entry: TokenUsageEntry }
  | { type: 'analytics:daily'; stats: DailyStats }
  | { type: 'tunnel:started'; url: string }
  | { type: 'tunnel:stopped' }
  | { type: 'tunnel:error'; error: string }
  | { type: 'system:error'; error: string }
  | { type: 'system:heartbeat'; timestamp: string }
  | { type: 'system:health'; timestamp: string }
  | { type: 'preference:changed'; key: string; value: unknown }
  | { type: 'teammate:spawned'; teammate: Teammate }
  | { type: 'teammate:dismissed'; sessionId: string }
  | { type: 'session:tick'; sessionId: string; tick: SessionTick }
  | { type: 'session:heartbeat'; sessionId: string; ts: number }
  | { type: 'system:stats'; stats: SystemStatsPayload }
  | { type: 'system:rate-limits'; rateLimits: AggregateRateLimitsPayload }
  | {
      type: 'pre-compact:state-changed';
      sessionId: string;
      state: PreCompactState;
      ctxPct: number | null;
      timestamp: string;
      reason: 'warn-threshold' | 'ready-ack' | 'emergency' | 'reset' | 'hysteresis';
    };

export type WSCommand =
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'session:command'; sessionId: string; command: string }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] };
