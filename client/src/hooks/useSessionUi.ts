import { useCallback } from 'react';
import {
  DEFAULT_SESSION_UI,
  sessionUiKey,
  MIN_DRAWER_HEIGHT_PX,
  MAX_DRAWER_HEIGHT_RATIO,
  DEFAULT_DRAWER_HEIGHT_RATIO,
  type SessionUi,
} from '@commander/shared';
import { usePreference } from './usePreference';

// Phase W — per-session drawer state. One preferences row per session
// (key: `session-ui.<sessionId>`) so two pinned panes have fully
// independent terminal drawer open-state and height.
//
// Height is stored in px. `null` means "no user choice yet" — the
// drawer's first open computes `paneHeight * DEFAULT_DRAWER_HEIGHT_RATIO`
// and writes that value back, so subsequent opens restore the exact
// pixel height the user left. Clamped to [MIN_DRAWER_HEIGHT_PX,
// paneHeight * MAX_DRAWER_HEIGHT_RATIO] on every write.

interface SessionUiActions {
  setOpen: (open: boolean) => void;
  // Pane height is required so the min/max can clamp against the
  // current viewport — a persisted 800px drawer mustn't survive a
  // window resize that makes the pane 300px tall.
  setHeight: (px: number, paneHeightPx: number) => void;
  toggle: (paneHeightPx: number) => void;
  // Resolve the effective drawer height in px, given the current pane
  // height. When no user choice is stored yet, returns the default
  // (35% of pane). Never returns null — callers always get a number.
  effectiveHeight: (paneHeightPx: number) => number;
  // Phase T MVP — tmux mirror pane visibility per session.
  setMirrorVisible: (visible: boolean) => void;
  toggleMirror: () => void;
}

const clampHeight = (px: number, paneHeightPx: number): number => {
  const maxPx = Math.floor(paneHeightPx * MAX_DRAWER_HEIGHT_RATIO);
  if (px < MIN_DRAWER_HEIGHT_PX) return MIN_DRAWER_HEIGHT_PX;
  if (px > maxPx) return Math.max(maxPx, MIN_DRAWER_HEIGHT_PX);
  return px;
};

export const useSessionUi = (sessionId: string): [SessionUi, SessionUiActions] => {
  const [state, setState] = usePreference<SessionUi>(
    sessionUiKey(sessionId),
    DEFAULT_SESSION_UI,
  );

  const setOpen = useCallback((open: boolean) => {
    if (state.terminalDrawerOpen === open) return;
    setState({ ...state, terminalDrawerOpen: open });
  }, [state, setState]);

  const setHeight = useCallback((px: number, paneHeightPx: number) => {
    const clamped = clampHeight(px, paneHeightPx);
    if (clamped === state.terminalDrawerHeightPx) return;
    setState({ ...state, terminalDrawerHeightPx: clamped });
  }, [state, setState]);

  const toggle = useCallback((paneHeightPx: number) => {
    const next: SessionUi = state.terminalDrawerOpen
      ? { ...state, terminalDrawerOpen: false }
      : {
          ...state,
          terminalDrawerOpen: true,
          terminalDrawerHeightPx: state.terminalDrawerHeightPx
            ?? clampHeight(
              Math.floor(paneHeightPx * DEFAULT_DRAWER_HEIGHT_RATIO),
              paneHeightPx,
            ),
        };
    setState(next);
  }, [state, setState]);

  const effectiveHeight = useCallback((paneHeightPx: number): number => {
    const raw = state.terminalDrawerHeightPx
      ?? Math.floor(paneHeightPx * DEFAULT_DRAWER_HEIGHT_RATIO);
    return clampHeight(raw, paneHeightPx);
  }, [state.terminalDrawerHeightPx]);

  const setMirrorVisible = useCallback((visible: boolean) => {
    // Read `state.mirrorVisible ?? true` so legacy stored preference
    // rows (pre-Phase-T) without the field default to visible — same
    // shape as DEFAULT_SESSION_UI. Avoids a persistence migration.
    const current = state.mirrorVisible ?? true;
    if (current === visible) return;
    setState({ ...state, mirrorVisible: visible });
  }, [state, setState]);

  const toggleMirror = useCallback(() => {
    const current = state.mirrorVisible ?? true;
    setState({ ...state, mirrorVisible: !current });
  }, [state, setState]);

  return [state, { setOpen, setHeight, toggle, effectiveHeight, setMirrorVisible, toggleMirror }];
};
