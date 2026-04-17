import { Dot, Power, CheckCircle2, type LucideIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import { resolveTeammateColor } from '../../utils/teammateColors';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type SystemEventKind = 'idle' | 'terminated' | 'approved';

interface SystemEventChipProps {
  kind: SystemEventKind;
  from?: string;
  count?: number;
  color?: string;
  timestamp?: string | null;
  // Optional short suffix displayed after the primary label (e.g. "#request-id").
  extra?: string | null;
  // 'chip' (default, ~22px one-liner) or 'card' — the card variant has a bit
  // more padding, shows the timestamp inline, and reserves room for `extra`
  // text without truncation. Driven by the localStorage visibility mode:
  // `chips` maps to `'chip'`, `cards` maps to `'card'`.
  variant?: 'chip' | 'card';
}

interface ChipConfig {
  icon: LucideIcon;
  label: (from: string) => string;
  defaultColor: string;
}

const CHIP_CONFIG: Record<SystemEventKind, ChipConfig> = {
  idle: {
    icon: Dot,
    label: (from) => `${from || 'teammate'} idled`,
    defaultColor: 'var(--color-idle)',
  },
  terminated: {
    icon: Power,
    label: (from) => `${from || 'teammate'} terminated`,
    defaultColor: 'var(--color-text-tertiary)',
  },
  approved: {
    icon: CheckCircle2,
    label: (from) => `shutdown approved${from ? ` by ${from}` : ''}`,
    defaultColor: 'var(--color-accent-light)',
  },
};

export const SystemEventChip = ({
  kind,
  from,
  count,
  color,
  timestamp,
  extra,
  variant = 'chip',
}: SystemEventChipProps) => {
  const cfg = CHIP_CONFIG[kind];
  const Icon = cfg.icon;
  const teammateColor = color ? resolveTeammateColor(color) : null;
  const stripColor = teammateColor ?? cfg.defaultColor;
  const displayCount = count && count > 1 ? ` ×${count}` : '';
  const reduced = prefersReducedMotion();
  const tsLabel = timestamp ? new Date(timestamp).toLocaleTimeString() : null;
  const isCard = variant === 'card';

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' as const }}
      className="flex items-center gap-1.5"
      style={{
        fontFamily: M,
        borderLeft: `2px solid ${stripColor}`,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: isCard ? 4 : 1,
        paddingBottom: isCard ? 4 : 1,
        minHeight: isCard ? 28 : 22,
        background: isCard ? 'rgba(255, 255, 255, 0.02)' : 'transparent',
        borderRadius: isCard ? 6 : 0,
      }}
      title={tsLabel ?? undefined}
    >
      <Icon size={isCard ? 13 : 11} style={{ color: stripColor, opacity: 0.9 }} />
      <span
        className={isCard ? 'text-sm' : 'text-xs truncate'}
        style={{ color: 'var(--color-text-tertiary)', maxWidth: isCard ? undefined : 320 }}
      >
        {cfg.label(from ?? '')}{displayCount}
      </span>
      {extra && (
        <span
          className="text-[11px] shrink-0 font-mono-stats"
          style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}
        >
          {extra}
        </span>
      )}
      {isCard && tsLabel && (
        <span
          className="ml-auto text-[11px] shrink-0 font-mono-stats"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {tsLabel}
        </span>
      )}
    </motion.div>
  );
};
