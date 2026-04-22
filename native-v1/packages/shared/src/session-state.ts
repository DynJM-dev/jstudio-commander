// Typed SessionState union per ARCHITECTURE_SPEC v1.2 §4.1 + N2 §1.2.
// State machine transitions are driven exclusively by typed events:
//   - OSC 133 markers (prompt:started, command:started, command:ended)
//   - Tool events (tool:use, tool:result) — N3 scope; type shape included now
//   - Approval prompts (approval:prompt, approval:resolved) — N3 scope
//   - PTY exit (session:stopped)
// No shape matching of raw output (OS §24 discipline).

export type ToolName =
  | 'read'
  | 'write'
  | 'edit'
  | 'bash'
  | 'grep'
  | 'glob'
  | 'task'
  | 'agent'
  | 'other';

export type SessionState =
  | { kind: 'active'; since: number }
  | { kind: 'working'; commandStartedAt: number; toolInProgress?: ToolName }
  | { kind: 'waiting'; approvalPromptId?: string; since: number }
  | { kind: 'idle'; sinceCommandEndedAt: number }
  | { kind: 'stopped'; exitCode: number | null; at: number }
  | { kind: 'error'; message: string; at: number };

export type SessionStateKind = SessionState['kind'];

/**
 * Maps a typed SessionState to the user-facing action label shown on the
 * ContextBar. Pure function — no side effects; lives here alongside the type
 * so both sidecar (transition emission) and frontend (label rendering)
 * reference the same source of truth.
 */
export function resolveActionLabel(state: SessionState): string {
  switch (state.kind) {
    case 'active':
      return 'Ready';
    case 'working':
      return state.toolInProgress
        ? `Running ${state.toolInProgress}`
        : 'Running command';
    case 'waiting':
      return 'Waiting for approval';
    case 'idle':
      return 'Idle at prompt';
    case 'stopped':
      return state.exitCode === 0 || state.exitCode === null
        ? 'Stopped'
        : `Stopped (exit ${state.exitCode})`;
    case 'error':
      return `Error: ${state.message}`;
  }
}

/**
 * Maps a state kind to a semantic color class. Consumers pick the concrete
 * token from their palette (the CSS variable space); this function only
 * names the kind.
 */
export function stateKindToColor(
  kind: SessionStateKind,
): 'neutral' | 'active' | 'success' | 'warning' | 'danger' {
  switch (kind) {
    case 'active':
      return 'neutral';
    case 'working':
      return 'active';
    case 'waiting':
      return 'warning';
    case 'idle':
      return 'success';
    case 'stopped':
      return 'neutral';
    case 'error':
      return 'danger';
  }
}
