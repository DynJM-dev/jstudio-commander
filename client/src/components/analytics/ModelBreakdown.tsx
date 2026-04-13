import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface ModelBreakdownProps {
  data: Record<string, { costUsd: number; inputTokens: number; outputTokens: number }>;
}

const MODEL_COLORS: Record<string, string> = {
  'claude-opus-4-6': '#0E7C7B',
  'claude-sonnet-4-6': '#12A5A4',
  'claude-haiku-4-5': '#18D4D3',
};

const shortModelName = (name: string): string => {
  if (name.includes('opus')) return 'Opus';
  if (name.includes('sonnet')) return 'Sonnet';
  if (name.includes('haiku')) return 'Haiku';
  return name;
};

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; cost: number; tokens: number } }> }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;

  return (
    <div className="glass-card px-3 py-2" style={{ fontFamily: M }}>
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{d.name}</p>
      <p className="text-sm font-bold font-mono-stats" style={{ color: 'var(--color-working)' }}>
        ${d.cost.toFixed(2)}
      </p>
      <p className="text-xs font-mono-stats" style={{ color: 'var(--color-text-tertiary)' }}>
        {formatTokens(d.tokens)} tokens
      </p>
    </div>
  );
};

export const ModelBreakdown = ({ data }: ModelBreakdownProps) => {
  const entries = Object.entries(data).map(([model, stats]) => ({
    name: shortModelName(model),
    fullName: model,
    cost: stats.costUsd,
    tokens: stats.inputTokens + stats.outputTokens,
  }));

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px]">
        <span className="text-sm italic" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
          No model data yet
        </span>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={entries} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.3)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          dataKey="name"
          type="category"
          tick={{ fontSize: 12, fill: 'rgba(255,255,255,0.5)' }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.02)' }} />
        <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {entries.map((entry) => (
            <Cell key={entry.fullName} fill={MODEL_COLORS[entry.fullName] ?? '#0E7C7B'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
