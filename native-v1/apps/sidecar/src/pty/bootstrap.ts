// Bootstrap injection at the correct moment per ARCHITECTURE_SPEC v1.2 §6.6
// + dispatch §3 Task 9.
//
// Flow (single session):
//   1. pty spawned (cold) or claimed (warm); first post-spawn zsh prompt
//      signals readiness via OSC 133 A marker.
//   2. Orchestrator plans the bootstrap (planBootstrap) — reads the seeded
//      bootstrapPath for the session type, verifies the file exists, loads
//      its contents. A missing file for PM/Coder is a fatal session spawn
//      error (per dispatch: "no silent fallback to Raw").
//   3. Orchestrator writes `<clientBinary>\n` (typically `claude\n`) to the
//      pty.
//   4. Quiet-period watcher starts — after ≥1 byte of output AND ≥ QUIET_MS
//      since the last byte, Claude is considered ready for input.
//   5. Bootstrap content is written to pty.stdin + trailing newline (only for
//      plans of kind 'inject'). Raw sessions skip this step silently.
//
// "Quiet period" rationale per OS §24.1 pattern-matching discipline:
// we deliberately do NOT shape-match Claude's boot banner — that would
// invite the exact class of bug L7 warns against (upstream glyph/text
// drift between Claude Code versions). Activity-gap is a structural
// signal, orthogonal to content shape.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PtyHandle } from './manager.js';
import type { Osc133Event } from '../osc133/parser.js';

// N2.1.6 Bug D: replaced the N2.1.4 / N2.1.5 quiet-period heuristic for
// "Claude ready to accept paste" with a deterministic signal — counting
// OSC title emissions. See diagnostics/N2.1.6-bug-d-deterministic-signal-
// evidence.md. quietMs retained in LaunchOptions for backward compat but
// unused in the new path.
export const DEFAULT_QUIET_MS = 800;
// N2.1.6: the readyTimeoutMs is no longer a "fail if no output" guard —
// it's a "signal not observed, attempt anyway with warning" fallback.
// Bumped from 15s to 30s per dispatch §2 Task 1 fix section.
export const DEFAULT_READY_TIMEOUT_MS = 30_000;
// N2.1.6 Bug D signal: wait until at least this many OSC title emissions
// are observed from the client binary. First emission = TUI launched
// (banner title); 2nd emission = spinner animating = ready for paste.
export const DEFAULT_READY_OSC_COUNT = 2;
// Post-write paste-quiesce window. N2.1.5 discovery: after writing the
// bracketed-paste content, wait for Claude's TUI to stop rendering before
// committing with \r.
export const DEFAULT_SUBMIT_DELAY_MS = 300;
export const DEFAULT_SUBMIT_MAX_WAIT_MS = 3_000;
// Match any OSC title update: ESC ] {0,1,2} ; ... terminator (BEL or ST).
// Used to count emissions as the Claude-ready signal. Content-agnostic:
// any title-setting escape sequence counts, regardless of the text
// payload (OS §24.1 — structural signal, not content pattern-match).
const OSC_TITLE_RE = /\x1b\][012];[^\x07\x1b]*(?:\x07|\x1b\\)/g;

export interface BootstrapInject {
  kind: 'inject';
  path: string;
  content: string;
}

export interface BootstrapSkip {
  kind: 'skip';
}

export interface BootstrapError {
  kind: 'error';
  message: string;
}

export type BootstrapPlan = BootstrapInject | BootstrapSkip | BootstrapError;

export interface PlanInput {
  sessionTypeId: string;
  bootstrapPath: string | null;
}

/**
 * Resolves the bootstrap file for a session type. Expands `~` to HOME.
 * Returns 'skip' for raw (bootstrapPath=null), 'inject' for PM/Coder with a
 * readable file, or 'error' if a PM/Coder session has a missing file.
 */
