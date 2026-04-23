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

// ---- Hook-events API (N2 Debug + Plugin tabs) ----

export interface HookEventSummary {
  id: string;
  sessionId: string;
  eventName: string;
  timestamp: string;
  payloadJson: unknown;
}

export interface RecentEventsResponse {
  count: number;
  events: HookEventSummary[];
}

export async function fetchRecentEvents(
  port: number,
  opts: { limit?: number; sinceIso?: string } = {},
): Promise<RecentEventsResponse> {
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set('limit', String(opts.limit));
  if (opts.sinceIso !== undefined) qs.set('since', opts.sinceIso);
  const url = `http://127.0.0.1:${port}/api/recent-events${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`recent-events HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!body || typeof body !== 'object' || !(body as { ok?: unknown }).ok) {
    throw new Error('recent-events: malformed envelope');
  }
  return (body as { data: RecentEventsResponse }).data;
}

export interface ReplayResponse {
  replayedEventId: string;
  replayedEventName: string;
  pipelineResponse: unknown;
}

export async function replayLastEvent(port: number): Promise<ReplayResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/events/replay`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    const err = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`replay failed: ${err}`);
  }
  if (!body || typeof body !== 'object' || !(body as { ok?: unknown }).ok) {
    throw new Error('replay: malformed envelope');
  }
  return (body as { data: ReplayResponse }).data;
}

// ---- Plugin path resolution (Tauri IPC) ----

/**
 * Resolve the bundled plugin directory via the `get_resource_path` Rust IPC.
 * Tauri v2 resource layout: `.app/Contents/Resources/plugin/`. The plugin
 * dir is bundled via `tauri.conf.json` `bundle.resources`. Returns an
 * absolute filesystem path (with spaces un-encoded).
 */
export async function getPluginPath(): Promise<string> {
  return invoke<string>('get_resource_path', { name: 'plugin' });
}
