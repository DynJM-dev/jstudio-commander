import type { FastifyPluginAsync } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkgPath = join(PKG_DIR, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const healthRoutes: FastifyPluginAsync = async (app) => {
  const version = readVersion();
  app.get('/api/health', async () => ({
    status: 'ok' as const,
    version,
    uptime: process.uptime(),
  }));
};
