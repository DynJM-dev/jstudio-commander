import { invoke } from '@tauri-apps/api/core';

export interface HealthResponse {
  status: string;
  version: string;
  port: number;
  tableCount: number;
  tableNames: string[];
  firstPaintInstrumented: boolean;
  uptimeSeconds: number;
}

export interface SidecarConfigRead {
  bearerToken: string;
  port: number;
  version: string;
}

/**
 * Read sidecar config from disk via the Rust `read_config` IPC. Routing the
 * file read through Rust (rather than a frontend fs plugin) avoids shipping
 * @tauri-apps/plugin-fs + the capability scope for a single file read. The
 * bearer token never leaves Rust's process boundary unless the frontend asks
 * for it, which is fine for v1 local-single-user. No sync work at module
 * import — this runs after the skeleton paints.
 */
export async function readSidecarConfig(): Promise<SidecarConfigRead> {
  const raw = await invoke<string>('read_config');
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { bearerToken?: unknown }).bearerToken !== 'string' ||
    typeof (parsed as { port?: unknown }).port !== 'number'
  ) {
    throw new Error('config.json missing bearerToken or port');
  }
  const { bearerToken, port, version } = parsed as {
    bearerToken: string;
    port: number;
    version: string;
  };
  return { bearerToken, port, version: version ?? 'unknown' };
}

/**
 * Fetch /health via webview fetch — NOT curl. SMOKE_DISCIPLINE §4.2 anti-
 * pattern avoidance. Runs in the Tauri webview origin, hits 127.0.0.1:<port>
 * over HTTP; the tauri.conf.json CSP explicitly allows this.
 */
export async function fetchHealth(port: number): Promise<HealthResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/health`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`health HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (
    !body ||
    typeof body !== 'object' ||
    !(body as { ok?: unknown }).ok ||
    !(body as { data?: unknown }).data
  ) {
    throw new Error('health: malformed envelope');
  }
  return (body as { data: HealthResponse }).data;
}
