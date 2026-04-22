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

export const DEFAULT_QUIET_MS = 800;
export const DEFAULT_READY_TIMEOUT_MS = 15_000;
// N2.1.4 Bug D fix: delay between writing bootstrap content and the submit
// byte (\r) so Claude Code's TUI fully registers the content as a paste
// buffer before we commit it. 200ms is ample; probe at
// docs/diagnostics/N2.1.4-bootstrap-autosend-evidence.md verified that a
// single \r with any gap after the content write (observed with 10s gap)
// cleanly commits the paste.
export const DEFAULT_SUBMIT_DELAY_MS = 200;

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
  quietMs?: number;
  readyTimeoutMs?: number;
  /** Milliseconds to wait between the content write and the submit `\r` byte.
   *  See DEFAULT_SUBMIT_DELAY_MS for rationale. Tests override to small values. */
  submitDelayMs?: number;
  onError?: (err: Error) => void;
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
  private state: 'wait-for-zsh-prompt' | 'wait-for-claude-ready' | 'done' | 'errored' =
    'wait-for-zsh-prompt';
  private quietTimer: NodeJS.Timeout | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private submitTimer: NodeJS.Timeout | null = null;
  private sawClaudeOutput = false;
  private readonly quietMs: number;
  private readonly readyTimeoutMs: number;
  private readonly submitDelayMs: number;

  constructor(private readonly opts: LaunchOptions) {
    this.quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
    this.readyTimeoutMs = opts.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    this.submitDelayMs = opts.submitDelayMs ?? DEFAULT_SUBMIT_DELAY_MS;
  }

  /** Invoked by orchestrator on every OSC 133 event observed on this pty. */
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
  onData(_chunk: string): void {
    if (this.state !== 'wait-for-claude-ready') return;
    this.sawClaudeOutput = true;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = setTimeout(() => this.onQuiet(), this.quietMs);
  }

  cancel(): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.submitTimer) clearTimeout(this.submitTimer);
    this.state = 'done';
  }

  private armReadyTimeout(): void {
    this.readyTimer = setTimeout(() => {
      if (this.state !== 'wait-for-claude-ready' || this.sawClaudeOutput) return;
      this.fail(
        new Error(
          `Client binary "${this.opts.clientBinary}" produced no output within ${this.readyTimeoutMs}ms`,
        ),
      );
    }, this.readyTimeoutMs);
  }

  private onQuiet(): void {
    if (this.state !== 'wait-for-claude-ready') return;
    if (this.opts.plan.kind === 'inject') {
      // Write content + trailing newline (hygiene — some bootstrap files
      // omit a final \n). Claude Code's Ink-based TUI treats this
      // multi-line blob as a paste buffer, NOT as a typed message: the
      // content renders as `[Pasted text #N +M lines]` placeholders but
      // stays in Claude's input line until the user presses Enter. See
      // docs/diagnostics/N2.1.4-bootstrap-autosend-evidence.md.
      //
      // Schedule a \r (Enter-key) after submitDelayMs to COMMIT the paste
      // as a fresh user message. The short delay lets Claude's TUI fully
      // register the paste before we submit; skipping the delay works in
      // probes but races in slower environments.
      this.opts.handle.write(this.opts.plan.content);
      if (!this.opts.plan.content.endsWith('\n')) this.opts.handle.write('\n');
      this.submitTimer = setTimeout(() => {
        this.submitTimer = null;
        this.opts.handle.write('\r');
        this.opts.onInjected?.();
      }, this.submitDelayMs);
    }
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.state = 'done';
  }

  private fail(err: Error): void {
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.state = 'errored';
    this.opts.onError?.(err);
  }
}
