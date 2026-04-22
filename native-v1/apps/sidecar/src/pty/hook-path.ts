// Resolves the on-disk paths for the bundled OSC 133 hook + the generated
// per-runtime ZDOTDIR that zsh -i reads. The hook lives in the repo at
// native-v1/resources/osc133-hook.sh; at bundle time (Task 10) it's copied
// into the sidecar binary's resources. This module abstracts the lookup so
// callers get one path regardless of environment.
//
// Environment overrides (respected in this order):
//   JSTUDIO_OSC133_HOOK_PATH   — absolute path to osc133-hook.sh
//   JSTUDIO_ZDOTDIR            — absolute path to the generated ZDOTDIR
// If neither is set, paths are derived from the running module's URL plus
// the runtime-dir (~/.jstudio-commander-v1/zdotdir).

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { RUNTIME_DIR, ensureRuntimeDir } from '../runtime.js';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

export function resolveHookPath(): string {
  if (process.env.JSTUDIO_OSC133_HOOK_PATH) {
    return resolve(process.env.JSTUDIO_OSC133_HOOK_PATH);
  }
  // Dev layout: src/pty/ → ../../../resources/osc133-hook.sh
  const devPath = resolve(SRC_DIR, '..', '..', '..', '..', 'resources', 'osc133-hook.sh');
  if (existsSync(devPath)) return devPath;
  // Fallback: same directory as the compiled binary (Task 10 bundling).
  const binAdjacent = resolve(SRC_DIR, '..', '..', 'resources', 'osc133-hook.sh');
  return binAdjacent;
}

export function resolveZdotdir(): string {
  if (process.env.JSTUDIO_ZDOTDIR) return resolve(process.env.JSTUDIO_ZDOTDIR);
  return join(RUNTIME_DIR, 'zdotdir');
}

export interface EnsureZdotdirOptions {
  /** When true, generated .zshrc sources user's ~/.zshrc after installing the
   *  OSC 133 hook. Default false — see PHASE_N1_REPORT §4 deviation for
   *  rationale. N2 exposes this via preferences.zsh.source_user_rc. */
  sourceUserRc?: boolean;
}

/**
 * Ensures ~/.jstudio-commander-v1/zdotdir/.zshrc exists and sources the OSC
 * 133 hook. When `sourceUserRc=true`, the hook-sourced .zshrc also sources
 * the user's ~/.zshrc inline. Idempotent — rewrites only if content changed.
 */
export function ensureZdotdir(opts: EnsureZdotdirOptions = {}): { zdotdir: string; hookPath: string } {
  ensureRuntimeDir();
  const zdotdir = resolveZdotdir();
  const hookPath = resolveHookPath();
  if (!existsSync(zdotdir)) {
    mkdirSync(zdotdir, { recursive: true, mode: 0o755 });
  }
  const zshrcPath = join(zdotdir, '.zshrc');
  const contents = buildZshrc(hookPath, opts.sourceUserRc ?? false);
  let needsWrite = true;
  if (existsSync(zshrcPath)) {
    try {
      if (readFileSync(zshrcPath, 'utf8') === contents) needsWrite = false;
    } catch {
      // fall through and rewrite
    }
  }
  if (needsWrite) writeFileSync(zshrcPath, contents, { mode: 0o644 });
  return { zdotdir, hookPath };
}

function buildZshrc(hookPath: string, sourceUserRc: boolean): string {
  // Default (sourceUserRc=false): N1's minimal, deterministic .zshrc. Hook
  // only. User aliases / prompt / PATH from ~/.zshrc NOT loaded — this trades
  // shell-customization continuity for guaranteed OSC 133 emission with zero
  // latency / zero risk of fatal errors in user rc killing the session before
  // hooks install.
  //
  // Opt-in (sourceUserRc=true): after hook install, inline-source user's
  // ~/.zshrc. Aliases / prompt / PATH apply in the session. Cost: if user rc
  // is slow (oh-my-zsh, P10K) the first OSC 133 A marker is delayed; if it's
  // fatally broken, the shell dies mid-init. Sidecar's bootstrap launcher
  // holds a 15s ready-timeout that surfaces this via system:error. Per
  // N1_ACCEPTANCE_MEMO §5 Q2 ratification: acceptable for opt-in behavior.
  const lines = [
    '# JStudio Commander v1 — generated per-runtime .zshrc',
    '# Regenerated at sidecar startup based on preferences.zsh.source_user_rc.',
    '# Do not edit by hand — changes overwritten on next sidecar start.',
    '',
    `source ${shellQuote(hookPath)}`,
  ];
  if (sourceUserRc) {
    lines.push(
      '',
      '# preferences.zsh.source_user_rc=true — inline-source user rc.',
      '# Fatal errors in ~/.zshrc will leave the session in an inconsistent',
      '# state; this is the inherent cost of loading arbitrary user code.',
      '# Set the preference back to false if sessions misbehave.',
      'if [ -f "$HOME/.zshrc" ]; then',
      '  source "$HOME/.zshrc" 2>/dev/null || true',
      'fi',
    );
  }
  lines.push('');
  return lines.join('\n');
}

function shellQuote(s: string): string {
  // Single-quote the path and escape any embedded single quotes.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
