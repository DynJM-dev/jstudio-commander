import type { SessionStatus } from '@commander/shared';
import { tmuxService } from './tmux.service.js';

const SPINNER_CHARS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const WORKING_PATTERNS = [/Agent/i, /Running/i, /\d+%/, /\.{3}$/];
const WAITING_PATTERNS = [/^>\s*$/, /^\$\s*$/, /^❯\s*$/, /waiting for input/i, /\?\s/, /\(y\/n\)/i];
const ERROR_PATTERNS = [/^Error:/m, /^error:/m, /FATAL/i, /panic:/i, /at\s+\S+:\d+:\d+/];
const SHELL_COMMANDS = ['zsh', 'bash', 'sh', 'fish'];

const getLastNonEmptyLine = (text: string): string => {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return lines[lines.length - 1]?.trim() ?? '';
};

export const agentStatusService = {
  detectStatus(tmuxSessionName: string): SessionStatus {
    // Check if tmux session exists
    if (!tmuxService.hasSession(tmuxSessionName)) {
      return 'stopped';
    }

    // Get pane content and current command
    const paneContent = tmuxService.capturePane(tmuxSessionName, 10);
    const paneCommand = tmuxService.getPaneCommand(tmuxSessionName).trim();
    const lastLine = getLastNonEmptyLine(paneContent);

    // Check for errors first
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(paneContent)) {
        return 'error';
      }
    }

    // Check for spinner or working patterns
    if ([...lastLine].some((ch) => SPINNER_CHARS.includes(ch))) {
      return 'working';
    }
    for (const pattern of WORKING_PATTERNS) {
      if (pattern.test(lastLine)) {
        return 'working';
      }
    }

    // If process running is not just a shell, it's likely working
    if (paneCommand && !SHELL_COMMANDS.includes(paneCommand)) {
      return 'working';
    }

    // Check for waiting patterns
    for (const pattern of WAITING_PATTERNS) {
      if (pattern.test(lastLine)) {
        return 'waiting';
      }
    }

    // Default: idle (session exists, shell running, nothing happening)
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
