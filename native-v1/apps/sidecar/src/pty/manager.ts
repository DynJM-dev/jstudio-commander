// PtyManager — owns the lifecycle of a single node-pty child per
// ARCHITECTURE_SPEC v1.2 §6.3. Spawns zsh -i with a per-runtime ZDOTDIR that
// layers the OSC 133 hook on top of a minimal shell init. Every byte of pty
// output is forwarded verbatim to the current onData consumer (markers
// included — xterm.js ignores them per §6.3) AND fed to the OSC 133 parser so
// the consumer also receives typed Osc133 events.
//
// Callbacks are mutable: `rebind()` swaps them at runtime without respawning
// the process. This is load-bearing for the pre-warm pool (Task 7) — a pool
// entry starts with internal "wait for first A marker" callbacks, then gets
// rebound to the real session callbacks when claimed.

import * as nodePty from 'node-pty';
import { Osc133Parser, type Osc133Event } from '../osc133/parser.js';

export interface PtyDataCallback {
  (chunk: string): void;
}

export interface PtyOscCallback {
  (event: Osc133Event): void;
}

export interface PtyExitCallback {
  (exitCode: number | null, signal: number | null): void;
}

export interface MutableCallbacks {
  onData: PtyDataCallback;
  onOsc133: PtyOscCallback;
  onExit: PtyExitCallback;
}

export interface PtySpawnOptions {
  sessionId: string;
  cwd: string;
  zdotdir: string;
  cols?: number;
  rows?: number;
  env?: NodeJS.ProcessEnv;
}

export interface PtyConstructOptions extends PtySpawnOptions, MutableCallbacks {}

export interface PtyHandle {
  readonly pid: number;
  sessionId: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  isAlive(): boolean;
  rebind(cb: Partial<MutableCallbacks>): void;
  setSessionId(id: string): void;
}

const NOOP_DATA: PtyDataCallback = () => undefined;
const NOOP_OSC: PtyOscCallback = () => undefined;
const NOOP_EXIT: PtyExitCallback = () => undefined;

export function spawnPty(opts: PtyConstructOptions): PtyHandle {
  const {
    sessionId,
    cwd,
    zdotdir,
    cols = 80,
    rows = 24,
    env,
  } = opts;

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
  let currentSessionId = sessionId;

  const callbacks: MutableCallbacks = {
    onData: opts.onData,
    onOsc133: opts.onOsc133,
    onExit: opts.onExit,
  };

  pty.onData((raw: string) => {
    callbacks.onData(raw);
    const events = parser.feed(raw);
    for (const ev of events) callbacks.onOsc133(ev);
  });

  pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    alive = false;
    callbacks.onExit(exitCode ?? null, signal ?? null);
  });

  return {
    pid: pty.pid,
    get sessionId() {
      return currentSessionId;
    },
    set sessionId(v: string) {
      currentSessionId = v;
    },
    write: (data: string) => {
      if (alive) pty.write(data);
    },
    resize: (nextCols: number, nextRows: number) => {
      if (alive) {
        try {
          pty.resize(nextCols, nextRows);
        } catch {
          /* swallow invalid dimension */
        }
      }
    },
    kill: (signal = 'SIGTERM') => {
      if (alive) {
        try {
          pty.kill(signal);
        } catch {
          /* already gone */
        }
      }
    },
    isAlive: () => alive,
    rebind: (cb) => {
      callbacks.onData = cb.onData ?? NOOP_DATA;
      callbacks.onOsc133 = cb.onOsc133 ?? NOOP_OSC;
      callbacks.onExit = cb.onExit ?? NOOP_EXIT;
    },
    setSessionId: (id: string) => {
      currentSessionId = id;
    },
  };
}

function resolveCwdOrHome(cwd: string): string {
  const home = process.env.HOME ?? '/';
  if (!cwd) return home;
  if (cwd.startsWith('~')) return cwd.replace(/^~/, home);
  return cwd;
}

export { NOOP_DATA, NOOP_OSC, NOOP_EXIT };
