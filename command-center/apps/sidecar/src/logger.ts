import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger, multistream, destination } from 'pino';
import { LOGS_DIR } from './config';

export function createLogger(): Logger {
  mkdirSync(LOGS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFile = join(LOGS_DIR, `${date}.log`);

  // Plain destination streams only — transports (worker-thread based) are
  // incompatible with `bun build --compile` single-binary bundling. Sync
  // sonic-boom writes are fine and fast enough for N1's low-volume logging.
  const streams = [
    { stream: destination({ dest: logFile, sync: false, append: true }) },
    { stream: process.stderr },
  ];

  const level = process.env.COMMANDER_LOG_LEVEL ?? 'info';
  return pino({ level, base: { svc: 'sidecar' } }, multistream(streams));
}
