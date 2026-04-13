import * as pty from 'node-pty';

interface TerminalInstance {
  pty: pty.IPty;
  tmuxSession: string;
}

const activePtys = new Map<string, TerminalInstance>();

export const terminalService = {
  attach(terminalId: string, tmuxSessionName: string): pty.IPty {
    // Kill existing pty for this terminal if any
    this.detach(terminalId);

    const shell = process.env.SHELL || '/bin/zsh';
    const ptyProcess = pty.spawn(shell, ['-c', `tmux attach-session -t ${tmuxSessionName}`], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.env.HOME ?? '/tmp',
      env: { ...process.env } as Record<string, string>,
    });

    activePtys.set(terminalId, { pty: ptyProcess, tmuxSession: tmuxSessionName });
    return ptyProcess;
  },

  detach(terminalId: string): void {
    const instance = activePtys.get(terminalId);
    if (instance) {
      try {
        instance.pty.kill();
      } catch {
        // Already dead
      }
      activePtys.delete(terminalId);
    }
  },

  resize(terminalId: string, cols: number, rows: number): void {
    const instance = activePtys.get(terminalId);
    if (instance) {
      try {
        instance.pty.resize(cols, rows);
      } catch {
        // Ignore resize errors
      }
    }
  },

  isActive(terminalId: string): boolean {
    return activePtys.has(terminalId);
  },

  cleanup(): void {
    for (const [id] of activePtys) {
      this.detach(id);
    }
  },
};
