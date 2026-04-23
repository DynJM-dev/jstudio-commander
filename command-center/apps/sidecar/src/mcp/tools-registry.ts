import type { Logger } from '@commander/shared';
import { cancelAgentRun as runCancel, spawnAgentRun as runSpawn } from '../agent-run/lifecycle';
import type { CommanderDb } from '../db/client';
import { appendKnowledge } from '../services/knowledge';
import { getProjectById, listProjects } from '../services/projects';
import { getSessionById, listSessions } from '../services/sessions';
import {
  type TaskStatus,
  createTask,
  getTaskById,
  listTasksByProject,
  updateTask,
} from '../services/tasks';
import type { WsBus } from '../services/ws-bus';

/**
 * 10-tool MCP surface per ARCHITECTURE_SPEC §7.3 + dispatch §2 T6. Each tool is
 * a thin wrapper over shared business-logic in `../services/` — the same
 * functions back the future HTTP API routes, so there's exactly one place
 * where CRUD semantics live (no duplication, per dispatch §2 T6).
 *
 * **D-KB-07 narrow-primitive discipline (load-bearing):** no `execute_sql`,
 * `run_migration`, raw shell, raw filesystem, or `eval` tools. Every tool
 * maps to an explicit typed primitive. This module is the defense layer;
 * acceptance 2.6 grep verifies it.
 */

export interface ToolContext {
  db: CommanderDb;
  bus: WsBus;
  logger: Logger;
}

export interface ToolError {
  code: string;
  message: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolError;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

// ---- input validation helpers (narrow primitives, no free-form eval) ----

function requireString(args: Record<string, unknown>, key: string): string | ToolError {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    return { code: 'INVALID_ARG', message: `argument '${key}' must be a non-empty string` };
  }
  return v;
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
): string | undefined | ToolError {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    return { code: 'INVALID_ARG', message: `argument '${key}' must be a string if provided` };
  }
  return v;
}

function optionalNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined | ToolError {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return {
      code: 'INVALID_ARG',
      message: `argument '${key}' must be a finite number if provided`,
    };
  }
  return v;
}

function requireTaskStatus(v: unknown): TaskStatus | ToolError {
  const allowed: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
  if (typeof v !== 'string' || !(allowed as string[]).includes(v)) {
    return {
      code: 'INVALID_ARG',
      message: `status must be one of ${allowed.join(', ')}`,
    };
  }
  return v as TaskStatus;
}

function err(e: ToolError): ToolResult {
  return { ok: false, error: e };
}

// ---- tool definitions ----

