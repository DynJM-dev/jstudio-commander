import type { EffortLevel, Session } from '@commander/shared';

// M8 — pure helpers for the SessionCard click-to-adjust effort affordance.
// Extracted so the API-call-shape contract and the badge-visibility
// predicate are unit-testable without mounting React (this codebase's
// node:test + tsx harness has no JSDOM renderer).
//
// Call-shape helpers mirror the API body and URL used inline in the
// `changeEffort` callback in SessionCard.tsx. They carry the dispatch
// test 3 contract: "selecting a level triggers a POST to
// /sessions/:id/command with body { command: '/effort <level>' }".

export const effortCommandPath = (sessionId: string): string =>
  `/sessions/${sessionId}/command`;

export const effortCommandBody = (level: EffortLevel): { command: string } => ({
  command: `/effort ${level}`,
});

export const effortPatchPath = (sessionId: string): string =>
  `/sessions/${sessionId}`;

export const effortPatchBody = (level: EffortLevel): { effortLevel: EffortLevel } => ({
  effortLevel: level,
});

// Render predicate: badge appears only when `session.effortLevel` is set.
// Mirrors the current DOM conditional (`{session.effortLevel && …}`) which
// treats missing/empty values as falsy; extracted so non-regression can
// be pinned without DOM. Accepts any nullish shape the runtime might
// deliver (the shared Session type declares EffortLevel non-null, but
// SessionCard's current code defends with a truthy-check, so the helper
// mirrors that defensive posture).
export const shouldRenderEffortBadge = (session: {
  effortLevel?: EffortLevel | null | '';
}): boolean => Boolean(session.effortLevel);
