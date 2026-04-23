import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { agentRuns } from '../db/schema';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out';

export interface AgentRunRow {
  id: string;
  taskId: string;
  agentId: string | null;
  sessionId: string | null;
  status: AgentRunStatus;
  startedAt: string | null;
  endedAt: string | null;
  exitReason: string | null;
  worktreePath: string | null;
  tokensUsed: number;
  wallClockSeconds: number;
}

/**
 * N2 stub: accept the call, INSERT row at `queued`, return the row. Real
 * PTY spawn + worktree creation lands in N3 — this primitive exists so
 * external MCP callers have a stable surface to queue runs against, and so
 * the UI can show a "queued" state before N3 flips it to `running`.
 */
export async function queueAgentRun(
  db: CommanderDb,
  args: { taskId: string; agentId?: string },
): Promise<AgentRunRow> {
  const id = randomUUID();
  await db.insert(agentRuns).values({
    id,
    taskId: args.taskId,
    agentId: args.agentId ?? null,
    status: 'queued',
  });
  const row = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, id) });
  if (!row) throw new Error(`agent_run insert for id=${id} returned no row`);
  return row as AgentRunRow;
}

/**
 * N2 stub: UPDATE the row to `cancelled`. N3 adds the PTY SIGTERM → SIGKILL
 * grace window + worktree cleanup.
 */
export async function cancelAgentRun(db: CommanderDb, id: string): Promise<AgentRunRow | null> {
  await db
    .update(agentRuns)
    .set({
      status: 'cancelled',
      endedAt: new Date().toISOString(),
      exitReason: 'cancelled-by-caller (N2 stub)',
    })
    .where(eq(agentRuns.id, id));
  const row = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, id) });
  return (row as AgentRunRow | undefined) ?? null;
}

export async function getAgentRunById(db: CommanderDb, id: string): Promise<AgentRunRow | null> {
  const row = await db.query.agentRuns.findFirst({ where: eq(agentRuns.id, id) });
  return (row as AgentRunRow | undefined) ?? null;
}
