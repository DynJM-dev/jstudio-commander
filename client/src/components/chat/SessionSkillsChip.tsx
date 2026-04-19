import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';

const M = 'Montserrat, sans-serif';

// Issue 7.1 — session-start skill manifest renderer. `attachment.type:
// skill_listing` records land here. Collapsed: "Loaded N skills" summary.
// Expanded: name + description per skill.
//
// Positioning: rendered inline at the point the JSONL emitted it (same
// chronological position as any other record). Claude Code always
// sends this at or near session start, so it naturally appears at the
// top of the chat view without extra layout logic.

interface SessionSkillsChipProps {
  skills: Array<{ name: string; description?: string }>;
  isInitial: boolean;
}

export const SessionSkillsChip = ({ skills, isInitial }: SessionSkillsChipProps) => {
  const [expanded, setExpanded] = useState(false);
  if (skills.length === 0) return null;

  const label = isInitial ? 'Loaded' : 'Skills refreshed';
  const count = skills.length;

  return (
    <div className="mx-3 mt-0.5 mb-1" style={{ fontFamily: M }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
        style={{
          background: 'rgba(168, 85, 247, 0.06)',
          border: '1px solid rgba(168, 85, 247, 0.18)',
          color: 'var(--color-text-secondary)',
          maxWidth: '100%',
        }}
        title={`${count} skill${count === 1 ? '' : 's'} available this session`}
      >
        <Sparkles size={11} style={{ color: '#A855F7', opacity: 0.85 }} />
        <span className="text-[11px] font-medium" style={{ color: '#A855F7' }}>
          {label} {count} {count === 1 ? 'skill' : 'skills'}
        </span>
        {!expanded && skills.length <= 6 && (
          <span
            className="text-[11px] truncate"
            style={{ color: 'var(--color-text-tertiary)', maxWidth: 360 }}
          >
            {skills.map((s) => `/${s.name}`).join(' · ')}
          </span>
        )}
        <ChevronRight
          size={10}
          style={{
            opacity: 0.55,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0)',
            transition: 'transform 140ms ease',
          }}
        />
      </button>

      {expanded && (
        <ul
          className="mt-1 ml-1 p-2 rounded-md"
          style={{
            background: 'rgba(0, 0, 0, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            listStyle: 'none',
            maxHeight: 320,
            overflow: 'auto',
          }}
        >
          {skills.map((s) => (
            <li key={s.name} className="py-0.5 text-[11px] leading-snug">
              <span
                className="font-mono-stats"
                style={{ color: '#A855F7' }}
              >
                /{s.name}
              </span>
              {s.description && (
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {' '}— {s.description.length > 120 ? `${s.description.slice(0, 117)}...` : s.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
