import { useState, useEffect, useRef, useCallback } from 'react';
import type { DailyStats, WSEvent } from '@commander/shared';
import { api } from '../services/api';
import { useWebSocket } from './useWebSocket';

interface SessionCost {
  sessionId: string;
  sessionName: string;
  totalCost: number;
  totalTokens: number;
  messageCount: number;
}

interface ProjectCost {
  projectId: string;
  projectName: string;
  totalCost: number;
  totalTokens: number;
  messageCount: number;
}

interface UseAnalyticsReturn {
  today: DailyStats | null;
  daily: DailyStats[];
  sessionCosts: SessionCost[];
  projectCosts: ProjectCost[];
  loading: boolean;
  error: string | null;
}

// Coalesce window for analytics:token events. A working session emits
// one usage entry per assistant message, which can fire several per
// second — a per-event refetch would defeat the whole point of the
// hook. 2s gives the dashboard near-live freshness without amplifying.
const ANALYTICS_REFETCH_DEBOUNCE_MS = 2_000;

export const useAnalytics = (): UseAnalyticsReturn => {
  const [today, setToday] = useState<DailyStats | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [sessionCosts, setSessionCosts] = useState<SessionCost[]>([]);
  const [projectCosts, setProjectCosts] = useState<ProjectCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe, unsubscribe, lastEvent } = useWebSocket();
  const mountedRef = useRef(true);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [todayRes, dailyRes, sessionsRes, projectsRes] = await Promise.all([
        api.get<DailyStats>('/analytics/today'),
        api.get<DailyStats[]>('/analytics/daily?days=30'),
        api.get<SessionCost[]>('/analytics/sessions'),
        api.get<ProjectCost[]>('/analytics/projects'),
      ]);

      if (mountedRef.current) {
        setToday(todayRes);
        setDaily(dailyRes);
        setSessionCosts(sessionsRes);
        setProjectCosts(projectsRes);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch analytics');
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => {
      mountedRef.current = false;
      if (refetchTimer.current) {
        clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, [fetchAll]);

  // Subscribe to analytics channel
  useEffect(() => {
    subscribe(['analytics']);
    return () => unsubscribe(['analytics']);
  }, [subscribe, unsubscribe]);

  // #223 — react to analytics:token / analytics:daily events. Debounced
  // so a stream of per-message usage entries coalesces into a single
  // refetch instead of N parallel ones.
  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type !== 'analytics:token' && event.type !== 'analytics:daily') return;
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      if (mountedRef.current) void fetchAll();
    }, ANALYTICS_REFETCH_DEBOUNCE_MS);
  }, [lastEvent, fetchAll]);

  return { today, daily, sessionCosts, projectCosts, loading, error };
};
