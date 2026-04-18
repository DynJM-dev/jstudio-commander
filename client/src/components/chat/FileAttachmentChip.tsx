import { useState } from 'react';
import { FileText, ChevronRight, FileCode, FileJson, FileSpreadsheet, File } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7 P1 — user-attached file chip. Compact row with filename +
// type-derived icon + a line-count hint. Click expands the inlined
// content preview (if shipped in the attachment) in a monospace
// scroll box. Files without content render as show-only.

interface FileAttachmentChipProps {
  filename: string;
  displayPath: string;
  numLines?: number;
  totalLines?: number;
  content?: string;
}

const iconFor = (path: string): LucideIcon => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'sh'].includes(ext)) return FileCode;
  if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return FileJson;
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return FileSpreadsheet;
  if (['md', 'txt', 'rst'].includes(ext)) return FileText;
  return File;
};

export const FileAttachmentChip = ({
  filename,
  displayPath,
  numLines,
  totalLines,
  content,
}: FileAttachmentChipProps) => {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconFor(filename);
  const canExpand = Boolean(content && content.trim().length > 0);
  const lineSummary = totalLines && numLines
    ? `${numLines}/${totalLines} lines`
    : totalLines
      ? `${totalLines} lines`
      : numLines
        ? `${numLines} lines`
        : null;

  return (
    <div className="mx-3 mt-0.5 mb-1" style={{ fontFamily: M }}>
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
        style={{
          background: 'rgba(14,124,123,0.06)',
          border: '1px solid rgba(14,124,123,0.15)',
          color: 'var(--color-text-secondary)',
          cursor: canExpand ? 'pointer' : 'default',
        }}
        title={filename}
      >
        <Icon size={12} style={{ color: 'var(--color-accent-light)' }} />
        <span
          className="text-xs font-mono-stats truncate max-w-[320px]"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {displayPath}
        </span>
        {lineSummary && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {lineSummary}
          </span>
        )}
        {canExpand && (
          <ChevronRight
            size={10}
            style={{
              opacity: 0.6,
              transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
              transition: 'transform 140ms ease',
            }}
          />
        )}
      </button>

      {expanded && content && (
        <pre
          className="mt-1 ml-1 p-2 text-[11px] leading-snug whitespace-pre-wrap"
          style={{
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {content}
        </pre>
      )}
    </div>
  );
};
