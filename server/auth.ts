// Magic-link issuance + session lifecycle + bearer-token middleware.
// Magic-link tokens live in memory only (lost on restart by design).
// Session tokens are stored as-is — simplicity wins at our scale.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: number;
      sessionToken?: string;
    }
  }
}

import { randomBytes } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { env } from './env.js';
import { log } from './log.js';
import { statements } from './statements.js';
import type { AuthedUser, MagicEntry, SessionInfo, SessionUserRow } from './types.js';

const magicLinks = new Map<string, MagicEntry>();

const MAGIC_LINK_EXPIRY_MS = env.MAGIC_LINK_EXPIRY_MINUTES * 60_000;
const SESSION_EXPIRY_MS = env.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// Purge expired magic-link tokens every 5 minutes. .unref() so this timer
// does not keep the process alive on graceful shutdown.
const purge = setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of magicLinks) {
    if (entry.expiresAt < now) magicLinks.delete(token);
  }
}, 5 * 60_000);
purge.unref();

function rejectUnauthorized(res: Response, reason: string, path: string): void {
  log.debug('auth rejected', { reason, path });
  res.status(401).json({ error: 'unauthorized' });
}

export function issueMagicLink(email: string): string {
  const token = randomBytes(32).toString('base64url');
  magicLinks.set(token, { email, expiresAt: Date.now() + MAGIC_LINK_EXPIRY_MS });
  log.info('magic link issued', { emailHash: log.emailHash(email) });
  return token;
}

export function consumeMagicLink(token: string): string | null {
  const entry = magicLinks.get(token);
  if (entry === undefined) return null;
  magicLinks.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  return entry.email;
}

export function createSession(userId: number): SessionInfo {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_EXPIRY_MS;
  statements.sessions.insert.run(token, userId, now, now, expiresAt);
  log.info('session created', { userId });
  return { token, expiresAt };
}

export function verifySession(token: string): AuthedUser | null {
  const row = statements.sessions.selectWithUser.get(token) as SessionUserRow | undefined;
  if (row === undefined) return null;
  const now = Date.now();
  if (row.expires_at < now) return null;
  statements.sessions.slide.run(now, now + SESSION_EXPIRY_MS, token);
  return {
    id: row.id,
    email: row.email,
    goal_kcal: row.goal_kcal,
    goal_protein: row.goal_protein,
    goal_carbs: row.goal_carbs,
    goal_fat: row.goal_fat,
  };
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
  const user = verifySession(token);
  if (user === null) {
    return rejectUnauthorized(res, 'invalid_session', req.path);
  }
  req.userId = user.id;
  req.sessionToken = token;
  next();
};
