import { expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  McpDayResult, McpEntriesCreateResult, McpEntryGroupCreateResult, McpMealsResult,
  McpProductCreateResult, McpSummaryResult, McpWeekResult, Product,
} from '../../shared/types';
import { BrowserOAuth, connectMcp } from './oauth-helpers';
import { call, createMcpTest, freshUser, reject, rest, storedRecords } from './mcp-helpers';

const test = createMcpTest({ emailPrefix: 'mcp-v4', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });
const NUTRITION = { kcal: 200, protein: 10, carbs: 20, fat: 5 };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
const DATE = '2024-02-29';
const FOOD = { name: 'Receipt food', unit: 'g', per100: NUTRITION };
function editFixture(edit: (db: Database.Database) => void) {
  const db = new Database('/tmp/kcal-e2e.db');
  try { edit(db); } finally { db.close(); }
}

// Use the SDK directly here: the fixture convenience helper supplies fresh keys.
test('[J-330] all MCP creates require bounded valid operation keys and singular logging is removed', async ({ page, mcp }) => {
  await page.close();
  const before = storedRecords();
  const creates = [
    ['create_product', FOOD],
    ['create_entries', { entries: [{ product_id: 1, grams: 100 }], local_date: DATE, local_time: '12:00' }],
    ['create_entry_group', { name: 'Meal', entry_ids: [1, 2] }],
  ] as const;
  for (const [name, input] of creates) {
    for (const key of [undefined, '', 'with space', 'é', 'a'.repeat(129), 123]) {
      const result = await mcp.callTool({ name, arguments: { ...input, ...(key === undefined ? {} : { idempotency_key: key }) } });
      expect(result.isError, `${name} key ${String(key)}`).toBe(true);
    }
  }
  expect((await mcp.listTools()).tools.map((tool) => tool.name)).not.toContain('create_entry');
  expect((await mcp.callTool({ name: 'create_entry', arguments: {} })).isError).toBe(true);
  expect(storedRecords()).toEqual(before);
});

test('[J-331] product receipts replay canonical input snapshots after edits and deletion and reject key conflicts', async ({ mcp, request, account }) => {
  const key = `product:${account.user.id}`;
  const input = { idempotency_key: key, ...FOOD, name: '  RECEIPT   FOOD ', brand: '  aCME  ', barcode: ' 00123 ' };
  const created = await call<McpProductCreateResult>(mcp, 'create_product', input);
  expect(created.receipt).toEqual({ idempotency_key: key, applied_at: expect.any(String), replayed: false });
  const canonical = { ...input, name: 'Receipt food', brand: 'Acme', barcode: '00123' };
  const replay = () => call<McpProductCreateResult>(mcp, 'create_product', canonical);
  expect(await replay()).toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  await reject(mcp, 'create_product', { ...canonical, name: 'Different food' }, 'idempotency_key_conflict');
  await reject(mcp, 'create_entries', { idempotency_key: key, entries: [{ product_id: created.product.id, grams: 100 }], local_date: DATE, local_time: '12:00' }, 'idempotency_key_conflict');
  await call(mcp, 'update_product', { product_id: created.product.id, per100: { kcal: 300 } });
  expect(await replay()).toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  await call(mcp, 'delete_product', { product_id: created.product.id });
  expect(await replay()).toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([]);
  const replacement = await call<McpProductCreateResult>(mcp, 'create_product', { ...canonical, idempotency_key: `${key}:new` });
  expect(replacement.product.id).not.toBe(created.product.id);
  expect(replacement.receipt.replayed).toBe(false);
});

