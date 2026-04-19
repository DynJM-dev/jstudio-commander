import type { SessionStatus, SessionActivity, EffortLevel } from '@commander/shared';
import { tmuxService } from './tmux.service.js';

// ─────────────────────────────────────────────────────────────────────
// PATTERN-MATCHING CONSTRAINT (Issue 8 P0, 8.1, 9 P2, 15)
//
// External tool output — Claude Code pane content, stdout, JSONL
// record fields — may change semantics between versions. Character-
// presence matches alone are not safe: `⏺` went from "in-progress"
// glyph (v1.x) to "reply-bullet" glyph (v2.x) with no schema version
// bump, and every session that happened to quote a Claude reply
// stuck in `working` state until the reply scrolled off pane.
//
// Rule: character-based matches MUST be constrained by semantic shape:
//   - Verb morphology — require `-ing` / `-ed` (live / just-finished
//     participles), or an explicit atypical-verb allowlist (`Idle`).
//     See `detectActivity`'s verb filter below.
//   - Line-start anchoring — real live-spinner glyphs begin the line;
//     reply content may contain the same char mid-line. See the
//     client-side counterpart in `src/utils/parseTerminalHint.ts`.
//   - Activity-event verification — UI labels that imply "Claude is
//     actively working" must gate on a recent activity event, not
//     session.status alone. Defense-in-depth against any future
//     trigger that flips status to `working` while the jsonl shows
//     a stale turn. See `src/utils/contextBarAction.ts`.
//   - SPINNER_CHARS vs SPINNER_GLYPHS — the former gates the tail-
//     scanner's "active evidence" heuristic (narrow), the latter
//     scopes the verb-extraction regex (broad, filtered downstream).
//   - Approval-prompt classifiers MUST match on explicit option
//     tokens (numbered list with `.` suffix, literal `(y/n)`, exact
//     `Allow` + `Deny` pair, `trust this folder` phrase). NOT on
//     tabular shape, broad trailing `?`, or `Esc to cancel` /
//     `Enter to confirm` alone — Claude Code prints those in every
//     viewer modal (`/status`, `/compact` preview, …). See
//     `prompt-detector.service.ts` for the full detection rules
//     and the Issue 9 P2 rationale.
//   - Stale-elapsed heuristics MUST be gated on completion-verb
//     morphology (`/ed$/` or COMPLETION_VERBS set). A live `-ing`
//     verb at any elapsed is a legitimate long generation — Claude
//     Code routinely runs 10–30min of real work with a stable
//     spinner + incrementing elapsed. Only past-tense "frozen-
//     footer" panes (`✻ Cooked 21261s`) warrant an elapsed-based
//     force-idle. Issue 15's false-idle was stale-elapsed firing
//     unconditionally on `-ing` verbs.
//
// When adding a new pattern match: state its semantic shape
// constraint inline. Not doing so is how Issue 8 P0 was possible.
// ─────────────────────────────────────────────────────────────────────

// Parsed from the Claude Code footer. The line format (as observed across
// 4.6 / 4.7 releases):
//   "<spinner> <Verb>… (<elapsed> · ↓ <tokens> tokens · thinking with <effort> effort)"
// The parenthetical is optional and its inner segments are independent —
// older/newer builds drop `↓`, re-order the segments, or omit the
// "thinking with X effort" tail entirely. We capture the whole block then
// pick out each segment separately.
//
// Verb set is deliberately open. Claude's Hullaballoo / Tomfoolering /
// Doodling flavor rotates every release; pinning to an enum would stale.
// `raw` holds the entire matched line so the client can render unknown
// shapes forward-compatibly.
const SPINNER_GLYPHS = '✢✣✤✥✦✧✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽❀❁❂❃❄❅❆❇❈❉❊❋⏺';
// Verb is a single capitalized word — all Claude Code active-indicator
// verbs observed so far (Ruminating, Doodling, Brewing, Cogitating,
// Composing, Crunching, Hullaballooing, Tomfoolering, etc.) fit this
// shape. Greedy `[a-z]+` avoids the non-greedy-clamp-to-minimum bug we
// hit when the outer optional terminator let the engine settle on a
// 2-char match ("Ru", "Do"). If Claude ships a two-word verb later, this
// captures the first word — good enough for the chip; the `raw` field
// still carries the full line.
const ACTIVITY_RE = new RegExp(
  `([${SPINNER_GLYPHS}])\\s+([A-Z][a-z]+)(?:…|\\.\\.\\.)?(?:\\s*\\(([^)]*)\\))?`,
);
const ELAPSED_RE = /(\d+m\s*\d+s|\d+s|\d+m)/;
const TOKENS_RE = /(?:↓\s*)?(\d[\d,]*)\s*tokens?/i;
const EFFORT_RE = /thinking with (medium|high|xhigh|max) effort/i;

