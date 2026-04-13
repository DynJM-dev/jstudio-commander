import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface UserBubbleProps {
  message: ChatMessage;
}

export const UserBubble = ({ message }: UserBubbleProps) => {
  // Extract text blocks and tool_result blocks
  const textBlocks = message.content.filter((b) => b.type === 'text');
  const toolResults = message.content.filter((b) => b.type === 'tool_result');

  // If the message is only tool_results (no user text), render muted
  const isToolResultOnly = textBlocks.length === 0 && toolResults.length > 0;

  if (isToolResultOnly) {
    return null; // Tool results are displayed in the preceding assistant bubble's ToolCallBlock
  }

  return (
    <div className="flex justify-end">
      <div
        className="ml-auto max-w-[85%] lg:max-w-[70%] px-4 py-3"
        style={{
          fontFamily: M,
          background: 'rgba(14, 124, 123, 0.12)',
          border: '1px solid rgba(14, 124, 123, 0.2)',
          borderRadius: '16px 16px 4px 16px',
        }}
      >
        {textBlocks.map((block, i) => {
          if (block.type !== 'text') return null;
          return (
            <div
              key={i}
              className="text-sm lg:text-base leading-relaxed"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {renderTextContent(block.text)}
            </div>
          );
        })}

        <div className="flex justify-end mt-1.5">
          <span
            className="text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </div>
  );
};
