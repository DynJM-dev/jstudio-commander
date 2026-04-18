import { Info } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7 P1 — inline footnote rendering for `task_reminder`
// attachments (the `<system-reminder>` block Claude sees inline with
// a user turn). Renders as a tight, muted note rather than a
// standalone banner. Designed to read like a footnote under the
// preceding user prompt.

interface InlineReminderNoteProps {
  text: string;
}

export const InlineReminderNote = ({ text }: InlineReminderNoteProps) => (
  <div
    className="mx-3 mt-0.5 mb-1 rounded-md px-2.5 py-1.5 flex items-start gap-1.5 text-xs italic"
    style={{
      fontFamily: M,
      background: 'rgba(255,255,255,0.02)',
      border: '1px dashed rgba(255,255,255,0.06)',
      color: 'var(--color-text-tertiary)',
    }}
    role="note"
    aria-label="System reminder"
  >
    <Info size={11} className="shrink-0 mt-0.5" style={{ opacity: 0.6 }} />
    <span className="whitespace-pre-wrap break-words leading-snug">{text}</span>
  </div>
);
