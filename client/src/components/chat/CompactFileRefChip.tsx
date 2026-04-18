import { FileText, History } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7 P2 — post-compaction file reference chip. By design these
// carry no content (compaction drops it); the chip is a historical
// marker so the user can see which files were referenced in the
// pre-compact context window. Visually distinct from
// FileAttachmentChip (live attachment): muted, italic, History icon.

interface CompactFileRefChipProps {
  filename: string;
  displayPath: string;
}

export const CompactFileRefChip = ({ filename, displayPath }: CompactFileRefChipProps) => (
  <div
    className="mx-3 mt-0.5 mb-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs italic"
    style={{
      fontFamily: M,
      background: 'transparent',
      border: '1px dashed rgba(255,255,255,0.08)',
      color: 'var(--color-text-tertiary)',
    }}
    title={`${filename} — referenced from pre-compact context`}
    role="note"
  >
    <History size={10} style={{ opacity: 0.55 }} />
    <FileText size={10} style={{ opacity: 0.55 }} />
    <span
      className="font-mono-stats truncate max-w-[320px]"
      style={{ fontSize: 10 }}
    >
      {displayPath}
    </span>
    <span className="text-[10px]" style={{ opacity: 0.65 }}>
      (referenced from earlier context)
    </span>
  </div>
);
