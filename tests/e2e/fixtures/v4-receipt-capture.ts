// Historical capture program: run only against the unchanged v4 implementation.
// Its frozen JSON output is replayed by the v5 compatibility regression.
import '../../../server/env.js';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {} from '../../../server/auth.js';
import { db } from '../../../server/db.js';
import { createServer } from '../../../server/mcp/server.js';

const output = process.env.V4_RECEIPT_OUTPUT;
assert.ok(output, 'V4_RECEIPT_OUTPUT must name the capture output file');
Date.now = () => Date.parse('2024-02-29T20:00:00.000Z');
db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('v4-capture@test.local');
const server = createServer(1, ['kcal:read', 'kcal:write']);
const client = new Client({ name: 'v4-receipt-capture', version: '1' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
type SavedReceipt = {
  tool_name: string; request_hash: string; result_json: string; applied_at: number; schema_version: number;
};
const captures: Array<{ input: Record<string, unknown>; result: Record<string, unknown>; receipt: SavedReceipt }> = [];
async function capture(tool: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await client.callTool({ name: tool, arguments: input });
  assert.equal(response.isError, undefined);
  assert.ok(response.structuredContent);
  const receipt = db.prepare<[string], SavedReceipt>(
    'SELECT tool_name, request_hash, result_json, applied_at, schema_version FROM mcp_creation_receipts WHERE idempotency_key = ?',
  ).get(String(input.idempotency_key));
  assert.ok(receipt);
  assert.equal(receipt.schema_version, 4);
  assert.deepEqual(JSON.parse(receipt.result_json), response.structuredContent);
  const result = response.structuredContent as Record<string, unknown>;
  captures.push({ input, result, receipt });
  return result;
}

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  const createEntriesTool = tools.tools.find((tool) => tool.name === 'create_entries');
  assert.ok(createEntriesTool);
  assert.match(JSON.stringify(createEntriesTool.inputSchema), /"grams"/,
    'Capture must run against the unchanged v4 entry contract');
  await capture('create_product', {
    idempotency_key: 'v4-captured-product', name: '  Original   drink  ', brand: '  Test   Brand ',
    barcode: ' 0012345000987 ', unit: 'ml',
    per100: { kcal: 50, protein: 10, carbs: 20, fat: 5 },
  });
  const batch = await capture('create_entries', {
    idempotency_key: 'v4-captured-batch', local_date: '2024-02-29', local_time: '12:15',
    entries: [{ product_id: 1, grams: 29 }, { product_id: 1, grams: 71.5 }],
    group_name: '  Original   batch  ',
  });
  assert.deepEqual((batch.entries as Array<{ grams: number }>).map((entry) => entry.grams), [29, 71.5]);
  assert.equal((batch.entries as Array<{ macros: { kcal: number } }>)[0]?.macros.kcal, 14.5);
  const insert = db.prepare('INSERT INTO entries (user_id, product_id, grams, local_date, local_time, created_at) VALUES (1, 1, ?, ?, ?, ?)');
  insert.run(20, '2024-02-29', '08:00', Date.now());
  insert.run(40, '2024-02-29', '19:30', Date.now());
  const group = await capture('create_entry_group', {
    idempotency_key: 'v4-captured-group', name: '  Morning   and evening  ', entry_ids: [4, 3],
  });
  const children = group.entries as Array<{ id: number; local_time: string }>;
  assert.deepEqual(children.map((entry) => entry.id), [3, 4]);
  assert.deepEqual(children.map((entry) => entry.local_time), ['08:00', '19:30']);
  writeFileSync(output, `${JSON.stringify({ source_commit: '381128f', captures }, null, 2)}\n`);
} finally {
  await client.close();
  await server.close();
  db.close();
}
process.stdout.write('v4-capture-ok');
