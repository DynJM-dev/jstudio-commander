// GET + PATCH /api/sessions/:id/scrollback — base64-encoded xterm.js serialized
// terminal buffer per ARCHITECTURE_SPEC v1.2 §16.6 (5MB cap, truncate oldest).
//
// Size cap rationale: xterm.js addon-serialize emits escape-sequence-rich
// plain text that reproduces the buffer state when replayed via term.write().
// A 10K-line heavy-output session may reach ~1-3MB; 5MB accommodates the
// worst practical cases without unbounded DB growth.
//
// Truncation strategy: keep the last MAX_SCROLLBACK_BYTES of the blob. This
// slices mid-escape-sequence in pathological cases but xterm.js's parser is
// robust to truncated input (it discards the incomplete leading sequence).
// A content-aware truncation (split at newlines) would be correct but adds
// complexity for a rarely-hit edge case.

import type { FastifyPluginAsync } from 'fastify';
import type { InitializedDb } from '@jstudio-commander/db';
import { sessions } from '@jstudio-commander/db';
import { eq } from 'drizzle-orm';
import { EventBus, channelForSession } from '../ws/event-bus.js';

export const MAX_SCROLLBACK_BYTES = 5 * 1024 * 1024;

interface PatchBody {
  /** base64-encoded serialized buffer from @xterm/addon-serialize. */
  blob: string;
}

export const scrollbackRoutes = (
  db: InitializedDb,
  bus: EventBus,
): FastifyPluginAsync => async (app) => {
  app.get<{ Params: { id: string } }>(
    '/api/sessions/:id/scrollback',
    async (req, reply) => {
      const row = await db.drizzle
        .select()
        .from(sessions)
        .where(eq(sessions.id, req.params.id))
        .get();
      if (!row) {
        reply.code(404);
        return { error: 'not_found' };
      }
      const blob = row.scrollbackBlob;
      if (!blob) return { blob: null };
      const buf = blob as Buffer;
      return { blob: buf.toString('base64'), bytes: buf.length };
    },
  );

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    '/api/sessions/:id/scrollback',
    async (req, reply) => {
      const { blob } = req.body ?? {};
      if (typeof blob !== 'string') {
        reply.code(400);
        return { error: 'blob_required' };
      }
      let decoded = Buffer.from(blob, 'base64');
      let truncated = false;
      if (decoded.length > MAX_SCROLLBACK_BYTES) {
        decoded = decoded.subarray(decoded.length - MAX_SCROLLBACK_BYTES);
        truncated = true;
      }
      const now = new Date();
      const res = await db.drizzle
        .update(sessions)
        .set({ scrollbackBlob: decoded, updatedAt: now })
        .where(eq(sessions.id, req.params.id))
        .run();
      if (res.changes === 0) {
        reply.code(404);
        return { error: 'not_found' };
      }
      if (truncated) {
        bus.emit(channelForSession(req.params.id), {
          type: 'system:info',
          sessionId: req.params.id,
          code: 'scrollback_truncated',
          message: `Scrollback exceeded ${MAX_SCROLLBACK_BYTES} bytes; oldest portion truncated.`,
          timestamp: Date.now(),
        });
      }
      return { ok: true, bytes: decoded.length, truncated };
    },
  );
};
