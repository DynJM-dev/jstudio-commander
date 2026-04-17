// Phase U Patch 1 — retroactive claude_session_id backfill.
//
// Covers the guarded UPDATE contract in isolation:
//   - Fires for all four deterministic strategies
//     (claudeSessionId, transcriptUUID, sessionId-as-row, cwd-exclusive).
//   - Refuses to fire for either rotation heuristic
//     (pm-cwd-rotation, coder-team-rotation) — these can false-bind
//     and persisting the wrong UUID would poison the row.
//   - No-op when the row already has a populated claude_session_id.
//   - No-op when the transcript_path is not a Claude UUID filename.
//   - No-op for unknown session ids.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-u-autolearn-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { getDb, closeDb } = await import('../../db/connection.js');
const { sessionService } = await import('../session.service.js');
const {
  maybeAutoLearnClaudeSessionId,
  DETERMINISTIC_STRATEGIES,
} = await import('../../routes/hook-event.routes.js');

// Force DB init up front so seed writes land on a migrated schema.
getDb();

after(() => {
  closeDb();
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seedUnboundSession = () => {
  const id = randomUUID();
  return sessionService.upsertSession({
    id,
    name: 'phase-u-autolearn',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'working',
  });
};

const transcriptPathFor = (uuid: string): string =>
  `/Users/test/.claude/projects/-repo-foo/${uuid}.jsonl`;

const readClaudeSessionId = (rowId: string): string | null => {
  const row = getDb().prepare(
    'SELECT claude_session_id FROM sessions WHERE id = ?',
  ).get(rowId) as { claude_session_id: string | null } | undefined;
  return row?.claude_session_id ?? null;
};

test('DETERMINISTIC_STRATEGIES set contains exactly the four safe ones', () => {
  // Explicit contract pin — if anyone adds pm-cwd-rotation or
  // coder-team-rotation to this set, this test forces them to justify
  // it here before the diff can land.
  assert.equal(DETERMINISTIC_STRATEGIES.size, 4);
  assert.ok(DETERMINISTIC_STRATEGIES.has('claudeSessionId'));
  assert.ok(DETERMINISTIC_STRATEGIES.has('transcriptUUID'));
  assert.ok(DETERMINISTIC_STRATEGIES.has('sessionId-as-row'));
  assert.ok(DETERMINISTIC_STRATEGIES.has('cwd-exclusive'));
  assert.equal(DETERMINISTIC_STRATEGIES.has('pm-cwd-rotation' as never), false);
  assert.equal(DETERMINISTIC_STRATEGIES.has('coder-team-rotation' as never), false);
});

test('deterministic strategy "claudeSessionId" → writes claude_session_id', () => {
  const row = seedUnboundSession();
  const uuid = randomUUID();
  assert.equal(readClaudeSessionId(row.id), null);
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'claudeSessionId',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, true);
  assert.equal(readClaudeSessionId(row.id), uuid);
});

test('deterministic strategy "transcriptUUID" → writes claude_session_id', () => {
  const row = seedUnboundSession();
  const uuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'transcriptUUID',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, true);
  assert.equal(readClaudeSessionId(row.id), uuid);
});

test('deterministic strategy "sessionId-as-row" → writes claude_session_id', () => {
  const row = seedUnboundSession();
  const uuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'sessionId-as-row',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, true);
  assert.equal(readClaudeSessionId(row.id), uuid);
});

test('deterministic strategy "cwd-exclusive" → writes claude_session_id', () => {
  const row = seedUnboundSession();
  const uuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'cwd-exclusive',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, true);
  assert.equal(readClaudeSessionId(row.id), uuid);
});

test('heuristic strategy "pm-cwd-rotation" → MUST NOT auto-learn', () => {
  // If this ever flips to true, a PM rotation-match could permanently
  // overwrite a sibling's UUID. Keep this test loud.
  const row = seedUnboundSession();
  const uuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'pm-cwd-rotation',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, false);
  assert.equal(readClaudeSessionId(row.id), null, 'row must remain unbound');
});

test('heuristic strategy "coder-team-rotation" → MUST NOT auto-learn', () => {
  const row = seedUnboundSession();
  const uuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'coder-team-rotation',
    transcriptPathFor(uuid),
  );
  assert.equal(didWrite, false);
  assert.equal(readClaudeSessionId(row.id), null, 'row must remain unbound');
});

test('already-populated claude_session_id → no-op (do not overwrite)', () => {
  const row = seedUnboundSession();
  const original = randomUUID();
  sessionService.upsertSession({ id: row.id, claudeSessionId: original });
  assert.equal(readClaudeSessionId(row.id), original);
  const newUuid = randomUUID();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'claudeSessionId',
    transcriptPathFor(newUuid),
  );
  assert.equal(didWrite, false, 'must not overwrite existing value');
  assert.equal(readClaudeSessionId(row.id), original, 'original value preserved');
});

test('non-UUID transcript filename → no-op (cannot learn an invalid UUID)', () => {
  const row = seedUnboundSession();
  const didWrite = maybeAutoLearnClaudeSessionId(
    row.id,
    'claudeSessionId',
    '/Users/test/.claude/projects/-repo/not-a-uuid.jsonl',
  );
  assert.equal(didWrite, false);
  assert.equal(readClaudeSessionId(row.id), null);
});

test('unknown session id → no-op (UPDATE affects zero rows)', () => {
  const didWrite = maybeAutoLearnClaudeSessionId(
    'ghost-session-id',
    'claudeSessionId',
    transcriptPathFor(randomUUID()),
  );
  assert.equal(didWrite, false);
});
