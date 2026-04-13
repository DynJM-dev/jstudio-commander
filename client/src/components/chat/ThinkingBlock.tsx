import { useState } from 'react';
import { BrainCircuit, ChevronRight, ChevronDown } from 'lucide-react';

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
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
      >
        <BrainCircuit size={14} />
        <span>Extended thinking (redacted)</span>
      </div>
    );
  }

  return (
    <div className="my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1.5 text-sm italic cursor-pointer transition-colors"
        style={{ color: 'var(--color-text-tertiary)', fontFamily: M }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
      >
        <BrainCircuit size={14} />
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>Thinking...</span>
      </button>

      {expanded && (
        <div
          className="rounded-lg p-3 mt-1 text-sm italic max-h-[300px] overflow-y-auto"
          style={{
            fontFamily: M,
            background: 'rgba(0, 0, 0, 0.15)',
            color: 'var(--color-text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};
