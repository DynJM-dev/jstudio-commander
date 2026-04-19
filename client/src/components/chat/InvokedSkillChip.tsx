import { Sparkles } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7.1 — inline skill invocation marker. Rendered at the
// chronological point the JSONL emitted the `invoked_skills` record,
// NOT grouped at the top of the session. Chronology is the signal —
// knowing "Claude invoked /ui-expert RIGHT after that tool_use" is
// what tells Jose what happened when. Grouping at top would destroy
// that.
//
// Decision (documented in PHASE_REPORT): inline placement. Lighter
// visual weight than tool_use cards (chip, not card) so skill
// invocations read as annotations on the turn, not tool calls.

interface InvokedSkillChipProps {
  skills: Array<{ name: string; path?: string }>;
}

export const InvokedSkillChip = ({ skills }: InvokedSkillChipProps) => {
  if (skills.length === 0) return null;
  const names = skills.map((s) => `/${s.name}`).join(' · ');

  return (
    <div
      className="mx-3 mt-0.5 mb-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px]"
      style={{
        fontFamily: M,
        background: 'rgba(168, 85, 247, 0.04)',
        border: '1px solid rgba(168, 85, 247, 0.15)',
        color: 'var(--color-text-tertiary)',
      }}
      title={skills.map((s) => (s.path ? `/${s.name} (${s.path})` : `/${s.name}`)).join('\n')}
    >
      <Sparkles size={10} style={{ color: '#A855F7', opacity: 0.85 }} />
      <span style={{ color: '#A855F7' }}>
        Using {names}
      </span>
    </div>
  );
};
