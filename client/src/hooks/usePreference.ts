import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';
import { wsClient } from '../services/ws';

// In-memory mirror so successive mounts of the same key skip the network
// round-trip and avoid the default-value flash. Persisted writes still go
// to the server; this is purely a request-dedup layer for the same tab.
const cache = new Map<string, unknown>();

interface PreferenceResponse<T> { key: string; value: T }

export const usePreference = <T,>(key: string, defaultValue: T): [T, (next: T) => void] => {
  const [value, setValue] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : defaultValue));
  const writePending = useRef<Promise<unknown> | null>(null);

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
    writePending.current = api
      .put(`/preferences/${encodeURIComponent(key)}`, { value: next })
      .catch(() => { /* swallow — banner surfaces server downtime */ });
  }, [key]);

  return [value, update];
};
