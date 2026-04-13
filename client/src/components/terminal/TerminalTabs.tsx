import { Plus } from 'lucide-react';
import type { Session } from '@commander/shared';
import { StatusBadge } from '../shared/StatusBadge';

const M = 'Montserrat, sans-serif';

interface TerminalTabsProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export const TerminalTabs = ({ sessions, activeSessionId, onSelect, onNew }: TerminalTabsProps) => (
  <div
    className="flex items-center gap-1 overflow-x-auto px-2 shrink-0"
    style={{
      height: 44,
      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
      background: 'rgba(10, 14, 20, 0.8)',
    }}
  >
    {sessions.map((session) => {
      const isActive = session.id === activeSessionId;
      return (
        <button
          key={session.id}
          onClick={() => onSelect(session.id)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-sm whitespace-nowrap transition-colors shrink-0"
          style={{
            fontFamily: M,
            color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            background: isActive ? 'rgba(255, 255, 255, 0.04)' : 'transparent',
            borderBottom: isActive ? '2px solid var(--color-accent)' : '2px solid transparent',
          }}
        >
          <StatusBadge status={session.status} size="sm" />
          <span>{session.name}</span>
        </button>
      );
    })}

    {/* New session button */}
    <button
      onClick={onNew}
      className="flex items-center justify-center shrink-0 rounded-lg transition-colors"
      style={{
        width: 32,
        height: 32,
        color: 'var(--color-text-tertiary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--color-text-secondary)';
        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--color-text-tertiary)';
        e.currentTarget.style.background = 'transparent';
      }}
      title="New session"
    >
      <Plus size={16} />
    </button>
  </div>
);
