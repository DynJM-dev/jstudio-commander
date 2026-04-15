import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

const M = 'Montserrat, sans-serif';

interface CostChartProps {
  data: Array<{ date: string; cost: number }>;
}

const formatDate = (dateStr: string): string => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="glass-card px-3 py-2"
      style={{ fontFamily: M }}
    >
      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
        {label ? formatDate(label) : ''}
      </p>
      <p className="text-sm font-bold font-mono-stats" style={{ color: 'var(--color-working)' }}>
        ${(payload[0]?.value ?? 0).toFixed(2)}
      </p>
    </div>
  );
};

export const CostChart = ({ data }: CostChartProps) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[300px]">
        <span className="text-sm italic" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
          No cost data yet
        </span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0E7C7B" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#0E7C7B" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="cost"
          stroke="#0E7C7B"
          strokeWidth={2}
          fill="url(#costGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};
