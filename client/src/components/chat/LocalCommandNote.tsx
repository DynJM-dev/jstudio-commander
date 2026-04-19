import { useState } from 'react';
import { Terminal, ChevronRight, AlertCircle } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 9 Part 3 — typed renderer for `system.subtype: local_command`
// records (slash commands like `/status`, `/compact`, `/login`).
// Muted inline chip in line with Issue 7's attachment chips; click
// to expand the full stdout/stderr payload in a monospace block.
//
// stderr gets an error-red accent + AlertCircle to distinguish from
// informational stdout. No attempt is made to parse per-command
// outputs — the chip just shows the stream kind + click-to-expand
// preview. The preceding user message already carries the command
// name (e.g. `/status`).

interface LocalCommandNoteProps {
  stream: 'stdout' | 'stderr';
  text: string;
}

export const LocalCommandNote = ({ stream, text }: LocalCommandNoteProps) => {
  const [expanded, setExpanded] = useState(false);
  const isErr = stream === 'stderr';

  const accent = isErr ? 'var(--color-error)' : 'var(--color-accent-light)';
  const bg = isErr ? 'rgba(239, 68, 68, 0.06)' : 'rgba(14, 124, 123, 0.04)';
  const border = isErr ? 'rgba(239, 68, 68, 0.2)' : 'rgba(14, 124, 123, 0.15)';

  // Short one-line summary for collapsed state. Strip leading
  // `Error:` when it's stderr so the chip doesn't say "stderr · Error:
  // something" (redundant). First line only, trimmed to ~80 chars.
  const firstLine = text.split('\n', 1)[0]?.trim() ?? '';
  const summary = (isErr ? firstLine.replace(/^Error:\s*/i, '') : firstLine).slice(0, 80);

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
        {isErr ? (
          <AlertCircle size={11} style={{ color: accent, opacity: 0.85 }} />
        ) : (
          <Terminal size={11} style={{ color: accent, opacity: 0.85 }} />
        )}
        <span className="text-[11px] font-medium" style={{ color: accent }}>
          Local command · {stream}
        </span>
        {summary && (
          <span
            className="text-[11px] truncate"
            style={{ color: 'var(--color-text-tertiary)', maxWidth: 320 }}
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
            color: isErr ? 'var(--color-error)' : 'var(--color-text-secondary)',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {text}
        </pre>
      )}
    </div>
  );
};
