import { existsSync, statSync, readFileSync } from 'node:fs'; // statSync used in ranking
import { getDb } from '../db/connection.js';
import { jsonlDiscoveryService } from './jsonl-discovery.service.js';
import { sessionService } from './session.service.js';
import { fileWatcherService } from './file-watcher.service.js';
import { eventBus } from '../ws/event-bus.js';
import { hookMatchStats } from '../routes/hook-event.routes.js';

// A tracked JSONL is considered stale if it hasn't grown in this many ms —
// 30s is long enough to tolerate model 'thinking' pauses between tokens,
// short enough to catch a real rotation before the user notices.
const STALE_MS = 30_000;
// Only adopt a candidate JSONL if its mtime is within this window — avoids
// re-linking to an abandoned older transcript.
const FRESH_CANDIDATE_MS = 60_000;

// Scan the first N records of a candidate JSONL. Cheap — max ~5KB read.
const peekRecords = (path: string, n = 5): string[] => {
  try {
    const raw = readFileSync(path, 'utf-8');
    return raw.split('\n').slice(0, n).filter(Boolean);
  } catch {
    return [];
  }
};

// A continuation or fresh PM bootstrap is the only signal we trust for
// adopting a new JSONL. Unknown contents → skip.
const looksLikeContinuation = (path: string): boolean => {
  const lines = peekRecords(path, 10);
  for (const line of lines) {
    // PM bootstrap prompt fingerprint — landed via session.service inject.
    if (line.includes('You are the Lead PM for JStudio')) return true;
    // Claude Code writes a 'summary' record on auto-compact continuation.
    if (line.includes('"type":"summary"')) return true;
    // And a user 'message' that announces the session was compacted.
    if (line.includes('Previous Conversation Compacted')) return true;
  }
  return false;
};

interface TrackedSession {
  id: string;
  project_path: string;
  claude_session_id: string | null;
  transcript_path: string | null;
  status: string;
}

