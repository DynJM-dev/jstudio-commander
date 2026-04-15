import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../services/api';

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

  const update = useCallback((next: T) => {
    cache.set(key, next);
    setValue(next);
    writePending.current = api
      .put(`/preferences/${encodeURIComponent(key)}`, { value: next })
      .catch(() => { /* swallow — banner surfaces server downtime */ });
  }, [key]);

  return [value, update];
};
