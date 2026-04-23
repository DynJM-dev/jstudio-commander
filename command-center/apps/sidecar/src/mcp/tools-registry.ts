import type { CommanderDb } from '../db/client';
import { cancelAgentRun, queueAgentRun } from '../services/agent-runs';
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
      'Queue an agent run for a task. N2 stub — inserts agent_runs row with status="queued". Real PTY spawn + worktree creation lands in N3.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        agent_id: { type: 'string' },
      },
      required: ['task_id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const taskId = requireString(args, 'task_id');
      if (typeof taskId !== 'string') return err(taskId);
      const agentId = optionalString(args, 'agent_id');
      if (typeof agentId === 'object') return err(agentId);
      const task = await getTaskById(ctx.db, taskId);
      if (!task) return err({ code: 'NOT_FOUND', message: `no task id=${taskId}` });
      const row = await queueAgentRun(ctx.db, { taskId, agentId });
      return { ok: true, data: row };
    },
  },

  {
    name: 'cancel_agent_run',
    description:
      'Mark an agent_run row as cancelled. N2 stub — sets status="cancelled". Real PTY SIGTERM + worktree cleanup lands in N3.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (ctx, args) => {
      const id = requireString(args, 'id');
      if (typeof id !== 'string') return err(id);
      const row = await cancelAgentRun(ctx.db, id);
      return row
        ? { ok: true, data: row }
        : err({ code: 'NOT_FOUND', message: `no agent_run id=${id}` });
    },
  },
];

export const TOOLS_BY_NAME: ReadonlyMap<string, McpToolDef> = new Map(
  TOOLS.map((t) => [t.name, t]),
);
