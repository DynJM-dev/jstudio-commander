// Typed event bus contract — single source of truth shared across sidecar +
// frontend per ARCHITECTURE_SPEC v1.2 §5.5 + §7.3. This is the exhaustive
// discriminated union; no catch-all payloads, no `unknown`.
//
// N1 scope (this file): events needed for the 10 §1 acceptance criteria.
// N2–N6 extend via additional union variants — the exhaustive-check pattern
// at dispatch sites catches additions at compile time.

import type { SessionStatus } from './session-types.js';
import type { SessionState } from './session-state.js';

// ============================================================
// pty / OSC 133
// ============================================================

export interface PtyDataEvent {
  type: 'pty:data';
  sessionId: string;
  data: string;
  timestamp: number;
}

export interface PtyInputEvent {
  type: 'pty:input';
  sessionId: string;
  data: string;
  timestamp: number;
}

export interface CommandStartedEvent {
  type: 'command:started';
  sessionId: string;
  timestamp: number;
}

export interface CommandEndedEvent {
  type: 'command:ended';
  sessionId: string;
  exitCode: number | null;
  durationMs: number;
  timestamp: number;
}

export interface PromptStartedEvent {
  type: 'prompt:started';
  sessionId: string;
  timestamp: number;
}

// ============================================================
// session lifecycle
// ============================================================

export interface SessionCreatedEvent {
  type: 'session:created';
  sessionId: string;
  timestamp: number;
}

export interface SessionStatusEvent {
  type: 'session:status';
  sessionId: string;
  status: SessionStatus;
  exitCode?: number | null;
  timestamp: number;
}

export interface SessionStoppedEvent {
  type: 'session:stopped';
  sessionId: string;
  exitCode: number | null;
  timestamp: number;
}

// ============================================================
// system / diagnostics
// ============================================================

export interface SystemErrorEvent {
  type: 'system:error';
  sessionId?: string;
  code: string;
  message: string;
  timestamp: number;
}

export interface SystemWarningEvent {
  type: 'system:warning';
  sessionId?: string;
  code: string;
  message: string;
  timestamp: number;
}

export interface SystemInfoEvent {
  type: 'system:info';
  sessionId?: string;
  code: string;
  message: string;
  timestamp: number;
}

export interface PongEvent {
  type: 'pong';
  timestamp: number;
}

export interface SessionStateEvent {
  type: 'session:state';
  sessionId: string;
  state: SessionState;
  timestamp: number;
}

export interface ProjectFileChangedEvent {
  type: 'project:file-changed';
  projectId: string;
  file: 'STATE.md' | 'DECISIONS.md' | 'PROJECT_DOCUMENTATION.md' | 'CLAUDE.md';
  timestamp: number;
}

// ============================================================
// union + discriminator helpers
// ============================================================

export type WsEvent =
  | PtyDataEvent
  | PtyInputEvent
  | CommandStartedEvent
  | CommandEndedEvent
  | PromptStartedEvent
  | SessionCreatedEvent
  | SessionStatusEvent
  | SessionStoppedEvent
  | SystemErrorEvent
  | SystemWarningEvent
  | SystemInfoEvent
  | PongEvent
  | SessionStateEvent
  | ProjectFileChangedEvent;

export type WsEventType = WsEvent['type'];

export type EventOfType<T extends WsEventType> = Extract<WsEvent, { type: T }>;

// Assert-never helper for exhaustive switches. If a new event variant is added
// without a corresponding case in a dispatch site, TypeScript raises at this
// line.
export function assertNeverEvent(event: never): never {
  throw new Error(`Unhandled event variant: ${JSON.stringify(event)}`);
}
