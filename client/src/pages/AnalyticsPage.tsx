import { DollarSign, TrendingUp, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';
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

  // Trend deltas vs prior period. `daily` is historical (today served
  // separately), so yesterday = last entry; last-7 / prior-7 compare the
  // two most recent week-long windows.
  const yesterday = daily[daily.length - 1];
  const yesterdayCost = yesterday?.totalCostUsd ?? 0;
  const todayDelta = yesterdayCost > 0 ? ((todayCost - yesterdayCost) / yesterdayCost) * 100 : undefined;

  const weekData = daily.slice(-7);
  const weekCost = weekData.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const weekTokens = weekData.reduce((sum, d) => sum + d.totalInputTokens + d.totalOutputTokens, 0);
  const priorWeekData = daily.slice(-14, -7);
  const priorWeekCost = priorWeekData.reduce((sum, d) => sum + d.totalCostUsd, 0);
  const weekDelta = priorWeekCost > 0 ? ((weekCost - priorWeekCost) / priorWeekCost) * 100 : undefined;

  const allTimeCost = daily.reduce((sum, d) => sum + d.totalCostUsd, 0) + todayCost;
  const allTimeTokens = daily.reduce((sum, d) => sum + d.totalInputTokens + d.totalOutputTokens, 0) + todayTokens;

  const chartData = daily.map((d) => ({ date: d.date, cost: d.totalCostUsd }));

  return (
    <div className="p-4 lg:p-6 pb-24 lg:pb-6" style={{ fontFamily: M }}>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Analytics
        </h1>
        <span className="text-xs font-mono-stats" style={{ color: 'var(--color-text-tertiary)' }}>
          Live · 30-day window
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <TokenCard
          title="Today"
          value={formatCost(todayCost)}
          numericValue={todayCost}
          format={formatCost}
          subtitle={`${formatTokens(todayTokens)} tokens`}
          icon={DollarSign}
          valueColor="var(--color-working)"
          delta={todayDelta}
          deltaSemantic="negative"
        />
        <TokenCard
          title="This Week"
          value={formatCost(weekCost)}
          numericValue={weekCost}
          format={formatCost}
          subtitle={`${formatTokens(weekTokens)} tokens`}
          icon={TrendingUp}
          valueColor="var(--color-accent-light)"
          delta={weekDelta}
          deltaSemantic="negative"
        />
        <TokenCard
          title="All Time"
          value={formatCost(allTimeCost)}
          numericValue={allTimeCost}
          format={formatCost}
          subtitle={`${formatTokens(allTimeTokens)} tokens`}
          icon={BarChart3}
          valueColor="var(--color-text-primary)"
        />
      </div>

      {/* Daily cost chart */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
      >
        <GlassCard padding="p-5 sm:p-6" className="mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              Daily Cost
            </h2>
            <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              30-day
            </span>
          </div>
          <CostChart data={chartData} />
        </GlassCard>
      </motion.div>

      {/* Bottom row: model breakdown + session table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlassCard padding="p-5 sm:p-6">
            <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
              By Model
            </h2>
            <ModelBreakdown data={today?.byModel ?? {}} />
          </GlassCard>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlassCard padding="p-5 sm:p-6">
            <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
              Per Session
            </h2>
            <SessionCostTable data={sessionCosts} />
          </GlassCard>
        </motion.div>
      </div>
    </div>
  );
};