// Phase L — Claude Code's post-turn footer occasionally splits the verb
// and the elapsed onto separate lines, with `·` separator lines between:
//   ✻ Cooked
//   ·
//   21261s
// The verb-line paren is empty in this form, so elapsed must be sourced
// from a line a few rows below. We only scan forward (past the verb line)
// up to MULTI_LINE_ELAPSED_SPAN lines, stopping at a new prompt or blank
// break so we don't accidentally harvest an elapsed from a later frame.
const MULTI_LINE_ELAPSED_SPAN = 4;

// Parses an elapsed string ("21261s", "5m", "2m 30s") into seconds.
// Returns null on unparseable input — caller decides the fallback.
export const parseElapsedSeconds = (elapsed: string | undefined | null): number | null => {
  if (!elapsed) return null;
  const trimmed = elapsed.trim();
  const mmSec = /^(\d+)m\s*(\d+)s$/.exec(trimmed);
  if (mmSec) return Number(mmSec[1]) * 60 + Number(mmSec[2]);
  const m = /^(\d+)m$/.exec(trimmed);
  if (m) return Number(m[1]) * 60;
  const s = /^(\d+)s$/.exec(trimmed);
  if (s) return Number(s[1]);
  return null;
};

export const detectActivity = (paneContent: string): SessionActivity | null => {
  // Scan the tail — the active indicator sits at/near the bottom of the
  // pane. Reading bottom-up caps the regex scan to O(lines-checked) and
  // picks the MOST RECENT spinner line if Claude stacks two frames in
  // the capture window.
  const lines = paneContent.split('\n');
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    const line = lines[i];
    if (!line) continue;
    const match = ACTIVITY_RE.exec(line);
    if (!match) continue;

    const spinner = match[1] ?? '';
    const verb = match[2] ?? '';
    const paren = match[3] ?? '';

    // Issue 8 Part 3 — reject reply-content false positives. Claude Code's
    // live-spinner verbs are always progressive (-ing: Thinking, Ruminating,
    // Cogitating, Composing, Brewing, Doodling, Nesting, Pondering,
    // Hullaballooing, Standing, Waiting) or just-completed (-ed: Cooked,
    // Crunched, Brewed, Finished, Composed, Ruminated). Claude's replies
    // start with arbitrary first words ("Opus 4.7…", "Model:…", "The…",
    // "Processing your request…"). Accept only -ing/-ed verbs OR a small
    // allowlist of short verb-like tokens Phase J relies on (Idle is the
    // one that doesn't fit the -ing/-ed rule). Keeps the Phase J IDLE_VERBS
    // and Phase L COMPLETION_VERBS paths intact while blocking reply
    // content leaking via the `⏺` reply-bullet glyph.
    const isKnownAtypicalVerb = verb === 'Idle';
    if (!isKnownAtypicalVerb && !/ing$|ed$/i.test(verb)) continue;

    let elapsed = ELAPSED_RE.exec(paren)?.[1]?.replace(/\s+/g, ' ').trim();

    // Multi-line footer: if the verb line had no parenthetical (or the
    // paren lacked an elapsed), look a few lines below for a bare elapsed
    // token. Claude Code's "✻ Cooked" / "21261s" split is the canonical
    // case. Stop at a new `❯` prompt so we don't slurp elapsed from a
    // subsequent frame.
    if (!elapsed) {
      for (let j = i + 1; j < Math.min(lines.length, i + 1 + MULTI_LINE_ELAPSED_SPAN); j++) {
        const below = lines[j] ?? '';
        if (/^\s*❯/.test(below)) break;
        const bare = ELAPSED_RE.exec(below);
        if (bare?.[1]) {
          elapsed = bare[1].replace(/\s+/g, ' ').trim();
          break;
        }
      }
    }

    const tokensMatch = TOKENS_RE.exec(paren)?.[1];
    const tokens = tokensMatch ? Number.parseInt(tokensMatch.replace(/,/g, ''), 10) : undefined;
    const effortMatch = EFFORT_RE.exec(paren)?.[1]?.toLowerCase();
    const effort = (effortMatch === 'medium' || effortMatch === 'high' || effortMatch === 'xhigh' || effortMatch === 'max')
      ? (effortMatch as EffortLevel)
      : undefined;

    return {
      spinner,
      verb,
      elapsed,
      tokens: Number.isFinite(tokens) ? tokens : undefined,
      effort,
      raw: line.trim(),
    };
  }
  return null;
};

