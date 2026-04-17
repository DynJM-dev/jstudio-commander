import { SERVICE_ID } from './version.js';

// Yellow / reset ANSI. Tiny inline helper — not worth a dep for this.
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

interface HealthResponse {
  status?: string;
  service?: string;
  version?: string;
}

// Ping `/api/system/health` on the configured port. Return `true` if a
// Commander instance is already serving there (signed match). Return
// `false` on timeout, connection refused, or any non-signed response —
// the caller should fall through to a normal bind in that case.
export const detectExistingCommander = async (port: number): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);
  try {
    const res = await fetch(`http://localhost:${port}/api/system/health`, {
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body = (await res.json()) as HealthResponse;
    return body.service === SERVICE_ID;
  } catch {
    // AbortError, fetch-refused, DNS, etc. — port is effectively free
    // (or held by a different service) as far as preflight is concerned.
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const printDuplicateBanner = (port: number): void => {
  const url = `http://localhost:${port}`;
  const msg = [
    '',
    `${YELLOW}${BOLD}⚠  JStudio Commander is already running at ${url}${RESET}`,
    `${YELLOW}   → Open that URL in your browser${RESET}`,
    `${YELLOW}   → To restart: lsof -ti:${port} | xargs kill -9 && pnpm dev${RESET}`,
    '',
  ].join('\n');
  console.log(msg);
};
