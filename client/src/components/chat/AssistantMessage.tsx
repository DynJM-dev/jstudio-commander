import { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { ChatMessage, ContentBlock } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { MessageMeta } from './MessageMeta';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

interface AssistantMessageProps {
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
          className="text-sm leading-relaxed py-0.5"
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

export const AssistantMessage = ({ message, toolResults }: AssistantMessageProps) => {
  const totalTokens = useMemo(() => {
    if (!message.usage) return undefined;
    return message.usage.inputTokens + message.usage.outputTokens;
  }, [message.usage]);

  return (
    <div style={{ fontFamily: M }}>
      {/* Header: Claude icon + "Claude" + timestamp */}
      <div className="flex items-center gap-2 mb-1">
        <Sparkles
          size={18}
          style={{ color: '#0E7C7B' }}
          className="shrink-0 lg:w-[18px] lg:h-[18px] w-4 h-4"
        />
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-accent-light)' }}
        >
          Claude
        </span>
        <span className="flex-1" />
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Timeline bar + content blocks */}
      <div className="timeline-line-accent">
        <div className="space-y-1.5">
          {message.content.map((block, i) => renderBlock(block, i, toolResults))}
        </div>

        {/* Turn footer: model · tokens · duration */}
        <MessageMeta
          model={message.model}
          tokens={totalTokens}
        />
      </div>
    </div>
  );
};