// Issue 8 Part 3 — `⏺` deliberately omitted. Claude Code v2.x uses it
// as the REPLY-BULLET glyph prefixing every assistant response line,
// NOT as a live-spinner glyph. Leaving it in here caused
// hasActiveInTail to treat every quiet pane with an echoed reply as
// "active", locking sessions into a stuck `working` state until the
// reply scrolled out of the tail (or never). The real live-spinner
// glyphs are the Braille frames + ✻/✶; `⏺` stays in SPINNER_GLYPHS
// (for detectActivity) because genuine completion / thinking lines
// also start with `⏺` (`⏺ Cogitating (3s · 1234 tokens)`), but the
// verb-filter below guards against reply-content false positives.
const SPINNER_CHARS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✶';
const ACTIVE_INDICATORS = [
  /Thinking/i, /Nesting/i, /Running \d+/i, /\d+%/,
  /Reading \d+/i, /Searching/i, /Editing/i, /Writing/i,
  /esc to interrupt/i, /ctrl\+b/i,
  /Hullaballoo/i, /Cogitat/i, /Brewed/i, /Crunching/i, // Claude thinking verbs
  /tool uses?/i, /tokens?\)/i, // "35 tool uses · 108.4k tokens"
  /\.{3}$/, // trailing "..." indicates in-progress
];
const IDLE_INDICATORS = [
  /^❯\s*$/,        // bare prompt
  /^❯\s+\S/,       // prompt with user input shown (waiting for Claude)
  /Crunched for/i,  // completion indicator
  /Cooked for/i,    // newer completion indicator variant observed in prod
  /Finished in/i,   // another Claude completion line
  /^>\s*$/, /^\$\s*$/,
];
// Patterns that definitively mean "waiting for user input". Kept specific —
// #236 removed the bare /\?\s*$/m pattern because Claude Code's idle footer
// ("new task?", "? for shortcuts") matched it and flagged idle sessions as
// waiting. Every entry here is either a full phrase or a bracketed choice
// that only appears in a real permission prompt.
const WAITING_INDICATORS = [
  /waiting for input/i,
  /\(y\/n\)/i, /\(Y\/n\)/i,
  /\[y\/N\]/i, /\[Y\/n\]/i,
  /Do you want to proceed/i,
  /Do you want to approve/i,
  /Do you want to use/i,
  /Do you want to save/i,
  /trust this folder/i,
  /Allow.*Deny/i,
  /Continue\?/i,
  /Proceed\?/i,
  /^Esc to cancel/mi, /^Enter to confirm/mi,
];

// Idle-footer phrases Claude Code renders BELOW the ❯ input when no prompt
// is active. Presence of any of these means "this pane's last lines are
// chrome, not a prompt" — we require a strong-signal waiting pattern
// (numbered-choice block, bracketed choice, or a "Do you want to" phrase)
// to still classify the session as waiting despite the footer being visible.
const IDLE_FOOTER_MARKERS = [
  /⏵⏵ accept edits on/i,
  /\? for shortcuts/i,
  /new task\?/i,
  /\/clear to save/i,
  /shift\+tab to cycle/i,
];

const hasIdleFooter = (text: string): boolean => {
  const tail = text.split('\n').slice(-25).join('\n');
  return IDLE_FOOTER_MARKERS.some((re) => re.test(tail));
};

