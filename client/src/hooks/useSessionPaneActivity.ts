import { useEffect, useRef, useState } from 'react';
import type { WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';

// Commander Finalizer FINAL — Phase T pane-activity ground truth for
// the status bar. The `pane-capture:<sessionId>` WS channel (same feed
// TmuxMirror consumes) broadcasts a snapshot every status-poller tick
// whenever tmux pane content changes. If pane text is changing, Claude
// is actively producing output — regardless of whether the transcript-
// authoritative derivation has caught up (Phase Y's architectural
// ceiling, `docs/phase-y-closeout.md`). Wire this as the primary
// `isWorking` input and the bar matches what the user sees live.
//
// Window of 3s is 2× the status-poller cadence (1.5s) — one missed
// tick is tolerated, two in a row means the pane has settled. Tune
// downward if single-tick flicker becomes an issue, or upward if
// long tool-pause gaps (>3s between emits during a single turn)
// produce false-idle flashes.

export const PANE_ACTIVITY_WINDOW_MS = 3_000;

// Stability poll interval — how often the hook checks whether the
// window has elapsed since the last pane change. Fast enough to feel
// responsive when Claude finishes streaming (user expects the status
// to flip within a beat), cheap enough to not hammer renders.
const STABILITY_POLL_MS = 500;

// Cheap content fingerprint. Full string comparison is O(n) per event
// anyway; a fingerprint just keeps the ref short. Length + head + tail
// catches the overwhelmingly common case (Claude streaming appends
// content at the end, wraps lines, redraws the footer). A same-length
// internal cursor-only redraw wouldn't move the hash — acceptable: a
// pure cursor toggle is not "work happening", and the real signal is
// that the pane TEXT changed.
const fingerprintPane = (text: string): string => {
  if (text.length === 0) return '0:';
  const head = text.slice(0, 200);
  const tail = text.length > 400 ? text.slice(-200) : '';
  return `${text.length}:${head}\u0000${tail}`;
};

export interface PaneActivityResult {
  paneActivelyChanging: boolean;
}

export const useSessionPaneActivity = (
  sessionId: string | undefined,
): PaneActivityResult => {
  const { lastEvent, subscribe, unsubscribe } = useWebSocket();
  const lastHashRef = useRef<string | null>(null);
  const lastChangeTsRef = useRef<number>(0);
  const [paneActivelyChanging, setPaneActivelyChanging] = useState(false);

  // Subscribe to the session-scoped pane-capture channel. TmuxMirror
  // subscribes to the same channel; the WS client's subscription is
  // reference-counted so both consumers coexist without duplicating
  // server-side emits.
  useEffect(() => {
    if (!sessionId) return;
    const channel = `pane-capture:${sessionId}`;
    subscribe([channel]);
    return () => unsubscribe([channel]);
  }, [sessionId, subscribe, unsubscribe]);

  // Reset on sessionId change so a pane-switch doesn't carry stale
  // activity state from the previous session (e.g. split-view re-key).
  useEffect(() => {
    lastHashRef.current = null;
    lastChangeTsRef.current = 0;
    setPaneActivelyChanging(false);
  }, [sessionId]);

  // WS event handler. Filter by type + sessionId — split view has two
  // hook instances, and lastEvent is shared via context. The sessionId
  // guard is how TmuxMirror keeps panes isolated; we do the same.
  useEffect(() => {
    if (!lastEvent) return;
    if (!sessionId) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'session:pane-capture') return;
    if (event.sessionId !== sessionId) return;
    const next = fingerprintPane(event.paneText);
    if (next === lastHashRef.current) return;
    lastHashRef.current = next;
    lastChangeTsRef.current = Date.now();
    setPaneActivelyChanging(true);
  }, [lastEvent, sessionId]);

  // Stability detector. WS events fire only on content CHANGES, so
  // once the pane settles nothing would naturally flip us back to
  // idle. A lightweight ticker watches the window since last change
  // and flips the flag when elapsed. Only runs while active — zero
  // cost on truly idle sessions.
  useEffect(() => {
    if (!paneActivelyChanging) return;
    const interval = setInterval(() => {
      const since = Date.now() - lastChangeTsRef.current;
      if (since > PANE_ACTIVITY_WINDOW_MS) {
        setPaneActivelyChanging(false);
      }
    }, STABILITY_POLL_MS);
    return () => clearInterval(interval);
  }, [paneActivelyChanging]);

  return { paneActivelyChanging };
};

// Pure predicate exported for unit tests — encapsulates the same
// "fingerprint differs" logic the hook uses internally. Tests can
// exercise the stability contract without mounting React / WS.
export const paneActivityShouldBeActive = (args: {
  lastChangeTs: number;
  nowMs: number;
  windowMs?: number;
}): boolean => {
  const window = args.windowMs ?? PANE_ACTIVITY_WINDOW_MS;
  if (args.lastChangeTs <= 0) return false;
  return args.nowMs - args.lastChangeTs <= window;
};
