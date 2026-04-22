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

/**
 * Ensures ~/.jstudio-commander-v1/zdotdir/.zshrc exists and sources:
 *   1. User's real ~/.zshrc (if present)
 *   2. The bundled OSC 133 hook
 * Idempotent — rewrites only if the hook path changed since last write.
 */
export function ensureZdotdir(): { zdotdir: string; hookPath: string } {
  ensureRuntimeDir();
  const zdotdir = resolveZdotdir();
  const hookPath = resolveHookPath();
  if (!existsSync(zdotdir)) {
    mkdirSync(zdotdir, { recursive: true, mode: 0o755 });
  }
  const zshrcPath = join(zdotdir, '.zshrc');
  const contents = buildZshrc(hookPath);
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

function buildZshrc(hookPath: string): string {
  // N1 deviation from dispatch §6.6: this generated .zshrc does NOT source
  // user's ~/.zshrc. Reason observed during Task 6 bringup: a typical
  // oh-my-zsh / P10K user rc adds 4-5s init latency before the first prompt
  // is painted, and any fatal error in user rc can kill the session before
  // OSC 133 hooks install. For N1 we want deterministic OSC 133 emission on
  // every spawn; user shell compat (aliases, PATH, prompt) is tracked as tech
  // debt for N2 where we can add an opt-in `preferences.zsh.source_user_rc`
  // flag with a timeout guard. Full rationale in PHASE_N1_REPORT §4 + §7.
  //
  // PATH carried into the pty still reflects the sidecar's inherited env
  // (LoginWindow launchd defaults + Node 22's /usr/local/bin PATH), so most
  // CLIs remain available — Claude, git, node, pnpm, etc.
  return [
    '# JStudio Commander v1 — generated per-runtime .zshrc',
    '# N1 scope: minimal zsh init + OSC 133 hook only. See hook-path.ts.',
    '# Regenerated at sidecar startup; do not edit by hand.',
    '',
    `source ${shellQuote(hookPath)}`,
    '',
  ].join('\n');
}

function shellQuote(s: string): string {
  // Single-quote the path and escape any embedded single quotes.
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
