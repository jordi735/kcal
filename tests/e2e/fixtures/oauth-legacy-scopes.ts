import '../../../server/env.js';
import assert from 'node:assert/strict';
import { oauthProvider } from '../../../server/oauth.js';
import { db } from '../../../server/db.js';

const { TEST_CLIENT_ID: clientId, TEST_ACCESS_TOKEN: accessToken, TEST_REFRESH_TOKEN: refreshToken,
  TEST_CODE: code, TEST_CALLBACK: callback, TEST_RESOURCE: resource, TEST_MIGRATION: migration } = process.env;
assert.ok(clientId);
assert.ok(accessToken);
assert.ok(refreshToken);
assert.ok(code);
assert.ok(callback);
assert.ok(resource);
assert.ok(migration);
const client = await oauthProvider.clientsStore.getClient(clientId);
assert.ok(client);
const before = await oauthProvider.verifyAccessToken(accessToken);
const refreshed = await oauthProvider.exchangeRefreshToken(client, refreshToken);
const after = await oauthProvider.verifyAccessToken(refreshed.access_token);
const exchanged = await oauthProvider.exchangeAuthorizationCode(client, code, undefined, callback, new URL(resource));
const approved = await oauthProvider.verifyAccessToken(exchanged.access_token);
const pending = db.prepare<[string], { scopes: string }>('SELECT scopes FROM oauth_requests WHERE id_hash = ?').get('legacy-pending');
const applied = db.prepare<[string], { filename: string }>('SELECT filename FROM schema_migrations WHERE filename = ?').get(migration);
assert.ok(pending);
assert.ok(before.extra);
assert.ok(after.extra);
assert.ok(approved.extra);
process.stdout.write(JSON.stringify({
  clientScope: client.scope, before: before.scopes, after: after.scopes,
  approved: approved.scopes, pending: pending.scopes, applied: !!applied,
  sameUser: before.extra.userId === after.extra.userId && after.extra.userId === approved.extra.userId,
  tokenScopes: db.prepare<[], { scopes: string }>('SELECT DISTINCT scopes FROM oauth_tokens').all().map(row => row.scopes),
  grantScopes: db.prepare<[], { scopes: string }>('SELECT DISTINCT scopes FROM oauth_grants').all().map(row => row.scopes),
}));
db.close();
