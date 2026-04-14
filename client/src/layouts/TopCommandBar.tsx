import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Wifi, WifiOff, ChevronDown, MoreHorizontal } from 'lucide-react';
import type { Session, DailyStats } from '@commander/shared';
import { StatusBadge } from '../components/shared/StatusBadge';
import { useWebSocket } from '../hooks/useWebSocket';
import { api } from '../services/api';
import { formatTokens, formatCost } from '../utils/format';

const M = 'Montserrat, sans-serif';

const MAX_TABS_LG = 5;
const MAX_TABS_MD = 3;

export const TopCommandBar = () => {
  const { connected } = useWebSocket();
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  // Extract current sessionId from URL if on chat page
  const chatMatch = location.pathname.match(/^\/chat\/([^/]+)/);
  const currentSessionId = chatMatch ? chatMatch[1] : null;

  useEffect(() => {
    api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
    api.get<DailyStats>('/analytics/today').then(setStats).catch(() => {});

    const interval = setInterval(() => {
      api.get<Session[]>('/sessions').then(setSessions).catch(() => {});
      api.get<DailyStats>('/analytics/today').then(setStats).catch(() => {});
    }, 15_000);

    return () => clearInterval(interval);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const activeSessions = sessions.filter((s) => s.status !== 'stopped');
  const totalTokens = stats ? (stats.totalInputTokens ?? 0) + (stats.totalOutputTokens ?? 0) : 0;

  const goToSession = (id: string) => {
    navigate(`/chat/${id}`);
    setOverflowOpen(false);
    setMobileOpen(false);
  };

  // Ensure current session is visible in tabs
  const buildTabs = (max: number) => {
    const visible = [...activeSessions.slice(0, max)];
    const overflow = [...activeSessions.slice(max)];

    if (currentSessionId && !visible.find((s) => s.id === currentSessionId)) {
      const fromOverflow = overflow.find((s) => s.id === currentSessionId);
      if (fromOverflow) {
        overflow.splice(overflow.indexOf(fromOverflow), 1);
        if (visible.length >= max && visible.length > 0) {
          overflow.unshift(visible.pop()!);
        }
        visible.push(fromOverflow);
      }
    }
    return { visible, overflow };
  };

  const lgTabs = buildTabs(MAX_TABS_LG);
  const mdTabs = buildTabs(MAX_TABS_MD);

  const SessionTab = ({ s }: { s: Session }) => {
    const isActive = s.id === currentSessionId;
    return (
      <button
        onClick={() => goToSession(s.id)}
        className="flex items-center gap-2 px-3 h-full shrink-0 relative transition-all"
        style={{
          fontFamily: M,
          color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
          background: isActive ? 'rgba(14, 124, 123, 0.08)' : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
            e.currentTarget.style.borderBottomColor = 'rgba(14, 124, 123, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isActive) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
            e.currentTarget.style.borderBottomColor = 'transparent';
          }
        }}
      >
        <StatusBadge status={s.status} size="sm" />
        <span className="text-sm font-medium truncate max-w-[130px]">{s.name}</span>
        {isActive && (
          <span
            className="font-mono-stats hidden xl:inline-block"
            style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}
          >
            {s.model?.replace('claude-', '')}
          </span>
        )}
      </button>
    );
  };

  const OverflowMenu = ({ tabs }: { tabs: Session[] }) => (
    <div className="relative h-full flex items-center" ref={overflowRef}>
      <button
        onClick={() => setOverflowOpen(!overflowOpen)}
        className="flex items-center gap-1 px-2 h-8 rounded text-xs transition-all"
        style={{
          fontFamily: M,
          background: overflowOpen ? 'rgba(255, 255, 255, 0.06)' : 'transparent',
          color: 'var(--color-text-tertiary)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
        onMouseLeave={(e) => { if (!overflowOpen) e.currentTarget.style.background = 'transparent'; }}
      >
        <MoreHorizontal size={14} />
        <span>+{tabs.length}</span>
      </button>

      {overflowOpen && (
        <div
          className="absolute top-full right-0 mt-1.5 z-50 w-60 rounded-lg overflow-hidden"
          style={{
            background: 'rgba(12, 16, 22, 0.96)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}>
              More sessions
            </span>
          </div>
          {tabs.map((s) => {
            const isActive = s.id === currentSessionId;
            return (
              <button
                key={s.id}
                className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors"
                style={{
                  fontFamily: M,
                  fontSize: 13,
                  color: isActive ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
                  background: isActive ? 'rgba(14, 124, 123, 0.1)' : 'transparent',
                }}
                onClick={() => goToSession(s.id)}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isActive ? 'rgba(14, 124, 123, 0.1)' : 'transparent';
                }}
              >
                <StatusBadge status={s.status} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="font-mono-stats" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {s.model?.replace('claude-', '')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <header
      className="sticky top-0 z-40 glass-surface shrink-0"
      style={{
        height: 48,
        fontFamily: M,
        borderRadius: 0,
        border: 'none',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* === DESKTOP (>=1024px) === */}
      <div className="hidden lg:flex items-center h-full px-2">
        {/* Session tabs */}
        <div className="flex items-center h-full flex-1 min-w-0 gap-0.5">
          {activeSessions.length === 0 ? (
            <span className="text-sm px-3" style={{ color: 'var(--color-text-tertiary)' }}>
              No active sessions
            </span>
          ) : (
            <>
              {lgTabs.visible.map((s) => <SessionTab key={s.id} s={s} />)}
              {lgTabs.overflow.length > 0 && <OverflowMenu tabs={lgTabs.overflow} />}
            </>
          )}
        </div>

        {/* Right: stats + connection */}
        <div className="flex items-center gap-5 shrink-0 pl-4">
          <div className="flex items-center gap-3 font-mono-stats text-xs">
            <span style={{ color: 'var(--color-accent-light)' }}>{formatTokens(totalTokens)}</span>
            <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
            <span style={{ color: 'var(--color-working)' }}>{formatCost(stats?.totalCostUsd)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {connected
              ? <Wifi size={13} style={{ color: 'var(--color-working)' }} />
              : <WifiOff size={13} style={{ color: 'var(--color-error)' }} />
            }
            <span className="text-xs" style={{ color: connected ? 'var(--color-working)' : 'var(--color-error)' }}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* === TABLET (768-1023px) === */}
      <div className="hidden md:flex lg:hidden items-center h-full px-2">
        <div className="flex items-center h-full flex-1 min-w-0 gap-0.5">
          {activeSessions.length === 0 ? (
            <span className="text-sm px-3" style={{ color: 'var(--color-text-tertiary)' }}>
              No active sessions
            </span>
          ) : (
            <>
              {mdTabs.visible.map((s) => <SessionTab key={s.id} s={s} />)}
              {mdTabs.overflow.length > 0 && <OverflowMenu tabs={mdTabs.overflow} />}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 pl-3">
          <span className="font-mono-stats text-xs" style={{ color: 'var(--color-accent-light)' }}>
            {formatTokens(totalTokens)}
          </span>
          <div className="flex items-center gap-1">
            {connected
              ? <Wifi size={12} style={{ color: 'var(--color-working)' }} />
              : <WifiOff size={12} style={{ color: 'var(--color-error)' }} />
            }
          </div>
        </div>
      </div>

      {/* === MOBILE (<768px) === */}
      <div className="flex md:hidden items-center h-full px-3 gap-2">
        {/* Session dropdown */}
        <div className="relative flex-1 min-w-0" ref={mobileRef}>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="flex items-center gap-2 w-full h-9 px-3 rounded-lg transition-colors"
            style={{
              fontFamily: M,
              background: mobileOpen ? 'rgba(14, 124, 123, 0.08)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${mobileOpen ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.06)'}`,
              color: 'var(--color-text-primary)',
            }}
          >
            {activeSessions.length > 0 ? (
              <>
                <StatusBadge
                  status={currentSessionId
                    ? (activeSessions.find((s) => s.id === currentSessionId)?.status ?? 'idle')
                    : activeSessions[0]!.status
                  }
                  size="sm"
                />
                <span className="text-sm font-medium truncate flex-1 text-left">
                  {currentSessionId
                    ? activeSessions.find((s) => s.id === currentSessionId)?.name ?? 'Session'
                    : `${activeSessions.length} session${activeSessions.length !== 1 ? 's' : ''}`
                  }
                </span>
              </>
            ) : (
              <span className="text-sm flex-1 text-left" style={{ color: 'var(--color-text-tertiary)' }}>
                No sessions
              </span>
            )}
            <ChevronDown
              size={14}
              style={{
                color: 'var(--color-text-tertiary)',
                transform: mobileOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </button>

          {mobileOpen && activeSessions.length > 0 && (
            <div
              className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg overflow-hidden max-h-72 overflow-y-auto"
              style={{
                background: 'rgba(12, 16, 22, 0.96)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              }}
            >
              {activeSessions.map((s) => {
                const isActive = s.id === currentSessionId;
                return (
                  <button
                    key={s.id}
                    className="w-full text-left px-4 py-3 flex items-center gap-3 transition-colors"
                    style={{
                      fontFamily: M,
                      color: isActive ? 'var(--color-accent-light)' : 'var(--color-text-primary)',
                      background: isActive ? 'rgba(14, 124, 123, 0.1)' : 'transparent',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                    }}
                    onClick={() => goToSession(s.id)}
                  >
                    <StatusBadge status={s.status} size="sm" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{s.name}</span>
                      <span className="font-mono-stats" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {s.model?.replace('claude-', '')}
                      </span>
                    </div>
                    {isActive && (
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-accent)' }} />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Compact stats + connection */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="font-mono-stats" style={{ fontSize: 11, color: 'var(--color-accent-light)' }}>
            {formatCost(stats?.totalCostUsd)}
          </span>
          {connected
            ? <Wifi size={12} style={{ color: 'var(--color-working)' }} />
            : <WifiOff size={12} style={{ color: 'var(--color-error)' }} />
          }
        </div>
      </div>
    </header>
  );
};
