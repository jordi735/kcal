// Real Express entry point, with only its listener changed to an ephemeral
// loopback port. The parent owns readiness, bounded lifetime and termination.
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import express from 'express';

export type CspServerReady = { origin: string };

for (const transport of [http, https]) {
  transport.request = transport.get = () => { throw new Error('External HTTP blocked in CSP fixture'); };
}
syncBuiltinESMExports();
globalThis.fetch = async () => { throw new Error('External fetch blocked in CSP fixture'); };

const originalListen = express.application.listen;
let server: http.Server | undefined;
let listening: Promise<unknown> | undefined;
express.application.listen = function (this: express.Application, ...args: unknown[]) {
  const callback = args.at(-1);
  const listenArgs: unknown[] = [0, '127.0.0.1'];
  if (typeof callback === 'function') listenArgs.push(callback);
  const created = Reflect.apply(originalListen, this, listenArgs) as http.Server;
  assert.equal(server, undefined);
  server = created;
  listening = once(created, 'listening');
  return created;
} as typeof originalListen;

try { await import('../../../server/index.js'); }
finally { express.application.listen = originalListen; }
assert.ok(server !== undefined && listening !== undefined);
await listening;
const running = server as http.Server;
const address = running.address();
assert.ok(address !== null && typeof address !== 'string');
const { db } = await import('../../../server/db.js');
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  running.closeAllConnections();
  await new Promise<void>((resolve, reject) => running.close(error => error ? reject(error) : resolve()));
  db.close();
};
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void shutdown().then(() => process.exit(0), () => process.exit(1)); });
}
const ready: CspServerReady = { origin: `http://127.0.0.1:${address.port}` };
process.stdout.write('CSP_READY ' + JSON.stringify(ready) + '\n');
