import { Users, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import type { TeammateMessage } from '../../utils/chatMessageParser';
import { renderTextContent } from '../../utils/text-renderer';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Same palette already used by Commander's teammate colors (set in
// ~/.claude/teams/*/config.json). Keeps the border in sync with the
// teammate icon/identity across the UI.
const TEAMMATE_COLOR_HEX: Record<string, string> = {
  blue: '#3B82F6',
  purple: '#A855F7',
  teal: '#14B8A6',
  green: '#22C55E',
  yellow: '#EAB308',
  red: '#EF4444',
  orange: '#F97316',
  pink: '#EC4899',
  cyan: '#06B6D4',
};

const resolveColor = (raw: string): string => {
  if (!raw) return 'var(--color-accent)';
  // Accept named colors from the palette OR a raw hex literal if the PM
  // ever supplies one. Anything else falls back to the accent so we never
  // leak an unparseable string into inline CSS.
  const key = raw.toLowerCase();
  if (TEAMMATE_COLOR_HEX[key]) return TEAMMATE_COLOR_HEX[key]!;
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
  return 'var(--color-accent)';
};

interface TeammateMessageCardProps {
  message: TeammateMessage;
  onOpen?: () => void;
}

export const TeammateMessageCard = ({ message, onOpen }: TeammateMessageCardProps) => {
  const { teammateId, color, summary, body } = message;
  const borderColor = resolveColor(color);
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
