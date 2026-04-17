import { useEffect, useState } from 'react';
import type { Session, SessionTick, WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';
import { api } from '../services/api';

export interface SessionTickResult {
  tick: SessionTick | null;
  // Phase N.0 — true when Commander inferred a /compact rotation while
  // the prior tick was ≥90% (strong signal the stale context% is not
  // fresh). Callers should suppress the context-% figure + LiveActivityRow
  // until a real tick clears the flag.
  postCompact: boolean;
}

// Phase M — per-session telemetry hook. Subscribes to WS `session:tick`
// events for the given session id, fetches the last persisted tick on
// mount so the view doesn't render "ctx —" for up to 300ms while the
// next statusline fire arrives.
//
// Phase N.0 — also tracks the post-compact inference flag. Any
// `session:updated` event for this session id re-reads
// `postCompactUntilNextTick`; `session:tick` arrival clears it locally
// (and the server flips the DB row in the same ingest).
export const useSessionTick = (sessionId: string | undefined): SessionTickResult => {
  const [tick, setTick] = useState<SessionTick | null>(null);
  const [postCompact, setPostCompact] = useState(false);
  const { lastEvent } = useWebSocket();

  useEffect(() => {
    if (!sessionId) {
      setTick(null);
      setPostCompact(false);
      return;
    }
    let cancelled = false;
    setTick(null);
    setPostCompact(false);
    // Hydrate tick + post-compact flag in parallel; either can 404 for a
    // brand-new session — both fall to their respective defaults.
    void api
      .get<SessionTick>(`/sessions/${sessionId}/tick`)
      .then((initial) => { if (!cancelled) setTick(initial); })
      .catch(() => { /* 404 before first tick — expected */ });
    void api
      .get<Session>(`/sessions/${sessionId}`)
      .then((s) => { if (!cancelled) setPostCompact(!!s.postCompactUntilNextTick); })
      .catch(() => { /* session removed mid-fetch — harmless */ });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'session:tick' && event.sessionId === sessionId) {
      setTick(event.tick);
      // Tick arrival is authoritative — server cleared the flag in the
      // same ingest. Mirror it client-side so the UI doesn't wait for the
      // follow-on session:updated event to render fresh telemetry.
      setPostCompact(false);
    }
    if (event.type === 'session:updated' && event.session.id === sessionId) {
      setPostCompact(!!event.session.postCompactUntilNextTick);
    }
  }, [lastEvent, sessionId]);

  return { tick, postCompact };
};
