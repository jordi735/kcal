import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runServerFixture } from './server-fixture';

type HttpResult = { status: number; headers: Record<string, string>; body: string };
type RuntimeResult = {
  debug: HttpResult;
  errors: Record<string, HttpResult>;
  sensitive: Record<string, HttpResult>;
  static: { html: HttpResult; asset: HttpResult; worker: HttpResult };
  unexpected: HttpResult;
  recovered: HttpResult;
  externalRequests: number;
};

// One disposable real application process per worker, shared only as immutable
// result data. It never reads .env, suite auth state, or the shared test database.
let runtime: RuntimeResult | undefined;
let runtimeDiagnostics = '';
function productionRuntime(): RuntimeResult {
  if (runtime !== undefined) return runtime;
  const child = runServerFixture(new URL('./fixtures/security-production-http.ts', import.meta.url), ':memory:', {
    APP_ENV: 'production', TEST_MODE: 'false', LOG_LEVEL: 'debug',
    DEBUG_ALLOW_IPS: '127.0.0.1,::1', TRUST_PROXY: 'loopback',
    SECURITY_DETAIL: 'private-diagnostic-marker-7f91',
  }, { inheritEnv: false, timeoutMs: 20_000 });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  const line = child.stdout.split('\n').find((value) => value.startsWith('SECURITY_RESULT '));
  expect(line, child.stdout).toBeDefined();
  runtimeDiagnostics = child.stdout.split('\n').filter((value) => !value.startsWith('SECURITY_RESULT ')).join('\n') + child.stderr;
  runtime = JSON.parse(line!.slice('SECURITY_RESULT '.length)) as RuntimeResult;
  expect(runtime.externalRequests).toBe(0);
  return runtime;
}

async function rejectedEnvironment(overrides: Record<string, string>, expectedDiagnostic: RegExp): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'kcal-production-guard-'));
  const database = join(directory, 'not-created', 'app.db');
  try {
    const child = runServerFixture(new URL('./fixtures/security-production-env.ts', import.meta.url), database,
      overrides, { inheritEnv: false, timeoutMs: 8000 });
    expect(child.status, child.stderr || child.stdout).toBe(1);
    expect(child.stderr).toMatch(expectedDiagnostic);
    expect(existsSync(join(directory, 'not-created'))).toBe(false);
    expect(existsSync(database)).toBe(false);
    expect(child.stdout).not.toContain('SECURITY_DB_OPENED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function privateHeaders(response: HttpResult, label: string): void {
  expect(response.headers['cache-control'], label).toMatch(/(?:^|[,\s])no-store(?:$|[,\s])/);
  expect(response.headers['x-content-type-options'], label).toBe('nosniff');
  expect(response.headers['x-frame-options'], label).toBe('DENY');
  expect(response.headers['referrer-policy'], label).toBe('strict-origin-when-cross-origin');
}

test('[J-523] production and development test mode are rejected before creating the database', async () => {
  await rejectedEnvironment({ APP_ENV: 'production', TEST_MODE: 'true' }, /TEST_MODE/);
  await rejectedEnvironment({ APP_ENV: 'development', TEST_MODE: 'true' }, /TEST_MODE/);
});

test('[J-524] missing or blank app mode fails closed and unknown modes are rejected', async () => {
  await rejectedEnvironment({ SECURITY_OMIT_APP_ENV: 'true', TEST_MODE: 'true' }, /TEST_MODE/);
  await rejectedEnvironment({ APP_ENV: '', TEST_MODE: 'true' }, /TEST_MODE/);
  await rejectedEnvironment({ APP_ENV: 'produciton', TEST_MODE: 'false' }, /APP_ENV/);
});

test('[J-525] production debug is unavailable even to an explicitly allowlisted caller', () => {
  const { debug } = productionRuntime();
  expect(debug.status).toBe(404);
  expect(debug.body).not.toContain('private-debug-user@example.test');
  expect(debug.body).not.toContain('<table');
  privateHeaders(debug, 'debug');
});

test('[J-526] production debug-level email logs never contain the live sign-in code', () => {
  const child = runServerFixture(new URL('./fixtures/security-production-email.ts', import.meta.url), ':memory:', {
    APP_ENV: 'production', TEST_MODE: 'false', LOG_LEVEL: 'debug',
  }, { inheritEnv: false, timeoutMs: 10_000 });
  expect(child.status, child.stderr || child.stdout).toBe(0);
  expect(child.stdout).toContain('SECURITY_EMAIL_DELIVERED');
  expect(child.stdout + child.stderr).not.toContain('726495');
});

test('[J-527] parser authorization and unknown-API errors retain privacy and security headers', () => {
  const { errors } = productionRuntime();
  expect(errors['json']!.status).toBe(400);
  expect(JSON.parse(errors['json']!.body)).toEqual({ error: 'invalid_json' });
  expect(errors['oversized']!.status).toBe(413);
  expect(errors['unauthorized']!.status).toBe(401);
  expect(errors['missing']!.status).toBe(404);
  expect(errors['mixedCaseMissing']!.status).toBe(404);
  for (const [name, response] of Object.entries(errors)) privateHeaders(response, name);
});

test('[J-528] authenticated and credential responses are not stored while static assets stay cacheable', () => {
  const result = productionRuntime();
  for (const [name, response] of Object.entries(result.sensitive)) {
    expect(response.status, name).toBe(200);
    privateHeaders(response, name);
  }
  expect(result.static.html.status).toBe(200);
  expect(result.static.asset.status).toBe(200);
  expect(result.static.asset.headers['cache-control']).toMatch(/\bimmutable\b/);
  expect(result.static.asset.headers['cache-control']).not.toMatch(/\bno-store\b/);
  expect(result.static.worker.status).toBe(200);
  expect(result.static.worker.headers['cache-control']).toMatch(/\bno-cache\b/);
});

test('[J-529] unexpected server errors expose only a generic failure and preserve later requests', () => {
  const { unexpected, recovered } = productionRuntime();
  expect(unexpected.status).toBe(500);
  expect(JSON.parse(unexpected.body)).toEqual({ error: 'internal_error' });
  expect(unexpected.body).not.toContain('private-diagnostic-marker-7f91');
  expect(unexpected.body).not.toMatch(/Error:|at .*\.ts|SELECT|credential=/);
  privateHeaders(unexpected, 'unexpected error');
  for (const detail of ['private-diagnostic-marker-7f91', 'private-parser-marker',
    'private-path-marker', 'private-query-marker', 'private-header-marker']) {
    expect(runtimeDiagnostics).not.toContain(detail);
  }
  expect(recovered.status).toBe(200);
  privateHeaders(recovered, 'recovered settings');
});
