import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage, ContentBlock } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';
import { AgentPlan } from './AgentPlan';
import type { PlanTask } from './AgentPlan';
import { ActivityChip } from './ActivityChip';
import { AgentSpawnCard } from './AgentSpawnCard';
import { UnmappedEventChip } from './UnmappedEventChip';
import { matchChip } from './activity-chip-registry';
import { formatTime } from '../../utils/format';

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

      // Agent spawns — rich card with live status (not registry-driven; the
      // live-status view earns the extra pixels).
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

      // Registry-driven compact chips. New activity types go in
      // activity-chip-registry.ts — no edits here.
      const chip = matchChip(block.name, block.input);
      if (chip) {
        const target = chip.target?.(block.input);
        return (
          <ActivityChip
            key={key}
            icon={chip.icon}
            tone={chip.tone}
            label={chip.label(block.input)}
            target={target}
          />
        );
      }

      // Fallback for anything the registry doesn't claim (Write, Edit, Bash,
      // generic Read, etc.) — full-fidelity card with file path + result
      // preview.
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

    // Issue 7 — new typed attachment blocks. These shouldn't appear
    // inside an assistant message in practice (the parser emits them
    // as separate system-role records), but the switch is exhaustive
    // against ContentBlock so we cover them here too. No-op rather
    // than rendering a misplaced chip.
    case 'inline_reminder':
    case 'file_attachment':
    case 'compact_file_ref':
    case 'local_command':
      return null;

    case 'tool_result':
      // tool_result blocks on assistant role are a Claude-side anomaly
      // (they flow through user role in normal JSONLs). If one shows
      // up inside an assistant message, skip rather than rendering —
      // the real result is already attached to the preceding tool_use
      // via buildToolResultMap.
      return null;

    case 'debug_unmapped':
      // Issue 5 — novel Claude Code record shape that lacks a typed
      // renderer. Surfaces via the explicit debug chip, never silently
      // dropped. If this chip keeps appearing in the wild, that's the
      // signal to add a typed branch for the shape.
      return (
        <UnmappedEventChip
          key={key}
          kind={block.kind}
          eventKey={block.key}
          raw={block.raw}
        />
      );

    default:
      // Exhaustive — the switch above covers every ContentBlock
      // variant. If the union gains a new member, TypeScript's
      // `never` check flags this branch until the switch is updated.
      // At runtime we still surface a chip rather than returning
      // null so the "no silent drops" invariant holds even during a
      // half-deployed schema change.
      return (
        <UnmappedEventChip
          key={key}
          kind="assistant_block"
          eventKey={(block as ContentBlock).type}
        />
      );
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
