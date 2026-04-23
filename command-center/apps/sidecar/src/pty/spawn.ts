import { buildPtyEnv } from '@commander/shared';

/**
 * Process-spawn wrapper at the sidecar's PTY layer. Wraps Bun.spawn with
 * streaming stdout + stdin + signal-deliverable kill.
 *
 * **Deviation from ARCHITECTURE_SPEC §6.3** (PHASE_N3_REPORT §4 D1): the
 * spec cites `Bun.spawn({ terminal: {...} })` for PTY semantics. Bun 1.3.13's
 * `terminal` option is accepted but the `data` callback fires once with
 * `undefined` bytes instead of streaming output — the API surface exists
 * but is incomplete in the runtime we ship on. Falling back to a third-party
 * PTY binding (`bun-pty`) or Node's `node-pty` is the escalation-gated path
 * per ARCHITECTURE_SPEC §2.3 + dispatch §4 G8 — we do NOT invoke it for N3.
 *
 * Instead, N3 uses Bun's native `stdout: 'pipe'` + ReadableStream reader.
 * This is still the shipped stack, zero new deps, zero escalation needed.
 * All N3 acceptance criteria (ls -la, sleep, echo) are line-oriented
 * commands that don't need TTY semantics (cursor control, ANSI isatty
 * detection, SIGWINCH, etc.). When N4+ needs real interactive `claude` REPL
 * semantics, we revisit — options open at that point: Bun ships a real
 * terminal-data path, or we drop to bun-pty via escalation-gated deviation.
 *
 * Owns: stdin/stdout/stderr pipe wiring, UTF-8 locale enforcement, signal
 * delivery, exit-promise plumbing, KB-P4.13 prompt-trigger for claude.
 *
 * Does NOT own: WS publishing, scrollback persistence, agent-run FSM writes.
 * Those are T3 (lifecycle) + T4 (stream) concerns that consume the handle.
 */

export interface PtySpawnOpts {
  /** argv of the command. `command[0]` is the executable. */
  command: string[];
  /** Working directory (worktree path from T2). */
  cwd: string;
  /** Extra env. Merged into process.env; UTF-8 locale is ALWAYS enforced. */
  env?: Record<string, string | undefined>;
  /** Called for each stdout byte chunk. Raw Uint8Array; caller owns base64 + decode. */
  onData: (bytes: Uint8Array, stream: 'stdout' | 'stderr') => void;
  /** Called once on child exit. */
  onExit: (args: { exitCode: number | null; signalCode: string | null }) => void;
  /** Test hook for deterministic prompt-trigger timing. Defaults to 100ms. */
  promptTriggerDelayMs?: number;
}

export interface PtyHandle {
  pid: number;
  /** Send a signal to the child. Returns true if delivered. */
  kill: (signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT') => boolean;
  /** Write to child stdin. */
  write: (data: string | Uint8Array) => void;
  /** Promise resolving when child exits. */
  exited: Promise<{ exitCode: number | null; signalCode: string | null }>;
}

export function spawnPty(opts: PtySpawnOpts): PtyHandle {
  const mergedEnv = buildPtyEnv({ ...process.env, ...(opts.env ?? {}) });

  const proc = Bun.spawn(opts.command, {
    cwd: opts.cwd,
    env: mergedEnv,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Stream stdout bytes → caller's onData. Fire-and-forget read loop;
  // completes when the child's stdout EOFs (after exit).
  void streamReader(proc.stdout as ReadableStream<Uint8Array>, (bytes) => {
    try {
      opts.onData(bytes, 'stdout');
    } catch {
      // onData must not crash the sidecar.
    }
  });

  // Stream stderr too — many tools emit progress + prompts on stderr.
  void streamReader(proc.stderr as ReadableStream<Uint8Array>, (bytes) => {
    try {
      opts.onData(bytes, 'stderr');
    } catch {
      // noop
    }
  });

  // KB-P4.13 blank-terminal-until-Enter defense. Claude Code's interactive
  // REPL paints nothing until it receives input; a `\n` after ~100ms
  // dislodges the blank-state. Skip for non-Claude commands.
  const executable = (opts.command[0] ?? '').trim();
  const isClaude = executable === 'claude' || executable.endsWith('/claude');
  if (isClaude) {
    const delay = opts.promptTriggerDelayMs ?? 100;
    setTimeout(() => {
      try {
        const stdin = proc.stdin as unknown as { write: (d: string) => void } | null;
        stdin?.write('\n');
      } catch {
        // Process may have exited; noop.
      }
    }, delay);
  }

  // Wire exit promise → caller's onExit.
  proc.exited.then((exitCode) => {
    const sig = (proc as unknown as { signalCode: string | null }).signalCode ?? null;
    const code = typeof exitCode === 'number' ? exitCode : null;
    try {
      opts.onExit({ exitCode: code, signalCode: sig });
    } catch {
      // noop
    }
  });

  return {
    pid: proc.pid,
    kill: (signal = 'SIGTERM') => {
      try {
        proc.kill(signal);
        return true;
      } catch {
        return false;
      }
    },
    write: (data) => {
      try {
        const stdin = proc.stdin as unknown as {
          write: (d: string | Uint8Array) => void;
        } | null;
        stdin?.write(data);
      } catch {
        // Process exited; noop.
      }
    },
    exited: proc.exited.then((exitCode) => ({
      exitCode: typeof exitCode === 'number' ? exitCode : null,
      signalCode: (proc as unknown as { signalCode: string | null }).signalCode ?? null,
    })),
  };
}

/**
 * Drain a ReadableStream, invoking `onChunk` for each Uint8Array chunk.
 * Silent on errors — if the stream fails the PTY is already dead.
 */
async function streamReader(
  stream: ReadableStream<Uint8Array>,
  onChunk: (bytes: Uint8Array) => void,
): Promise<void> {
  try {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value && value.length > 0) onChunk(value);
    }
  } catch {
    // Stream errors are a downstream symptom of process death; silent.
  }
}
