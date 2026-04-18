import {
  MIN_DIVIDER_RATIO,
  MAX_DIVIDER_RATIO,
  type PaneState,
} from '@commander/shared';

// Phase W.2 — pure reducer for pane state. URL `/chat/:id` owns the
// left pane; this reducer mutates only the right pane + divider +
// focus. Invariants:
//
//   1. `rightSessionId` never equals the URL left (open-right is a
//      no-op when sessionId === currentLeft).
//   2. `focusedSessionId` ∈ {currentLeft, rightSessionId, null}.
//      Focus on an unknown id → silently ignored.
//   3. `dividerRatio` ∈ [MIN, MAX]. NaN falls back to 0.5.
//   4. `closeLeft` is NOT encoded here — closing the left pane is a
//      navigation concern (URL changes). The `url-changed` action
//      is how the router tells us about it.
//
// All handlers return the SAME reference on no-op so callers can
// cheap-compare to skip the persist round-trip.

export type PaneAction =
  // Open a session as the right pane. `currentLeft` is the URL's
  // active session so we can reject open-right-equals-left. When
  // `currentLeft` is null the open still proceeds — right-without-
  // left is legal transiently between navigations.
  | { type: 'open-right'; sessionId: string; currentLeft: string | null }
  | { type: 'close-right' }
  // Called when the URL left changes (user navigated away). If the
  // new URL matches the current right, collapse to single-pane
  // (can't have same session on both sides). Normalize stale focus.
  | { type: 'url-changed'; newLeft: string | null }
  // Called when any session is terminated / deleted. Clears right
  // and/or focus if they pointed at the gone session. Navigating
  // away from a terminated left is the router's job.
  | { type: 'session-gone'; sessionId: string }
  // Focus a pane. `currentLeft` passed so the reducer validates
  // focusedSessionId ∈ {currentLeft, rightSessionId}.
  | { type: 'focus'; sessionId: string; currentLeft: string | null }
  | { type: 'set-divider'; ratio: number };

const clampRatio = (r: number): number => {
  if (Number.isNaN(r)) return 0.5;
  if (r < MIN_DIVIDER_RATIO) return MIN_DIVIDER_RATIO;
  if (r > MAX_DIVIDER_RATIO) return MAX_DIVIDER_RATIO;
  return r;
};

export const paneStateReducer = (state: PaneState, action: PaneAction): PaneState => {
  switch (action.type) {
    case 'open-right': {
      const { sessionId, currentLeft } = action;
      if (sessionId === currentLeft) return state;
      if (state.rightSessionId === sessionId) return state;
      return { ...state, rightSessionId: sessionId, focusedSessionId: sessionId };
    }
    case 'close-right': {
      if (state.rightSessionId === null) return state;
      const nextFocus = state.focusedSessionId === state.rightSessionId ? null : state.focusedSessionId;
      return { ...state, rightSessionId: null, focusedSessionId: nextFocus };
    }
    case 'url-changed': {
      const { newLeft } = action;
      let changed = false;
      let rightSessionId = state.rightSessionId;
      let focusedSessionId = state.focusedSessionId;
      if (rightSessionId !== null && rightSessionId === newLeft) {
        rightSessionId = null;
        changed = true;
      }
      if (focusedSessionId !== null && focusedSessionId !== newLeft && focusedSessionId !== rightSessionId) {
        focusedSessionId = null;
        changed = true;
      }
      return changed ? { ...state, rightSessionId, focusedSessionId } : state;
    }
    case 'session-gone': {
      const { sessionId } = action;
      let changed = false;
      let rightSessionId = state.rightSessionId;
      let focusedSessionId = state.focusedSessionId;
      if (rightSessionId === sessionId) {
        rightSessionId = null;
        changed = true;
      }
      if (focusedSessionId === sessionId) {
        focusedSessionId = null;
        changed = true;
      }
      return changed ? { ...state, rightSessionId, focusedSessionId } : state;
    }
    case 'focus': {
      const { sessionId, currentLeft } = action;
      if (sessionId !== currentLeft && sessionId !== state.rightSessionId) return state;
      if (state.focusedSessionId === sessionId) return state;
      return { ...state, focusedSessionId: sessionId };
    }
    case 'set-divider': {
      const clamped = clampRatio(action.ratio);
      if (clamped === state.dividerRatio) return state;
      return { ...state, dividerRatio: clamped };
    }
  }
};
