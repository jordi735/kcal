// Bind the policy to one release document snapshot. Serving the same buffer
// prevents a deployment from pairing a new HTML body with an old script hash.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type ReleaseDocument = Readonly<{ html: Buffer; policy: string }>;

const THEME_BOOTSTRAP_MARKER = '// Select the palette before CSS paints, independently of the app bundle.';

export function loadReleaseDocument(distDir: string): ReleaseDocument {
  let html: Buffer;
  try {
    html = readFileSync(path.join(distDir, 'index.html'));
  } catch {
    throw new Error('CSP requires a readable dist/index.html build');
  }
  const scripts = Array.from(html.toString('utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  const inline = scripts.filter((script) => !/(?:^|\s)src\s*=/i.test(script[1] ?? ''));
  const bootstrap = inline[0];
  if (inline.length !== 1 || bootstrap === undefined || (bootstrap[1] ?? '').trim() !== ''
    || !bootstrap[2]?.includes(THEME_BOOTSTRAP_MARKER)) {
    // Do not silently authorize new inline scripts by hashing everything in
    // the document. The sole permitted inline script is our palette bootstrap.
    throw new Error('CSP requires exactly one known inline theme bootstrap');
  }
  const digest = createHash('sha256').update(bootstrap[2]).digest('base64');
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${digest}'`,
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ');
  return Object.freeze({ html, policy });
}