export function planBootstrap(input: PlanInput): BootstrapPlan {
  if (input.bootstrapPath === null) return { kind: 'skip' };
  const absolute = expandHome(input.bootstrapPath);
  if (!existsSync(absolute)) {
    return {
      kind: 'error',
      message: `Bootstrap file not found at ${absolute} for session type "${input.sessionTypeId}". Session spawn aborted — no silent fallback.`,
    };
  }
  try {
    const content = readFileSync(absolute, 'utf8');
    return { kind: 'inject', path: absolute, content };
  } catch (err) {
    return {
      kind: 'error',
      message: `Bootstrap file at ${absolute} could not be read: ${(err as Error).message}`,
    };
  }
}

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export interface LaunchOptions {
  clientBinary: string; // 'claude' or future multi-AI equivalents
  plan: BootstrapPlan;
  handle: PtyHandle;
  /** Legacy N2.1.5 quiet-period field — retained for API compat; unused by
   *  the N2.1.6 OSC-title-count ready detection. Tests may pass it as noop. */
  quietMs?: number;
  /** Hard timeout (ms) for the Claude-ready signal. If OSC title count
   *  doesn't reach `readyOscCount` before this window, emit a warning and
   *  attempt the bootstrap write anyway (prefer attempt-and-fail over
   *  blocking). Default 30 000 ms. */
  readyTimeoutMs?: number;
  /** Number of OSC title emissions required to consider Claude's TUI
   *  ready for paste. Default 2 — first is the launch banner, second is
   *  the Ink Spinner's first animated frame. */
  readyOscCount?: number;
  /** Chunk-gap (ms) after the paste write: if no new pty output arrives
   *  within this window, commit via `\r`. Reset on every new chunk. Tests
   *  override to small values. Default 300 ms. */
  submitDelayMs?: number;
  /** Hard deadline (ms) after the paste write. Even if pty output keeps
   *  streaming, we commit once this deadline passes. Default 3000 ms. */
  submitMaxWaitMs?: number;
  onError?: (err: Error) => void;
  /** Non-fatal signal: Claude-ready wasn't observed in time; attempted
   *  bootstrap write anyway. Orchestrator routes this to a
   *  `system:warning` WS event for Jose to see in the session. */
  onWarning?: (message: string) => void;
  onInjected?: () => void;
}

/**
 * State machine per launched session. Call `onA()` from the orchestrator's
 * OSC 133 dispatch when a prompt-started marker fires. Call `onData()` from
 * the pty data stream. The launcher handles:
 *   - writing `<clientBinary>\n` on the first post-spawn A marker
 *   - scheduling quiet-period bootstrap injection after Claude boots
 *   - bailing out if Claude never produces output within readyTimeoutMs
 */
export class BootstrapLauncher {
  private state:
    | 'wait-for-zsh-prompt'
    | 'wait-for-claude-ready'
    | 'wait-for-paste-quiet'
    | 'done'
    | 'errored' = 'wait-for-zsh-prompt';
  private readyTimer: NodeJS.Timeout | null = null;
  private submitTimer: NodeJS.Timeout | null = null;
  private submitDeadline = 0;
  private oscTitleCount = 0;
  private readonly readyTimeoutMs: number;
  private readonly readyOscCount: number;
  private readonly submitDelayMs: number;
  private readonly submitMaxWaitMs: number;

  constructor(private readonly opts: LaunchOptions) {
    // `quietMs` accepted for back-compat but unused in the N2.1.6 path.
    void opts.quietMs;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.readyOscCount = opts.readyOscCount ?? DEFAULT_READY_OSC_COUNT;
    this.submitDelayMs = opts.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS;
    this.submitMaxWaitMs = opts.submitMaxWaitMs ?? DEFAULT_SUBMIT_MAX_WAIT_MS;
  }

  /** Invoked by orchestrator on every OSC 133 event observed on this pty.
   *  Only the outer-zsh A marker (fires BEFORE claude execs) is relevant —
   *  Claude's inner TUI does not source the OSC 133 hook, so no markers
   *  fire during its lifetime (PM verified in N2.1.6 dispatch §0.1). */
  onOsc133(event: Osc133Event): void {
    if (this.state !== 'wait-for-zsh-prompt') return;
    if (event.marker !== 'A') return;
    // zsh is at a prompt — safe to exec the client binary.
    if (this.opts.plan.kind === 'error') {
      this.fail(new Error(this.opts.plan.message));
      return;
    }
    this.opts.handle.write(`${this.opts.clientBinary}\n`);
    this.state = 'wait-for-claude-ready';
    this.armReadyTimeout();
  }

