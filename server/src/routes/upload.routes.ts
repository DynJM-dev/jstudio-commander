// Phase S — file + image attachment uploads.
//
// Security posture mirrors hook-event / session-tick: bound to
// 127.0.0.1 at the socket level via a per-request `isLoopbackIp`
// gate. Only Commander's own UI (running on the same host) is a
// legitimate caller — and since writing arbitrary files is the whole
// point of this endpoint, the loopback gate is non-negotiable.
//
// Files are staged under `config.dataDir/uploads/<sessionId>/` and
// the UI emits `@<absolute-path>` references into the session's tmux
// pane so Claude Code resolves them via its normal `@file` lookup.
//
// Sanitization: the filename component is stripped to `[A-Za-z0-9._-]`
// and length-capped. `..`, `/`, and `\` can never survive the
// regex — the filter is an allowlist, not a blocklist. The upload
// path is always built with `join(uploadsDir, sessionId, finalName)`,
// so path traversal via a malicious `filename` header is prevented
// by construction (the only component we trust from the multipart
// header is already sanitized).

import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { config, isLoopbackIp } from '../config.js';
import { sessionService } from '../services/session.service.js';

// Hard per-file caps. Images are smaller because paste-from-clipboard
// is the dominant path for them (screenshots are usually < 2 MB);
// non-image files can be larger (PDFs, code dumps).
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;
const QUOTA_WARN_BYTES = 500 * 1024 * 1024;

// Accepted mime allowlist. Anything Claude can sensibly read at an
// `@path` reference. Binary blobs, executables, and archives are out —
// they're both a security signal AND not useful to Claude.
const ACCEPTED_MIME = new Set<string>([
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  // Documents
  'application/pdf',
  // Text + code. Claude reads anything with utf-8 text; browsers
  // sometimes guess `application/octet-stream` for uncommon extensions
  // — we accept the common safe set explicitly instead of trusting the
  // generic octet-stream bucket.
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'application/x-yaml',
  'text/yaml',
  'text/x-yaml',
  'text/csv',
  'text/javascript',
  'application/javascript',
  'application/typescript',
  'text/typescript',
  'text/x-python',
  'application/x-python',
  'text/x-rust',
  'text/x-go',
  'text/html',
  'text/css',
  'text/x-sh',
  'application/x-sh',
]);

const isImageMime = (mime: string): boolean => mime.startsWith('image/');

// `sanitizeFilename` — allowlist-only. Any character outside
// `[A-Za-z0-9._-]` (path separators, traversal sequences, shell
// metacharacters, unicode) is stripped. The name is then capped at
// 100 chars. If the result is empty (e.g. the user dropped a file
// named "💀.png"), we fall back to "upload" so the path join is still
// valid. The caller prefixes an ISO timestamp so duplicate names don't
// collide.
export const sanitizeFilename = (input: string): string => {
  const stripped = input.replace(/[^A-Za-z0-9._-]/g, '');
  const capped = stripped.slice(0, 100);
  return capped.length > 0 ? capped : 'upload';
};

// Uploads dir per session. Created lazily on first write so sessions
// that never attach files never pollute the filesystem.
const uploadsRoot = (): string => join(config.dataDir, 'uploads');
const sessionUploadsDir = (sessionId: string): string => join(uploadsRoot(), sessionId);

// Walk the whole uploads/ tree and return the total size. Cheap when
// empty; a linear stat when populated. We only call it on write to
// emit the 500 MB warning, never on read.
const totalUploadsBytes = (): number => {
  const root = uploadsRoot();
  if (!existsSync(root)) return 0;
  let total = 0;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionDir = join(root, entry.name);
    for (const file of readdirSync(sessionDir)) {
      try {
        total += statSync(join(sessionDir, file)).size;
      } catch { /* race with cleanup — skip */ }
    }
  }
  return total;
};

interface UploadResult {
  name: string;
  path: string;
  size: number;
  mimeType: string;
}

interface PersistedFile {
  result?: UploadResult;
  error?: { status: number; message: string };
}