test('[J-332] group receipts normalize names and membership order and replay after ungrouping', async ({ mcp, account }) => {
  const product = (await call<McpProductCreateResult>(mcp, 'create_product', FOOD)).product;
  const entries = (await call<McpEntriesCreateResult>(mcp, 'create_entries', {
    entries: [{ product_id: product.id, grams: 25 }, { product_id: product.id, grams: 75 }], local_date: DATE, local_time: '12:00',
  })).entries;
  const input = { idempotency_key: `group:${account.user.id}`, name: '  Two\n foods  ', entry_ids: entries.map((entry) => entry.id) };
  const created = await call<McpEntryGroupCreateResult>(mcp, 'create_entry_group', input);
  expect(created.group.name).toBe('Two foods');
  await call(mcp, 'update_entry_group', { group_id: created.group.id, name: 'Renamed' });
  await call(mcp, 'ungroup_entries', { group_id: created.group.id });
  expect(await call<McpEntryGroupCreateResult>(mcp, 'create_entry_group', {
    ...input, name: 'Two foods', entry_ids: [...input.entry_ids].reverse(),
  })).toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  expect((await call<McpDayResult>(mcp, 'get_day', { date: DATE })).entries.every((entry) => entry.group === null)).toBe(true);
});

test('[J-333] batch logging preserves duplicate order and group totals and replays the original logs', async ({ mcp, account }) => {
  const first = (await call<McpProductCreateResult>(mcp, 'create_product', FOOD)).product;
  const second = (await call<McpProductCreateResult>(mcp, 'create_product', { ...FOOD, name: 'Second food' })).product;
  await call(mcp, 'create_entries', { entries: [{ product_id: first.id, grams: 100 }], local_date: DATE, local_time: '07:00' });
  const input = { idempotency_key: `batch:${account.user.id}`, entries: [
    { product_id: second.id, grams: 12.5 }, { product_id: first.id, grams: 50 }, { product_id: second.id, grams: 37.5 },
  ], local_date: DATE, local_time: '18:45', group_name: '  Dinner\n plate  ' };
  const created = await call<McpEntriesCreateResult>(mcp, 'create_entries', input);
  expect(created.entries.map((entry) => [entry.product.id, entry.grams])).toEqual(input.entries.map((entry) => [entry.product_id, entry.grams]));
  expect(new Set(created.entries.map((entry) => entry.id)).size).toBe(3);
  expect(created.group).toEqual({ id: expect.any(Number), name: 'Dinner plate', local_date: DATE });
  expect(created.entries.every((entry) => entry.local_time === input.local_time && entry.group?.id === created.group!.id)).toBe(true);
  expect(created.totals).toEqual(NUTRITION);
  expect((await call<McpDayResult>(mcp, 'get_day', { date: DATE })).totals.kcal).toBe(400);
  await call(mcp, 'update_entry', { entry_id: created.entries[0]!.id, grams: 100 });
  await call(mcp, 'delete_entry_group', { group_id: created.group!.id });
  expect(await call<McpEntriesCreateResult>(mcp, 'create_entries', { ...input, group_name: 'Dinner plate' }))
    .toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  expect((await call<McpDayResult>(mcp, 'get_day', { date: DATE })).entries).toHaveLength(1);
  await reject(mcp, 'create_entries', { ...input, entries: [...input.entries].reverse() }, 'idempotency_key_conflict');
});

test('[J-334] invalid batch members and bounds roll back all rows and failed attempts leave keys reusable', async ({ page, mcp, request, account }) => {
  const product = (await call<McpProductCreateResult>(mcp, 'create_product', FOOD)).product;
  const temporary = await rest<Product>(request, account.token, 'post', '/products', { ...FOOD, brand: null, barcode: null, is_temp: true });
  await page.close();
  const input = { idempotency_key: `failed:${account.user.id}`, entries: [{ product_id: product.id, grams: 100 }], local_date: DATE, local_time: '12:00' };
  const before = storedRecords();
  for (const args of [
    { ...input, entries: [] },
    { ...input, entries: Array.from({ length: 51 }, () => input.entries[0]!) },
    { ...input, group_name: 'One child' },
    { ...input, entries: [...input.entries, { product_id: temporary.id, grams: 100 }], group_name: 'Temporary member' },
    { ...input, entries: [...input.entries, { product_id: Number.MAX_SAFE_INTEGER, grams: 100 }], group_name: 'Missing member' },
  ]) await reject(mcp, 'create_entries', args);
  expect(storedRecords()).toEqual(before);
  const created = await call<McpEntriesCreateResult>(mcp, 'create_entries', { ...input, entries: Array.from({ length: 50 }, () => input.entries[0]!) });
  expect(created.entries).toHaveLength(50);
  expect(created.group).toBeNull();
  expect(created.receipt.replayed).toBe(false);
  expect(created.totals.kcal).toBe(10000);
});

