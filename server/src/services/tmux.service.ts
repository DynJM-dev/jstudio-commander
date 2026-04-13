import { execFileSync } from 'node:child_process';

export interface TmuxSessionInfo {
  name: string;
  createdAt: number;
  attached: boolean;
  lastActivity: number;
}

const exec = (args: string[]): string => {
  try {
    return execFileSync('tmux', args, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
  } catch (err: unknown) {
    const error = err as { status?: number; stderr?: string; message?: string };
    // tmux returns exit code 1 when server not running or session not found
    if (error.stderr?.includes('no server running') ||
        error.stderr?.includes('no current client') ||
        error.stderr?.includes('session not found')) {
      return '';
    }
    throw new Error(`tmux command failed: ${error.message ?? 'unknown error'}`);
  }
};

export const tmuxService = {
  listSessions(): TmuxSessionInfo[] {
    const output = exec([
      'list-sessions',
      '-F',
      '#{session_name}|#{session_created}|#{session_attached}|#{session_activity}',
    ]);
    if (!output) return [];

    return output.split('\n').filter(Boolean).map((line) => {
      const [name, created, attached, activity] = line.split('|');
      return {
        name: name!,
        createdAt: parseInt(created!, 10),
        attached: attached === '1',
        lastActivity: parseInt(activity!, 10),
      };
    });
  },

  createSession(name: string, cwd?: string): string {
    const args = ['new-session', '-d', '-s', name];
    if (cwd) {
      args.push('-c', cwd);
    }
    exec(args);
    return name;
  },

  killSession(name: string): void {
    exec(['kill-session', '-t', name]);
  },

  sendKeys(name: string, keys: string): void {
    // Use send-keys with literal text + Enter as separate args to avoid injection
    exec(['send-keys', '-t', name, keys, 'Enter']);
  },

  capturePane(name: string, lines = 50): string {
    return exec(['capture-pane', '-t', name, '-p', '-S', `-${lines}`]);
  },

  hasSession(name: string): boolean {
    try {
      const output = exec(['has-session', '-t', name]);
      // has-session returns empty on success, throws on failure
      return true;
    } catch {
      return false;
    }
  },

  sessionExists(name: string): boolean {
    return this.hasSession(name);
  },

  getPaneCommand(name: string): string {
    return exec(['list-panes', '-t', name, '-F', '#{pane_current_command}']);
  },
};
