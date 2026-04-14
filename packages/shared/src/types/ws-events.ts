import type { Session, SessionStatus, Teammate } from './session.js';
import type { ChatMessage } from './chat.js';
import type { Project } from './project.js';
import type { TokenUsageEntry, DailyStats } from './analytics.js';

export type WSEvent =
  | { type: 'session:created'; session: Session }
  | { type: 'session:updated'; session: Session }
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:status'; sessionId: string; status: SessionStatus }
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
  | { type: 'teammate:spawned'; teammate: Teammate }
  | { type: 'teammate:dismissed'; sessionId: string };

export type WSCommand =
  | { type: 'terminal:input'; sessionId: string; data: string }
  | { type: 'terminal:resize'; sessionId: string; cols: number; rows: number }
  | { type: 'session:command'; sessionId: string; command: string }
  | { type: 'subscribe'; channels: string[] }
  | { type: 'unsubscribe'; channels: string[] };
