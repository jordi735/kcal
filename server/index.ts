// Express app + middleware chain. No CORS (Vite proxies in dev; same-origin in prod).

// IMPORTANT: env validation must run before any module that reads process.env.
import { env } from './env.js';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { authRouter } from './routes/auth.js';
import { settingsRouter } from './routes/settings.js';
import { productsRouter } from './routes/products.js';
import { entriesRouter } from './routes/entries.js';
import { log } from './log.js';

const app = express();

app.use(express.json({ limit: '2mb' }));
app.use(log.requestLogger);

app.use('/auth', authRouter);
app.use('/settings', settingsRouter);
app.use('/products', productsRouter);
app.use('/entries', entriesRouter);

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
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error('port already in use — exiting', { port: env.PORT });
  } else {
    log.error('fatal server error', { code: err.code, message: err.message });
  }
  process.exit(1);
});
