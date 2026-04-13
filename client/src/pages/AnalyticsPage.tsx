import { DollarSign, TrendingUp, BarChart3 } from 'lucide-react';
import { LoadingSkeleton } from '../components/shared/LoadingSkeleton';
import { GlassCard } from '../components/shared/GlassCard';
import { TokenCard } from '../components/analytics/TokenCard';
import { CostChart } from '../components/analytics/CostChart';
import { ModelBreakdown } from '../components/analytics/ModelBreakdown';
import { SessionCostTable } from '../components/analytics/SessionCostTable';
import { useAnalytics } from '../hooks/useAnalytics';
import { formatTokens, formatCost } from '../utils/format';

const M = 'Montserrat, sans-serif';

export const AnalyticsPage = () => {
  const { today, daily, sessionCosts, loading, error } = useAnalytics();

  if (loading) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text-primary)' }}>
          Analytics
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <LoadingSkeleton variant="card" count={3} />
        </div>
        <LoadingSkeleton variant="chart" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
        <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text-primary)' }}>
          Analytics
        </h1>
        <GlassCard padding="p-5">
          <p className="text-sm" style={{ color: 'var(--color-error)' }}>Error: {error}</p>
        </GlassCard>
      </div>
    );
  }

  const todayTokens = today ? today.totalInputTokens + today.totalOutputTokens : 0;
  const todayCost = today?.totalCostUsd ?? 0;

  // Compute week stats from daily data
  const weekData = daily.slice(-7);
  const weekCost = weekData.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const weekTokens = weekData.reduce((sum, d) => sum + d.totalInputTokens + d.totalOutputTokens, 0);

  // All-time stats from all daily data
  const allTimeCost = daily.reduce((sum, d) => sum + d.totalCostUsd, 0) + todayCost;
  const allTimeTokens = daily.reduce((sum, d) => sum + d.totalInputTokens + d.totalOutputTokens, 0) + todayTokens;

  // Chart data
  const chartData = daily.map((d) => ({ date: d.date, cost: d.totalCostUsd }));

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--color-text-primary)' }}>
        Analytics
      </h1>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TokenCard
          title="Today"
          value={formatCost(todayCost)}
          subtitle={`${formatTokens(todayTokens)} tokens`}
          icon={DollarSign}
          valueColor="var(--color-working)"
        />
        <TokenCard
          title="This Week"
          value={formatCost(weekCost)}
          subtitle={`${formatTokens(weekTokens)} tokens`}
          icon={TrendingUp}
          valueColor="var(--color-accent-light)"
        />
        <TokenCard
          title="All Time"
          value={formatCost(allTimeCost)}
          subtitle={`${formatTokens(allTimeTokens)} tokens`}
          icon={BarChart3}
          valueColor="var(--color-text-primary)"
        />
      </div>

      {/* Daily cost chart */}
      <GlassCard padding="p-5 sm:p-6" className="mb-6">
        <h2
          className="text-base font-semibold mb-4"
          style={{ color: 'var(--color-text-primary)' }}
        >
          Daily Cost (30 days)
        </h2>
        <CostChart data={chartData} />
      </GlassCard>

      {/* Bottom row: model breakdown + session table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GlassCard padding="p-5 sm:p-6">
          <h2
            className="text-base font-semibold mb-4"
            style={{ color: 'var(--color-text-primary)' }}
          >
            By Model
          </h2>
          <ModelBreakdown data={today?.byModel ?? {}} />
        </GlassCard>

        <GlassCard padding="p-5 sm:p-6">
          <h2
            className="text-base font-semibold mb-4"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Per Session
          </h2>
          <SessionCostTable data={sessionCosts} />
        </GlassCard>
      </div>
    </div>
  );
};
