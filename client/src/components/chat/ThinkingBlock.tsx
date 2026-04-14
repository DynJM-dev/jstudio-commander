import { useState, useEffect, useRef } from 'react';
import { BrainCircuit, ChevronRight, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const M = 'Montserrat, sans-serif';

interface ThinkingBlockProps {
  text: string;
  isActive?: boolean;
  startTime?: number;
}

const LiveDuration = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setElapsed(Date.now() - startTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [startTime]);

  return (
    <span className="font-mono-stats text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
      {(elapsed / 1000).toFixed(1)}s
    </span>
  );
};

export const ThinkingBlock = ({ text, isActive, startTime }: ThinkingBlockProps) => {
  const [expanded, setExpanded] = useState(false);
  const isRedacted = !text || text.trim().length === 0;

  // Redacted thinking — static, not expandable
  if (isRedacted && !isActive) {
    return (
      <div
        className="flex items-center gap-2 py-2 px-3 my-1"
        style={{
          fontFamily: M,
          color: 'var(--color-text-tertiary)',
        }}
      >
        <BrainCircuit size={14} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="text-xs italic">Extended thinking (redacted)</span>
      </div>
    );
  }

  // Active thinking (still in progress)
  if (isActive) {
    return (
      <div
        className="my-1 rounded-lg overflow-hidden"
        style={{
          background: 'rgba(14, 124, 123, 0.04)',
          borderLeft: '3px solid var(--color-accent)',
        }}
      >
        <div
          className="flex items-center gap-2 py-2.5 px-3"
          style={{ fontFamily: M }}
        >
          {/* Pulsing teal dot */}
          <div
            className="w-2 h-2 rounded-full shrink-0 status-pulse"
            style={{ background: 'var(--color-accent)' }}
          />
          <BrainCircuit
            size={14}
            className="brain-glow shrink-0"
            style={{ color: 'var(--color-accent)' }}
          />
          <span
            className="text-sm italic text-pulse"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            Thinking...
          </span>
          <span className="flex-1" />
          {startTime && <LiveDuration startTime={startTime} />}
        </div>
        {/* Shimmer bar */}
        <div className="mx-3 mb-2.5 h-1.5 rounded-full thinking-shimmer" />
      </div>
    );
  }

  // Completed thinking (expandable)
  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full py-1.5 px-1 text-xs cursor-pointer transition-colors rounded"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(14, 124, 123, 0.04)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <BrainCircuit
          size={14}
          className="shrink-0"
          style={{ color: 'var(--color-accent)' }}
        />
        <span>Thought for a moment</span>
        <span className="flex-1" />
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
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
              className="px-3 pb-3 text-xs italic max-h-[300px] overflow-y-auto"
              style={{
                fontFamily: M,
                color: 'var(--color-text-tertiary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: 'rgba(14, 124, 123, 0.02)',
                borderLeft: '2px solid rgba(14, 124, 123, 0.15)',
                marginLeft: 2,
                paddingLeft: 12,
                paddingTop: 8,
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
