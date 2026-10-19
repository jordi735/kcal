// Run only as an isolated child process with DATABASE_PATH=:memory:.
// Count actual prepared-statement execution around the public MCP read.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {} from '../../../server/auth.js';
import { db } from '../../../server/db.js';
import { createServer } from '../../../server/mcp/server.js';
import { statements } from '../../../server/statements.js';
import { createEntry, createProduct } from '../../../server/writes.js';
import type { McpSummaryResult } from '../../../shared/types.js';

assert.equal(process.env.DATABASE_PATH, ':memory:');
db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('summary-count@test.local');
const product = createProduct(1, {
  name: 'Query counting food', brand: null, barcode: null, unit: 'g', is_temp: false,
  per100: { kcal: 100, protein: 10, carbs: 20, fat: 5 },
});
createEntry(1, { product_id: product.id, grams: 100, local_date: '2024-02-29', local_time: '12:00' });
db.prepare('INSERT INTO goal_history VALUES (1, ?, 2000, 100, 200, 60, 0)').run('2024-02-29');

const counts = { aggregate: 0, history: 0 };
const aggregateAll = statements.entries.weekSum.all.bind(statements.entries.weekSum);
statements.entries.weekSum.all = (...args: unknown[]) => {
  counts.aggregate += 1;
  return aggregateAll(...args);
};
const historyAll = statements.goalHistory.all.all.bind(statements.goalHistory.all);
statements.goalHistory.all.all = (...args: unknown[]) => {
  counts.history += 1;
  return historyAll(...args);
};

const server = createServer(1, ['kcal:read']);
const client = new Client({ name: 'summary-query-count', version: '1' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: 'get_summary', arguments: { start_date: '2024-02-28', end_date: '2024-03-01' },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const summary = result.structuredContent as McpSummaryResult;
  assert.equal(summary.days_logged, 1);
  assert.equal(summary.goal_comparison.days_compared, 1);
  assert.deepEqual(summary.goal_comparison.logged_totals, { kcal: 100, protein: 10, carbs: 20, fat: 5 });
  process.stdout.write(JSON.stringify(counts));
} finally {
  await client.close();
  await server.close();
  db.close();
}
