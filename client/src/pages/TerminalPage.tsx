import { TerminalSquare } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const TerminalPage = () => (
  <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
    <h1
      className="text-xl font-semibold mb-6"
      style={{ color: 'var(--color-text-primary)' }}
    >
      Terminal
    </h1>
    <div className="glass-card">
      <EmptyState
        icon={TerminalSquare}
        title="No terminal sessions"
        description="Create a tmux session to interact with agents directly."
      />
    </div>
  </div>
);
