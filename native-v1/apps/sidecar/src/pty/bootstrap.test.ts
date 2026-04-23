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

  // N2.1.6 test helpers — produce synthetic OSC title emissions
  // (\x1b]0;<text>\x07) that mimic Claude Code's Ink spinner updates.
  // Each call returns ONE emission; tests compose sequences.
  const OSC_TITLE_1 = '\x1b]0;✳ Claude Code\x07'; // banner
  const OSC_TITLE_2 = '\x1b]0;⠂ Claude Code\x07'; // spinner frame 1
  const OSC_TITLE_3 = '\x1b]0;⠄ Claude Code\x07'; // spinner frame 2

  it('writes clientBinary + newline only after A marker', async () => {
    const { handle, writes, writeSpy } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'skip' },
      handle,
      readyTimeoutMs: 5_000,
    });

    // Pre-A markers: no write
    launcher.onData('anything');
    expect(writes).toHaveLength(0);

    // A marker → claude\n
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    expect(writeSpy).toHaveBeenLastCalledWith('claude\n');

    launcher.cancel();
  });

  it('N2.1.6: without OSC title gate, quiet period alone does NOT trigger inject', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 30,
      readyTimeoutMs: 5_000,
      submitDelayMs: 30,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    // Claude output arrives but no title escapes — gate never opens.
    // Even after `quietMs` passes in silence, we do NOT inject.
    launcher.onData('Welcome to Claude.');
    await new Promise((r) => setTimeout(r, 80));
    expect(writes).toEqual(['claude\n']);
    launcher.cancel();
  });

  it('N2.1.6: OSC title opens gate; inject fires after post-gate quietMs', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 60,
      readyTimeoutMs: 5_000,
      submitDelayMs: 150, // long enough that the \r doesn't land during the inject assertion
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    // Gate opens on first chunk with OSC title.
    launcher.onData(`boot chrome${OSC_TITLE_1}more chrome`);
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toEqual(['claude\n']);
    // Chunk resets quiet timer; inject still not fired.
    launcher.onData('more boot chrome');
    await new Promise((r) => setTimeout(r, 30));
    expect(writes).toEqual(['claude\n']);
    // Now wait out the quiet window (60ms since last chunk).
    await new Promise((r) => setTimeout(r, 70));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // After submitDelayMs (150ms) of post-write silence, \r commits.
    await new Promise((r) => setTimeout(r, 200));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('N2.1.6: post-write pty chunks extend the quiesce; commit waits for gap', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 30,
      submitDelayMs: 80,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData(OSC_TITLE_1);
    await new Promise((r) => setTimeout(r, 60));
    // After quietMs post-gate, content is injected.
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // Claude continues to render the paste — each chunk pushes submit out.
    launcher.onData('rendering paste line 1');
    await new Promise((r) => setTimeout(r, 40));
    launcher.onData('rendering paste line 2');
    await new Promise((r) => setTimeout(r, 40));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    await new Promise((r) => setTimeout(r, 120));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('N2.1.6: hard deadline commits even if post-paste pty never quiesces', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      quietMs: 30,
      submitDelayMs: 500,
      submitMaxWaitMs: 120,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData(OSC_TITLE_1);
    await new Promise((r) => setTimeout(r, 60));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    // Feed chunks at intervals shorter than submitDelayMs=500 so chunk-gap
    // quiesce never triggers — hard deadline 120ms will.
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 50));
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 50));
    launcher.onData('chunk');
    await new Promise((r) => setTimeout(r, 60));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('N2.1.6: readyTimeout fallback — warns and proceeds with bootstrap (no error)', async () => {
    const { handle, writes } = makeFakeHandle();
    const warnSpy = vi.fn();
    const errSpy = vi.fn();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'BOOT\n' },
      handle,
      readyTimeoutMs: 60,
      quietMs: 100,  // not relevant when OSC never seen
      submitDelayMs: 200,
      submitMaxWaitMs: 2_000,
      onWarning: warnSpy,
      onError: errSpy,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    // No OSC titles ever arrive. Wait past readyTimeoutMs (60ms) but before
    // the submitDelayMs (200ms)-gated commit would fire.
    await new Promise((r) => setTimeout(r, 120));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Claude TUI ready signal .+ not observed/),
    );
    expect(errSpy).not.toHaveBeenCalled();
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~']);
    await new Promise((r) => setTimeout(r, 200));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'BOOT\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('appends newline when bootstrap content lacks trailing newline, then \\r', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'HELLO' },
      handle,
      quietMs: 30,
      submitDelayMs: 20,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData(OSC_TITLE_1);
    await new Promise((r) => setTimeout(r, 80));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HELLO', '\n', '\x1b[201~', '\r']);
    launcher.cancel();
  });

  it('cancel() before submit fires aborts the \\r write', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'inject', path: '/x', content: 'HI\n' },
      handle,
      quietMs: 30,
      submitDelayMs: 200,
      submitMaxWaitMs: 2_000,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData(OSC_TITLE_1);
    await new Promise((r) => setTimeout(r, 60));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HI\n', '\x1b[201~']);
    launcher.cancel();
    await new Promise((r) => setTimeout(r, 250));
    expect(writes).toEqual(['claude\n', '\x1b[200~', 'HI\n', '\x1b[201~']);
  });

  it('skip plan launches client but writes no bootstrap content', async () => {
    const { handle, writes } = makeFakeHandle();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'skip' },
      handle,
      quietMs: 30,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    launcher.onData(OSC_TITLE_1);
    await new Promise((r) => setTimeout(r, 80));
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

  it('skip plan — readyTimeout fallback proceeds cleanly with no writes beyond claude\\n', async () => {
    const { handle, writes } = makeFakeHandle();
    const warnSpy = vi.fn();
    const launcher = new BootstrapLauncher({
      clientBinary: 'claude',
      plan: { kind: 'skip' },
      handle,
      readyTimeoutMs: 60,
      quietMs: 1_000,
      onWarning: warnSpy,
    });
    launcher.onOsc133({ marker: 'A', params: '', exitCode: null, raw: '', byteOffset: 0 });
    await new Promise((r) => setTimeout(r, 100));
    expect(warnSpy).toHaveBeenCalled();
    expect(writes).toEqual(['claude\n']);
    launcher.cancel();
  });
});

// Sanity on the default constant — if someone bumps it accidentally the tests
// above would get noisy; tie the intent in.
describe('constants', () => {
  it('DEFAULT_QUIET_MS is 500 (N2.1.6 post-gate quiet window)', () =>
    expect(DEFAULT_QUIET_MS).toBe(500));
});
