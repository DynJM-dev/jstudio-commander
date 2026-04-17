import { useEffect, useState } from 'react';
import type { AggregateRateLimitsPayload, WSEvent } from '@commander/shared';
import { useWebSocket } from './useWebSocket';
import { api } from '../services/api';

// Phase O — account-wide 5h / 7d usage hook.
//
// On mount: GET /api/system/rate-limits to seed the initial shape so a
// freshly opened tab doesn't render "—" for the full tick cadence.
// Thereafter: listen for `system:rate-limits` WS events (server emits
// whenever the aggregate payload signature changes).
//
// Pcts are already null-gated server-side when the source tick is
// older than 10 minutes, so the widget can trust `pct === null` as
// the "show muted" signal without re-computing freshness here.

export const useAggregateRateLimits = (): AggregateRateLimitsPayload | null => {
  const [payload, setPayload] = useState<AggregateRateLimitsPayload | null>(null);
  const { lastEvent } = useWebSocket();

  useEffect(() => {
    let cancelled = false;
    api
      .get<AggregateRateLimitsPayload>('/system/rate-limits')
      .then((p) => { if (!cancelled) setPayload(p); })
      .catch(() => { /* server not up yet — WS will catch up */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'system:rate-limits') {
      setPayload(event.rateLimits);
    }
  }, [lastEvent]);

  return payload;
};

// Pure formatter — rendered in HeaderStatsWidget next to the pct chip.
// Input: ISO-8601 `resetsAt` (or null) + current wall-clock ms. Output:
// "4h 23m" / "14m 30s" / "resetting…" / "—".
//
// Thresholds are intentionally chunky — the widget is peripheral-vision,
// so we don't render second-accuracy until we're close to the reset.
export const formatResetsCountdown = (
  resetsAt: string | null,
  nowMs: number,
): string => {
  if (!resetsAt) return '—';
  const target = Date.parse(resetsAt);
  if (!Number.isFinite(target)) return '—';
  const msRemaining = target - nowMs;
  if (msRemaining <= 0) return 'resetting…';
  if (msRemaining < 30_000) return 'resetting…';
  if (msRemaining < 3_600_000) {
    // < 1h: show m s
    const m = Math.floor(msRemaining / 60_000);
    const s = Math.floor((msRemaining % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  if (msRemaining < 86_400_000) {
    // < 1d: show h m
    const h = Math.floor(msRemaining / 3_600_000);
    const m = Math.floor((msRemaining % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  // >= 1d: show d h
  const d = Math.floor(msRemaining / 86_400_000);
  const h = Math.floor((msRemaining % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
};
