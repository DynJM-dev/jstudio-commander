// Phase W — pane pin model. A single global row decides what the
// workspace shows: 0, 1, or 2 session panes side-by-side. Replaces the
// per-PM split-state keys (one per parent session) with a single
// account-wide pin pair.
//
// Storage: serialized in the `preferences` table under key `pane-state`.
// Transport: reuses `GET/PUT /api/preferences/:key` + the `preference:
// changed` WS broadcast so every tab converges to the same pin state
// without a bespoke endpoint.
//
// Field semantics:
// - `left` / `right` are Commander session ids (not claude_session_id).
//   `null` means that slot is empty. `right` can only be non-null when
//   `left` is also non-null — the UI enforces this; server migration
//   normalizes.
// - `dividerRatio` is the left pane's fraction of the total width in
//   the 2-pane layout. Clamped to [0.3, 0.7] client-side so neither
//   pane can collapse below the 320px min.
// - `focusedSessionId` must equal `left` or `right` when either is non-
//   null. `null` only in the 0-pane state. Click-to-focus writes this;
//   Cmd+J reads it to decide which pane's drawer to toggle.
export interface PaneState {
  left: string | null;
  right: string | null;
  dividerRatio: number;
  focusedSessionId: string | null;
}

export const DEFAULT_PANE_STATE: PaneState = {
  left: null,
  right: null,
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
}

export const DEFAULT_SESSION_UI: SessionUi = {
  terminalDrawerOpen: false,
  terminalDrawerHeightPx: null,
};

export const sessionUiKey = (sessionId: string): string => `session-ui.${sessionId}`;

// Drawer height clamps. Min is absolute px, max is a fraction of the
// pane content height (applied client-side where the pane dims live).
export const MIN_DRAWER_HEIGHT_PX = 200;
export const MAX_DRAWER_HEIGHT_RATIO = 0.7;
export const DEFAULT_DRAWER_HEIGHT_RATIO = 0.35;
