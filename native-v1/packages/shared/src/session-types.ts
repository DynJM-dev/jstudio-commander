// Canonical session-type identifiers, matching `session_types` seed rows
// in packages/db/src/migrations/0002_seed_session_types.sql.
//
// Extensible: new runtime-binary personas (e.g. `coder-gpt`, `coder-gemini`)
// can be added in v2+ via a row insert — no type-union change required beyond
// extending this literal set.

export const SESSION_TYPE_IDS = ['pm', 'coder', 'raw'] as const;
export type SessionTypeId = (typeof SESSION_TYPE_IDS)[number];

export const SESSION_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
export type SessionEffort = (typeof SESSION_EFFORTS)[number];

export const SESSION_STATUSES = [
  'active',
  'working',
  'waiting',
  'idle',
  'stopped',
  'error',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

// Default effort per session type (matches ARCHITECTURE_SPEC v1.2 §10 seed).
export const SESSION_TYPE_EFFORT_DEFAULTS: Record<SessionTypeId, SessionEffort> = {
  pm: 'high',
  coder: 'medium',
  raw: 'medium',
};

// Bootstrap paths per session type. `null` means "no bootstrap injection"
// (Raw sessions). Raw bootstrapPath nullability is enforced in spawn logic.
export const SESSION_TYPE_BOOTSTRAP_PATHS: Record<SessionTypeId, string | null> = {
  pm: '~/.claude/prompts/pm-session-bootstrap.md',
  coder: '~/.claude/prompts/coder-session-bootstrap.md',
  raw: null,
};
