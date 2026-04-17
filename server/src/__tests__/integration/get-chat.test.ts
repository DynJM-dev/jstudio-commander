// Phase P.4 Patch 5 — integration test for GET /api/chat/:sessionId.
//
// Exercises: Fastify route → session lookup → resolveTranscripts (JSON
// parse + existsSync filter) → jsonlParserService.parseFile → response
// shape {messages, total, awaitingFirstTurn}.
//
// Closes a real gap: jsonl-parser.service has no existing unit tests
// (client has a chatMessageParser.test.ts for structured-content tag
// parsing, but the server-side JSONL → ChatMessage parser is untested).
// This spec covers both the parser happy path and the chat route's
// error cases (unknown session → 404, missing file → empty messages).

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-int-chat-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { buildTestApp, cleanupTestApp } = await import('./harness.js');
const { sessionService } = await import('../../services/session.service.js');
const { getDb } = await import('../../db/connection.js');

const app = await buildTestApp();
const fixtureDir = mkdtempSync(join(tmpdir(), 'commander-int-chat-fixtures-'));

after(async () => {
  await cleanupTestApp(app);
  rmSync(tmpDataDir, { recursive: true, force: true });
  rmSync(fixtureDir, { recursive: true, force: true });
});

const writeTranscript = (name: string, records: Array<Record<string, unknown>>): string => {
  const path = join(fixtureDir, `${name}.jsonl`);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
};

const seedSessionWithTranscript = (transcriptPath: string): string => {
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'int-chat',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'idle',
  });
  // transcript_paths is a JSON-encoded string[] column; session.service
  // doesn't expose a direct setter for it, so we write via raw SQL to
  // avoid hitting the appendTranscriptPath branch with all its event
  // side effects.
  getDb()
    .prepare('UPDATE sessions SET transcript_paths = ? WHERE id = ?')
    .run(JSON.stringify([transcriptPath]), id);
  return id;
};

test('GET /api/chat/:id — returns parsed messages for session with transcript', async () => {
  const transcript = writeTranscript('happy', [
    {
      type: 'user',
      uuid: 'u-1',
      parentUuid: null,
      timestamp: '2026-04-17T12:00:00.000Z',
      message: { role: 'user', content: 'hello commander' },
    },
    {
      type: 'assistant',
      uuid: 'a-1',
      parentUuid: 'u-1',
      timestamp: '2026-04-17T12:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi — running integration test.' }],
        model: 'claude-opus-4-7',
        usage: { input_tokens: 10, output_tokens: 6 },
      },
    },
  ]);
  const sessionId = seedSessionWithTranscript(transcript);

  const res = await app.inject({ method: 'GET', url: `/api/chat/${sessionId}` });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    messages: Array<{ id: string; role: string; content: Array<{ type: string; text: string }> }>;
    total: number;
    awaitingFirstTurn: boolean;
  };

  assert.equal(body.total, 2);
  assert.equal(body.awaitingFirstTurn, false);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0]!.role, 'user');
  assert.equal(body.messages[0]!.content[0]!.text, 'hello commander');
  assert.equal(body.messages[1]!.role, 'assistant');
  assert.equal(body.messages[1]!.content[0]!.text, 'Hi — running integration test.');
});

test('GET /api/chat/:id — unknown session → 404', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/chat/${randomUUID()}` });
  assert.equal(res.statusCode, 404);
  const body = JSON.parse(res.body) as { error: string };
  assert.match(body.error, /not found/i);
});

test('GET /api/chat/:id — session with no transcript → awaitingFirstTurn=true, empty messages', async () => {
  // Session exists but has never had a hook event, so transcript_paths
  // is still the default '[]'. The route must NOT 500 — it should
  // return a clean "awaiting first turn" response so the client can
  // render its "waiting for activity" state.
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'int-chat-awaiting',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'idle',
  });

  const res = await app.inject({ method: 'GET', url: `/api/chat/${id}` });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    messages: unknown[];
    total: number;
    awaitingFirstTurn: boolean;
  };
  assert.deepEqual(body.messages, []);
  assert.equal(body.total, 0);
  assert.equal(body.awaitingFirstTurn, true);
});

test('GET /api/chat/:id — transcript file missing on disk → messages empty, awaitingFirstTurn=true', async () => {
  // A transcript_paths entry that points at a path the user deleted
  // must NOT crash the route. resolveTranscripts existsSync-filters
  // the list; with everything filtered we return the same "awaiting"
  // shape.
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'int-chat-missing-file',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'idle',
  });
  getDb()
    .prepare('UPDATE sessions SET transcript_paths = ? WHERE id = ?')
    .run(JSON.stringify(['/nope/does/not/exist.jsonl']), id);

  const res = await app.inject({ method: 'GET', url: `/api/chat/${id}` });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { messages: unknown[]; awaitingFirstTurn: boolean };
  assert.deepEqual(body.messages, []);
  assert.equal(body.awaitingFirstTurn, true);
});
