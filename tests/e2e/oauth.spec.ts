import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { signInFresh } from './helpers';
import { beginOAuth, approveOAuth, consentCode, connectMcp, BrowserOAuth, clientForm, ORIGIN, RESOURCE, CALLBACK } from './oauth-helpers';

test.use({ storageState: { cookies: [], origins: [] } });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const WRITE_SCOPE = 'kcal:read kcal:write';

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

async function writeToolsVisible(request: APIRequestContext, token: string) {
  const response = await request.post('/mcp', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
  });
  expect(response.status()).toBe(200);
  const { result } = await response.json() as { result: { tools: { annotations?: { readOnlyHint?: boolean } }[] } };
  return result.tools.some((tool) => tool.annotations?.readOnlyHint === false);
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
      await expect(page.getByText('Your data cannot be changed through this connection.', { exact: true })).toBeVisible();
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
    { scope: 'kcal:read unsupported' },
    { grant_types: ['client_credentials'] },
  ]) {
    const response = await request.post('/register', { data: { ...oauth.clientMetadata, ...changes } });
    expect(response.status()).toBe(400);
  }
  for (const [key, value] of [
    ['redirect_uri', 'https://untrusted.example/callback'],
    ['resource', 'https://untrusted.example/mcp'],
    ['scope', 'kcal:write'],
    ['scope', 'kcal:read unsupported'],
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
  for (const changes of [{ scope: 'kcal:write' }, { scope: WRITE_SCOPE }, { resource: 'https://untrusted.example/mcp' }, { client_secret: 'wrong' }]) {
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
  const connection = await connectMcp(page, new BrowserOAuth('client_secret_post', WRITE_SCOPE));
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
      process.stdout.write(JSON.stringify({ registered: !!client, sameUser: before.extra.userId === after.extra.userId,
        beforeScopes: before.scopes, afterScopes: after.scopes }));
      db.close();
    `], { env: {
      ...process.env, PORT: '3000', DATABASE_PATH: dbPath, PUBLIC_ORIGIN: ORIGIN,
      TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      TEST_CLIENT_ID: connection.oauth.info!.client_id,
      TEST_ACCESS_TOKEN: tokens.access_token, TEST_REFRESH_TOKEN: tokens.refresh_token!,
    } });
    expect(JSON.parse(stdout)).toEqual({ registered: true, sameUser: true,
      beforeScopes: ['kcal:read', 'kcal:write'], afterScopes: ['kcal:read', 'kcal:write'] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('[J-211] OAuth advertises both scopes and requires explicit read and write consent', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-write-consent');
  const metadata = await (await request.get('/.well-known/oauth-authorization-server')).json();
  const resource = await (await request.get('/.well-known/oauth-protected-resource/mcp')).json();
  expect(metadata.scopes_supported).toEqual(['kcal:read', 'kcal:write']);
  expect(resource.scopes_supported).toEqual(['kcal:read', 'kcal:write']);
  for (const method of ['none', 'client_secret_post'] as const) {
    const oauth = await beginOAuth(page, new BrowserOAuth(method, WRITE_SCOPE));
    await expect(page.getByText('wants read and write access to your KCAL account.', { exact: false })).toBeVisible();
    await expect(page.getByText('Add, edit, and delete food logs and saved foods.', { exact: true })).toBeVisible();
    await expect(page.getByText('Editing saved food nutrition updates past totals. Deleting a saved food also deletes its food logs.', { exact: true })).toBeVisible();
    await expect(page.getByText('Your data cannot be changed through this connection.', { exact: true })).toHaveCount(0);
    const id = new URL(page.url()).searchParams.get('oauth_request')!;
    const session = await page.evaluate(() => localStorage.getItem('kcal_session_token')!);
    const consent = await page.request.get(`/oauth/consent?request=${id}`, {
      headers: { Authorization: `Bearer ${session}`, Origin: ORIGIN },
    });
    expect((await consent.json()).scopes).toEqual(['kcal:read', 'kcal:write']);
    await approveOAuth(page, oauth);
    expect(oauth.savedTokens!.scope).toBe(WRITE_SCOPE);
    expect(await writeToolsVisible(request, oauth.savedTokens!.access_token)).toBe(true);
    // Even write-enabled connector credentials remain separate from app sessions.
    expect((await request.post('/products', {
      headers: { Authorization: `Bearer ${oauth.savedTokens!.access_token}` }, data: {},
    })).status()).toBe(401);
  }
});

test('[J-212] OAuth reconnects legacy clients for write without upgrading old or omitted-scope grants', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-reconnect');
  const original = await beginOAuth(page);
  await approveOAuth(page, original);
  const originalTokens = original.savedTokens!;
  expect(original.info).toMatchObject({ scope: 'kcal:read' });

  const reconnect = new BrowserOAuth('none', WRITE_SCOPE);
  reconnect.info = original.info;
  await beginOAuth(page, reconnect);
  await expect(page.getByText('Add, edit, and delete food logs and saved foods.', { exact: true })).toBeVisible();
  await approveOAuth(page, reconnect);
  expect(reconnect.info!.client_id).toBe(original.info!.client_id);
  expect(reconnect.savedTokens!.scope).toBe(WRITE_SCOPE);
  expect(await writeToolsVisible(request, reconnect.savedTokens!.access_token)).toBe(true);
  expect(await writeToolsVisible(request, originalTokens.access_token)).toBe(false);

  const oldRefresh = { ...clientForm(original), grant_type: 'refresh_token', refresh_token: originalTokens.refresh_token! };
  const escalation = await request.post('/token', { form: { ...oldRefresh, scope: WRITE_SCOPE } });
  expect(escalation.status()).toBe(400);
  expect((await escalation.json()).error).toBe('invalid_scope');
  const refreshed = await request.post('/token', { form: oldRefresh });
  expect(refreshed.status()).toBe(200);
  const readTokens = await refreshed.json();
  expect(readTokens.scope).toBe('kcal:read');
  expect(await writeToolsVisible(request, readTokens.access_token)).toBe(false);

  // A write-registered client's omitted authorization scope still means read.
  const omitted = await beginOAuth(page, new BrowserOAuth('none', WRITE_SCOPE));
  expect(omitted.info).toMatchObject({ scope: WRITE_SCOPE });
  const authorization = new URL(omitted.authorizationUrl!);
  authorization.searchParams.delete('scope');
  await page.goto(authorization.href);
  await expect(page.getByText('Your data cannot be changed through this connection.', { exact: true })).toBeVisible();
  await expect(page.getByText('Add, edit, and delete food logs and saved foods.', { exact: true })).toHaveCount(0);
  await approveOAuth(page, omitted);
  expect(omitted.savedTokens!.scope).toBe('kcal:read');
  expect(await writeToolsVisible(request, omitted.savedTokens!.access_token)).toBe(false);
});

test('[J-213] OAuth refresh preserves or narrows scope without restoring write permissions', async ({ page, request }) => {
  await signInFresh(page, request, 'oauth-narrow-scope');
  const oauth = await beginOAuth(page, new BrowserOAuth('client_secret_post', WRITE_SCOPE));
  await approveOAuth(page, oauth);
  const original = oauth.savedTokens!;
  const form = { ...clientForm(oauth), grant_type: 'refresh_token' };
  const refresh = async (refreshToken: string, scope?: string) => request.post('/token', {
    form: { ...form, refresh_token: refreshToken, ...(scope === undefined ? {} : { scope }) },
  });

  const unchanged = await refresh(original.refresh_token!);
  expect(unchanged.status()).toBe(200);
  const both = await unchanged.json();
  expect(both.scope).toBe(WRITE_SCOPE);
  expect(await writeToolsVisible(request, both.access_token)).toBe(true);
  for (const scope of ['kcal:write', 'kcal:read unsupported']) {
    const invalid = await refresh(both.refresh_token, scope);
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error).toBe('invalid_scope');
  }
  const narrowed = await refresh(both.refresh_token, 'kcal:read');
  expect(narrowed.status()).toBe(200);
  const read = await narrowed.json();
  expect(read.scope).toBe('kcal:read');
  expect(await writeToolsVisible(request, read.access_token)).toBe(false);
  expect(await writeToolsVisible(request, original.access_token)).toBe(true);
  expect(await writeToolsVisible(request, both.access_token)).toBe(true);

  const escalation = await refresh(read.refresh_token, WRITE_SCOPE);
  expect(escalation.status()).toBe(400);
  expect((await escalation.json()).error).toBe('invalid_scope');
  const descendant = await refresh(read.refresh_token);
  expect(descendant.status()).toBe(200);
  const next = await descendant.json();
  expect(next.scope).toBe('kcal:read');
  expect(await writeToolsVisible(request, next.access_token)).toBe(false);
  const restored = await refresh(next.refresh_token, WRITE_SCOPE);
  expect(restored.status()).toBe(400);
  expect((await restored.json()).error).toBe('invalid_scope');

  // Replay still revokes every access token, including earlier write tokens.
  expect((await refresh(read.refresh_token)).status()).toBe(400);
  for (const token of [original.access_token, both.access_token, read.access_token, next.access_token]) {
    expect(await accessStatus(request, token)).toBe(401);
  }
});

test('[J-214] OAuth scope migration preserves legacy requests grants and tokens as read-only', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-oauth-scope-migration-'));
  const dbPath = path.join(directory, 'legacy.db');
  const migration = '006_add_oauth_scopes.sql';
  const clientId = 'legacy-scope-client';
  const access = 'legacy-scope-access';
  const refresh = 'legacy-scope-refresh';
  const code = 'legacy-scope-code';
  try {
    const legacy = new Database(dbPath);
    try {
      legacy.pragma('foreign_keys = ON');
      legacy.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
      const previous = (await readdir('server/migrations')).filter((name) => name.endsWith('.sql') && name < migration).sort();
      for (const filename of previous) {
        legacy.exec(await readFile(path.join('server/migrations', filename), 'utf8'));
        legacy.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)').run(filename, Date.now());
      }
      const user = Number(legacy.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)')
        .run('legacy-scope@test.local', Date.now()).lastInsertRowid);
      const client = { ...new BrowserOAuth().clientMetadata, client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000) };
      legacy.prepare('INSERT INTO oauth_clients (id, metadata) VALUES (?, ?)').run(clientId, JSON.stringify(client));
      const expiry = Date.now() + 86_400_000;
      const insertRequest = legacy.prepare(`INSERT INTO oauth_requests
        (id_hash, browser_hash, client_id, redirect_uri, challenge, resource, expires_at, user_id, code_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      insertRequest.run('legacy-pending', 'browser', clientId, CALLBACK, 'challenge', RESOURCE, expiry, null, null);
      insertRequest.run('legacy-approved', 'browser', clientId, CALLBACK, 'challenge', RESOURCE, expiry, user, digest(code));
      legacy.prepare('INSERT INTO oauth_grants (id, user_id, client_id, resource, expires_at) VALUES (?, ?, ?, ?, ?)')
        .run('legacy-grant', user, clientId, RESOURCE, expiry);
      const insertToken = legacy.prepare('INSERT INTO oauth_tokens (hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)');
      insertToken.run(digest(access), 'legacy-grant', 'access', expiry);
      insertToken.run(digest(refresh), 'legacy-grant', 'refresh', expiry);
    } finally { legacy.close(); }

    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import './server/env.ts';
      import { oauthProvider } from './server/oauth.ts';
      import { db } from './server/db.ts';
      const client = await oauthProvider.clientsStore.getClient(process.env.TEST_CLIENT_ID);
      const before = await oauthProvider.verifyAccessToken(process.env.TEST_ACCESS_TOKEN);
      const refreshed = await oauthProvider.exchangeRefreshToken(client, process.env.TEST_REFRESH_TOKEN);
      const after = await oauthProvider.verifyAccessToken(refreshed.access_token);
      const exchanged = await oauthProvider.exchangeAuthorizationCode(client, process.env.TEST_CODE, undefined,
        process.env.TEST_CALLBACK, new URL(process.env.TEST_RESOURCE));
      const approved = await oauthProvider.verifyAccessToken(exchanged.access_token);
      const pending = db.prepare('SELECT scopes FROM oauth_requests WHERE id_hash = ?').get('legacy-pending');
      const applied = db.prepare('SELECT filename FROM schema_migrations WHERE filename = ?').get(process.env.TEST_MIGRATION);
      process.stdout.write(JSON.stringify({
        clientScope: client.scope, before: before.scopes, after: after.scopes,
        approved: approved.scopes, pending: pending.scopes, applied: !!applied,
        sameUser: before.extra.userId === after.extra.userId && after.extra.userId === approved.extra.userId,
        tokenScopes: db.prepare('SELECT DISTINCT scopes FROM oauth_tokens').all().map(row => row.scopes),
        grantScopes: db.prepare('SELECT DISTINCT scopes FROM oauth_grants').all().map(row => row.scopes),
      }));
      db.close();
    `], { env: {
      ...process.env, PORT: '3000', DATABASE_PATH: dbPath, PUBLIC_ORIGIN: ORIGIN,
      TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
      SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      TEST_CLIENT_ID: clientId, TEST_ACCESS_TOKEN: access, TEST_REFRESH_TOKEN: refresh,
      TEST_CODE: code, TEST_CALLBACK: CALLBACK, TEST_RESOURCE: RESOURCE, TEST_MIGRATION: migration,
    } });
    expect(JSON.parse(stdout)).toEqual({
      clientScope: 'kcal:read', before: ['kcal:read'], after: ['kcal:read'], approved: ['kcal:read'],
      pending: 'kcal:read', applied: true, sameUser: true, tokenScopes: ['kcal:read'], grantScopes: ['kcal:read'],
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
