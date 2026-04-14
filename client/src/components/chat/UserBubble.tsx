import { Crown } from 'lucide-react';
import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';

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
    <div className="flex justify-end items-start gap-2">
      <div
        className="max-w-[82%] lg:max-w-[65%] px-3.5 py-2.5"
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

      </div>

      {/* Avatar */}
      <div
        className="shrink-0 w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center mt-1"
        style={{ background: '#F59E0B' }}
      >
        <Crown size={14} color="#fff" className="hidden lg:block" />
        <Crown size={12} color="#fff" className="lg:hidden" />
      </div>
    </div>
  );
};
