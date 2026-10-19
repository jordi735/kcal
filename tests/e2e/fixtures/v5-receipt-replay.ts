import '../../../server/env.js';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type {} from '../../../server/auth.js';
import { db } from '../../../server/db.js';
import { log } from '../../../server/log.js';
import { createServer } from '../../../server/mcp/server.js';
import type { EntryGroup, McpProductCreateResult, Product } from '../../../shared/types.js';
import captured from './v4-creation-receipts.json' with { type: 'json' };
import arithmetic from './quality-legacy-entry-receipt.json' with { type: 'json' };

type Capture = {
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  receipt: { tool_name: string; request_hash: string; result_json: string; applied_at: number; schema_version: number };
};
const captures: Capture[] = captured.captures;
const phase = process.env.RECEIPT_TEST_PHASE;
assert.ok(phase === 'create' || phase === 'replay');
const insertReceipt = db.prepare(`INSERT INTO mcp_creation_receipts
  (user_id, idempotency_key, tool_name, request_hash, result_json, applied_at, schema_version)
  VALUES (1, ?, ?, ?, ?, ?, ?)`);
if (phase === 'create') {
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('v5-replay@test.local');
  for (const capture of captures) {
    const receipt = capture.receipt;
    insertReceipt.run(capture.input.idempotency_key, receipt.tool_name, receipt.request_hash,
      receipt.result_json, receipt.applied_at, receipt.schema_version);
  }
  insertReceipt.run(arithmetic.input.idempotency_key, 'create_entries', arithmetic.receipt.request_hash,
    JSON.stringify(arithmetic.result), arithmetic.receipt.applied_at, arithmetic.receipt.schema_version);

  // Materialize the original resources, then edit and delete them through MCP.
  // Replay must keep working after both operations and after process restart.
  const product = captures[0]!.result.product as Product;
  db.prepare(`INSERT INTO products (id, created_by, name, brand, unit, barcode, kcal_per100,
    protein_per100, carbs_per100, fat_per100, is_temp, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`)
    .run(product.id, product.name, product.brand, product.unit, product.barcode,
      product.per100.kcal, product.per100.protein, product.per100.carbs, product.per100.fat);
  for (const capture of captures.slice(1)) {
    const group = capture.result.group as EntryGroup;
    db.prepare('INSERT INTO entry_groups (id, user_id, local_date, name, created_at) VALUES (?, 1, ?, ?, 0)')
      .run(group.id, group.local_date, group.name);
    const entries = capture.result.entries as Array<{ id: number; grams: number; local_date: string; local_time: string }>;
    for (const entry of entries) db.prepare(`INSERT INTO entries
      (id, user_id, product_id, amount, local_date, local_time, created_at, group_id)
      VALUES (?, 1, 1, ?, ?, ?, 0, ?)`)
      .run(entry.id, entry.grams, entry.local_date, entry.local_time, group.id);
  }
}

