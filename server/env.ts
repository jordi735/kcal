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

function toNumber(key: string): number {
  const n = Number(process.env[key]);
  if (!Number.isFinite(n)) {
    console.error(`[kcal] ${key} must be a number (got "${process.env[key]}")`);
    process.exit(1);
  }
  return n;
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
  PORT: toNumber('PORT'),
  DATABASE_PATH: process.env.DATABASE_PATH!,
  POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN!,
  POSTMARK_FROM: process.env.POSTMARK_FROM!,
  SESSION_EXPIRY_DAYS: toNumber('SESSION_EXPIRY_DAYS'),
  LOGIN_CODE_EXPIRY_MINUTES: toNumber('LOGIN_CODE_EXPIRY_MINUTES'),
  AI_SCAN_DAILY_CAP: toNumber('AI_SCAN_DAILY_CAP'),
  LOG_LEVEL: rawLevel as LogLevel,
  TEST_MODE,
} as const;
