import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { signInFresh } from './helpers';
import { beginOAuth, approveOAuth, consentCode, connectMcp, BrowserOAuth, clientForm, ORIGIN, RESOURCE, CALLBACK } from './oauth-helpers';

test.use({ storageState: { cookies: [], origins: [] } });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

async function loginHere(page: Page, request: APIRequestContext, email: string) {
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const { code } = await (await request.get(`/auth/test/last-code/${email}`)).json();
  await page.getByLabel('6-digit sign-in code').fill(code);
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toBeVisible();
}

async function accessStatus(request: APIRequestContext, token: string) {
  return (await request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  })).status();
}

test('[J-194] OAuth connects public and confidential clients through email login and keeps tokens separate', async ({ browser, request }) => {
  const metadata = await (await request.get('/.well-known/oauth-authorization-server')).json();
  expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
  expect(metadata.token_endpoint_auth_methods_supported).toEqual(['client_secret_post', 'none']);
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json();
  expect(resource.resource).toBe(RESOURCE);
  expect(resource.authorization_servers).toEqual([metadata.issuer]);
  for (const method of ['none', 'client_secret_post'] as const) {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      const oauth = new BrowserOAuth(method);
      // Client names are untrusted display text, never HTML.
      oauth.clientMetadata.client_name = '<img src=x onerror=alert(1)>';
      await beginOAuth(page, oauth);
      const pendingUrl = page.url();
      const email = `oauth-${method}-${Date.now()}@test.local`;
      await loginHere(page, request, email);
      expect(page.url()).toBe(pendingUrl);
      await expect(page.getByText(email, { exact: true })).toBeVisible();
      await expect(page.getByText(oauth.clientMetadata.client_name!, { exact: true })).toBeVisible();
      await expect(page.locator('img')).toHaveCount(0);
      await approveOAuth(page, oauth);
      expect(oauth.savedTokens?.scope).toBe('kcal:read');
      expect(oauth.savedTokens?.refresh_token).toBeTruthy();
      expect(oauth.info?.client_secret_expires_at).toBe(method === 'none' ? undefined : 0);
      expect(await accessStatus(request, oauth.savedTokens!.access_token)).toBe(200);
      // Connector credentials cannot be used to write to app endpoints.
      const response = await request.put('/settings', {
        headers: { Authorization: `Bearer ${oauth.savedTokens!.access_token}` },
        data: { kcal: 100, protein: 10, carbs: 10, fat: 10 },
      });
      expect(response.status()).toBe(401);
      const session = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
      expect(session).not.toBe(oauth.savedTokens!.access_token);
      expect(await accessStatus(request, session!)).toBe(401);
      const storage = await page.evaluate(() => JSON.stringify(localStorage));
      expect(storage).not.toContain(oauth.savedTokens!.access_token);
      expect(storage).not.toContain(oauth.savedTokens!.refresh_token!);
    } finally { await context.close(); }
  }
});

test('[J-195] OAuth consent binds the browser, supports denial and preserves login context after session expiry', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-consent');
  const session = await page.evaluate(() => localStorage.getItem('kcal_session_token')!);
  const oauth = await beginOAuth(page);
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get('oauth_request')!;
  const headers = { Authorization: `Bearer ${session}`, Origin: ORIGIN };
  // API fixture has no browser-binding cookie, even with the correct app session.
  expect((await request.get(`/oauth/consent?request=${id}`, { headers })).status()).toBe(400);
  expect((await page.request.post('/oauth/consent', {
    headers: { ...headers, Origin: 'https://untrusted.example' }, data: { request: id, allow: true },
  })).status()).toBe(403);
  expect((await page.request.post('/oauth/consent', {
    headers, data: { request: id, allow: 'yes' },
  })).status()).toBe(400);
  await page.getByRole('button', { name: 'Deny', exact: true }).tap();
  await page.waitForURL((url) => url.pathname === '/oauth-callback');
  expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');
  expect(new URL(page.url()).searchParams.get('state')).toBe(oauth.stateValue);
  expect((await page.request.post('/oauth/consent', { headers, data: { request: id, allow: true } })).status()).toBe(400);

  const next = await beginOAuth(page);
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toBeVisible();
  const pendingUrl = page.url();
  await page.evaluate(() => localStorage.setItem('kcal_session_token', 'expired-session'));
  await page.reload();
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();
  expect(page.url()).toBe(pendingUrl);
  await loginHere(page, request, `oauth-relogin-${Date.now()}@test.local`);
  await approveOAuth(page, next);
  expect(await accessStatus(request, next.savedTokens!.access_token)).toBe(200);

  await beginOAuth(page);
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toBeVisible();
  const expiredId = new URL(page.url()).searchParams.get('oauth_request')!;
  const db = new Database('/tmp/kcal-e2e.db');
  try { db.prepare('UPDATE oauth_requests SET expires_at = 0 WHERE id_hash = ?').run(digest(expiredId)); }
  finally { db.close(); }
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(page.getByRole('button', { name: 'Allow access', exact: true })).toHaveCount(0);
});

