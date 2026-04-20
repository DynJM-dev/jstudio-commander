import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Phase Y Rotation 1 — debug.routes JSONL append contract.
// The route handler writes one JSON Lines entry per POST to
// `~/.jstudio-commander/codeman-diff.jsonl`. We can't easily boot
// Fastify for a pure unit test without pulling in the full app wiring,
// so this test verifies the JSONL append invariant via a direct mirror
// of the write path — same fs.appendFileSync + mkdirSync(recursive)
// pattern.
//
// Production endpoint is at `server/src/routes/debug.routes.ts`. Any
// drift between this mirror and the production handler reveals as a
// PHASE_REPORT cross-reference failure — matches the poller-yield and
// phase-t-mirror mirror-style test pattern.

import { appendFileSync, mkdirSync } from 'node:fs';

const writeJsonLine = (filePath: string, payload: unknown): void => {
  mkdirSync(join(filePath, '..'), { recursive: true });
  appendFileSync(filePath, JSON.stringify(payload) + '\n');
};

describe('Phase Y Rotation 1 — debug.routes JSONL append contract', () => {
  test('first write creates the directory + appends one line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeman-diff-'));
    const target = join(dir, 'nested', 'codeman-diff.jsonl');
    try {
      const payload = {
        ts: 1_700_000_000_000,
        sessionId: 'sess-A',
        codemanIsWorking: true,
        codemanLabel: 'Reading foo.ts',
        codemanSubtype: 'tool_exec',
        legacyIsWorking: false,
        legacyLabel: null,
        messagesTail: [{ id: 'm1', role: 'assistant', blockTypes: ['tool_use'] }],
        sessionStatus: 'idle',
        sessionStateKind: 'Idle',
      };
      writeJsonLine(target, payload);
      assert.ok(existsSync(target), 'file created at nested path');
      const contents = readFileSync(target, 'utf8');
      assert.equal(contents.split('\n').filter(Boolean).length, 1);
      const parsed = JSON.parse(contents.trim());
      assert.deepEqual(parsed, payload);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('subsequent writes append without truncating prior entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeman-diff-'));
    const target = join(dir, 'codeman-diff.jsonl');
    try {
      writeJsonLine(target, { n: 1 });
      writeJsonLine(target, { n: 2 });
      writeJsonLine(target, { n: 3 });
      const lines = readFileSync(target, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { n: number });
      assert.deepEqual(lines, [{ n: 1 }, { n: 2 }, { n: 3 }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('JSONL format — each entry is a valid JSON object on its own line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codeman-diff-'));
    const target = join(dir, 'codeman-diff.jsonl');
    try {
      writeJsonLine(target, { complex: { nested: [1, 2, { deep: true }] } });
      const contents = readFileSync(target, 'utf8');
      // Exactly one newline, at the end.
      assert.equal(contents.endsWith('\n'), true);
      assert.equal((contents.match(/\n/g) ?? []).length, 1);
      // Body is a valid JSON object (not an array, not primitive).
      const parsed = JSON.parse(contents.trim());
      assert.equal(typeof parsed, 'object');
      assert.equal(Array.isArray(parsed), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
