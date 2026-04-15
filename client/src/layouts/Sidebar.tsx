import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Monitor,
  MessageSquare,
  FolderKanban,
  TerminalSquare,
  BarChart3,
  ChevronsRight,
  ChevronsLeft,
  Globe,
  Copy,
  Check,
} from 'lucide-react';
import { Logo } from '../components/shared/Logo';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePreference } from '../hooks/usePreference';
import { api } from '../services/api';
import type { WSEvent } from '@commander/shared';

const M = 'Montserrat, sans-serif';

const NAV_ITEMS = [
  { path: '/sessions', icon: Monitor, label: 'Sessions' },
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/projects', icon: FolderKanban, label: 'Projects' },
  { path: '/terminal', icon: TerminalSquare, label: 'Terminal' },
  { path: '/analytics', icon: BarChart3, label: 'Analytics' },
];

// One-time migration: lift the existing localStorage value onto the new
// server-backed preference the first time the hook renders. Dropped once
// a prefs write lands, so a stale false value can't stomp a fresh one.
const LEGACY_SIDEBAR_KEY = 'jsc-sidebar-collapsed';
const legacySidebarCollapsed = ((): boolean | undefined => {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(LEGACY_SIDEBAR_KEY);
  if (raw === null) return undefined;
  window.localStorage.removeItem(LEGACY_SIDEBAR_KEY);
  return raw !== 'false';
})();

export const Sidebar = () => {
  const [collapsed, setCollapsed] = usePreference<boolean>(
    'ui.sidebar.collapsed',
    legacySidebarCollapsed ?? true, // default collapsed
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, lastEvent } = useWebSocket();
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch initial tunnel status
  useEffect(() => {
    api.get<{ active: boolean; url?: string }>('/tunnel/status')
      .then((res) => {
        setTunnelActive(res.active);
        setTunnelUrl(res.url ?? null);
      })
      .catch(() => {});
  }, []);

  // Listen for tunnel WS events
  useEffect(() => {
    if (!lastEvent) return;
    const event = lastEvent as WSEvent;
    if (event.type === 'tunnel:started') {
      setTunnelActive(true);
      setTunnelUrl(event.url);
      setTunnelLoading(false);
    }
    if (event.type === 'tunnel:stopped') {
      setTunnelActive(false);
      setTunnelUrl(null);
      setTunnelLoading(false);
    }
  }, [lastEvent]);

  const toggleTunnel = useCallback(async () => {
    setTunnelLoading(true);
    try {
      if (tunnelActive) {
        await api.post('/tunnel/stop');
      } else {
        await api.post<{ url: string }>('/tunnel/start');
      }
    } catch {
      setTunnelLoading(false);
    }
  }, [tunnelActive]);

  const copyUrl = useCallback(() => {
    if (tunnelUrl) {
      navigator.clipboard.writeText(tunnelUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [tunnelUrl]);

  return (
    <aside
      className="hidden lg:flex flex-col glass-nav h-screen sticky top-0 z-50 transition-all duration-200 ease-out"
      style={{
        width: collapsed ? 64 : 240,
        fontFamily: M,
      }}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-14 px-3">
        <Logo collapsed={collapsed} />
      </div>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 px-2 mt-2">
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path || location.pathname.startsWith(path + '/');
          const cls = [
            'nav-btn',
            active ? 'nav-btn--active' : '',
            collapsed ? 'nav-btn--collapsed' : '',
          ].filter(Boolean).join(' ');
          return (
            <button key={path} onClick={() => navigate(path)} className={cls} aria-current={active ? 'page' : undefined}>
              <Icon size={20} strokeWidth={1.8} />
              {!collapsed && (
                <span className="text-sm font-medium whitespace-nowrap">{label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="px-2 pb-3 flex flex-col gap-1">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`nav-btn nav-btn--muted ${collapsed ? 'nav-btn--collapsed' : ''}`}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          {!collapsed && <span className="text-sm font-medium">Collapse</span>}
        </button>

        {/* Tunnel control */}
        <button
          onClick={toggleTunnel}
          disabled={tunnelLoading}
          className={`nav-btn nav-btn--muted ${collapsed ? 'nav-btn--collapsed' : ''}`}
          style={{
            height: collapsed ? 36 : 'auto',
            minHeight: 36,
            padding: collapsed ? '0 12px' : '8px 12px',
          }}
        >
          <Globe size={16} className={tunnelLoading ? 'animate-spin' : ''} />
          {!collapsed && (
            <div className="flex flex-col items-start min-w-0">
              <span className="text-xs">
                Tunnel:{' '}
                <span style={{ color: tunnelActive ? 'var(--color-working)' : 'var(--color-stopped)' }}>
                  {tunnelLoading ? 'Starting...' : tunnelActive ? 'Active' : 'Off'}
                </span>
              </span>
              {tunnelActive && tunnelUrl && (
                <span
                  className="text-[10px] truncate max-w-[160px]"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {tunnelUrl.replace('https://', '')}
                </span>
              )}
            </div>
          )}
          {collapsed && (
            <span
              className="absolute w-2 h-2 rounded-full"
              style={{
                backgroundColor: tunnelActive ? 'var(--color-working)' : 'var(--color-stopped)',
                bottom: 10,
                right: 18,
              }}
            />
          )}
        </button>

        {/* Copy URL button (when expanded and tunnel active) */}
        {!collapsed && tunnelActive && tunnelUrl && (
          <button
            onClick={(e) => { e.stopPropagation(); copyUrl(); }}
            className="nav-btn nav-btn--muted"
            style={{
              height: 30,
              padding: '0 12px',
              color: copied ? 'var(--color-working)' : 'var(--color-text-tertiary)',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span className="text-xs">{copied ? 'Copied!' : 'Copy URL'}</span>
          </button>
        )}
      </div>
    </aside>
  );
};
