// PtyOrchestrator — implements the SessionOrchestrator contract in terms of
// PtyManager + DB + EventBus. Owns the per-session map from sessionId to
// PtyHandle so WS pty:input events can route to the right child.
//
// Task 6 responsibilities (this file): cold spawn zsh with OSC 133 hook,
// persist session row, forward pty.onData bytes to WS, forward OSC 133 events
// to WS, mark session stopped on exit.
// Task 7 extends: claim from pool if available.
// Task 9 extends: read sessionTypes.bootstrapPath, launch `claude`, inject
// bootstrap content after Claude boots.

import { basename } from 'node:path';
import type { InitializedDb, NewSession } from '@jstudio-commander/db';
import { sessions } from '@jstudio-commander/db';
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
import { spawnPty, type PtyHandle } from './manager.js';
import { ensureZdotdir } from './hook-path.js';

export interface PtyOrchestratorDeps {
  db: InitializedDb;
  bus: EventBus;
}

export class PtyOrchestrator implements SessionOrchestrator {
  private readonly zdotdir: string;
  private readonly handles = new Map<string, PtyHandle>();
  private shuttingDown = false;

  constructor(private readonly deps: PtyOrchestratorDeps) {
    const { zdotdir } = ensureZdotdir();
    this.zdotdir = zdotdir;
  }

  async spawnSession(input: SpawnSessionInput): Promise<SpawnedSession> {
    const now = Date.now();
    const sessionId = crypto.randomUUID();

    const projectName = input.projectName ?? (basename(input.projectPath) || 'project');
    const projectId = await upsertProject(this.deps.db, input.projectPath, projectName);

    const handle = spawnPty({
      sessionId,
      cwd: input.projectPath,
      zdotdir: this.zdotdir,
      cols: 120,
      rows: 32,
      onData: (chunk) => this.emit(sessionId, {
        type: 'pty:data',
        sessionId,
        data: chunk,
        timestamp: Date.now(),
      }),
      onOsc133: (ev) => {
        if (ev.marker === 'A') {
          this.emit(sessionId, {
            type: 'prompt:started',
            sessionId,
            timestamp: Date.now(),
          });
        } else if (ev.marker === 'B') {
          this.emit(sessionId, {
            type: 'command:started',
            sessionId,
            timestamp: Date.now(),
          });
        } else if (ev.marker === 'D') {
          this.emit(sessionId, {
            type: 'command:ended',
            sessionId,
            exitCode: ev.exitCode,
            durationMs: 0,
            timestamp: Date.now(),
          });
        }
      },
      onExit: (exitCode) => void this.onPtyExit(sessionId, exitCode),
    });

    this.handles.set(sessionId, handle);

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
    // onPtyExit will cleanup the handle map + mark DB row stopped.
  }

  writeInput(sessionId: string, data: string): void {
    const handle = this.handles.get(sessionId);
    if (handle) handle.write(data);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const handle of this.handles.values()) {
      handle.kill('SIGTERM');
    }
    this.handles.clear();
  }

  private async onPtyExit(sessionId: string, exitCode: number | null): Promise<void> {
    this.handles.delete(sessionId);
    if (this.shuttingDown) return; // DB may be closed during teardown
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
