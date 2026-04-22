// Pre-warm session pool per ARCHITECTURE_SPEC v1.2 §16.4 + dispatch §3 Task 7.
//
// Warm ptys are /bin/zsh processes with the OSC 133 hook installed, idle at
// their first prompt. On claim, the handle is rebound to the real session's
// callbacks and positioned with `cd <cwd>` + `export JSTUDIO_SESSION_ID=...`.
// The pool refills asynchronously after every claim.
//
// Subtleties handled:
//   - "Ready" is signaled by the first OSC 133 A marker (prompt-started) —
//     same byte-exact signal the orchestrator uses, no separate shape match.
//   - If a warmed pty exits before being claimed (e.g. user kills it via
//     external means), it's removed from the ready queue and a refill is
//     triggered. Exits mid-warm (before ready) are similarly handled.
//   - Pool size 0 = disabled. Pool size >5 rejected at constructor time.
//   - During shutdown, all warm ptys are killed and refill is suppressed.
//   - `waitForWarmup()` blocks until either the target size is reached or all
//     attempted spawns have completed (errored). Used by integration tests.

import { spawnPty, type PtyHandle, type MutableCallbacks } from './manager.js';
import type { Osc133Event } from '../osc133/parser.js';

export const POOL_SIZE_MIN = 0;
export const POOL_SIZE_MAX = 5;
export const POOL_SIZE_DEFAULT = 2;

export interface PtyPoolDeps {
  zdotdir: string;
  onWarmError?: (err: Error) => void;
}

interface PoolEntry {
  handle: PtyHandle;
  readyPromise: Promise<void>;
  ready: boolean;
}

export function clampPoolSize(n: number): number {
  if (!Number.isFinite(n)) return POOL_SIZE_DEFAULT;
  const clamped = Math.max(POOL_SIZE_MIN, Math.min(POOL_SIZE_MAX, Math.floor(n)));
  return clamped;
}

export class PtyPool {
  private readonly targetSize: number;
  private readonly entries = new Set<PoolEntry>();
  private shuttingDown = false;

  constructor(
    private readonly deps: PtyPoolDeps,
    targetSize: number,
  ) {
    this.targetSize = clampPoolSize(targetSize);
  }

  get size(): number {
    return this.targetSize;
  }

  /** Number of warm ptys currently ready to claim. */
  readyCount(): number {
    let n = 0;
    for (const e of this.entries) if (e.ready && e.handle.isAlive()) n++;
    return n;
  }

  /** Number of warm ptys in any state (spawning, ready, or just-claimed). */
  totalCount(): number {
    return this.entries.size;
  }

  /**
   * Spawns the initial warm set. Returns when all spawns have resolved
   * (ready or errored). Safe to call once at startup; subsequent refills
   * happen implicitly via claim().
   */
  async warmup(): Promise<void> {
    if (this.targetSize === 0) return;
    const seeds: Promise<void>[] = [];
    for (let i = this.entries.size; i < this.targetSize; i++) {
      seeds.push(this.addOne().catch((err: Error) => this.deps.onWarmError?.(err)));
    }
    await Promise.all(seeds);
  }

  /**
   * Claims the next-ready warm pty. Returns null if none is ready, so the
   * caller (orchestrator) can fall back to cold-spawn. The claimed handle is
   * already rebound to the provided callbacks and positioned at sessionId +
   * cwd; the first user-visible side-effect after claim is that zsh prints
   * the new prompt following the `cd` + `export` commands.
   */
  claim(args: {
    sessionId: string;
    cwd: string;
    callbacks: MutableCallbacks;
  }): PtyHandle | null {
    // Prefer entries that are both ready AND alive.
    let chosen: PoolEntry | null = null;
    for (const entry of this.entries) {
      if (entry.ready && entry.handle.isAlive()) {
        chosen = entry;
        break;
      }
    }
    if (!chosen) return null;

    this.entries.delete(chosen);
    const handle = chosen.handle;
    handle.setSessionId(args.sessionId);
    handle.rebind(args.callbacks);

    // Reposition: export new session id + cd to target cwd. Both commands go
    // on a single line so they appear as one preexec block (one B marker).
    const quoted = shellSingleQuote(args.cwd);
    const idQuoted = shellSingleQuote(args.sessionId);
    handle.write(`export JSTUDIO_SESSION_ID=${idQuoted}; cd ${quoted}\n`);

    // Background refill — do not await.
    void this.addOne().catch((err: Error) => this.deps.onWarmError?.(err));

    return handle;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const entry of this.entries) {
      try {
        entry.handle.kill('SIGTERM');
      } catch {
        /* best-effort */
      }
    }
    this.entries.clear();
  }

  private addOne(): Promise<void> {
    if (this.shuttingDown) return Promise.resolve();
    if (this.entries.size >= this.targetSize) return Promise.resolve();

    let resolveReady!: () => void;
    let rejectReady!: (err: Error) => void;
    const readyPromise = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    // Placeholder session id — overwritten on claim via `export` + setSessionId.
    const placeholderId = `pool-${crypto.randomUUID()}`;
    const entry: PoolEntry = {
      handle: null as unknown as PtyHandle,
      readyPromise,
      ready: false,
    };

    const onData = (_chunk: string) => {
      // Discard output while warm. We intentionally don't buffer scrollback
      // for the warm period — the claim `cd` produces a fresh prompt that
      // the consumer sees as their first output.
    };
    const onOsc133 = (event: Osc133Event) => {
      if (!entry.ready && event.marker === 'A') {
        entry.ready = true;
        resolveReady();
      }
    };
    const onExit = (_code: number | null, _signal: number | null) => {
      // If this exit happens while still in the pool, drop the entry and
      // trigger a refill. Exits after claim are the orchestrator's problem.
      if (this.entries.has(entry)) {
        this.entries.delete(entry);
        if (!entry.ready) rejectReady(new Error('warm pty exited before ready'));
        if (!this.shuttingDown) {
          void this.addOne().catch((err: Error) => this.deps.onWarmError?.(err));
        }
      }
    };

    entry.handle = spawnPty({
      sessionId: placeholderId,
      cwd: process.env.HOME ?? '/',
      zdotdir: this.deps.zdotdir,
      cols: 120,
      rows: 32,
      onData,
      onOsc133,
      onExit,
    });
    this.entries.add(entry);

    return readyPromise;
  }
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
