import '../../../server/env.js';
import assert from 'node:assert/strict';
import { oauthProvider } from '../../../server/oauth.js';
import { db } from '../../../server/db.js';

const { TEST_CLIENT_ID: clientId, TEST_ACCESS_TOKEN: accessToken, TEST_REFRESH_TOKEN: refreshToken } = process.env;
assert.ok(clientId);
assert.ok(accessToken);
assert.ok(refreshToken);
const client = await oauthProvider.clientsStore.getClient(clientId);
assert.ok(client);
const before = await oauthProvider.verifyAccessToken(accessToken);
const tokens = await oauthProvider.exchangeRefreshToken(client, refreshToken);
const after = await oauthProvider.verifyAccessToken(tokens.access_token);
assert.ok(before.extra);
assert.ok(after.extra);
process.stdout.write(JSON.stringify({ registered: !!client, sameUser: before.extra.userId === after.extra.userId,
  beforeScopes: before.scopes, afterScopes: after.scopes }));
db.close();
