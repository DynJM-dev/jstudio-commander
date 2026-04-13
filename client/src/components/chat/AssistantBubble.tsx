import { useMemo } from 'react';
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
    <div className="flex justify-start">
      <div
        className="mr-auto max-w-[90%] lg:max-w-[80%] px-4 py-3 lg:px-5 lg:py-4"
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
