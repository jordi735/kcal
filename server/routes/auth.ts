// POST /auth/request-code, /auth/verify-code, /auth/logout.
// Deliberately does not leak account existence via /auth/request-code.

import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  authMiddleware,
  consumeLoginCode,
  createVerifiedSession,
  deleteSession,
  issueLoginCode,
  invalidateLoginCode,
  hasActiveLoginCode,
  peekLoginCode,
} from '../auth.js';
import { sendLoginCode } from '../email.js';
import { env } from '../env.js';
import { isObject, LOGIN_CODE_RE } from '../guards.js';
import { isEmail } from '../../shared/email.js';
import { AuthThrottle } from '../auth-limits.js';

export const authRouter: Router = Router();
const throttle = new AuthThrottle({ testMode: env.TEST_MODE });

function sourceLimiter(action: 'issue' | 'verify'): RequestHandler {
  return (req, res, next) => {
    const retryAfter = throttle.reserveSource(action, req.ip);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    next();
  };
}

// Mount once, before parsers, on the matching POST routes in server/index.ts.
export const authIssueSourceLimiter = sourceLimiter('issue');
export const authVerifySourceLimiter = sourceLimiter('verify');

function isEmailBody(v: unknown): v is { email: string } {
  return isObject(v) && isEmail(v.email);
}

function isVerifyCodeBody(v: unknown): v is { email: string; code: string } {
  return (
    isObject(v) &&
    isEmail(v.email) &&
    typeof v.code === 'string' &&
    LOGIN_CODE_RE.test(v.code)
  );
}

authRouter.post('/request-code', async (req, res) => {
  if (!isEmailBody(req.body)) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  const email = req.body.email.trim().toLowerCase();
  const retryAfter = throttle.reserveAccount('issue', email);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ error: 'too_many_requests' });
    return;
  }
  const issued = issueLoginCode(email);
  try {
    await sendLoginCode(email, issued.code);
  } catch (error) {
    invalidateLoginCode(email, issued);
    throw error;
  }
  res.json({ ok: true });
});

authRouter.post('/verify-code', (req, res) => {
  if (!isVerifyCodeBody(req.body)) {
    res.status(400).json({ error: 'invalid_or_expired_code' });
    return;
  }
  const email = req.body.email.trim().toLowerCase();
  // Requests without a live code spend source quota only. Keep eligibility,
  // account reservation and consumption synchronous so a resend cannot race.
  if (!hasActiveLoginCode(email)) {
    res.status(400).json({ error: 'invalid_or_expired_code' });
    return;
  }
  const retryAfter = throttle.reserveAccount('verify', email);
  if (retryAfter > 0) {
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ error: 'too_many_requests' });
    return;
  }
  const result = consumeLoginCode(email, req.body.code);
  if (result === 'exhausted') {
    res.status(400).json({ error: 'too_many_attempts' });
    return;
  }
  if (result !== 'ok') {
    res.status(400).json({ error: 'invalid_or_expired_code' });
    return;
  }
  res.json(createVerifiedSession(email));
});

authRouter.post('/logout', authMiddleware, (req, res) => {
  // authMiddleware guarantees req.sessionToken is set.
  deleteSession(req.sessionToken!);
  res.json({ ok: true });
});

// TEST_MODE only: exposes the in-memory login code so Playwright can sign in
// without parsing an inbox. Gated at registration so it simply doesn't exist
// in normal runs, AND the handler re-checks env.TEST_MODE for belt-and-braces.
if (env.TEST_MODE) {
  authRouter.get('/test/last-code/:email', (req, res) => {
    if (!env.TEST_MODE) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    if (!isEmail(req.params.email)) {
      res.status(400).json({ error: 'invalid_email' });
      return;
    }
    const email = req.params.email.trim().toLowerCase();
    const code = peekLoginCode(email);
    if (code === null) {
      res.status(404).json({ error: 'no_code' });
      return;
    }
    res.json({ code });
  });
}
