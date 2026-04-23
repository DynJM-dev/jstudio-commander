import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { agentRuns, tasks } from '../db/schema';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

export interface TaskRow {
  id: string;
  projectId: string;
  title: string;
  instructionsMd: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export async function listTasksByProject(db: CommanderDb, projectId: string): Promise<TaskRow[]> {
  const rows = await db.query.tasks.findMany({
    where: eq(tasks.projectId, projectId),
    orderBy: [desc(tasks.updatedAt)],
  });
  return rows as TaskRow[];
}

/**
 * List ALL tasks across projects, optionally filtered by status + projectId.
 * Kanban (N4) queries without projectId filter for a cross-project view when
 * workspace switching isn't yet wired (N4b). Newest-updated first.
 */
export async function listAllTasks(
  db: CommanderDb,
  opts: { status?: TaskStatus; projectId?: string } = {},
): Promise<TaskRow[]> {
  const clauses = [];
  if (opts.status) clauses.push(eq(tasks.status, opts.status));
  if (opts.projectId) clauses.push(eq(tasks.projectId, opts.projectId));
  const where =
    clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : and(...clauses);
  const rows = await db.query.tasks.findMany({
    where,
    orderBy: [desc(tasks.updatedAt)],
  });
  return rows as TaskRow[];
}

export interface TaskWithLatestRun extends TaskRow {
  latestRun: {
    id: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    exitReason: string | null;
    wallClockSeconds: number;
    tokensUsed: number;
  } | null;
}

/**
 * Tasks joined with their latest agent_run — kanban card payload.
 * Latest = highest `id` for the task_id (UUIDv4 isn't temporally sortable in
 * general, but agent_runs id is inserted strictly monotonically within a
 * single-writer process; for rigor we sort by `started_at DESC NULLS LAST,
 * id DESC`). Done as N+1 per task on purpose: Drizzle's nested-query surface
 * keeps the two-step explicit and readable. Task count stays small (O(100s)
 * single-user); O(tasks × 1) queries is fine.
 */
export async function listTasksWithLatestRun(
  db: CommanderDb,
  opts: { status?: TaskStatus; projectId?: string } = {},
): Promise<TaskWithLatestRun[]> {
  const taskRows = await listAllTasks(db, opts);
  const out: TaskWithLatestRun[] = [];
  for (const t of taskRows) {
    const run = await db.query.agentRuns.findFirst({
      where: eq(agentRuns.taskId, t.id),
      orderBy: [desc(agentRuns.startedAt), desc(agentRuns.id)],
    });
    out.push({
      ...t,
      latestRun: run
        ? {
            id: run.id,
            status: run.status,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
            exitReason: run.exitReason,
            wallClockSeconds: run.wallClockSeconds,
            tokensUsed: run.tokensUsed,
          }
        : null,
    });
  }
  return out;
}

export async function createTask(
  db: CommanderDb,
  args: { projectId: string; title: string; instructionsMd: string; status?: TaskStatus },
): Promise<TaskRow> {
  const id = randomUUID();
  await db.insert(tasks).values({
    id,
    projectId: args.projectId,
    title: args.title,
    instructionsMd: args.instructionsMd,
    status: args.status ?? 'todo',
  });
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  if (!row) throw new Error(`task insert for id=${id} returned no row`);
  return row as TaskRow;
}

export async function updateTask(
  db: CommanderDb,
  id: string,
  patch: Partial<Pick<TaskRow, 'title' | 'instructionsMd' | 'status'>>,
): Promise<TaskRow | null> {
  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.instructionsMd !== undefined) updates.instructionsMd = patch.instructionsMd;
  if (patch.status !== undefined) updates.status = patch.status;

  await db.update(tasks).set(updates).where(eq(tasks.id, id));
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  return (row as TaskRow | undefined) ?? null;
}

export async function getTaskById(db: CommanderDb, id: string): Promise<TaskRow | null> {
  const row = await db.query.tasks.findFirst({ where: eq(tasks.id, id) });
  return (row as TaskRow | undefined) ?? null;
}
