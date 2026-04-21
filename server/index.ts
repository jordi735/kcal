// Express app + middleware chain. No CORS (Vite proxies in dev; same-origin in prod).

// IMPORTANT: env validation must run before any module that reads process.env.
import { env } from './env.js';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth.js';
import { settingsRouter } from './routes/settings.js';
import { productsRouter } from './routes/products.js';
import { entriesRouter } from './routes/entries.js';
import { debugRouter } from './routes/debug.js';
import { probeClaude } from './claude.js';
import { log } from './log.js';
import { isApiPath } from '../shared/apiPrefixes.js';

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(log.requestLogger);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use((req, res, next) => {
  if (isApiPath(req.path)) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

app.use('/auth', authRouter);
app.use('/settings', settingsRouter);
app.use('/products', productsRouter);
app.use('/entries', entriesRouter);
app.use('/debug', debugRouter);

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

app.use(
  express.static(distDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (filePath.endsWith(`${path.sep}sw.js`)) {
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
  if (isApiPath(req.path)) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  res.sendFile(path.join(distDir, 'index.html'));
});

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    log.error('unhandled (after headers sent)', {
      message: err instanceof Error ? err.message : String(err),
    });
    next(err);
    return;
  }
  const obj = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
  const status = typeof obj.status === 'number' ? obj.status : 500;
  const message = typeof obj.message === 'string' ? obj.message : 'internal';
  log.error('unhandled', {
    status,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(status).json({ error: message });
};

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  log.info('server started', { port: env.PORT, url: `http://localhost:${env.PORT}` });
  void probeClaude();
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error('port already in use — exiting', { port: env.PORT });
  } else {
    log.error('fatal server error', { code: err.code, message: err.message });
  }
  process.exit(1);
});