  /** Invoked on every pty output chunk while the launcher is active. */
  onData(chunk: string): void {
    if (this.state === 'wait-for-claude-ready') {
      // N2.1.6 Bug D: count OSC title emissions from the client binary as
      // the deterministic "TUI ready for paste" signal. Ink-based TUIs
      // (Claude Code, Gemini CLI, others) update terminal title
      // repeatedly during boot + via Spinner animation frames. First
      // emission = launch banner title; readyOscCount-th emission = TUI
      // render loop active = paste handler installed.
      //
      // Structural signal — counts title-setting escape frames, not text
      // content. Immune to upstream banner/spinner string renames per OS
      // §24.1 pattern-matching discipline.
      const matches = chunk.match(OSC_TITLE_RE);
      if (matches) this.oscTitleCount += matches.length;
      if (this.oscTitleCount >= this.readyOscCount) {
        this.proceedToInject();
      }
      return;
    }
    if (this.state === 'wait-for-paste-quiet') {
      // Claude's TUI is actively rendering the paste we just wrote. Push
      // the submit-timer out — commit fires only when output stays quiet
      // for submitDelayMs. Hard deadline guards against TUIs that never
      // go quiet (rare, but see N2.1.5 Bug D evidence cold-3 case).
      const now = Date.now();
      if (now >= this.submitDeadline) {
        this.commit();
        return;
      }
      if (this.submitTimer) clearTimeout(this.submitTimer);
      const remaining = this.submitDeadline - now;
      const wait = Math.min(this.submitDelayMs, remaining);
      this.submitTimer = setTimeout(() => this.commit(), wait);
    }
  }

  cancel(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.submitTimer) clearTimeout(this.submitTimer);
    this.state = 'done';
  }

  private armReadyTimeout(): void {
    this.readyTimer = setTimeout(() => {
      if (this.state !== 'wait-for-claude-ready') return;
      // N2.1.6: didn't observe readyOscCount title updates in time.
      // Previous semantics (fail-if-no-output) replaced with warn-and-
      // proceed: prefer attempting the bootstrap write over blocking.
      // If Claude is slow but responsive, bootstrap still commits when
      // Claude processes it.
      this.opts.onWarning?.(
        `Claude TUI ready signal (${this.readyOscCount} OSC title updates) not observed ` +
          `in ${this.readyTimeoutMs}ms (saw ${this.oscTitleCount}); attempting bootstrap write anyway.`,
      );
      this.proceedToInject();
    }, this.readyTimeoutMs);
  }

  private proceedToInject(): void {
    if (this.state !== 'wait-for-claude-ready') return;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    if (this.opts.plan.kind === 'inject') {
      // N2.1.4 Bug D: Claude Code's Ink TUI treats multi-line pty input as
      // a paste buffer — \n lands inside, only \r commits.
      // N2.1.5 Bug D: bracketed-paste markers (\x1b[200~…\x1b[201~) tell
      //   Claude explicitly "this is a paste" regardless of chunk-size
      //   heuristics. The terminator unambiguously marks paste end so the
      //   following \r is a submit.
      // N2.1.6 Bug D: no more time-based "Claude ready" detection — this
      //   function runs only after readyOscCount title updates (or
      //   readyTimeoutMs fallback). See diagnostics/N2.1.6-bug-d-
      //   deterministic-signal-evidence.md.
      this.opts.handle.write('\x1b[200~');
      this.opts.handle.write(this.opts.plan.content);
      if (!this.opts.plan.content.endsWith('\n')) this.opts.handle.write('\n');
      this.opts.handle.write('\x1b[201~');
      this.state = 'wait-for-paste-quiet';
      this.submitDeadline = Date.now() + this.submitMaxWaitMs;
      if (this.submitTimer) clearTimeout(this.submitTimer);
      this.submitTimer = setTimeout(() => this.commit(), this.submitDelayMs);
      return;
    }
    // `skip` plan: launch-only, no bootstrap write needed.
    this.state = 'done';
  }

  private commit(): void {
    if (this.state !== 'wait-for-paste-quiet') return;
    if (this.submitTimer) {
      clearTimeout(this.submitTimer);
      this.submitTimer = null;
    }
    this.opts.handle.write('\r');
    this.state = 'done';
    this.opts.onInjected?.();
  }

  private fail(err: Error): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.submitTimer) clearTimeout(this.submitTimer);
    this.state = 'errored';
    this.opts.onError?.(err);
  }
}
