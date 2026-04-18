import { useCallback } from 'react';
import {
  DEFAULT_PANE_STATE,
  PANE_STATE_KEY,
  type PaneState,
} from '@commander/shared';
import { usePreference } from './usePreference';
import { paneStateReducer, type PaneAction } from '../utils/pane-state-reducer';

// Phase W — typed facade over `usePreference(PANE_STATE_KEY)` plus the
// action set the UI needs. All invariant enforcement lives in the pure
// `paneStateReducer` (unit-tested in isolation) so the hook body is a
// thin "dispatch → persist if changed" layer.
//
// Invariants (see reducer tests):
//   - `right` is only non-null when `left` is non-null (unpinning left
//     with right set promotes right → left).
//   - `focusedSessionId` ∈ {left, right, null}; focus on an unpinned
//     session is ignored silently (stale-click safe).
//   - `dividerRatio` ∈ [MIN, MAX]; NaN falls back to 0.5.
//   - Pin is rejected when 2 sessions are already pinned.
//
// Cross-tab sync comes for free via usePreference's
// `preference:changed` WS listener.

export interface PaneStateActions {
  pin: (sessionId: string) => void;
  unpin: (sessionId: string) => void;
  focus: (sessionId: string) => void;
  setDivider: (ratio: number) => void;
  // Whether `sessionId` currently occupies a pane slot. UI uses this
  // to flip the pin icon between pinned/unpinned visual states.
  isPinned: (sessionId: string) => boolean;
  // Whether a pin action for `sessionId` would succeed right now.
  // `true` when already pinned (so unpin path is obvious) OR when at
  // least one slot is free. `false` when two OTHER sessions are
  // pinned — UI disables the icon + shows "unpin one first" tooltip.
  canPin: (sessionId: string) => boolean;
}

export const usePaneState = (): [PaneState, PaneStateActions] => {
  const [state, setState] = usePreference<PaneState>(PANE_STATE_KEY, DEFAULT_PANE_STATE);

  const dispatch = useCallback((action: PaneAction) => {
    const next = paneStateReducer(state, action);
    // Reducer returns the SAME reference on no-op so we skip the
    // server round-trip + WS broadcast when nothing actually changed.
    if (next !== state) setState(next);
  }, [state, setState]);

  const pin = useCallback((sessionId: string) => dispatch({ type: 'pin', sessionId }), [dispatch]);
  const unpin = useCallback((sessionId: string) => dispatch({ type: 'unpin', sessionId }), [dispatch]);
  const focus = useCallback((sessionId: string) => dispatch({ type: 'focus', sessionId }), [dispatch]);
  const setDivider = useCallback((ratio: number) => dispatch({ type: 'set-divider', ratio }), [dispatch]);

  const isPinned = useCallback(
    (sessionId: string) => state.left === sessionId || state.right === sessionId,
    [state.left, state.right],
  );

  const canPin = useCallback(
    (sessionId: string) => {
      if (state.left === sessionId || state.right === sessionId) return true;
      return state.left === null || state.right === null;
    },
    [state.left, state.right],
  );

  return [state, { pin, unpin, focus, setDivider, isPinned, canPin }];
};
