// Thin HTTP client. All sidecar REST traffic goes through httpJson so the
// base URL is discovered once + query failures surface with useful messages.

import { discoverSidecarUrl } from './sidecarUrl.js';

export interface HttpOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export async function httpJson<T>(path: string, opts: HttpOpts = {}): Promise<T> {
  const base = await discoverSidecarUrl();
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`);
    }
  }
  if (!res.ok) {
    const errObj = parsed as { error?: string; message?: string } | null;
    throw new Error(
      `HTTP ${res.status} on ${path}: ${errObj?.error ?? errObj?.message ?? res.statusText}`,
    );
  }
  return parsed as T;
}
