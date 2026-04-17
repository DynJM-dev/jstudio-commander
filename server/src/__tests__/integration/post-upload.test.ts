// Phase S — integration test for POST /api/upload/:sessionId.
//
// Exercises: loopback guard, multipart parsing, mime + size gating,
// filename sanitization, on-disk persistence. No browser, no real
// drag-and-drop — just a hand-rolled multipart body piped at the
// route via `app.inject()`. That's enough to cover every code path
// in upload.routes.ts without pulling in a browser harness.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDataDir = mkdtempSync(join(tmpdir(), 'commander-int-upload-'));
process.env.COMMANDER_DATA_DIR = tmpDataDir;

const { buildTestApp, cleanupTestApp } = await import('./harness.js');
const { sessionService } = await import('../../services/session.service.js');

const app = await buildTestApp();

after(async () => {
  await cleanupTestApp(app);
  rmSync(tmpDataDir, { recursive: true, force: true });
});

const seedSession = (): string => {
  const id = randomUUID();
  sessionService.upsertSession({
    id,
    name: 'int-upload',
    tmuxSession: `jsc-${id.slice(0, 8)}`,
    status: 'idle',
  });
  return id;
};

// Build a minimal multipart/form-data body with a single file part.
// Hand-rolled to avoid adding a test-only dep on `form-data`.
const buildMultipart = (
  files: Array<{ filename: string; mime: string; content: Buffer }>,
): { body: Buffer; contentType: string } => {
  const boundary = `----CommanderTest${Date.now()}`;
  const chunks: Buffer[] = [];
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(
      `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n`,
    ));
    chunks.push(Buffer.from(`Content-Type: ${file.mime}\r\n\r\n`));
    chunks.push(file.content);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
};

// A 1x1 PNG — smallest valid PNG, just enough bytes to survive the
// mime gate + land on disk. 67 bytes.
const tinyPng = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

test('POST /api/upload/:id — valid image → 200, file persisted on disk', async () => {
  const sessionId = seedSession();
  const { body, contentType } = buildMultipart([
    { filename: 'snap.png', mime: 'image/png', content: tinyPng },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${sessionId}`,
    payload: body,
    headers: { 'content-type': contentType },
  });

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body) as {
    files: Array<{ name: string; path: string; size: number; mimeType: string }>;
  };
  assert.equal(parsed.files.length, 1);
  const file = parsed.files[0]!;
  assert.equal(file.name, 'snap.png');
  assert.equal(file.mimeType, 'image/png');
  assert.equal(file.size, tinyPng.length);
  assert.ok(existsSync(file.path), 'on-disk file should exist');
  assert.deepEqual(readFileSync(file.path), tinyPng);
  // Path is under the session's upload dir so cleanup can find it later.
  assert.ok(file.path.includes(sessionId), 'path should be scoped to session');
});

test('POST /api/upload/:id — oversize image → 413', async () => {
  const sessionId = seedSession();
  // 6 MB — one byte over the 5 MB image cap. The per-chunk check
  // rejects mid-stream, so the server never materializes 6 MB in memory.
  const oversize = Buffer.alloc(6 * 1024 * 1024, 0xff);
  const { body, contentType } = buildMultipart([
    { filename: 'big.png', mime: 'image/png', content: oversize },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${sessionId}`,
    payload: body,
    headers: { 'content-type': contentType },
  });

  assert.equal(res.statusCode, 413);
  const parsed = JSON.parse(res.body) as { error: string };
  assert.match(parsed.error, /exceeds|too large|limit/i);
});

test('POST /api/upload/:id — disallowed mime → 415', async () => {
  const sessionId = seedSession();
  const { body, contentType } = buildMultipart([
    { filename: 'nope.exe', mime: 'application/x-msdownload', content: Buffer.from('MZ\x90\x00') },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${sessionId}`,
    payload: body,
    headers: { 'content-type': contentType },
  });

  assert.equal(res.statusCode, 415);
  const parsed = JSON.parse(res.body) as { error: string };
  assert.match(parsed.error, /unsupported mime/i);
});

test('POST /api/upload/:id — traversal filename sanitized to safe name', async () => {
  const sessionId = seedSession();
  // Attack: filename with `../` sequences. If the sanitizer lets any
  // of this through, the join() would write outside the session dir.
  // The allowlist strips `../\` to leaves — the safe component is just
  // the dots + letters: `..screenshotpng` or similar.
  const { body, contentType } = buildMultipart([
    {
      filename: '../../etc/passwd.png',
      mime: 'image/png',
      content: tinyPng,
    },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${sessionId}`,
    payload: body,
    headers: { 'content-type': contentType },
  });

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body) as { files: Array<{ name: string; path: string }> };
  const file = parsed.files[0]!;
  // Slash, backslash, and directory separators must not survive.
  assert.ok(!file.name.includes('/'), 'sanitized name must not contain /');
  assert.ok(!file.name.includes('\\'), 'sanitized name must not contain \\');
  // The on-disk path must stay under the session's upload dir.
  const expectedDirPrefix = join(tmpDataDir, 'uploads', sessionId);
  assert.ok(file.path.startsWith(expectedDirPrefix),
    `path ${file.path} must be under ${expectedDirPrefix}`);
  // No file ever lands in /etc or any peer directory.
  assert.ok(!file.path.includes('/etc/'), 'traversal must not escape');
  // The session's upload dir should contain exactly one file.
  const entries = readdirSync(expectedDirPrefix);
  assert.equal(entries.length, 1);
});

test('POST /api/upload/:id — non-loopback → 403', async () => {
  const sessionId = seedSession();
  const { body, contentType } = buildMultipart([
    { filename: 'ok.png', mime: 'image/png', content: tinyPng },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${sessionId}`,
    payload: body,
    headers: { 'content-type': contentType },
    remoteAddress: '8.8.8.8',
  });

  assert.equal(res.statusCode, 403);
  const parsed = JSON.parse(res.body) as { error: string };
  assert.match(parsed.error, /loopback/i);
});

test('POST /api/upload/:id — unknown session → 404', async () => {
  const { body, contentType } = buildMultipart([
    { filename: 'ok.png', mime: 'image/png', content: tinyPng },
  ]);

  const res = await app.inject({
    method: 'POST',
    url: `/api/upload/${randomUUID()}`,
    payload: body,
    headers: { 'content-type': contentType },
  });

  assert.equal(res.statusCode, 404);
});
