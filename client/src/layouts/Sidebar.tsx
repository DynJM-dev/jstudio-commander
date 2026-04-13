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

const STORAGE_KEY = 'jsc-sidebar-collapsed';

export const Sidebar = () => {
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== 'false'; // Default collapsed
  });
  const location = useLocation();
  const navigate = useNavigate();
  const { connected, lastEvent } = useWebSocket();
  const [tunnelActive, setTunnelActive] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

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
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="flex items-center gap-3 rounded-lg transition-colors relative"
              style={{
                height: 44,
                padding: collapsed ? '0 12px' : '0 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                background: active ? 'rgba(14, 124, 123, 0.08)' : 'transparent',
                color: active ? 'var(--color-accent-light)' : 'var(--color-text-secondary)',
                borderLeft: active ? '3px solid var(--color-accent)' : '3px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
                if (!active) e.currentTarget.style.color = 'var(--color-text-primary)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent';
                if (!active) e.currentTarget.style.color = 'var(--color-text-secondary)';
              }}
            >
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
          className="flex items-center gap-3 rounded-lg transition-colors"
          style={{
            height: 44,
            padding: '0 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: 'var(--color-text-tertiary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--color-text-primary)';
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-tertiary)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          {!collapsed && <span className="text-sm font-medium">Collapse</span>}
        </button>

        {/* Tunnel control */}
        <button
          onClick={toggleTunnel}
          disabled={tunnelLoading}
          className="flex items-center gap-3 rounded-lg transition-colors"
          style={{
            height: collapsed ? 36 : 'auto',
            minHeight: 36,
            padding: collapsed ? '0 12px' : '8px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: 'var(--color-text-tertiary)',
            position: 'relative',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
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
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-colors"
            style={{
              color: copied ? 'var(--color-working)' : 'var(--color-text-tertiary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        )}
      </div>
    </aside>
  );
};
