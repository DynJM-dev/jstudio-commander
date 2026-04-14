import { Crown } from 'lucide-react';
import { motion } from 'framer-motion';
import type { ChatMessage } from '@commander/shared';
import { renderTextContent } from '../../utils/text-renderer';
import { formatTime } from '../../utils/format';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface UserMessageProps {
  message: ChatMessage;
}

export const UserMessage = ({ message }: UserMessageProps) => {
  const textBlocks = message.content.filter((b) => b.type === 'text');
  const toolResults = message.content.filter((b) => b.type === 'tool_result');

  // If the message is only tool_results (no user text), skip rendering
  const isToolResultOnly = textBlocks.length === 0 && toolResults.length > 0;
  if (isToolResultOnly) return null;

  const reduced = prefersReducedMotion();

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
      {/* Header: User icon + "You" + timestamp */}
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

      {/* Message text */}
      {textBlocks.map((block, i) => {
        if (block.type !== 'text') return null;
        return (
          <div
            key={i}
            className="text-sm leading-relaxed"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {renderTextContent(block.text)}
          </div>
        );
      })}
    </motion.div>
  );
};