test('[J-196] OAuth rejects unsafe registrations, mismatched PKCE, callbacks and resources, and reused codes', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-validation');
  const oauth = await beginOAuth(page);
  for (const changes of [
    { token_endpoint_auth_method: 'client_secret_basic' },
    { token_endpoint_auth_method: undefined },
    { redirect_uris: ['https://example.com/callback#fragment'] },
    { redirect_uris: ['http://example.com/callback'] },
    { scope: 'kcal:write' },
    { grant_types: ['client_credentials'] },
  ]) {
    const response = await request.post('/register', { data: { ...oauth.clientMetadata, ...changes } });
    expect(response.status()).toBe(400);
  }
  for (const [key, value] of [
    ['redirect_uri', 'https://untrusted.example/callback'],
    ['resource', 'https://untrusted.example/mcp'],
    ['scope', 'kcal:write'],
    ['code_challenge_method', 'plain'],
    ['code_challenge', ''],
  ]) {
    const url = new URL(oauth.authorizationUrl!);
    url.searchParams.set(key!, value!);
    const response = await request.get(url.href, { maxRedirects: 0 });
    expect([400, 302]).toContain(response.status());
    if (response.status() === 302) {
      const callback = new URL(response.headers()['location']!);
      expect(callback.origin).toBe(ORIGIN);
      expect(callback.pathname).toBe('/oauth-callback');
      expect(callback.searchParams.get('error')).toBeTruthy();
    }
  }
  const code = await consentCode(page, oauth);
  const form = {
    ...clientForm(oauth), grant_type: 'authorization_code', code,
    code_verifier: oauth.verifier, redirect_uri: CALLBACK, resource: RESOURCE,
  };
  const other = await (await request.post('/register', { data: oauth.clientMetadata })).json();
  for (const changes of [
    { code_verifier: 'x'.repeat(43) }, { code_verifier: '' },
    { redirect_uri: `${CALLBACK}/other` }, { resource: 'https://untrusted.example/mcp' },
    { client_id: other.client_id },
  ]) {
    expect((await request.post('/token', { form: { ...form, ...changes } })).status()).toBe(400);
  }
  const attempts = await Promise.all([request.post('/token', { form }), request.post('/token', { form })]);
  expect(attempts.map((response) => response.status()).sort()).toEqual([200, 400]);
  const exchanged = attempts.find((response) => response.status() === 200)!;
  expect((await request.post('/token', { form })).status()).toBe(400);
  expect(await accessStatus(request, (await exchanged.json()).access_token)).toBe(200);
  const malformed = await request.post('/token', {
    headers: { 'Content-Type': 'application/json' }, data: '{"client_secret":"do-not-echo",broken}',
  });
  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: 'invalid_json' });

  const expired = await beginOAuth(page);
  const expiredCode = await consentCode(page, expired);
  const db = new Database('/tmp/kcal-e2e.db');
  try { db.prepare('UPDATE oauth_requests SET expires_at = 0 WHERE code_hash = ?').run(digest(expiredCode)); }
  finally { db.close(); }
  expect((await request.post('/token', { form: {
    ...clientForm(expired), grant_type: 'authorization_code', code: expiredCode,
    code_verifier: expired.verifier, redirect_uri: CALLBACK, resource: RESOURCE,
  } })).status()).toBe(400);
});

