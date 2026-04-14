const BASE_URL = '/api';

class ApiError extends Error {
  status: number;
  requiresPin: boolean;
  constructor(status: number, message: string, requiresPin = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requiresPin = requiresPin;
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

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
  });

  const body = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? res.statusText, body.requiresPin ?? false);
  }

  return body as T;
};

export const api = {
  get: <T>(path: string) => request<T>(path),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),

  del: <T>(path: string) =>
    request<T>(path, { method: 'DELETE' }),
};

export { ApiError };