// Claude Code's numbered-choice prompts sometimes render without the
// leading `❯` marker on the choice line (for example when the cursor
// is on a different line or when Claude rewrites the UI mid-frame).
// Detect a block of 2+ consecutive numbered lines (1. , 2. , 3. ) within
// the last 12 lines as a strong "choice list visible" signal.
const hasNumberedChoiceBlock = (text: string, n = 12): boolean => {
  const lines = text.split('\n').slice(-n);
  let consecutive = 0;
  for (const line of lines) {
    if (/^\s*\d+\.\s+\S/.test(line)) {
      consecutive += 1;
      if (consecutive >= 2) return true;
    } else if (line.trim().length > 0) {
      consecutive = 0;
    }
  }
  return false;
};
const ERROR_PATTERNS = [/^Error:/m, /^error:/m, /FATAL/i, /panic:/i];
const DECORATOR_RE = /^[─━═┈┄\-]{4,}$/;

const getLastMeaningfulLine = (text: string): string => {
  const lines = text.split('\n');
  // Walk backwards, skip empty lines and decorators
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i]?.trim() ?? '';
    if (trimmed.length === 0) continue;
    if (DECORATOR_RE.test(trimmed)) continue;
    return trimmed;
  }
  return '';
};

// Check if any line in the last N lines contains the IDLE prompt (❯ without numbered choice)
const hasIdlePromptInTail = (text: string, n = 6): boolean => {
  const lines = text.split('\n').slice(-n);
  // ❯ followed by text (user input) or nothing = idle prompt
  // ❯ followed by a number + dot (❯ 1. Yes) = numbered choice = waiting, NOT idle
  return lines.some((l) => /^\s*❯/.test(l) && !/^\s*❯\s*\d+\./.test(l));
};

// Check if numbered choice prompt is in the tail (❯ 1. pattern)
const hasNumberedChoiceInTail = (text: string, n = 6): boolean => {
  const lines = text.split('\n').slice(-n);
  return lines.some((l) => /^\s*❯\s*\d+\./.test(l));
};

// True iff the last N lines show evidence of active work (spinner glyph
// OR an ACTIVE_INDICATORS match). Used to short-circuit the generic
// `waiting for input` regex fallback when Claude is clearly still in a
// turn — chat-content phrases ("waiting for input from coder-14") in
// the scrollback must not flip the live status to 'waiting'.

// Phase U.1 Fix 2 — Commander's own statusline chrome always renders at
// pane bottom: "Opus 4.7 │ ctx 33% │ 5h 46% │ 7d 35% │ $26.54" +
// "⏵⏵ bypass permissions on · 1 shell". These match generic ACTIVE_INDICATORS
// (/\d+%/ fires three times on the ctx/5h/7d row) but carry zero active-work
// signal. Skip them from the active-indicator scan so an idle pane whose
// scrollback has the chrome at bottom doesn't false-positive as working.
// Does NOT touch ACTIVE_INDICATORS itself — real signals like "47% complete",
// "Reading 123", "Searching", "Editing", "Writing" still match normally.
export const STATUSLINE_CHROME_MARKERS = [
  /ctx\s*\d+%/i,                    // ctx 33%
  /\b\d+[hd]\s+\d+%/i,              // 5h 46%, 7d 35% — rate-limit cells
  /⏵⏵\s+bypass permissions on/i,
  /⏵⏵\s+accept edits on/i,          // mirror of IDLE_FOOTER_MARKERS entry
];

const isStatuslineChrome = (line: string): boolean =>
  STATUSLINE_CHROME_MARKERS.some((re) => re.test(line));

const hasActiveInTail = (text: string, n = 8): boolean => {
  const lines = text.split('\n').slice(-n);
  for (const line of lines) {
    if (isStatuslineChrome(line)) continue;
    if ([...line].some((ch) => SPINNER_CHARS.includes(ch))) return true;
    for (const pattern of ACTIVE_INDICATORS) {
      if (pattern.test(line)) return true;
    }
  }
  return false;
};

export interface DetectedStatus {
  status: SessionStatus;
  evidence: string;
  activity: SessionActivity | null;
}

// Verbs that follow Claude Code's spinner glyph but ACTUALLY mean "not
// working" — the spinner is present as visual continuity, but the pane
// is parked (Phase J.1). Without this allowlist, the active-indicator
// hoist below flips PMs that are monitoring teammates to status=working
// every time their pane shows "✻ Idle · teammates running".
const IDLE_VERBS = new Set(['Idle', 'Waiting', 'Paused', 'Standing']);

