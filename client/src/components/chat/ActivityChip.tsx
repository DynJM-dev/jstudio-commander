import type { LucideIcon } from 'lucide-react';

const M = 'Montserrat, sans-serif';

export type ChipTone = 'accent' | 'blue' | 'purple' | 'cyan' | 'amber' | 'muted';

// Inline CSS color values for each tone. Paired (text, background, border)
// picked to read on dark glass surfaces without fighting existing accents.
const TONE_STYLES: Record<ChipTone, { text: string; bg: string; border: string }> = {
  accent: { text: 'var(--color-accent-light)', bg: 'rgba(14, 124, 123, 0.08)', border: 'rgba(14, 124, 123, 0.15)' },
  blue:   { text: '#7DD3FC',                   bg: 'rgba(56, 189, 248, 0.08)', border: 'rgba(56, 189, 248, 0.18)' },
  purple: { text: '#C4B5FD',                   bg: 'rgba(139, 92, 246, 0.08)', border: 'rgba(139, 92, 246, 0.18)' },
  cyan:   { text: '#67E8F9',                   bg: 'rgba(34, 211, 238, 0.08)', border: 'rgba(34, 211, 238, 0.18)' },
  amber:  { text: 'var(--color-idle)',         bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.18)' },
  muted:  { text: 'var(--color-text-tertiary)', bg: 'rgba(255, 255, 255, 0.04)', border: 'rgba(255, 255, 255, 0.06)' },
};

interface ActivityChipProps {
  icon: LucideIcon;
  label: string;
  // Secondary noun — the thing being acted on (skill name, file, teammate, ...).
  // Renders muted to the right of the label; truncates on overflow.
  target?: string;
  // Tiny result excerpt, shown after a separator dot when present.
  result?: string;
  tone?: ChipTone;
}

export const ActivityChip = ({ icon: Icon, label, target, result, tone = 'muted' }: ActivityChipProps) => {
  const style = TONE_STYLES[tone];
  return (
    <div
      className="inline-flex items-center gap-1.5 py-0.5 px-2 my-0.5 rounded-full max-w-full"
      style={{
        fontFamily: M,
        background: style.bg,
        border: `1px solid ${style.border}`,
      }}
    >
      <Icon size={12} className="shrink-0" style={{ color: style.text }} />
      <span className="text-xs font-medium shrink-0" style={{ color: style.text }}>
        {label}
      </span>
      {target && (
        <span
          className="text-xs min-w-0 truncate"
          style={{ color: 'var(--color-text-secondary)', maxWidth: 360 }}
          title={target}
        >
          {target}
        </span>
      )}
      {result && (
        <>
          <span className="text-xs shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>·</span>
          <span
            className="text-xs min-w-0 truncate"
            style={{ color: 'var(--color-text-tertiary)', maxWidth: 280 }}
            title={result}
          >
            {result}
          </span>
        </>
      )}
    </div>
  );
};
