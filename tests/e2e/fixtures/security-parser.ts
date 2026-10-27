// One bounded request to an ephemeral loopback server; no app runtime or DB.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import express from 'express';
import type { ErrorRequestHandler } from 'express';

const app = express();
// Exercise the dependency fix even though kcal additionally disables inflation.
app.use(express.json({ limit: '64kb' }));
app.use((_req, res) => { res.status(401).end(); });
const reject: ErrorRequestHandler = (_error, _req, res, _next) => { res.status(400).end(); };
app.use(reject);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert(address !== null && typeof address !== 'string');
const body = Buffer.concat([gzipSync('{"a":1}'), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
try {
  await new Promise<void>((resolve, rejectRequest) => {
    const request = http.request({
      hostname: '127.0.0.1', port: address.port, method: 'POST', agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length },
    }, (response) => {
      response.resume();
      response.once('end', resolve);
      response.once('error', rejectRequest);
    });
    request.once('error', rejectRequest);
    request.setTimeout(2000, () => request.destroy(new Error('Local parser fixture timed out')));
    request.end(body);
  });
  // The regression emits a decoder error after middleware and response finish.
  // Leave Node's fatal-error behavior intact during this bounded observation.
  await new Promise<void>((resolve) => setTimeout(resolve, 400));
  process.stdout.write(JSON.stringify({ survived: true }));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, rejectClose) => server.close((error) => error ? rejectClose(error) : resolve()));
}
