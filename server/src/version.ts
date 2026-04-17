import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Stable signature that the preflight + macOS launcher ping for in
// /api/system/health to decide "is this our Commander, or some other
// HTTP server that happens to be on this port".
export const SERVICE_ID = 'jstudio-commander';

const readVersion = (): string => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dev (tsx): server/src/version.ts → server/package.json
    // build (tsc): server/dist/version.js → server/package.json
    const pkgPath = join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
};

export const SERVICE_VERSION = readVersion();
