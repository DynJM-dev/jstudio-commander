import type { LucideIcon } from 'lucide-react';

const M = 'Montserrat, sans-serif';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export const EmptyState = ({ icon: Icon, title, description, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <div
      className="mb-5 flex items-center justify-center rounded-2xl"
      style={{
        width: 72,
        height: 72,
        background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)',
        boxShadow: '0 0 32px -8px var(--color-accent-glow)',
      }}
    >
      <Icon size={32} strokeWidth={1.4} style={{ color: 'var(--color-accent-light)' }} />
    </div>
    <h3
      className="text-base font-semibold mb-1.5"
      style={{ color: 'var(--color-text-primary)', fontFamily: M }}
    >
      {title}
    </h3>
    <p
      className="text-sm max-w-xs leading-relaxed"
      style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
    >
      {description}
    </p>
    {action && (
      <button
        onClick={action.onClick}
        className="cta-btn-primary mt-6"
        style={{ fontFamily: M }}
      >
        {action.label}
      </button>
    )}
  </div>
);
