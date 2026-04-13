import { useState, useEffect, useRef } from 'react';
import type { DailyStats } from '@commander/shared';
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

export const useAnalytics = (): UseAnalyticsReturn => {
  const [today, setToday] = useState<DailyStats | null>(null);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [sessionCosts, setSessionCosts] = useState<SessionCost[]>([]);
  const [projectCosts, setProjectCosts] = useState<ProjectCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe, unsubscribe } = useWebSocket();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchAll = async () => {
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
    };

    fetchAll();
    return () => { mountedRef.current = false; };
  }, []);

  // Subscribe to analytics channel
  useEffect(() => {
    subscribe(['analytics']);
    return () => unsubscribe(['analytics']);
  }, [subscribe, unsubscribe]);

  return { today, daily, sessionCosts, projectCosts, loading, error };
};
