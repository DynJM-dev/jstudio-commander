import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watch as chokidarWatch } from 'chokidar';
import { jsonlDiscoveryService } from '../jsonl-discovery.service.js';

// Phase T Patch 0 — regression for spawn-time JSONL binding. The
// production helper (session.service.bindClaudeSessionFromJsonl) is
// a fire-and-forget side-effecting wrapper around chokidar + DB
// writes, so we test the three load-bearing pieces in isolation
// without standing up the full service / tmux / DB stack:
//
//   1. The encoded-cwd path matches what jsonlDiscoveryService
//      produces (protocol contract with Claude Code — if we got
//      this wrong we'd watch the wrong directory).
//   2. A chokidar watch on that dir with the production options
//      (depth:0, ignoreInitial:true, .jsonl-only ignore predicate)
//      fires an `add` event when a new UUID-named JSONL appears.
//   3. The UUID regex gates out non-matching filenames so a stray
//      temp file in the dir doesn't false-bind the session.

const CLAUDE_JSONL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

const watchUntilReady = (dir: string, timeoutMs: number) => {
  // Mirror production options (session.service.bindClaudeSessionFromJsonl).
  // No `ignored` predicate — see the comment there for why.
  const watcher = chokidarWatch(dir, {
    depth: 0,
    ignoreInitial: true,
    persistent: false,
  });
  const ready = new Promise<void>((resolve) => {
    watcher.once('ready', () => resolve());
  });
  const firstAdd = new Promise<{ path: string | null; timedOut: boolean }>((resolve) => {
    const timer = setTimeout(() => {
      watcher.close().catch(() => { /* noop */ });
      resolve({ path: null, timedOut: true });
    }, timeoutMs);
    watcher.once('add', (p: string) => {
      clearTimeout(timer);
      watcher.close().catch(() => { /* noop */ });
      resolve({ path: p, timedOut: false });
    });
  });
  return { ready, firstAdd };
};

describe('Phase T Patch 0 — spawn JSONL binding', () => {
  test('encodeProjectPath matches Claude Code convention (cwd → "-"-delimited)', () => {
    // The encoding is the only place Commander has to agree with
    // Claude Code on disk layout. If this drifts we watch the wrong
    // dir and silently miss every spawn.
    assert.equal(
      jsonlDiscoveryService.encodeProjectPath('/Users/jose/projects/foo'),
      '-Users-jose-projects-foo',
    );
    assert.equal(
      jsonlDiscoveryService.encodeProjectPath('/tmp/x'),
      '-tmp-x',
    );
  });

  test('chokidar watch fires on new UUID-named .jsonl appearing in encoded dir', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'spawn-bind-'));
    const encoded = jsonlDiscoveryService.encodeProjectPath(scratch);
    const projectsDir = mkdtempSync(join(tmpdir(), 'projects-'));
    const targetDir = join(projectsDir, encoded);
    mkdirSync(targetDir, { recursive: true });

    const { ready, firstAdd } = watchUntilReady(targetDir, 5_000);
    // On macOS chokidar wraps fsevents and needs the ready event to
    // fire before it reliably sees subsequent adds. Waiting on
    // 'ready' removes the race that a fixed sleep left in earlier
    // versions of this test.
    await ready;

    const uuid = '11112222-3333-4444-5555-666677778888';
    const jsonlPath = join(targetDir, `${uuid}.jsonl`);
    writeFileSync(jsonlPath, '{"type":"meta"}\n');

    const result = await firstAdd;
    assert.equal(result.timedOut, false, 'watcher should see the add within 5s');
    assert.equal(result.path, jsonlPath);
    // Extract UUID from the received path and verify UUID-regex gate
    const fname = (result.path ?? '').split('/').pop() ?? '';
    assert.ok(CLAUDE_JSONL_UUID_RE.test(fname), `${fname} should match UUID pattern`);
    const extracted = fname.replace(/\.jsonl$/i, '');
    assert.equal(extracted, uuid);

    rmSync(projectsDir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  test('UUID regex rejects non-Claude JSONLs (avoid false-bind on stray files)', () => {
    // Claude Code names its JSONLs strictly <uuid>.jsonl. Anything
    // else in the encoded-cwd directory is noise we must ignore —
    // otherwise a random editor swap file could claim the session.
    assert.equal(CLAUDE_JSONL_UUID_RE.test('11112222-3333-4444-5555-666677778888.jsonl'), true);
    assert.equal(CLAUDE_JSONL_UUID_RE.test('not-a-uuid.jsonl'), false);
    assert.equal(CLAUDE_JSONL_UUID_RE.test('11112222-3333-4444-5555-666677778888.jsonl.tmp'), false);
    assert.equal(CLAUDE_JSONL_UUID_RE.test('state.json'), false);
    assert.equal(CLAUDE_JSONL_UUID_RE.test('11112222-3333-4444-5555-66667777.jsonl'), false);
  });

  test('timeout fires when no .jsonl ever appears', async () => {
    // Safety timeout is load-bearing — without it the watcher FD
    // would leak for every session whose Claude never boots.
    const projectsDir = mkdtempSync(join(tmpdir(), 'projects-'));
    const targetDir = join(projectsDir, 'some-dir');
    mkdirSync(targetDir, { recursive: true });

    const { ready, firstAdd } = watchUntilReady(targetDir, 400);
    await ready;
    const result = await firstAdd;
    assert.equal(result.timedOut, true);
    assert.equal(result.path, null);
    rmSync(projectsDir, { recursive: true, force: true });
  });

  test('ignoreInitial prevents matching pre-existing files in the dir', async () => {
    // If a session re-binds on a dir that already had a JSONL (e.g.
    // a crashed prior session), we must NOT bind to the old file —
    // that would steal a sibling session's claude_session_id.
    const projectsDir = mkdtempSync(join(tmpdir(), 'projects-'));
    const targetDir = join(projectsDir, 'existing');
    mkdirSync(targetDir, { recursive: true });
    const stale = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeFileSync(join(targetDir, `${stale}.jsonl`), '{"pre":"existing"}\n');

    const { ready, firstAdd } = watchUntilReady(targetDir, 500);
    await ready;
    const result = await firstAdd;
    // Should time out — ignoreInitial:true hides the pre-existing file.
    assert.equal(result.timedOut, true);
    rmSync(projectsDir, { recursive: true, force: true });
  });
});
