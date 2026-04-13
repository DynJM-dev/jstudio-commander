import { Wifi, WifiOff } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';

const M = 'Montserrat, sans-serif';

export const TopCommandBar = () => {
  const { connected } = useWebSocket();

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
        <span
          className="text-sm font-medium"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          No active session
        </span>
      </div>

      {/* Right zone */}
      <div className="flex items-center gap-4">
        <div className="hidden sm:flex items-center gap-4">
          <span
            className="font-mono-stats text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            0 tokens
          </span>
          <span
            className="font-mono-stats text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            $0.00
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
