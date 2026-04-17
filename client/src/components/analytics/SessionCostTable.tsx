import { BarChart3 } from 'lucide-react';
import { formatTokens, formatCost } from '../../utils/format';
import { EmptyState } from '../shared/EmptyState';

const M = 'Montserrat, sans-serif';

// Phase P.2 C3 — data tables must degrade to a card stack on mobile.
// The desktop <table> stays untouched above the `md` breakpoint; below
// it, each row renders as a glass-themed card with the same fields
// relabelled as inline key/value pairs. This is the pattern future
// tables should follow; duplicating the render logic inline here is
// intentional because each table's column set is different enough that
// a generic <ResponsiveTable> abstraction would obscure more than it
// saves.

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
      <EmptyState
        icon={BarChart3}
        title="No session cost data yet"
        description="Costs populate as sessions send prompts. Start a session to see a breakdown here."
      />
    );
  }

  const totalCost = data.reduce((sum, d) => sum + d.totalCost, 0);

  return (
    <>
      {/* Desktop / tablet: full table */}
      <div className="hidden md:block overflow-x-auto">
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

      {/* Mobile: stacked card list. Same data, readable at 375px. */}
      <ul
        className="md:hidden space-y-3"
        style={{ fontFamily: M, listStyle: 'none', padding: 0, margin: 0 }}
      >
        {data.map((row, i) => {
          const pct = totalCost > 0 ? ((row.totalCost / totalCost) * 100).toFixed(0) : '0';
          return (
            <li
              key={row.sessionId ?? `row-${i}`}
              className="rounded-xl p-4"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <span
                  className="text-sm font-semibold truncate"
                  style={{ color: 'var(--color-text-primary)' }}
                  title={row.sessionName ?? row.sessionId ?? 'unknown'}
                >
                  {row.sessionName ?? (row.sessionId?.slice(0, 8) ?? 'unknown')}
                </span>
                <span
                  className="font-mono-stats text-xs shrink-0"
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  {pct}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div style={{ color: 'var(--color-text-tertiary)' }}>Tokens</div>
                  <div className="font-mono-stats text-sm" style={{ color: 'var(--color-accent-light)' }}>
                    {formatTokens(row.totalTokens)}
                  </div>
                </div>
                <div className="text-right">
                  <div style={{ color: 'var(--color-text-tertiary)' }}>Cost</div>
                  <div className="font-mono-stats text-sm" style={{ color: 'var(--color-working)' }}>
                    {formatCost(row.totalCost)}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
};
