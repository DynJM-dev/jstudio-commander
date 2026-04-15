import { getIsServerDown } from './serverHealth';

const BASE_URL = '/api';

class ApiError extends Error {
  status: number;
  requiresPin: boolean;
  // True when the request failed during a known server-down window — UI
  // layers should suppress error toasts in this case (the HealthBanner is
  // already telling the user what's happening).
  serverDown: boolean;
  constructor(status: number, message: string, requiresPin = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requiresPin = requiresPin;
    this.serverDown = getIsServerDown();
  }
}

const getPin = (): string | null => {
  try {
    return sessionStorage.getItem('commander-pin');
  } catch {
    return null;
  }
};

export const setPin = (pin: string): void => {
  try {
    sessionStorage.setItem('commander-pin', pin);
  } catch {
    // sessionStorage unavailable
  }
};

export const clearPin = (): void => {
  try {
    sessionStorage.removeItem('commander-pin');
  } catch {
    // sessionStorage unavailable
  }
};

const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
  const pin = getPin();
  const headers: Record<string, string> = {};
  if (pin) headers['x-commander-pin'] = pin;

  // Only set Content-Type for requests with a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers, ...options });
  } catch (err) {
    // Network-level failure (server restarting, offline). Tag with
    // serverDown so callers can decide whether to surface a toast.
    const apiErr = new ApiError(0, err instanceof Error ? err.message : 'network_error');
    throw apiErr;
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    // Empty or malformed response — ignore during reconnects
    if (!res.ok) throw new ApiError(res.status, res.statusText);
    return {} as T;
  }

  if (!res.ok) {
    throw new ApiError(res.status, (body.error as string) ?? res.statusText, (body.requiresPin as boolean) ?? false);
  }

  return body as T;
};

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  del: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};

export { ApiError };
