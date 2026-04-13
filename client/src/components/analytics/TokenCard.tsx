import type { LucideIcon } from 'lucide-react';
import { GlassCard } from '../shared/GlassCard';

const M = 'Montserrat, sans-serif';

interface TokenCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  valueColor?: string;
}

export const TokenCard = ({ title, value, subtitle, icon: Icon, valueColor = 'var(--color-text-primary)' }: TokenCardProps) => (
  <GlassCard padding="p-5">
    <div className="flex items-start justify-between mb-2">
      <span
        className="text-sm font-medium"
        style={{ fontFamily: M, color: 'var(--color-text-secondary)' }}
      >
        {title}
      </span>
      <Icon size={18} strokeWidth={1.5} style={{ color: 'var(--color-text-tertiary)' }} />
    </div>
    <div
      className="text-2xl font-bold font-mono-stats"
      style={{ fontFamily: M, fontWeight: 700, color: valueColor }}
    >
      {value}
    </div>
    {subtitle && (
      <span
        className="text-xs mt-1 block"
        style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
      >
        {subtitle}
      </span>
    )}
  </GlassCard>
);
