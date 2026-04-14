import { formatTokens, formatCost } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-6': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-opus-4-5-20251101': 1_000_000,
  'claude-sonnet-4-5-20241022': 200_000,
};

const getContextLimit = (model?: string): number => {
  if (!model) return 200_000;
  return MODEL_CONTEXT_LIMITS[model] ?? 200_000;
};

interface ContextBarProps {
  model?: string;
  totalTokens: number;
  totalCost: number;
}

export const ContextBar = ({ model, totalTokens, totalCost }: ContextBarProps) => {
  const contextLimit = getContextLimit(model);
  const contextPercent = totalTokens > 0
    ? Math.min(Math.round((totalTokens / contextLimit) * 100), 100)
    : 0;

  const barColor = contextPercent > 85
    ? 'var(--color-error)'
    : contextPercent > 60
      ? 'var(--color-idle)'
      : 'var(--color-accent)';

  const showWarning = contextPercent > 85;

  return (
    <div
      className="shrink-0 flex items-center gap-3 px-4 lg:px-6 glass-nav"
      style={{
        fontFamily: M,
        height: 32,
        borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
      }}
    >
      {/* Model name */}
      {model && (
        <span
          className="text-xs font-medium shrink-0"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {model.replace('claude-', '').replace(/-\d+$/, '')}
        </span>
      )}

      {/* Separator */}
      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>

      {/* Token count */}
      <span
        className="font-mono-stats text-xs shrink-0"
        style={{ color: 'var(--color-accent-light)' }}
      >
        {formatTokens(totalTokens)} tokens
      </span>

      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&middot;</span>

      {/* Cost */}
      <span
        className="font-mono-stats text-xs shrink-0"
        style={{ color: 'var(--color-working)' }}
      >
        {formatCost(totalCost)}
      </span>

      <span className="flex-1" />

      {/* Context progress bar */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-xs hidden sm:inline-block"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          Context:
        </span>
        <div
          className="w-16 sm:w-20 h-1.5 rounded-full overflow-hidden"
          style={{ background: 'rgba(255, 255, 255, 0.06)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${contextPercent}%`,
              background: barColor,
            }}
          />
        </div>
        <span
          className="font-mono-stats text-xs shrink-0"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {contextPercent}%
        </span>
      </div>

      {/* Warning */}
      {showWarning && (
        <span
          className="text-xs hidden md:inline-block"
          style={{ color: 'var(--color-error)' }}
        >
          Context {contextPercent}% — consider /compact
        </span>
      )}
    </div>
  );
};
