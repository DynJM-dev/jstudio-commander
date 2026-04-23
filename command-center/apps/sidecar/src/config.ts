import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SIDECAR_VERSION = '0.1.0-n1';

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
  return join(home(), '.jstudio-commander');
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

export async function loadOrCreateConfig(port: number): Promise<SidecarConfig> {
  const dir = configDir();
  const file = configFile();
  await mkdir(dir, { recursive: true });

  let existingBearer: string | undefined;
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'bearerToken' in parsed &&
      typeof (parsed as { bearerToken?: unknown }).bearerToken === 'string'
    ) {
      existingBearer = (parsed as { bearerToken: string }).bearerToken;
    }
  } catch {
    // First run, or corrupt config. Either way we write fresh below.
  }

  const config: SidecarConfig = {
    bearerToken: existingBearer ?? randomUUID(),
    port,
    version: SIDECAR_VERSION,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return config;
}
