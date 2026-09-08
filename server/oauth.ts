// SQLite persistence behind the SDK's OAuth endpoints. App sessions are only
// used by the consent screen; they are never accepted as connector tokens.
import { createHash, randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { db } from './db.js';
import { env } from './env.js';
import { statements } from './statements.js';
import type { OAuthGrantRow, OAuthRequestRow, OAuthTokenRow } from './types.js';

export const MCP_SCOPE = 'kcal:read';
export const MCP_RESOURCE = `${env.PUBLIC_ORIGIN}/mcp`;
const REQUEST_MS = 10 * 60_000;
const CODE_MS = 5 * 60_000;
const ACCESS_MS = 60 * 60_000;
const GRANT_MS = 90 * 24 * 60 * 60_000;
const NONCE_RE = /^[A-Za-z0-9_-]{43}$/;
const COOKIE_NAME = env.PUBLIC_ORIGIN.startsWith('https:') ? '__Host-kcal_oauth' : 'kcal_oauth';
const sql = statements.oauth;
const nonce = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function browserCookie(req: Request): string {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) ?? '';
  return NONCE_RE.test(cookie) ? cookie : '';
}

function safeRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return value.length <= 2048 && !url.hash && !url.username && !url.password
      && (url.protocol === 'https:' || (url.protocol === 'http:'
        && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

function checkScopes(scopes: string[] | undefined): void {
  if (scopes?.some((scope) => scope !== MCP_SCOPE)) throw new InvalidScopeError('Only kcal:read is supported');
}

function checkResource(resource: URL | undefined): void {
  if (resource?.href !== MCP_RESOURCE) throw new InvalidTargetError('Invalid MCP resource');
}

function cleanup(): void {
  const now = Date.now();
  sql.cleanRequests.run(now);
  sql.cleanGrants.run(now);
  sql.cleanAccess.run(now);
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId) {
    const row = sql.client.get(clientId) as { metadata: string } | undefined;
    return row ? JSON.parse(row.metadata) as OAuthClientInformationFull : undefined;
  },
  registerClient(metadata) {
    const method = metadata.token_endpoint_auth_method;
    if (method !== 'none' && method !== 'client_secret_post') {
      throw new InvalidClientMetadataError('Specify token_endpoint_auth_method: none or client_secret_post');
    }
    if (metadata.redirect_uris.length < 1 || metadata.redirect_uris.length > 10
      || !metadata.redirect_uris.every(safeRedirect)
      || (metadata.client_name?.length ?? 0) > 100
      || metadata.grant_types?.some((grant) => !['authorization_code', 'refresh_token'].includes(grant))
      || metadata.response_types?.some((type) => type !== 'code')
      || (metadata.scope !== undefined && metadata.scope !== MCP_SCOPE)) {
      throw new InvalidClientMetadataError('Invalid redirect URI, name, grants, response types, or scope');
    }
    // Keep only metadata we use. SDK confidential-client authentication needs
    // the retrievable secret, unlike our hashed user credentials below.
    const client: OAuthClientInformationFull = {
      client_id: nonce(), client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: metadata.client_name?.trim() || 'MCP client',
      redirect_uris: metadata.redirect_uris,
      token_endpoint_auth_method: method,
      grant_types: metadata.grant_types ?? ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: MCP_SCOPE,
      ...(method === 'client_secret_post' ? {
        client_secret: metadata.client_secret!, client_secret_expires_at: 0,
      } : {}),
    };
    cleanup();
    sql.insertClient.run(client.client_id, JSON.stringify(client));
    return client;
  },
};

function codeRequest(clientId: string, code: string): OAuthRequestRow {
  const row = sql.code.get(clientId, hash(code), Date.now()) as OAuthRequestRow | undefined;
  if (!row || row.user_id === null) throw new InvalidGrantError('Invalid or expired authorization code');
  return row;
}

// Call only within a transaction. Old access tokens keep their short lifetime;
// consumed refresh tokens remain as replay evidence until the grant expires.
function issueTokens(grant: OAuthGrantRow, refresh: boolean): OAuthTokens {
  const access = nonce();
  const expiresAt = Math.min(Date.now() + ACCESS_MS, grant.expires_at);
  sql.insertToken.run(hash(access), grant.id, 'access', expiresAt);
  const result: OAuthTokens = {
    access_token: access, token_type: 'Bearer', scope: MCP_SCOPE,
    expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
  };
  if (refresh) {
    result.refresh_token = nonce();
    sql.insertToken.run(hash(result.refresh_token), grant.id, 'refresh', grant.expires_at);
  }
  return result;
}

export const oauthProvider: OAuthServerProvider = {
  clientsStore,
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    checkResource(params.resource);
    checkScopes(params.scopes);
    if (!client.grant_types?.includes('authorization_code') || !safeRedirect(params.redirectUri)
      || !NONCE_RE.test(params.codeChallenge) || (params.state?.length ?? 0) > 2048) {
      throw new InvalidRequestError('Invalid authorization request');
    }
    cleanup();
    const id = nonce();
    const browser = browserCookie(res.req) || nonce();
    sql.insertRequest.run(hash(id), hash(browser), client.client_id, params.redirectUri,
      params.state ?? null, params.codeChallenge, MCP_RESOURCE, Date.now() + REQUEST_MS);
    res.cookie(COOKIE_NAME, browser, {
      httpOnly: true, secure: env.PUBLIC_ORIGIN.startsWith('https:'),
      sameSite: 'lax', path: '/', maxAge: REQUEST_MS,
    });
    res.redirect(302, `${env.PUBLIC_ORIGIN}/?oauth_request=${id}`);
  },
  async challengeForAuthorizationCode(client, code) {
    return codeRequest(client.client_id, code).challenge;
  },
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    checkResource(resource);
    return db.transaction(() => {
      // Re-read under the transaction after the SDK's asynchronous PKCE check.
      const request = codeRequest(client.client_id, code);
      if (redirectUri !== request.redirect_uri || request.resource !== MCP_RESOURCE) {
        throw new InvalidGrantError('Authorization request mismatch');
      }
      const grant: OAuthGrantRow = {
        id: nonce(), user_id: request.user_id!, client_id: client.client_id,
        resource: request.resource, expires_at: Date.now() + GRANT_MS, revoked: 0,
      };
      sql.deleteRequest.run(request.id_hash);
      sql.insertGrant.run(grant.id, grant.user_id, grant.client_id, grant.resource, grant.expires_at);
      return issueTokens(grant, client.grant_types?.includes('refresh_token') === true);
    })();
  },
  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    checkScopes(scopes);
    if (resource !== undefined) checkResource(resource);
    if (!client.grant_types?.includes('refresh_token')) throw new InvalidGrantError('Refresh is not enabled');
    const tokens = db.transaction(() => {
      const row = sql.token.get(hash(refreshToken)) as OAuthTokenRow | undefined;
      if (!row || row.kind !== 'refresh' || row.client_id !== client.client_id
        || row.revoked || row.expires_at <= Date.now() || row.token_expires_at <= Date.now()
        || row.resource !== MCP_RESOURCE) {
        throw new InvalidGrantError('Invalid or expired refresh token');
      }
      if (row.used) {
        sql.revokeGrant.run(client.client_id, row.id);
        // Commit revocation before throwing; throwing here would roll it back.
        return null;
      }
      sql.useRefresh.run(hash(refreshToken));
      return issueTokens(row, true);
    })();
    if (!tokens) throw new InvalidGrantError('Refresh token was already used; reconnect');
    return tokens;
  },
  async verifyAccessToken(token): Promise<AuthInfo> {
    const row = sql.token.get(hash(token)) as OAuthTokenRow | undefined;
    if (!row || row.kind !== 'access' || row.revoked || row.token_expires_at <= Date.now()
      || row.expires_at <= Date.now() || row.resource !== MCP_RESOURCE) {
      throw new InvalidTokenError('Invalid or expired access token');
    }
    return {
      token, clientId: row.client_id, scopes: [MCP_SCOPE],
      expiresAt: row.token_expires_at / 1000, resource: new URL(row.resource),
      extra: { userId: row.user_id },
    };
  },
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const row = sql.token.get(hash(request.token)) as OAuthTokenRow | undefined;
    if (row?.client_id === client.client_id) sql.revokeGrant.run(client.client_id, row.id);
  },
};

export function pendingConsent(req: Request, id: string): OAuthRequestRow {
  const browser = browserCookie(req);
  const row = NONCE_RE.test(id) && browser
    ? sql.pendingRequest.get(hash(id), hash(browser), Date.now()) as OAuthRequestRow | undefined
    : undefined;
  if (!row) throw new InvalidRequestError('This connection request has expired. Start again from your client.');
  return row;
}

export function decideConsent(req: Request, id: string, allow: boolean): string {
  return db.transaction(() => {
    const request = pendingConsent(req, id);
    const callback = new URL(request.redirect_uri);
    if (request.state !== null) callback.searchParams.set('state', request.state);
    if (allow) {
      const code = nonce();
      sql.approveRequest.run(req.userId!, hash(code), Date.now() + CODE_MS, request.id_hash);
      callback.searchParams.set('code', code);
    } else {
      sql.deleteRequest.run(request.id_hash);
      callback.searchParams.set('error', 'access_denied');
    }
    return callback.href;
  })();
}
