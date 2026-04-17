#!/usr/bin/env node
// Runs before Vite (`predev`). If a Commander server is already serving
// the signed /api/system/health on the configured port, print a banner
// pointing the user there and exit(0) so Vite never starts. On miss
// (connection refused, timeout, non-signed response), exit(0) silently
// so the normal dev flow proceeds.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVICE_ID = 'jstudio-commander';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const readPort = () => {
  try {
    const raw = readFileSync(join(homedir(), '.jstudio-commander', 'config.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed.port)) return Number(parsed.port);
  } catch {
    // fall through to default
  }
  return 11002;
};

const detect = async (port) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 500);
  try {
    const res = await fetch(`http://localhost:${port}/api/system/health`, { signal: ctl.signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === SERVICE_ID;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
};

const port = readPort();
const hit = await detect(port);

if (hit) {
  const url = `http://localhost:${port}`;
  console.log('');
  console.log(`${YELLOW}${BOLD}⚠  JStudio Commander is already running at ${url}${RESET}`);
  console.log(`${YELLOW}   → Open that URL in your browser${RESET}`);
  console.log(`${YELLOW}   → Vite preflight aborted to avoid duplicate dev instance${RESET}`);
  console.log(`${YELLOW}   → To force Vite anyway: lsof -ti:${port} | xargs kill -9 && pnpm dev${RESET}`);
  console.log('');
  process.exit(0);
}

// No instance detected — exit 0 silently so Vite starts.
process.exit(0);
