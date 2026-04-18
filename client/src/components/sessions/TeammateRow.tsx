import type { Session } from '@commander/shared';
import { motion } from 'framer-motion';
import { StatusBadge } from '../shared/StatusBadge';

const M = 'Montserrat, sans-serif';

interface TeammateRowProps {
  teammate: Session;
  parentId: string;
  onOpen: (teammate: Session) => void;
}

const shortenPath = (path: string | null): string => {
  if (!path) return '';
  return path.replace(/^\/Users\/[^/]+/, '~');
};

// Phase W.2 — split-state preference priming removed. Clicking a
// teammate row navigates to its /chat/:id single-pane view. If the
// user wants two sessions side-by-side, they use the Split View
// button on the chat header.

export const TeammateRow = ({ teammate, parentId, onOpen }: TeammateRowProps) => {
  const isWaiting = teammate.status === 'waiting';
  const isStopped = teammate.status === 'stopped';

  return (
    <motion.button
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      onClick={() => { onOpen(teammate); }}
      className={`group flex items-center gap-2 w-full text-left rounded-md px-2 py-1.5 transition-colors ${isWaiting ? 'waiting-glow' : ''}`}
      style={{
        fontFamily: M,
        background: 'transparent',
        opacity: isStopped ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <StatusBadge status={teammate.status} size="sm" variant="teammate" />
      <span
        className="text-sm font-medium shrink-0"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {teammate.name}
      </span>
      {teammate.agentRole && (
        <span
          className="text-xs px-1.5 py-0.5 rounded shrink-0"
          style={{
            color: 'var(--color-accent-light)',
            background: 'rgba(14, 124, 123, 0.08)',
          }}
        >
          {teammate.agentRole}
        </span>
      )}
      {/* Live activity verb when the teammate is actively working; otherwise
          the project path as before. Keeps the most useful signal in the
          precious right-side column. */}
      {teammate.activity && teammate.status === 'working' ? (
        <span
          className="text-xs flex-1 min-w-0 truncate"
          style={{ color: 'var(--color-accent-light)', fontFamily: M }}
          title={teammate.activity.raw}
        >
          {teammate.activity.spinner ? `${teammate.activity.spinner} ` : ''}
          {teammate.activity.verb}
          {teammate.activity.elapsed ? ` ${teammate.activity.elapsed}` : ''}
          {typeof teammate.activity.tokens === 'number' ? ` · ${teammate.activity.tokens.toLocaleString('en-US')} tokens` : ''}
        </span>
      ) : (
        <span
          className="font-mono-stats text-xs flex-1 min-w-0 truncate"
          style={{ color: 'var(--color-text-tertiary)' }}
          title={teammate.projectPath ?? teammate.tmuxSession}
        >
          {teammate.projectPath ? shortenPath(teammate.projectPath) : teammate.tmuxSession}
        </span>
      )}
    </motion.button>
  );
};
