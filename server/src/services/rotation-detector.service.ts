import { existsSync, statSync, readFileSync } from 'node:fs';
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

  checkOne(row: TrackedSession): void {
    if (!row.project_path) return;
    const trackedMtime = this.mtimeOf(row.transcript_path);
    const now = Date.now();

    // Fresh? Nothing to do.
    if (trackedMtime && now - trackedMtime < STALE_MS) return;
    // Only act on sessions where rotation matters — `idle` sessions can keep
    // a stale transcript until they resume (no UX impact).
    if (row.status !== 'working' && row.status !== 'waiting') return;

    const files = jsonlDiscoveryService.findSessionFiles(row.project_path);
    if (files.length === 0) return;

    // Candidates: JSONLs newer than the tracked file that aren't IT, modified
    // within the freshness window. Sorted by recency (service returns desc).
    const candidates = files.filter((f) => {
      if (f.filePath === row.transcript_path) return false;
      if (f.sessionId === row.claude_session_id) return false;
      return now - f.modifiedAt.getTime() < FRESH_CANDIDATE_MS;
    });
    if (candidates.length === 0) return;

    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      // Prefer a continuation-shaped candidate when multiple qualify so we
      // don't adopt a sibling agent's transcript by accident.
      const continuation = candidates.find((c) => looksLikeContinuation(c.filePath));
      if (continuation) {
        chosen = continuation;
      } else {
        console.warn(
          `[rotation] ${row.id.slice(0, 30)}: ${candidates.length} fresh candidates, none look like continuations — skipping`,
        );
        return;
      }
    }

    // Single candidate or continuation winner — only adopt if it was written
    // recently enough OR it looks like a continuation. A lone fresh file
    // with nothing identifying is ambiguous; don't bind.
    if (candidates.length === 1 && !looksLikeContinuation(chosen.filePath)) {
      // Still adopt IF the old transcript is missing entirely (hard rotation)
      // OR the candidate's start time is after the tracked file's mtime —
      // otherwise we'd risk swapping to an unrelated session.
      const stale = !row.transcript_path || !existsSync(row.transcript_path);
      if (!stale) return;
    }

    sessionService.upsertSession({
      id: row.id,
      claudeSessionId: chosen.sessionId,
      transcriptPath: chosen.filePath,
    });
    fileWatcherService.watchSpecificFile(chosen.filePath);
    hookMatchStats['rotation-detected'] += 1;
    console.log(
      `[rotation] ${row.id.slice(0, 30)}: ${row.claude_session_id?.slice(0, 8) ?? 'none'} → ${chosen.sessionId.slice(0, 8)} (${chosen.filePath.split('/').pop()})`,
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
