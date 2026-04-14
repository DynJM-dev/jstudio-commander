import { useMemo } from 'react';
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

// Build a task plan from TaskCreate/TaskUpdate tool calls in the message group
const buildPlanTasks = (messages: ChatMessage[]): PlanTask[] => {
  const tasks = new Map<string, PlanTask>();
  let autoId = 1;

  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type !== 'tool_use') continue;

      if (block.name === 'TaskCreate') {
        const id = String(autoId++);
        const input = block.input as { subject?: string; description?: string };
        tasks.set(id, {
          id,
          title: input.subject ?? 'Task',
          description: input.description,
          status: 'pending',
        });
      }

      if (block.name === 'TaskUpdate') {
        const input = block.input as { taskId?: string; status?: string; subject?: string };
        const taskId = input.taskId;
        if (taskId && tasks.has(taskId)) {
          const task = tasks.get(taskId)!;
          if (input.status) {
            task.status = input.status as PlanTask['status'];
          }
          if (input.subject) {
            task.title = input.subject;
          }
        }
      }
    }
  }

  return Array.from(tasks.values());
};

export const AssistantMessage = ({ messages, toolResults }: AssistantMessageGroupProps) => {
  const reduced = prefersReducedMotion();
  const firstMsg = messages[0];
  if (!firstMsg) return null;

  // Build plan from TaskCreate/TaskUpdate calls
  const planTasks = useMemo(() => buildPlanTasks(messages), [messages]);
  const hasPlan = planTasks.length > 0;

  // Find where to insert the plan (after the first TaskCreate block)
  const firstTaskCreateIdx = useMemo(() => {
    let blockCount = 0;
    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.name === 'TaskCreate') {
          return blockCount;
        }
        blockCount++;
      }
    }
    return -1;
  }, [messages]);

  let planInserted = false;
  let globalBlockIdx = 0;

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

      {/* All content blocks from all messages in the group */}
      <div className="space-y-0.5">
        {messages.map((msg, mi) =>
          msg.content.map((block, bi) => {
            const idx = globalBlockIdx++;
            const rendered = renderBlock(block, `${mi}-${bi}`, toolResults);

            // Insert AgentPlan at the first TaskCreate position
            if (hasPlan && !planInserted && idx === firstTaskCreateIdx) {
              planInserted = true;
              return (
                <AgentPlan key={`plan-${mi}-${bi}`} tasks={planTasks} title="Tasks" />
              );
            }

            return rendered;
          })
        )}
      </div>
    </motion.div>
  );
};
