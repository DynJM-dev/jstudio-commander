import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

const home = homedir();
const dataDir = join(home, '.jstudio-commander');
const configPath = join(dataDir, 'config.json');

interface FileConfig {
  pin?: string;
  projectDirs?: string[];
  port?: number;
  // Phase P.1 C1: explicit opt-in for LAN / tunnel exposure. Default is
  // loopback (`127.0.0.1`); any operator who wants the server reachable
  // on the LAN must set this AND configure a non-empty PIN (the boot
  // guard in index.ts refuses a non-loopback bind without one).
  bindHost?: string;
}

const loadFileConfig = (): FileConfig => {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  if (!existsSync(configPath)) {
    const defaults = {
      pin: '',
      projectDirs: [join(home, 'Desktop', 'Projects')],
      port: 11002,
    };
    writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    return defaults;
  }

  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as FileConfig;
  } catch {
    return {};
  }
};

const fileConfig = loadFileConfig();

// Phase P.1 C1 — default loopback bind. Operators opt into LAN exposure
// via either `bindHost` in `~/.jstudio-commander/config.json` or the
// `COMMANDER_HOST` environment variable (env wins). The boot guard in
// `index.ts` refuses any non-loopback bind without a non-empty PIN.
const envHost = process.env.COMMANDER_HOST?.trim();
const resolvedHost = (envHost && envHost.length > 0)
  ? envHost
  : (fileConfig.bindHost && fileConfig.bindHost.trim().length > 0
      ? fileConfig.bindHost.trim()
      : '127.0.0.1');

// Phase P.1 C1 — CORS + WS origin allowlist, single source of truth.
// Expressed here so `cors` registration and the WebSocket `verifyClient`
// guard can't drift. Localhost-only by design; adding an LAN host means
// the operator also took the bindHost opt-in AND set a PIN.
export const CORS_ORIGINS = [
  'http://localhost:11573',
  'http://127.0.0.1:11573',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

// Phase P.1 C1 — shared loopback predicate used by both the pin-auth
// middleware and the per-route guards (hook-event, session-tick). Keeps
// the definition of "local request" identical across the server.
export const isLoopbackIp = (ip: string | undefined | null): boolean => {
  if (!ip) return false;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
};

export const isLoopbackHost = (host: string): boolean => {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
};

// Phase P.1 C1 — boot-time guard predicate. True when the operator has
// asked for non-loopback exposure AND the PIN is empty (the
// bind-without-PIN footgun). Extracted for test coverage without needing
// to boot a Fastify instance.
export const refuseBindWithoutPin = (host: string, pin: string): boolean => {
  return !isLoopbackHost(host) && (!pin || pin.length === 0);
};

export const config = {
  port: fileConfig.port ?? 11002,
  host: resolvedHost,

  // Database
  dataDir,
  dbPath: join(dataDir, 'commander.db'),

  // Claude Code paths
  claudeDir: join(home, '.claude'),
  claudeProjectsDir: join(home, '.claude', 'projects'),

  // Project discovery directories
  projectDirs: fileConfig.projectDirs?.map((d) =>
    d.startsWith('~') ? d.replace('~', home) : d
  ) ?? [join(home, 'Desktop', 'Projects')],

  // Auth / tunnel PIN (same value — stored as `pin` in config.json,
  // consumed by both the tunnel start guard and the boot-time non-
  // loopback guard).
  pin: fileConfig.pin ?? '',
  tunnelPin: fileConfig.pin ?? '',
};
