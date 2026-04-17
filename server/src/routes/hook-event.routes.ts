import type { FastifyInstance } from 'fastify';
import { basename } from 'node:path';
import { fileWatcherService } from '../services/file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';
import { sessionService } from '../services/session.service.js';
import { tmuxService } from '../services/tmux.service.js';

interface HookEventBody {
  event: string;
  sessionId?: string;
  data?: {
    transcript_path?: string;
    cwd?: string;
    tool_name?: string;
    [key: string]: unknown;
  };
}

// Deterministic transcript-append flow. Every hook event carries a
// transcript_path — that's the definitive statement of "this is the JSONL
// I'm writing." We match it to a Commander sessions row and append to the
// row's transcript_paths list. No rotation heuristics, no cwd scans, no
// id-as-uuid guesses. If we can't identify an owner we drop the event.
export type MatchStrategy =
  | 'claudeSessionId'   // hook's sessionId already present in a row's transcript_paths basename
  | 'transcriptUUID'    // transcript_path's basename UUID already in a row's transcript_paths
  | 'sessionId-as-row'  // hook's sessionId === sessions.id (PM/lead pattern)
  | 'cwd-exclusive'     // exactly one session row has this cwd AND unclaimed
  | 'pm-cwd-rotation'   // Phase L — PM/lead rotation, exactly one UUID-id session in this cwd
  | 'skipped';

