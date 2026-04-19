// Postmark transport — env validation (server/env.ts) guarantees the token
// and from address are set, so this just builds and sends.

import { ServerClient } from 'postmark';
import { env } from './env.js';
import { log } from './log.js';

const FONT_MONO = `'JetBrains Mono',ui-monospace,Menlo,monospace`;
const FONT_SANS = `-apple-system,Segoe UI,sans-serif`;

function renderHtml(linkUrl: string, expiryMinutes: number): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px;background:#1d2021;color:#fbf1c7;font-family:${FONT_SANS};">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:480px;margin:0 auto;">
      <tr>
        <td style="padding:0 0 24px;font-family:${FONT_MONO};font-size:28px;letter-spacing:-0.03em;color:#fbf1c7;">
          kcal.
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 24px;font-size:15px;line-height:1.55;color:#d5c4a1;">
          Tap the link below to sign in. It expires in ${expiryMinutes} minutes.
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 28px;">
          <a href="${linkUrl}"
             style="display:inline-block;padding:14px 22px;background:#b8bb26;color:#1d2021;font-weight:600;text-decoration:none;border-radius:12px;letter-spacing:0.04em;font-family:${FONT_SANS};">
            Sign in to kcal.
          </a>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 8px;font-size:12px;color:#928374;font-family:${FONT_MONO};">
          Or paste this into your browser:
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 24px;font-size:12px;color:#d5c4a1;word-break:break-all;font-family:${FONT_MONO};">
          ${linkUrl}
        </td>
      </tr>
      <tr>
        <td style="padding:20px 0 0;border-top:1px solid #3c3836;font-size:11px;color:#665c54;letter-spacing:0.1em;text-transform:uppercase;font-family:${FONT_MONO};">
          Didn't ask for this? Ignore this email.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(linkUrl: string, expiryMinutes: number): string {
  return [
    'kcal.',
    '',
    `Tap the link below to sign in. It expires in ${expiryMinutes} minutes.`,
    '',
    linkUrl,
    '',
    "Didn't ask for this? Ignore this email.",
  ].join('\n');
}

export async function sendMagicLink(email: string, linkUrl: string): Promise<void> {
  const hash = log.emailHash(email);
  // debug-level link dump for local development; silent at info+.
  log.debug('magic link (dev)', { emailHash: hash, url: linkUrl });
  const client = new ServerClient(env.POSTMARK_SERVER_TOKEN);
  await client.sendEmail({
    From: env.POSTMARK_FROM,
    To: email,
    Subject: 'Your kcal. magic link',
    HtmlBody: renderHtml(linkUrl, env.MAGIC_LINK_EXPIRY_MINUTES),
    TextBody: renderText(linkUrl, env.MAGIC_LINK_EXPIRY_MINUTES),
  });
  log.info('magic email sent', { emailHash: hash });
}
