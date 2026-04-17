import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Wifi, WifiOff, ChevronDown, MoreHorizontal, Bot } from 'lucide-react';
import type { Session } from '@commander/shared';
import { StatusBadge } from '../components/shared/StatusBadge';
import { TunnelBadge } from '../components/shared/TunnelBadge';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSessions } from '../hooks/useSessions';
import { useAnalytics } from '../hooks/useAnalytics';
import { formatTokens, formatCost } from '../utils/format';
import { buildDisplayNameMap } from '../utils/sessionDisplay';

const M = 'Montserrat, sans-serif';

const MAX_TABS_LG = 5;
const MAX_TABS_MD = 3;

export const TopCommandBar = () => {
  const { connected } = useWebSocket();
  const navigate = useNavigate();
  const location = useLocation();
  // Sessions + today's stats arrive via WS-driven hooks (#217). The earlier
  // 15s setInterval polling here duplicated work already performed by
  // useSessions/useAnalytics elsewhere in the tree.
  const { sessions } = useSessions();
  const { today: stats } = useAnalytics();
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  const mobileRef = useRef<HTMLDivElement>(null);

  // Extract current sessionId from URL if on chat page
  const chatMatch = location.pathname.match(/^\/chat\/([^/]+)/);
  const currentSessionId = chatMatch ? chatMatch[1] : null;

  // Close dropdowns on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
      if (mobileRef.current && !mobileRef.current.contains(e.target as Node)) setMobileOpen(false);
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Top-bar tabs are reserved for top-level sessions only — teammates
  // (rows with parent_session_id) live in the split view + sidebar
  // cluster, never as their own tab. The (sessionType === 'pm' || 'raw')
  // filter is belt-and-suspenders so a misclassified row can't sneak in.
  const topBarSessions = useMemo(
    () => sessions.filter(
      (s) => !s.parentSessionId && (s.sessionType === 'pm' || s.sessionType === 'raw'),
    ),
    [sessions],
  );
  const activeSessions = topBarSessions.filter((s) => s.status !== 'stopped');
  const displayNames = useMemo(() => buildDisplayNameMap(sessions), [sessions]);
  const totalTokens = stats ? (stats.totalInputTokens ?? 0) + (stats.totalOutputTokens ?? 0) : 0;

  // Active-teammate count keyed by parent session id. Used by the bot
  // badge on each tab. WS-driven (useSessions hydrates from the same
  // event stream that updates teammate status) so the count drops as
  // soon as a coder stops. listTeammates' UNION-style parent matching
  // is mirrored here so claudeSessionId-keyed relationships count too.
  const { teammateCountByParent, workingTeammateByParent } = useMemo(() => {
    const count = new Map<string, number>();
    const working = new Map<string, number>();
    for (const s of sessions) {
      if (!s.parentSessionId || s.status === 'stopped') continue;
      const k = s.parentSessionId;
      count.set(k, (count.get(k) ?? 0) + 1);
      if (s.status === 'working') working.set(k, (working.get(k) ?? 0) + 1);
    }
    // A parent's `parentSessionId` field on its teammate rows can be
    // either the Commander UUID OR the Claude UUID. Surface both keys
    // so SessionTab lookups work regardless of which one the team
    // config recorded.
    const outCount = new Map<string, number>();
    const outWorking = new Map<string, number>();
    for (const s of sessions) {
      const direct = count.get(s.id) ?? 0;
      const viaClaude = s.claudeSessionId ? (count.get(s.claudeSessionId) ?? 0) : 0;
      if (direct + viaClaude > 0) outCount.set(s.id, direct + viaClaude);
      const wd = working.get(s.id) ?? 0;
      const wc = s.claudeSessionId ? (working.get(s.claudeSessionId) ?? 0) : 0;
      if (wd + wc > 0) outWorking.set(s.id, wd + wc);
    }
    return { teammateCountByParent: outCount, workingTeammateByParent: outWorking };
  }, [sessions]);

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
    const isWaiting = s.status === 'waiting';
    const teammateCount = teammateCountByParent.get(s.id) ?? 0;
    const workingTeammates = workingTeammateByParent.get(s.id) ?? 0;
    // PM pane idle but a teammate is working — light-blue tab accent.
    // Skipped when the PM itself is working (green/working class wins)
    // or when a waiting alarm is active (yellow wins, user must act).
    const isTeammateActive = !isWaiting && s.status === 'idle' && workingTeammates > 0;
    const cls = [
      'session-tab shrink-0',
      isActive ? 'session-tab--active' : '',
      s.status === 'working' ? 'session-tab--working' : '',
      s.status === 'stopped' ? 'session-tab--stopped' : '',
      isTeammateActive ? 'session-tab--teammate-active' : '',
      isWaiting ? 'waiting-tab-alarm' : '',
    ].filter(Boolean).join(' ');
    return (
      <button onClick={() => goToSession(s.id)} className={cls} aria-current={isActive ? 'page' : undefined}>
        <StatusBadge status={s.status} size="sm" />
        <span className="truncate max-w-[130px]">{displayNames.get(s.id) ?? s.name}</span>
        {teammateCount > 0 && (
          <span
            className="flex items-center gap-0.5 shrink-0"
            style={{
              color: isActive ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)',
            }}
            title={`${teammateCount} active teammate${teammateCount === 1 ? '' : 's'}`}
          >
            <Bot size={13} />
            <span className="text-xs font-semibold">{teammateCount}</span>
          </span>
        )}
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
          <div className="flex flex-col gap-1 p-1">
            {tabs.map((s) => {
              const isActive = s.id === currentSessionId;
              const isWaiting = s.status === 'waiting';
              const workingTeammates = workingTeammateByParent.get(s.id) ?? 0;
              const isTeammateActive = !isWaiting && s.status === 'idle' && workingTeammates > 0;
              const cls = [
                'session-tab session-tab--stack',
                isActive ? 'session-tab--active' : '',
                s.status === 'working' ? 'session-tab--working' : '',
                s.status === 'stopped' ? 'session-tab--stopped' : '',
                isTeammateActive ? 'session-tab--teammate-active' : '',
                isWaiting ? 'waiting-tab-alarm' : '',
              ].filter(Boolean).join(' ');
              const teammateCount = teammateCountByParent.get(s.id) ?? 0;
              return (
                <button key={s.id} className={cls} onClick={() => goToSession(s.id)} aria-current={isActive ? 'page' : undefined}>
                  <StatusBadge status={s.status} size="sm" />
                  <div className="flex flex-col min-w-0 text-left">
                    <span className="truncate font-medium">{displayNames.get(s.id) ?? s.name}</span>
                    <span className="font-mono-stats" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      {s.model?.replace('claude-', '')}
                    </span>
                  </div>
                  {teammateCount > 0 && (
                    <span
                      className="flex items-center gap-0.5 shrink-0 ml-auto"
                      style={{ color: 'var(--color-text-tertiary)' }}
                      title={`${teammateCount} active teammate${teammateCount === 1 ? '' : 's'}`}
                    >
                      <Bot size={13} />
                      <span className="text-xs font-semibold">{teammateCount}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
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
        <div className="flex items-center gap-3 shrink-0 pl-4">
          <TunnelBadge />
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
                    ? (displayNames.get(currentSessionId) ?? activeSessions.find((s) => s.id === currentSessionId)?.name ?? 'Session')
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
              <div className="flex flex-col gap-1 p-1">
                {activeSessions.map((s) => {
                  const isActive = s.id === currentSessionId;
                  const isWaiting = s.status === 'waiting';
                  const workingTeammates = workingTeammateByParent.get(s.id) ?? 0;
                  const isTeammateActive = !isWaiting && s.status === 'idle' && workingTeammates > 0;
                  const cls = [
                    'session-tab session-tab--stack',
                    isActive ? 'session-tab--active' : '',
                    s.status === 'working' ? 'session-tab--working' : '',
                    s.status === 'stopped' ? 'session-tab--stopped' : '',
                    isTeammateActive ? 'session-tab--teammate-active' : '',
                    isWaiting ? 'waiting-tab-alarm' : '',
                  ].filter(Boolean).join(' ');
                  const teammateCount = teammateCountByParent.get(s.id) ?? 0;
                  return (
                    <button key={s.id} className={cls} onClick={() => goToSession(s.id)} aria-current={isActive ? 'page' : undefined}>
                      <StatusBadge status={s.status} size="sm" />
                      <div className="flex flex-col min-w-0 flex-1 text-left">
                        <span className="text-sm font-medium truncate">{displayNames.get(s.id) ?? s.name}</span>
                        <span className="font-mono-stats" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {s.model?.replace('claude-', '')}
                        </span>
                      </div>
                      {teammateCount > 0 && (
                        <span
                          className="flex items-center gap-0.5 shrink-0"
                          style={{ color: 'var(--color-text-tertiary)' }}
                          title={`${teammateCount} active teammate${teammateCount === 1 ? '' : 's'}`}
                        >
                          <Bot size={13} />
                          <span className="text-xs font-semibold">{teammateCount}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
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