export const hookMatchStats: Record<MatchStrategy, number> = {
  claudeSessionId: 0,
  transcriptUUID: 0,
  'sessionId-as-row': 0,
  'cwd-exclusive': 0,
  'pm-cwd-rotation': 0,
  skipped: 0,
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// SQLite GLOB pattern — eight hex, four, four, four, twelve with hyphens.
// Used to narrow "PM/lead sessions" (their id is a Claude UUID) vs
// "teammate-coder sessions" (their id is a slug like `coder-11@team`).
const UUID_ID_GLOB = '????????-????-????-????-????????????';

const uuidFromTranscriptPath = (path: string): string | null => {
  const name = basename(path).replace(/\.jsonl$/i, '');
  return UUID_RE.test(name) ? name : null;
};

interface MatchedRow {
  id: string;
  strategy: Exclude<MatchStrategy, 'skipped'>;
}

export const resolveOwner = (body: HookEventBody): MatchedRow | null => {
  const db = getDb();
  const transcriptPath = body.data?.transcript_path;
  const transcriptUuid = transcriptPath ? uuidFromTranscriptPath(transcriptPath) : null;
  const payloadUuid = body.sessionId ?? null;
  const cwd = body.data?.cwd;

  // 1. Fast path — a row already has this transcript_path in its list.
  if (transcriptPath) {
    const row = db.prepare(
      `SELECT id FROM sessions WHERE transcript_paths LIKE ?`
    ).get(`%${JSON.stringify(transcriptPath).slice(1, -1)}%`) as { id: string } | undefined;
    if (row) return { id: row.id, strategy: 'claudeSessionId' };
  }

  // 2. UUID of the transcript file matches a row's legacy claude_session_id
  // (pre-migration data) OR the row's id (PM/lead pattern where leadSessionId
  // is stored as sessions.id).
  const uuid = transcriptUuid ?? payloadUuid;
  if (uuid) {
    const row = db.prepare(
      `SELECT id FROM sessions WHERE claude_session_id = ? OR id = ? LIMIT 1`
    ).get(uuid, uuid) as { id: string } | undefined;
    if (row) {
      return {
        id: row.id,
        strategy: uuid === payloadUuid && payloadUuid !== transcriptUuid ? 'sessionId-as-row' : 'transcriptUUID',
      };
    }
  }

  // 3. Last-resort cwd match — ONLY when exactly one non-stopped session
  // has this cwd AND its transcript_paths is still empty. This handles the
  // first hook event for a brand-new session before any transcript_path
  // has been persisted. Multi-session cwd is ambiguous; drop the event.
  if (cwd) {
    const unclaimed = db.prepare(
      `SELECT id FROM sessions
       WHERE project_path = ?
         AND status != 'stopped'
         AND (transcript_paths IS NULL OR transcript_paths = '[]')`,
    ).all(cwd) as Array<{ id: string }>;
    if (unclaimed.length === 1) {
      return { id: unclaimed[0]!.id, strategy: 'cwd-exclusive' };
    }
  }

  // 4. Phase L — PM/lead rotation bridge. Claude Code rotates transcripts
  // (new JSONL filename = new claude session UUID) on compaction or after
  // a crash/restart. The hook fires with the NEW UUID, which matches no
  // existing row via steps 1-3 because:
  //   - Step 1 (fast LIKE) fails: new path not yet in any transcript_paths.
  //   - Step 2 (uuid = id or claude_session_id) fails: the PM row still
  //     carries the ORIGINAL UUID as id; the new UUID matches nothing.
  //   - Step 3 (cwd-exclusive) fails: PM already has the OLD transcript
  //     registered, so its transcript_paths is not empty.
  // We bridge the rotation by recognizing the PM/lead pattern: sessions
  // whose id is a Claude UUID (vs teammate-coder sessions whose id is a
  // slug like `coder-11@team-name`). Exactly-one UUID-id session in the
  // cwd → append the new transcript to that session. Multi-match (two
  // PMs in same cwd) drops to skip, preserving safety.
  if (cwd) {
    const pmRows = db.prepare(
      `SELECT id FROM sessions
       WHERE project_path = ?
         AND status != 'stopped'
         AND id GLOB ?`,
    ).all(cwd, UUID_ID_GLOB) as Array<{ id: string }>;
    if (pmRows.length === 1) {
      return { id: pmRows[0]!.id, strategy: 'pm-cwd-rotation' };
    }
  }

  return null;
};

// Hook events must be processed in the order they arrive at the server.
// Two sessions rotating transcripts within the same second can race on
// the cwd-exclusive matcher (both see `transcript_paths = '[]'` for a
// split-second window). Serializing the handler through a promise chain
// guarantees each hook's resolveOwner → appendTranscriptPath runs to
// completion before the next one starts, so the "unclaimed" predicate
// reflects the latest persisted state.
let hookQueue: Promise<unknown> = Promise.resolve();
let hookQueueDepth = 0;
export const getHookQueueDepth = (): number => hookQueueDepth;

export const hookEventRoutes = async (app: FastifyInstance) => {
  // Receive hook events from Claude Code — bypass PIN auth (localhost only,
  // fired by the Claude process itself).
  app.post<{ Body: HookEventBody }>(
    '/api/hook-event',
    { logLevel: 'warn' as const },
    async (request) => {
      const body = request.body ?? ({} as HookEventBody);
      hookQueueDepth += 1;
      if (hookQueueDepth > 5) {
        console.warn(`[hook-event] queue depth=${hookQueueDepth} — hooks backing up`);
      }
      const next = hookQueue.then(() => processHook(body));
      // Keep the chain alive past individual failures so one bad hook
      // doesn't poison the serializer for every subsequent event.
      hookQueue = next.catch(() => {}).finally(() => { hookQueueDepth -= 1; });
      return next;
    },
  );
};

const processHook = async (body: HookEventBody): Promise<{ ok: true }> => {
  const event = body.event ?? 'unknown';
  const transcriptPath = body.data?.transcript_path;

  console.log(`[hook] ${event}${transcriptPath ? ` → ${basename(transcriptPath)}` : ''}`);

  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) {
    eventBus.emitSystemEvent(`hook:${event}`, body);
    return { ok: true };
  }

  fileWatcherService.watchSpecificFile(transcriptPath);

  // Quiet the tmux guard when the hook was delivered via HTTP from the
  // same machine — we don't probe tmux to disambiguate owners, just
  // match by transcript identity.
  void tmuxService; // imported for future use in the cwd fallback — keep reference

  const match = resolveOwner(body);
  if (!match) {
    hookMatchStats.skipped += 1;
    console.warn(
      `[hook-event] WARN: no owner for hook event cwd=${body.data?.cwd ?? '?'} ` +
      `sessionId=${body.sessionId ?? '?'} transcript=${basename(transcriptPath)}`,
    );
    eventBus.emitSystemEvent(`hook:${event}`, body);
    return { ok: true };
  }

  hookMatchStats[match.strategy] += 1;
  const appended = sessionService.appendTranscriptPath(match.id, transcriptPath);
  const shortId = match.id.slice(0, 30);
  console.log(
    `[hook-event] session=${shortId} matched via ${match.strategy} transcript=${basename(transcriptPath)}${appended ? ' (appended)' : ' (dedup)'}`,
  );

  if (appended) {
    const session = sessionService.getSession(match.id);
    if (session) eventBus.emitSessionUpdated(session);
  }

  eventBus.emitSystemEvent(`hook:${event}`, body);
  return { ok: true };
};
