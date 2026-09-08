// Fetch wrapper: injects Bearer from localStorage, handles 401 by logging out.
import type { User } from './types';

export const SESSION_TOKEN_KEY = 'kcal_session_token';
export const USER_KEY = 'kcal_user';

export function oauthRequestId(): string | null {
  const id = new URLSearchParams(window.location.search).get('oauth_request');
  return id !== null && /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}

export async function requestLoginCode(email: string): Promise<void> {
  await api('/auth/request-code', { method: 'POST', body: { email } });
}

export async function verifyLoginCode(email: string, code: string): Promise<User> {
  const res = await api<{ session_token: string; user: User }>('/auth/verify-code', {
    method: 'POST', body: { email, code },
  });
  localStorage.setItem(SESSION_TOKEN_KEY, res.session_token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  return res.user;
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

type Body = Record<string, unknown> | FormData | undefined;

type ApiOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Body;
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, opts?: ApiOpts): Promise<T> {
  const headers = new Headers();
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  if (token !== null && token !== '') {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const init: RequestInit = {
    method: opts?.method ?? 'GET',
    headers,
  };

  if (opts?.body !== undefined) {
    if (opts.body instanceof FormData) {
      // Leave Content-Type unset — the browser sets multipart boundary.
      init.body = opts.body;
    } else {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(path, init);

  if (res.status === 401) {
    clearStoredSession();
    const request = oauthRequestId();
    window.location.assign(request === null ? '/' : `/?oauth_request=${request}`);
    throw new ApiError('unauthorized', 401);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: unknown };
      if (typeof data.error === 'string') message = data.error;
    } catch {
      // ignore parse errors — fall back to statusText
    }
    throw new ApiError(message, res.status);
  }

  return (await res.json()) as T;
}
