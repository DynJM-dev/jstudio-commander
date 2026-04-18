import {
  MIN_DIVIDER_RATIO,
  MAX_DIVIDER_RATIO,
  type PaneState,
} from '@commander/shared';

// Phase W — pure reducer that encodes the invariants the UI promises:
//
//   1. `right` is only non-null when `left` is non-null. Unpinning
//      `left` while `right` exists promotes right → left (no orphan
//      right pane).
//   2. `focusedSessionId` must equal `left` or `right` (or null when
//      both are null).
//   3. `dividerRatio` ∈ [MIN_DIVIDER_RATIO, MAX_DIVIDER_RATIO].
//   4. Pin is rejected (no-op) when both slots occupied AND the
//      session isn't already pinned — prevents exceeding max 2.
//
// Extracted from the React hook so the invariants can be unit-tested
// without a DOM / usePreference stub. Every action returns a new
// PaneState; callers compare-by-reference to decide whether to
// persist.

export type PaneAction =
  | { type: 'pin'; sessionId: string }
  | { type: 'unpin'; sessionId: string }
  | { type: 'focus'; sessionId: string }
  | { type: 'set-divider'; ratio: number };

const clampRatio = (r: number): number => {
  if (Number.isNaN(r)) return 0.5;
  if (r < MIN_DIVIDER_RATIO) return MIN_DIVIDER_RATIO;
  if (r > MAX_DIVIDER_RATIO) return MAX_DIVIDER_RATIO;
  return r;
};

export const paneStateReducer = (state: PaneState, action: PaneAction): PaneState => {
  switch (action.type) {
    case 'pin': {
      const { sessionId } = action;
      if (state.left === sessionId || state.right === sessionId) return state;
      if (state.left === null) {
        return { ...state, left: sessionId, focusedSessionId: sessionId };
      }
      if (state.right === null) {
        return { ...state, right: sessionId, focusedSessionId: sessionId };
      }
      return state; // both slots occupied
    }
    case 'unpin': {
      const { sessionId } = action;
      if (state.right === sessionId) {
        const nextFocus = state.focusedSessionId === sessionId ? state.left : state.focusedSessionId;
        return { ...state, right: null, focusedSessionId: nextFocus };
      }
      if (state.left === sessionId) {
        if (state.right) {
          // Promote right → left so the {left:null, right:X} state
          // never exists. Divider ratio survives; focus falls to the
          // remaining pane when the unpinned one was focused.
          const nextFocus = state.focusedSessionId === sessionId ? state.right : state.focusedSessionId;
          return { left: state.right, right: null, dividerRatio: state.dividerRatio, focusedSessionId: nextFocus };
        }
        return { ...state, left: null, focusedSessionId: null };
      }
      return state;
    }
    case 'focus': {
      const { sessionId } = action;
      if (state.left !== sessionId && state.right !== sessionId) return state;
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
