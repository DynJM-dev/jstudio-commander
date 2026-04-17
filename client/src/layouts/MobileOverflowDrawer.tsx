import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Globe, X } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSessions } from '../hooks/useSessions';
import { useAnalytics } from '../hooks/useAnalytics';
import { useModalA11y } from '../hooks/useModalA11y';

const M = 'Montserrat, sans-serif';

interface MobileOverflowDrawerProps {
  open: boolean;
  onClose: () => void;
}

const formatTokens = (count: number): string => {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
};

export const MobileOverflowDrawer = ({ open, onClose }: MobileOverflowDrawerProps) => {
  const navigate = useNavigate();
  const { connected } = useWebSocket();
  const backdropRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Sessions + today's stats arrive via WS-driven hooks (#217). The earlier
  // per-open re-fetch duplicated work already performed by useSessions /
  // useAnalytics elsewhere in the tree.
  const { sessions } = useSessions();
  const { today: stats } = useAnalytics();

  // Phase P.2 C2 — ESC to close + keyboard focus trap. Same hook
  // CreateSessionModal uses so the behavior is uniform.
  useModalA11y({ open, containerRef: drawerRef, onClose });

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const handleNavigate = (path: string) => {
    navigate(path);
    onClose();
  };

  // Top-level only — teammates aren't standalone sessions in the UI's
  // navigation surface (see TopCommandBar). The count here mirrors the
  // top bar so users see the same number both places.
  const activeSessions = sessions.filter(
    (s) => s.status !== 'stopped'
      && !s.parentSessionId
      && (s.sessionType === 'pm' || s.sessionType === 'raw'),
  );
  const totalTokens = stats ? (stats.totalInputTokens ?? 0) + (stats.totalOutputTokens ?? 0) : 0;
  const totalCost = stats?.totalCostUsd ?? 0;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      {/* Backdrop */}
      <div
        ref={backdropRef}
        className="absolute inset-0"
        style={{ background: 'rgba(0, 0, 0, 0.5)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-overflow-title"
        className="absolute bottom-0 left-0 right-0"
        style={{
          fontFamily: M,
          background: 'rgba(15, 20, 25, 0.95)',
          backdropFilter: 'blur(32px) saturate(200%)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'env(safe-area-inset-bottom)',
          animation: 'slideUp 0.25s ease-out',
        }}
      >
        {/* Visually-hidden title provides the aria-labelledby target. */}
        <h2 id="mobile-overflow-title" className="sr-only">More options</h2>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="rounded-full"
            style={{
              width: 36,
              height: 4,
              background: 'rgba(255, 255, 255, 0.15)',
            }}
          />
        </div>

        {/* Close button */}
        <div className="flex justify-end px-4">
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex items-center justify-center rounded-lg transition-colors"
            style={{ minWidth: 44, minHeight: 44, color: 'var(--color-text-tertiary)' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Menu items */}
        <div className="px-4 pb-4 flex flex-col gap-1">
          <button
            onClick={() => handleNavigate('/analytics')}
            className="flex items-center gap-3 rounded-xl px-4 transition-colors"
            style={{
              height: 52,
              color: 'var(--color-text-secondary)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.color = 'var(--color-text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--color-text-secondary)';
            }}
          >
            <BarChart3 size={20} strokeWidth={1.8} />
            <span className="text-sm font-medium">Analytics</span>
          </button>

          {/* Tunnel status */}
          <div
            className="flex items-center gap-3 rounded-xl px-4"
            style={{
              height: 52,
              color: 'var(--color-text-secondary)',
            }}
          >
            <Globe size={20} strokeWidth={1.8} />
            <div className="flex flex-col">
              <span className="text-sm font-medium">Tunnel</span>
              <span
                className="text-xs"
                style={{ color: connected ? 'var(--color-working)' : 'var(--color-stopped)' }}
              >
                {connected ? 'Connected' : 'Offline'}
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div
            className="flex items-center justify-around rounded-xl mt-2 px-4"
            style={{
              height: 48,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.04)',
            }}
          >
            <div className="flex flex-col items-center">
              <span
                className="font-mono-stats text-xs"
                style={{ color: 'var(--color-accent-light)' }}
              >
                {formatTokens(totalTokens)} tokens
              </span>
              <span
                className="text-[10px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Today
              </span>
            </div>
            <div
              style={{
                width: 1,
                height: 24,
                background: 'rgba(255, 255, 255, 0.06)',
              }}
            />
            <div className="flex flex-col items-center">
              <span
                className="font-mono-stats text-xs"
                style={{ color: 'var(--color-working)' }}
              >
                ${totalCost.toFixed(2)}
              </span>
              <span
                className="text-[10px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Cost
              </span>
            </div>
            <div
              style={{
                width: 1,
                height: 24,
                background: 'rgba(255, 255, 255, 0.06)',
              }}
            />
            <div className="flex flex-col items-center">
              <span
                className="font-mono-stats text-xs"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {activeSessions.length}
              </span>
              <span
                className="text-[10px]"
                style={{ color: 'var(--color-text-tertiary)' }}
              >
                Active
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
