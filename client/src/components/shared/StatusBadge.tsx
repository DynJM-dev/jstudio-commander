import { STATUS_COLORS, STATUS_LABELS } from '@commander/shared';
import type { SessionStatus } from '@commander/shared';

const M = 'Montserrat, sans-serif';

// Teammate variant — working stays vivid green (it's THE "this pane is doing
// work" signal the user needs to spot across a strip of icons), but idle
// drops to a neutral muted grey so green really pops. Waiting stays amber
// because teammates that need your attention should still glow; stopped is
// the same greyed-out treatment as the session palette.
const TEAMMATE_STATUS_COLORS: Record<SessionStatus, string> = {
  working: '#22C55E',
  idle: '#6B7280',
  waiting: '#F59E0B',
  error: '#EF4444',
  stopped: '#6B7280',
};

interface StatusBadgeProps {
  status: SessionStatus;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  // 'session' (default) — standard SESSION_STATUS palette (idle = amber).
  // 'teammate' — tuned for teammate surfaces: idle goes muted so the green
  // working state is unambiguous across a row of teammate icons.
  variant?: 'session' | 'teammate';
}

const pulseClass: Record<SessionStatus, string> = {
  working: 'animate-pulse',
  idle: '',
  waiting: 'animate-pulse-slow',
  error: '',
  stopped: '',
};

export const StatusBadge = ({ status, showLabel = false, size = 'md', variant = 'session' }: StatusBadgeProps) => {
  const palette = variant === 'teammate' ? TEAMMATE_STATUS_COLORS : STATUS_COLORS;
  const color = palette[status];
  const label = STATUS_LABELS[status];
  const dotSize = size === 'sm' ? 8 : 10;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-block rounded-full ${pulseClass[status]}`}
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: color,
          boxShadow: status === 'working' || status === 'waiting'
            ? `0 0 8px ${color}`
            : undefined,
        }}
      />
      {showLabel && (
        <span
          className="text-xs font-medium"
          style={{ color, fontFamily: M }}
        >
          {label}
        </span>
      )}
    </div>
  );
};
