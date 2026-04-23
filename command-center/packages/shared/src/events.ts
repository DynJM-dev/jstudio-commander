// Shared event shapes — per-session WebSocket channel discriminated unions
// (KB-P1.13). N1 defines the types; wiring arrives in N3 (per-session WS
// subscription) and N6 (renderer registry).

export type PtyEvent =
  | { kind: 'data'; sessionId: string; bytes: string /* base64 utf8 */ }
  | { kind: 'exit'; sessionId: string; exitCode: number };

export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TaskCreated'
  | 'TaskCompleted'
  | 'SessionEnd'
  | 'PreCompact'
  | 'PostCompact';

export interface HookEvent {
  sessionId: string;
  eventName: HookEventName;
  timestamp: string;
  payload: unknown; // raw payload per KB-P1.1 schema-drift defense
}

export type SessionStatus =
  | 'initializing'
  | 'working'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface StatusEvent {
  sessionId: string;
  status: SessionStatus;
  timestamp: string;
}

export interface ApprovalEvent {
  sessionId: string;
  approvalId: string;
  toolName: string;
  toolInput: unknown;
  timestamp: string;
}

export const SIDECAR_PORT_RANGE = { start: 11002, end: 11011 } as const;
