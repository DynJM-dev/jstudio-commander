import { useMemo } from 'react';
import { Bot } from 'lucide-react';
import type { ChatMessage, ContentBlock } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageMeta } from './MessageMeta';

const M = 'Montserrat, sans-serif';

interface AssistantBubbleProps {
  message: ChatMessage;
  toolResults: Map<string, { content: string; isError?: boolean }>;
}

const renderBlock = (
  block: ContentBlock,
  index: number,
  toolResults: Map<string, { content: string; isError?: boolean }>
) => {
  switch (block.type) {
    case 'text':
      return (
        <div
          key={index}
          className="text-sm lg:text-base leading-relaxed"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {renderTextContent(block.text)}
        </div>
      );

    case 'thinking':
      return <ThinkingBlock key={index} text={block.text} />;

    case 'tool_use': {
      const result = toolResults.get(block.id);
      return (
        <ToolCallBlock
          key={index}
          name={block.name}
          input={block.input}
          result={result?.content}
          isError={result?.isError}
        />
      );
    }

    case 'system_note':
      return (
        <div
          key={index}
          className="text-xs italic py-1"
          style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
        >
          {block.text}
        </div>
      );

    default:
      return null;
  }
};

export const AssistantBubble = ({ message, toolResults }: AssistantBubbleProps) => {
  const totalTokens = useMemo(() => {
    if (!message.usage) return undefined;
    return message.usage.inputTokens + message.usage.outputTokens;
  }, [message.usage]);

  return (
    <div className="flex justify-start items-start gap-2">
      {/* Avatar */}
      <div
        className="shrink-0 w-6 h-6 lg:w-8 lg:h-8 rounded-full flex items-center justify-center mt-1"
        style={{
          background: 'linear-gradient(135deg, #0E7C7B, #12A5A4)',
        }}
      >
        <Bot size={14} color="#fff" className="hidden lg:block" />
        <Bot size={12} color="#fff" className="lg:hidden" />
      </div>

      <div
        className="max-w-[82%] lg:max-w-[72%] px-3.5 py-2.5 lg:px-4 lg:py-3"
        style={{
          fontFamily: M,
          background: 'var(--color-glass-light)',
          border: '1px solid var(--color-glass-border)',
          borderRadius: '16px 16px 16px 4px',
        }}
      >
        {message.content.map((block, i) => renderBlock(block, i, toolResults))}

        <MessageMeta
          model={message.model}
          tokens={totalTokens}
          timestamp={message.timestamp}
        />
      </div>
    </div>
  );
};
