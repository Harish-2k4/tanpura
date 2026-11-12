// Fetch wrapper for the Tanpura API: JSON in and out, typed errors, sign-out on 401.
import type { ApiErrorBody } from '../../../shared/api';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

type Options = { method?: 'GET' | 'POST' | 'PATCH' | 'PUT'; body?: unknown; query?: Record<string, string | undefined> };

export async function api<T>(path: string, { method = 'GET', body, query }: Options = {}): Promise<T> {
  const params = new URLSearchParams(Object.entries(query ?? {}).filter((e): e is [string, string] => e[1] !== undefined));
  const url = `/api${path}${params.size ? `?${params}` : ''}`;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => undefined)) as unknown;
  if (res.ok) return data as T;

  if (res.status === 401 && path !== '/auth/login') onUnauthorized();
  const err = data as ApiErrorBody | undefined;
  const message = err?.issues?.[0]?.message ?? err?.error ?? `Request failed (${res.status})`;
  throw new ApiError(res.status, message);
}
