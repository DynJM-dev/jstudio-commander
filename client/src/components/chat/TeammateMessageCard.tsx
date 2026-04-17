import { Users, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TeammateMessage } from '../../utils/chatMessageParser';
import { renderTextContent } from '../../utils/text-renderer';
import { resolveTeammateColor } from '../../utils/teammateColors';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface TeammateMessageCardProps {
  message: TeammateMessage;
  onOpen?: () => void;
}

export const TeammateMessageCard = ({ message, onOpen }: TeammateMessageCardProps) => {
  const { teammateId, color, summary, body } = message;
  const borderColor = resolveTeammateColor(color);
  const reduced = prefersReducedMotion();

  const content = (
    <div
      className="w-full py-2.5 px-4"
      style={{
        fontFamily: M,
        background: 'rgba(255, 255, 255, 0.02)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 8,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Users size={13} style={{ color: borderColor }} />
        <span
          className="text-xs font-semibold"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {teammateId || 'teammate'}
        </span>
        {summary && (
          <span
            className="text-xs italic truncate"
            style={{
              color: 'var(--color-text-tertiary)',
              maxWidth: 420,
            }}
            title={summary}
          >
            {summary}
          </span>
        )}
        {onOpen && (
          <span
            className="ml-auto flex items-center gap-1 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: borderColor }}
          >
            <ExternalLink size={11} />
            Open
          </span>
        )}
      </div>

      {/* Body — markdown + code-fence passthrough. Body text is already
          the tag's inner content decoded by the parser. */}
      {body && (
        <div
          className="text-sm leading-relaxed"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          {renderTextContent(body)}
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' as const }}
      className="group"
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="w-full text-left cursor-pointer transition-colors"
          style={{ background: 'none', border: 'none', padding: 0 }}
          onMouseEnter={(e) => { (e.currentTarget.firstElementChild as HTMLElement).style.background = 'rgba(255, 255, 255, 0.04)'; }}
          onMouseLeave={(e) => { (e.currentTarget.firstElementChild as HTMLElement).style.background = 'rgba(255, 255, 255, 0.02)'; }}
          title={`Open ${teammateId || 'teammate'} in split view`}
        >
          {content}
        </button>
      ) : (
        content
      )}
    </motion.div>
  );
};