// Phase L — past-tense / completion verbs. Claude Code's footer lingers
// on `✻ Cooked`, `✻ Crunched`, `✻ Brewed`, `✻ Finished`, etc. AFTER a
// turn completes; the spinner glyph stays for visual continuity but the
// turn is done. Without this allowlist, any pane that happens to still
// show the post-turn frame gets misclassified as `working` indefinitely
// (#Phase-L report: a session with `✻ Cooked / 21261s` was flagged
// working for 5.9 hours).
//
// The explicit set covers the verbs observed in the wild; the `/ed$/`
// fallback catches future past-tense additions without a code change.
const COMPLETION_VERBS = new Set([
  'Cooked', 'Crunched', 'Brewed', 'Finished', 'Composed',
  'Ruminated', 'Doodled', 'Cogitated', 'Pondered', 'Nested',
  'Stewed', 'Percolated', 'Hullaballooed', 'Tomfoolered',
]);

const isCompletionVerb = (verb: string): boolean => {
  if (COMPLETION_VERBS.has(verb)) return true;
  // 4-char+ floor so three-letter odd-balls don't false-trigger. Every
  // past-tense Claude verb observed so far is >=5 characters (Cooked,
  // Brewed, Nested, etc).
  return verb.length >= 4 && /ed$/.test(verb);
};

// Phase L — any Claude turn longer than STALE_ELAPSED_SECONDS is almost
// certainly a frozen footer, not a live turn. Real high-effort runs cap
// well under this; the user's stale pane read 21261s (5.9h). When the
// activity carries an elapsed this large, force idle regardless of the
// verb — belt-and-suspenders for cases where a brand-new Claude verb
// slips past the COMPLETION_VERBS allowlist but still stays visible
// past a fresh turn boundary.
const STALE_ELAPSED_SECONDS = 600;

