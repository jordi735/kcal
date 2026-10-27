// Fetch wrapper: all requests and their completion effects belong to a session.
import type { User, VerifyCodeResponse } from './types';

export const SESSION_TOKEN_KEY = 'kcal_session_token';
export const USER_KEY = 'kcal_user';
export const SESSION_CHANGED_EVENT = 'kcal-session-changed';

export type SessionScope = { token: string | null; generation: number };
let observedToken: string | null | undefined;
let generation = 0;

export function captureSession(): SessionScope {
  const token = localStorage.getItem(SESSION_TOKEN_KEY) || null;
  if (observedToken !== undefined && token !== observedToken) generation++;
  observedToken = token;
  return { token, generation };
}

export function isSessionCurrent(session: SessionScope): boolean {
  const current = captureSession();
  return current.token === session.token && current.generation === session.generation;
}

export class SessionChangedError extends Error {
  constructor() { super('Session changed'); }
}

export function assertSessionCurrent(session: SessionScope): void {
  if (!isSessionCurrent(session)) throw new SessionChangedError();
}

export function notifySessionChanged(): void {
  captureSession();
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function oauthRequestId(): string | null {
  const id = new URLSearchParams(window.location.search).get('oauth_request');
  return id !== null && /^[A-Za-z0-9_-]{43}$/.test(id) ? id : null;
}

export async function requestLoginCode(email: string): Promise<void> {
  await api('/auth/request-code', { method: 'POST', body: { email } });
}

export async function verifyLoginCode(email: string, code: string): Promise<User> {
  const session = captureSession();
  const res = await api<VerifyCodeResponse>('/auth/verify-code', {
    method: 'POST', body: { email, code }, session,
  });
  assertSessionCurrent(session);
  localStorage.setItem(SESSION_TOKEN_KEY, res.session_token);
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  notifySessionChanged();
  return res.user;
}

export function clearStoredSession(): void {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notifySessionChanged();
}

type Body = Record<string, unknown> | undefined;
export type ApiOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Body;
  session?: SessionScope;
};

export class ApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;
  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const deadline = Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
}

export async function api<T>(path: string, opts?: ApiOpts): Promise<T> {
  const session = opts?.session ?? captureSession();
  assertSessionCurrent(session);
  const headers = new Headers();
  if (session.token !== null) headers.set('Authorization', `Bearer ${session.token}`);
  const init: RequestInit = { method: opts?.method ?? 'GET', headers };
  if (init.method === 'GET') init.cache = 'no-store';
  if (opts?.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  // An old response must neither erase a new bearer nor populate its UI.
  assertSessionCurrent(session);
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
    } catch { /* Retain the HTTP status message for non-JSON responses. */ }
    assertSessionCurrent(session);
    throw new ApiError(message, res.status, retryAfter(res.headers.get('Retry-After')));
  }
  const data = await res.json() as T;
  assertSessionCurrent(session);
  return data;
}
