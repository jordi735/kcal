import { expect } from '@playwright/test';
import Database from 'better-sqlite3';
import type {
  EntryWithMacros, McpDayResult, McpEntriesCreateResult, McpMealsResult,
  McpProductCreateResult, McpSummaryResult, McpWeekResult, Product,
} from '../../shared/types';
import contracts from './fixtures/quality-backend-contracts.json' with { type: 'json' };
import legacyEntry from './fixtures/quality-legacy-entry-receipt.json' with { type: 'json' };
import { call, createMcpTest, rest } from './mcp-helpers';
import { runServerFixture } from './server-fixture';

const test = createMcpTest({ emailPrefix: 'quality-backend', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });

const NUTRITION = { kcal: 50, protein: 10, carbs: 20, fat: 5 };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
const APPLIED_AT = Date.parse('2024-02-29T12:00:00.000Z');

// Captured from the real MCP creation path at 20defe4, before the cleanup.
// These fixed hashes protect compatibility with receipts written by that build.
const PRODUCT_BASELINES = [
  {
    key: 'quality-defaults',
    input: { name: 'Food', unit: 'g', per100: NUTRITION },
    normalized: { name: 'Food', brand: null, barcode: null },
    hash: '935fde704b43700d3e52d337483f3196a523b0ac85fb1228d750916cfa6a49d7',
  },
  {
    key: 'quality-text',
    input: { name: '  RECEIPT   FOOD ', brand: '  aCME  ', barcode: ' 00123 ', unit: 'g', per100: NUTRITION },
    normalized: { name: 'Receipt food', brand: 'Acme', barcode: '00123' },
    hash: '4ccb11a52fad51cb1778634b4fa36f685885fc431147649cdbca0f71b3e5693e',
  },
  {
    key: 'quality-unicode',
    input: { name: 'ßoup', brand: 'ﬃrm', unit: 'g', per100: NUTRITION },
    normalized: { name: 'Ssoup', brand: 'Ffirm', barcode: null },
    hash: 'd9c2d5afd73a6be5df69fefca3e3d53e56856c3246fadaf29f649ca5d8c682d4',
  },
] as const;

function withFixtureDb<T>(work: (db: Database.Database) => T): T {
  const db = new Database('/tmp/kcal-e2e.db');
  try { return work(db); } finally { db.close(); }
}

test('[J-430] ordinary half-calorie portions agree across REST MCP and the displayed consumed total', async ({ page, request, account, mcp }) => {
  const date = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const product = (await call<McpProductCreateResult>(mcp, 'create_product', {
    name: 'Half-calorie boundary', unit: 'g', per100: NUTRITION,
  })).product;
  await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
    product_id: product.id, grams: 29, local_date: date, local_time: '12:00',
  });
  const rows = await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`);
  const day = await call<McpDayResult>(mcp, 'get_day', { date });
  const range = { start_date: date, end_date: date };
  const meals = await call<McpMealsResult>(mcp, 'get_meals', range);
  const week = await call<McpWeekResult>(mcp, 'get_week', { date });
  const summary = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect.soft(rows[0]!.macros.kcal, 'REST entry arithmetic').toBe(14.5);
  expect.soft(day.totals.kcal, 'MCP day arithmetic').toBe(14.5);
  expect.soft(meals.days[date]!.totals.kcal, 'MCP meals arithmetic').toBe(14.5);
  expect.soft(week.days[date]!.totals.kcal, 'MCP week arithmetic').toBe(14.5);
  expect.soft(summary.totals.kcal, 'MCP summary arithmetic').toBe(14.5);
  await page.goto('/');
  await expect(page.locator('[class*="consumedValue"]')).toHaveText('15 kcal');
});

test('[J-431] multiple fractional portions are summed before rounding for display', async ({ page, request, account, mcp }) => {
  const date = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const product = (await call<McpProductCreateResult>(mcp, 'create_product', {
    name: 'Fractional calorie portions', unit: 'g', per100: NUTRITION,
  })).product;
  const batch = await call<McpEntriesCreateResult>(mcp, 'create_entries', {
    entries: Array.from({ length: 3 }, () => ({ product_id: product.id, grams: 1 })),
    local_date: date, local_time: '12:00',
  });
  expect(batch.entries.map((entry) => entry.macros.kcal)).toEqual([0.5, 0.5, 0.5]);
  expect(batch.totals.kcal).toBe(1.5);
  const rows = await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`);
  expect(rows.reduce((sum, row) => sum + row.macros.kcal, 0)).toBe(1.5);
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).totals.kcal).toBe(1.5);
  expect((await call<McpWeekResult>(mcp, 'get_week', { date })).days[date]!.totals.kcal).toBe(1.5);
  await page.goto('/');
  await expect(page.locator('[class*="consumedValue"]')).toHaveText('2 kcal');
});

