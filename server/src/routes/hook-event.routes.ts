import type { FastifyInstance } from 'fastify';
import { basename, resolve as resolvePath } from 'node:path';
import { fileWatcherService } from '../services/file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';
import { getDb } from '../db/connection.js';
import { sessionService } from '../services/session.service.js';
import { tmuxService } from '../services/tmux.service.js';
import { readJsonlOrigin, isCoderJsonl, type JsonlOrigin } from '../services/jsonl-origin.service.js';
import { config, isLoopbackIp } from '../config.js';

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
  | 'claudeSessionId'    // hook's sessionId already present in a row's transcript_paths basename
  | 'transcriptUUID'     // transcript_path's basename UUID already in a row's transcript_paths
  | 'sessionId-as-row'   // hook's sessionId === sessions.id (PM/lead pattern)
  | 'cwd-exclusive'      // exactly one session row has this cwd AND unclaimed
  | 'pm-cwd-rotation'    // Phase L — PM/lead rotation, exactly one UUID-id session in this cwd
  | 'coder-team-rotation'// Phase L B2 refinement — coder JSONL routes to its team's non-lead row
  | 'skipped';

export const hookMatchStats: Record<MatchStrategy, number> = {
  claudeSessionId: 0,
  transcriptUUID: 0,
  'sessionId-as-row': 0,
  'cwd-exclusive': 0,
  'pm-cwd-rotation': 0,
  'coder-team-rotation': 0,
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
  // Phase P.1 H1/M4: replaced the LIKE-substring query with a
  // json_each-backed exact match. Sidesteps the LIKE wildcard-injection
  // class entirely (attacker-supplied `%` / `_` in the path used to
  // match arbitrary rows) and is semantically stricter — we only ever
  // stored exact JSON strings in this array, so substring was never
  // the right tool. The query is still one parameterized SELECT.
  if (transcriptPath) {
    const row = db.prepare(
      `SELECT s.id FROM sessions s, json_each(s.transcript_paths)
       WHERE s.transcript_paths IS NOT NULL
         AND json_each.value = ?
       LIMIT 1`
    ).get(transcriptPath) as { id: string } | undefined;
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

  // Phase L B2 refinement — classify the JSONL before falling to the
  // cwd-based strategies so coder events never bind to a PM and vice
  // versa. Origin is best-effort; if the file isn't readable or lacks
  // header fields, both branches below fall back to their existing
  // ambiguity-safe behavior (single-match or skip).
  const origin: JsonlOrigin | null = transcriptPath ? readJsonlOrigin(transcriptPath) : null;
  const coderOrigin = isCoderJsonl(origin);

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
  //
  // B2 refinement: if origin marks this as a coder JSONL (agentName
  // present), DON'T enter this branch — coder events must not
  // false-attribute to a PM just because the PM is the only UUID-id
  // session in the shared cwd.
  if (cwd && !coderOrigin) {
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

  // 5. Phase L B2 refinement — coder-team-rotation. When the JSONL
  // origin identifies this file as a coder (agentName present), match
  // to the non-lead-pm session in the cwd whose team_name matches the
  // JSONL's teamName. Exactly-one match binds; ambiguity (multiple
  // coders in the team with the same project_path) skips.
  if (cwd && coderOrigin && origin?.teamName) {
    const coderRows = db.prepare(
      `SELECT id FROM sessions
       WHERE project_path = ?
         AND status != 'stopped'
         AND team_name = ?
         AND (agent_role IS NULL OR agent_role NOT IN ('lead-pm', 'pm'))`,
    ).all(cwd, origin.teamName) as Array<{ id: string }>;
    if (coderRows.length === 1) {
      return { id: coderRows[0]!.id, strategy: 'coder-team-rotation' };
    }
  }

  return null;
};

// Phase P.1 H1 — transcript_path allowlist. Every legitimate hook
// event's `transcript_path` resolves under `~/.claude/projects/` (the
// directory Claude Code writes JSONLs into). Previous code accepted any
// attacker-supplied path, then:
//   (a) fs.watch()'d the path (FD growth + DoS),
//   (b) LIKE-substring matched it against an existing row (hijack risk),
//   (c) stored it in transcript_paths for the chat endpoint to later
//       readFileSync — arbitrary-file-read amplification.
// The guard rejects any path that, after `path.resolve`, doesn't start
// with the canonical projects dir + separator (prevents `/foo/../etc`
// traversal and `/etc/hosts.jsonl` variants that happen to end in
// `.jsonl`). Exported so tests can pin the contract.
export const isAllowedTranscriptPath = (
  transcriptPath: string,
  projectsDir: string = config.claudeProjectsDir,
): boolean => {
  if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) return false;
  if (!transcriptPath.endsWith('.jsonl')) return false;
  const resolved = resolvePath(transcriptPath);
  const dirPrefix = projectsDir.endsWith('/') ? projectsDir : projectsDir + '/';
  return resolved.startsWith(dirPrefix);
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

// Phase R M5 — hard cap on the hook queue depth. The Claude CLI
// wraps its hook-event POST in `--max-time 2` and treats any
// non-2xx as a fire-and-forget drop, so returning 503 here just
// means "Commander shed this hook". Previous behavior was
// unbounded growth under a downstream stall, with only a warn
// log at depth > 5. 20 is a generous ceiling that absorbs normal
// multi-session bursts (up to ~4 active sessions × 5 in-flight
// hooks) but rejects runaway state.
export const HOOK_QUEUE_MAX = 20;

// Test-only. Lets integration tests deterministically drive the
// queue depth without racing processHook. Caller simulates a
// downstream stall by adding N in-flight promises; `release()`
// resolves them all so the queue drains cleanly at teardown.
// Not re-exported outside tests — the file's public surface is
// just the `hookEventRoutes` Fastify plugin.
export const _setHookQueueDepthForTests = (
  depth: number,
): { release: () => void } => {
  let resolveAll: () => void = () => {};
  const stall = new Promise<void>((resolve) => { resolveAll = resolve; });
  for (let i = 0; i < depth; i++) {
    hookQueueDepth += 1;
    const next = hookQueue.then(() => stall);
    hookQueue = next.catch(() => {}).finally(() => { hookQueueDepth -= 1; });
  }
  return { release: () => resolveAll() };
};

export const hookEventRoutes = async (app: FastifyInstance) => {
  // Phase P.1 H1 — loopback-only. Hooks fire from the Claude CLI running
  // on the same machine as Commander; the endpoint has no legitimate
  // cross-host caller. Previous code relied on the PIN middleware, which
  // was bypassable via the Host header (see C1). Gate on the raw socket
  // peer with the same predicate session-tick.routes.ts uses.
  app.post<{ Body: HookEventBody }>(
    '/api/hook-event',
    { logLevel: 'warn' as const },
    async (request, reply) => {
      if (!isLoopbackIp(request.ip)) {
        return reply.status(403).send({ error: 'loopback only' });
      }
      // Phase R M5 — reject past capacity. Checked BEFORE the depth
      // increment so a 21st concurrent POST never transiently occupies
      // a queue slot. `Retry-After: 1` nudges well-behaved clients to
      // back off a second before retrying — Claude Code's hook client
      // itself is fire-and-forget so this is mostly for other callers.
      if (hookQueueDepth >= HOOK_QUEUE_MAX) {
        console.warn(`[hook-event] queue full (depth=${hookQueueDepth}) — shedding`);
        return reply.status(503).header('Retry-After', '1').send({ error: 'queue full' });
      }
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

  // Phase N.0 — Stop hook fires when Claude Code ends a turn (including
  // after /compact). The 5s pane poller can lag seconds behind — or
  // forever when the pane footer freezes on a past-tense verb like
  // `✻ Cooked / 21261s`. Acting on the hook directly flips status to
  // idle at turn boundary so the UI doesn't read "working" post-turn.
  // Runs BEFORE the transcript_path branching below so Stop events
  // without a transcript still trigger the flip.
  if (event === 'Stop') {
    const match = resolveOwner(body);
    if (match?.id) {
      const db = getDb();
      db.prepare(
        "UPDATE sessions SET status = 'idle', updated_at = datetime('now') WHERE id = ?",
      ).run(match.id);
      eventBus.emitSessionStatus(match.id, 'idle', {
        to: 'idle',
        evidence: 'stop-hook',
        at: new Date().toISOString(),
      });
      // Phase N.0 Patch 3 — Stop is the single most important heartbeat
      // because it's the signal the 5s poller can miss entirely. Bumping
      // here guarantees the "Xs ago" counter resets at turn boundary.
      sessionService.bumpLastActivity(match.id);
      console.log(`[hook:Stop] session=${match.id.slice(0, 30)} → idle (via ${match.strategy})`);
    }
  }

  // Phase N.0 Patch 4 — SessionStart fires when Claude Code boots or
  // resumes a session. Flip status to `working` so the UI reflects the
  // fresh lifecycle boundary immediately, ahead of the first pane poll
  // or tool_use hook. We DO NOT auto-create a session row on unknown
  // owners — tmux + team-config paths own row lifecycle and racing with
  // them here would produce orphans.
  if (event === 'SessionStart') {
    const match = resolveOwner(body);
    if (match?.id) {
      const db = getDb();
      db.prepare(
        "UPDATE sessions SET status = 'working', updated_at = datetime('now') WHERE id = ?",
      ).run(match.id);
      eventBus.emitSessionStatus(match.id, 'working', {
        to: 'working',
        evidence: 'session-start-hook',
        at: new Date().toISOString(),
      });
      sessionService.bumpLastActivity(match.id);
      console.log(`[hook:SessionStart] session=${match.id.slice(0, 30)} → working (via ${match.strategy})`);
    } else {
      console.log('[hook:SessionStart] unknown session, skipping');
    }
  }

  // Phase N.0 Patch 4 — SessionEnd fires on explicit `/exit` or when
  // the Claude process terminates. Flip to `stopped` + timestamp so
  // Commander's UI can retire the card without waiting for the poller's
  // tmux-hasSession check to catch up on the next cycle.
  if (event === 'SessionEnd') {
    const match = resolveOwner(body);
    if (match?.id) {
      const db = getDb();
      db.prepare(
        "UPDATE sessions SET status = 'stopped', stopped_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).run(match.id);
      eventBus.emitSessionStatus(match.id, 'stopped', {
        to: 'stopped',
        evidence: 'session-end-hook',
        at: new Date().toISOString(),
      });
      sessionService.bumpLastActivity(match.id);
      console.log(`[hook:SessionEnd] session=${match.id.slice(0, 30)} → stopped (via ${match.strategy})`);
    }
  }

  console.log(`[hook] ${event}${transcriptPath ? ` → ${basename(transcriptPath)}` : ''}`);

  if (!transcriptPath || !transcriptPath.endsWith('.jsonl')) {
    eventBus.emitSystemEvent(`hook:${event}`, body);
    return { ok: true };
  }

  // Phase P.1 H1 — reject any transcript_path that doesn't resolve
  // under `~/.claude/projects/`. Prevents FD-leak DoS via fs.watch on
  // attacker-chosen paths AND the chat-endpoint's arbitrary-file-read
  // amplification (transcript_paths fed into readFileSync later).
  if (!isAllowedTranscriptPath(transcriptPath)) {
    console.warn(
      `[hook-event] REJECT transcript_path outside claudeProjectsDir: ${transcriptPath}`,
    );
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
  // Phase N.0 Patch 3 — every successful hook match counts as proof of
  // life. Bump BEFORE appendTranscriptPath so the heartbeat timestamp is
  // visible even on dedup'd hooks where no new path is stored.
  sessionService.bumpLastActivity(match.id);
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
