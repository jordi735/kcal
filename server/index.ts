// Express app + middleware chain. No CORS (Vite proxies in dev; same-origin in prod).

// IMPORTANT: env validation must run before any module that reads process.env.
import { env } from './env.js';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authIssueSourceLimiter, authRouter, authVerifySourceLimiter } from './routes/auth.js';
import { settingsRouter } from './routes/settings.js';
import { productsRouter } from './routes/products.js';
import { entriesRouter } from './routes/entries.js';
import { weightsRouter } from './routes/weights.js';
import { debugRouter } from './routes/debug.js';
import { mcpRouter } from './routes/mcp.js';
import { oauthRouter } from './routes/oauth.js';
import { log } from './log.js';
import { commonSecurityHeaders, errorHandler } from './http-security.js';
import { isApiPath } from '../shared/apiPrefixes.js';

const app = express();

app.set('trust proxy', env.TRUST_PROXY);

app.use(commonSecurityHeaders);
app.use(log.requestLogger);

// Reserve once before parsing: invalid bodies and downstream account/delivery
// failures still spend source quota. Routes separately reserve account quota.
app.post('/auth/request-code', authIssueSourceLimiter);
app.post('/auth/verify-code', authVerifySourceLimiter);
app.use(['/auth/request-code', '/auth/verify-code'], express.json({ limit: '4kb', inflate: false }));
app.use(['/register', '/authorize', '/token', '/revoke', '/oauth'],
  express.json({ limit: '16kb', inflate: false }),
  express.urlencoded({ extended: false, limit: '16kb', inflate: false }));
app.use(express.json({ limit: '64kb', inflate: false }));

app.use('/auth', authRouter);
app.use('/settings', settingsRouter);
app.use('/products', productsRouter);
app.use('/entries', entriesRouter);
app.use('/weights', weightsRouter);
app.use('/mcp', mcpRouter);
app.use(oauthRouter);

// /debug exposes raw user + product tables only outside production, behind an
// IP allowlist. Unauthorised callers get 404 (not 403) so the
// route's existence is not disclosed. The IPv6-mapped form `::ffff:1.2.3.4`
// strips back to its v4 representation before matching.
app.use('/debug', (req, res, next) => {
  const ip = (req.ip ?? '').replace(/^::ffff:/, '');
  if (env.APP_ENV === 'production' || !env.DEBUG_ALLOW_IPS.has(ip)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  next();
}, debugRouter);

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

app.use(
  express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (filePath.endsWith(`${path.sep}sw.js`) || filePath.endsWith(`${path.sep}index.html`)) {
        res.setHeader('Cache-Control', 'no-cache');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
    },
  }),
);

// Unknown API paths must not fall through to the SPA — otherwise a buggy
// fetch('/auth/typo') returns HTML and the client JSON-parses it.
app.use((req, res, next) => {
  if (isApiPath(req.path.toLowerCase())) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(distDir, 'index.html'));
});

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  log.info('server started', { port: env.PORT, url: `http://localhost:${env.PORT}` });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error('port already in use — exiting', { port: env.PORT });
  } else {
    log.error('fatal server error', {
      code: err.code === 'EACCES' || err.code === 'EADDRNOTAVAIL' ? err.code : 'other',
    });
  }
  process.exit(1);
});
