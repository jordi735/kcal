import '../../../server/env.js';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {} from '../../../server/auth.js';
import { db } from '../../../server/db.js';
import { log } from '../../../server/log.js';
import { createServer } from '../../../server/mcp/server.js';
import type { McpEntriesCreateResult, McpProductCreateResult } from '../../../shared/types.js';

const phase = process.env.RECEIPT_TEST_PHASE;
assert.ok(phase === 'create' || phase === 'replay');
if (phase === 'create') {
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('receipt@test.local');
}
const messages: string[] = [];
log.info = (message) => { messages.push(message); };
const server = createServer(1, ['kcal:read', 'kcal:write']);
const client = new Client({ name: 'receipt-test', version: '1' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

function count(table: 'products' | 'entries' | 'entry_groups' | 'mcp_creation_receipts'): number {
  const row = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  assert.ok(row);
  return row.n;
}

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  const input = {
    idempotency_key: 'restart-key', name: 'Restart food', unit: 'g',
    per100: { kcal: 200, protein: 10, carbs: 20, fat: 5 },
  };
  const result = await client.callTool({ name: 'create_product', arguments: input });
  assert.equal(result.isError, undefined);
  assert.ok(result.structuredContent);
  const created = result.structuredContent as McpProductCreateResult;
  assert.equal(created.receipt.replayed, phase !== 'create');
  assert.equal(count('products'), 1);
  if (phase === 'create') {
    assert.deepEqual(messages, ['MCP mutation committed']);
    db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(1e308, created.product.id);
    messages.length = 0;
    const failed = await client.callTool({ name: 'create_entries', arguments: {
      idempotency_key: 'failed-batch',
      entries: [{ product_id: created.product.id, amount: 1000 }, { product_id: created.product.id, amount: 1000 }],
      local_date: '2024-02-29', local_time: '12:00', group_name: 'Failed group',
    } });
    assert.equal(failed.isError, true);
    assert.deepEqual(messages, []);
    assert.equal(count('entries'), 0);
    assert.equal(count('entry_groups'), 0);
    assert.equal(count('mcp_creation_receipts'), 1);
    db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(200, created.product.id);
    db.exec("CREATE TRIGGER reject_test_receipt BEFORE INSERT ON mcp_creation_receipts WHEN NEW.idempotency_key = 'receipt-insert-failure' BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END");
    const batch = {
      idempotency_key: 'receipt-insert-failure',
      entries: [{ product_id: created.product.id, amount: 25 }, { product_id: created.product.id, amount: 75 }],
      local_date: '2024-02-29', local_time: '12:00', group_name: 'Receipt transaction',
    };
    const rejected = await client.callTool({ name: 'create_entries', arguments: batch });
    assert.equal(rejected.isError, true);
    assert.deepEqual(messages, []);
    assert.equal(count('entries'), 0);
    assert.equal(count('entry_groups'), 0);
    assert.equal(count('mcp_creation_receipts'), 1);
    db.exec('DROP TRIGGER reject_test_receipt');
    const retried = await client.callTool({ name: 'create_entries', arguments: batch });
    assert.equal(retried.isError, undefined);
    assert.ok(retried.structuredContent);
    const retriedBatch = retried.structuredContent as McpEntriesCreateResult;
    assert.equal(retriedBatch.receipt.replayed, false);
    assert.equal(retriedBatch.entries.length, 2);
    assert.equal(retriedBatch.group?.name, 'Receipt transaction');
    assert.deepEqual(messages, ['MCP mutation committed']);
    assert.equal(count('entries'), 2);
    assert.equal(count('entry_groups'), 1);
    assert.equal(count('mcp_creation_receipts'), 2);
    db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(1e308, created.product.id);
  } else {
    assert.deepEqual(messages, ['MCP creation replayed']);
    assert.equal(created.product.per100.kcal, 200);
    const stored = db.prepare<[number], { kcal: number }>('SELECT kcal_per100 AS kcal FROM products WHERE id = ?')
      .get(created.product.id);
    assert.ok(stored);
    assert.equal(stored.kcal, 1e308);
  }
} finally {
  await client.close();
  await server.close();
  db.close();
}
process.stdout.write('receipt-check-ok');
