import '../../../server/env.js';
import assert from 'node:assert/strict';
import express from 'express';
import { mcpRouter } from '../../../server/routes/mcp.js';

const app = express();
app.use(express.json());
app.use('/mcp', mcpRouter);
const server = app.listen(0, '127.0.0.1', () => {
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  process.stdout.write(String(address.port) + '\n');
});
