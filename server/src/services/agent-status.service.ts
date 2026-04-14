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
  /^>\s*$/, /^\$\s*$/,
];
const WAITING_INDICATORS = [
  /waiting for input/i, /\?\s*$/, /\(y\/n\)/i, /\(Y\/n\)/i,
  /Do you want to proceed/i,
  /trust this folder/i,
  /Allow.*Deny/i,
  // NOTE: ⏵⏵ accept edits is a MODE INDICATOR, not a prompt — don't detect as waiting
];
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

    const paneContent = tmuxService.capturePane(tmuxSessionName, 15);
    const lastLine = getLastMeaningfulLine(paneContent);

    // Check for errors first
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(paneContent)) {
        return 'error';
      }
    }

    // Numbered choice prompts (❯ 1. Yes) = waiting for user selection
    if (hasNumberedChoiceInTail(paneContent)) {
      return 'waiting';
    }

    // Check for waiting patterns (interactive prompts) — highest priority
    for (const pattern of WAITING_INDICATORS) {
      if (pattern.test(paneContent)) {
        return 'waiting';
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
