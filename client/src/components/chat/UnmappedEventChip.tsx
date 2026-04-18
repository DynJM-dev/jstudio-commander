import { useState } from 'react';
import { AlertCircle, ChevronRight } from 'lucide-react';
import type { UnmappedKind } from '@commander/shared';

const M = 'Montserrat, sans-serif';

// Issue 5 — the debug placeholder chip.
//
// Rendered whenever the parser (or a render-layer fallback) encounters
// a record shape that has no typed renderer branch yet. The existence
// of this chip in the UI is the whole point of the Issue 5 architecture
// lock: the chat pane defaults to render, so novel Claude Code shapes
// surface immediately instead of silently vanishing.
//
// It's deliberately distinct from <SystemNote> / `system_note` blocks
// — those are semantic chat signals (compact boundary, task reminder)
// that the user SHOULD see in the flow. This chip is acknowledgedly a
// debug affordance: muted, collapsible to a raw-payload preview, with
// an alert icon so the user knows "something landed here I can file an
// issue about." If someone reads a chip and files a ticket, that's the
// feature working — the policy trades a tiny permanent UI cost for the
// guarantee that no message type can ever be silently invisible.

interface UnmappedEventChipProps {
  kind: UnmappedKind;
  eventKey: string;
  raw?: string;
}

const KIND_LABELS: Record<UnmappedKind, string> = {
  record_type: 'record type',
  system_subtype: 'system subtype',
  attachment_type: 'attachment',
  assistant_block: 'assistant block',
};

export const UnmappedEventChip = ({ kind, eventKey, raw }: UnmappedEventChipProps) => {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(raw && raw.trim().length > 0);

  return (
    <div
      className="text-xs py-1"
      style={{ fontFamily: M, color: 'var(--color-text-tertiary)' }}
    >
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        disabled={!canExpand}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px dashed rgba(255, 255, 255, 0.1)',
          color: 'var(--color-text-tertiary)',
          cursor: canExpand ? 'pointer' : 'default',
        }}
        aria-expanded={expanded}
      >
        <AlertCircle size={11} style={{ opacity: 0.7 }} />
        <span>
          unmapped {KIND_LABELS[kind]}:{' '}
          <code style={{ fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace' }}>
            {eventKey}
          </code>
        </span>
        {canExpand && (
          <ChevronRight
            size={11}
            style={{
              opacity: 0.6,
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 150ms ease',
            }}
          />
        )}
      </button>

      {expanded && raw && (
        <pre
          className="mt-1 ml-1 p-2 text-[11px] leading-snug whitespace-pre-wrap"
          style={{
            fontFamily: 'JetBrains Mono, SF Mono, Monaco, Menlo, monospace',
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 6,
            color: 'var(--color-text-secondary)',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {raw}
        </pre>
      )}
    </div>
  );
};
