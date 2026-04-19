// POST /auth/magic-link, /auth/verify, /auth/logout.
// Deliberately does not leak account existence via /auth/magic-link.

import { Router } from 'express';
import {
  authMiddleware,
  consumeMagicLink,
  createSession,
  deleteSession,
  issueMagicLink,
} from '../auth.js';
import { sendMagicLink } from '../email.js';
import { env } from '../env.js';
import { EMAIL_RE, isObject } from '../guards.js';
import { statements } from '../statements.js';
import type { UserRow } from '../types.js';

export const authRouter: Router = Router();

function isEmailBody(v: unknown): v is { email: string } {
  return isObject(v) && typeof v.email === 'string' && EMAIL_RE.test(v.email);
}

function isTokenBody(v: unknown): v is { token: string } {
  return isObject(v) && typeof v.token === 'string' && v.token.length > 0;
}

authRouter.post('/magic-link', async (req, res) => {
  if (!isEmailBody(req.body)) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  const email = req.body.email.trim().toLowerCase();
  statements.users.upsert.run(email, Date.now());
  const token = issueMagicLink(email);
  const url = `${env.MAGIC_LINK_BASE_URL}/verify?token=${token}`;
  await sendMagicLink(email, url);
  res.json({ ok: true });
});

authRouter.post('/verify', (req, res) => {
  if (!isTokenBody(req.body)) {
    res.status(400).json({ error: 'invalid_or_expired_token' });
    return;
  }
  const email = consumeMagicLink(req.body.token);
  if (email === null) {
    res.status(400).json({ error: 'invalid_or_expired_token' });
    return;
  }
  const user = statements.users.selectByEmail.get(email) as UserRow | undefined;
  if (user === undefined) {
    res.status(400).json({ error: 'invalid_or_expired_token' });
    return;
  }
  const session = createSession(user.id);
  res.json({
    session_token: session.token,
    user: {
      id: user.id,
      email: user.email,
      goal_kcal: user.goal_kcal,
      goal_protein: user.goal_protein,
      goal_carbs: user.goal_carbs,
      goal_fat: user.goal_fat,
    },
  });
});

authRouter.post('/logout', authMiddleware, (req, res) => {
  // authMiddleware guarantees req.sessionToken is set.
  deleteSession(req.sessionToken!);
  res.json({ ok: true });
});
