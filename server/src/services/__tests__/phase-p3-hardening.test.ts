import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, writeSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonlOrigin } from '../jsonl-origin.service.js';

// Phase P.3 — QA hardening regression pins.
//
// Covers H1 (bounded read) + H2 (yield-window invariance) + H3
// (commander-hook buildHookPayload pure shape transform).

describe('H1 — readJsonlOrigin bounded read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jsc-p3-h1-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('reads origin fields from a tiny JSONL without failure', () => {
    const p = join(dir, 'tiny.jsonl');
    writeFileSync(p, JSON.stringify({
      agentName: 'coder',
      teamName: 'jlp-patrimonio',
      sessionId: 'abc',
      cwd: '/repo/foo',
    }) + '\n');
    const origin = readJsonlOrigin(p);
    assert.deepEqual(origin, {
      agentName: 'coder',
      teamName: 'jlp-patrimonio',
      claudeSessionId: 'abc',
      cwd: '/repo/foo',
    });
  });

  test('bounded — a 2 MB JSONL with header on line 1 still parses fast + correctly', () => {
    const p = join(dir, 'big.jsonl');
    const fd = openSync(p, 'w');
    try {
      // Header record (well under 16 KB).
      writeSync(fd, JSON.stringify({
        agentName: 'pm',
        teamName: 'big-team',
        sessionId: 'uuid-big',
        cwd: '/repo/big',
      }) + '\n');
      // 2 MB of padding — 32 KB × 64 blocks of repeated garbage.
      const pad = 'x'.repeat(32 * 1024) + '\n';
      for (let i = 0; i < 64; i++) writeSync(fd, pad);
    } finally {
      closeSync(fd);
    }
    const t0 = Date.now();
    const origin = readJsonlOrigin(p);
    const elapsed = Date.now() - t0;
    // Should finish in well under 50ms — bounded to 16 KB of I/O. An
    // unbounded readFileSync on the 2 MB file would still be fast but
    // allocation-heavy; this guard catches a future regression that
    // slurps a 50+ MB file by timing against a loose bound.
    assert.ok(elapsed < 150, `bounded read should be fast, took ${elapsed}ms`);
    assert.equal(origin?.agentName, 'pm');
    assert.equal(origin?.teamName, 'big-team');
    assert.equal(origin?.claudeSessionId, 'uuid-big');
  });

  test('missing file → null (no throw)', () => {
    assert.equal(readJsonlOrigin(join(dir, 'does-not-exist.jsonl')), null);
  });

  test('empty file → null', () => {
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, '');
    assert.equal(readJsonlOrigin(p), null);
  });
});

describe('H2 — appendTranscriptPath does NOT bump updated_at', () => {
  // The production path lives in session.service.ts; we assert via
  // the SQL shape. Pre-patch the UPDATE was:
  //   UPDATE sessions SET transcript_paths = ?, updated_at = datetime('now') WHERE id = ?
  // Post-patch:
  //   UPDATE sessions SET transcript_paths = ? WHERE id = ?
  test('appendTranscriptPath source SQL no longer touches updated_at', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'session.service.ts'),
      'utf-8',
    );
    const appendBlock = src.split('appendTranscriptPath(')[1] ?? '';
    const firstCloseBrace = appendBlock.indexOf('  },');
    const body = appendBlock.slice(0, firstCloseBrace > 0 ? firstCloseBrace : 2000);
    assert.match(body, /UPDATE sessions SET transcript_paths = \?/);
    assert.ok(
      !/updated_at\s*=\s*datetime\('now'\)/.test(body),
      'appendTranscriptPath must not bump updated_at (Phase P.3 H2)',
    );
  });
});

describe('H3 — commander-hook buildHookPayload shape transform', () => {
  test('reshapes Claude hook input into Commander POST body', async () => {
    // @ts-expect-error — hook script is pure JS (.js), no .d.ts
    const { buildHookPayload } = await import('../../../../hooks/commander-hook.js');
    const input = {
      hook_event_name: 'Stop',
      session_id: 'uuid-abc',
      transcript_path: '/Users/me/.claude/projects/x/y.jsonl',
      cwd: '/repo/y',
      tool_name: 'Bash',
    };
    const payload = buildHookPayload(input);
    assert.deepEqual(payload, {
      event: 'Stop',
      sessionId: 'uuid-abc',
      data: {
        transcript_path: '/Users/me/.claude/projects/x/y.jsonl',
        cwd: '/repo/y',
        tool_name: 'Bash',
      },
    });
  });

  test('missing fields default safely (no silent unknown-event)', async () => {
    // @ts-expect-error — hook script is pure JS
    const { buildHookPayload } = await import('../../../../hooks/commander-hook.js');
    const payload = buildHookPayload({});
    assert.equal(payload.event, 'unknown'); // default when absent
    assert.equal(payload.sessionId, '');
    assert.equal(payload.data.transcript_path, '');
  });

  test('non-string fields coerce to empty string, never propagate as numbers/objects', async () => {
    // @ts-expect-error — hook script is pure JS
    const { buildHookPayload } = await import('../../../../hooks/commander-hook.js');
    const payload = buildHookPayload({
      hook_event_name: 42 as unknown as string,
      session_id: null as unknown as string,
      cwd: { not: 'a string' } as unknown as string,
    });
    assert.equal(payload.event, 'unknown');
    assert.equal(payload.sessionId, '');
    assert.equal(payload.data.cwd, '');
  });

  test('non-object input (null, undefined, number) falls through safely', async () => {
    // @ts-expect-error — hook script is pure JS
    const { buildHookPayload } = await import('../../../../hooks/commander-hook.js');
    assert.equal(buildHookPayload(null).event, 'unknown');
    assert.equal(buildHookPayload(undefined).event, 'unknown');
    assert.equal(buildHookPayload(42).event, 'unknown');
  });
});

describe('L1 — client ws.ts console.log is DEV-gated', () => {
  test('import.meta.env.DEV guard wraps the [ws] Connected log', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      join(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', '..', '..', '..', 'client', 'src', 'services', 'ws.ts'),
      'utf-8',
    );
    assert.match(src, /if \(import\.meta\.env\.DEV\) console\.log\('\[ws\] Connected'\)/);
  });
});
