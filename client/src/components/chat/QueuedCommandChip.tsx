import { Clock } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7.1 — queued-command renderer. `attachment.type: queued_command`
// records land here. Amber accent + Clock icon; command preview
// truncated to 80 chars for density.
//
// NB: no "Dispatched" transition in v1. The JSONL record carries the
// queued payload but NOT a subsequent "this was dispatched" event —
// the dispatched command surfaces as a normal user/assistant turn
// later in the transcript. Pairing the queued record to its dispatched
// counterpart would require text-matching across records and was out
// of scope for 7.1. If Jose asks for a "Dispatched" state, it's a 7.2
// candidate — flagged in PHASE_REPORT.

interface QueuedCommandChipProps {
  prompt: string;
  commandMode?: string;
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

export const QueuedCommandChip = ({ prompt, commandMode }: QueuedCommandChipProps) => {
  const preview = truncate(prompt.trim(), 80);
  const modeSuffix = commandMode && commandMode !== 'prompt' ? ` · ${commandMode}` : '';

  return (
    <div
      className="mx-3 mt-0.5 mb-1 inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px]"
      style={{
        fontFamily: M,
        background: 'rgba(234, 179, 8, 0.06)',
        border: '1px solid rgba(234, 179, 8, 0.2)',
        color: 'var(--color-text-secondary)',
        maxWidth: '100%',
      }}
      title={prompt}
    >
      <Clock size={11} style={{ color: 'var(--color-idle)', opacity: 0.85 }} />
      <span
        className="font-medium"
        style={{ color: 'var(--color-idle)' }}
      >
        Queued{modeSuffix}
      </span>
      <span
        className="truncate"
        style={{ color: 'var(--color-text-tertiary)', maxWidth: 360 }}
      >
        {preview}
      </span>
    </div>
  );
};
