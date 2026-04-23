import { randomUUID } from 'node:crypto';
import { type Logger, encodeScrollbackBase64 } from '@commander/shared';
import { eq } from 'drizzle-orm';
import type { CommanderDb } from '../db/client';
import { agentRuns, sessions } from '../db/schema';
import { type PtyHandle, spawnPty } from '../pty/spawn';
import {
  type AgentRunRow,
  type AgentRunStatus,
  getAgentRunById,
  cancelAgentRun as markCancelledRow,
  queueAgentRun,
} from '../services/agent-runs';
import { ensureProjectByCwd, getProjectById, listProjects } from '../services/projects';
import { ensureSessionByClaudeId } from '../services/sessions';
import { createTask, getTaskById } from '../services/tasks';
import type { WsBus } from '../services/ws-bus';
import { createWorktree, removeWorktree } from '../worktree/create';

/**
 * Deterministic 5-state FSM for agent_runs per ARCHITECTURE_SPEC §3.2:
 *
 *   queued → running   (on PTY spawn success)
 *   running → completed (PTY exit 0)
 *   running → failed    (PTY exit non-zero OR spawn/worktree error)
 *   running → cancelled (cancel_agent_run MCP call: SIGTERM → 5s → SIGKILL)
 *   running → timed-out (wall-clock bound hit: SIGTERM → 5s → SIGKILL)
 *
 * Wall-clock + cancel + timeout paths are DETERMINISTIC — timer math + signal
 * delivery at the sidecar layer. No prompt, no model in the loop. KB-P6.15
 * (no arithmetic in prompts) + KB-P1.6 (hard bounds always) load-bearing.
 *
 * **Pre-kill scrollback flush** is MANDATORY on cancel + timeout paths per
 * dispatch §7: flush accumulated PTY bytes to `sessions.scrollback_blob`
 * BEFORE sending the kill signal, so the record isn't lost. FSM order is:
 * flush → signal → wait → state transition → WS event.
 */

export interface LifecycleDeps {
  db: CommanderDb;
  bus: WsBus;
  logger: Logger;
}

export interface SpawnArgs {
  /**
   * If supplied, run links to this task. If absent, we auto-create a task
   * ("Ad-hoc run: <command>") under the caller-supplied or default project.
   */
  taskId?: string;
  /** Defaults to 'claude' per KB-P6.7 bare-claude pattern. */
  command?: string;
  /** Optional argv for the command if more than a single token is needed. */
  commandArgs?: string[];
  /** Optional explicit project id. If absent, resolved from cwd / listProjects. */
  projectId?: string;
  /** Working directory hint for project resolution when both taskId + projectId are absent. */
  cwdHint?: string;
  /** Used as task title when auto-creating. */
  title?: string;
  /** Optional agent spec id. */
  agentId?: string;
  /** Deterministic wall-clock bound. Undefined/0 = no bound. */
  maxWallClockSeconds?: number;
  /** Future-proofing — tracked on the row but not enforced until hook payloads carry counts. */
  maxTokens?: number;
  maxIterations?: number;
}

// In-memory registry of running handles keyed by agent_run_id. Used by the
// cancel path to find the PTY to signal, and by the wall-clock watchdog to
// deliver its timeout signal. Not persistent — sidecar restart loses running
// handles (N3 doesn't require resume; session rows persist so UI shows history).
const RUNNING: Map<
  string,
  {
    handle: PtyHandle;
    sessionId: string;
    projectRoot: string;
    worktreePath: string;
    startedAtMs: number;
    wallClockTimer?: ReturnType<typeof setTimeout>;
    scrollback: Uint8Array[]; // accumulated bytes for flush-on-terminal
  }
> = new Map();

const SIGTERM_GRACE_MS = 5_000;

/**
 * Main entry point for `spawn_agent_run` MCP tool + POST /api/runs. Returns
 * the agent_run row at `status: running` with real `pty_pid`. Throws with
 * an informative error on spawn/worktree failure; caller converts to
 * `{ ok: false, error }` envelope.
 */
