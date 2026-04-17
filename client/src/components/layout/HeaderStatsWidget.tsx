import { useEffect, useState } from 'react';
import { Cpu, MemoryStick, Clock, CalendarDays } from 'lucide-react';
import { useSystemStats } from '../../hooks/useSystemStats';
import { useAggregateRateLimits, formatResetsCountdown } from '../../hooks/useAggregateRateLimits';
import { bandColor } from '../../utils/contextBands';
import { bandForBudget, bandForMemory, formatBytes } from '../../utils/systemStatsBands';

const M = 'Montserrat, sans-serif';

// Phase O — top-right header widget.
//
// Four compact chips: CPU, Memory, 5h budget, 7d budget. Each chip
// shows a single percentage + (for rate-limits) a live countdown to
// reset. Coloring via band math (see contextBands + systemStatsBands).
// Never grows past ~260px so the session tabs on the left retain all
// available space.

const formatPct = (pct: number | null | undefined, isStale: boolean): string => {
  if (isStale || pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
};

const Chip: React.FC<{
  icon: React.ReactNode;
  label: string;
  primary: string;
  secondary?: string;
  color: string;
  tooltip?: string;
}> = ({ icon, label, primary, secondary, color, tooltip }) => (
  <div
    className="flex items-center gap-1.5 px-2 py-1 rounded-md"
    style={{
      fontFamily: M,
      background: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      color: 'var(--color-text-secondary)',
      fontSize: 11,
      lineHeight: 1.2,
    }}
    title={tooltip}
  >
    <span style={{ color: 'var(--color-text-tertiary)', display: 'inline-flex' }}>{icon}</span>
    <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{label}</span>
    <span className="font-mono-stats" style={{ color, fontWeight: 600 }}>
      {primary}
    </span>
    {secondary && (
      <span className="font-mono-stats hidden xl:inline" style={{ color: 'var(--color-text-tertiary)' }}>
        · {secondary}
      </span>
    )}
  </div>
);

export const HeaderStatsWidget: React.FC = () => {
  const { stats, isStale: statsStale } = useSystemStats();
  const rateLimits = useAggregateRateLimits();

  // 1s ticker so the countdown text ticks down smoothly. We keep the
  // render cheap — only the two countdown strings depend on `now`.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cpuPct = stats?.cpuLoadPct ?? null;
  const memPct = stats?.memUsedPct ?? null;
  const memUsed = stats?.memUsedBytes ?? null;
  const memTotal = stats?.memTotalBytes ?? null;

  const fiveHourPct = rateLimits?.fiveHour.pct ?? null;
  const sevenDayPct = rateLimits?.sevenDay.pct ?? null;
  const fiveHourReset = rateLimits?.fiveHour.resetsAt ?? null;
  const sevenDayReset = rateLimits?.sevenDay.resetsAt ?? null;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Chip
        icon={<Cpu size={12} />}
        label="CPU"
        primary={formatPct(cpuPct, statsStale)}
        color={bandColor(statsStale ? 'unknown' : bandForBudget(cpuPct))}
        tooltip={
          stats
            ? `Load avg 1m normalized to ${stats.coreCount} core${stats.coreCount === 1 ? '' : 's'}`
            : 'Awaiting first sample'
        }
      />
      <Chip
        icon={<MemoryStick size={12} />}
        label="Mem"
        primary={formatPct(memPct, statsStale)}
        secondary={memUsed !== null && memTotal !== null ? `${formatBytes(memUsed)} / ${formatBytes(memTotal)}` : undefined}
        color={bandColor(statsStale ? 'unknown' : bandForMemory(memPct))}
        tooltip={
          stats
            ? `${formatBytes(memUsed)} used of ${formatBytes(memTotal)}`
            : 'Awaiting first sample'
        }
      />
      <Chip
        icon={<Clock size={12} />}
        label="5h"
        primary={formatPct(fiveHourPct, false)}
        secondary={formatResetsCountdown(fiveHourReset, now)}
        color={bandColor(bandForBudget(fiveHourPct))}
        tooltip={
          fiveHourPct !== null
            ? `Account-wide 5-hour usage · resets ${formatResetsCountdown(fiveHourReset, now)}`
            : 'No fresh rate-limit sample (idle account?)'
        }
      />
      <Chip
        icon={<CalendarDays size={12} />}
        label="7d"
        primary={formatPct(sevenDayPct, false)}
        secondary={formatResetsCountdown(sevenDayReset, now)}
        color={bandColor(bandForBudget(sevenDayPct))}
        tooltip={
          sevenDayPct !== null
            ? `Account-wide 7-day usage · resets ${formatResetsCountdown(sevenDayReset, now)}`
            : 'No fresh rate-limit sample (idle account?)'
        }
      />
    </div>
  );
};
