import { Crown } from 'lucide-react';
import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface UserMessageProps {
  message: ChatMessage;
}

export const UserMessage = ({ message }: UserMessageProps) => {
  const textBlocks = message.content.filter((b) => b.type === 'text');
  const toolResults = message.content.filter((b) => b.type === 'tool_result');

  // If the message is only tool_results (no user text), skip rendering
  const isToolResultOnly = textBlocks.length === 0 && toolResults.length > 0;
  if (isToolResultOnly) return null;

  return (
    <div style={{ fontFamily: M }}>
      {/* Header: Crown + "You" + timestamp */}
      <div className="flex items-center gap-2 mb-1">
        <Crown
          size={18}
          style={{ color: '#F59E0B' }}
          className="shrink-0 lg:w-[18px] lg:h-[18px] w-4 h-4"
        />
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          You
        </span>
        <span className="flex-1" />
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Timeline bar + message content */}
      <div className="timeline-line">
        {textBlocks.map((block, i) => {
          if (block.type !== 'text') return null;
          return (
            <div
              key={i}
              className="text-sm leading-relaxed"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {renderTextContent(block.text)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