export async function spawnAgentRun(deps: LifecycleDeps, args: SpawnArgs): Promise<AgentRunRow> {
  const { db, bus, logger } = deps;

  // 1. Resolve taskId (auto-create if absent).
  const taskId = await resolveOrCreateTask(db, args, logger);

  // 2. Create the queued agent_run row. This gives us the run UUID early
  //    so we can use it in the worktree path + scrollback session.
  const row = await queueAgentRun(db, { taskId, agentId: args.agentId });

  // 3. Mint a fresh session_id for the child run (distinct from the MCP
  //    caller's session_id — child PTY gets its own pty:<id> topic).
  const childSessionId = randomUUID();

  // 4. Resolve project root for worktree.
  const task = await getTaskById(db, taskId);
  if (!task) throw new Error(`spawnAgentRun: missing task ${taskId} after create`);
  const project = await getProjectById(db, task.projectId);
  if (!project) {
    throw new Error(`spawnAgentRun: missing project ${task.projectId} for task ${taskId}`);
  }
  const projectRoot = project.identityFilePath;

  // 5. Materialize worktree (git primary / shallow-copy fallback / no-isolation fallback).
  const { worktreePath, isGitWorktree } = await createWorktree({
    projectRoot,
    runId: row.id,
    logger,
  });

  // 6. Register sessions row so hook events + PTY WS events can join.
  await ensureSessionByClaudeId(db, childSessionId, worktreePath);

  // 7. Build argv.
  const commandToken = args.command ?? 'claude';
  const argv = buildArgv(commandToken, args.commandArgs);

  // 8. Spawn PTY. Wire stdout to pty:<session_id> + accumulate for scrollback
  //    flush on terminal transitions.
  const scrollbackBuf: Uint8Array[] = [];
  const startedAtMs = Date.now();

  let handle: PtyHandle;
  try {
    handle = spawnPty({
      command: argv,
      cwd: worktreePath,
      env: {},
      onData: (bytes, stream) => {
        scrollbackBuf.push(bytes);
        bus.publish(`pty:${childSessionId}`, {
          kind: 'data',
          session_id: childSessionId,
          stream,
          bytes: encodeScrollbackBase64(bytes),
        });
      },
      onExit: ({ exitCode, signalCode }) => {
        void handleExit(deps, row.id, { exitCode, signalCode });
      },
    });
  } catch (err) {
    await markRunFailed(deps, row.id, childSessionId, `spawn-error: ${describeError(err)}`);
    return (await getAgentRunById(db, row.id)) ?? row;
  }

  // 9. Transition to running + write pty_pid + session_id + worktree_path.
  const startedAtIso = new Date(startedAtMs).toISOString();
  await db
    .update(agentRuns)
    .set({
      status: 'running',
      startedAt: startedAtIso,
      sessionId: childSessionId,
      worktreePath: isGitWorktree || worktreePath !== projectRoot ? worktreePath : null,
    })
    .where(eq(agentRuns.id, row.id));

  // Also persist pty_pid + started_at on the sessions row so list_sessions
  // reflects the live state.
  await db
    .update(sessions)
    .set({ ptyPid: handle.pid, status: 'running' })
    .where(eq(sessions.id, childSessionId));

  bus.publish(`status:${childSessionId}`, {
    session_id: childSessionId,
    status: 'running',
    timestamp: startedAtIso,
  });

  // 10. Wall-clock deterministic watchdog (KB-P6.15).
  let wallClockTimer: ReturnType<typeof setTimeout> | undefined;
  if (typeof args.maxWallClockSeconds === 'number' && args.maxWallClockSeconds > 0) {
    const budgetMs = args.maxWallClockSeconds * 1000;
    wallClockTimer = setTimeout(() => {
      void timeoutRun(deps, row.id).catch((err) => {
        logger.warn({ err, runId: row.id }, 'wall-clock timeout handler threw');
      });
    }, budgetMs);
  }

  // 11. Register in RUNNING so cancel + watchdog paths can find it.
  RUNNING.set(row.id, {
    handle,
    sessionId: childSessionId,
    projectRoot,
    worktreePath,
    startedAtMs,
    wallClockTimer,
    scrollback: scrollbackBuf,
  });

  return (await getAgentRunById(db, row.id)) ?? row;
}

/**
 * Cancel path (cancel_agent_run MCP / DELETE /api/runs/:id). Pre-kill
 * scrollback flush → SIGTERM → 5s grace → SIGKILL if still alive →
 * agent_runs update → status WS event. Idempotent: if run is already
 * terminal OR not in RUNNING map, returns the row as-is.
 */
export async function cancelAgentRun(
  deps: LifecycleDeps,
  runId: string,
): Promise<AgentRunRow | null> {
  const { db, logger } = deps;

  const live = RUNNING.get(runId);
  if (!live) {
    // Either terminal already or never spawned. Idempotent: mark cancelled
    // if still queued, else return the row as-is.
    const row = await getAgentRunById(db, runId);
    if (row?.status === 'queued') {
      await markCancelledRow(db, runId);
      return getAgentRunById(db, runId);
    }
    return row;
  }

  // Pre-kill scrollback flush — the record must survive termination.
  await flushScrollback(deps, runId, live);

  // SIGTERM → race against 5s grace.
  live.handle.kill('SIGTERM');
  const raceOutcome = await Promise.race([
    live.handle.exited.then(() => 'sigterm-honored' as const),
    new Promise<'grace-expired'>((resolve) =>
      setTimeout(() => resolve('grace-expired'), SIGTERM_GRACE_MS),
    ),
  ]);

  let exitReason: string;
  if (raceOutcome === 'sigterm-honored') {
    exitReason = 'cancelled-sigterm';
  } else {
    live.handle.kill('SIGKILL');
    await live.handle.exited.catch(() => undefined);
    exitReason = 'cancelled-sigkill';
  }

  await finalizeTerminal(deps, runId, live, {
    status: 'cancelled',
    exitReason,
  });

  logger.info({ runId, exitReason }, 'agent run cancelled');
  return getAgentRunById(db, runId);
}

