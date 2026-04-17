import { useMemo } from 'react';
import type { Session } from '@commander/shared';

// #221 — single source of truth for the parent → teammates derivation.
// SessionsPage and CityScene both render the same tree shape from the
// same `useSessions()` list, so a status WS event used to retrigger the
// derivation on every consumer's render. With this hook each consumer
// shares one memo per render.
//
// Sessions link to parents by either Commander UUID (parentSessionId
// matches another session.id) or by Claude's leadSessionId (matches
// claudeSessionId on a Commander row) — match both forms so the tree
// holds either way.

export interface SessionTree {
  topLevel: Session[];
  teammatesByParent: Map<string, Session[]>;
}

export const buildSessionTree = (sessions: Session[]): SessionTree => {
  const byCommanderId = new Map<string, Session>();
  const byClaudeId = new Map<string, Session>();
  for (const s of sessions) {
    byCommanderId.set(s.id, s);
    if (s.claudeSessionId) byClaudeId.set(s.claudeSessionId, s);
  }

  const childIds = new Set<string>();
  const childrenOf = new Map<string, Session[]>();

  for (const s of sessions) {
    if (!s.parentSessionId) continue;
    const parent = byCommanderId.get(s.parentSessionId) ?? byClaudeId.get(s.parentSessionId);
    if (!parent) continue;
    childIds.add(s.id);
    const bucket = childrenOf.get(parent.id) ?? [];
    bucket.push(s);
    childrenOf.set(parent.id, bucket);
  }

  const topLevel = sessions
    .filter((s) => !childIds.has(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Sort each bucket by role then name for stable rendering.
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => (a.agentRole ?? '').localeCompare(b.agentRole ?? '') || a.name.localeCompare(b.name));
  }

  return { topLevel, teammatesByParent: childrenOf };
};

export const useSessionTree = (sessions: Session[]): SessionTree => {
  return useMemo(() => buildSessionTree(sessions), [sessions]);
};
