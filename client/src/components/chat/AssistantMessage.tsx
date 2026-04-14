import { Sparkles, Brain, BookOpen, Users, UserMinus, Send, Search, ListChecks, ListTree } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage, ContentBlock } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { AgentPlan } from './AgentPlan';
import type { PlanTask } from './AgentPlan';
import { ActivityChip } from './ActivityChip';
import { AgentSpawnCard } from './AgentSpawnCard';
import { formatTime } from '../../utils/format';

// A Read is surfaced as a dedicated chip when its file_path matches one of
// these patterns. Otherwise it renders as a generic ToolCallBlock so the
// full path + result preview stays available.
const SKILL_PATH_RE = /\/\.claude\/skills\//;
const MEMORY_PATH_RE = /(\/\.claude\/(memory|projects\/[^/]+\/memory)\/)|\/memory\/[^/]+\.md$/;
const PROJECT_DOC_NAMES = /\b(CODER_BRAIN|PM_HANDOFF|STATE|CLAUDE|MEMORY)\.md$/;

const classifyRead = (filePath: string): { kind: 'skill' | 'memory' | 'project-doc' | 'generic'; label: string } => {
  if (SKILL_PATH_RE.test(filePath)) {
    const m = filePath.match(/\/skills\/([^/]+)/);
    return { kind: 'skill', label: m?.[1] ?? 'skill' };
  }
  if (MEMORY_PATH_RE.test(filePath)) {
    const name = filePath.split('/').pop() ?? filePath;
    return { kind: 'memory', label: name };
  }
  if (PROJECT_DOC_NAMES.test(filePath)) {
    const name = filePath.split('/').pop() ?? filePath;
    return { kind: 'project-doc', label: name };
  }
  return { kind: 'generic', label: filePath };
};

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface AssistantMessageGroupProps {
  messages: ChatMessage[];
  toolResults: Map<string, { content: string; isError?: boolean }>;
  plan?: PlanTask[];
  planKey?: string;
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

      // Agent spawns — rich card with live status
      if (block.name === 'Agent') {
        const input = block.input as { description?: string; prompt?: string; subagent_type?: string };
        return (
          <AgentSpawnCard
            key={key}
            description={input.description ?? input.subagent_type ?? 'Subagent'}
            prompt={input.prompt}
            result={result?.content}
            isError={result?.isError}
          />
        );
      }

      // Skill load
      if (block.name === 'Skill') {
        const input = block.input as { skill?: string };
        return (
          <ActivityChip
            key={key}
            icon={Brain}
            tone="blue"
            label="Loaded skill"
            target={input.skill ?? 'unknown'}
          />
        );
      }

      // Teammate messaging
      if (block.name === 'SendMessage') {
        const input = block.input as { to?: string; summary?: string; message?: string | Record<string, unknown> };
        const msg = typeof input.message === 'string' ? input.message : input.summary ?? '';
        return (
          <ActivityChip
            key={key}
            icon={Send}
            tone="cyan"
            label={`Messaged ${input.to ?? 'teammate'}`}
            target={input.summary ?? (msg ? `${msg.length} chars` : undefined)}
          />
        );
      }

      if (block.name === 'TeamCreate') {
        const input = block.input as { name?: string };
        return <ActivityChip key={key} icon={Users} tone="purple" label="Created team" target={input.name} />;
      }
      if (block.name === 'TeamDelete') {
        const input = block.input as { name?: string };
        return <ActivityChip key={key} icon={UserMinus} tone="purple" label="Dismissed team" target={input.name} />;
      }

      if (block.name === 'ToolSearch') {
        const input = block.input as { query?: string };
        return <ActivityChip key={key} icon={Search} tone="muted" label="Searched tools" target={input.query} />;
      }

      if (block.name === 'TaskList') {
        const count = result?.content ? (result.content.match(/\bid\b/g) ?? []).length : undefined;
        return (
          <ActivityChip
            key={key}
            icon={ListTree}
            tone="muted"
            label="Listed tasks"
            target={count ? `${count} items` : undefined}
          />
        );
      }
      if (block.name === 'TaskGet' || block.name === 'TaskStop') {
        const input = block.input as { taskId?: string };
        return (
          <ActivityChip
            key={key}
            icon={ListChecks}
            tone="muted"
            label={block.name === 'TaskStop' ? 'Stopped task' : 'Inspected task'}
            target={input.taskId ? `#${input.taskId}` : undefined}
          />
        );
      }

      // Read routed by path — skills / memory / project docs get chips, other
      // reads stay as ToolCallBlock so the full path + content preview is
      // available in the generic card.
      if (block.name === 'Read') {
        const input = block.input as { file_path?: string };
        const path = input.file_path ?? '';
        const { kind, label } = classifyRead(path);
        if (kind === 'skill') {
          return <ActivityChip key={key} icon={Brain} tone="blue" label="Read skill" target={label} />;
        }
        if (kind === 'memory') {
          return <ActivityChip key={key} icon={BookOpen} tone="amber" label="Read memory" target={label} />;
        }
        if (kind === 'project-doc') {
          return <ActivityChip key={key} icon={BookOpen} tone="muted" label="Read doc" target={label} />;
        }
        // fall through to generic
      }

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

export const AssistantMessage = ({ messages, toolResults, plan, planKey }: AssistantMessageGroupProps) => {
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
        <div className="mb-1.5" data-plan-group-key={planKey}>
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
