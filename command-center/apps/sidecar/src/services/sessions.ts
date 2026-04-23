import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { sessions } from '../db/schema';

export interface SessionRow {
  id: string;
  agentRunId: string | null;
  ptyPid: number | null;
  cwd: string;
  claudeSessionId: string | null;
  status: string;
  scrollbackBlob: string | null;
  createdAt: string;
  endedAt: string | null;
}

/**
 * Find or create a session row keyed by the Claude Code `session_id` UUID.
 *
 * Claude Code owns the session_id — it's the JSONL filename UUID and primary
 * cross-session disambiguator per KB-P3.1. Commander mirrors it in the
 * sessions table so downstream work (agent_runs, hook_events FK) has a
 * stable join key.
 */
export async function ensureSessionByClaudeId(
  db: CommanderDb,
  claudeSessionId: string,
  cwd: string,
): Promise<SessionRow> {
  const existing = await db.query.sessions.findFirst({
    where: eq(sessions.id, claudeSessionId),
  });
  if (existing) return existing as SessionRow;

  await db.insert(sessions).values({
    id: claudeSessionId,
    cwd,
    claudeSessionId,
    status: 'initializing',
  });
  const created = await db.query.sessions.findFirst({
    where: eq(sessions.id, claudeSessionId),
  });
  if (!created) throw new Error(`session insert for id=${claudeSessionId} returned no row`);
  return created as SessionRow;
}

export async function updateSessionStatus(
  db: CommanderDb,
  sessionId: string,
  status: string,
): Promise<void> {
  await db.update(sessions).set({ status }).where(eq(sessions.id, sessionId));
}

export async function endSession(db: CommanderDb, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ status: 'done', endedAt: new Date().toISOString() })
    .where(eq(sessions.id, sessionId));
}

export async function listSessions(db: CommanderDb): Promise<SessionRow[]> {
  const rows = await db.query.sessions.findMany({ limit: 200 });
  return rows as SessionRow[];
}

export async function getSessionById(db: CommanderDb, id: string): Promise<SessionRow | null> {
  const row = await db.query.sessions.findFirst({ where: eq(sessions.id, id) });
  return (row as SessionRow | undefined) ?? null;
}

/**
 * Map a hook event name to a session-status transition, if any. Returns null
 * when the event shouldn't change session status (e.g. Notification, tool-use
 * events that are mid-turn).
 */
export function sessionStatusForEvent(eventName: string): string | null {
  switch (eventName) {
    case 'SessionStart':
      return 'initializing';
    case 'UserPromptSubmit':
      return 'working';
    case 'Stop':
      return 'done';
    case 'SessionEnd':
      return 'done';
    default:
      return null;
  }
}