test('[J-432] product creation keeps pre-cleanup normalized fingerprints and equivalent retries', async ({ account, mcp }) => {
  for (const baseline of PRODUCT_BASELINES) {
    const created = await call<McpProductCreateResult>(mcp, 'create_product', {
      ...baseline.input, idempotency_key: baseline.key,
    });
    expect(created.product).toMatchObject(baseline.normalized);
    const receipt = withFixtureDb((db) => db.prepare(`SELECT request_hash FROM mcp_creation_receipts
      WHERE user_id = ? AND idempotency_key = ?`).get(account.user.id, baseline.key)) as { request_hash: string };
    expect(receipt.request_hash).toBe(baseline.hash);
    expect(await call<McpProductCreateResult>(mcp, 'create_product', {
      ...baseline.input, ...baseline.normalized, idempotency_key: baseline.key,
    })).toEqual({ ...created, receipt: { ...created.receipt, replayed: true } });
  }
});

test('[J-433] receipts from the pre-cleanup fingerprint format replay without recreating deleted foods', async ({ request, account, mcp }) => {
  for (const [index, baseline] of PRODUCT_BASELINES.entries()) {
    const original: McpProductCreateResult = {
      user_id: account.user.id,
      product: { id: 1_000_000 + index, ...baseline.normalized, unit: 'g', per100: NUTRITION, is_temp: false },
      receipt: { idempotency_key: baseline.key, applied_at: new Date(APPLIED_AT).toISOString(), replayed: false },
    };
    withFixtureDb((db) => db.prepare(`INSERT INTO mcp_creation_receipts
      (user_id, idempotency_key, tool_name, request_hash, result_json, applied_at, schema_version)
      VALUES (?, ?, 'create_product', ?, ?, ?, 4)`)
      .run(account.user.id, baseline.key, baseline.hash, JSON.stringify(original), APPLIED_AT));
    expect(await call<McpProductCreateResult>(mcp, 'create_product', {
      ...baseline.input, idempotency_key: baseline.key,
    })).toEqual({ ...original, receipt: { ...original.receipt, replayed: true } });
  }
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([]);
});

test('[J-434] product and summary cleanup preserves MCP discovery and public input output contracts', async ({ mcp }) => {
  const { tools } = await mcp.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual(contracts.tool_names);
  const affected = new Set(contracts.contracts.map((tool) => tool.name));
  expect(tools.filter((tool) => affected.has(tool.name)).map((tool) => ({
    name: tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations,
  })).sort((a, b) => a.name.localeCompare(b.name))).toEqual(contracts.contracts);
});

