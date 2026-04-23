import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { tasks } from '../db/schema';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

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
