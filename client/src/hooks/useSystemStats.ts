import { useEffect, useState } from 'react';
import type { SystemStatsPayload, WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';

// Phase O — host CPU + memory hook. The server emits a `system:stats`
// event every 2s; we just mirror it into React state so the
// HeaderStatsWidget re-renders on every sample. Clients auto-subscribe
// to the `system` channel on connect, so no explicit subscribe call is
// needed here.
//
// Returns null until the first sample arrives. Widget collapses to "—"
// chips in that window — happens for at most 2s after connect.

// Stale threshold: if no sample arrives for 3x the server cadence, the
// widget mutes. Protects against a restarting server from leaving
// confidently-stale CPU/mem numbers on screen.
export const SYSTEM_STATS_STALE_MS = 6000;

export interface UseSystemStatsResult {
  stats: SystemStatsPayload | null;
  isStale: boolean;
}

export const useSystemStats = (): UseSystemStatsResult => {
  const [stats, setStats] = useState<SystemStatsPayload | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const { lastEvent } = useWebSocket();

  // 2s heartbeat for the stale-derivation (matches server cadence).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'system:stats') {
      setStats(event.stats);
      setNow(Date.now());
    }
  }, [lastEvent]);

  const isStale = stats === null ? false : now - stats.ts > SYSTEM_STATS_STALE_MS;
  return { stats, isStale };
};
