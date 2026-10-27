// Required-env gate: validates every expected variable is set before any
// other server module reads `process.env`. Imported first in index.ts.
// Missing/empty keys → log + exit(1), so the server refuses to boot silently.

import type { LogLevel } from './types.js';

const APP_ENVIRONMENTS = ['production', 'development', 'test'] as const;
type AppEnvironment = typeof APP_ENVIRONMENTS[number];
const rawAppEnvironment = process.env.APP_ENV?.trim().toLowerCase() || 'production';
if (!APP_ENVIRONMENTS.includes(rawAppEnvironment as AppEnvironment)) {
  console.error(`[kcal] APP_ENV must be one of: ${APP_ENVIRONMENTS.join(', ')}`);
  process.exit(1);
}
const APP_ENV = rawAppEnvironment as AppEnvironment;
const TEST_MODE = process.env.TEST_MODE === 'true';
if (APP_ENV !== 'test' && TEST_MODE) {
  console.error('[kcal] TEST_MODE is only allowed when APP_ENV is test');
  process.exit(1);
}

const CSP_MODES = ['off', 'report-only', 'enforce'] as const;
type CspMode = typeof CSP_MODES[number];
const rawCspMode = process.env.CSP_MODE?.trim().toLowerCase()
  || (APP_ENV === 'development' ? 'off' : 'enforce');
if (!CSP_MODES.includes(rawCspMode as CspMode)) {
  console.error(`[kcal] CSP_MODE must be one of: ${CSP_MODES.join(', ')}`);
  process.exit(1);
}
const CSP_MODE = rawCspMode as CspMode;
if (APP_ENV === 'production' && CSP_MODE === 'off') {
  console.error('[kcal] CSP_MODE cannot be off when APP_ENV is production');
  process.exit(1);
}

const REQUIRED = [
  'PORT',
  'DATABASE_PATH',
  'POSTMARK_SERVER_TOKEN',
  'POSTMARK_FROM',
  'SESSION_EXPIRY_DAYS',
  'LOGIN_CODE_EXPIRY_MINUTES',
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
  console.error(`[kcal] LOG_LEVEL must be one of: ${LEVELS.join(', ')}`);
  process.exit(1);
}

function toPositiveInt(key: string): number {
  const raw = process.env[key];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`[kcal] ${key} must be a positive integer`);
    process.exit(1);
  }
  return n;
}

// Optional comma-separated IP allowlist for /debug. Unset/empty → empty set
// → every caller is denied. Code stays IP-agnostic; rotate via .env.
function parseDebugAllowIps(): ReadonlySet<string> {
  const raw = process.env.DEBUG_ALLOW_IPS;
  if (APP_ENV === 'production') {
    if (raw?.trim()) console.warn('[kcal] DEBUG_ALLOW_IPS is ignored in production');
    return new Set();
  }
  if (raw === undefined) return new Set();
  return new Set(
    raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
  );
}

// A configured origin enables OAuth/MCP. Never trust a request Host as issuer.
let PUBLIC_ORIGIN = '';
const rawOrigin = process.env.PUBLIC_ORIGIN?.trim();
if (rawOrigin) {
  try {
    const url = new URL(rawOrigin);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    PUBLIC_ORIGIN = url.origin;
  } catch {
    console.error('[kcal] PUBLIC_ORIGIN must be an HTTPS origin (local HTTP is allowed), or blank to disable OAuth/MCP');
    process.exit(1);
  }
}

// Optional — tests only. Never set in production. See .env.example.
if (TEST_MODE) {
  console.warn('[kcal] ============================================================');
  console.warn('[kcal] TEST_MODE ON — emails disabled, test auth endpoint open');
  console.warn('[kcal] never use TEST_MODE in production');
  console.warn('[kcal] ============================================================');
}

export const env = {
  APP_ENV,
  CSP_MODE,
  PORT: toPositiveInt('PORT'),
  DATABASE_PATH: process.env.DATABASE_PATH!,
  POSTMARK_SERVER_TOKEN: process.env.POSTMARK_SERVER_TOKEN!,
  POSTMARK_FROM: process.env.POSTMARK_FROM!,
  SESSION_EXPIRY_DAYS: toPositiveInt('SESSION_EXPIRY_DAYS'),
  LOGIN_CODE_EXPIRY_MINUTES: toPositiveInt('LOGIN_CODE_EXPIRY_MINUTES'),
  LOG_LEVEL: rawLevel as LogLevel,
  PUBLIC_ORIGIN,
  TEST_MODE,
  // Empty set when DEBUG_ALLOW_IPS unset → /debug is fully denied (fail-closed).
  DEBUG_ALLOW_IPS: parseDebugAllowIps(),
  // Express `trust proxy` setting. Default 'loopback' is safe for local dev;
  // set trusted proxy addresses/subnets behind a reverse proxy. This string
  // parser does not interpret '1' as Express's numeric one-hop setting.
  TRUST_PROXY: process.env.TRUST_PROXY?.trim() || 'loopback',
} as const;
