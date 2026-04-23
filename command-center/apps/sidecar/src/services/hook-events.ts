import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { hookEvents } from '../db/schema';

export interface HookEventRow {
  id: string;
  sessionId: string;
  eventName: string;
  timestamp: string;
  payloadJson: unknown;
}

/**
 * De-dupe contract (KB-P4.3): same `(session_id, event_uuid)` tuple arriving
 * twice MUST produce exactly one `hook_events` row. N1 schema keys by `id`
 * (the row PK) not `(session_id, event_uuid)`, so we scan — OK at N2 volume;
 * N3+ adds a unique index if cardinality grows. Returns `null` when the
 * event already exists; the caller treats that as "idempotent pass-through,
 * skip the rest of the pipeline."
 */
export async function insertIfNew(
  db: CommanderDb,
  args: {
    sessionId: string;
    eventName: string;
    eventUuid: string;
    payload: unknown;
    timestamp?: string;
  },
): Promise<HookEventRow | null> {
  // Pre-scan for (session_id, event_uuid) duplicate. `event_uuid` lives inside
  // the JSON payload; we derive it and store as the row `id` so the PK itself
  // becomes the de-dupe gate. If the row exists, bail.
  const { sessionId, eventName, eventUuid, payload } = args;
  const rowId = `${sessionId}:${eventUuid}`;

  const existing = await db.query.hookEvents.findFirst({
    where: eq(hookEvents.id, rowId),
  });
  if (existing) return null;

  const timestamp = args.timestamp ?? new Date().toISOString();
  await db.insert(hookEvents).values({
    id: rowId,
    sessionId,
    eventName,
    timestamp,
    payloadJson: payload,
  });

  return {
    id: rowId,
    sessionId,
    eventName,
    timestamp,
    payloadJson: payload,
  };
}

/**
 * Extract or mint an event_uuid. Claude Code 2.x may carry one in the payload
 * under `uuid` or `event_uuid`; otherwise we mint a fresh one. Either way,
 * the value is stable per (session, event) and drives the de-dupe PK above.
 */
export function eventUuidOf(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (typeof p.uuid === 'string' && p.uuid.length > 0) return p.uuid;
    if (typeof p.event_uuid === 'string' && p.event_uuid.length > 0) return p.event_uuid;
  }
  return randomUUID();
}

/** Most recent N events, newest first. Used by /api/recent-events for the Debug tab. */
export async function recentHookEvents(
  db: CommanderDb,
  opts: { limit?: number; sinceIso?: string } = {},
): Promise<HookEventRow[]> {
  const limit = opts.limit ?? 50;
  const rows = opts.sinceIso
    ? await db.query.hookEvents.findMany({
        where: gte(hookEvents.timestamp, opts.sinceIso),
        orderBy: [desc(hookEvents.timestamp)],
        limit,
      })
    : await db.query.hookEvents.findMany({
        orderBy: [desc(hookEvents.timestamp)],
        limit,
      });
  return rows as HookEventRow[];
}

/** Single most recent event (for the "Replay last event" debug button). */
export async function lastHookEvent(db: CommanderDb): Promise<HookEventRow | null> {
  const rows = await db.query.hookEvents.findMany({
    orderBy: [desc(hookEvents.timestamp)],
    limit: 1,
  });
  return (rows[0] as HookEventRow | undefined) ?? null;
}

/**
 * Tuple-check variant for tests: does this (session_id, event_uuid) pair
 * already exist? Used by integration tests to assert de-dupe blocks re-writes.
 */
export async function hookEventExists(
  db: CommanderDb,
  sessionId: string,
  eventUuid: string,
): Promise<boolean> {
  const rowId = `${sessionId}:${eventUuid}`;
  const row = await db.query.hookEvents.findFirst({ where: eq(hookEvents.id, rowId) });
  return !!row;
}

export async function countHookEvents(
  db: CommanderDb,
  filter?: { sessionId?: string; eventName?: string },
): Promise<number> {
  if (!filter || (!filter.sessionId && !filter.eventName)) {
    const all = await db.query.hookEvents.findMany({ columns: { id: true } });
    return all.length;
  }
  const conds = [] as ReturnType<typeof eq>[];
  if (filter.sessionId) conds.push(eq(hookEvents.sessionId, filter.sessionId));
  if (filter.eventName) conds.push(eq(hookEvents.eventName, filter.eventName));
  const where = conds.length === 1 ? conds[0] : and(...conds);
  const rows = await db.query.hookEvents.findMany({ columns: { id: true }, where });
  return rows.length;
}
