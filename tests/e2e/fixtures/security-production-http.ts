// Import the actual entry point and middleware stack. The only listen override
// replaces its configured port with an ephemeral loopback port in this child.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import express from 'express';

let server: http.Server | undefined;
let listening: Promise<unknown> | undefined;
const originalListen = express.application.listen;
express.application.listen = function (this: express.Application, ...args: unknown[]) {
  const callback = args.at(-1);
  const listenerArgs: unknown[] = [0, '127.0.0.1'];
  if (typeof callback === 'function') listenerArgs.push(callback);
  const created = Reflect.apply(originalListen, this, listenerArgs) as http.Server;
  assert.equal(server, undefined, 'Only the application listener is expected');
  server = created;
  listening = once(created, 'listening');
  return created;
} as typeof originalListen;

// Undici fetch below is permitted only for the selected loopback origin.
// Block legacy HTTP clients too, before importing email/Postmark/app modules.
for (const transport of [http, https]) {
  transport.request = transport.get = () => { throw new Error('Unexpected network transport in production HTTP fixture'); };
}
syncBuiltinESMExports();
const localFetch = globalThis.fetch;
let allowedOrigin = '';
let externalRequests = 0;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).origin !== allowedOrigin) {
    externalRequests++;
    throw new Error('External request blocked in production HTTP fixture');
  }
  return localFetch(request);
};

type HttpResult = { status: number; headers: Record<string, string>; body: string };
let database: { close(): void } | undefined;
try {
  await import('../../../server/index.js');
  assert.ok(server !== undefined && listening !== undefined);
  await listening;
  const running = server as http.Server;
  const address = running.address();
  assert.ok(address !== null && typeof address !== 'string');
  allowedOrigin = `http://127.0.0.1:${address.port}`;
  const { db } = await import('../../../server/db.js');
  database = db;
  const { createSession, issueLoginCode } = await import('../../../server/auth.js');
  const { statements } = await import('../../../server/statements.js');
  const email = 'private-debug-user@example.test';
  const inserted = db.prepare('INSERT INTO users (email, created_at) VALUES (?, ?)').run(email, Date.now());
  const token = createSession(Number(inserted.lastInsertRowid)).token;
  const auth = { Authorization: `Bearer ${token}` };
  const request = async (path: string, init?: RequestInit, omitBody = false): Promise<HttpResult> => {
    const response = await fetch(allowedOrigin + path, { ...init, redirect: 'error' });
    const body = await response.text();
    return { status: response.status, headers: Object.fromEntries(response.headers), body: omitBody ? '' : body };
  };
  const debug = await request('/debug');
  const errors = {
    json: await request('/auth/verify-code?token=private-query-marker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"private-parser-marker"' }),
    oversized: await request('/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ padding: 'x'.repeat(5 * 1024) }) }),
    unauthorized: await request('/settings/private-path-marker?token=private-query-marker', { headers: { Authorization: 'Bearer private-header-marker' } }),
    missing: await request('/auth/private-path-marker'),
    mixedCaseMissing: await request('/AuTh/private-path-marker'),
  };
  const code = issueLoginCode(email).code;
  const credential = await request('/auth/verify-code', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }),
  }, true); // Never serialize the returned live fixture bearer into test output.
  const sensitive = {
    credential,
    settings: await request('/settings', { headers: auth }),
    entries: await request('/entries?date=2026-10-27', { headers: auth }),
    products: await request('/products/all', { headers: auth }),
    weights: await request('/weights', { headers: auth }),
  };
  const html = await request('/');
  const assetPath = html.body.match(/(?:src|href)="(\/assets\/[^" ]+\.js)"/)?.[1];
  assert.ok(assetPath !== undefined, 'The production build must exist before this fixture runs');
  const staticResponses = { html, asset: await request(assetPath, undefined, true), worker: await request('/sw.js') };
  // Simulate a non-domain failure in the existing GET /settings path rather than
  // exposing an artificial public throw route or cloning the app error handler.
  const statement = statements.goalHistory.latest;
  const originalGet = statement.get;
  statement.get = () => { throw new Error(`credential=${process.env.SECURITY_DETAIL ?? 'fixture-private-detail'}`); };
  let unexpected: HttpResult;
  try { unexpected = await request('/settings', { headers: auth }); }
  finally { statement.get = originalGet; }
  const recovered = await request('/settings', { headers: auth });
  process.stdout.write('SECURITY_RESULT ' + JSON.stringify({ debug, errors, sensitive,
    static: staticResponses, unexpected, recovered, externalRequests }) + '\n');
} finally {
  express.application.listen = originalListen;
  if (server !== undefined) {
    const running = server as http.Server;
    running.closeAllConnections();
    await new Promise<void>((resolve, reject) => running.close(error => error ? reject(error) : resolve()));
  }
  database?.close();
}