export const rotationDetectorService = {
  // Runs inside the periodic tick of the status-poller. Cheap: stats one
  // file per eligible session, only lists the directory on suspicion.
  sweep(): void {
    const db = getDb();
    const rows = db.prepare(
      `SELECT id, project_path, claude_session_id, transcript_path, status
       FROM sessions
       WHERE status IN ('working','waiting','idle')
         AND project_path IS NOT NULL`,
    ).all() as TrackedSession[];

    for (const row of rows) {
      try {
        this.checkOne(row);
      } catch (err) {
        console.warn(`[rotation] sweep error on ${row.id.slice(0, 30)}:`, (err as Error).message);
      }
    }
  },

  checkOne(row: TrackedSession, opts: { requireActive?: boolean; freshnessWindowMs?: number } = {}): void {
    const requireActive = opts.requireActive ?? true;
    // Default 60s window keeps the periodic sweep conservative (skips files
    // that stopped being written). HTTP fall-forward passes Infinity so a
    // currently-dormant-but-most-recent transcript still qualifies — the
    // user is reading NOW, better to serve a slightly stale-live file than
    // nothing.
    const freshnessWindowMs = opts.freshnessWindowMs ?? FRESH_CANDIDATE_MS;
    if (!row.project_path) return;
    const trackedMtime = this.mtimeOf(row.transcript_path);
    const now = Date.now();

    // Fresh? Nothing to do.
    if (trackedMtime && now - trackedMtime < STALE_MS) return;
    // Status gate — default on for the periodic sweep so we don't re-bind
    // sessions nobody is looking at (guards against sibling Claude processes
    // in the same cwd). The HTTP fall-forward opts out (user is actively
    // reading this session's chat, so serving fresh data wins).
    if (requireActive && row.status !== 'working' && row.status !== 'waiting') return;

    const files = jsonlDiscoveryService.findSessionFiles(row.project_path);
    if (files.length === 0) return;

    // Candidates: JSONLs newer than the tracked file that aren't IT, modified
    // within the freshness window. Sorted by recency (service returns desc).
    const rawCandidates = files.filter((f) => {
      if (f.filePath === row.transcript_path) return false;
      if (f.sessionId === row.claude_session_id) return false;
      return now - f.modifiedAt.getTime() < freshnessWindowMs;
    });
    if (rawCandidates.length === 0) return;

    // Enrich each with size + continuation signal so ranking and the
    // post-mortem log have everything in one place.
    const candidates = rawCandidates.map((c) => {
      let size = 0;
      try { size = statSync(c.filePath).size; } catch { /* vanished */ }
      return {
        ...c,
        size,
        ageMs: now - c.modifiedAt.getTime(),
        continuation: looksLikeContinuation(c.filePath),
      };
    });

    // Ranking — composite score, lowest wins:
    //   1. currentlyWriting (mtime ≤ 10s) + size ≥ 50KB           (strongest)
    //   2. continuation fingerprint                                (prior default)
    //   3. greatest size                                           (activity proxy)
    //   4. most recent mtime                                       (tiebreaker)
    // A currently-writing file beats a frozen bootstrap-shaped one because
    // the active-write signal is stronger evidence of liveness than a
    // starting-prefix match. That's exactly the OvaGas case where the
    // live 1.4MB transcript lacked the PM bootstrap fingerprint and got
    // rejected in favor of a tiny frozen one that had it.
    // 30s captures files actively being appended to — the PM's spec uses
    // this threshold specifically so a file that was written a few polling
    // cycles ago still counts as live. Tighter (10s) missed real-active
    // transcripts that paused briefly between token bursts.
    const CURRENTLY_WRITING_MS = 30_000;
    const SIZE_FLOOR = 50_000;
    const rank = (c: (typeof candidates)[number]): number => {
      const writingNow = c.ageMs <= CURRENTLY_WRITING_MS && c.size >= SIZE_FLOOR ? 0 : 1;
      // Lower is better; negate size and mtime so big/new wins in ascending sort.
      return writingNow * 1e12 + (c.continuation ? 0 : 5e11) - c.size - (10_000_000 - c.ageMs);
    };
    candidates.sort((a, b) => rank(a) - rank(b));
    const chosen = candidates[0]!;

    // Hard guard: if the tracked file exists and nothing currently-writing
    // AND the top candidate has no continuation signal AND it's small, bail.
    // Avoids hopping to an unrelated sibling agent's transcript.
    if (!chosen.continuation && chosen.ageMs > CURRENTLY_WRITING_MS && chosen.size < SIZE_FLOOR) {
      const stale = !row.transcript_path || !existsSync(row.transcript_path);
      if (!stale) {
        console.warn(
          `[rotation] ${row.id.slice(0, 30)}: ${candidates.length} candidate(s) — none look live (${candidates.map((c) => `${c.sessionId.slice(0, 8)}(${Math.round(c.size / 1024)}KB, ${Math.round(c.ageMs / 1000)}s-old, boot${c.continuation ? '✓' : '✗'})`).join(', ')}) — skipping`,
        );
        return;
      }
    }

    sessionService.upsertSession({
      id: row.id,
      claudeSessionId: chosen.sessionId,
      transcriptPath: chosen.filePath,
    });
    fileWatcherService.watchSpecificFile(chosen.filePath);
    hookMatchStats['rotation-detected'] += 1;
    const whyPicked = chosen.ageMs <= CURRENTLY_WRITING_MS && chosen.size >= SIZE_FLOOR
      ? 'currently-writing'
      : chosen.continuation
      ? 'continuation-fingerprint'
      : 'largest-recent';
    console.log(
      `[rotation] ${row.id.slice(0, 30)}: candidates=[${candidates.map((c) => `${c.sessionId.slice(0, 8)}(${Math.round(c.size / 1024)}KB, ${Math.round(c.ageMs / 1000)}s-old, boot${c.continuation ? '✓' : '✗'})`).join(', ')}] → picked ${chosen.sessionId.slice(0, 8)} via ${whyPicked}`,
    );

    const session = sessionService.getSession(row.id);
    if (session) eventBus.emitSessionUpdated(session);
  },

  mtimeOf(path: string | null): number | null {
    if (!path) return null;
    try {
      return statSync(path).mtime.getTime();
    } catch {
      return null;
    }
  },
};
