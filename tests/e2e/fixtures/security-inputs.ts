// Isolated finite fixture: real REST/MCP/domain boundaries with an in-memory DB.
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { db } from '../../../server/db.js';
import { createSession } from '../../../server/auth.js';
import { entriesRouter } from '../../../server/routes/entries.js';
import { createServer } from '../../../server/mcp/server.js';
import { statements } from '../../../server/statements.js';
import {
  createProduct, createEntry, createEntryGroup, updateEntryGroup,
  setEntryGroupTagged, ungroupEntries, deleteEntryGroup,
} from '../../../server/writes.js';
import type { EntryGroup, McpEntryGroupCreateResult } from '../../../shared/types.js';

assert.equal(process.env.DATABASE_PATH, ':memory:');
db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('group-bounds@test.local');
const product = createProduct(1, {
  name: 'Group boundary food', brand: null, barcode: null, unit: 'g', is_temp: false,
  per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
});
const seed = (count: number, day: string): number[] => db.transaction(() => Array.from({ length: count }, () =>
  createEntry(1, { product_id: product.id, amount: 100, local_date: day, local_time: '12:00' }).id,
))();
const groupCount = () => (db.prepare('SELECT count(*) AS n FROM entry_groups').get() as { n: number }).n;
const receiptCount = () => (db.prepare('SELECT count(*) AS n FROM mcp_creation_receipts').get() as { n: number }).n;
const memberships = (ids: number[]) => ids.map((id) =>
  (db.prepare('SELECT group_id FROM entries WHERE id = ?').get(id) as { group_id: number | null }).group_id,
);

const app = express();
app.use(express.json({ limit: '64kb', inflate: false }));
app.use('/entries', entriesRouter);
const http = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  http.once('listening', resolve);
  http.once('error', reject);
});
const origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
const token = createSession(1).token;
const server = createServer(1, ['kcal:read', 'kcal:write']);
const client = new Client({ name: 'security-group-boundaries', version: '1' });
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

try {
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const restBoundaryIds = seed(1000, '2024-01-01');
  const accepted = await fetch(`${origin}/entries/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'REST boundary', entry_ids: restBoundaryIds }),
  });
  assert.equal(accepted.status, 201);
  const acceptedGroup = await accepted.json() as EntryGroup;
  assert.ok(memberships(restBoundaryIds).every((groupId) => groupId === acceptedGroup.id));

  const oversized = seed(1001, '2024-01-02');
  const beforeRest = groupCount();
  const rejected = await fetch(`${origin}/entries/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Too many members', entry_ids: oversized }),
  });
  assert.equal(rejected.status, 400, 'REST must reject 1001 members before creating a group');
  assert.deepEqual(await rejected.json(), { error: 'invalid_group' });
  assert.equal(groupCount(), beforeRest);
  assert.ok(memberships(oversized).every((id) => id === null));
  assert.throws(() => createEntryGroup(1, 'Direct domain boundary', oversized), /invalid_group/);
  assert.equal(groupCount(), beforeRest);

  const mcpBoundaryIds = seed(1000, '2024-01-03');
  const acceptedMcp = await client.callTool({ name: 'create_entry_group', arguments: {
    idempotency_key: 'boundary-group', name: 'MCP boundary', entry_ids: mcpBoundaryIds,
  } });
  assert.notEqual(acceptedMcp.isError, true, 'MCP must accept 1000 owned members');
  assert.equal((acceptedMcp.structuredContent as McpEntryGroupCreateResult).entries.length, 1000);
  const beforeMcp = { groups: groupCount(), receipts: receiptCount() };
  const rejectedMcp = await client.callTool({ name: 'create_entry_group', arguments: {
    idempotency_key: 'oversized-group', name: 'Too many members', entry_ids: oversized,
  } });
  assert.equal(rejectedMcp.isError, true);
  assert.equal(rejectedMcp.structuredContent, undefined);
  assert.deepEqual({ groups: groupCount(), receipts: receiptCount() }, beforeMcp);
  assert.ok(memberships(oversized).every((id) => id === null));

  // Stored history is deliberately seeded through SQL: the new creation ceiling
  // must not prevent owners from maintaining or removing older, larger groups.
  const insertLegacy = () => db.transaction(() => {
    const result = statements.entryGroups.insert.run(1, '2024-01-02', 'Legacy large group', 0);
    const id = Number(result.lastInsertRowid);
    for (const entryId of oversized) statements.entries.assignGroup.run(id, 1, entryId);
    return id;
  })();
  const legacyId = insertLegacy();
  assert.equal(updateEntryGroup(1, legacyId, 'Renamed legacy group').entries.length, 1001);
  assert.ok(setEntryGroupTagged(1, legacyId, true).entries.every((entry) => entry.tagged));
  assert.equal(ungroupEntries(1, legacyId).entries.length, 1001);
  assert.ok(memberships(oversized).every((id) => id === null));
  const deleted = deleteEntryGroup(1, insertLegacy());
  assert.equal(deleted.deleted_entry_ids.length, 1001);
  const remaining = db.prepare<[string], { n: number }>('SELECT count(*) AS n FROM entries WHERE local_date = ?').get('2024-01-02');
  assert.equal(remaining?.n, 0);
  process.stdout.write(JSON.stringify({
    restBoundary: 1000, mcpBoundary: 1000, rejectedWithoutWrites: true,
    legacyMembers: 1001, legacyRenameTagUngroupDelete: true,
  }));
} finally {
  await client.close();
  await server.close();
  await new Promise<void>((resolve, reject) => {
    http.close((error) => error ? reject(error) : resolve());
    http.closeAllConnections();
  });
  db.close();
}
