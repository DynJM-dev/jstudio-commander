// PtyOrchestrator — implements the SessionOrchestrator contract in terms of
// PtyManager + PtyPool + DB + EventBus.
//
// Task 6 landed cold-spawn + OSC 133 wiring. Task 7 (this file) adds pool-
// claim fast path. Task 9 will add bootstrap injection (launch `claude`,
// stream bootstrap contents into pty.stdin after Claude boots).

import { basename } from 'node:path';
import type { InitializedDb, NewSession } from '@jstudio-commander/db';
import { sessions, preferences } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';
import type {
  SessionTypeId,
  SessionEffort,
  WsEvent,
} from '@jstudio-commander/shared';

import { EventBus, channelForSession } from '../ws/event-bus.js';
import type {
  SessionOrchestrator,
  SpawnSessionInput,
  SpawnedSession,
} from '../routes/sessions.js';
import { upsertProject, insertSessionRow } from '../routes/sessions.js';
import { spawnPty, type PtyHandle, type MutableCallbacks } from './manager.js';
import { ensureZdotdir } from './hook-path.js';
import { PtyPool, clampPoolSize, POOL_SIZE_DEFAULT } from './pool.js';
import type { Osc133Event } from '../osc133/parser.js';
import { BootstrapLauncher, planBootstrap } from './bootstrap.js';
import { sessionTypes as sessionTypesTable } from '@jstudio-commander/db';

export interface PtyOrchestratorDeps {
  db: InitializedDb;
  bus: EventBus;
  /** Override the pool size resolution (tests). */
  poolSizeOverride?: number;
  /** Skip pool warmup (tests that don't need pool claim behavior). */
  disablePool?: boolean;
}

export class PtyOrchestrator implements SessionOrchestrator {
  private readonly zdotdir: string;
  private readonly handles = new Map<string, PtyHandle>();
  private readonly launchers = new Map<string, BootstrapLauncher>();
  private readonly pool: PtyPool;
  // Per-session timestamp of the most recent A or B OSC 133 marker. Used to
  // compute durationMs on the following D marker. `undefined` means "no
  // prior command observed"; D arriving in that state emits durationMs=0 +
  // a system:warning (dispatch §1.8 + §3 Task 8 edge case).
  private readonly lastCommandStartedAt = new Map<string, number>();
  private shuttingDown = false;
  private warmupPromise: Promise<void> | null = null;

  constructor(private readonly deps: PtyOrchestratorDeps) {
    // Initial zdotdir uses the current preference value. spawnSession
    // refreshes before each new-session spawn so a preference toggle takes
    // effect on the next session without restarting the sidecar.
    const { zdotdir } = ensureZdotdir({ sourceUserRc: this.readSourceUserRc() });
    this.zdotdir = zdotdir;

    const size = deps.disablePool ? 0 : this.resolvePoolSize();
    this.pool = new PtyPool(
      {
        zdotdir: this.zdotdir,
        onWarmError: (err) =>
          console.error('[orchestrator] pool warm error:', err.message),
      },
      size,
    );
    if (size > 0) {
      this.warmupPromise = this.pool.warmup();
    }
  }

  /** Read preferences.zsh.source_user_rc (default false). */
  private readSourceUserRc(): boolean {
    try {
      const row = this.deps.db.drizzle
        .select()
        .from(preferences)
        .where(eq(preferences.key, 'zsh.source_user_rc'))
        .get();
      if (!row) return false;
      return row.value === 'true' || row.value === '1';
    } catch {
      return false;
    }
  }

  /** Resolves from preferences.pool.size if present, else POOL_SIZE_DEFAULT. */
  private resolvePoolSize(): number {
    if (this.deps.poolSizeOverride !== undefined) {
      return clampPoolSize(this.deps.poolSizeOverride);
    }
    try {
      const row = this.deps.db.drizzle
        .select()
        .from(preferences)
        .where(eq(preferences.key, 'pool.size'))
        .get();
      if (row) {
        const parsed = Number.parseInt(row.value, 10);
        return clampPoolSize(parsed);
      }
    } catch {
      /* fall through to default */
    }
    return POOL_SIZE_DEFAULT;
  }

