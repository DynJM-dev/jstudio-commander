// PtyManager — owns the lifecycle of a single node-pty child per
// ARCHITECTURE_SPEC v1.2 §6.3. Spawns zsh -i with a per-runtime ZDOTDIR that
// layers the OSC 133 hook on top of the user's rc. Every byte of pty output
// is forwarded verbatim to the consumer (markers included — xterm.js ignores
// them per §6.3) AND fed to the OSC 133 parser so the consumer also receives
// typed command:started / command:ended events.

import * as nodePty from 'node-pty';
import { Osc133Parser, type Osc133Event } from '../osc133/parser.js';

export interface PtySpawnOptions {
  sessionId: string;
  cwd: string;
  zdotdir: string;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PtyDataCallback {
  (chunk: string): void;
}

export interface PtyOscCallback {
  (event: Osc133Event): void;
}

export interface PtyExitCallback {
  (exitCode: number | null, signal: number | null): void;
}

export interface PtyHandle {
  pid: number;
  sessionId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  isAlive(): boolean;
}

export interface PtyConstructOptions extends PtySpawnOptions {
  onData: PtyDataCallback;
  onOsc133: PtyOscCallback;
  onExit: PtyExitCallback;
}

export function spawnPty(opts: PtyConstructOptions): PtyHandle {
  const {
    sessionId,
    cwd,
    zdotdir,
    cols = 80,
    rows = 24,
    env,
    onData,
    onOsc133,
    onExit,
  } = opts;

  // Inherit the sidecar env, then overlay ZDOTDIR + JSTUDIO_SESSION_ID +
  // JSTUDIO_COMMANDER=1 so child tools can detect they're running inside
  // Commander. Any caller-supplied env entries take precedence last.
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ZDOTDIR: zdotdir,
    JSTUDIO_SESSION_ID: sessionId,
    JSTUDIO_COMMANDER: '1',
    TERM: 'xterm-256color',
    ...env,
  };

  const pty = nodePty.spawn('/bin/zsh', ['-i'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: resolveCwdOrHome(cwd),
    env: mergedEnv as { [key: string]: string },
  });

  const parser = new Osc133Parser();
  let alive = true;

  pty.onData((raw: string) => {
    onData(raw);
    const events = parser.feed(raw);
    for (const ev of events) onOsc133(ev);
  });

  pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    alive = false;
    onExit(exitCode ?? null, signal ?? null);
  });

  return {
    pid: pty.pid,
    sessionId,
    write: (data: string) => {
      if (alive) pty.write(data);
    },
    resize: (nextCols: number, nextRows: number) => {
      if (alive) {
        try {
          pty.resize(nextCols, nextRows);
        } catch {
          // node-pty throws on invalid dimensions; swallow for robustness.
        }
      }
    },
    kill: (signal = 'SIGTERM') => {
      if (alive) {
        try {
          pty.kill(signal);
        } catch {
          // already gone
        }
      }
    },
    isAlive: () => alive,
  };
}

function resolveCwdOrHome(cwd: string): string {
  // Falls back to $HOME for a missing path to avoid node-pty ENOENT crashes.
  // Caller is responsible for surfacing an earlier validation error to the
  // user if a project path is truly invalid.
  const home = process.env.HOME ?? '/';
  if (!cwd) return home;
  if (cwd.startsWith('~')) return cwd.replace(/^~/, home);
  return cwd;
}
