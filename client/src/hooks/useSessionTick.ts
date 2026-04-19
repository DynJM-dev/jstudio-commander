import { useCallback, useEffect, useState } from 'react';
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
//
// Issue 15.1-C — `refetch()` forces a GET against the persisted tick
// endpoint. Exposed for lifecycle events (e.g. `compact_boundary`
// arrival) where the next WS tick would otherwise wait for next-turn
// activity, leaving ContextBar % stale for 10-60s post-compaction.
export interface UseSessionTickResult {
  tick: SessionTick | null;
  refetch: () => Promise<void>;
}

export const useSessionTick = (sessionId: string | undefined): UseSessionTickResult => {
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

  const refetch = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    try {
      const fresh = await api.get<SessionTick>(`/sessions/${sessionId}/tick`);
      setTick(fresh);
    } catch {
      // 404 is expected for sessions with no persisted tick yet.
    }
  }, [sessionId]);

  return { tick, refetch };
};