/**
 * Wall-clock timeout path. Structurally identical to cancel — same pre-kill
 * flush + SIGTERM/SIGKILL dance — but emits `timed-out` status with
 * exit_reason documenting the bound. Called from the deterministic timer
 * registered in spawnAgentRun's RUNNING entry.
 */
async function timeoutRun(deps: LifecycleDeps, runId: string): Promise<void> {
  const live = RUNNING.get(runId);
  if (!live) return; // Already terminal.

  await flushScrollback(deps, runId, live);

  live.handle.kill('SIGTERM');
  const raceOutcome = await Promise.race([
    live.handle.exited.then(() => 'sigterm-honored' as const),
    new Promise<'grace-expired'>((resolve) =>
      setTimeout(() => resolve('grace-expired'), SIGTERM_GRACE_MS),
    ),
  ]);

  const durationSeconds = Math.round((Date.now() - live.startedAtMs) / 1000);
  const exitReason =
    raceOutcome === 'sigterm-honored'
      ? `timed-out-wall-clock-sigterm (ran ${durationSeconds}s)`
      : `timed-out-wall-clock-sigkill (ran ${durationSeconds}s)`;

  if (raceOutcome === 'grace-expired') {
    live.handle.kill('SIGKILL');
    await live.handle.exited.catch(() => undefined);
  }

  await finalizeTerminal(deps, runId, live, {
    status: 'timed-out',
    exitReason,
  });

  deps.logger.info({ runId, exitReason }, 'agent run timed out (wall-clock bound)');
}

/**
 * Natural PTY exit path (child process ended on its own). Maps exit code
 * + signal to completed / failed states. Invoked from spawnPty's onExit
 * callback.
 */
async function handleExit(
  deps: LifecycleDeps,
  runId: string,
  exitInfo: { exitCode: number | null; signalCode: string | null },
): Promise<void> {
  const live = RUNNING.get(runId);
  if (!live) {
    // Already finalized by cancel or timeout path (which raced with natural
    // exit) — don't double-write state.
    return;
  }
  const { exitCode, signalCode } = exitInfo;
  let status: AgentRunStatus;
  let exitReason: string;

  if (exitCode === 0) {
    status = 'completed';
    exitReason = 'exit-code-0';
  } else if (signalCode) {
    status = 'failed';
    exitReason = `exit-signal-${signalCode}`;
  } else if (exitCode !== null && exitCode !== 0) {
    status = 'failed';
    exitReason = `exit-code-${exitCode}`;
  } else {
    status = 'failed';
    exitReason = 'exit-unknown';
  }

  await flushScrollback(deps, runId, live);
  await finalizeTerminal(deps, runId, live, { status, exitReason });
  deps.logger.info({ runId, status, exitReason }, 'agent run exited naturally');
}

/**
 * Common terminal-state persistence + WS emit + RUNNING cleanup. Handles
 * agent_runs row update, sessions row status, WS status event, wall-clock
 * timer cancellation, and best-effort worktree cleanup.
 */
async function finalizeTerminal(
  deps: LifecycleDeps,
  runId: string,
  live: NonNullable<ReturnType<typeof RUNNING.get>>,
  terminal: { status: AgentRunStatus; exitReason: string },
): Promise<void> {
  const { db, bus, logger } = deps;

  if (live.wallClockTimer) clearTimeout(live.wallClockTimer);

  const endedAtIso = new Date().toISOString();
  const wallClockSeconds = Math.round((Date.now() - live.startedAtMs) / 1000);

  await db
    .update(agentRuns)
    .set({
      status: terminal.status,
      endedAt: endedAtIso,
      exitReason: terminal.exitReason,
      wallClockSeconds,
    })
    .where(eq(agentRuns.id, runId));

  await db
    .update(sessions)
    .set({
      status: terminal.status === 'completed' ? 'done' : terminal.status,
      endedAt: endedAtIso,
    })
    .where(eq(sessions.id, live.sessionId));

  bus.publish(`status:${live.sessionId}`, {
    session_id: live.sessionId,
    status: terminal.status,
    exit_reason: terminal.exitReason,
    timestamp: endedAtIso,
  });

  RUNNING.delete(runId);

  // Best-effort worktree cleanup — don't block the response on it.
  void removeWorktree(live.projectRoot, live.worktreePath, logger);
}

