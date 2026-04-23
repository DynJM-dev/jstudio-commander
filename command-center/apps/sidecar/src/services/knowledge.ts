import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { knowledgeEntries } from '../db/schema';

export interface KnowledgeEntryRow {
  id: string;
  taskId: string;
  agentRunId: string | null;
  agentId: string | null;
  timestamp: string;
  contentMd: string;
  supersededById: string | null;
}

/**
 * KB-P1.3 — knowledge entries are APPEND-ONLY. No UPDATE, no DELETE path.
 * Supersession is represented by pointing a newer entry via `supersededById`;
 * the older entry stays. MCP surface exposes `add_knowledge_entry` only.
 */
export async function appendKnowledge(
  db: CommanderDb,
  args: {
    taskId: string;
    contentMd: string;
    agentId?: string;
    agentRunId?: string;
  },
): Promise<KnowledgeEntryRow> {
  const id = randomUUID();
  await db.insert(knowledgeEntries).values({
    id,
    taskId: args.taskId,
    agentId: args.agentId ?? null,
    agentRunId: args.agentRunId ?? null,
    contentMd: args.contentMd,
  });
  const row = await db.query.knowledgeEntries.findFirst({
    where: eq(knowledgeEntries.id, id),
  });
  if (!row) throw new Error(`knowledge_entry insert for id=${id} returned no row`);
  return row as KnowledgeEntryRow;
}

export async function listKnowledgeByTask(
  db: CommanderDb,
  taskId: string,
): Promise<KnowledgeEntryRow[]> {
  const rows = await db.query.knowledgeEntries.findMany({
    where: eq(knowledgeEntries.taskId, taskId),
    orderBy: [asc(knowledgeEntries.timestamp)],
  });
  return rows as KnowledgeEntryRow[];
}
