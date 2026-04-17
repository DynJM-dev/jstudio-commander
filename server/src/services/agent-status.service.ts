import type { SessionStatus, SessionActivity, EffortLevel } from '@commander/shared';
import { tmuxService } from './tmux.service.js';

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
const EFFORT_RE = /thinking with (high|xhigh|max) effort/i;

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

    const elapsed = ELAPSED_RE.exec(paren)?.[1]?.replace(/\s+/g, ' ').trim();
    const tokensMatch = TOKENS_RE.exec(paren)?.[1];
    const tokens = tokensMatch ? Number.parseInt(tokensMatch.replace(/,/g, ''), 10) : undefined;
    const effortMatch = EFFORT_RE.exec(paren)?.[1]?.toLowerCase();
    const effort = (effortMatch === 'high' || effortMatch === 'xhigh' || effortMatch === 'max')
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

const SPINNER_CHARS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✻✶⏺';
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
const hasActiveInTail = (text: string, n = 8): boolean => {
  const lines = text.split('\n').slice(-n);
  for (const line of lines) {
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

// Internal classifier — same branches as the original detectStatus, but each
// branch returns the `evidence` string alongside the status so the poller
// can log WHY a flip happened. Evidence strings are short (<=40 chars) and
// stable enough to grep server logs by.
const classify = (paneContent: string): Omit<DetectedStatus, 'activity'> => {
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
      for (const pattern of ACTIVE_INDICATORS) {
        if (pattern.test(afterTrimmed)) {
          return { status: 'working', evidence: 'active content after ❯' };
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
    const core = classify(paneContent);
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