test('[J-335] batch output validation rolls back entries group and receipt before identical retry succeeds', async ({ page, mcp, account }) => {
  const product = (await call<McpProductCreateResult>(mcp, 'create_product', FOOD)).product;
  await page.close();
  editFixture((db) => { db.prepare('UPDATE products SET kcal_per100 = ? WHERE created_by = ? AND id = ?').run(1e308, account.user.id, product.id); });
  const input = { idempotency_key: `output:${account.user.id}`, entries: [
    { product_id: product.id, grams: 1000 }, { product_id: product.id, grams: 1000 },
  ], local_date: DATE, local_time: '12:00', group_name: 'Must roll back' };
  const before = storedRecords();
  await reject(mcp, 'create_entries', input, 'write_failed');
  expect(storedRecords()).toEqual(before);
  editFixture((db) => { db.prepare('UPDATE products SET kcal_per100 = ? WHERE created_by = ? AND id = ?').run(200, account.user.id, product.id); });
  const created = await call<McpEntriesCreateResult>(mcp, 'create_entries', input);
  expect(created.entries).toHaveLength(2);
  expect(created.group?.name).toBe('Must roll back');
  expect(created.receipt.replayed).toBe(false);
});

test('[J-336] damaged or unsupported receipts fail closed without repeating creation', async ({ page, mcp, account }) => {
  const input = { ...FOOD, idempotency_key: `damaged:${account.user.id}` };
  await call(mcp, 'create_product', input);
  await page.close();
  editFixture((db) => { db.prepare('UPDATE mcp_creation_receipts SET result_json = ? WHERE user_id = ? AND idempotency_key = ?').run('{broken', account.user.id, input.idempotency_key); });
  let before = storedRecords();
  await reject(mcp, 'create_product', input, 'idempotency_replay_unavailable');
  expect(storedRecords()).toEqual(before);
  editFixture((db) => { db.prepare('UPDATE mcp_creation_receipts SET schema_version = ? WHERE user_id = ? AND idempotency_key = ?').run(999, account.user.id, input.idempotency_key); });
  before = storedRecords();
  await reject(mcp, 'create_product', input, 'idempotency_replay_unavailable');
  expect(storedRecords()).toEqual(before);
});

test('[J-337] concurrent creates share one receipt while another account can reuse the same key', async ({ browser, request, mcp, account }) => {
  const input = { ...FOOD, idempotency_key: 'same-key-across-accounts' };
  const results = await Promise.all([call<McpProductCreateResult>(mcp, 'create_product', input), call<McpProductCreateResult>(mcp, 'create_product', input)]);
  expect(results.map((result) => result.receipt.replayed).sort()).toEqual([false, true]);
  expect(results[0]!.product).toEqual(results[1]!.product);
  expect(results[0]!.receipt.applied_at).toBe(results[1]!.receipt.applied_at);
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([results[0]!.product]);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const other = await freshUser(page, request, 'mcp-key-other');
    const connection = await connectMcp(page, new BrowserOAuth('none', 'kcal:read kcal:write'));
    try {
      const created = await call<McpProductCreateResult>(connection.mcp, 'create_product', input);
      expect(created.user_id).toBe(other.user.id);
      expect(created.product.id).not.toBe(results[0]!.product.id);
      expect(created.receipt.replayed).toBe(false);
      await reject(mcp, 'create_entries', { idempotency_key: 'foreign-batch', entries: [
        { product_id: results[0]!.product.id, grams: 100 }, { product_id: created.product.id, grams: 100 },
      ], local_date: DATE, local_time: '12:00' }, 'product_not_found');
      expect((await call<McpDayResult>(mcp, 'get_day', { date: DATE })).entries).toEqual([]);
    } finally { await connection.mcp.close(); }
  } finally { await context.close(); }
});

