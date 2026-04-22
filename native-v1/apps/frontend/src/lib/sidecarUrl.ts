// Sidecar URL discovery. Tries 11002..11011 in order (matches the port
// range used by bindWithPortDiscovery in apps/sidecar/src/server.ts). The
// first /api/health responder wins. Result is cached for the lifetime of the
// page load — clients that need to recover from sidecar restart should
// trigger a reload.
//
// N1 deferred: native-v1 dispatch §7 path via Tauri IPC `get_sidecar_url`
// command is available but this module bypasses Tauri so the frontend can be
// dev'd standalone via `vite dev`. N6 wires this through Tauri IPC per
// ARCHITECTURE_SPEC v1.2 §7.2.

const PORT_START = 11002;
const PORT_END = 11011;
const HEALTH_TIMEOUT_MS = 800;

let cached: string | null = null;
let discovering: Promise<string> | null = null;

export async function discoverSidecarUrl(): Promise<string> {
  if (cached) return cached;
  if (discovering) return discovering;
  discovering = runDiscovery();
  try {
    cached = await discovering;
    return cached;
  } finally {
    discovering = null;
  }
}

/**
 * Clears the memoized URL so the next discoverSidecarUrl() call re-probes the
 * port range. Called by wsClient before reconnect attempts to handle the case
 * where the sidecar respawned on a different port (11002 was taken briefly
 * during restart and sidecar bound to 11003).
 */
export function resetSidecarUrlCache(): void {
  cached = null;
}

async function runDiscovery(): Promise<string> {
  for (let port = PORT_START; port <= PORT_END; port++) {
    const base = `http://127.0.0.1:${port}`;
    if (await pingHealth(base)) return base;
  }
  throw new Error(
    `Sidecar unreachable — tried 127.0.0.1:${PORT_START}..${PORT_END}. ` +
      `Ensure the sidecar process is running (Rust shell auto-spawns it in prod; ` +
      `in dev run 'pnpm sidecar:dev').`,
  );
}

async function pingHealth(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/health`, { signal: controller.signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function websocketUrlFor(baseHttp: string): string {
  return baseHttp.replace(/^http/, 'ws') + '/ws';
}