export const TOOLS: McpToolDef[] = [
  {
    name: 'list_projects',
    description:
      'List all projects known to Command-Center (auto-created from SessionStart events).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (ctx) => ({ ok: true, data: await listProjects(ctx.db) }),
  },

  {
    name: 'get_project',
    description: 'Fetch a single project by its Command-Center project id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'project UUID' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = requireString(args, 'id');
      if (typeof id !== 'string') return err(id);
      const row = await getProjectById(ctx.db, id);
      return row
        ? { ok: true, data: row }
        : err({ code: 'NOT_FOUND', message: `no project id=${id}` });
    },
  },

  {
    name: 'list_tasks',
    description: 'List tasks for a project, newest-updated first.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const pid = requireString(args, 'project_id');
      if (typeof pid !== 'string') return err(pid);
      return { ok: true, data: await listTasksByProject(ctx.db, pid) };
    },
  },

  {
    name: 'create_task',
    description: 'Create a new task row under a project.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        title: { type: 'string' },
        instructions_md: { type: 'string' },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'in_review', 'done'],
        },
      },
      required: ['project_id', 'title', 'instructions_md'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const pid = requireString(args, 'project_id');
      if (typeof pid !== 'string') return err(pid);
      const title = requireString(args, 'title');
      if (typeof title !== 'string') return err(title);
      const instructions = requireString(args, 'instructions_md');
      if (typeof instructions !== 'string') return err(instructions);
      let status: TaskStatus | undefined;
      if (args.status !== undefined) {
        const s = requireTaskStatus(args.status);
        if (typeof s !== 'string') return err(s);
        status = s;
      }
      const row = await createTask(ctx.db, {
        projectId: pid,
        title,
        instructionsMd: instructions,
        status,
      });
      return { ok: true, data: row };
    },
  },

  {
    name: 'update_task',
    description: 'Patch title / instructions_md / status on an existing task. Does NOT delete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        instructions_md: { type: 'string' },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'in_review', 'done'],
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = requireString(args, 'id');
      if (typeof id !== 'string') return err(id);
      const patch: Parameters<typeof updateTask>[2] = {};
      const title = optionalString(args, 'title');
      if (typeof title === 'object') return err(title);
      if (title !== undefined) patch.title = title;
      const instr = optionalString(args, 'instructions_md');
      if (typeof instr === 'object') return err(instr);
      if (instr !== undefined) patch.instructionsMd = instr;
      if (args.status !== undefined) {
        const s = requireTaskStatus(args.status);
        if (typeof s !== 'string') return err(s);
        patch.status = s;
      }
      const row = await updateTask(ctx.db, id, patch);
      return row
        ? { ok: true, data: row }
        : err({ code: 'NOT_FOUND', message: `no task id=${id}` });
    },
  },

  {
    name: 'add_knowledge_entry',
    description:
      'Append a knowledge entry to a task. Append-only — no PATCH/DELETE. Supersession via supersededById on a NEW entry.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        content_md: { type: 'string' },
        agent_id: { type: 'string' },
        agent_run_id: { type: 'string' },
      },
      required: ['task_id', 'content_md'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const taskId = requireString(args, 'task_id');
      if (typeof taskId !== 'string') return err(taskId);
      const contentMd = requireString(args, 'content_md');
      if (typeof contentMd !== 'string') return err(contentMd);
      const agentId = optionalString(args, 'agent_id');
      if (typeof agentId === 'object') return err(agentId);
      const agentRunId = optionalString(args, 'agent_run_id');
      if (typeof agentRunId === 'object') return err(agentRunId);
      // Verify task exists so append doesn't silently orphan.
      const task = await getTaskById(ctx.db, taskId);
      if (!task) return err({ code: 'NOT_FOUND', message: `no task id=${taskId}` });
      const row = await appendKnowledge(ctx.db, {
        taskId,
        contentMd,
        agentId,
        agentRunId,
      });
      return { ok: true, data: row };
    },
  },

  {
    name: 'list_sessions',
    description: 'List Claude Code sessions registered in Command-Center (most recent 200).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async (ctx) => ({ ok: true, data: await listSessions(ctx.db) }),
  },

  {
    name: 'get_session',
    description: 'Fetch a session by Claude Code session_id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = requireString(args, 'id');
      if (typeof id !== 'string') return err(id);
      const row = await getSessionById(ctx.db, id);
      return row
        ? { ok: true, data: row }
        : err({ code: 'NOT_FOUND', message: `no session id=${id}` });
    },
  },

  {
    name: 'spawn_agent_run',
    description:
      'Spawn a real agent run: materialize a git worktree (or fallback scratch dir), launch the PTY under `command` (default `claude` per KB-P6.7), wire stdout to the per-session WS topic, and enforce the wall-clock bound if supplied. Returns the agent_run row at status="running" with the PID. D-KB-07 narrow-primitive: this is CRUD on agent_runs + PTY-owned-by-sidecar, NOT a generic shell-exec tool.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Existing task to link the run to. Auto-created if omitted.',
        },
        agent_id: { type: 'string', description: 'Optional agent spec id.' },
        command: {
          type: 'string',
          description:
            'Command to spawn. Defaults to `claude` per KB-P6.7 bare-claude pattern. Shell metacharacters (pipes, &&, ;) trigger sh -c wrap.',
        },
        project_id: {
          type: 'string',
          description: 'Explicit project id (when auto-creating a task).',
        },
        cwd_hint: {
          type: 'string',
          description:
            'Working directory hint; used when resolving the project if no task_id + project_id provided.',
        },
        title: {
          type: 'string',
          description: 'Task title for auto-created tasks. Defaults to "Ad-hoc run: <command>".',
        },
        max_wall_clock_seconds: {
          type: 'number',
          description:
            'Deterministic wall-clock bound. Sidecar SIGTERMs → 5s grace → SIGKILLs at the bound. KB-P6.15 (no arithmetic in prompts) + KB-P1.6 (hard bounds always).',
        },
        max_tokens: {
          type: 'number',
          description:
            'Tracked on the row for N4+ enforcement; not enforced in N3 (requires hook-payload token counts).',
        },
        max_iterations: {
          type: 'number',
          description: 'Tracked on the row for N4+ enforcement; not enforced in N3.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const taskId = optionalString(args, 'task_id');
      if (typeof taskId === 'object') return err(taskId);
      const agentId = optionalString(args, 'agent_id');
      if (typeof agentId === 'object') return err(agentId);
      const command = optionalString(args, 'command');
      if (typeof command === 'object') return err(command);
      const projectId = optionalString(args, 'project_id');
      if (typeof projectId === 'object') return err(projectId);
      const cwdHint = optionalString(args, 'cwd_hint');
      if (typeof cwdHint === 'object') return err(cwdHint);
      const title = optionalString(args, 'title');
      if (typeof title === 'object') return err(title);

      const maxWallClockSeconds = optionalNumber(args, 'max_wall_clock_seconds');
      if (typeof maxWallClockSeconds === 'object') return err(maxWallClockSeconds);
      const maxTokens = optionalNumber(args, 'max_tokens');
      if (typeof maxTokens === 'object') return err(maxTokens);
      const maxIterations = optionalNumber(args, 'max_iterations');
      if (typeof maxIterations === 'object') return err(maxIterations);

      try {
        const row = await runSpawn(
          { db: ctx.db, bus: ctx.bus, logger: ctx.logger },
          {
            taskId,
            agentId,
            command,
            projectId,
            cwdHint,
            title,
            maxWallClockSeconds,
            maxTokens,
            maxIterations,
          },
        );
        return { ok: true, data: row };
      } catch (e) {
        return err({
          code: 'SPAWN_FAILED',
          message: e instanceof Error ? e.message : 'unknown spawn error',
        });
      }
    },
  },

  {
    name: 'cancel_agent_run',
    description:
      'Cancel a running agent_run: pre-kill scrollback flush → SIGTERM → 5s grace → SIGKILL if unresponsive. Idempotent — queued-only rows get marked cancelled without signal; terminal rows return unchanged. exit_reason documents which signal path completed the kill.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = requireString(args, 'id');
      if (typeof id !== 'string') return err(id);
      const row = await runCancel({ db: ctx.db, bus: ctx.bus, logger: ctx.logger }, id);
      return row
        ? { ok: true, data: row }
        : err({ code: 'NOT_FOUND', message: `no agent_run id=${id}` });
    },
  },
];

export const TOOLS_BY_NAME: ReadonlyMap<string, McpToolDef> = new Map(
  TOOLS.map((t) => [t.name, t]),
);
