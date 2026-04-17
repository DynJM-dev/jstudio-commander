import { useEffect, useState } from 'react';
import type { SessionTick, WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';
import { api } from '../services/api';

// Phase M — per-session telemetry hook. Subscribes to WS `session:tick`
// events for the given session id, fetches the last persisted tick on
// mount so the view doesn't render "ctx —" for up to 300ms while the
// next statusline fire arrives.
//
// Returns the latest SessionTick OR null when no tick has ever arrived
// for this session (brand-new or pre-Phase-M legacy). Callers render a
// muted placeholder in that case instead of eagerly guessing from pane.
export const useSessionTick = (sessionId: string | undefined): SessionTick | null => {
  const [tick, setTick] = useState<SessionTick | null>(null);
  const { lastEvent } = useWebSocket();

  // Reset + hydrate whenever the session switches.
  useEffect(() => {
    if (!sessionId) {
      setTick(null);
      return;
    }
    let cancelled = false;
    setTick(null);
    api
      .get<SessionTick>(`/sessions/${sessionId}/tick`)
      .then((initial) => { if (!cancelled) setTick(initial); })
      .catch(() => { /* 404 before first tick — expected */ });
    return () => { cancelled = true; };
  }, [sessionId]);

  // Live stream — WS delivers a new tick every 300ms while Claude Code
  // is active, then quiesces when the session is idle.
  useEffect(() => {
    if (!sessionId || !lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'session:tick' && event.sessionId === sessionId) {
      setTick(event.tick);
    }
  }, [lastEvent, sessionId]);

  return tick;
};
