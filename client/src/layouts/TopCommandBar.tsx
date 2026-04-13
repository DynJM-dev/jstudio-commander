import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wifi, WifiOff } from 'lucide-react';
import type { Session, DailyStats } from '@commander/shared';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../services/api';

const M = 'Montserrat, sans-serif';

const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
};

export const TopCommandBar = () => {
  const { connected } = useWebSocket();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<DailyStats | null>(null);

  useEffect(() => {
    api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
    api.get<DailyStats>('/analytics/today').then(setStats).catch(() => {});

    // Refresh every 30s
    const interval = setInterval(() => {
      api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
      api.get<DailyStats>('/analytics/today').then(setStats).catch(() => {});
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const mostRecent = activeSessions.length > 0
    ? activeSessions.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
    : null;

  const totalTokens = stats ? stats.totalInputTokens + stats.totalOutputTokens : 0;
  const totalCost = stats?.totalCostUsd ?? 0;

  return (
    <header
      className="sticky top-0 z-40 glass-surface flex items-center justify-between px-4 lg:px-6"
      style={{
        height: 48,
        fontFamily: M,
        borderRadius: 0,
        borderLeft: 'none',
        borderRight: 'none',
        borderTop: 'none',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Left zone */}
      <div className="flex items-center gap-3">
        {mostRecent ? (
          <button
            onClick={() => navigate(`/chat/${mostRecent.id}`)}
            className="flex items-center gap-2 transition-colors"
          >
            <span
              className="inline-block rounded-full"
              style={{
                width: 8,
                height: 8,
                backgroundColor: 'var(--color-working)',
                boxShadow: '0 0 6px var(--color-working)',
              }}
            />
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {mostRecent.name}
            </span>
            <span
              className="text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {activeSessions.length} active
            </span>
          </button>
        ) : (
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            No active session
          </span>
        )}
      </div>

      {/* Right zone */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-4">
          <span
            className="font-mono-stats text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {formatTokens(totalTokens)} tokens
          </span>
          <span
            className="font-mono-stats text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            ${totalCost.toFixed(2)}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {connected ? (
            <Wifi size={14} style={{ color: 'var(--color-working)' }} />
          ) : (
            <WifiOff size={14} style={{ color: 'var(--color-error)' }} />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: connected ? 'var(--color-working)' : 'var(--color-error)' }}
          >
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>
    </header>
  );
};
