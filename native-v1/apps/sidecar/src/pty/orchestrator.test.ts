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
    fromIndex = 0,
  ): Promise<Extract<WsEvent, { type: T }>> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      for (let i = fromIndex; i < events.length; i++) {
        if (events[i]!.type === type) return events[i] as Extract<WsEvent, { type: T }>;
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`timed out waiting for ${type}; got: ${events.map((e) => e.type).join(',')}`);
  }

  function cursor(): number {
    return events.length;
  }

  it('spawns a session, emits created+status active, records DB row', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
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
      skipClientLaunch: true,
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    await waitFor('prompt:started', 6000);
  }, 10000);

  it('fires B (command:started) and D (command:ended) around a user command', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
      effort: 'medium',
    });
    subscribeToSession(spawned.id);
    await waitFor('prompt:started', 6000);

    // Cursor past startup events — the first precmd emits a D marker (for
    // the shell's implicit $? = 0 at boot) before any user command runs. That
    // D emits a system:warning + command:ended with durationMs=0, which is
    // correct-by-dispatch but not what this assertion targets.
    const afterStartup = cursor();

    // `sleep 0.15` guarantees ~150ms elapsed so we can observe real duration.
    // A faster command like `true` can complete in sub-millisecond time and
    // reduce to a same-millisecond B+D pair with Date.now() rounding — that
    // would be a valid outcome (duration=0) but doesn't test durationMs
    // tracking meaningfully.
    orch.writeInput(spawned.id, 'sleep 0.15\n');
    const started = await waitFor('command:started', 6000, afterStartup);
    expect(started.sessionId).toBe(spawned.id);

    const ended = await waitFor('command:ended', 6000, afterStartup);
    expect(ended.sessionId).toBe(spawned.id);
    expect(ended.exitCode).toBe(0);
    // N2 Task 8: durationMs must reflect real elapsed time, not hardcoded 0.
    expect(ended.durationMs).toBeGreaterThanOrEqual(100);
    expect(ended.durationMs).toBeLessThan(2000);
  }, 15000);

  it('emits system:warning + durationMs=0 for the startup D-without-B edge', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
      effort: 'medium',
    });
    subscribeToSession(spawned.id);

    // First precmd fires BEFORE any user command — emits D with $?=0 + A.
    // That D has no preceding B, so we expect durationMs=0 + a
    // system:warning matching the osc133_d_without_start code.
    const firstEnd = await waitFor('command:ended', 6000);
    expect(firstEnd.durationMs).toBe(0);
    const warn = await waitFor('system:warning', 500);
    expect(warn.code).toBe('osc133_d_without_start');
  }, 10000);

  it('updates DB to stopped + emits session:stopped on `exit`', async () => {
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
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
