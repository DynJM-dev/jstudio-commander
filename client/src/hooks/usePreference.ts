import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import { wsClient } from '../services/ws';

// In-memory mirror so successive mounts of the same key skip the network
// round-trip and avoid the default-value flash. Persisted writes still go
// to the server; this is purely a request-dedup layer for the same tab.
const cache = new Map<string, unknown>();

// Phase T hotfix — Fix Z: same-tab multi-instance sync. Peer hook
// instances that share a key (e.g. PaneHeaderWithMirror + Pane both
// calling `useSessionUi(sessionId)`) must stay in local-state sync
// when any instance calls `update()`. The existing cross-tab path
// via `wsClient.onEvent('preference:changed')` is short-circuited
// by the cache-match guard below — that guard is correct for its
// cross-tab echo-back purpose, but leaves same-tab peers stranded.
//
// Mechanism: module-level Map<key, Set<listener>>. Each hook
// instance subscribes its own setValue under the key on mount,
// unregisters on unmount (Map entry deleted when the last subscriber
// leaves — no long-uptime leak). `notifyPeers` walks the set and
// calls every listener EXCEPT the caller's own. The caller already
// ran setValue(next) directly; React bails on same-value setState
// anyway, but skipping self is cheaper and keeps the contract clean.
const subscribers = new Map<string, Set<(value: unknown) => void>>();

const subscribe = (
  key: string,
  listener: (value: unknown) => void,
): (() => void) => {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = subscribers.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) subscribers.delete(key);
  };
};

const notifyPeers = (
  key: string,
  next: unknown,
  self: ((value: unknown) => void) | null,
): void => {
  const peers = subscribers.get(key);
  if (!peers) return;
  peers.forEach((listener) => {
    if (listener === self) return;
    listener(next);
  });
};

// Test-only hooks for the Phase T hotfix pub-sub invariants. Not
// referenced by production code paths; exported so pure-Node tests
// can exercise the subscriber registry without a React renderer.
export const __usePreferenceTestSupport = {
  subscribe,
  notifyPeers,
  peekSubscriberCount: (key: string): number | null => {
    const set = subscribers.get(key);
    return set ? set.size : null;
  },
  reset: (): void => {
    subscribers.clear();
    cache.clear();
  },
};

interface PreferenceResponse<T> { key: string; value: T }

export const usePreference = <T,>(key: string, defaultValue: T): [T, (next: T) => void] => {
  const [value, setValue] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : defaultValue));
  const writePending = useRef<Promise<unknown> | null>(null);
  // Reference to THIS instance's subscriber listener so `update()`
  // can skip self-notification. Set in the subscribe effect below;
  // null until the effect runs on first commit.
  const selfListenerRef = useRef<((value: unknown) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cache.has(key)) {
      const cached = cache.get(key) as T;
      setValue(cached);
      return () => { cancelled = true; };
    }
    api
      .get<PreferenceResponse<T>>(`/preferences/${encodeURIComponent(key)}`)
      .then((res) => {
        if (cancelled) return;
        cache.set(key, res.value);
        setValue(res.value);
      })
      .catch((err) => {
        // 404 = no preference set yet, use defaultValue. Other errors
        // (network, server-down) also fall through to default — the next
        // write will reconcile.
        if (err instanceof ApiError && err.status === 404) {
          cache.set(key, defaultValue);
        }
      });
    return () => { cancelled = true; };
  }, [key]);

  // Phase T hotfix — register this instance in the same-tab subscriber
  // registry. On every peer `update()`, `setValue` is called to keep
  // local state in lock-step. Unsubscribe on key change / unmount; the
  // subscribe helper deletes the Map entry when the last subscriber
  // leaves.
  useEffect(() => {
    const listener = (v: unknown): void => setValue(v as T);
    selfListenerRef.current = listener;
    const unsubscribe = subscribe(key, listener);
    return () => {
      unsubscribe();
      if (selfListenerRef.current === listener) {
        selfListenerRef.current = null;
      }
    };
  }, [key]);

  // Cross-tab sync: server broadcasts preference:changed on every PUT/DELETE.
  // We patch the cache and local state when the event matches our key. Skip
  // when the value already matches to keep this idempotent — avoids re-render
  // loops if the same tab triggers the change.
  useEffect(() => {
    return wsClient.onEvent((event) => {
      if (event.type !== 'preference:changed') return;
      if (event.key !== key) return;
      const next = (event.value ?? defaultValue) as T;
      if (cache.get(key) === next) return;
      cache.set(key, next);
      setValue(next);
    });
  }, [key, defaultValue]);

  const update = useCallback((next: T) => {
    cache.set(key, next);
    setValue(next);
    // Phase T hotfix — notify same-tab peer instances so their local
    // state tracks the write. Cross-tab sync still runs via the WS
    // `preference:changed` path above (guarded by cache match, which
    // after `cache.set` above will short-circuit cleanly for the
    // writing tab's own echo-back).
    notifyPeers(key, next, selfListenerRef.current);
    writePending.current = api
      .put(`/preferences/${encodeURIComponent(key)}`, { value: next })
      .catch(() => { /* swallow — banner surfaces server downtime */ });
  }, [key]);

  return [value, update];
};
