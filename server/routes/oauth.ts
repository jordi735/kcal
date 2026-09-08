import { Router } from 'express';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { authMiddleware } from '../auth.js';
import { env } from '../env.js';
import { isObject } from '../guards.js';
import { MCP_RESOURCE, MCP_SCOPE, oauthProvider, pendingConsent, decideConsent } from '../oauth.js';
import { statements } from '../statements.js';
import type { OAuthConsent, OAuthDecision } from '../types.js';

export const oauthRouter: Router = Router();

if (env.PUBLIC_ORIGIN) {
  // SDK token parsing checks strings; additionally enforce RFC 7636's verifier
  // length/alphabet before its PKCE comparison. No credentials in error text.
  oauthRouter.use('/token', (req, res, next) => {
    if (req.body?.grant_type === 'authorization_code'
      && (typeof req.body.code_verifier !== 'string'
        || !/^[A-Za-z0-9._~-]{43,128}$/.test(req.body.code_verifier))) {
      res.status(400).json({ error: 'invalid_request', error_description: 'Invalid PKCE verifier' });
      return;
    }
    next();
  });
  oauthRouter.use(mcpAuthRouter({
    provider: oauthProvider, issuerUrl: new URL(env.PUBLIC_ORIGIN),
    resourceServerUrl: new URL(MCP_RESOURCE), scopesSupported: [MCP_SCOPE], resourceName: 'KCAL',
    clientRegistrationOptions: {
      clientSecretExpirySeconds: 0, clientIdGeneration: false,
      ...(env.TEST_MODE ? { rateLimit: { max: 1000 } } : {}),
    },
    // Production retains the SDK's rate limits. Tests exercise many failed flows
    // against one loopback IP in the disposable TEST_MODE backend.
    ...(env.TEST_MODE ? {
      authorizationOptions: { rateLimit: { max: 1000 } },
      tokenOptions: { rateLimit: { max: 1000 } },
      revocationOptions: { rateLimit: { max: 1000 } },
    } : {}),
  }));

  oauthRouter.use('/oauth/consent', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.get('origin');
    if ((req.method !== 'GET' || origin !== undefined) && origin !== env.PUBLIC_ORIGIN) {
      res.status(403).json({ error: 'origin_not_allowed' });
      return;
    }
    next();
  }, authMiddleware);

  oauthRouter.get('/oauth/consent', async (req, res) => {
    try {
      const request = pendingConsent(req, typeof req.query.request === 'string' ? req.query.request : '');
      const client = await oauthProvider.clientsStore.getClient(request.client_id);
      const user = statements.users.selectEmailById.get(req.userId!) as { email: string };
      const result: OAuthConsent = {
        client_name: client?.client_name ?? 'MCP client',
        redirect_host: new URL(request.redirect_uri).host, email: user.email,
      };
      res.json(result);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      res.status(400).json({ error: error.message });
    }
  });

  oauthRouter.post('/oauth/consent', (req, res) => {
    if (!isObject(req.body) || typeof req.body.request !== 'string' || typeof req.body.allow !== 'boolean') {
      res.status(400).json({ error: 'invalid_request' });
      return;
    }
    try {
      const result: OAuthDecision = { redirect_url: decideConsent(req, req.body.request, req.body.allow) };
      res.json(result);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      res.status(400).json({ error: error.message });
    }
  });
}
