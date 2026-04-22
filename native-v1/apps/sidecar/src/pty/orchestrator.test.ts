// Integration tests for PtyOrchestrator. Spawns a real zsh pty and drives it
// end-to-end. Verifies:
//   - session row lands in Drizzle with correct cwd + pid + status='active'
//   - OSC 133 prompt marker fires before the user's first command
//   - command:started (B) fires on preexec
//   - command:ended (D) fires on precmd with exit code
//   - session:stopped fires + DB row flipped to status='stopped' on `exit`
//
// These tests rely on the host's /bin/zsh + autoload add-zsh-hook, so they're
// macOS-only. Skipped on non-darwin to keep CI from running them on Linux.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { sessions } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';
import { EventBus, channelForSession } from '../ws/event-bus.js';
import { PtyOrchestrator } from './orchestrator.js';
import type { WsEvent } from '@jstudio-commander/shared';

const shouldRun = process.platform === 'darwin' && existsSync('/bin/zsh');
const maybe = shouldRun ? describe : describe.skip;

maybe('PtyOrchestrator — end-to-end pty + OSC 133', () => {
  let tmpDir: string;
  let dbPath: string;
  let zdotdir: string;
  let db: ReturnType<typeof initDatabase>;
  let bus: EventBus;
  let orch: PtyOrchestrator;
  let events: WsEvent[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pty-test-'));
    dbPath = join(tmpDir, 'test.db');
    zdotdir = join(tmpDir, 'zdotdir');
    process.env.JSTUDIO_ZDOTDIR = zdotdir;
    // Hook path resolver will find the dev-tree resources/osc133-hook.sh.
    db = initDatabase({ dbPath });
    bus = new EventBus();
    events = [];
    orch = new PtyOrchestrator({ db, bus });
  });

  afterEach(async () => {
    await orch.shutdown();
    db.raw.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.JSTUDIO_ZDOTDIR;
  });

  function subscribeToSession(sessionId: string) {
    bus.subscribe(channelForSession(sessionId), (_ch, ev) => events.push(ev));
  }

  async function waitFor<T extends WsEvent['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<WsEvent, { type: T }>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const found = events.find((e) => e.type === type);
      if (found) return found as Extract<WsEvent, { type: T }>;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`timed out waiting for ${type}; got: ${events.map((e) => e.type).join(',')}`);
  }

  it('spawns a session, emits created+status active, records DB row', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    expect(spawned.status).toBe('active');
    expect(spawned.ptyPid).toBeGreaterThan(0);

    const row = db.drizzle.select().from(sessions).where(eq(sessions.id, spawned.id)).get();
    expect(row).toBeTruthy();
    expect(row!.status).toBe('active');
    expect(row!.cwd).toBe(tmpDir);
    expect(row!.ptyPid).toBe(spawned.ptyPid);
  });

  it('fires A (prompt-started) once zsh finishes its first precmd', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    await waitFor('prompt:started', 6000);
  }, 10000);

  it('fires B (command:started) and D (command:ended) around a user command', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    await waitFor('prompt:started', 6000);

    // Type a command — `true` exits 0, `false` exits 1.
    orch.writeInput(spawned.id, 'true\n');
    const started = await waitFor('command:started', 6000);
    expect(started.sessionId).toBe(spawned.id);

    const ended = await waitFor('command:ended', 6000);
    expect(ended.sessionId).toBe(spawned.id);
    expect(ended.exitCode).toBe(0);
  }, 15000);

  it('updates DB to stopped + emits session:stopped on `exit`', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    await waitFor('prompt:started', 6000);

    orch.writeInput(spawned.id, 'exit\n');
    await waitFor('session:stopped', 6000);

    const row = db.drizzle.select().from(sessions).where(eq(sessions.id, spawned.id)).get();
    expect(row!.status).toBe('stopped');
    expect(row!.stoppedAt).toBeTruthy();
  }, 15000);
});
