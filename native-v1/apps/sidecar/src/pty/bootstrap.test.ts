// Unit tests for planBootstrap + BootstrapLauncher. No pty spawn required;
// launcher is driven by fake Osc133Event and fake onData chunks.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planBootstrap, BootstrapLauncher, DEFAULT_QUIET_MS } from './bootstrap.js';
import type { PtyHandle } from './manager.js';

describe('planBootstrap', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bootstrap-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns skip for null bootstrapPath (raw sessions)', () => {
    const plan = planBootstrap({ sessionTypeId: 'raw', bootstrapPath: null });
    expect(plan.kind).toBe('skip');
  });

  it('returns inject with file contents when file exists', () => {
    const path = join(dir, 'pm-bootstrap.md');
    writeFileSync(path, 'You are PM. Bootstrap loaded.');
    const plan = planBootstrap({ sessionTypeId: 'pm', bootstrapPath: path });
    expect(plan.kind).toBe('inject');
    if (plan.kind === 'inject') {
      expect(plan.content).toBe('You are PM. Bootstrap loaded.');
      expect(plan.path).toBe(path);
    }
  });

  it('returns error (no silent fallback) when PM/Coder bootstrap missing', () => {
    const plan = planBootstrap({
      sessionTypeId: 'pm',
      bootstrapPath: join(dir, 'does-not-exist.md'),
    });
    expect(plan.kind).toBe('error');
    if (plan.kind === 'error') {
      expect(plan.message).toMatch(/Bootstrap file not found/);
      expect(plan.message).toMatch(/pm/);
    }
  });

  it('expands ~ to HOME in bootstrap paths', () => {
    // We can only assert the error path contains the expanded absolute path,
    // since ~ doesn't exist as a literal dir and we don't want to touch HOME.
    const plan = planBootstrap({
      sessionTypeId: 'pm',
      bootstrapPath: '~/nonexistent-jstudio-bootstrap-xyz.md',
    });
    expect(plan.kind).toBe('error');
    if (plan.kind === 'error') {
      expect(plan.message).not.toMatch(/^~\//); // expanded, not literal tilde
      expect(plan.message).toMatch(new RegExp(`${process.env.HOME?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? ''}`));
    }
  });
});

describe('BootstrapLauncher', () => {
  function makeFakeHandle() {
    const writes: string[] = [];
    const handle = {
      pid: 999,
      sessionId: 's-1',
      write: vi.fn((data: string) => writes.push(data)),
      resize: vi.fn(),
      kill: vi.fn(),
      isAlive: () => true,
      rebind: vi.fn(),
      setSessionId: vi.fn(),
    } as unknown as PtyHandle;
    return { handle, writes, writeSpy: handle.write as unknown as ReturnType<typeof vi.fn> };
  }

  it('writes clientBinary + newline only after A marker', async () => {
    const { handle, writes, writeSpy } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'skip' },
      handle,
      quietMs: 50,
    });

    // Pre-A markers: no write
    launcher.onData('anything');
    expect(writes).toHaveLength(0);

    // A marker → claude\n
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    expect(writeSpy).toHaveBeenLastCalledWith('claude\n');

    launcher.cancel();
  });

  it('N2.1.5: wraps content in bracketed-paste markers + commits after quiesce', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/ignored', content: 'BOOT\n' },
      handle,
      quietMs: 80,
      readyTimeoutMs: 5_000,
      submitDelayMs: 30,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    expect(writes).toEqual(['claude\n']);

    launcher.onData('Welcome to Claude.');
    launcher.onData('Loaded tools.');
    await new Promise((r) => setTimeout(r, 30));
    // Still within Claude-ready quiet window — no paste yet.
    expect(writes).toEqual(['claude\n']);
    await new Promise((r) => setTimeout(r, 70));
    // After 80ms quiet the bracketed-paste-wrapped content is flushed.
    // \r is still pending in the post-write quiesce window.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    await new Promise((r) => setTimeout(r, 60));
    // After submitDelayMs of post-write quiesce, commit byte lands.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('N2.1.5: post-write pty chunks extend the quiesce; commit waits for gap', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 40,
      submitDelayMs: 80,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData('banner');
    await new Promise((r) => setTimeout(r, 60));
    // Content has been flushed; submitTimer is counting toward commit.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // Claude continues to render the paste — each chunk pushes submit out.
    launcher.onData('rendering paste line 1');
    await new Promise((r) => setTimeout(r, 40));
    launcher.onData('rendering paste line 2');
    await new Promise((r) => setTimeout(r, 40));
    // Still no \r — we kept pushing it.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // Now let silence pass.
    await new Promise((r) => setTimeout(r, 120));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('N2.1.5: hard deadline commits even if pty never quiesces', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 20,
      submitDelayMs: 500,
      submitMaxWaitMs: 120,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData('banner');
    await new Promise((r) => setTimeout(r, 40));
    // Content flushed.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // Keep feeding chunks at intervals shorter than submitDelayMs=500 so
    // chunk-gap-based quiesce never triggers — but hard deadline 120ms will.
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 50));
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 50));
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 60));
    // By now past hard-deadline from paste flush — commit has fired.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('appends newline when bootstrap content lacks trailing newline, then \\r to submit', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'HELLO' },
      handle,
      quietMs: 40,
      submitDelayMs: 20,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData('banner');
    await new Promise((r) => setTimeout(r, 100));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HELLO', '\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('cancel() before submit fires aborts the \\r write', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'HI\n' },
      handle,
      quietMs: 20,
      submitDelayMs: 200,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData('banner');
    await new Promise((r) => setTimeout(r, 50));
    // Content + bracketed-paste wrappers written; \r timer still pending.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HI\n', '\x1b[201~']);
    launcher.cancel();
    await new Promise((r) => setTimeout(r, 250));
    // No \r should have fired after cancel.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HI\n', '\x1b[201~']);
  });

  it('skip plan launches client but writes no bootstrap content', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'skip' },
      handle,
      quietMs: 40,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData('banner');
    await new Promise((r) => setTimeout(r, 100));
    expect(writes).toEqual(['claude\n']);
    launcher.cancel();
  });

  it('error plan surfaces via onError callback and never writes claude', () => {
    const { handle, writes } = makeFakeHandle();
    const errSpy = vi.fn();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'error', message: 'missing bootstrap' },
      handle,
      onError: errSpy,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    expect(writes).toHaveLength(0);
    expect(errSpy).toHaveBeenCalledWith(expect.any(Error));
    expect((errSpy.mock.calls[0]![0] as Error).message).toBe('missing bootstrap');
    launcher.cancel();
  });

  it('readyTimeout fires when client binary produces no output', async () => {
    const { handle } = makeFakeHandle();
    const errSpy = vi.fn();
    const launcher = new BootstrapLauncher({
      clientBinary: 'doesnotexist',
      plan: { kind: 'skip' },
      handle,
      quietMs: 40,
      readyTimeoutMs: 80,
      onError: errSpy,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    await new Promise((r) => setTimeout(r, 150));
    expect(errSpy).toHaveBeenCalled();
    expect((errSpy.mock.calls[0]![0] as Error).message).toMatch(/produced no output/);
    launcher.cancel();
  });
});

// Sanity on the default constant — if someone bumps it accidentally the tests
// above would get noisy; tie the intent in.
describe('constants', () => {
  it('DEFAULT_QUIET_MS is 800', () => expect(DEFAULT_QUIET_MS).toBe(800));
});
