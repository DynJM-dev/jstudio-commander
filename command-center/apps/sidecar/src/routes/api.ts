import { desc } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { cancelAgentRun as runCancel, spawnAgentRun as runSpawn } from '../agent-run/lifecycle';
import type { CommanderDb } from '../db/client';
import { agentRuns } from '../db/schema';
import { requireBearerOrTauriOrigin } from '../middleware/auth';
import { lastHookEvent, recentHookEvents } from '../services/hook-events';
import { runHookPipeline } from '../services/hook-pipeline';
import { appendKnowledge, listKnowledgeByTask } from '../services/knowledge';
import { ensureProjectByCwd, listProjects } from '../services/projects';
import {
  TASK_STATUSES,
  type TaskStatus,
  createTask,
  getTaskById,
  listAllTasks,
  listTasksWithLatestRun,
  updateTask,
} from '../services/tasks';
import type { WsBus } from '../services/ws-bus';

export interface ApiRoutesOpts {
  db: CommanderDb;
  bus: WsBus;
  expectedToken: string;
}

/**
 * Frontend-facing API surface. Powers the Preferences Debug panel (Recent
 * hook events + Recent agent runs) + the smoke-only Replay button + N3's
 * run spawn / cancel HTTP path (ARCHITECTURE_SPEC §7.2).
 *
 * MCP tool handlers (`spawn_agent_run` / `cancel_agent_run`) and HTTP
 * routes (`POST /api/runs` / `DELETE /api/runs/:id`) both call into
 * `agent-run/lifecycle.ts` — single source of CRUD truth per dispatch §2 T6
 * composition rule. No duplicated semantics between the two interfaces.
 *
 * Bearer auth required unless origin is a Tauri webview (default from the
 * running Command Center.app). Auth check via shared middleware.
 */
