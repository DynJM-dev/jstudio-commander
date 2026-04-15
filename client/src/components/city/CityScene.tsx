import { useEffect, useMemo, useState } from 'react';
import type { Session, WSEvent } from '@commander/shared';
import { Building } from './Building';
import { useWebSocket } from '../../hooks/useWebSocket';

interface CitySceneProps {
  sessions: Session[];
}

// Pause animations when the tab isn't visible. Cheapest possible
// visibility gate — CSS does the rest via the city-running class.
const usePageVisible = (): boolean => {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden
  );
  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
  return visible;
};

// Transient speech bubbles driven by WS events. Clears each after 3s so
// the city doesn't accumulate stale chatter.
const SPEECH_TTL_MS = 3000;
const SAMPLE_SPEECH = [
  '...', 'working', 'hmm', 'shipping', 'ok', 'brb', 'thinking', 'got it',
];

const pickSpeech = (event: WSEvent): string | null => {
  if (event.type === 'teammate:spawned') return 'hi 👋';
  if (event.type === 'teammate:dismissed') return 'bye';
  if (event.type === 'session:status' && event.status === 'working') {
    return SAMPLE_SPEECH[Math.floor(Math.random() * SAMPLE_SPEECH.length)]!;
  }
  if (event.type === 'chat:message') return '...';
  return null;
};

export const CityScene = ({ sessions }: CitySceneProps) => {
  const visible = usePageVisible();
  const { lastEvent } = useWebSocket();
  const [speech, setSpeech] = useState<Map<string, string>>(() => new Map());

  // Wire WS events to speech bubbles with auto-expire.
  useEffect(() => {
    if (!lastEvent) return;
    const ev = lastEvent as WSEvent & { sessionId?: string };
    const sessionId = ev.sessionId ?? ('id' in ev ? (ev as { id?: string }).id : undefined);
    if (!sessionId) return;
    const line = pickSpeech(ev);
    if (!line) return;
    setSpeech((prev) => {
      const next = new Map(prev);
      next.set(sessionId, line);
      return next;
    });
    const t = setTimeout(() => {
      setSpeech((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Map(prev);
        next.delete(sessionId);
        return next;
      });
    }, SPEECH_TTL_MS);
    return () => clearTimeout(t);
  }, [lastEvent]);

  // Group sessions: top-level parents + their teammates. Stopped parents
  // are still shown as darkened buildings for a 5-minute fade window so
  // the city doesn't feel like it empties instantly on a session death.
  const { topLevel, teammatesByParent } = useMemo(() => {
    const byId = new Map<string, Session>();
    const byClaude = new Map<string, Session>();
    for (const s of sessions) {
      byId.set(s.id, s);
      if (s.claudeSessionId) byClaude.set(s.claudeSessionId, s);
    }
    const childIds = new Set<string>();
    const childrenOf = new Map<string, Session[]>();
    for (const s of sessions) {
      if (!s.parentSessionId) continue;
      const parent = byId.get(s.parentSessionId) ?? byClaude.get(s.parentSessionId);
      if (!parent) continue;
      childIds.add(s.id);
      const bucket = childrenOf.get(parent.id) ?? [];
      bucket.push(s);
      childrenOf.set(parent.id, bucket);
    }
    const top = sessions
      .filter((s) => !childIds.has(s.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { topLevel: top, teammatesByParent: childrenOf };
  }, [sessions]);

  const sceneCls = ['city-scene', visible ? 'city-running' : ''].filter(Boolean).join(' ');

  return (
    <div className={sceneCls}>
      <div className="city-stars" />
      <div className="city-horizon" />
      <div className="city-street" />
      {topLevel.length === 0 ? (
        <div className="city-empty">
          <span>No sessions in the city yet.</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Create a session to light up the skyline.</span>
        </div>
      ) : (
        <div className="city-buildings">
          {topLevel.map((s) => (
            <Building
              key={s.id}
              session={s}
              teammates={teammatesByParent.get(s.id) ?? []}
              speech={speech}
            />
          ))}
        </div>
      )}
    </div>
  );
};
