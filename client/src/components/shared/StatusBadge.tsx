import { STATUS_COLORS, STATUS_LABELS } from '@commander/shared';
import type { SessionStatus } from '@commander/shared';

const M = 'Montserrat, sans-serif';

interface StatusBadgeProps {
  status: SessionStatus;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const pulseClass: Record<SessionStatus, string> = {
  working: 'animate-pulse',
  idle: '',
  waiting: 'animate-pulse-slow',
  error: '',
  stopped: '',
};

export const StatusBadge = ({ status, showLabel = false, size = 'md' }: StatusBadgeProps) => {
  const color = STATUS_COLORS[status];
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
