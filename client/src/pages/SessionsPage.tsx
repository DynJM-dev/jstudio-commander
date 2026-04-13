import { Monitor } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const SessionsPage = () => (
  <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
    <h1
      className="text-xl font-semibold mb-6"
      style={{ color: 'var(--color-text-primary)' }}
    >
      Sessions
    </h1>
    <div className="glass-card">
      <EmptyState
        icon={Monitor}
        title="No active sessions"
        description="Start a Claude Code session to see it here."
      />
    </div>
  </div>
);