/**
 * Flush accumulated PTY bytes into `sessions.scrollback_blob` via the shared
 * base64 codec (KB-P4.2 UTF-8 round-trip safety). Concatenates all received
 * chunks, encodes once, writes. Called before any kill signal (cancel +
 * timeout) AND on natural exit so the record survives the process dying.
 */
async function flushScrollback(
  deps: LifecycleDeps,
  runId: string,
  live: NonNullable<ReturnType<typeof RUNNING.get>>,
): Promise<void> {
  if (live.scrollback.length === 0) return;
  const totalLen = live.scrollback.reduce((n, b) => n + b.length, 0);
  const joined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of live.scrollback) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const encoded = encodeScrollbackBase64(joined);
  try {
    await deps.db
      .update(sessions)
      .set({ scrollbackBlob: encoded })
      .where(eq(sessions.id, live.sessionId));
    // Clear the in-memory buffer after successful flush; subsequent exit
    // handler won't double-write.
    live.scrollback.length = 0;
  } catch (err) {
    deps.logger.warn({ err, runId }, 'scrollback flush failed');
  }
}

/**
 * Resolve a task_id for the MCP spawn call. Four acceptance paths:
 *
 *   1. `taskId` supplied → use it (must exist).
 *   2. `projectId` + `title` supplied → create_task under that project.
 *   3. `cwdHint` supplied → find-or-create project → auto-create task.
 *   4. Neither → use first project in DB → auto-create task.
 *
 * Path 4 is the MCP ergonomic default for Jose's smoke: external Claude
 * session just says "spawn_agent_run with command ls" and we thread through
 * the project discovery chain without forcing the caller to pre-create
 * task/project rows.
 */
async function resolveOrCreateTask(
  db: CommanderDb,
  args: SpawnArgs,
  logger: Logger,
): Promise<string> {
  if (args.taskId) {
    const existing = await getTaskById(db, args.taskId);
    if (!existing) throw new Error(`spawnAgentRun: task ${args.taskId} not found`);
    return args.taskId;
  }

  const titleFromCommand = args.title ?? `Ad-hoc run: ${args.command ?? 'claude'}`;
  const instructionsMd = `Auto-created for spawn_agent_run call on ${new Date().toISOString()}.`;

  let projectId = args.projectId;
  if (!projectId && args.cwdHint) {
    const project = await ensureProjectByCwd(db, args.cwdHint);
    projectId = project.id;
    logger.info(
      { projectId, cwdHint: args.cwdHint },
      'spawnAgentRun: auto-resolved project from cwd',
    );
  }
  if (!projectId) {
    // Fall back to the first project in DB (single-user v1 default).
    const projects = await listProjects(db);
    const fallback = projects[0];
    if (!fallback) {
      // No projects at all — bootstrap one rooted at $HOME so commands have a cwd.
      const home = process.env.HOME ?? '/';
      const p = await ensureProjectByCwd(db, home);
      projectId = p.id;
      logger.warn(
        { projectId, home },
        'spawnAgentRun: no projects in DB — bootstrapped default rooted at HOME',
      );
    } else {
      projectId = fallback.id;
      logger.info({ projectId }, 'spawnAgentRun: using default (first) project');
    }
  }

  const task = await createTask(db, {
    projectId,
    title: titleFromCommand,
    instructionsMd,
    status: 'in_progress',
  });
  return task.id;
}

async function markRunFailed(
  deps: LifecycleDeps,
  runId: string,
  sessionId: string,
  exitReason: string,
): Promise<void> {
  const endedAtIso = new Date().toISOString();
  await deps.db
    .update(agentRuns)
    .set({
      status: 'failed',
      endedAt: endedAtIso,
      exitReason,
      wallClockSeconds: 0,
      sessionId,
    })
    .where(eq(agentRuns.id, runId));
  deps.bus.publish(`status:${sessionId}`, {
    session_id: sessionId,
    status: 'failed',
    exit_reason: exitReason,
    timestamp: endedAtIso,
  });
}

function buildArgv(commandToken: string, extra?: string[]): string[] {
  // If caller passed a literal argv, honor it directly.
  if (extra && extra.length > 0) return [commandToken, ...extra];

  // If the token has shell-metacharacters (pipes, redirects, &&, ||, ;),
  // wrap in `sh -c` so the shell handles parsing. Otherwise split on
  // whitespace into argv — simple but good enough for most single-binary
  // invocations like `ls -la` or `sleep 30`.
  if (/[|&;<>]|&&|\|\|/.test(commandToken)) {
    return ['sh', '-c', commandToken];
  }
  const tokens = commandToken.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return ['sh', '-c', commandToken];
  return tokens;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// Exposed for tests + debug introspection — how many runs are currently live.
export function runningAgentCount(): number {
  return RUNNING.size;
}

export function getRunningHandle(runId: string) {
  return RUNNING.get(runId);
}
