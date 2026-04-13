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
    <Icon
      size={48}
      strokeWidth={1.2}
      style={{ color: 'var(--color-text-tertiary)' }}
      className="mb-4"
    />
    <h3
      className="text-base font-semibold mb-1"
      style={{ color: 'var(--color-text-secondary)', fontFamily: M }}
    >
      {title}
    </h3>
    <p
      className="text-sm max-w-xs"
      style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
    >
      {description}
    </p>
    {action && (
      <button
        onClick={action.onClick}
        className="mt-5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          fontFamily: M,
          backgroundColor: 'var(--color-accent)',
          color: '#fff',
        }}
      >
        {action.label}
      </button>
    )}
  </div>
);
