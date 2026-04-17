import { useEffect, useState } from 'react';
import type { PreCompactState, PreCompactStatusSnapshot, WSEvent } from '@commander/shared';
import { api } from '../services/api';
import { useWebSocket } from './useWebSocket';

// Phase Q — per-session pre-compact state subscription.
//
// On mount, hydrates from `GET /api/pre-compact/status` once. After
// that, the `pre-compact:state-changed` WS event drives every
// update. No polling. Returns `'idle'` when Commander hasn't seen
// this session yet — the card just won't render an indicator.

// Module-level cache so multiple cards that mount simultaneously
// don't each fire the hydrate fetch. The first mount fetches and
// populates; subsequent mounts read from the cache until the first
// WS event arrives.
let hydratedOnce = false;
const stateCache = new Map<string, PreCompactState>();

export const usePreCompactState = (sessionId: string | undefined): PreCompactState => {
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();
  const [state, setState] = useState<PreCompactState>(() =>
    sessionId ? stateCache.get(sessionId) ?? 'idle' : 'idle',
  );

  useEffect(() => {
    subscribe(['sessions']);
    return () => unsubscribe(['sessions']);
  }, [subscribe, unsubscribe]);

  // One-shot hydrate — populates the cache for every session at
  // once so later mounts don't re-fetch.
  useEffect(() => {
    if (hydratedOnce) return;
    hydratedOnce = true;
    api
      .get<PreCompactStatusSnapshot>('/pre-compact/status')
      .then((snap) => {
        for (const s of snap.sessions) {
          stateCache.set(s.sessionId, s.state);
        }
        if (sessionId) {
          const cached = stateCache.get(sessionId);
          if (cached) setState(cached);
        }
      })
      .catch(() => {
        // Endpoint optional during dev / pre-phase-Q server builds —
        // swallow and leave state at 'idle'.
      });
  }, [sessionId]);

  useEffect(() => {
    if (!lastEvent || !sessionId) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'pre-compact:state-changed') return;
    if (event.sessionId !== sessionId) {
      // Still update the cache so other mounts see fresh state.
      stateCache.set(event.sessionId, event.state);
      return;
    }
    stateCache.set(sessionId, event.state);
    setState(event.state);
  }, [lastEvent, sessionId]);

  return state;
};

// Test helper — clears the module-level cache between test cases.
export const _resetPreCompactCacheForTests = (): void => {
  hydratedOnce = false;
  stateCache.clear();
};
