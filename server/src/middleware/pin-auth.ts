import type { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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
  port: 3001,
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

const isLocalRequest = (request: FastifyRequest): boolean => {
  const host = request.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('localhost:');
};

const extractPin = (request: FastifyRequest): string | null => {
  // Check header first
  const headerPin = request.headers['x-commander-pin'];
  if (typeof headerPin === 'string' && headerPin) return headerPin;

  // Check query param
  const queryPin = (request.query as Record<string, string>).pin;
  if (typeof queryPin === 'string' && queryPin) return queryPin;

  return null;
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

  const providedPin = extractPin(request);

  if (providedPin === config.pin) {
    done();
    return;
  }

  reply.status(401).send({ error: 'PIN required', requiresPin: true });
};
