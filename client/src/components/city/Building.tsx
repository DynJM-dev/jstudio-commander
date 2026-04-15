import { useNavigate } from 'react-router-dom';
import type { Session } from '@commander/shared';
import { PixelCharacter, roleFor, type CharacterRole } from './PixelCharacter';

interface BuildingProps {
  session: Session;
  teammates: Session[];
  speech?: Map<string, string>;
}

// 6 windows × 4 rows = 24 window slots. We light a deterministic subset
// based on session id so the pattern is stable across renders (no flicker
// from React remounts) and distinct per session.
const WINDOW_COUNT = 24;
const windowPattern = (id: string): boolean[] => {
  // Simple hash — sum char codes, then XOR to spread bits across the mask.
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return Array.from({ length: WINDOW_COUNT }, (_, i) => {
    const bit = (h ^ (h >>> (i % 16))) & (1 << (i % 8));
    return bit !== 0;
  });
};

export const Building = ({ session, teammates, speech }: BuildingProps) => {
  const navigate = useNavigate();
  const role = roleFor(session.agentRole);
  const buildingRole: CharacterRole = session.sessionType === 'pm' ? 'pm' : role;
  const windows = windowPattern(session.id);
  const isStopped = session.status === 'stopped';
  const isWorking = session.status === 'working';

  // Characters to show inside: the session itself + its teammates, capped
  // to 3 to avoid overflow in a 128px-wide building.
  const occupants = [session, ...teammates].slice(0, 3);

  const cls = [
    'city-building',
    `city-building--${buildingRole}`,
    isStopped ? 'city-building--stopped' : '',
    isWorking ? 'city-building--working' : '',
  ].filter(Boolean).join(' ');

  const roleLabel = session.sessionType === 'pm' ? 'PM' : (session.agentRole ?? 'session').toUpperCase();

  return (
    <div
      className={cls}
      onClick={() => navigate(`/chat/${session.id}`)}
      title={`${session.name} — click to open`}
    >
      <div className="city-windows">
        {windows.map((on, i) => (
          <div
            key={i}
            className={`city-window ${on && !isStopped ? 'city-window--on' : ''}`}
          />
        ))}
      </div>
      <div className="city-offices">
        {occupants.map((occ) => (
          <PixelCharacter
            key={occ.id}
            role={occ === session ? buildingRole : roleFor(occ.agentRole)}
            status={occ.status}
            name={occ.name}
            speech={speech?.get(occ.id)}
          />
        ))}
      </div>
      <div className="city-sign">
        <span className="city-sign-name">{session.name}</span>
        <span className="city-sign-role">{roleLabel}</span>
      </div>
    </div>
  );
};
