// Minimal structured logger. ISO-timestamped, level-filtered, optionally
// ANSI-coloured (suppressed when stdout is not a TTY). Serialises an optional
// context object as trailing JSON. No dependencies — chalk would pull in a
// whole tree for what's ~10 escape codes.

import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from './env.js';
import type { LogLevel } from './types.js';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const COLOURS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
};

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const threshold = LEVEL_ORDER[env.LOG_LEVEL];
const useColour = process.stdout.isTTY === true;

function write(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const ts = new Date().toISOString();
  const levelTag = level.toUpperCase().padEnd(5);
  const ctxStr = ctx === undefined ? '' : ' ' + JSON.stringify(ctx);
  const line = useColour
    ? `${DIM}${ts}${RESET} ${COLOURS[level]}${levelTag}${RESET} ${msg}${ctxStr}`
    : `${ts} ${levelTag} ${msg}${ctxStr}`;
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

function debug(msg: string, ctx?: Record<string, unknown>): void {
  write('debug', msg, ctx);
}

function info(msg: string, ctx?: Record<string, unknown>): void {
  write('info', msg, ctx);
}

function warn(msg: string, ctx?: Record<string, unknown>): void {
  write('warn', msg, ctx);
}

function error(msg: string, ctx?: Record<string, unknown>): void {
  write('error', msg, ctx);
}

// Short stable hash of an email address — safe to log without leaking PII.
function emailHash(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 8);
}

// Logs a "request" line with { method, path, status, ms } on response finish.
// Uses req.path (not originalUrl) to keep query-string secrets out of logs.
const requestLogger: RequestHandler = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level: LogLevel =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    write(level, 'request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms,
    });
  });
  next();
};

export const log = { debug, info, warn, error, emailHash, requestLogger };
