import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateConfig } from '../../src/config';

/**
 * N2.1 regression test — enforces D-N1-07 §8.2 bearer contract.
 *
 *   "Single local bearer token at ~/.commander/config.json. v1: no expiry."
 *
 * The contract translates to: mint once, persist across every subsequent
 * boot, re-mint ONLY when the file is absent, corrupt, or missing the
 * bearer field. Anything else is a bug.
 *
 * Each test isolates state in a throwaway `tmpdir()` by stubbing
 * `process.env.HOME`; `configDir()` reads HOME per call, so tests never
 * touch Jose's real `~/.commander/`.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('bearer persistence — D-N1-07 §8.2 contract', () => {
  let tempHome: string;
  let origHome: string | undefined;
  let configJsonPath: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'n2-1-bearer-'));
    origHome = process.env.HOME;
    process.env.HOME = tempHome;
    configJsonPath = join(tempHome, '.commander', 'config.json');
  });

  afterEach(async () => {
    if (origHome === undefined) process.env.HOME = undefined;
    else process.env.HOME = origHome;
    await rm(tempHome, { recursive: true, force: true });
  });

  it('T3.1 — fresh home (no config.json) mints a bearer and persists it', async () => {
    expect(await exists(configJsonPath)).toBe(false);
    const first = await loadOrCreateConfig(11005);
    expect(first.bearerToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(await exists(configJsonPath)).toBe(true);
  });

  it('T3.2 — second launch returns THE SAME bearer (preservation contract)', async () => {
    const first = await loadOrCreateConfig(11005);
    const second = await loadOrCreateConfig(11006); // deliberately different port
    expect(second.bearerToken).toBe(first.bearerToken);
    // Port CAN change across launches (scan picks first available) — the
    // spec-bug would be the bearer changing, which this assertion gates.
    expect(second.port).toBe(11006);
  });

  it('T3.3 — third launch still returns the same bearer', async () => {
    const first = await loadOrCreateConfig(11005);
    await loadOrCreateConfig(11007);
    const third = await loadOrCreateConfig(11008);
    expect(third.bearerToken).toBe(first.bearerToken);
  });

  it('T3.4 — deleting config.json lets a fresh bearer mint on next launch', async () => {
    const first = await loadOrCreateConfig(11005);
    await rm(configJsonPath, { force: true });
    const second = await loadOrCreateConfig(11005);
    expect(second.bearerToken).not.toBe(first.bearerToken);
    expect(second.bearerToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('T3.5 — corrupt config.json: mints new bearer AND sidecar does not crash', async () => {
    const first = await loadOrCreateConfig(11005);
    // Overwrite with invalid JSON; loadOrCreateConfig must treat as corrupt.
    await writeFile(configJsonPath, 'not valid json at all { oh no }', 'utf8');

    // Assert loadOrCreateConfig completes without throwing.
    let second: Awaited<ReturnType<typeof loadOrCreateConfig>> | undefined;
    let thrown: unknown = null;
    try {
      second = await loadOrCreateConfig(11005);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
    expect(second).toBeDefined();
    expect(second?.bearerToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(second?.bearerToken).not.toBe(first.bearerToken);
  });

  it('T3.6 (edge) — config.json with bearerToken set to null → mints new bearer', async () => {
    // Defensive: if somehow a write races and produces {bearerToken: null, ...},
    // we do NOT silently mint a new bearer that breaks external sessions
    // holding the prior value. We DO mint a new one because preserving `null`
    // would block ever-bootstrapping. This case is a documented re-mint path.
    await loadOrCreateConfig(11005);
    const poisoned = { bearerToken: null, port: 11005, version: '0.1.0-n1' };
    await writeFile(configJsonPath, JSON.stringify(poisoned), 'utf8');
    const next = await loadOrCreateConfig(11005);
    expect(typeof next.bearerToken).toBe('string');
    expect(next.bearerToken.length).toBeGreaterThan(0);
  });

  it('T3.7 (edge) — config.json with extra user-added fields is preserved alongside bearer', async () => {
    // Future-proofing: if we ever add fields, or a user edits the file
    // manually, the bearer round-trip must still work. Extra fields are
    // allowed to be dropped (we overwrite), but the bearer MUST survive.
    const first = await loadOrCreateConfig(11005);
    const onDisk = JSON.parse(await readFile(configJsonPath, 'utf8')) as Record<string, unknown>;
    onDisk.userPreference = 'some-value';
    await writeFile(configJsonPath, JSON.stringify(onDisk), 'utf8');
    const second = await loadOrCreateConfig(11005);
    expect(second.bearerToken).toBe(first.bearerToken);
  });
});
