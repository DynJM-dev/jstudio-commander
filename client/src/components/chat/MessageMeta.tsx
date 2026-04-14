import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface MessageMetaProps {
  model?: string;
  tokens?: number;
  timestamp: string;
}

export const MessageMeta = ({ tokens }: MessageMetaProps) => {
  // Only show token count — model is in the header bar, timestamps in separators
  if (!tokens || tokens <= 0) return null;

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <span
        className="font-mono-stats text-xs"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
      >
        {formatTokens(tokens)}
      </span>
    </div>
  );
};
