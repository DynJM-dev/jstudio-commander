import { useState } from 'react';
import { FileText, ChevronRight } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 15.1-G — renderer for the post-compact synthetic summary
// Claude Code injects after every compaction.
//
// Raw JSONL shape: `type: 'user'`, `role: 'user'`, `isCompactSummary:
// true`. Pre-fix it rendered with the JB crown icon as if Jose sent
// the "This session is being continued..." message. The parser now
// routes `isCompactSummary` records to a `compact_summary` system
// block (authoritative structured discriminator per §24.2 — not
// text-pattern matching on the summary prose). This component is
// the SystemNote variant renderer.
//
// Visually: muted chip with compact accent color so it reads as a
// continuation marker tied to the preceding `compact_boundary`
// banner. Click-to-expand reveals the full summary text.

interface CompactSummaryNoteProps {
  text: string;
}

export const CompactSummaryNote = ({ text }: CompactSummaryNoteProps) => {
  const [expanded, setExpanded] = useState(false);

  const accent = 'var(--color-accent-light)';
  const bg = 'rgba(14, 124, 123, 0.04)';
  const border = 'rgba(14, 124, 123, 0.15)';

  const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
  const summary = firstLine.slice(0, 90);
  const canExpand = text.trim().length > 0;

  return (
    <div className="mx-3 mt-0.5 mb-1" style={{ fontFamily: M }}>
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
        style={{
          background: bg,
          border: `1px solid ${border}`,
          color: 'var(--color-text-secondary)',
          cursor: canExpand ? 'pointer' : 'default',
          maxWidth: '100%',
        }}
        title={text}
      >
        <FileText size={11} style={{ color: accent, opacity: 0.85 }} />
        <span className="text-[11px] font-medium" style={{ color: accent }}>
          Post-compact summary
        </span>
        {summary && (
          <span
            className="text-[11px] truncate"
            style={{ color: 'var(--color-text-tertiary)', maxWidth: 340 }}
          >
            {summary}
          </span>
        )}
        {canExpand && (
          <ChevronRight
            size={10}
            style={{
              opacity: 0.55,
              transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
              transition: 'transform 140ms ease',
            }}
          />
        )}
      </button>

      {expanded && canExpand && (
        <pre
          className="mt-1 ml-1 p-2 text-[11px] leading-snug whitespace-pre-wrap"
          style={{
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            maxHeight: 420,
            overflow: 'auto',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
};
