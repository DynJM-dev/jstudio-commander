import { useCallback, useEffect } from 'react';
import {
  DEFAULT_PANE_STATE,
  PANE_STATE_KEY,
  type PaneState,
} from '@commander/shared';
import { usePreference } from './usePreference';
import { useWebSocket } from './useWebSocket';
import { paneStateReducer, type PaneAction } from '../utils/pane-state-reducer';

// Phase W.2 — typed facade over usePreference + paneStateReducer.
// URL `/chat/:sessionId` owns the left pane; this hook manages the
// rightSessionId + dividerRatio + focusedSessionId.
//
// The hook also owns the termination-cascade listener: when a WS
// `session:updated` arrives with status='stopped' (or a `session:
// deleted` event), any reference in pane-state is cleared via the
// `session-gone` reducer action. That's how terminate-from-anywhere
// cleans the split view without every call site having to know about
// pane-state.

interface PaneStateActions {
  // Open a session in the right pane. No-op when sessionId equals
  // the URL left (can't have same session in both slots).
  openRight: (sessionId: string, currentLeft: string | null) => void;
  closeRight: () => void;
  // Router calls this when the URL left changes. Collapses right
  // when new URL matches right, normalizes focus.
  onUrlChanged: (newLeft: string | null) => void;
  focus: (sessionId: string, currentLeft: string | null) => void;
  setDivider: (ratio: number) => void;
}

export const usePaneState = (): [PaneState, PaneStateActions] => {
  const [state, setState] = usePreference<PaneState>(PANE_STATE_KEY, DEFAULT_PANE_STATE);
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();

  const dispatch = useCallback((action: PaneAction) => {
    const next = paneStateReducer(state, action);
    if (next !== state) setState(next);
  }, [state, setState]);

  // Subscribe to the `sessions` channel so lifecycle events arrive.
  useEffect(() => {
    subscribe(['sessions']);
    return () => unsubscribe(['sessions']);
  }, [subscribe, unsubscribe]);

  // Termination cascade: clear pane-state references to any session
  // that was just stopped or deleted. Covers every path (user
  // delete, server-side cleanup, crash detection) because they all
  // flow through the same WS event stream.
  useEffect(() => {
    if (!lastEvent) return;
    const e = lastEvent as { type?: string; session?: { id?: string; status?: string }; sessionId?: string };
    if (e.type === 'session:deleted' && typeof e.sessionId === 'string') {
      dispatch({ type: 'session-gone', sessionId: e.sessionId });
      return;
    }
    if (e.type === 'session:updated' && e.session?.status === 'stopped' && typeof e.session.id === 'string') {
      dispatch({ type: 'session-gone', sessionId: e.session.id });
    }
  }, [lastEvent, dispatch]);

  const openRight = useCallback(
    (sessionId: string, currentLeft: string | null) => dispatch({ type: 'open-right', sessionId, currentLeft }),
    [dispatch],
  );
  const closeRight = useCallback(() => dispatch({ type: 'close-right' }), [dispatch]);
  const onUrlChanged = useCallback(
    (newLeft: string | null) => dispatch({ type: 'url-changed', newLeft }),
    [dispatch],
  );
  const focus = useCallback(
    (sessionId: string, currentLeft: string | null) => dispatch({ type: 'focus', sessionId, currentLeft }),
    [dispatch],
  );
  const setDivider = useCallback((ratio: number) => dispatch({ type: 'set-divider', ratio }), [dispatch]);

  return [state, { openRight, closeRight, onUrlChanged, focus, setDivider }];
};