test('[J-435] summary characterization covers unknown and zero goals missing logs legacy dates and weights', async ({ page, request, account, mcp }) => {
  const food = (await call<McpProductCreateResult>(mcp, 'create_product', {
    name: 'Summary characterization', unit: 'g', per100: { kcal: 100, protein: 10, carbs: 20, fat: 5 },
  })).product;
  const water = (await call<McpProductCreateResult>(mcp, 'create_product', {
    name: 'Summary water', unit: 'ml', per100: ZERO,
  })).product;
  for (const [date, productId, grams] of [
    ['2024-02-28', food.id, 100], ['2024-02-29', water.id, 100],
    ['2024-03-02', food.id, 150], ['2024-03-03', food.id, 50],
  ] as const) {
    await rest(request, account.token, 'post', '/entries', {
      product_id: productId, grams, local_date: date, local_time: '12:00',
    });
  }
  for (const [local_date, weight_kg] of [['2024-02-28', 80], ['2024-03-03', 79.5]] as const) {
    await rest(request, account.token, 'post', '/weights', { local_date, weight_kg, note: null });
  }
  await page.close();
  const firstGoals = { kcal: 2000, protein: 100, carbs: 200, fat: 60 };
  const laterGoals = { kcal: 3000, protein: 150, carbs: 300, fat: 90 };
  withFixtureDb((db) => {
    db.prepare('DELETE FROM goal_history WHERE user_id = ?').run(account.user.id);
    const insert = db.prepare('INSERT INTO goal_history VALUES (?, ?, ?, ?, ?, ?, 0)');
    for (const [date, goals] of [['2024-02-29', firstGoals], ['2024-03-02', laterGoals], ['2024-03-03', ZERO]] as const) {
      insert.run(account.user.id, date, goals.kcal, goals.protein, goals.carbs, goals.fat);
    }
    // Existing impossible dates remain readable elsewhere but must not count
    // toward a valid calendar summary. New writes cannot create these rows.
    db.prepare(`INSERT INTO entries (user_id, product_id, grams, local_date, local_time, created_at)
      VALUES (?, ?, 100, '2024-02-30', '12:00', 0)`).run(account.user.id, food.id);
    db.prepare(`INSERT INTO weights (user_id, local_date, weight_kg, note, created_at)
      VALUES (?, '2024-02-30', 95, NULL, 0)`).run(account.user.id);
  });
  expect(await call<McpSummaryResult>(mcp, 'get_summary', { start_date: '2024-02-28', end_date: '2024-03-03' })).toEqual({
    user_id: account.user.id, start_date: '2024-02-28', end_date: '2024-03-03',
    days_total: 5, days_logged: 4, days_without_entries: 1,
    totals: { kcal: 300, protein: 30, carbs: 60, fat: 15 },
    average_on_logged_days: { kcal: 75, protein: 7.5, carbs: 15, fat: 3.75 },
    weight: {
      weighin_count: 2, first: { local_date: '2024-02-28', weight_kg: 80 },
      last: { local_date: '2024-03-03', weight_kg: 79.5 }, change_kg: -0.5,
    },
    goal_periods: [
      { start_date: '2024-02-28', end_date: '2024-02-28', daily_goals: null },
      { start_date: '2024-02-29', end_date: '2024-03-01', daily_goals: firstGoals },
      { start_date: '2024-03-02', end_date: '2024-03-02', daily_goals: laterGoals },
      { start_date: '2024-03-03', end_date: '2024-03-03', daily_goals: ZERO },
    ],
    goal_comparison: {
      days_compared: 3, logged_totals: { kcal: 200, protein: 20, carbs: 40, fat: 10 },
      goal_totals: { kcal: 5000, protein: 250, carbs: 500, fat: 150 },
    },
  });
});

test('[J-436] pre-cleanup entry receipts retain their original arithmetic after the food and logs are gone', async ({ account, mcp }) => {
  const original = { ...legacyEntry.result, user_id: account.user.id };
  withFixtureDb((db) => db.prepare(`INSERT INTO mcp_creation_receipts
    (user_id, idempotency_key, tool_name, request_hash, result_json, applied_at, schema_version)
    VALUES (?, ?, 'create_entries', ?, ?, ?, ?)`)
    .run(account.user.id, legacyEntry.input.idempotency_key, legacyEntry.receipt.request_hash,
      JSON.stringify(original), legacyEntry.receipt.applied_at, legacyEntry.receipt.schema_version));
  expect(await call<McpEntriesCreateResult>(mcp, 'create_entries', legacyEntry.input)).toEqual({
    ...original, receipt: { ...original.receipt, replayed: true },
  });
  expect(original.totals.kcal).toBe(14.499999999999998);
  expect(withFixtureDb((db) => db.prepare('SELECT COUNT(*) AS count FROM entries WHERE user_id = ?')
    .get(account.user.id))).toEqual({ count: 0 });
  expect(withFixtureDb((db) => db.prepare('SELECT COUNT(*) AS count FROM products WHERE created_by = ?')
    .get(account.user.id))).toEqual({ count: 0 });
});

test('[J-437] summary reads aggregate totals goal history and weights once each', () => {
  const result = runServerFixture(new URL('./fixtures/quality-summary-query-count.ts', import.meta.url), ':memory:', {
    PORT: '3999', TEST_MODE: 'false', PUBLIC_ORIGIN: 'https://kcal.example.test',
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
  // Before query reuse, this same public call executed 3 aggregate + 2 history
  // queries. The budget ensures comparisons reuse the data behind the summary.
  expect(JSON.parse(result.stdout)).toEqual({ aggregate: 1, history: 1, weights: 1 });
});
