import { readFileSync } from 'node:fs';

// Phase L B2 — per-JSONL origin discriminator.
//
// Every record Claude Code writes to a JSONL carries metadata about the
// agent that owns it. Coder JSONLs carry `agentName` (e.g. "coder") and
// `teamName` (e.g. "jlp-patrimonio"); PM/lead JSONLs omit `agentName` and
// carry the PM's own teamName. The owner-resolution flow uses this to
// disambiguate which Commander session a file belongs to when multiple
// sessions share the same cwd — without it, the cwd-fallback in both
// hook-event.resolveOwner AND watcher-bridge can false-attribute a
// coder's events to the PM that happens to be listed first, leading to
// "cross-session tool-call leakage" where the coder's tool_use blocks
// render in the PM's chat view.
//
// Both synchronous (`readJsonlOrigin`) and pure (`parseOriginFromLines`)
// forms are exported so tests can exercise the parser without a file.

export interface JsonlOrigin {
  // The agent slug Claude Code writes into each record. Present on
  // teammate-coder JSONLs ("coder", "pm-2", ...), absent on lead/PM
  // JSONLs.
  agentName: string | null;
  // The team slug — matches Commander's sessions.team_name column.
  teamName: string | null;
  // The Claude session UUID — matches the JSONL filename. Useful as a
  // secondary identity check beyond the filename-based path.
  claudeSessionId: string | null;
  // The cwd Claude Code ran in. Matches Commander's project_path.
  cwd: string | null;
}

// Peel the first few records of a JSONL to find one with identity fields.
// Stops at the first parseable record — Claude Code writes header fields
// on every record so any of the first handful is sufficient. Reads at
// most SCAN_LINE_BUDGET lines so a corrupt 50 MB JSONL doesn't stall the
// caller.
const SCAN_LINE_BUDGET = 6;

export const parseOriginFromLines = (lines: string[]): JsonlOrigin | null => {
  for (const line of lines.slice(0, SCAN_LINE_BUDGET)) {
    try {
      const rec = JSON.parse(line) as Record<string, unknown>;
      if (!rec || typeof rec !== 'object') continue;
      return {
        agentName: typeof rec.agentName === 'string' ? rec.agentName : null,
        teamName: typeof rec.teamName === 'string' ? rec.teamName : null,
        claudeSessionId: typeof rec.sessionId === 'string' ? rec.sessionId : null,
        cwd: typeof rec.cwd === 'string' ? rec.cwd : null,
      };
    } catch {
      continue;
    }
  }
  return null;
};

// Read-head budget — 16 KiB is enough for ~10-20 JSONL records, more
// than we need for the first-record scan, while bounding worst-case
// read cost on very large files.
const READ_HEAD_BYTES = 16 * 1024;

export const readJsonlOrigin = (filePath: string): JsonlOrigin | null => {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const head = raw.length > READ_HEAD_BYTES ? raw.slice(0, READ_HEAD_BYTES) : raw;
    const lines = head.split('\n').filter((l) => l.trim().length > 0);
    return parseOriginFromLines(lines);
  } catch {
    return null;
  }
};

// Convenience predicate — true iff the origin (if known) suggests the
// JSONL belongs to a teammate-coder agent. Used by resolveOwner to gate
// pm-cwd-rotation off and by watcher-bridge to scope the cwd fallback
// to non-lead-pm rows.
export const isCoderJsonl = (origin: JsonlOrigin | null): boolean =>
  !!origin && !!origin.agentName;
