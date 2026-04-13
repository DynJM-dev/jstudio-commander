import { MessageSquare } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const ChatPage = () => (
  <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
    <h1
      className="text-xl font-semibold mb-6"
      style={{ color: 'var(--color-text-primary)' }}
    >
      Chat
    </h1>
    <div className="glass-card">
      <EmptyState
        icon={MessageSquare}
        title="No session selected"
        description="Select an active session to view its conversation."
      />
    </div>
  </div>
);
