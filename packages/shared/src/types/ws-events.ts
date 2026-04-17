import type { Session, SessionStatus, SessionActivity, Teammate } from './session.js';
import type { ChatMessage } from './chat.js';
import type { Project } from './project.js';
import type { TokenUsageEntry, DailyStats } from './analytics.js';
import type { SessionTick } from './session-tick.js';
import type { SystemStatsPayload, AggregateRateLimitsPayload } from './system-stats.js';

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
    }
  | { type: 'chat:message'; sessionId: string; message: ChatMessage }
  | { type: 'chat:messages'; sessionId: string; messages: ChatMessage[] }
  | { type: 'project:updated'; project: Project }
  | { type: 'project:scanned'; projects: Project[] }
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
  | { type: 'system:rate-limits'; rateLimits: AggregateRateLimitsPayload };

export type WSCommand =
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'session:command'; sessionId: string; command: string }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] };
