import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '@commander/shared';

// Issue 15.3 Fix 1 — client-side wall-clock timestamp of the last time
// `sessionState` delivered a new value (by reference, not deep equality).
//
// Why: `isSessionWorking` at ChatPage must OR-gate typed `Working` kind
// as a coarse signal (§12.3 Cause 1 — `session.status` can lag by 15-20s
// while `sessionState.kind='Working:*'` is emitted). Naively consuming
// `sessionState.kind` would re-introduce stale-Working false positives
// on prior-turn carryover. The freshness predicate
// (`sessionStateUpdatedAt > lastUserMessageTs`) gates the OR-branch
// against that carryover: only typed state observed AFTER the user's
// most recent prompt counts as "live working".
//
// Reference-equality check is load-bearing: `useSessionState` produces
// a new object per server event (setState on each push), so a new
// reference implies a fresh server event even if the deep contents
// match the previous value. Deep-equal incoming values still advance
// the timestamp because each represents a separate server confirmation
// of the state — stale carryover would not re-emit at all.
//
// Initial value is 0 so a fresh client with no typed state observed
// fails the freshness comparison against any real user-message
// timestamp. `userJustSent` / other OR-branches carry the bar in that
// window.
//
// Scope: purely client-side observational. Does NOT modify the
// `SessionState` type (per dispatch boundary).
export const useSessionStateUpdatedAt = (sessionState: SessionState | null): number => {
  const [ts, setTs] = useState<number>(0);
  const prevRef = useRef<SessionState | null>(null);
  useEffect(() => {
    if (sessionState !== prevRef.current) {
      prevRef.current = sessionState;
      if (sessionState) setTs(Date.now());
    }
  }, [sessionState]);
  return ts;
};