test('[J-338] dated goals and comparisons distinguish unknown history missing logs and zero-calorie logs', async ({ page, mcp, account }) => {
  const food = (await call<McpProductCreateResult>(mcp, 'create_product', FOOD)).product;
  const water = (await call<McpProductCreateResult>(mcp, 'create_product', { ...FOOD, name: 'Water', per100: ZERO })).product;
  for (const [local_date, product_id] of [['2000-01-01', food.id], ['2000-01-02', water.id], ['2000-01-04', food.id]] as const) {
    await call(mcp, 'create_entries', { entries: [{ product_id, grams: 100 }], local_date, local_time: '12:00' });
  }
  await page.close();
  const firstGoals = { kcal: 2000, protein: 100, carbs: 200, fat: 60 };
  const laterGoals = { kcal: 2400, protein: 120, carbs: 240, fat: 80 };
  editFixture((db) => {
    const insert = db.prepare('INSERT INTO goal_history (user_id, effective_date, kcal, protein, carbs, fat, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0)');
    for (const [date, goals] of [['2000-01-02', firstGoals], ['2000-01-04', laterGoals]] as const) insert.run(account.user.id, date, goals.kcal, goals.protein, goals.carbs, goals.fat);
  });
  const range = { start_date: '2000-01-01', end_date: '2000-01-05' };
  const meals = await call<McpMealsResult>(mcp, 'get_meals', range);
  expect(Object.values(meals.days).map((day) => day.daily_goals)).toEqual([null, firstGoals, firstGoals, laterGoals, laterGoals]);
  for (const [date, day] of Object.entries(meals.days)) {
    const single = await call<McpDayResult>(mcp, 'get_day', { date });
    expect(day).toEqual({ entries: single.entries, totals: single.totals, daily_goals: single.daily_goals });
    const week = await call<McpWeekResult>(mcp, 'get_week', { date });
    expect(week.days[date]).toEqual({ totals: single.totals, daily_goals: single.daily_goals });
  }
  const summary = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(summary.goal_periods).toEqual([
    { start_date: '2000-01-01', end_date: '2000-01-01', daily_goals: null },
    { start_date: '2000-01-02', end_date: '2000-01-03', daily_goals: firstGoals },
    { start_date: '2000-01-04', end_date: '2000-01-05', daily_goals: laterGoals },
  ]);
  expect(summary.goal_comparison).toEqual({ days_compared: 2, logged_totals: NUTRITION, goal_totals: { kcal: 4400, protein: 220, carbs: 440, fat: 140 } });
  expect(summary.days_logged).toBe(3);
  for (const date of ['2000-01-01', '2000-01-03']) {
    expect((await call<McpSummaryResult>(mcp, 'get_summary', { start_date: date, end_date: date })).goal_comparison)
      .toEqual({ days_compared: 0, logged_totals: null, goal_totals: null });
  }
});

test('[J-339] accounts without initialized goal history can read and create and calendar overflow fails cleanly', async ({ page, mcp, account }) => {
  await page.close();
  editFixture((db) => { db.prepare('DELETE FROM goal_history WHERE user_id = ?').run(account.user.id); });
  const created = await call<McpProductCreateResult>(mcp, 'create_product', FOOD);
  await call(mcp, 'create_entries', { entries: [{ product_id: created.product.id, grams: 100 }], local_date: DATE, local_time: '12:00' });
  expect((await call<McpDayResult>(mcp, 'get_day', { date: DATE })).daily_goals).toBeNull();
  expect((await call<McpWeekResult>(mcp, 'get_week', { date: DATE })).totals).toEqual(NUTRITION);
  const before = storedRecords();
  for (const date of ['0000-01-01', '9999-12-31']) await reject(mcp, 'get_week', { date }, 'week_outside_supported_date_range');
  expect(storedRecords()).toEqual(before);
});


