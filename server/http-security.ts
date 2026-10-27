// Early response policy and safe terminal errors shared by the real server.
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isApiPath } from '../shared/apiPrefixes.js';
import { log } from './log.js';

export const commonSecurityHeaders: RequestHandler = (req, res, next) => {
  // Default every response to private. Successful static serving explicitly
  // replaces this with its asset, HTML or service-worker cache policy.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  if (isApiPath(req.path.toLowerCase())) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
};

const parserErrors: Readonly<Record<string, { status: number; message: string }>> = {
  'entity.parse.failed': { status: 400, message: 'invalid_json' },
  'entity.too.large': { status: 413, message: 'request_too_large' },
  'parameters.too.many': { status: 413, message: 'request_too_large' },
  'encoding.unsupported': { status: 415, message: 'unsupported_encoding' },
  'charset.unsupported': { status: 415, message: 'unsupported_charset' },
  'entity.verify.failed': { status: 403, message: 'invalid_request' },
  'request.aborted': { status: 400, message: 'invalid_request' },
  'request.size.invalid': { status: 400, message: 'invalid_request' },
};

export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, next) => {
  if (res.headersSent) {
    log.error('unhandled after headers sent');
    // Express must close the response, but its fallback logger must not receive
    // the original exception, which can include credentials or request data.
    next(new Error('internal_error'));
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  const error = (typeof err === 'object' && err !== null ? err : {}) as Record<string, unknown>;
  const parser = typeof error.type === 'string' && Object.hasOwn(parserErrors, error.type)
    ? parserErrors[error.type] : undefined;
  if (parser !== undefined) {
    log.warn('request body rejected', { status: parser.status });
    res.status(parser.status).json({ error: parser.message });
    return;
  }
  // Expected client failures from Express/static serving retain their status,
  // but never their possibly sensitive free-form messages or filesystem paths.
  const status = typeof error.status === 'number' && Number.isInteger(error.status)
    && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status < 500) log.warn('request rejected', { status });
  else log.error('unhandled request error');
  res.status(status).json({ error: status === 500 ? 'internal_error' : status === 404 ? 'not found' : 'invalid_request' });
};
