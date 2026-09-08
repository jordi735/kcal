import { expect, type Page } from '@playwright/test';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { randomBytes } from 'node:crypto';

export const ORIGIN = 'http://localhost:3001';
export const RESOURCE = `${ORIGIN}/mcp`;
export const CALLBACK = `${ORIGIN}/oauth-callback`;

// Exercise the real SDK's discovery, DCR, PKCE, code exchange and token usage.
export class BrowserOAuth implements OAuthClientProvider {
  redirectUrl = CALLBACK;
  clientMetadata: OAuthClientMetadata;
  info: OAuthClientInformationMixed | undefined;
  savedTokens: OAuthTokens | undefined;
  authorizationUrl: URL | undefined;
  verifier = '';
  stateValue = randomBytes(16).toString('hex');
  constructor(method: 'none' | 'client_secret_post' = 'none') {
    this.clientMetadata = {
      client_name: 'KCAL test connector', redirect_uris: [CALLBACK],
      token_endpoint_auth_method: method, scope: 'kcal:read',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    };
  }
  state() { return this.stateValue; }
  clientInformation() { return this.info; }
  saveClientInformation(info: OAuthClientInformationMixed) { this.info = info; }
  tokens() { return this.savedTokens; }
  saveTokens(tokens: OAuthTokens) { this.savedTokens = tokens; }
  redirectToAuthorization(url: URL) { this.authorizationUrl = url; }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() { return this.verifier; }
}

export async function beginOAuth(page: Page, oauth = new BrowserOAuth()) {
  expect(await auth(oauth, { serverUrl: RESOURCE })).toBe('REDIRECT');
  await page.route(`${CALLBACK}?**`, (route) => route.fulfill({ contentType: 'text/html', body: 'Connected' }));
  await page.goto(oauth.authorizationUrl!.href);
  return oauth;
}

export async function consentCode(page: Page, oauth: BrowserOAuth) {
  await expect(page.getByRole('heading', { name: 'Connect to KCAL' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow access', exact: true }).tap();
  await page.waitForURL((url) => url.pathname === '/oauth-callback');
  const callback = new URL(page.url());
  expect(callback.searchParams.get('state')).toBe(oauth.stateValue);
  return callback.searchParams.get('code')!;
}

export async function approveOAuth(page: Page, oauth: BrowserOAuth) {
  const code = await consentCode(page, oauth);
  expect(await auth(oauth, { serverUrl: RESOURCE, authorizationCode: code })).toBe('AUTHORIZED');
  return code;
}

export async function connectMcp(page: Page, oauth = new BrowserOAuth()) {
  await beginOAuth(page, oauth);
  const code = await approveOAuth(page, oauth);
  const mcp = new Client({ name: 'kcal-e2e', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(RESOURCE), { authProvider: oauth }));
  // Cache advertised output schemas so the SDK validates subsequent tool results.
  await mcp.listTools();
  return { mcp, oauth, code };
}

export function clientForm(oauth: BrowserOAuth): Record<string, string> {
  return {
    client_id: oauth.info!.client_id,
    ...(oauth.info?.client_secret ? { client_secret: oauth.info.client_secret } : {}),
  };
}
