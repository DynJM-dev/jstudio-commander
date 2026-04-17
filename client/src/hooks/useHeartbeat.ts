import { useEffect, useState } from 'react';
import type { WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';

export interface HeartbeatResult {
  // Epoch-ms of the last received `session:heartbeat` for this session,
  // null when nothing has arrived yet this mount. Seed value is pulled
  // from the optional `initialTs` param so a session list that already
  // knows `session.lastActivityAt` doesn't flash "—" on first render.
  lastActivityAt: number | null;
  // Live-derived from a 1s ticker against Date.now(); the component
  // re-renders every second so "2s ago" updates without a WS emit.
  secondsAgo: number;
  // True when `secondsAgo > STALE_THRESHOLD_S` (30). Used by SessionCard
  // to force-display idle regardless of server-side `status` and by
  // LiveActivityRow to suppress the working indicator.
  isStale: boolean;
}

// Phase N.0 Patch 3 — proof-of-life hook. Subscribes to the global
// `session:heartbeat` stream and exposes a seconds-since-last + stale
// flag for any caller that knows a sessionId. The 30s threshold matches
// CTO's spec: "if no update for >30s, UI force-displays idle".
const STALE_THRESHOLD_S = 30;
export const STALE_THRESHOLD_SECONDS = STALE_THRESHOLD_S;

// Cap the displayed number so stuck tabs don't render "3,472s ago".
export const SECONDS_DISPLAY_CAP = 999;

export const useHeartbeat = (
  sessionId: string | undefined,
  initialTs?: number | null,
): HeartbeatResult => {
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(
    initialTs && initialTs > 0 ? initialTs : null,
  );
  const [now, setNow] = useState<number>(() => Date.now());
  const { lastEvent } = useWebSocket();

  // Re-seed when the session switches or the caller-supplied initial
  // timestamp changes (parent re-fetched the row).
  useEffect(() => {
    setLastActivityAt(initialTs && initialTs > 0 ? initialTs : null);
  }, [sessionId, initialTs]);

  // 1s ticker for the "Xs ago" display. Writing a fresh `now` causes a
  // re-render even when lastActivityAt is unchanged, so the text below
  // advances every second without requiring a WS event.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!sessionId || !lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'session:heartbeat' && event.sessionId === sessionId) {
      setLastActivityAt(event.ts);
      // Snap `now` forward too so the display shows 0s immediately after
      // the event rather than waiting for the next tick.
      setNow(Date.now());
    }
  }, [lastEvent, sessionId]);

  const secondsAgo = lastActivityAt === null
    ? 0
    : Math.min(SECONDS_DISPLAY_CAP, Math.max(0, Math.round((now - lastActivityAt) / 1000)));
  const isStale = lastActivityAt !== null && secondsAgo > STALE_THRESHOLD_S;

  return { lastActivityAt, secondsAgo, isStale };
};

// Pure helper exposed so tests can pin the label contract without
// mounting React. Matches the render in HeartbeatDot.tsx.
export const formatSecondsAgo = (
  lastActivityAt: number | null,
  secondsAgo: number,
  isStale: boolean,
): string => {
  if (lastActivityAt === null) return '—';
  if (isStale) return 'stale';
  if (secondsAgo <= 0) return 'just now';
  return `${secondsAgo}s ago`;
};
