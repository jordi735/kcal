// Exercise the real entry point on an ephemeral port without replacing its
// configured host. The bounded parent runner owns this finite child process.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';

export type BindingResult = { address: string; family: string; status: number };

const originalListen = express.application.listen;
let server: http.Server | undefined;
let listening: Promise<unknown> | undefined;
express.application.listen = function (this: express.Application, ...args: unknown[]) {
  const options = args[0];
  args[0] = typeof options === 'object' && options !== null ? { ...options, port: 0 } : 0;
  const created = Reflect.apply(originalListen, this, args) as http.Server;
  assert.equal(server, undefined, 'Only the application listener is expected');
  server = created;
  listening = once(created, 'listening');
  return created;
} as typeof originalListen;

let database: { close(): void } | undefined;
try {
  await import('../../../server/index.js');
  assert.ok(server !== undefined && listening !== undefined);
  await listening;
  const running = server as http.Server;
  const address = running.address();
  assert.ok(address !== null && typeof address !== 'string');
  const { db } = await import('../../../server/db.js');
  database = db;
  const host = address.address === '::1' ? '[::1]' : '127.0.0.1';
  const response = await fetch(`http://${host}:${address.port}/settings`);
  await response.text();
  const result: BindingResult = { address: address.address, family: address.family, status: response.status };
  process.stdout.write('SECURITY_BINDING ' + JSON.stringify(result) + '\n');
} finally {
  express.application.listen = originalListen;
  if (server !== undefined) {
    const running = server as http.Server;
    running.closeAllConnections();
    await new Promise<void>((resolve, reject) => running.close(error => error ? reject(error) : resolve()));
  }
  database?.close();
}