export const apiRoutes: FastifyPluginAsync<ApiRoutesOpts> = async (app, opts) => {
  const auth = requireBearerOrTauriOrigin({ expectedToken: opts.expectedToken });

  await app.register(async (scoped) => {
    scoped.addHook('preHandler', auth);

    // ---- Hook events (N2) ----

    scoped.get('/api/recent-events', async (req) => {
      const query = req.query as Record<string, unknown>;
      const rawLimit = query.limit;
      const rawSince = query.since;
      const limit =
        typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(500, Number.parseInt(rawLimit, 10))
          : 50;
      const sinceIso = typeof rawSince === 'string' ? rawSince : undefined;

      const rows = await recentHookEvents(opts.db, { limit, sinceIso });
      return {
        ok: true,
        data: {
          count: rows.length,
          events: rows,
        },
      };
    });

    scoped.post('/api/events/replay', async (_req, reply) => {
      const last = await lastHookEvent(opts.db);
      if (!last) {
        reply.status(404);
        return {
          ok: false,
          error: {
            code: 'NO_EVENTS',
            message: 'hook_events table is empty — trigger at least one event first',
          },
        };
      }
      const response = await runHookPipeline(
        { db: opts.db, bus: opts.bus, logger: app.log },
        last.eventName,
        last.payloadJson,
      );
      return {
        ok: true,
        data: {
          replayedEventId: last.id,
          replayedEventName: last.eventName,
          pipelineResponse: response,
        },
      };
    });

    // ---- Agent runs (N3) — ARCHITECTURE_SPEC §7.2 ----

    scoped.get('/api/recent-runs', async (req) => {
      const query = req.query as Record<string, unknown>;
      const rawLimit = query.limit;
      const limit =
        typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
          ? Math.min(500, Number.parseInt(rawLimit, 10))
          : 50;
      const rows = await opts.db.query.agentRuns.findMany({
        orderBy: [desc(agentRuns.id)],
        limit,
      });
      return { ok: true, data: { count: rows.length, runs: rows } };
    });

    scoped.post('/api/runs', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      try {
        const row = await runSpawn(
          { db: opts.db, bus: opts.bus, logger: app.log },
          {
            taskId: typeofStrOrUndef(body.task_id),
            agentId: typeofStrOrUndef(body.agent_id),
            command: typeofStrOrUndef(body.command),
            projectId: typeofStrOrUndef(body.project_id),
            cwdHint: typeofStrOrUndef(body.cwd_hint),
            title: typeofStrOrUndef(body.title),
            maxWallClockSeconds: typeofNumOrUndef(body.max_wall_clock_seconds),
            maxTokens: typeofNumOrUndef(body.max_tokens),
            maxIterations: typeofNumOrUndef(body.max_iterations),
          },
        );
        return { ok: true, data: row };
      } catch (err) {
        reply.status(500);
        return {
          ok: false,
          error: {
            code: 'SPAWN_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        };
      }
    });

    scoped.delete('/api/runs/:id', async (req, reply) => {
      const params = req.params as { id?: string };
      const id = typeof params.id === 'string' ? params.id : '';
      if (id.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing run id' } };
      }
      const row = await runCancel({ db: opts.db, bus: opts.bus, logger: app.log }, id);
      if (!row) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no agent_run id=${id}` } };
      }
      return { ok: true, data: row };
    });

    scoped.get('/api/runs/:id', async (req, reply) => {
      const params = req.params as { id?: string };
      const id = typeof params.id === 'string' ? params.id : '';
      if (id.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing run id' } };
      }
      const row = await opts.db.query.agentRuns.findFirst({
        where: (r, { eq }) => eq(r.id, id),
      });
      if (!row) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no agent_run id=${id}` } };
      }
      // Join the session's scrollback_blob so the run viewer can seed xterm
      // with persisted history before subscribing to live bytes. N3 scope
      // per dispatch §6 — this is single-run historical read, NOT the full
      // UI re-hydration across restarts that lands in N4.
      let scrollback: string | null = null;
      if (row.sessionId) {
        const session = await opts.db.query.sessions.findFirst({
          where: (s, { eq }) => eq(s.id, row.sessionId as string),
          columns: { scrollbackBlob: true },
        });
        scrollback = session?.scrollbackBlob ?? null;
      }
      return { ok: true, data: { ...row, scrollbackBlob: scrollback } };
    });

    // ---- Tasks (N4 kanban) — ARCHITECTURE_SPEC §7.2 ----
    //
    // GET  /api/tasks?status=&project_id=      → TaskRow[]
    // GET  /api/tasks/with-latest-run?status=  → TaskWithLatestRun[] (kanban cards)
    // POST /api/tasks                          → TaskRow (auto-picks first project
    //                                             if project_id omitted; auto-creates
    //                                             one for the sidecar cwd if none exist)
    // GET  /api/tasks/:id                      → TaskRow | 404
    // PATCH /api/tasks/:id                     → TaskRow (title / instructions_md / status)

    scoped.get('/api/tasks', async (req) => {
      const query = req.query as Record<string, unknown>;
      const status = parseTaskStatus(query.status);
      const projectId = typeofStrOrUndef(query.project_id);
      const rows = await listAllTasks(opts.db, { status, projectId });
      return { ok: true, data: { count: rows.length, tasks: rows } };
    });

    scoped.get('/api/tasks/with-latest-run', async (req) => {
      const query = req.query as Record<string, unknown>;
      const status = parseTaskStatus(query.status);
      const projectId = typeofStrOrUndef(query.project_id);
      const rows = await listTasksWithLatestRun(opts.db, { status, projectId });
      return { ok: true, data: { count: rows.length, tasks: rows } };
    });

    scoped.post('/api/tasks', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = typeofStrOrUndef(body.title);
      const instructions = typeofStrOrUndef(body.instructions_md) ?? '';
      const requestedStatus = parseTaskStatus(body.status);
      let projectId = typeofStrOrUndef(body.project_id);

      if (!title) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'title is required' } };
      }

      // Resolve project: explicit project_id → existing projects → auto-create
      // from sidecar cwd. Gives the kanban a functional home-view without the
      // user first running an Open Folder flow.
      if (!projectId) {
        const all = await listProjects(opts.db);
        const first = all[0];
        if (first) {
          projectId = first.id;
        } else {
          const fallback = await ensureProjectByCwd(opts.db, process.cwd());
          projectId = fallback.id;
        }
      }

      try {
        const row = await createTask(opts.db, {
          projectId,
          title,
          instructionsMd: instructions,
          status: requestedStatus,
        });
        return { ok: true, data: row };
      } catch (err) {
        reply.status(500);
        return {
          ok: false,
          error: {
            code: 'TASK_CREATE_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        };
      }
    });

    scoped.get('/api/tasks/:id', async (req, reply) => {
      const params = req.params as { id?: string };
      const id = typeof params.id === 'string' ? params.id : '';
      if (id.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing task id' } };
      }
      const row = await getTaskById(opts.db, id);
      if (!row) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no task id=${id}` } };
      }
      return { ok: true, data: row };
    });

    // ---- Knowledge entries (N4 T7) — KB-P1.3 append-only ----
    //
    // GET  /api/tasks/:taskId/knowledge  → KnowledgeEntryRow[] (chronological)
    // POST /api/tasks/:taskId/knowledge  → KnowledgeEntryRow
    //
    // No PATCH, no DELETE by design (KB-P1.3). Supersession is a new row
    // with `superseded_by_id` pointing at it from the original — future UI
    // concern, not part of T7 scope.

    scoped.get('/api/tasks/:taskId/knowledge', async (req, reply) => {
      const params = req.params as { taskId?: string };
      const taskId = typeof params.taskId === 'string' ? params.taskId : '';
      if (taskId.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing task id' } };
      }
      const task = await getTaskById(opts.db, taskId);
      if (!task) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no task id=${taskId}` } };
      }
      const rows = await listKnowledgeByTask(opts.db, taskId);
      return { ok: true, data: { count: rows.length, entries: rows } };
    });

    scoped.post('/api/tasks/:taskId/knowledge', async (req, reply) => {
      const params = req.params as { taskId?: string };
      const taskId = typeof params.taskId === 'string' ? params.taskId : '';
      if (taskId.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing task id' } };
      }
      const task = await getTaskById(opts.db, taskId);
      if (!task) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no task id=${taskId}` } };
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const content = typeofStrOrUndef(body.content_md);
      if (!content) {
        reply.status(400);
        return {
          ok: false,
          error: { code: 'INVALID_ARG', message: 'content_md is required and non-empty' },
        };
      }
      const row = await appendKnowledge(opts.db, {
        taskId,
        contentMd: content,
        agentId: typeofStrOrUndef(body.agent_id),
        agentRunId: typeofStrOrUndef(body.agent_run_id),
      });
      return { ok: true, data: row };
    });

    scoped.patch('/api/tasks/:id', async (req, reply) => {
      const params = req.params as { id?: string };
      const id = typeof params.id === 'string' ? params.id : '';
      if (id.length === 0) {
        reply.status(400);
        return { ok: false, error: { code: 'INVALID_ARG', message: 'missing task id' } };
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: Parameters<typeof updateTask>[2] = {};
      const title = typeofStrOrUndef(body.title);
      if (title !== undefined) patch.title = title;
      const instr = typeofStrOrUndef(body.instructions_md);
      if (instr !== undefined) patch.instructionsMd = instr;
      const status = parseTaskStatus(body.status);
      if (status !== undefined) patch.status = status;

      const row = await updateTask(opts.db, id, patch);
      if (!row) {
        reply.status(404);
        return { ok: false, error: { code: 'NOT_FOUND', message: `no task id=${id}` } };
      }
      return { ok: true, data: row };
    });
  });
};

function parseTaskStatus(v: unknown): TaskStatus | undefined {
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return TASK_STATUSES.includes(v as TaskStatus) ? (v as TaskStatus) : undefined;
}

function typeofStrOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function typeofNumOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