const messages: string[] = [];
log.info = (message) => { messages.push(message); };
const server = createServer(1, ['kcal:read', 'kcal:write']);
const client = new Client({ name: 'v5-receipt-replay', version: '1' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
function currentInput(capture: Capture): Record<string, unknown> {
  if (capture.receipt.tool_name !== 'create_entries') return capture.input;
  return { ...capture.input, entries: (capture.input.entries as Array<{ product_id: number; grams: number }>)
    .map(({ grams, ...entry }) => ({ ...entry, amount: grams })) };
}
function expectedResult(original: Record<string, unknown>): Record<string, unknown> {
  const expected = structuredClone(original);
  if (Array.isArray(expected.entries)) expected.entries = (expected.entries as Array<Record<string, unknown>>)
    .map(({ grams, ...entry }) => ({ ...entry, amount: grams }));
  expected.receipt = { ...(expected.receipt as Record<string, unknown>), replayed: true };
  return expected;
}
function receiptRows() {
  return db.prepare('SELECT * FROM mcp_creation_receipts ORDER BY idempotency_key').all();
}
function resources() {
  return ['products', 'entries', 'entry_groups'].map((table) =>
    db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
}
async function call(name: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: input });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  assert.ok(result.structuredContent);
  return result.structuredContent as Record<string, unknown>;
}
async function reject(name: string, input: Record<string, unknown>, error: string) {
  const result = await client.callTool({ name, arguments: input });
  assert.equal(result.isError, true);
  assert.ok(JSON.stringify(result.content).includes(error), JSON.stringify(result));
}
async function replayAll() {
  const before = receiptRows();
  const counts = resources();
  messages.length = 0;
  for (const capture of captures) {
    assert.deepEqual(await call(capture.receipt.tool_name, currentInput(capture)), expectedResult(capture.result));
  }
  const old = await call('create_entries', {
    ...arithmetic.input,
    entries: arithmetic.input.entries.map(({ grams, ...entry }) => ({ ...entry, amount: grams })),
  });
  assert.deepEqual(old, expectedResult(arithmetic.result));
  assert.equal((old.totals as { kcal: number }).kcal, 14.499999999999998);
  assert.deepEqual(messages, Array<string>(4).fill('MCP creation replayed'));
  assert.deepEqual(receiptRows(), before, 'Replay must not rewrite any stored receipt column');
  assert.deepEqual(resources(), counts, 'Replay must not recreate deleted resources');
}

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  await replayAll();
  if (phase === 'create') {
    const productCapture = captures[0]!;
    const batchCapture = captures[1]!;
    const groupCapture = captures[2]!;
    assert.deepEqual(await call('create_product', {
      ...productCapture.input, name: 'Original drink', brand: 'Test Brand', barcode: '0012345000987',
    }), expectedResult(productCapture.result));
    assert.deepEqual(await call('create_entry_group', {
      ...groupCapture.input, name: 'Morning and evening', entry_ids: [3, 4],
    }), expectedResult(groupCapture.result));
    assert.deepEqual(await call('create_entries', {
      ...currentInput(batchCapture), group_name: 'Original batch',
    }), expectedResult(batchCapture.result));
    const beforeConflicts = receiptRows();
    await reject('create_entries', {
      ...currentInput(batchCapture), entries: [{ product_id: 1, amount: 30 }, { product_id: 1, amount: 71.5 }],
    }, 'idempotency_key_conflict');
    await reject('create_product', { ...productCapture.input, name: 'Different food' }, 'idempotency_key_conflict');
    await reject('create_entry_group', { ...groupCapture.input, entry_ids: [1, 2] }, 'idempotency_key_conflict');
    await reject('create_product', { ...productCapture.input, idempotency_key: batchCapture.input.idempotency_key }, 'idempotency_key_conflict');
    assert.deepEqual(receiptRows(), beforeConflicts);
    await call('update_product', { product_id: 1, per100: { kcal: 900 } });
    await call('update_entry', { entry_id: 1, amount: 200 });
    await replayAll();
    await call('delete_product', { product_id: 1 });
    assert.deepEqual(resources(), [0, 0, 0]);
    await replayAll();
    for (const corruption of [
      { result_json: '{broken', schema_version: 4 },
      { result_json: '{}', schema_version: 4 },
      { result_json: batchCapture.receipt.result_json, schema_version: 99 },
    ]) {
      db.prepare('UPDATE mcp_creation_receipts SET result_json = ?, schema_version = ? WHERE idempotency_key = ?')
        .run(corruption.result_json, corruption.schema_version, batchCapture.input.idempotency_key);
      await reject('create_entries', currentInput(batchCapture), 'idempotency_replay_unavailable');
      assert.deepEqual(resources(), [0, 0, 0]);
    }
    db.prepare('UPDATE mcp_creation_receipts SET result_json = ?, schema_version = ? WHERE idempotency_key = ?')
      .run(batchCapture.receipt.result_json, 4, batchCapture.input.idempotency_key);

    const newProduct = await call('create_product', {
      idempotency_key: 'v5-created-product', name: 'New receipt', unit: 'g',
      per100: { kcal: 50, protein: 10, carbs: 20, fat: 5 },
    }) as unknown as McpProductCreateResult;
    const input = {
      idempotency_key: 'v5-created-entries', entries: [{ product_id: newProduct.product.id, amount: 29 }],
      local_date: '2024-02-29', local_time: '10:30',
    };
    const created = await call('create_entries', input);
    const saved = db.prepare<[string], { schema_version: number; result_json: string }>(
      'SELECT schema_version, result_json FROM mcp_creation_receipts WHERE idempotency_key = ?',
    ).get(input.idempotency_key)!;
    assert.equal(saved.schema_version, 5);
    assert.ok(saved.result_json.includes('"amount":29'));
    assert.ok(!saved.result_json.includes('"grams"'));
    assert.deepEqual(await call('create_entries', input), {
      ...created, receipt: { ...(created.receipt as Record<string, unknown>), replayed: true },
    });
    await call('delete_product', { product_id: newProduct.product.id });
    assert.deepEqual(resources(), [0, 0, 0]);
  } else {
    assert.deepEqual(resources(), [0, 0, 0]);
    const newReceipt = db.prepare<[string], { result_json: string }>(
      'SELECT result_json FROM mcp_creation_receipts WHERE idempotency_key = ?',
    ).get('v5-created-entries')!;
    const original = JSON.parse(newReceipt.result_json) as { entries: Array<{ product: { id: number } }>; receipt: Record<string, unknown> };
    assert.deepEqual(await call('create_entries', {
      idempotency_key: 'v5-created-entries', entries: [{ product_id: original.entries[0]!.product.id, amount: 29 }],
      local_date: '2024-02-29', local_time: '10:30',
    }), { ...original, receipt: { ...original.receipt, replayed: true } });
    assert.deepEqual(resources(), [0, 0, 0]);
  }
} finally {
  await client.close();
  await server.close();
  db.close();
}
process.stdout.write('v5-replay-ok');
