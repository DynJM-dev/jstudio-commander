import { formatTokens, formatCost } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface SessionCostEntry {
  sessionId: string | null;
  sessionName: string | null;
  totalCost: number;
  totalTokens: number;
  messageCount: number;
}

interface SessionCostTableProps {
  data: SessionCostEntry[];
}

export const SessionCostTable = ({ data }: SessionCostTableProps) => {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-sm italic" style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}>
          No session cost data yet
        </span>
      </div>
    );
  }

  const totalCost = data.reduce((sum, d) => sum + d.totalCost, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ fontFamily: M }}>
        <thead>
          <tr style={{ borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
            <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              Session
            </th>
            <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              Tokens
            </th>
            <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              Cost
            </th>
            <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
              %
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.sessionId ?? `row-${i}`}
              style={{
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)',
              }}
            >
              <td className="px-3 py-2 truncate max-w-[200px]" style={{ color: 'var(--color-text-secondary)' }}>
                {row.sessionName ?? (row.sessionId?.slice(0, 8) ?? 'unknown')}
              </td>
              <td className="px-3 py-2 text-right font-mono-stats" style={{ color: 'var(--color-accent-light)' }}>
                {formatTokens(row.totalTokens)}
              </td>
              <td className="px-3 py-2 text-right font-mono-stats" style={{ color: 'var(--color-working)' }}>
                {formatCost(row.totalCost)}
              </td>
              <td className="px-3 py-2 text-right font-mono-stats" style={{ color: 'var(--color-text-tertiary)' }}>
                {totalCost > 0 ? `${((row.totalCost / totalCost) * 100).toFixed(0)}%` : '0%'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
