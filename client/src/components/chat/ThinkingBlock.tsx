import { useState } from 'react';
import { BrainCircuit, ChevronRight, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const M = 'Montserrat, sans-serif';

interface ThinkingBlockProps {
  text: string;
}

export const ThinkingBlock = ({ text }: ThinkingBlockProps) => {
  const [expanded, setExpanded] = useState(false);
  const isRedacted = !text || text.trim().length === 0;

  if (isRedacted) {
    return (
      <div
        className="flex items-center gap-2 py-1.5 text-sm italic"
        style={{
          color: 'var(--color-text-tertiary)',
          fontFamily: M,
          borderLeft: '3px solid var(--color-accent)',
          paddingLeft: 12,
        }}
      >
        <BrainCircuit size={14} />
        <span>Extended thinking (redacted)</span>
      </div>
    );
  }

  return (
    <div
      className="my-1 rounded-lg overflow-hidden"
      style={{
        background: 'rgba(14, 124, 123, 0.06)',
        borderLeft: '3px solid var(--color-accent)',
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full py-2.5 px-3 text-sm cursor-pointer transition-colors"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
      >
        <BrainCircuit size={14} className="brain-glow shrink-0" />
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="italic">Thinking...</span>
        {!expanded && (
          <div className="flex-1 ml-2 h-3 rounded thinking-shimmer" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' as const }}
            className="overflow-hidden"
          >
            <div
              className="px-3 pb-3 text-sm italic max-h-[300px] overflow-y-auto"
              style={{
                fontFamily: M,
                color: 'var(--color-text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
