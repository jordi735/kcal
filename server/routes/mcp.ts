// Account-scoped MCP tools. OAuth resolves the owner and granted permissions.

import { Router } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { env } from '../env.js';
import { MCP_SCOPE, oauthProvider } from '../oauth.js';
import { log } from '../log.js';
import { createServer } from '../mcp/server.js';

export const mcpRouter: Router = Router();

mcpRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!env.PUBLIC_ORIGIN) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // ChatGPT/Codex make server/native MCP calls. Browser login uses OAuth routes.
  if (req.get('origin') !== undefined) {
    res.status(403).json({ error: 'origin_not_allowed' });
    return;
  }
  next();
});

mcpRouter.use(requireBearerAuth({
  verifier: oauthProvider, requiredScopes: [MCP_SCOPE],
  resourceMetadataUrl: `${env.PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp`,
}));

mcpRouter.post('/', async (req, res) => {
  const userId = req.auth?.extra?.userId;
  if (typeof userId !== 'number') {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const server = createServer(userId, req.auth?.scopes ?? []);
  const transport = new StreamableHTTPServerTransport({
    // Omit the session ID generator for stateless operation.
    enableJsonResponse: true,
  });
  // Attach before handling: JSON responses may finish during handleRequest.
  res.once('close', () => {
    void server.close().catch(() => log.error('MCP transport cleanup failed'));
  });
  try {
    // SDK callback setters accept undefined, unlike its optional Transport
    // properties under exactOptionalPropertyTypes; the runtime contract matches.
    await server.connect(transport as Transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log.error('MCP request failed', { message: error instanceof Error ? error.message : String(error) });
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    }
  }
});

mcpRouter.all('/', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'method_not_allowed' });
});