test('[J-340] receipts survive process restart and success logging follows the outer transaction', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-receipts-'));
  const script = `
    import './server/env.ts';
    import { db } from './server/db.ts';
    import { log } from './server/log.ts';
    import { createServer } from './server/mcp/server.ts';
    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
    import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
    import assert from 'node:assert/strict';
    const phase = process.env.RECEIPT_TEST_PHASE;
    if (phase === 'create') db.prepare('INSERT INTO users (id, email, created_at) VALUES (1, ?, 0)').run('receipt@test.local');
    const messages = [];
    log.info = (message) => messages.push(message);
    const server = createServer(1, ['kcal:read', 'kcal:write']);
    const client = new Client({name: 'receipt-test', version: '1'});
    const [a,b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    await client.listTools();
    const input = { idempotency_key: 'restart-key', name: 'Restart food', unit: 'g', per100: {kcal:200,protein:10,carbs:20,fat:5} };
    const result = await client.callTool({name:'create_product', arguments:input});
    assert.equal(result.isError, undefined);
    const created = result.structuredContent;
    assert.equal(created.receipt.replayed, phase !== 'create');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
    if (phase === 'create') {
      assert.deepEqual(messages, ['MCP mutation committed']);
      db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(1e308, created.product.id);
      messages.length = 0;
      const failed = await client.callTool({name:'create_entries',arguments:{
        idempotency_key:'failed-batch', entries:[{product_id:created.product.id,grams:1000},{product_id:created.product.id,grams:1000}],
        local_date:'2024-02-29',local_time:'12:00',group_name:'Failed group'
      }});
      assert.equal(failed.isError, true);
      assert.deepEqual(messages, []);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entry_groups').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_creation_receipts').get().n, 1);
      db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(200, created.product.id);
      db.exec("CREATE TRIGGER reject_test_receipt BEFORE INSERT ON mcp_creation_receipts WHEN NEW.idempotency_key = 'receipt-insert-failure' BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END");
      const batch = {
        idempotency_key:'receipt-insert-failure', entries:[{product_id:created.product.id,grams:25},{product_id:created.product.id,grams:75}],
        local_date:'2024-02-29',local_time:'12:00',group_name:'Receipt transaction'
      };
      const rejected = await client.callTool({name:'create_entries',arguments:batch});
      assert.equal(rejected.isError, true);
      assert.deepEqual(messages, []);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entry_groups').get().n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_creation_receipts').get().n, 1);
      db.exec('DROP TRIGGER reject_test_receipt');
      const retried = await client.callTool({name:'create_entries',arguments:batch});
      assert.equal(retried.isError, undefined);
      assert.equal(retried.structuredContent.receipt.replayed, false);
      assert.equal(retried.structuredContent.entries.length, 2);
      assert.equal(retried.structuredContent.group.name, 'Receipt transaction');
      assert.deepEqual(messages, ['MCP mutation committed']);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entry_groups').get().n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mcp_creation_receipts').get().n, 2);
      db.prepare('UPDATE products SET kcal_per100 = ? WHERE id = ?').run(1e308, created.product.id);
    } else {
      assert.deepEqual(messages, ['MCP creation replayed']);
      assert.equal(created.product.per100.kcal, 200);
      assert.equal(db.prepare('SELECT kcal_per100 AS kcal FROM products').get().kcal, 1e308);
    }
    await client.close();
    await server.close();
    db.close();
    process.stdout.write('receipt-check-ok');
  `;
  try {
    for (const phase of ['create', 'replay']) {
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, PORT: '3000', DATABASE_PATH: path.join(directory, 'app.db'),
          TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
          SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', LOG_LEVEL: 'error',
          PUBLIC_ORIGIN: '', RECEIPT_TEST_PHASE: phase },
      });
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain('receipt-check-ok');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
