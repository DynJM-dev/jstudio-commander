// Issue 11 — transcript_paths must dedup by basename. Two paths ending
// in the same `<uuid>.jsonl` point to the same JSONL file even when
// their parent-dir encodings differ (macOS case-insensitive FS turns
// `~/Desktop/Projects/JSTUDIO/` and `~/.../JStudio/` into the same
// directory; the claude-projects encoded variants `-JSTUDIO-` and
// `-JStudio-` both land as real entries in `~/.claude/projects/` but
// read the same underlying file).
//
// Without basename dedup, chat endpoint loads the same JSONL twice and
// every assistant message renders twice — the symptom Jose hit when
// his bootstrap-ack rendered as two identical assistant blocks.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-dedup-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { getDb, closeDb } = await import('../../db/connection.js');
const { sessionService } = await import('../session.service.js');

getDb();

after(() => {
  closeDb();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seedSession = () => {
  const id = randomUUID();
  return sessionService.upsertSession({
    id,
    name: 'dedup-test',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'working',
  }).id;
};

test('appendTranscriptPath rejects a second path with the same basename UUID', () => {
  const sid = seedSession();
  const uuid = randomUUID();
  const pathA = `/Users/x/.claude/projects/-Users-x-foo-JSTUDIO/${uuid}.jsonl`;
  const pathB = `/Users/x/.claude/projects/-Users-x-foo-JStudio/${uuid}.jsonl`;

  assert.equal(sessionService.appendTranscriptPath(sid, pathA), true, 'first path accepted');
  assert.equal(sessionService.appendTranscriptPath(sid, pathB), false, 'case-duplicate rejected');

  const row = sessionService.getSession(sid);
  assert.deepEqual(row!.transcriptPaths, [pathA]);
});

test('appendTranscriptPath accepts legitimate different-uuid paths (session rotation)', () => {
  const sid = seedSession();
  const uuidA = randomUUID();
  const uuidB = randomUUID();
  const base = '/Users/x/.claude/projects/-Users-x-foo-bar';
  assert.equal(sessionService.appendTranscriptPath(sid, `${base}/${uuidA}.jsonl`), true);
  assert.equal(sessionService.appendTranscriptPath(sid, `${base}/${uuidB}.jsonl`), true);
  const row = sessionService.getSession(sid);
  assert.equal(row!.transcriptPaths.length, 2, 'rotation = 2 distinct basenames, both kept');
});

test('exact-duplicate path still rejected (legacy invariant)', () => {
  const sid = seedSession();
  const path = '/Users/x/.claude/projects/-foo/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl';
  assert.equal(sessionService.appendTranscriptPath(sid, path), true);
  assert.equal(sessionService.appendTranscriptPath(sid, path), false);
});

test('chat endpoint dedup at read time — pre-existing dupes normalize to one file', async () => {
  // Simulate a row that was stored pre-fix with two case-diverged paths
  // for the same JSONL. Create the actual file so existsSync passes,
  // pointing both path strings at it.
  const uuid = randomUUID();
  const realDir = join(tmpDataDir, 'claude-projects', `-Users-x-JStudio`);
  const mirrorDir = join(tmpDataDir, 'claude-projects', `-Users-x-JSTUDIO`);
  const realPath = join(realDir, `${uuid}.jsonl`);
  const mirrorPath = join(mirrorDir, `${uuid}.jsonl`);
  // On a Linux test runner both are real files; the test is about
  // the DEDUP BEHAVIOR at resolveTranscripts, not the FS semantics.
  const { mkdirSync } = await import('node:fs');
  mkdirSync(realDir, { recursive: true });
  mkdirSync(mirrorDir, { recursive: true });
  const jsonlLine = JSON.stringify({
    type: 'assistant', uuid: 'u1', parentUuid: null,
    timestamp: '2026-04-19T00:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
  }) + '\n';
  writeFileSync(realPath, jsonlLine);
  writeFileSync(mirrorPath, jsonlLine);

  const { resolveTranscriptsForTest } = await import('../../routes/chat.routes.js');
  const rawJson = JSON.stringify([mirrorPath, realPath]);
  const { paths } = resolveTranscriptsForTest(rawJson);
  assert.equal(paths.length, 1, 'dedup to a single basename');
});
