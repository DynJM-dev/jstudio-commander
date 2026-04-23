import { existsSync } from 'node:fs';
import { cp as fsCopy, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '@commander/shared';
import { $ } from 'bun';

/**
 * Per-run worktree materialization per KB-P1.4 + ARCHITECTURE_SPEC §7.3.
 *
 * **Primary path:** `<project-root>/.worktrees/run-<uuid>/` created via
 * `git worktree add <path> HEAD`. Full isolation; concurrent runs get
 * distinct refs; git handles cleanup via `git worktree remove` later.
 *
 * **Non-git fallback** (degraded mode, KB-P1.4 acceptable v1 shape): if the
 * project root isn't a git repo, we copy the project tree into the worktree
 * path with an exclusion list (`.git`, `.worktrees`, `node_modules`, common
 * build artifacts). This preserves the isolation semantics in a weaker form
 * — no branch-switching but commands run against a separate filesystem
 * scratch of the project. If the copy fails or the project is too large,
 * we fall back further to using the project root directly as cwd + flag
 * `isGitWorktree: false` so T3 can record the degraded state.
 */

export interface CreateWorktreeOpts {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** The agent_run UUID; used as the worktree dir suffix. */
  runId: string;
  logger?: Logger;
}

export interface WorktreeResult {
  /** Absolute path suitable for passing as `spawnPty.cwd`. */
  worktreePath: string;
  /** True if a real `git worktree add` succeeded; false if degraded fallback. */
  isGitWorktree: boolean;
  /** True if the fallback copied project files; false means project-root-as-cwd. */
  isFallbackCopy: boolean;
}

// Exclusions for the non-git fallback copy. Skips known-large dirs +
// already-contained `.worktrees` children.
const COPY_EXCLUDE_DIRS = new Set<string>([
  '.git',
  '.worktrees',
  'node_modules',
  'dist',
  'build',
  'target',
  '.turbo',
  '.vite',
]);

export async function createWorktree(opts: CreateWorktreeOpts): Promise<WorktreeResult> {
  const { projectRoot, runId, logger } = opts;
  const worktreeBase = join(projectRoot, '.worktrees');
  const worktreePath = join(worktreeBase, `run-${runId}`);

  await mkdir(worktreeBase, { recursive: true });

  const hasGit = existsSync(join(projectRoot, '.git'));

  if (hasGit) {
    // Primary path: real git worktree.
    try {
      // `$` returns a ShellPromise; `.cwd(...)` runs in a specific dir;
      // `.quiet()` suppresses interactive output; `.nothrow()` lets us
      // inspect non-zero exit without exception.
      const result = await $`git worktree add ${worktreePath} HEAD`
        .cwd(projectRoot)
        .quiet()
        .nothrow();
      if (result.exitCode === 0 && existsSync(worktreePath)) {
        logger?.info({ worktreePath, projectRoot, runId }, 'worktree: git created');
        return { worktreePath, isGitWorktree: true, isFallbackCopy: false };
      }
      logger?.warn(
        { exitCode: result.exitCode, stderr: result.stderr.toString(), projectRoot, runId },
        'worktree: git worktree add failed — falling back to copy',
      );
    } catch (err) {
      logger?.warn(
        { err, projectRoot, runId },
        'worktree: git worktree add threw — falling back to copy',
      );
    }
  }

  // Fallback path: shallow copy with exclusions.
  try {
    await mkdir(worktreePath, { recursive: true });
    const copied = await shallowCopyProject(projectRoot, worktreePath);
    if (copied) {
      logger?.info(
        { worktreePath, projectRoot, runId },
        'worktree: non-git fallback (shallow copy) — isolation without branch semantics',
      );
      return { worktreePath, isGitWorktree: false, isFallbackCopy: true };
    }
  } catch (err) {
    logger?.warn(
      { err, projectRoot, runId },
      'worktree: shallow copy failed — degrading to project-root-as-cwd',
    );
  }

  // Deepest fallback: project root itself as cwd (no isolation). PTY cwd
  // works; no separate worktree path to clean up. T3 records null for
  // worktree_path to make this distinguishable from the fallback copy case.
  logger?.warn({ projectRoot, runId }, 'worktree: no isolation — using project root as PTY cwd');
  return { worktreePath: projectRoot, isGitWorktree: false, isFallbackCopy: false };
}

async function shallowCopyProject(src: string, dst: string): Promise<boolean> {
  await fsCopy(src, dst, {
    recursive: true,
    errorOnExist: false,
    force: false,
    filter: (source) => {
      // Skip known-large + self-referential dirs.
      for (const excluded of COPY_EXCLUDE_DIRS) {
        if (source.includes(`/${excluded}`) || source.endsWith(`/${excluded}`)) {
          return false;
        }
      }
      return true;
    },
  });
  return true;
}

/**
 * Best-effort worktree cleanup — called from T3 on terminal state transition
 * for completed/failed/cancelled/timed-out runs. Idempotent; silent on error
 * (a failed cleanup isn't a reason to block the user flow).
 */
export async function removeWorktree(
  projectRoot: string,
  worktreePath: string,
  logger?: Logger,
): Promise<void> {
  if (!worktreePath || worktreePath === projectRoot) {
    // No worktree to remove (degraded fallback used project root directly).
    return;
  }
  try {
    await $`git worktree remove --force ${worktreePath}`.cwd(projectRoot).quiet().nothrow();
    logger?.debug({ worktreePath }, 'worktree: git worktree removed');
  } catch (err) {
    logger?.debug({ err, worktreePath }, 'worktree: git removal failed (may not have been git)');
  }
  // If the dir still exists after git's attempt (non-git case or git failure),
  // leave it on disk — user can clean manually. Automated rm would risk
  // clobbering user data if worktreePath resolution went wrong somehow.
}
