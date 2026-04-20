// Login-code issuance + session lifecycle + bearer-token middleware.
// Login codes live in memory only, keyed by lowercased email — a second
// request for the same email atomically overwrites the prior code (resend
// semantics). Safe in single-process Node where the event loop serialises
// concurrent access.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      sessionToken?: string;
    }
  }
}

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { RequestHandler, Response } from 'express';
import { env } from './env.js';
import { log } from './log.js';
import { statements } from './statements.js';
import type { LoginCodeEntry, SessionInfo, SessionRow } from './types.js';

const loginCodes = new Map<string, LoginCodeEntry>();

const LOGIN_CODE_EXPIRY_MS = env.LOGIN_CODE_EXPIRY_MINUTES * 60_000;
const SESSION_EXPIRY_MS = env.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

// Purge expired login codes every 5 minutes. .unref() so this timer does not
// keep the process alive on graceful shutdown.
const purge = setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of loginCodes) {
    if (entry.expiresAt < now) loginCodes.delete(email);
  }
}, 5 * 60_000);
purge.unref();

function rejectUnauthorized(res: Response, reason: string, path: string): void {
  log.debug('auth rejected', { reason, path });
  res.status(401).json({ error: 'unauthorized' });
}

export function issueLoginCode(email: string): string {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  loginCodes.set(email, {
    code,
    expiresAt: Date.now() + LOGIN_CODE_EXPIRY_MS,
    attempts: 0,
  });
  log.info('login code issued', { emailHash: log.emailHash(email) });
  return code;
}

export type ConsumeResult = 'ok' | 'invalid' | 'expired' | 'exhausted';

export function consumeLoginCode(email: string, code: string): ConsumeResult {
  const entry = loginCodes.get(email);
  if (entry === undefined) return 'invalid';
  if (entry.expiresAt < Date.now()) {
    loginCodes.delete(email);
    return 'expired';
  }
  const a = Buffer.from(entry.code, 'utf8');
  const b = Buffer.from(code, 'utf8');
  const matches = a.length === b.length && timingSafeEqual(a, b);
  if (matches) {
    loginCodes.delete(email);
    return 'ok';
  }
  entry.attempts += 1;
  if (entry.attempts >= MAX_CODE_ATTEMPTS) {
    loginCodes.delete(email);
    log.info('login code exhausted', { emailHash: log.emailHash(email) });
    return 'exhausted';
  }
  return 'invalid';
}

export function createSession(userId: number): SessionInfo {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_EXPIRY_MS;
  statements.sessions.insert.run(token, userId, now, now, expiresAt);
  log.info('session created', { userId });
  return { token, expiresAt };
}

export function verifySession(token: string): number | null {
  const row = statements.sessions.selectByToken.get(token) as SessionRow | undefined;
  if (row === undefined) return null;
  const now = Date.now();
  if (row.expires_at < now) return null;
  statements.sessions.slide.run(now, now + SESSION_EXPIRY_MS, token);
  return row.user_id;
}

export function deleteSession(token: string): void {
  statements.sessions.delete.run(token);
  log.info('session revoked');
}

export const authMiddleware: RequestHandler = (req, res, next) => {
  const header = req.get('authorization');
  if (header === undefined || !header.startsWith('Bearer ')) {
    return rejectUnauthorized(res, 'missing_bearer', req.path);
  }
  const token = header.slice(7).trim();
  if (token === '') {
    return rejectUnauthorized(res, 'empty_token', req.path);
  }
  const userId = verifySession(token);
  if (userId === null) {
    return rejectUnauthorized(res, 'invalid_session', req.path);
  }
  req.userId = userId;
  req.sessionToken = token;
  next();
};