test('[J-197] OAuth rotates refresh tokens, revokes replayed grants and rejects expired credentials', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-refresh');
  const oauth = await beginOAuth(page, new BrowserOAuth('client_secret_post'));
  await approveOAuth(page, oauth);
  const original = oauth.savedTokens!;
  const form = { ...clientForm(oauth), grant_type: 'refresh_token', refresh_token: original.refresh_token! };
  for (const changes of [{ scope: 'kcal:write' }, { resource: 'https://untrusted.example/mcp' }, { client_secret: 'wrong' }]) {
    expect((await request.post('/token', { form: { ...form, ...changes } })).status()).toBe(400);
  }
  const response = await request.post('/token', { form });
  expect(response.status()).toBe(200);
  const rotated = await response.json();
  expect(rotated.refresh_token).not.toBe(original.refresh_token);
  expect(await accessStatus(request, rotated.access_token)).toBe(200);
  expect((await request.post('/token', { form })).status()).toBe(400);
  expect(await accessStatus(request, rotated.access_token)).toBe(401);
  expect(await accessStatus(request, original.access_token)).toBe(401);

  const next = await beginOAuth(page);
  await approveOAuth(page, next);
  const token = next.savedTokens!.access_token;
  const other = await (await request.post('/register', { data: next.clientMetadata })).json();
  expect((await request.post('/revoke', { form: { client_id: other.client_id, token } })).status()).toBe(200);
  expect(await accessStatus(request, token)).toBe(200);
  expect((await request.post('/revoke', { form: { ...clientForm(next), token: 'unknown' } })).status()).toBe(200);
  expect((await request.post('/revoke', { form: { ...clientForm(next), token } })).status()).toBe(200);
  expect(await accessStatus(request, token)).toBe(401);
  expect((await request.post('/token', { form: {
    ...clientForm(next), grant_type: 'refresh_token', refresh_token: next.savedTokens!.refresh_token!,
  } })).status()).toBe(400);

  const expired = await beginOAuth(page);
  await approveOAuth(page, expired);
  const db = new Database('/tmp/kcal-e2e.db');
  try {
    db.prepare('UPDATE oauth_tokens SET expires_at = 0 WHERE hash = ?').run(digest(expired.savedTokens!.access_token));
    expect(await accessStatus(request, expired.savedTokens!.access_token)).toBe(401);
    db.prepare('UPDATE oauth_grants SET expires_at = 0 WHERE id = (SELECT grant_id FROM oauth_tokens WHERE hash = ?)')
      .run(digest(expired.savedTokens!.refresh_token!));
  } finally { db.close(); }
  expect((await request.post('/token', { form: {
    ...clientForm(expired), grant_type: 'refresh_token', refresh_token: expired.savedTokens!.refresh_token!,
  } })).status()).toBe(400);
});

test('[J-198] OAuth clients and hashed credentials survive a backend restart', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-restart');
  const connection = await connectMcp(page, new BrowserOAuth('client_secret_post'));
  await connection.mcp.close();
  const tokens = connection.oauth.savedTokens!;
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-oauth-restart-'));
  const dbPath = path.join(directory, 'app.db');
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  try {
    const rows = JSON.stringify(db.prepare('SELECT * FROM oauth_tokens').all());
    expect(rows).not.toContain(tokens.access_token);
    expect(rows).not.toContain(tokens.refresh_token!);
    await db.backup(dbPath);
  } finally { db.close(); }
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import './server/env.ts';
      import { oauthProvider } from './server/oauth.ts';
      import { db } from './server/db.ts';
      const client = await oauthProvider.clientsStore.getClient(process.env.TEST_CLIENT_ID);
      const before = await oauthProvider.verifyAccessToken(process.env.TEST_ACCESS_TOKEN);
      const tokens = await oauthProvider.exchangeRefreshToken(client, process.env.TEST_REFRESH_TOKEN);
      const after = await oauthProvider.verifyAccessToken(tokens.access_token);
      process.stdout.write(JSON.stringify({ registered: !!client, sameUser: before.extra.userId === after.extra.userId }));
      db.close();
    `], { env: {
      ...process.env, PORT: '3000', DATABASE_PATH: dbPath, PUBLIC_ORIGIN: ORIGIN,
      TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      TEST_CLIENT_ID: connection.oauth.info!.client_id,
      TEST_ACCESS_TOKEN: tokens.access_token, TEST_REFRESH_TOKEN: tokens.refresh_token!,
    } });
    expect(JSON.parse(stdout)).toEqual({ registered: true, sameUser: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