// Stream a single multipart part to disk with the size cap enforced
// mid-stream. `toBuffer()` would read the whole upload into RAM before
// we checked the size, so a 2 GB attacker upload would OOM the server
// before the 413. We buffer chunks manually and reject as soon as
// `received > limit`.
const persistPart = async (part: MultipartFile, sessionId: string): Promise<PersistedFile> => {
  const mime = part.mimetype ?? 'application/octet-stream';
  if (!ACCEPTED_MIME.has(mime)) {
    // Drain the stream so the socket doesn't stall waiting for a
    // reader. Fastify's multipart uses busboy under the hood; unread
    // streams back up the request.
    part.file.resume();
    return { error: { status: 415, message: `unsupported mime: ${mime}` } };
  }

  const limit = isImageMime(mime) ? IMAGE_MAX_BYTES : FILE_MAX_BYTES;
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of part.file) {
      received += chunk.length;
      if (received > limit) {
        part.file.resume();
        return {
          error: {
            status: 413,
            message: `file exceeds ${isImageMime(mime) ? 'image' : 'file'} max of ${limit} bytes`,
          },
        };
      }
      chunks.push(chunk as Buffer);
    }
  } catch (err) {
    return { error: { status: 400, message: `read failed: ${(err as Error).message}` } };
  }

  const buffer = Buffer.concat(chunks);
  const dir = sessionUploadsDir(sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // ISO timestamp prefix gives us natural ordering + collision-free
  // names without a separate uuid dependency. Colons are swapped for
  // dashes so the path is portable.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = sanitizeFilename(part.filename ?? 'upload');
  const finalName = `${ts}-${safe}`;
  const fullPath = join(dir, finalName);
  writeFileSync(fullPath, buffer);

  return {
    result: {
      name: safe,
      path: fullPath,
      size: buffer.length,
      mimeType: mime,
    },
  };
};

// Remove the whole uploads dir for a session. Called from the session
// purge path when a row is hard-deleted. Idempotent: a non-existent
// dir is a no-op.
export const removeSessionUploads = (sessionId: string): void => {
  const dir = sessionUploadsDir(sessionId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[uploads] cleanup failed for ${sessionId}: ${(err as Error).message}`);
  }
};

export const uploadRoutes = async (app: FastifyInstance) => {
  app.post<{ Params: { sessionId: string } }>(
    '/api/upload/:sessionId',
    async (request, reply) => {
      if (!isLoopbackIp(request.ip)) {
        return reply.status(403).send({ error: 'loopback only' });
      }

      const session = sessionService.getSession(request.params.sessionId);
      if (!session) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // `request.isMultipart()` is the fastify-multipart extension. If
      // the client accidentally sends a JSON body to this endpoint, we
      // fail fast with a 400 instead of hanging on the `parts()`
      // iterator.
      const multipartRequest = request as typeof request & {
        isMultipart: () => boolean;
        parts: () => AsyncIterableIterator<MultipartFile>;
      };
      if (!multipartRequest.isMultipart()) {
        return reply.status(400).send({ error: 'multipart/form-data required' });
      }

      const persisted: UploadResult[] = [];
      let fileCount = 0;

      for await (const part of multipartRequest.parts()) {
        if (part.type !== 'file') continue;
        fileCount += 1;
        if (fileCount > MAX_FILES_PER_REQUEST) {
          // Drain remaining parts so the connection closes cleanly.
          part.file.resume();
          return reply
            .status(413)
            .send({ error: `max ${MAX_FILES_PER_REQUEST} files per request` });
        }

        const outcome = await persistPart(part, request.params.sessionId);
        if (outcome.error) {
          return reply.status(outcome.error.status).send({ error: outcome.error.message });
        }
        if (outcome.result) persisted.push(outcome.result);
      }

      if (persisted.length === 0) {
        return reply.status(400).send({ error: 'no files in request' });
      }

      // Quota check is advisory — we never reject on quota, just warn.
      // An LRU eviction pass is a future phase; for now the operator
      // can see the growth in logs and clean up manually.
      const total = totalUploadsBytes();
      if (total > QUOTA_WARN_BYTES) {
        console.warn(
          `[uploads] directory size ${(total / 1024 / 1024).toFixed(1)} MB exceeds ` +
          `${QUOTA_WARN_BYTES / 1024 / 1024} MB warn threshold`,
        );
      }

      return { files: persisted };
    },
  );
};
