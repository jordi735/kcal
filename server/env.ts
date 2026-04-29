// Required-env gate: validates every expected variable is set before any
// other server module reads `process.env`. Imported first in index.ts.
// Missing/empty keys → log + exit(1), so the server refuses to boot silently.

import type { LogLevel } from './types.js';

const REQUIRED = [
  'PORT',
  'DATABASE_PATH',
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_FROM',
  'SESSION_EXPIRY_DAYS',
  'LOGIN_CODE_EXPIRY_MINUTES',
  'AI_SCAN_DAILY_CAP',
  'LOG_LEVEL',
] as const;

const missing = REQUIRED.filter((k) => {
  const v = process.env[k];
  return v === undefined || v.trim() === '';
});

if (missing.length > 0) {
  console.error(`[kcal] missing required env vars: ${missing.join(', ')}`);
  console.error('[kcal] fill every key in .env — refer to .env.example.');
  process.exit(1);
}

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const rawLevel = process.env.LOG_LEVEL!.trim().toLowerCase();
if (!LEVELS.includes(rawLevel as LogLevel)) {
  console.error(`[kcal] LOG_LEVEL must be one of: ${LEVELS.join(', ')} (got "${rawLevel}")`);
  process.exit(1);
}

function toPositiveInt(key: string): number {
  const raw = process.env[key];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[kcal] ${key} must be a positive integer (got "${raw}")`);
    process.exit(1);
  }
  return n;
}

// Optional comma-separated IP allowlist for /debug. Unset/empty → empty set
// → every caller is denied. Code stays IP-agnostic; rotate via .env.
function parseDebugAllowIps(): ReadonlySet<string> {
  const raw = process.env.DEBUG_ALLOW_IPS;
  if (raw === undefined) return new Set();
  return new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
  );
}

// Optional — tests only. Never set in production. See .env.example.
const TEST_MODE = process.env.TEST_MODE === 'true';
if (TEST_MODE) {
  console.warn('[kcal] ============================================================');
  console.warn('[kcal] TEST_MODE ON — emails disabled, /auth/test/last-code open');
  console.warn('[kcal] never use TEST_MODE in production');
  console.warn('[kcal] ============================================================');
}

export const env = {
  PORT: toPositiveInt('PORT'),
  DATABASE_PATH: process.env.DATABASE_PATH!,
  POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN!,
  POSTMARK_FROM: process.env.POSTMARK_FROM!,
  SESSION_EXPIRY_DAYS: toPositiveInt('SESSION_EXPIRY_DAYS'),
  LOGIN_CODE_EXPIRY_MINUTES: toPositiveInt('LOGIN_CODE_EXPIRY_MINUTES'),
  AI_SCAN_DAILY_CAP: toPositiveInt('AI_SCAN_DAILY_CAP'),
  LOG_LEVEL: rawLevel as LogLevel,
  TEST_MODE,
  // Empty set when DEBUG_ALLOW_IPS unset → /debug is fully denied (fail-closed).
  DEBUG_ALLOW_IPS: parseDebugAllowIps(),
  // Express `trust proxy` setting. Default 'loopback' is safe for local dev;
  // set to '1' (or your specific config) when behind a reverse proxy so that
  // req.ip resolves to the real client and not the proxy hop.
  TRUST_PROXY: process.env.TRUST_PROXY?.trim() || 'loopback',
} as const;
