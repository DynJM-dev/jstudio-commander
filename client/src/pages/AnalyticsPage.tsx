import { BarChart3 } from 'lucide-react';
import { EmptyState } from '../components/shared/EmptyState';

const M = 'Montserrat, sans-serif';

export const AnalyticsPage = () => (
  <div className="p-4 lg:p-6" style={{ fontFamily: M }}>
    <h1
      className="text-xl font-semibold mb-6"
      style={{ color: 'var(--color-text-primary)' }}
    >
      Analytics
    </h1>
    <div className="glass-card">
      <EmptyState
        icon={BarChart3}
        title="No usage data yet"
        description="Token usage and cost analytics will populate as sessions run."
      />
    </div>
  </div>
);
