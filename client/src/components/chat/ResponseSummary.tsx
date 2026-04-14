import type { ChatMessage } from '@commander/shared';
import { formatTokens } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface ResponseSummaryProps {
  message: ChatMessage;
  prevTimestamp?: string;
}

export const ResponseSummary = ({ message, prevTimestamp }: ResponseSummaryProps) => {
  const parts: string[] = [];

  // Duration: time between previous message and this message's end
  if (prevTimestamp) {
    const start = new Date(prevTimestamp).getTime();
    const end = new Date(message.timestamp).getTime();
    const durationMs = end - start;
    if (durationMs > 0 && durationMs < 3600000) {
      const secs = Math.round(durationMs / 1000);
      if (secs >= 60) {
        const mins = Math.floor(secs / 60);
        const remSecs = secs % 60;
        parts.push(`Completed in ${mins}m ${remSecs}s`);
      } else {
        parts.push(`Completed in ${secs}s`);
      }
    }
  }

  // Token count
  if (message.usage) {
    const total = message.usage.inputTokens + message.usage.outputTokens;
    if (total > 0) {
      parts.push(`${formatTokens(total)} tokens`);
    }
  }

  // Check for thinking duration
  const thinkingBlocks = message.content.filter((b) => b.type === 'thinking');
  if (thinkingBlocks.length > 0) {
    parts.push(`thought for ${thinkingBlocks.length} block${thinkingBlocks.length > 1 ? 's' : ''}`);
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="flex justify-center py-1"
      style={{ fontFamily: M }}
    >
      <span
        className="text-xs"
        style={{ color: 'var(--color-text-tertiary)' }}
      >
        &#10003; {parts.join(' \u00B7 ')}
      </span>
    </div>
  );
};
