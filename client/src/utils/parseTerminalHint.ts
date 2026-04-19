// Issue 8.1 Part 1 — pattern-matching hardening.
//
// Reads the tail of tmux pane output (the `lines` payload from
// `/api/sessions/:id/output`) and derives a short, UI-friendly hint
// describing what Claude is doing. Extracted from usePromptDetection
// for isolated testing.
//
// The hardening vs pre-8.1:
//   - Glyph match (`✻` / `✶`) requires a LINE-START anchor on a
//     tail-line. Claude Code's live-spinner lines always begin with
//     the glyph; reply content may contain the char mid-line. This
//     is the same lesson Issue 8 P0 applied to ⏺ on the server.
//   - Verb match requires the verb token (Thinking, Cogitating,
//     Hullaballoo, etc.) to appear as a STANDALONE TOKEN with a
//     live-spinner morphology — progressive -ing or -ed suffix —
//     not a substring of a larger word. `thinking through` in chat
//     prose no longer false-matches; `✻ Thinking…` on its own line
//     still does.
//   - A single exact-token allowlist covers verbs Claude Code uses
//     that don't fit the `-ing/-ed` morphology (e.g. `Idle`) — the
//     same atypical-verb hook the server-side filter uses.
//
// PATTERN-MATCHING CONSTRAINT (Issue 8 P0, 8.1):
// External tool output may change semantics between versions.
// Character-based matches must be constrained by semantic shape
// (verb morphology, line-start position, explicit tokens). References:
//   - SPINNER_CHARS vs SPINNER_GLYPHS distinction (server, Issue 8 P0)
//   - Verb-sanity filter: -ing / -ed / Idle (server, Issue 8 P0)
//   - Line-start anchoring + token-boundary verb match (this file, 8.1 P1)

// Characters Claude Code uses as live-spinner glyphs on the FIRST
// character of the live indicator line. Does NOT include `⏺` (reply-
// bullet, see Issue 8 P0 rationale on the server).
const LIVE_SPINNER_GLYPH_RE = /^\s*[✻✶][\s]/;

// Live-thinking verbs Claude Code puts after the spinner. Anchored to
// a word-boundary so `rethinking` / `outthinking` etc. in reply prose
// don't false-match. Morphology constraint: `-ing` or `-ed` suffix.
const LIVE_THINKING_VERB_RE =
  /\b(Thinking|Cogitating|Cogitated|Hullaballooing|Hullaballooed|Herding|Herded|Pondering|Pondered|Mulling|Mulled|Spinning|Spun|Brewing|Brewed|Crunching|Crunched|Nesting|Nested|Ruminating|Ruminated|Composing|Composed|Doodling|Doodled|Cooked|Cooking|Stewing|Stewed|Percolating|Percolated)\b/;

// Exact-token escape hatch for live verbs that don't fit -ing/-ed
// morphology (Claude Code's idle/parked verbs). Mirrors the server
// `Idle` allowlist in agent-status.service.ts.
const LIVE_ATYPICAL_VERBS = new Set(['Idle']);

const hasLiveSpinnerLineInTail = (lines: string[]): boolean => {
  const tail = lines.slice(-10);
  for (const line of tail) {
    if (LIVE_SPINNER_GLYPH_RE.test(line) && LIVE_THINKING_VERB_RE.test(line)) return true;
    const trimmed = line.trimStart();
    for (const v of LIVE_ATYPICAL_VERBS) {
      if (trimmed.startsWith(v) || trimmed.slice(2).startsWith(v)) return true;
    }
  }
  return false;
};

export const parseTerminalHint = (lines: string[]): string | null => {
  const tail = lines.slice(-10).map((l) => l.trim()).filter(Boolean);
  const joined = tail.join(' ');

  // Compaction
  if (/[Cc]ompacting|[Ss]ummariz/i.test(joined)) {
    return 'Compacting context...';
  }

  // Explore/Agent subagents
  if (/Explore\s*\(/i.test(joined) || /Explore\s+\w+/i.test(joined)) {
    const desc = joined.match(/Explore\s+([^·]+)/i)?.[1]?.trim();
    return desc ? `Exploring: ${desc.slice(0, 50)}...` : 'Exploring codebase...';
  }
  if (/Agent\s*\(/i.test(joined) || /Running\s+\d+\s+.*agent/i.test(joined)) {
    return 'Running subagent...';
  }
  if (/Skill\s*\(/i.test(joined)) {
    return 'Loading skill...';
  }

  // Tool chain count
  const toolCountMatch = joined.match(/\+(\d+)\s+more\s+tool/i);
  if (toolCountMatch) {
    return `Running ${toolCountMatch[1]}+ tools...`;
  }

  // Extended thinking with duration — verb + live parenthetical. The
  // paren presence is itself a strong live signal (Claude Code puts
  // it in the spinner-line footer), so this check keeps the broader
  // thinking-verb regex.
  const thinkMatch = joined.match(/(Hullaballoo|Cogitat|Herding|Pondering|Spinning|Mulling|Brewed|Crunched|Nesting|Ruminat|Cooked)\w*[….]* *\((\dm?\s*\d+s|\d+s)/i);
  if (thinkMatch) {
    return `Thinking deeply... (${thinkMatch[2]})`;
  }

  // Issue 8.1 P1 — thinking/reasoning hint WITHOUT duration. Pre-8.1
  // this scanned `joined` as one blob and matched any occurrence of
  // ✻/✶/Thinking/Cogitat/... — including reply prose that mentioned
  // thinking. Now requires an actual LIVE spinner line in the tail
  // (glyph at line start + live verb on the same line) OR a live
  // atypical verb. No blob matching.
  if (hasLiveSpinnerLineInTail(lines)) {
    return 'Thinking deeply...';
  }

  // Nesting (subagent work) — use the live-spinner-line check so reply
  // prose saying "nesting" doesn't leak.
  if (/Nesting/i.test(joined)) {
    const nestMatch = joined.match(/Nesting[….]* *\(([^)]+)\)/i);
    if (nestMatch) return `Nesting... (${nestMatch[1]})`;
    if (hasLiveSpinnerLineInTail(lines)) return 'Nesting...';
  }

  // Specific tool calls — these patterns are syntactic (`Bash(` with
  // a paren) and unambiguous, so they don't need the spinner-line
  // anchor. If Claude writes "Bash(echo)" in prose, matching is
  // acceptable as a degraded signal rather than a false flag.
  if (/Bash\s*\(/i.test(joined)) return 'Running command...';
  if (/Read\s*\(/i.test(joined)) {
    const file = joined.match(/Read\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Reading ${file}...` : 'Reading file...';
  }
  if (/Edit\s*\(/i.test(joined)) {
    const file = joined.match(/Edit\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Editing ${file}...` : 'Editing file...';
  }
  if (/Write\s*\(/i.test(joined)) {
    const file = joined.match(/Write\s*\(\s*([^)]+)\)/i)?.[1]?.split('/').pop();
    return file ? `Writing ${file}...` : 'Writing file...';
  }
  if (/Grep\s*\(|Glob\s*\(/i.test(joined)) return 'Searching codebase...';

  // Generic reading/listing/searching/editing/writing
  if (/Reading|Listing/i.test(joined)) return 'Reading files...';
  if (/Searching/i.test(joined)) return 'Searching...';
  if (/Editing/i.test(joined)) return 'Editing...';
  if (/Writing/i.test(joined)) return 'Writing...';

  // Generic working indicators
  if (/esc to interrupt|ctrl\+b/i.test(joined)) return 'Working...';

  return null;
};
