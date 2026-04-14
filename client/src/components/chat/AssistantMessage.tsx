import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage, ContentBlock } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { AgentPlan } from './AgentPlan';
import type { PlanTask } from './AgentPlan';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface AssistantMessageGroupProps {
  messages: ChatMessage[];
  toolResults: Map<string, { content: string; isError?: boolean }>;
  plan?: PlanTask[];
}

const renderBlock = (
  block: ContentBlock,
  key: string,
  toolResults: Map<string, { content: string; isError?: boolean }>
) => {
  switch (block.type) {
    case 'text':
      return (
        <div
          key={key}
          className="text-sm leading-relaxed py-0.5"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {renderTextContent(block.text)}
        </div>
      );

    case 'thinking':
      return <ThinkingBlock key={key} text={block.text} />;

    case 'tool_use': {
      // TaskCreate/TaskUpdate are rendered as AgentPlan — skip here
      if (block.name === 'TaskCreate' || block.name === 'TaskUpdate') return null;

      // Agent spawns — special rendering
      if (block.name === 'Agent') {
        const input = block.input as { description?: string; prompt?: string; subagent_type?: string };
        const desc = input.description ?? input.subagent_type ?? 'Subagent';
        const result = toolResults.get(block.id);
        return (
          <div
            key={key}
            className="flex items-start gap-2 py-1.5 px-2 my-1 rounded-md"
            style={{
              background: 'rgba(14, 124, 123, 0.06)',
              border: '1px solid rgba(14, 124, 123, 0.1)',
              fontFamily: M,
            }}
          >
            <span className="text-xs mt-0.5" style={{ color: 'var(--color-accent)' }}>⚡</span>
            <div className="min-w-0">
              <span className="text-xs font-medium" style={{ color: 'var(--color-accent-light)' }}>
                Agent: {desc}
              </span>
              {input.prompt && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-tertiary)', maxWidth: 400 }}>
                  {input.prompt.slice(0, 100)}{input.prompt.length > 100 ? '...' : ''}
                </p>
              )}
              {result && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                  {result.content.slice(0, 80)}{result.content.length > 80 ? '...' : ''}
                </p>
              )}
            </div>
          </div>
        );
      }

      // Skill loading — compact note
      if (block.name === 'Skill') {
        const input = block.input as { skill?: string };
        return (
          <div
            key={key}
            className="flex items-center gap-1.5 py-0.5"
            style={{ fontFamily: M }}
          >
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>🧠</span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Loaded skill: {input.skill ?? 'unknown'}
            </span>
          </div>
        );
      }

      const result = toolResults.get(block.id);
      return (
        <ToolCallBlock
          key={key}
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
          key={key}
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

export const AssistantMessage = ({ messages, toolResults, plan }: AssistantMessageGroupProps) => {
  const reduced = prefersReducedMotion();
  const firstMsg = messages[0];
  if (!firstMsg) return null;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="w-full pt-1.5 pb-1.5 px-3"
      style={{ fontFamily: M }}
    >
      {/* Header: one per group */}
      <div className="flex items-center gap-1.5 mb-px">
        <Sparkles
          size={14}
          className="shrink-0"
          style={{ color: 'var(--color-accent)' }}
        />
        <span
          className="text-xs font-semibold leading-none"
          style={{ color: 'var(--color-accent-light)' }}
        >
          Claude
        </span>
        <span className="flex-1" />
        <span
          className="text-xs leading-none"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {formatTime(firstMsg.timestamp)}
        </span>
      </div>

      {/* Plan card — rendered at the top of Claude's response since plans
          typically arrive early in the stream. TaskCreate/TaskUpdate tool_use
          blocks are filtered out by renderBlock so they only show here. */}
      {plan && plan.length > 0 && (
        <div className="mb-1.5">
          <AgentPlan tasks={plan} title="Plan" />
        </div>
      )}

      {/* All content blocks from all messages in the group. */}
      <div className="space-y-0.5">
        {messages.map((msg, mi) =>
          msg.content.map((block, bi) => renderBlock(block, `${mi}-${bi}`, toolResults))
        )}
      </div>
    </motion.div>
  );
};
