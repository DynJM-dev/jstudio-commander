import { useHeartbeat, formatSecondsAgo } from '../../hooks/useHeartbeat';

const M = 'Montserrat, sans-serif';

interface HeartbeatDotProps {
  sessionId: string;
  // Seed timestamp from the already-fetched session row so the dot
  // doesn't flash "—" for a frame on mount while the first WS event
  // arrives.
  initialTs?: number | null;
}

// Phase N.0 Patch 3 — tight proof-of-life chip rendered next to the
// status badge on SessionCard + anywhere else that wants a "last seen"
// signal. Three states:
//   - Fresh  : green pulsing dot + "Xs ago" (secondsAgo within window)
//   - Null   : gray dot + "—" (no heartbeat observed this mount)
//   - Stale  : gray dot + "stale" (>30s since last heartbeat)
export const HeartbeatDot = ({ sessionId, initialTs }: HeartbeatDotProps) => {
  const { lastActivityAt, secondsAgo, isStale } = useHeartbeat(sessionId, initialTs);

  const label = formatSecondsAgo(lastActivityAt, secondsAgo, isStale);
  const isFresh = lastActivityAt !== null && !isStale;
  const dotColor = isFresh
    ? 'var(--color-accent)'
    : 'var(--color-text-tertiary)';

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px]"
      style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
      title={
        lastActivityAt === null
          ? 'No heartbeat received yet'
          : isStale
            ? `Last signal ${secondsAgo}s ago — forcing idle display`
            : `Last signal ${secondsAgo}s ago`
      }
    >
      <span
        className={`rounded-full ${isFresh ? 'heartbeat-pulse' : ''}`}
        style={{
          width: 6,
          height: 6,
          background: dotColor,
          boxShadow: isFresh ? `0 0 4px ${dotColor}` : 'none',
        }}
      />
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
    </span>
  );
};
