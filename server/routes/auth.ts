// POST /auth/request-code, /auth/verify-code, /auth/logout.
// Deliberately does not leak account existence via /auth/request-code.

import { Router } from 'express';
import {
  authMiddleware,
  consumeLoginCode,
  createSession,
  deleteSession,
  issueLoginCode,
  peekLoginCode,
} from '../auth.js';
import { sendLoginCode } from '../email.js';
import { env } from '../env.js';
import { isObject, LOGIN_CODE_RE } from '../guards.js';
import { isEmail } from '../../shared/email.js';
import { statements } from '../statements.js';
import { readCurrentGoals } from '../goals.js';
import { AuthThrottle } from '../auth-limits.js';
import type { UserRow, VerifyCodeResponse } from '../types.js';

export const authRouter: Router = Router();
const throttle = new AuthThrottle({ testMode: env.TEST_MODE });

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
  const retryAfter = throttle.check('issue', email, req.ip ?? 'unknown');
  if (retryAfter > 0) {
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({ error: 'too_many_requests' });
    return;
  }
  statements.users.upsert.run(email, Date.now());
  const code = issueLoginCode(email);
  await sendLoginCode(email, code);
  res.json({ ok: true });
});

authRouter.post('/verify-code', (req, res) => {
  if (!isVerifyCodeBody(req.body)) {
    res.status(400).json({ error: 'invalid_or_expired_code' });
    return;
  }
  const email = req.body.email.trim().toLowerCase();
  const retryAfter = throttle.check('verify', email, req.ip ?? 'unknown');
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
  const user = statements.users.selectByEmail.get(email) as UserRow | undefined;
  if (user === undefined) {
    res.status(400).json({ error: 'invalid_or_expired_code' });
    return;
  }
  const session = createSession(user.id);
  const goals = readCurrentGoals(user.id)!;
  const response: VerifyCodeResponse = {
    session_token: session.token,
    user: {
      id: user.id,
      email: user.email,
      goal_kcal: goals.kcal,
      goal_protein: goals.protein,
      goal_carbs: goals.carbs,
      goal_fat: goals.fat,
    },
  };
  res.json(response);
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
