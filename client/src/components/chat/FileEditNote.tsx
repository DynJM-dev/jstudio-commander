import { useState } from 'react';
import { FileText, ChevronRight, PenTool } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7.1 — upgrade from the Issue 7 system_note banner. Renders
// `edited_text_file` attachments as a typed card with filename +
// click-to-expand post-edit snippet.
//
// Decision (documented in PHASE_REPORT): built a LIGHTER renderer
// specific to this shape rather than reusing `RenderEditContent`
// from ToolCallBlock. `RenderEditContent` expects `old_string` +
// `new_string` from an Edit tool_use's input; the JSONL record for
// `edited_text_file` carries only a post-edit `snippet` (numbered
// lines, no diff pair). Lifting RenderEditContent would require
// synthesizing the pre-edit state we don't have; the lighter
// renderer avoids that coupling.

interface FileEditNoteProps {
  filename: string;
  snippet?: string;
}

// Middle-truncate a path so the most recent (rightmost) segments stay
// visible: `/Users/.../codeman-cases/JLFamily/apps/.../foo.ts`. At ~60
// chars we fold the middle out.
const truncatePath = (full: string, max = 60): string => {
  if (full.length <= max) return full;
  const head = full.slice(0, Math.floor(max / 2) - 2);
  const tail = full.slice(full.length - (Math.floor(max / 2) - 2));
  return `${head}…${tail}`;
};

const basename = (full: string): string => {
  const idx = full.lastIndexOf('/');
  return idx >= 0 ? full.slice(idx + 1) : full;
};

export const FileEditNote = ({ filename, snippet }: FileEditNoteProps) => {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(snippet && snippet.trim().length > 0);
  const name = basename(filename);
  const path = truncatePath(filename);
  const lineCount = snippet ? snippet.split('\n').filter((l) => l.trim().length > 0).length : 0;

  return (
    <div className="mx-3 mt-0.5 mb-1" style={{ fontFamily: M }}>
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
        style={{
          background: 'rgba(14, 124, 123, 0.06)',
          border: '1px solid rgba(14, 124, 123, 0.15)',
          color: 'var(--color-text-secondary)',
          cursor: canExpand ? 'pointer' : 'default',
          maxWidth: '100%',
        }}
        title={filename}
      >
        <PenTool size={11} style={{ color: 'var(--color-accent-light)', opacity: 0.85 }} />
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-accent-light)' }}>
          Edited
        </span>
        <FileText size={10} style={{ color: 'var(--color-text-tertiary)', opacity: 0.7 }} />
        <span
          className="text-[11px] font-mono-stats truncate"
          style={{ color: 'var(--color-text-primary)', maxWidth: 360 }}
        >
          {name}
        </span>
        {path !== name && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {path.replace(name, '').replace(/\/$/, '')}
          </span>
        )}
        {canExpand && lineCount > 0 && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {lineCount} lines
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

      {expanded && snippet && (
        <pre
          className="mt-1 ml-1 p-2 text-[11px] leading-snug whitespace-pre-wrap"
          style={{
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {snippet}
        </pre>
      )}
    </div>
  );
};
