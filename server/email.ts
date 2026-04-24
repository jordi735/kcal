// Postmark transport — env validation (server/env.ts) guarantees the token
// and from address are set, so this just builds and sends.

import { ServerClient } from 'postmark';
import { env } from './env.js';
import { log } from './log.js';
import { loginCodeHtml, loginCodeText, render } from './templates.js';

export async function sendLoginCode(email: string, code: string): Promise<void> {
  const hash = log.emailHash(email);
  // debug-level code dump for local development; silent at info+.
  log.debug('login code (dev)', { emailHash: hash, code });
  if (env.TEST_MODE) {
    log.info('TEST_MODE: email skipped', { emailHash: hash });
    return;
  }
  const vars = { code, expiryMinutes: env.LOGIN_CODE_EXPIRY_MINUTES };
  const client = new ServerClient(env.POSTMARK_SERVER_TOKEN);
  await client.sendEmail({
    From: env.POSTMARK_FROM,
    To: email,
    Subject: 'Your kcal. sign-in code',
    HtmlBody: render(loginCodeHtml, vars),
    TextBody: render(loginCodeText, vars),
  });
  log.info('login code email sent', { emailHash: hash });
}
