import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';

export const SIDECAR_VERSION = '0.1.0-n2';

export interface SidecarConfig {
  bearerToken: string;
  port: number;
  version: string;
  updatedAt: string;
}

// Paths resolved per call rather than at module import. `process.env.HOME`
// takes precedence over `os.homedir()` so tests can redirect to a temp dir
// — `os.homedir()` on Unix uses getpwuid() and ignores env mutations.

function home(): string {
  return process.env.HOME ?? homedir();
}

export function configDir(): string {
  return join(home(), '.commander');
}

export function configFile(): string {
  return join(configDir(), 'config.json');
}

export function dbFile(): string {
  return join(configDir(), 'commander.db');
}

export function logsDir(): string {
  return join(configDir(), 'logs');
}

// Backwards-compat constant-style exports for code paths (logger, db/client)
// that read paths once at boot. Computed eagerly via getters for consumers
// that bind at import time — they capture HOME as-of first read, which is
// fine for production (HOME is stable) but gets around with fresh calls in
// tests via the functions above.
export const CONFIG_DIR = configDir();
export const CONFIG_FILE = configFile();
export const DB_FILE = dbFile();
export const LOGS_DIR = logsDir();

/**
 * D-N1-07 §8.2 bearer contract:
 *   "Single local bearer token at ~/.commander/config.json. v1: no expiry."
 *
 * The contract means: mint the bearer on first run, persist across every
 * subsequent boot, re-mint ONLY when the file is absent, unparseable, or
 * missing the bearer field. External MCP sessions + plugin installs hold
 * the token for hours-to-days — rotation mid-flight silently 401s them.
 *
 * N2.1 regression test: `tests/integration/bearer-persistence.test.ts`.
 *
 * Implementation notes:
 *
 * - The read path distinguishes ENOENT (expected on first run) from other
 *   filesystem errors (unexpected — possibly permission, device, race).
 *   Unexpected errors emit a warn-level log so the pattern is legible in
 *   production without needing the test harness to reproduce.
 *
 * - The write path is atomic via `<file>.tmp` + rename. If the process is
 *   killed mid-write, the target is either the prior-complete state or the
 *   new-complete state — never torn. Rules out a class of "JSON parse fails
 *   on next boot → bearer remints" race that would otherwise be undetectable
 *   outside the incident window.
 */
export async function loadOrCreateConfig(
  port: number,
  logger?: FastifyBaseLogger,
): Promise<SidecarConfig> {
  const dir = configDir();
  const file = configFile();
  await mkdir(dir, { recursive: true });

  let existingBearer: string | undefined;
  let readOutcome: 'preserved' | 'first-run' | 'corrupt' | 'missing-field' | 'unexpected-error';
  try {
    const raw = await readFile(file, 'utf8');
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'bearerToken' in parsed &&
        typeof (parsed as { bearerToken?: unknown }).bearerToken === 'string' &&
        (parsed as { bearerToken: string }).bearerToken.length > 0
      ) {
        existingBearer = (parsed as { bearerToken: string }).bearerToken;
        readOutcome = 'preserved';
      } else {
        readOutcome = 'missing-field';
        logger?.warn(
          { file },
          'bearer config parsed but bearerToken missing/empty — minting fresh',
        );
      }
    } catch (parseErr) {
      // File exists but JSON.parse failed (torn write, hand-edited, corrupt).
      // Mint fresh but log loudly — a healthy sidecar never hits this branch.
      readOutcome = 'corrupt';
      logger?.warn(
        { err: parseErr, file },
        'bearer config JSON.parse failed — minting fresh bearer',
      );
    }
  } catch (err) {
    // ENOENT is the expected first-run path. Anything else is worth a warning
    // so future incidents (permissions, stale FS handle, disk full mid-read)
    // show up in logs instead of silently becoming a bearer rotation.
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') {
      readOutcome = 'first-run';
    } else {
      readOutcome = 'unexpected-error';
      logger?.warn(
        { err, code, file },
        'bearer config read failed with unexpected error — minting fresh bearer',
      );
    }
  }

  const bearerToken = existingBearer ?? randomUUID();
  const config: SidecarConfig = {
    bearerToken,
    port,
    version: SIDECAR_VERSION,
    updatedAt: new Date().toISOString(),
  };

  // Atomic write — tmp file + rename. rename(2) on POSIX is atomic within the
  // same filesystem; a reader that opens `file` always sees either the old
  // complete content or the new complete content, never a partial stream.
  const tmpFile = `${file}.tmp`;
  const body = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(tmpFile, body, 'utf8');
  await rename(tmpFile, file);

  if (logger) {
    const tokenPreview = `${bearerToken.slice(0, 8)}…`;
    if (readOutcome === 'preserved') {
      logger.info({ port, tokenPreview, readOutcome }, 'bearer preserved from existing config');
    } else {
      logger.info(
        { port, tokenPreview, readOutcome },
        'bearer minted fresh — see readOutcome for which path fired',
      );
    }
  }

  return config;
}
