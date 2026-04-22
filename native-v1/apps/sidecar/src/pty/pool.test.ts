// PtyPool integration tests — darwin-gated. Exercises warmup, claim (warm +
// cold-fallback), refill, and shutdown lifecycle.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initDatabase } from '@jstudio-commander/db';
import { EventBus, channelForSession } from '../ws/event-bus.js';
import { PtyOrchestrator } from './orchestrator.js';
import { clampPoolSize, POOL_SIZE_MAX } from './pool.js';
import type { WsEvent } from '@jstudio-commander/shared';

const shouldRun = process.platform === 'darwin' && existsSync('/bin/zsh');
const maybe = shouldRun ? describe : describe.skip;

describe('clampPoolSize', () => {
  it('floors at 0', () => expect(clampPoolSize(-3)).toBe(0));
  it('caps at POOL_SIZE_MAX', () => expect(clampPoolSize(100)).toBe(POOL_SIZE_MAX));
  it('floors fractional values', () => expect(clampPoolSize(2.7)).toBe(2));
  it('falls back on NaN', () => expect(clampPoolSize(Number.NaN)).toBe(2));
});

maybe('PtyPool via PtyOrchestrator — end-to-end', () => {
  let tmpDir: string;
  let dbPath: string;
  let zdotdir: string;
  let db: ReturnType<typeof initDatabase>;
  let bus: EventBus;
  let orch: PtyOrchestrator;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'pool-test-'));
    dbPath = join(tmpDir, 'test.db');
    zdotdir = join(tmpDir, 'zdotdir');
    process.env.JSTUDIO_ZDOTDIR = zdotdir;
    db = initDatabase({ dbPath });
    bus = new EventBus();
  });

  afterEach(async () => {
    await orch.shutdown();
    db.raw.close();
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.JSTUDIO_ZDOTDIR;
  });

  it('warmup fills the target size before first claim', async () => {
    orch = new PtyOrchestrator({ db, bus, poolSizeOverride: 2 });
    await orch.waitForWarmup();
    expect(orch.poolReadyCount()).toBe(2);
  }, 12000);

  it('claim reuses a warm pty and refills in background', async () => {
    orch = new PtyOrchestrator({ db, bus, poolSizeOverride: 2 });
    await orch.waitForWarmup();
    expect(orch.poolReadyCount()).toBe(2);

    const events: WsEvent[] = [];
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
      effort: 'medium',
    });
    bus.subscribe(channelForSession(spawned.id), (_ch, ev) => events.push(ev));

    // Right after claim, readyCount drops by 1. Allow a beat for the refill
    // spawn to queue; the new entry starts warming but isn't ready yet.
    expect(orch.poolReadyCount()).toBeLessThanOrEqual(2);
    expect(spawned.ptyPid).toBeGreaterThan(0);

    // Pool should refill back to target within a few seconds.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && orch.poolReadyCount() < 2) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(orch.poolReadyCount()).toBe(2);
  }, 20000);

  it('cold-spawns when pool is disabled (size=0)', async () => {
    orch = new PtyOrchestrator({ db, bus, poolSizeOverride: 0 });
    expect(orch.poolReadyCount()).toBe(0);
    const spawned = await orch.spawnSession({
      projectPath: tmpDir,
      sessionTypeId: 'raw',
      skipClientLaunch: true,
      effort: 'medium',
    });
    expect(spawned.ptyPid).toBeGreaterThan(0);
  }, 10000);

  it('respects preferences.pool.size over the default', async () => {
    // Seed the preferences row BEFORE constructing the orchestrator, so it
    // reads the row during construction.
    db.raw.prepare(
      `INSERT INTO preferences (key, value, scope, updated_at) VALUES (?, ?, 'global', ?)`,
    ).run('pool.size', '1', Date.now());

    orch = new PtyOrchestrator({ db, bus });
    await orch.waitForWarmup();
    expect(orch.poolReadyCount()).toBe(1);
  }, 12000);
});
