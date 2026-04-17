import { useState } from 'react';
import { Crown } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { formatTime } from '../../utils/format';
import { parseChatMessage } from '../../utils/chatMessageParser';
import { TaskNotificationCard } from './TaskNotificationCard';
import { TeammateMessageCard } from './TeammateMessageCard';

const M = 'Montserrat, sans-serif';

const MAX_CHARS = 300;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface UserMessageProps {
  message: ChatMessage;
}

export const UserMessage = ({ message }: UserMessageProps) => {
  const textBlocks = message.content.filter((b) => b.type === 'text');
  const toolResults = message.content.filter((b) => b.type === 'tool_result');
  const [expanded, setExpanded] = useState(false);

  // If the message is only tool_results (no user text), skip rendering
  const isToolResultOnly = textBlocks.length === 0 && toolResults.length > 0;
  if (isToolResultOnly) return null;

  // Belt-and-suspenders: if ChatThread (or a future caller) didn't intercept
  // a structured user payload, suppress the JB header here too and render
  // the first structured fragment. Never let raw <task-notification> /
  // <teammate-message> XML leak into the chat. Only the first fragment is
  // rendered here because this belt path only fires when UserMessage is used
  // outside the Phase-K ChatThread flow; the fragment-array rendering lives
  // in ChatThread.
  if (textBlocks.length === 1 && textBlocks[0]?.type === 'text') {
    const fragments = parseChatMessage(textBlocks[0].text);
    for (const frag of fragments) {
      if (frag.kind === 'task-notification') {
        return <TaskNotificationCard notification={frag.notification} />;
      }
      if (frag.kind === 'teammate-message') {
        return <TeammateMessageCard message={frag.teammate} />;
      }
    }
  }

  const reduced = prefersReducedMotion();

  // Check if any text block is long
  const fullText = textBlocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const isLong = fullText.length > MAX_CHARS;

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="w-full py-3 px-4 pl-5"
      style={{
        fontFamily: M,
        background: 'rgba(14, 124, 123, 0.04)',
        borderLeft: '2px solid rgba(14, 124, 123, 0.6)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <Crown
          size={14}
          className="shrink-0"
          style={{ color: '#EAB308' }}
        />
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          JB
        </span>
        <span className="flex-1" />
        <span
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {formatTime(message.timestamp)}
        </span>
      </div>

      {/* Message text — truncated if long */}
      <div
        className="text-sm leading-relaxed"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {renderTextContent(
          isLong && !expanded ? fullText.slice(0, MAX_CHARS) + '...' : fullText
        )}
      </div>

      {/* Show more / Show less */}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs mt-1 transition-colors"
          style={{
            fontFamily: M,
            color: 'var(--color-text-tertiary)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent-light)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

    </motion.div>
  );
};
