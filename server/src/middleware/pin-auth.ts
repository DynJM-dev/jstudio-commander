import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isLoopbackIp } from '../config.js';

const CONFIG_DIR = join(homedir(), '.jstudio-commander');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

interface AppConfig {
  pin: string;
  projectDirs: string[];
  port: number;
}

const DEFAULT_CONFIG: AppConfig = {
  pin: '',
  projectDirs: [join(homedir(), 'Desktop', 'Projects')],
  port: 11002,
};

export const loadConfig = (): AppConfig => {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return DEFAULT_CONFIG;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
};

// Phase P.1 C1 — IP-based local check. The previous implementation
// trusted `request.hostname` (derived from the client-controlled Host
// header), allowing a LAN attacker to bypass PIN auth via:
//   curl -H "Host: localhost" http://<lan-ip>:11002/api/sessions
// We now consult `request.ip`, which Fastify resolves from the raw
// socket peer when `trustProxy` is false (the default we keep). No Host
// header can fake this.
const isLocalRequest = (request: FastifyRequest): boolean => {
  return isLoopbackIp(request.ip);
};

const extractPin = (request: FastifyRequest, allowQueryParam: boolean): string | null => {
  // Header is the preferred channel — never logged by Cloudflare's proxy.
  const headerPin = request.headers['x-commander-pin'];
  if (typeof headerPin === 'string' && headerPin) return headerPin;

  // Query param is rejected on remote requests because Cloudflare and any
  // intermediate proxy may log the URL, leaking the PIN. Only accepted when
  // the request originates from localhost (used by some legacy callers).
  if (allowQueryParam) {
    const queryPin = (request.query as Record<string, string>).pin;
    if (typeof queryPin === 'string' && queryPin) return queryPin;
  }

  return null;
};

// Constant-time PIN comparison — `===` would leak the PIN length and a
// bit of byte-position info via timing under repeated probing. PINs are
// short, but the cost is negligible.
export const pinsMatch = (provided: string, expected: string): boolean => {
  if (provided.length !== expected.length) {
    // Still do a constant-time compare against expected to keep the
    // timing profile flat regardless of length.
    const dummy = Buffer.alloc(expected.length, 0);
    timingSafeEqual(dummy, Buffer.from(expected, 'utf-8'));
    return false;
  }
  return timingSafeEqual(Buffer.from(provided, 'utf-8'), Buffer.from(expected, 'utf-8'));
};

// Per-IP attempt tracker. Five wrong PINs in five minutes → 15-minute
// lockout. Counters reset on a successful PIN. Map is in-memory only
// (no need to persist — restart already disrupts an attacker's state).
interface AttemptState { count: number; firstAt: number; lockedUntil: number }
const attempts = new Map<string, AttemptState>();
const ATTEMPT_WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

export const recordPinAttempt = (ip: string, ok: boolean): { lockedUntil: number | null } => {
  const now = Date.now();
  const state = attempts.get(ip);
  if (ok) {
    attempts.delete(ip);
    return { lockedUntil: null };
  }
  if (!state || now - state.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now, lockedUntil: 0 });
    return { lockedUntil: null };
  }
  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.lockedUntil = now + LOCKOUT_MS;
    return { lockedUntil: state.lockedUntil };
  }
  return { lockedUntil: null };
};

export const pinLockoutRemainingMs = (ip: string): number => {
  const state = attempts.get(ip);
  if (!state || !state.lockedUntil) return 0;
  const remaining = state.lockedUntil - Date.now();
  if (remaining <= 0) {
    // Expired — clear so the user can retry fresh.
    attempts.delete(ip);
    return 0;
  }
  return remaining;
};

export const pinAuthMiddleware = (
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void => {
  // Local requests always bypass PIN
  if (isLocalRequest(request)) {
    done();
    return;
  }

  const config = loadConfig();

  // No PIN configured — allow all
  if (!config.pin) {
    done();
    return;
  }

  // PIN verification endpoint is always accessible
  if (request.url === '/api/auth/verify-pin') {
    done();
    return;
  }

  const providedPin = extractPin(request, isLocalRequest(request));

  if (providedPin && pinsMatch(providedPin, config.pin)) {
    done();
    return;
  }

  reply.status(401).send({ error: 'PIN required', requiresPin: true });
};
