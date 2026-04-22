// HTTP /api/sessions* — CRUD surface per ARCHITECTURE_SPEC v1.2 §7.4.
// Routes stay thin; all spawn/input/shutdown logic lives behind the
// SessionOrchestrator interface, which Task 6 implements with PtyManager +
// Task 7's pool + Task 9's bootstrap injector.

import type { FastifyPluginAsync } from 'fastify';
import type { InitializedDb, NewSession } from '@jstudio-commander/db';
import { sessions, projects, sessionTypes } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';
import type {
  SessionTypeId,
  SessionEffort,
  SessionStatus,
} from '@jstudio-commander/shared';
import { EventBus, channelForSession } from '../ws/event-bus.js';

export interface SpawnSessionInput {
  projectPath: string;
  projectName?: string;
  sessionTypeId: SessionTypeId;
  effort: SessionEffort;
  displayName?: string;
  /** Skip launching the client binary + bootstrap injection (tests). */
  skipClientLaunch?: boolean;
}

export interface SpawnedSession {
  id: string;
  projectId: string;
  sessionTypeId: SessionTypeId;
  effort: SessionEffort;
  status: SessionStatus;
  cwd: string;
  ptyPid: number | null;
  createdAt: number;
}

// The SessionOrchestrator is the only surface the HTTP layer touches for
// session lifecycle. Task 6 implements spawnSession() via PtyManager, Task 7
// adds pool claim, Task 9 adds bootstrap injection. The route file never
// changes again once this interface is fixed.
export interface SessionOrchestrator {
  spawnSession(input: SpawnSessionInput): Promise<SpawnedSession>;
  stopSession(sessionId: string): Promise<void>;
  writeInput(sessionId: string, data: string): void;
}

export class UnimplementedOrchestrator implements SessionOrchestrator {
  async spawnSession(): Promise<SpawnedSession> {
    throw new Error(
      'SessionOrchestrator not wired — Task 6 lands PtyManager implementation',
    );
  }
  async stopSession(): Promise<void> {
    throw new Error('SessionOrchestrator not wired');
  }
  writeInput(): void {
    // no-op until Task 6 wires PtyManager.write()
  }
}

export const sessionRoutes = (
  db: InitializedDb,
  _bus: EventBus,
  orchestrator: SessionOrchestrator,
): FastifyPluginAsync => async (app) => {
  app.get('/api/sessions', async () => {
    const rows = await db.drizzle.select().from(sessions);
    return { sessions: rows };
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    const row = await db.drizzle
      .select()
      .from(sessions)
      .where(eq(sessions.id, req.params.id))
      .get();
    if (!row) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return row;
  });

  app.post<{ Body: SpawnSessionInput }>('/api/sessions', async (req, reply) => {
    const { projectPath, sessionTypeId, effort } = req.body;
    if (!projectPath || !sessionTypeId || !effort) {
      reply.code(400);
      return { error: 'missing_fields' };
    }
    // Validate session type exists (guards against typos / stale enums).
    const typeRow = await db.drizzle
      .select()
      .from(sessionTypes)
      .where(eq(sessionTypes.id, sessionTypeId))
      .get();
    if (!typeRow) {
      reply.code(400);
      return { error: 'unknown_session_type', sessionTypeId };
    }

    try {
      const spawned = await orchestrator.spawnSession(req.body);
      return { session: spawned, channel: channelForSession(spawned.id) };
    } catch (err) {
      reply.code(500);
      return { error: 'spawn_failed', message: (err as Error).message };
    }
  });

  app.delete<{ Params: { id: string } }>('/api/sessions/:id', async (req, reply) => {
    try {
      await orchestrator.stopSession(req.params.id);
      return { ok: true };
    } catch (err) {
      reply.code(500);
      return { error: 'stop_failed', message: (err as Error).message };
    }
  });
};

// Helpers shared with Task 6's PtyManager orchestrator.
export async function upsertProject(
  db: InitializedDb,
  path: string,
  name: string,
): Promise<string> {
  const existing = await db.drizzle
    .select()
    .from(projects)
    .where(eq(projects.path, path))
    .get();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  const now = new Date();
  await db.drizzle.insert(projects).values({
    id,
    name,
    path,
    type: 'other',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function insertSessionRow(
  db: InitializedDb,
  row: NewSession,
): Promise<void> {
  await db.drizzle.insert(sessions).values(row);
}