// Exposed for unit tests — pure function, single-string input, no I/O.
// `classifyStatusFromPane` is the same branch tree the poller uses, just
// without the live tmux capture. Testing the branches in isolation is
// the only sane way to pin invariants like Phase J.1's IDLE_VERBS gate.
export const classifyStatusFromPane = (paneContent: string): Omit<DetectedStatus, 'activity'> => {
  const lastLine = getLastMeaningfulLine(paneContent);

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(paneContent)) {
      return { status: 'error', evidence: `error pattern: ${pattern.source.slice(0, 24)}` };
    }
  }

  if (hasNumberedChoiceInTail(paneContent) || hasNumberedChoiceBlock(paneContent)) {
    return { status: 'waiting', evidence: 'numbered-choice prompt' };
  }

  if (hasActiveInTail(paneContent)) {
    // Verb-aware override (Phase J.1 + L): the spinner glyph alone is
    // not enough to call this `working`. Three separate exits beat the
    // hoist:
    //   1. IDLE_VERBS — parked verbs (Idle / Waiting / Paused / Standing).
    //   2. COMPLETION_VERBS / `-ed` suffix — the post-turn footer shows
    //      past-tense verbs (Cooked / Crunched / Brewed / Finished) with
    //      the spinner still drawn for visual continuity.
    //   3. Stale elapsed — any turn elapsed past STALE_ELAPSED_SECONDS
    //      is not a real live turn; the footer just never repainted.
    // A genuine `✻ Ruminating` / `✽ Doodling` / `⏺ Brewing` still wins.
    const activity = detectActivity(paneContent);
    if (activity) {
      if (IDLE_VERBS.has(activity.verb)) {
        return { status: 'idle', evidence: `verb=${activity.verb} overrides spinner hoist` };
      }
      if (isCompletionVerb(activity.verb)) {
        // Belt-and-suspenders: a past-tense verb with a very large
        // elapsed is the Phase L "frozen footer" class — Claude Code
        // lingers on `✻ Cooked / 21261s` post-turn. The completion
        // branch above already flips the state to idle; leaving the
        // stale-elapsed log-evidence here just preserves the Phase L
        // reasoning trail in the ring buffer.
        //
        // Issue 15 — PATTERN-MATCHING CONSTRAINT (§24):
        // stale-elapsed MUST be gated on completion-verb morphology.
        // A live `-ing` verb at 12m 45s is a legitimate long
        // generation (Claude Code verification summaries, architectural
        // analyses routinely run 10–30min in the wild). Flipping those
        // to idle was the false-idle class this issue fixes.
        //
        // The `/ed$/` fallback inside isCompletionVerb (line 345)
        // already catches unknown future past-tense verbs, so the
        // belt-and-suspenders case is still handled without a
        // duplicate elapsed check.
        const secs = parseElapsedSeconds(activity.elapsed);
        if (secs !== null && secs > STALE_ELAPSED_SECONDS) {
          return { status: 'idle', evidence: `past-tense verb=${activity.verb} stale elapsed ${secs}s` };
        }
        return { status: 'idle', evidence: `past-tense verb=${activity.verb}` };
      }
      // Live `-ing` verbs: no stale-elapsed flip. Phase U.1's separate
      // `last_activity_at` poller guard (STALE_ACTIVITY_MS=90s, pinned
      // in status-poller.service.ts) catches genuinely stuck sessions
      // via absence of hook events, independent of pane-elapsed.
    }
    return { status: 'working', evidence: 'active-indicator in tail' };
  }

  if (!hasIdleFooter(paneContent)) {
    for (const pattern of WAITING_INDICATORS) {
      if (pattern.test(paneContent)) {
        return { status: 'waiting', evidence: `waiting pattern: ${pattern.source.slice(0, 24)}` };
      }
    }
  }

  if (hasIdlePromptInTail(paneContent)) {
    const afterPrompt = paneContent.split(/❯[^\n]*\n/).pop() ?? '';
    const afterTrimmed = afterPrompt.trim();
    if (afterTrimmed.length > 0 && !DECORATOR_RE.test(afterTrimmed)) {
      // Phase U.1 Fix 2 — skip Commander's statusline chrome lines before
      // testing ACTIVE_INDICATORS. The chrome's "ctx N% │ 5h M% │ 7d P%"
      // sits right after ❯ for idle panes; without this filter, /\d+%/
      // falsely flags them as working.
      const nonChromeAfter = afterTrimmed
        .split('\n')
        .filter((line) => !isStatuslineChrome(line))
        .join('\n');
      if (nonChromeAfter.length > 0) {
        for (const pattern of ACTIVE_INDICATORS) {
          if (pattern.test(nonChromeAfter)) {
            return { status: 'working', evidence: 'active content after ❯' };
          }
        }
      }
    }
    return { status: 'idle', evidence: 'idle ❯ prompt visible' };
  }

  for (const pattern of IDLE_INDICATORS) {
    if (pattern.test(lastLine)) {
      return { status: 'idle', evidence: `idle pattern: ${pattern.source.slice(0, 24)}` };
    }
  }

  if ([...lastLine].some((ch) => SPINNER_CHARS.includes(ch))) {
    return { status: 'working', evidence: 'spinner glyph on last line' };
  }
  for (const pattern of ACTIVE_INDICATORS) {
    if (pattern.test(lastLine)) {
      return { status: 'working', evidence: `active pattern: ${pattern.source.slice(0, 24)}` };
    }
  }

  return { status: 'idle', evidence: 'fallthrough → idle' };
};

export const agentStatusService = {
  detectStatus(tmuxSessionName: string): SessionStatus {
    return this.detectStatusDetailed(tmuxSessionName).status;
  },

  // Richer variant — returns status + evidence + parsed live activity in one
  // capture. The poller uses this; the status-history ring buffer records the
  // evidence; the WS event carries both activity and evidence on transitions.
  detectStatusDetailed(tmuxSessionName: string): DetectedStatus {
    if (!tmuxService.hasSession(tmuxSessionName)) {
      return { status: 'stopped', evidence: 'no tmux session', activity: null };
    }
    const paneContent = tmuxService.capturePane(tmuxSessionName, 25);
    const core = classifyStatusFromPane(paneContent);
    const activity = detectActivity(paneContent);
    return { ...core, activity };
  },

  detectStatusBatch(tmuxSessionNames: string[]): Record<string, SessionStatus> {
    const results: Record<string, SessionStatus> = {};
    for (const name of tmuxSessionNames) {
      results[name] = this.detectStatus(name);
    }
    return results;
  },

  detectStatusDetailedBatch(tmuxSessionNames: string[]): Record<string, DetectedStatus> {
    const results: Record<string, DetectedStatus> = {};
    for (const name of tmuxSessionNames) {
      results[name] = this.detectStatusDetailed(name);
    }
    return results;
  },
};
