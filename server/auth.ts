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
import { db } from './db.js';
import { readCurrentGoals } from './goals.js';
import type { LoginCodeEntry, SessionInfo, SessionRow, UserRow, VerifyCodeResponse } from './types.js';

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

export function issueLoginCode(email: string): LoginCodeEntry {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const entry: LoginCodeEntry = {
    code,
    expiresAt: Date.now() + LOGIN_CODE_EXPIRY_MS,
    attempts: 0,
  };
  loginCodes.set(email, entry);
  log.info('login code issued', { emailHash: log.emailHash(email) });
  return entry;
}

// Delivery can settle after another issuance. Identity, not six-digit value,
// prevents an older failure from invalidating the newer code on a collision.
export function invalidateLoginCode(email: string, issued: LoginCodeEntry): void {
  if (loginCodes.get(email) === issued) loginCodes.delete(email);
}

function activeLoginCode(email: string): LoginCodeEntry | undefined {
  const entry = loginCodes.get(email);
  if (entry !== undefined && entry.expiresAt < Date.now()) {
    loginCodes.delete(email);
    return undefined;
  }
  return entry;
}

export function hasActiveLoginCode(email: string): boolean {
  return activeLoginCode(email) !== undefined;
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

// Non-consuming read of the in-memory code map. Intended for TEST_MODE only;
// gated at the route layer (server/routes/auth.ts).
export function peekLoginCode(email: string): string | null {
  return activeLoginCode(email)?.code ?? null;
}

function insertSession(userId: number): SessionInfo {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_EXPIRY_MS;
  statements.sessions.insert.run(token, userId, now, now, expiresAt);
  return { token, expiresAt };
}

export function createSession(userId: number): SessionInfo {
  const session = insertSession(userId);
  log.info('session created', { userId });
  return session;
}

// Call only after consuming proof of mailbox ownership. A database failure
// rolls back both account and session, but never resurrects a consumed code.
export function createVerifiedSession(email: string): VerifyCodeResponse {
  const response = db.transaction(() => {
    statements.users.upsert.run(email, Date.now());
    const user = statements.users.selectByEmail.get(email) as UserRow | undefined;
    if (user === undefined) throw new Error('Could not create session');
    const goals = readCurrentGoals(user.id);
    if (goals === null) throw new Error('Could not create session');
    const session = insertSession(user.id);
    return {
      session_token: session.token,
      user: {
        id: user.id, email: user.email,
        goal_kcal: goals.kcal, goal_protein: goals.protein,
        goal_carbs: goals.carbs, goal_fat: goals.fat,
      },
    };
  })();
  log.info('session created', { userId: response.user.id });
  return response;
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
