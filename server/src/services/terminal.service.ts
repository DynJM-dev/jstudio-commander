import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';

interface TerminalInstance {
  process: ChildProcess;
  tmuxSession: string;
  pollTimer: ReturnType<typeof setInterval> | null;
  onData: ((data: string) => void) | null;
  onExit: (() => void) | null;
  lastContent: string;
}

const activeTerminals = new Map<string, TerminalInstance>();

// Try to use tmux's pipe-pane for streaming, fall back to capture-pane polling
const tryPipePane = (tmuxSession: string): ChildProcess | null => {
  try {
    // Spawn tmux attach in a subprocess with piped stdio
    const proc = spawn('tmux', ['attach-session', '-t', tmuxSession, '-r'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    });
    return proc;
  } catch {
    return null;
  }
};

export const terminalService = {
  attach(terminalId: string, tmuxSessionName: string): {
    onData: (cb: (data: string) => void) => void;
    onExit: (cb: () => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
  } {
    // Kill existing terminal for this ID
    this.detach(terminalId);

    const instance: TerminalInstance = {
      process: null as unknown as ChildProcess,
      tmuxSession: tmuxSessionName,
      pollTimer: null,
      onData: null,
      onExit: null,
      lastContent: '',
    };

    // Try pipe-pane approach first (read-only attach)
    const proc = tryPipePane(tmuxSessionName);

    if (proc && proc.stdout) {
      instance.process = proc;

      proc.stdout.on('data', (chunk: Buffer) => {
        instance.onData?.(chunk.toString());
      });

      proc.on('exit', () => {
        instance.onExit?.();
        activeTerminals.delete(terminalId);
      });

      proc.on('error', () => {
        // Fall back to polling if pipe fails
        this.startPolling(terminalId, instance);
      });
    } else {
      // Fallback: capture-pane polling with ANSI escape codes
      this.startPolling(terminalId, instance);
    }

    activeTerminals.set(terminalId, instance);

    return {
      onData: (cb) => { instance.onData = cb; },
      onExit: (cb) => { instance.onExit = cb; },
      write: (data) => {
        // Send keys to tmux session
        try {
          // Use send-keys with -l (literal) to handle special chars
          execFileSync('tmux', ['send-keys', '-t', tmuxSessionName, '-l', data]);
        } catch {
          // Session may be gone
        }
      },
      resize: (cols, rows) => {
        try {
          execFileSync('tmux', ['resize-pane', '-t', tmuxSessionName, '-x', String(cols), '-y', String(rows)]);
        } catch {
          // Ignore resize errors
        }
      },
      kill: () => {
        this.detach(terminalId);
      },
    };
  },

  startPolling(terminalId: string, instance: TerminalInstance): void {
    // Poll capture-pane with escape sequences every 500ms
    const poll = () => {
      try {
        const content = execFileSync('tmux', [
          'capture-pane', '-t', instance.tmuxSession, '-p', '-e', '-S', '-'
        ], { encoding: 'utf-8', timeout: 2000 });

        if (content !== instance.lastContent) {
          // Send a full screen redraw: clear + content
          const clear = '\x1b[2J\x1b[H'; // clear screen + cursor home
          instance.onData?.(clear + content);
          instance.lastContent = content;
        }
      } catch {
        // Session may be gone
        instance.onExit?.();
        activeTerminals.delete(terminalId);
      }
    };

    // Initial capture
    poll();
    instance.pollTimer = setInterval(poll, 500);
  },

  detach(terminalId: string): void {
    const instance = activeTerminals.get(terminalId);
    if (instance) {
      if (instance.pollTimer) clearInterval(instance.pollTimer);
      try { instance.process?.kill(); } catch { /* Already dead */ }
      activeTerminals.delete(terminalId);
    }
  },

  resize(terminalId: string, cols: number, rows: number): void {
    const instance = activeTerminals.get(terminalId);
    if (instance) {
      try {
        execFileSync('tmux', ['resize-pane', '-t', instance.tmuxSession, '-x', String(cols), '-y', String(rows)]);
      } catch { /* Ignore */ }
    }
  },

  isActive(terminalId: string): boolean {
    return activeTerminals.has(terminalId);
  },

  cleanup(): void {
    for (const [id] of activeTerminals) {
      this.detach(id);
    }
  },
};
