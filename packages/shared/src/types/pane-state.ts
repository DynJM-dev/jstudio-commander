// Phase W.2 — pane model. URL `/chat/:sessionId` owns the LEFT pane.
// Persisted state carries only the RIGHT pane id + divider + focus.
// This is the W → W.2 reshape: Phase W persisted both `left` and
// `right` which duplicated the URL; W.2 drops `left` so clicking a
// session in Sessions page always opens single-pane (never implicitly
// pairs with a persisted right).
//
// Storage: `preferences` table key `pane-state`. Transport: existing
// `/api/preferences/:key` + `preference:changed` WS broadcast.
//
// Invariants (enforced by paneStateReducer):
// - `focusedSessionId` ∈ {urlLeft, rightSessionId, null}; any other
//   value is normalized to null at read time by consumers.
// - `dividerRatio` ∈ [0.3, 0.7].
// - `rightSessionId` must never equal the URL left (enforced by the
//   reducer's openRight action — a no-op when the id matches the
//   current left).
export interface PaneState {
  rightSessionId: string | null;
  dividerRatio: number;
  focusedSessionId: string | null;
}

export const DEFAULT_PANE_STATE: PaneState = {
  rightSessionId: null,
  dividerRatio: 0.5,
  focusedSessionId: null,
};

export const PANE_STATE_KEY = 'pane-state';
export const MIN_DIVIDER_RATIO = 0.3;
export const MAX_DIVIDER_RATIO = 0.7;
export const MIN_PANE_WIDTH_PX = 320;

// Per-pane terminal drawer state. One entry per session — keyed by
// session id so two pinned sessions have fully independent drawer
// open/closed + height. Stored under `session-ui.<sessionId>` in the
// preferences table. Orphan cleanup on session delete is cheap (a
// single DELETE LIKE) and non-critical — stale entries are 2 fields.
export interface SessionUi {
  terminalDrawerOpen: boolean;
  // Height in px. `null` means "not yet chosen" — the client computes
  // 35% of the pane content height on first open and writes it back.
  terminalDrawerHeightPx: number | null;
  // Phase T MVP — tmux mirror pane visibility, per session. Defaults
  // to true so the mirror is observable out of the box; users can
  // hide per-session via the header toggle. Persistence key is the
  // same `session-ui.<sessionId>` preference row.
  mirrorVisible: boolean;
}

export const DEFAULT_SESSION_UI: SessionUi = {
  terminalDrawerOpen: false,
  terminalDrawerHeightPx: null,
  mirrorVisible: true,
};

export const sessionUiKey = (sessionId: string): string => `session-ui.${sessionId}`;

// Drawer height clamps. Min is absolute px, max is a fraction of the
// pane content height (applied client-side where the pane dims live).
export const MIN_DRAWER_HEIGHT_PX = 200;
export const MAX_DRAWER_HEIGHT_RATIO = 0.7;
export const DEFAULT_DRAWER_HEIGHT_RATIO = 0.35;
