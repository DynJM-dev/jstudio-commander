import { useState } from 'react';
import { HelpCircle, ChevronRight, ChevronDown } from 'lucide-react';
import { motion } from 'framer-motion';
import { resolveTeammateColor } from '../../utils/teammateColors';

const M = 'Montserrat, sans-serif';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface UnrecognizedProtocolCardProps {
  protocolType: string;
  raw: string;
  // Optional wrapper context when the payload came from inside a
  // <teammate-message>. The border tints to the teammate's color so the
  // placeholder stays visually consistent with nearby teammate cards.
  context?: { teammateId: string; color: string };
}

// Ghost placeholder for JSON payloads that carry a `type` we don't model.
// The goal is to never leak raw curly-brace JSON into the JB bubble; future
// Claude Code protocol additions render as a neutral "Protocol event: <type>"
// row with opt-in access to the underlying JSON.
export const UnrecognizedProtocolCard = ({ protocolType, raw, context }: UnrecognizedProtocolCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const reduced = prefersReducedMotion();
  const borderColor = context ? resolveTeammateColor(context.color) : 'var(--color-text-tertiary)';

  const pretty = (() => {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  })();

  return (
    <motion.div
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' as const }}
    >
      <div
        className="w-full py-2 px-3"
        style={{
          fontFamily: M,
          background: 'rgba(255, 255, 255, 0.015)',
          borderLeft: `2px dashed ${borderColor}`,
          borderRadius: 8,
          opacity: 0.85,
        }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 w-full text-left transition-colors"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <HelpCircle size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            Protocol event: <code style={{ color: 'var(--color-text-secondary)' }}>{protocolType}</code>
          </span>
          {context?.teammateId && (
            <span className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
              from {context.teammateId}
            </span>
          )}
          <span className="ml-auto flex items-center gap-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {expanded ? 'Hide raw' : 'Show raw'}
          </span>
        </button>
        {expanded && (
          <pre
            className="text-[11px] leading-relaxed mt-2 p-2 overflow-x-auto rounded"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              background: 'rgba(0, 0, 0, 0.25)',
              color: 'var(--color-text-secondary)',
              maxHeight: 240,
            }}
          >
            {pretty}
          </pre>
        )}
      </div>
    </motion.div>
  );
};
