import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface MessageMetaProps {
  model?: string;
  tokens?: number;
  duration?: number;
}

export const MessageMeta = ({ model, tokens, duration }: MessageMetaProps) => {
  const parts: string[] = [];

  if (model) {
    parts.push(model.replace('claude-', '').replace(/-\d+$/, ''));
  }

  if (tokens && tokens > 0) {
    parts.push(`${formatTokens(tokens)} tokens`);
  }

  if (duration && duration > 0) {
    parts.push(`${(duration / 1000).toFixed(1)}s`);
  }

  if (parts.length === 0) return null;

  const label = parts.join(' \u00B7 ');

  return (
    <div className="flex items-center gap-3 mt-3 mb-1">
      <div
        className="flex-1"
        style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
      />
      <span
        className="font-mono-stats text-xs shrink-0"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
      >
        {label}
      </span>
      <div
        className="flex-1"
        style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
      />
    </div>
  );
};
