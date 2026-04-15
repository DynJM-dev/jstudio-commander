import type { SessionStatus } from '@commander/shared';
import { tmuxService } from './tmux.service.js';

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

export const agentStatusService = {
  detectStatus(tmuxSessionName: string): SessionStatus {
    if (!tmuxService.hasSession(tmuxSessionName)) {
      return 'stopped';
    }

    // 25 lines (up from 15). The old window missed waiting prompts when
    // Claude printed a long tool-output tail before the prompt — the
    // permission UI scrolled out before detection could run.
    const paneContent = tmuxService.capturePane(tmuxSessionName, 25);
    const lastLine = getLastMeaningfulLine(paneContent);

    // Check for errors first
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(paneContent)) {
        return 'error';
      }
    }

    // Numbered choice prompts (❯ 1. Yes) = waiting for user selection.
    // Two variants: with the ❯ marker, or a block of consecutive numbered
    // lines (Claude sometimes redraws the UI so the marker lands on a
    // different line than the choices). Strongest waiting signal — runs
    // ahead of the idle-footer short-circuit so a real numbered prompt
    // sitting next to the idle-ish chrome still classifies as waiting.
    if (hasNumberedChoiceInTail(paneContent) || hasNumberedChoiceBlock(paneContent)) {
      return 'waiting';
    }

    // Idle-footer short-circuit (#236). When Claude renders its idle
    // chrome ('⏵⏵ accept edits on', '? for shortcuts', 'new task?')
    // below the ❯ cursor, the other WAITING_INDICATORS can over-match
    // on chrome text. If a known idle-footer marker is present we
    // skip the broad regex loop and fall through to the idle-prompt
    // detection below.
    if (!hasIdleFooter(paneContent)) {
      for (const pattern of WAITING_INDICATORS) {
        if (pattern.test(paneContent)) {
          return 'waiting';
        }
      }
    }

    // Check if the idle prompt (❯) is visible — means Claude is idle
    if (hasIdlePromptInTail(paneContent)) {
      // But check if Claude is actively thinking/working AFTER the prompt
      // (e.g., user typed something and Claude is now processing)
      const afterPrompt = paneContent.split(/❯[^\n]*\n/).pop() ?? '';
      const afterTrimmed = afterPrompt.trim();

      // If there's active content after the prompt, check if it's working
      if (afterTrimmed.length > 0 && !DECORATOR_RE.test(afterTrimmed)) {
        // Check for active indicators after the prompt
        for (const pattern of ACTIVE_INDICATORS) {
          if (pattern.test(afterTrimmed)) {
            return 'working';
          }
        }
      }

      // Prompt visible, nothing active after it
      return 'idle';
    }

    // Check for idle indicators on the last meaningful line
    for (const pattern of IDLE_INDICATORS) {
      if (pattern.test(lastLine)) {
        return 'idle';
      }
    }

    // Check for active work indicators
    if ([...lastLine].some((ch) => SPINNER_CHARS.includes(ch))) {
      return 'working';
    }
    for (const pattern of ACTIVE_INDICATORS) {
      if (pattern.test(lastLine)) {
        return 'working';
      }
    }

    // If we can't determine, check the process — but Claude Code itself isn't always "working"
    const paneCommand = tmuxService.getPaneCommand(tmuxSessionName).trim();
    const shellCommands = ['zsh', 'bash', 'sh', 'fish'];
    if (paneCommand && !shellCommands.includes(paneCommand)) {
      // Process is running but we couldn't detect specific state — default to idle
      // (Claude Code is always running in the pane, doesn't mean it's actively working)
      return 'idle';
    }

    return 'idle';
  },

  detectStatusBatch(tmuxSessionNames: string[]): Record<string, SessionStatus> {
    const results: Record<string, SessionStatus> = {};
    for (const name of tmuxSessionNames) {
      results[name] = this.detectStatus(name);
    }
    return results;
  },
};
