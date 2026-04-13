import { formatTokens, formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface MessageMetaProps {
  model?: string;
  tokens?: number;
  timestamp: string;
}

export const MessageMeta = ({ model, tokens, timestamp }: MessageMetaProps) => (
  <div className="flex items-center gap-2 mt-2">
    {model && (
      <span
        className="text-xs px-2 py-0.5 rounded-full"
        style={{
          fontFamily: M,
          background: 'rgba(255, 255, 255, 0.06)',
          color: 'var(--color-text-tertiary)',
        }}
      >
        {model}
      </span>
    )}
    {tokens !== undefined && tokens > 0 && (
      <span
        className="font-mono-stats text-xs"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        {formatTokens(tokens)}
      </span>
    )}
    <span
      className="text-xs"
      style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
    >
      {formatTime(timestamp)}
    </span>
  </div>
);
