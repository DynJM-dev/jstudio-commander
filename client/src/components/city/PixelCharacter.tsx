import type { SessionStatus } from '@commander/shared';

export type CharacterRole = 'coder' | 'pm' | 'qa' | 'security' | 'generic';

interface PixelCharacterProps {
  role: CharacterRole;
  status: SessionStatus;
  name?: string;
  speech?: string;
}

// Map raw Claude-Code roles / team lanes to our palette. Anything unknown
// falls to 'generic' (teal) so new roles don't require a code change to
// render correctly — they just get the default color.
export const roleFor = (agentRole: string | null | undefined): CharacterRole => {
  const r = (agentRole ?? '').toLowerCase();
  if (r.includes('coder')) return 'coder';
  if (r.includes('pm') || r.includes('lead') || r.includes('director')) return 'pm';
  if (r.includes('qa') || r.includes('test')) return 'qa';
  if (r.includes('security') || r.includes('sec')) return 'security';
  return 'generic';
};

const statusClass = (status: SessionStatus): string => {
  if (status === 'working') return 'city-character--working';
  if (status === 'waiting') return 'city-character--waiting';
  if (status === 'stopped') return 'city-character--stopped';
  return '';
};

export const PixelCharacter = ({ role, status, name, speech }: PixelCharacterProps) => {
  const cls = ['city-character', `city-char--${role}`, statusClass(status)]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} title={name ? `${name} · ${status}` : status}>
      {status === 'waiting' && <div className="city-char-bang">!</div>}
      {speech && <div className="city-char-speech">{speech}</div>}
      <div className="city-char-head" />
      <div className="city-char-body" />
      <div className="city-char-desk" />
    </div>
  );
};
