import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { GlassCard } from '../shared/GlassCard';

const M = 'Montserrat, sans-serif';

interface TokenCardProps {
  title: string;
  value: string;
  // Numeric raw value drives the count-up animation; falls back to the
  // static string when numericValue is not provided so callers with
  // non-numeric summaries (e.g. "—") still render correctly.
  numericValue?: number;
  format?: (n: number) => string;
  subtitle?: string;
  icon: LucideIcon;
  valueColor?: string;
  // Percent delta vs the prior period. Positive = up, negative = down,
  // zero/undefined = no trend indicator. Caller decides the period.
  delta?: number;
  // Semantic of an increase — 'positive' colors up-arrows green, 'negative'
  // colors them red. Cost metrics are "negative" (more = worse), usage
  // metrics are "positive".
  deltaSemantic?: 'positive' | 'negative' | 'neutral';
}

// Tiny count-up hook — 600ms ease-out. Runs on mount and every time the
// target changes, so a poll-driven update animates too.
const useCountUp = (target: number, durationMs = 600): number => {
  const [value, setValue] = useState(target);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = t - startRef.current;
      const pct = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - pct, 3);
      setValue(fromRef.current + (target - fromRef.current) * eased);
      if (pct < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // We intentionally omit `value` — the animation resets only on target change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return value;
};

export const TokenCard = ({
  title,
  value,
  numericValue,
  format,
  subtitle,
  icon: Icon,
  valueColor = 'var(--color-text-primary)',
  delta,
  deltaSemantic = 'neutral',
}: TokenCardProps) => {
  const animated = useCountUp(numericValue ?? 0);
  const displayValue = numericValue !== undefined && format ? format(animated) : value;

  const trendUp = typeof delta === 'number' && delta > 0.5;
  const trendDown = typeof delta === 'number' && delta < -0.5;
  const trendFlat = typeof delta === 'number' && !trendUp && !trendDown;
  const trendColor = (() => {
    if (deltaSemantic === 'neutral' || trendFlat) return 'var(--color-text-tertiary)';
    const good = deltaSemantic === 'positive' ? trendUp : trendDown;
    return good ? 'var(--color-working)' : 'var(--color-error)';
  })();
  const TrendIcon = trendUp ? ArrowUpRight : trendDown ? ArrowDownRight : Minus;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <GlassCard padding="p-5" className="token-card">
        <div className="flex items-start justify-between mb-3">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
          >
            {title}
          </span>
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 30,
              height: 30,
              background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
            }}
          >
            <Icon size={15} strokeWidth={1.8} style={{ color: 'var(--color-accent-light)' }} />
          </div>
        </div>
        <div
          className="text-[28px] font-bold font-mono-stats leading-none"
          style={{ fontFamily: M, fontWeight: 700, color: valueColor }}
        >
          {displayValue}
        </div>
        <div className="flex items-center justify-between mt-2">
          {subtitle && (
            <span
              className="text-xs"
              style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
            >
              {subtitle}
            </span>
          )}
          {typeof delta === 'number' && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] font-mono-stats font-semibold px-1.5 py-0.5 rounded-md"
              style={{
                color: trendColor,
                background: `color-mix(in srgb, ${trendColor} 10%, transparent)`,
                fontFamily: M,
              }}
              aria-label={`Change vs prior period: ${delta.toFixed(1)} percent`}
            >
              <TrendIcon size={11} strokeWidth={2.2} />
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
};