  /** Expose warmup completion for tests that want to assert pool behavior. */
  async waitForWarmup(): Promise<void> {
    if (this.warmupPromise) await this.warmupPromise;
  }

  poolReadyCount(): number {
    return this.pool.readyCount();
  }

  async spawnSession(input: SpawnSessionInput): Promise<SpawnedSession> {
    const now = Date.now();
    const sessionId = crypto.randomUUID();

    // Refresh zdotdir so a preference toggle takes effect on next session.
    // ensureZdotdir is cheap (2 readFileSync + possibly 1 writeFileSync);
    // idempotent when the generated content hasn't changed.
    ensureZdotdir({ sourceUserRc: this.readSourceUserRc() });

    // Look up session type BEFORE spawning so a missing bootstrap file fails
    // fast and cleanly — no orphan pty.
    const typeRow = this.deps.db.drizzle
      .select()
      .from(sessionTypesTable)
      .where(eq(sessionTypesTable.id, input.sessionTypeId))
      .get();
    if (!typeRow) {
      throw new Error(`unknown session type "${input.sessionTypeId}"`);
    }
    const plan = planBootstrap({
      sessionTypeId: typeRow.id,
      bootstrapPath: typeRow.bootstrapPath,
    });
    if (plan.kind === 'error') {
      throw new Error(plan.message);
    }

    const projectName = input.projectName ?? (basename(input.projectPath) || 'project');
    const projectId = await upsertProject(this.deps.db, input.projectPath, projectName);

    const callbacks = this.buildCallbacks(sessionId);

    // Fast path: claim a pre-warmed pty if available.
    let handle = this.pool.claim({
      sessionId,
      cwd: input.projectPath,
      callbacks,
    });

    let warmClaimed = true;
    if (!handle) {
      warmClaimed = false;
      // Cold-spawn path: slower but always available.
      handle = spawnPty({
        sessionId,
        cwd: input.projectPath,
        zdotdir: this.zdotdir,
        cols: 120,
        rows: 32,
        ...callbacks,
      });
    }

    this.handles.set(sessionId, handle);

    // Attach the bootstrap launcher for PM/Coder/Raw unless a test opted out.
    if (!input.skipClientLaunch) {
      const launcher = new BootstrapLauncher({
        clientBinary: typeRow.clientBinary,
        plan,
        handle,
        onError: (err) => this.emitSystemError(sessionId, 'bootstrap_error', err.message),
      });
      this.launchers.set(sessionId, launcher);
      this.rebindWithLauncher(handle, sessionId, callbacks, launcher);
    }

    const row: NewSession = {
      id: sessionId,
      projectId,
      sessionTypeId: input.sessionTypeId,
      effort: input.effort,
      displayName: input.displayName ?? null,
      status: 'active',
      cwd: input.projectPath,
      ptyPid: handle.pid,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
    await insertSessionRow(this.deps.db, row);

    this.emit(sessionId, {
      type: 'session:created',
      sessionId,
      timestamp: now,
    });
    this.emit(sessionId, {
      type: 'session:status',
      sessionId,
      status: 'active',
      timestamp: now,
    });

    if (!warmClaimed) {
      // Cold spawn didn't visit `cd`; caller's cwd came from the spawn opts.
      // Still, to keep behavior uniform with warm path (export + cd visible),
      // we don't emit anything extra — warm path's extra commands are a
      // side-effect of pool reuse, not a protocol requirement.
    }

    return {
      id: sessionId,
      projectId,
      sessionTypeId: input.sessionTypeId as SessionTypeId,
      effort: input.effort as SessionEffort,
      status: 'active',
      cwd: input.projectPath,
      ptyPid: handle.pid,
      createdAt: now,
    };
  }

  async stopSession(sessionId: string): Promise<void> {
    const handle = this.handles.get(sessionId);
    if (handle) handle.kill('SIGTERM');
  }

  writeInput(sessionId: string, data: string): void {
    const handle = this.handles.get(sessionId);
    if (handle) handle.write(data);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.pool.shutdown();
    for (const launcher of this.launchers.values()) launcher.cancel();
    this.launchers.clear();
    for (const handle of this.handles.values()) {
      handle.kill('SIGTERM');
    }
    this.handles.clear();
  }

  private rebindWithLauncher(
    handle: PtyHandle,
    sessionId: string,
    base: MutableCallbacks,
    launcher: BootstrapLauncher,
  ): void {
    handle.rebind({
      onData: (chunk: string) => {
        base.onData(chunk);
        launcher.onData(chunk);
      },
      onOsc133: (event: Osc133Event) => {
        base.onOsc133(event);
        launcher.onOsc133(event);
      },
      onExit: base.onExit,
    });
    void sessionId; // referenced via closure in base callbacks
  }

  private emitSystemError(sessionId: string, code: string, message: string): void {
    this.emit(sessionId, {
      type: 'system:error',
      sessionId,
      code,
      message,
      timestamp: Date.now(),
    });
  }

  private buildCallbacks(sessionId: string): MutableCallbacks {
    return {
      onData: (chunk) =>
        this.emit(sessionId, {
          type: 'pty:data',
          sessionId,
          data: chunk,
          timestamp: Date.now(),
        }),
      onOsc133: (event: Osc133Event) => {
        const now = Date.now();
        if (event.marker === 'A') {
          // Prompt-start: record as tentative command start — if B follows
          // quickly it'll overwrite; if D follows directly (edge: command
          // executed silently between A and D without a B), duration still
          // captures it. B is the authoritative "user hit Enter" marker.
          this.lastCommandStartedAt.set(sessionId, now);
          this.emit(sessionId, {
            type: 'prompt:started',
            sessionId,
            timestamp: now,
          });
        } else if (event.marker === 'B') {
          // Command-start: authoritative "user pressed Enter, command is
          // about to run". Overwrite any A-recorded timestamp with this
          // more-accurate one.
          this.lastCommandStartedAt.set(sessionId, now);
          this.emit(sessionId, {
            type: 'command:started',
            sessionId,
            timestamp: now,
          });
        } else if (event.marker === 'D') {
          const startedAt = this.lastCommandStartedAt.get(sessionId);
          let durationMs: number;
          if (startedAt === undefined) {
            durationMs = 0;
            this.emit(sessionId, {
              type: 'system:warning',
              sessionId,
              code: 'osc133_d_without_start',
              message:
                'OSC 133 D marker observed without a preceding A/B marker; duration reported as 0.',
              timestamp: now,
            });
          } else {
            durationMs = now - startedAt;
            // Clear the tracker so the next D without an A/B is flagged.
            this.lastCommandStartedAt.delete(sessionId);
          }
          this.emit(sessionId, {
            type: 'command:ended',
            sessionId,
            exitCode: event.exitCode,
            durationMs,
            timestamp: now,
          });
        }
      },
      onExit: (exitCode) => void this.onPtyExit(sessionId, exitCode),
    };
  }

  private async onPtyExit(sessionId: string, exitCode: number | null): Promise<void> {
    this.handles.delete(sessionId);
    this.lastCommandStartedAt.delete(sessionId);
    const launcher = this.launchers.get(sessionId);
    if (launcher) {
      launcher.cancel();
      this.launchers.delete(sessionId);
    }
    if (this.shuttingDown) return;
    const now = new Date();
    try {
      await this.deps.db.drizzle
        .update(sessions)
        .set({ status: 'stopped', stoppedAt: now, updatedAt: now })
        .where(eq(sessions.id, sessionId));
    } catch (err) {
      console.error(`[orchestrator] failed to mark ${sessionId} stopped`, err);
    }
    this.emit(sessionId, {
      type: 'session:status',
      sessionId,
      status: 'stopped',
      exitCode,
      timestamp: Date.now(),
    });
    this.emit(sessionId, {
      type: 'session:stopped',
      sessionId,
      exitCode,
      timestamp: Date.now(),
    });
  }

  private emit(sessionId: string, event: WsEvent): void {
    this.deps.bus.emit(channelForSession(sessionId), event);
  }
}
