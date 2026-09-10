import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  McpDayResult, McpMealsResult, McpProductSearchResult, McpSummaryResult, McpWeekResult, McpWeighinsResult,
} from '../../shared/types';
import { signInFresh } from './helpers';
import { connectMcp } from './oauth-helpers';

const MCP_HEADERS = { Accept: 'application/json, text/event-stream' };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

type Account = { token: string; user: { id: number; email: string } };
const test = base.extend<{ account: Account; connection: Awaited<ReturnType<typeof connectMcp>>; mcp: Client; mcpHeaders: Record<string, string> }>({
  account: async ({ page, request }, use) => { await use(await freshUser(page, request, 'mcp')); },
  connection: async ({ page, account }, use) => {
    void account;
    const connection = await connectMcp(page);
    try { await use(connection); } finally { await connection.mcp.close(); }
  },
  mcp: async ({ connection }, use) => { await use(connection.mcp); },
  mcpHeaders: async ({ connection }, use) => {
    await use({ ...MCP_HEADERS, Authorization: `Bearer ${connection.oauth.savedTokens!.access_token}` });
  },
});

test.use({ storageState: { cookies: [], origins: [] } });

async function call<T>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await client.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return result.structuredContent as T;
}

async function freshUser(page: Page, request: APIRequestContext, prefix: string) {
  await signInFresh(page, request, prefix);
  return page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('kcal_user')!) as { id: number; email: string };
    return { token: localStorage.getItem('kcal_session_token')!, user: { id: user.id, email: user.email } };
  });
}

async function write(
  request: APIRequestContext, token: string, method: 'post' | 'put' | 'patch', url: string, data: unknown,
) {
  const response = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test('[J-188] MCP discovers six account-scoped read-only tools with output schemas', async ({ mcp }) => {
  expect(mcp.getServerVersion()?.name).toBe('kcal');
  const { tools } = await mcp.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'get_day', 'get_meals', 'get_summary', 'get_week', 'get_weighins', 'search_products',
  ]);
  expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  expect(tools.every((tool) => !('user_id' in (tool.inputSchema.properties ?? {})))).toBe(true);
  const outputFields: Record<string, string[]> = {
    get_day: ['user_id', 'date', 'entries', 'totals', 'current_daily_goals'],
    get_meals: ['user_id', 'start_date', 'end_date', 'days'],
    get_week: ['user_id', 'start_date', 'end_date', 'days', 'totals', 'current_daily_goals'],
    get_weighins: ['user_id', 'weighins', 'next_offset'],
    get_summary: ['user_id', 'start_date', 'end_date', 'days_total', 'days_logged', 'days_without_entries',
      'totals', 'average_on_logged_days', 'current_daily_goals', 'weight'],
    search_products: ['user_id', 'query', 'products'],
  };
  for (const tool of tools) {
    expect(tool.outputSchema, tool.name).toMatchObject({
      type: 'object', properties: { user_id: { type: 'integer' } },
    });
    expect(Object.keys(tool.outputSchema!.properties ?? {}).sort()).toEqual(outputFields[tool.name]!.sort());
    expect(tool.outputSchema!.required).toEqual(expect.arrayContaining(outputFields[tool.name]!));
  }
  expect(tools.find((tool) => tool.name === 'get_weighins')!.outputSchema).toMatchObject({
    properties: {
      weighins: {
        items: {
          properties: { peed: { type: 'boolean' }, pooped: { type: 'boolean' } },
          required: expect.arrayContaining(['peed', 'pooped']),
        },
      },
    },
  });
  expect((await mcp.callTool({ name: 'list_users', arguments: {} })).isError).toBe(true);
});

test('[J-189] MCP food reads and summaries match app totals across users, groups, and product edits', async ({ request, browser, mcp, account: a }) => {
  const headers = { Authorization: `Bearer ${a.token}` };
  const goals = { kcal: 2300, protein: 150, carbs: 250, fat: 75 };
  await write(request, a.token, 'put', '/settings', goals);
  const productBody = {
    name: `MCP food ${a.user.id}`, brand: null, unit: 'g', barcode: null, is_temp: false,
    per100: { kcal: 200, protein: 10, carbs: 20, fat: 5 },
  };
  const product = await write(request, a.token, 'post', '/products', productBody);
  const entry = (date: string, grams: number) => write(request, a.token, 'post', '/entries', {
    product_id: product.id, grams, local_date: date, local_time: '12:30',
  });
  const first = await entry('2024-12-30', 150);
  const second = await entry('2024-12-30', 50);
  await entry('2025-01-05', 100);
  await entry('2024-12-29', 999); // Outside the requested Monday–Sunday.
  await entry('2025-01-06', 999); // After the inclusive end date.
  const group = await write(request, a.token, 'post', '/entries/groups', {
    name: `MCP meal ${a.user.id}`, entry_ids: [first.id, second.id],
  });
  await write(request, a.token, 'patch', `/entries/${first.id}`, { tagged: true });

  const day = await call<McpDayResult>(mcp, 'get_day', { date: '2024-12-30' });
  expect(day.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(day.entries.map((row) => row.group?.id)).toEqual([group.id, group.id]);
  expect(day.entries.map((row) => row.tagged)).toEqual([true, false]);
  expect(day.totals).toEqual({ kcal: 400, protein: 20, carbs: 40, fat: 10 });
  expect(day.current_daily_goals).toEqual(await (await request.get('/settings', { headers })).json());
  const week = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-01-05' });
  expect(week.start_date).toBe('2024-12-30');
  expect(week.end_date).toBe('2025-01-05');
  expect(Object.keys(week.days)).toHaveLength(7);
  expect(week.days).toEqual(await (await request.get('/entries/week?start=2024-12-30', { headers })).json());
  expect(week.days['2024-12-31']).toEqual(ZERO);
  expect(week.totals).toEqual({ kcal: 600, protein: 30, carbs: 60, fat: 15 });
  expect(week.current_daily_goals).toEqual(goals);
  expect(await call(mcp, 'get_week', { date: '2024-12-30' })).toEqual(week);
  const range = { start_date: '2024-12-30', end_date: '2025-01-05' };
  const meals = await call<McpMealsResult>(mcp, 'get_meals', range);
  expect(meals.user_id).toBe(a.user.id);
  expect(meals.start_date).toBe(range.start_date);
  expect(meals.end_date).toBe(range.end_date);
  expect(Object.keys(meals.days)).toEqual(Object.keys(week.days));
  expect(meals.days['2024-12-30']).toEqual({ entries: day.entries, totals: day.totals });
  expect(meals.days['2024-12-30']!.entries.map((row) => row.id)).toEqual([first.id, second.id]);
  expect(meals.days['2024-12-31']).toEqual({ entries: [], totals: ZERO });
  const lastDay = await call<McpDayResult>(mcp, 'get_day', { date: range.end_date });
  expect(meals.days[range.end_date]).toEqual({ entries: lastDay.entries, totals: lastDay.totals });
  expect(Object.fromEntries(Object.entries(meals.days).map(([date, value]) => [date, value.totals]))).toEqual(week.days);
  for (const [local_date, weight_kg] of [['2024-12-30', 82.4], ['2025-01-05', 81.9]] as const) {
    await write(request, a.token, 'post', '/weights', { local_date, weight_kg, note: null });
  }
  const summary = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(summary).toMatchObject({
    user_id: a.user.id, ...range, days_total: 7, days_logged: 2, days_without_entries: 5,
    totals: week.totals, current_daily_goals: goals,
    average_on_logged_days: { kcal: 300, protein: 15, carbs: 30, fat: 7.5 },
    weight: { weighin_count: 2, change_kg: -0.5 },
  });

  // Each connection resolves its own account; tool arguments cannot switch it.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const bPage = await context.newPage();
    const b = await freshUser(bPage, request, 'mcp-other');
    const bConnection = await connectMcp(bPage);
    const bDay = await call<McpDayResult>(bConnection.mcp, 'get_day', { date: '2024-12-30' });
    const bMeals = await call<McpMealsResult>(bConnection.mcp, 'get_meals', range);
    const bSummary = await call<McpSummaryResult>(bConnection.mcp, 'get_summary', range);
    expect(bSummary).toMatchObject({
      user_id: b.user.id, days_logged: 0, days_without_entries: 7,
      totals: ZERO, average_on_logged_days: null,
      weight: { weighin_count: 0, first: null, last: null, change_kg: null },
    });
    expect(bMeals.user_id).toBe(b.user.id);
    expect(Object.values(bMeals.days).every((value) => value.entries.length === 0)).toBe(true);
    expect(Object.values(bMeals.days).every((value) => value.totals.kcal === 0)).toBe(true);
    await bConnection.mcp.close();
    expect((await mcp.callTool({ name: 'get_day', arguments: { user_id: b.user.id, date: '2024-12-30' } })).isError).toBe(true);
    expect(bDay.entries).toEqual([]);
    expect(bDay.totals).toEqual(ZERO);
    const ordinary = await request.get(`/entries?date=2024-12-30&user_id=${a.user.id}`, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
    expect(await ordinary.json()).toEqual([]);
  } finally {
    await context.close();
  }

  await write(request, a.token, 'put', `/products/${product.id}`, {
    ...productBody, per100: { kcal: 300, protein: 20, carbs: 30, fat: 10 },
  });
  const edited = await call<McpDayResult>(mcp, 'get_day', { date: '2024-12-30' });
  expect(edited.entries).toEqual(await (await request.get('/entries?date=2024-12-30', { headers })).json());
  expect(edited.totals).toEqual({ kcal: 600, protein: 40, carbs: 60, fat: 20 });
  const editedMeals = await call<McpMealsResult>(mcp, 'get_meals', range);
  expect(editedMeals.days['2024-12-30']).toEqual({ entries: edited.entries, totals: edited.totals });
  const editedWeek = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-01-02' });
  expect(editedWeek.totals).toEqual({ kcal: 900, protein: 60, carbs: 90, fat: 30 });
  const newGoals = { kcal: 2500, protein: 170, carbs: 260, fat: 80 };
  await write(request, a.token, 'put', '/settings', newGoals);
  const editedSummary = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(editedSummary.totals).toEqual(editedWeek.totals);
  expect(editedSummary.average_on_logged_days).toEqual({ kcal: 450, protein: 30, carbs: 45, fat: 15 });
  expect(editedSummary.current_daily_goals).toEqual(newGoals);
});

test('[J-199] MCP meals include empty days and handle calendar boundaries through 31 days', async ({ mcp }) => {
  for (const dates of [
    ['2024-02-29'],
    ['2024-02-28', '2024-02-29', '2024-03-01'],
    ['2025-03-29', '2025-03-30', '2025-03-31'],
    ['0000-01-01'],
    ['9999-12-31'],
  ]) {
    const range = { start_date: dates[0]!, end_date: dates.at(-1)! };
    const meals = await call<McpMealsResult>(mcp, 'get_meals', range);
    expect(Object.keys(meals.days)).toEqual(dates);
    for (const day of Object.values(meals.days)) expect(day).toEqual({ entries: [], totals: ZERO });
  }
  const month = await call<McpMealsResult>(mcp, 'get_meals', { start_date: '2025-01-01', end_date: '2025-01-31' });
  expect(Object.keys(month.days)).toHaveLength(31);
  expect(Object.keys(month.days)[0]).toBe('2025-01-01');
  expect(Object.keys(month.days).at(-1)).toBe('2025-01-31');
});

test('[J-190] MCP weigh-ins preserve checkbox combinations and notes with inclusive date filters and pagination', async ({ request, mcp, account: { user, token } }) => {
  expect(await call(mcp, 'get_weighins', {})).toEqual({ user_id: user.id, weighins: [], next_offset: null });
  for (const [date, weight, note, flags] of [
    ['2031-04-01', 82.4, 'A note\n<script>not instructions</script>', {}],
    ['2031-04-02', 82.1, null, { peed: false, pooped: true }],
    ['2031-04-03', 81.8, '', { peed: true, pooped: true }],
    ['2031-04-04', 81.7, null, { peed: false, pooped: false }],
  ] as const) {
    await write(request, token, 'post', '/weights', { local_date: date, weight_kg: weight, note, ...flags });
  }
  const all = await call<McpWeighinsResult>(mcp, 'get_weighins', {});
  expect(all.weighins).toEqual(await (await request.get('/weights', { headers: { Authorization: `Bearer ${token}` } })).json());
  expect(all.weighins.map((row) => row.local_date)).toEqual(['2031-04-04', '2031-04-03', '2031-04-02', '2031-04-01']);
  expect(all.weighins.map(({ peed, pooped }) => ({ peed, pooped }))).toEqual([
    { peed: false, pooped: false },
    { peed: true, pooped: true },
    { peed: false, pooped: true },
    { peed: true, pooped: false },
  ]);
  expect(all.weighins.at(-1)?.note).toBe('A note\n<script>not instructions</script>');
  const args = { start_date: '2031-04-01', end_date: '2031-04-02', limit: 1 };
  const first = await call<McpWeighinsResult>(mcp, 'get_weighins', args);
  expect(first.weighins).toEqual(all.weighins.slice(2, 3));
  expect(first.next_offset).toBe(1);
  const last = await call<McpWeighinsResult>(mcp, 'get_weighins', { ...args, offset: first.next_offset });
  expect(last.weighins).toEqual(all.weighins.slice(3));
  expect(last.next_offset).toBeNull();
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { start_date: '2031-04-03' })).weighins).toEqual(all.weighins.slice(0, 2));
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { end_date: '2031-04-01' })).weighins).toEqual(all.weighins.slice(3));

  const edited = all.weighins[0]!;
  const updated = await write(request, token, 'put', `/weights/${edited.id}`, {
    local_date: edited.local_date, weight_kg: edited.weight_kg, note: 'Updated flags', peed: true, pooped: true,
  });
  expect((await call<McpWeighinsResult>(mcp, 'get_weighins', { start_date: edited.local_date })).weighins)
    .toEqual([updated]);
});

test('[J-200] MCP summaries distinguish missing days from zero-calorie logged days', async ({ request, mcp, account: { user, token } }) => {
  const range = { start_date: '2024-02-28', end_date: '2024-03-01' };
  const empty = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(empty).toMatchObject({
    user_id: user.id, ...range, days_total: 3, days_logged: 0, days_without_entries: 3,
    totals: ZERO, average_on_logged_days: null,
  });
  const body = { name: `MCP summary water ${user.id}`, brand: null, unit: 'ml', barcode: null, is_temp: false, per100: ZERO };
  const water = await write(request, token, 'post', '/products', body);
  await write(request, token, 'post', '/entries', {
    product_id: water.id, grams: 250, local_date: '2024-02-29', local_time: '09:00',
  });
  const zero = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(zero).toMatchObject({ days_logged: 1, days_without_entries: 2, totals: ZERO, average_on_logged_days: ZERO });

  const product = await write(request, token, 'post', '/products', {
    ...body, name: `MCP summary food ${user.id}`, unit: 'g', per100: { kcal: 150, protein: 9, carbs: 18, fat: 6 },
  });
  for (const [local_date, grams] of [
    ['2024-02-28', 100], ['2024-03-01', 100], ['2024-02-28', 50],
    ['2024-02-27', 999], ['2024-03-02', 999],
    // Existing REST guards allow impossible date-shaped strings. Summary reads
    // must ignore these just as the calendar-based day/week reads do.
    ['2024-02-30', 999],
  ] as const) {
    await write(request, token, 'post', '/entries', { product_id: product.id, grams, local_date, local_time: '12:30' });
  }
  await write(request, token, 'post', '/weights', { local_date: '2024-02-30', weight_kg: 82, note: null });
  const full = await call<McpSummaryResult>(mcp, 'get_summary', range);
  expect(full).toMatchObject({
    days_total: 3, days_logged: 3, days_without_entries: 0,
    totals: { kcal: 375, protein: 22.5, carbs: 45, fat: 15 },
    average_on_logged_days: { kcal: 125, protein: 7.5, carbs: 15, fat: 5 },
    weight: { weighin_count: 0, first: null, last: null, change_kg: null },
  });
});

test('[J-201] MCP summaries compare first and last in-range weigh-ins with sparse history', async ({ request, mcp, account: { token } }) => {
  const range = { start_date: '2024-02-28', end_date: '2024-03-05' };
  expect((await call<McpSummaryResult>(mcp, 'get_summary', range)).weight).toEqual({
    weighin_count: 0, first: null, last: null, change_kg: null,
  });
  const point = { local_date: '2024-03-02', weight_kg: 80.1 };
  await write(request, token, 'post', '/weights', { ...point, note: 'Not part of the summary' });
  expect((await call<McpSummaryResult>(mcp, 'get_summary', range)).weight).toEqual({
    weighin_count: 1, first: point, last: point, change_kg: null,
  });
  // Insert out of order; only the calendar endpoints determine change.
  for (const [local_date, weight_kg] of [
    ['2024-03-05', 81.9], ['2024-03-03', 88.8], ['2024-02-28', 82.4],
    ['2024-02-27', 86.3], ['2024-03-06', 60.2], ['2024-03-04', 80.1],
  ] as const) {
    await write(request, token, 'post', '/weights', { local_date, weight_kg, note: null });
  }
  expect((await call<McpSummaryResult>(mcp, 'get_summary', range)).weight).toEqual({
    weighin_count: 5,
    first: { local_date: range.start_date, weight_kg: 82.4 },
    last: { local_date: range.end_date, weight_kg: 81.9 },
    change_kg: -0.5,
  });
  const gain = await call<McpSummaryResult>(mcp, 'get_summary', { start_date: '2024-03-02', end_date: '2024-03-03' });
  expect(gain.weight.change_kg).toBe(8.7);
  const same = await call<McpSummaryResult>(mcp, 'get_summary', { start_date: '2024-03-02', end_date: '2024-03-04' });
  expect(same.weight.change_kg).toBe(0);
  const singleDay = await call<McpSummaryResult>(mcp, 'get_summary', { start_date: point.local_date, end_date: point.local_date });
  expect(singleDay.weight).toEqual({ weighin_count: 1, first: point, last: point, change_kg: null });
});

test('[J-202] MCP summaries handle calendar boundaries and a full year without weight pagination', async ({ request, mcp, account: { token } }) => {
  for (const [start_date, end_date, days_total] of [
    ['2024-02-29', '2024-02-29', 1],
    ['2024-02-28', '2024-03-01', 3],
    ['2025-03-29', '2025-03-31', 3],
    ['2024-12-31', '2025-01-01', 2],
    ['0000-01-01', '0000-01-01', 1],
    ['9999-12-31', '9999-12-31', 1],
    ['2024-01-01', '2024-12-31', 366],
  ] as const) {
    const summary = await call<McpSummaryResult>(mcp, 'get_summary', { start_date, end_date });
    expect(summary).toMatchObject({ start_date, end_date, days_total, days_logged: 0,
      days_without_entries: days_total, totals: ZERO, average_on_logged_days: null });
  }
  // More than the weight tool's default page of 100, all inside a leap year.
  for (let i = 0; i < 101; i++) {
    const local_date = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    await write(request, token, 'post', '/weights', { local_date, weight_kg: 80 + i / 10, note: null });
  }
  const year = await call<McpSummaryResult>(mcp, 'get_summary', { start_date: '2024-01-01', end_date: '2024-12-31' });
  expect(year.weight).toEqual({
    weighin_count: 101,
    first: { local_date: '2024-01-01', weight_kg: 80 },
    last: { local_date: '2024-04-10', weight_kg: 90 },
    change_kg: 10,
  });
});

test('[J-203] MCP product search matches the owned saved library by name and brand', async ({ request, browser, mcp, account: a }) => {
  const query = `MCP lookup ${a.user.id}`;
  const body = { name: `${query} Zebra`, brand: null, unit: 'g', barcode: null,
    per100: { kcal: 100, protein: 12, carbs: 7, fat: 3 }, is_temp: false };
  // Saved but never logged: these products must still be searchable.
  const zebra = await write(request, a.token, 'post', '/products', body);
  const alpha = await write(request, a.token, 'post', '/products', { ...body, name: `${query} Alpha` });
  const branded = await write(request, a.token, 'post', '/products', {
    ...body, name: `Drink ${a.user.id}`, brand: `${query} Maker`, unit: 'ml', barcode: `mcp-lookup-${a.user.id}`,
  });
  await write(request, a.token, 'post', '/products', { ...body, name: `${query} Temporary`, is_temp: true });

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const bPage = await context.newPage();
    const b = await freshUser(bPage, request, 'mcp-search-other');
    await write(request, b.token, 'post', '/products', { ...body, name: `${query} Private` });
    const shared = await write(request, b.token, 'post', '/products', {
      ...body, name: `${query} Shared`, barcode: `mcp-lookup-${b.user.id}`,
    });
    const headers = { Authorization: `Bearer ${a.token}` };
    const global = await (await request.get(`/products/search?q=${encodeURIComponent(query)}&global=1`, { headers })).json();
    expect(global.some((product: { id: number }) => product.id === shared.id)).toBe(true);

    const result = await call<McpProductSearchResult>(mcp, 'search_products', { query: `  ${query.toUpperCase()}  ` });
    expect(result).toEqual({ user_id: a.user.id, query: query.toUpperCase(), products: [branded, alpha, zebra] });
    expect(result.products).toEqual(await (await request.get(`/products/search?q=${encodeURIComponent(query)}`, { headers })).json());
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: `${query} Maker` })).products).toEqual([branded]);
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: `${query} Missing` })).products).toEqual([]);

    const bConnection = await connectMcp(bPage);
    try {
      const own = await call<McpProductSearchResult>(bConnection.mcp, 'search_products', { query });
      expect(own.user_id).toBe(b.user.id);
      expect(own.products).toHaveLength(2);
      expect(own.products.some((product) => product.id === shared.id)).toBe(true);
      expect(own.products.some((product) => [branded.id, alpha.id, zebra.id].includes(product.id))).toBe(false);
    } finally {
      await bConnection.mcp.close();
    }
  } finally {
    await context.close();
  }
});

test('[J-204] MCP product search caps broad queries at 50 alphabetically ordered results', async ({ request, mcp, account: { user, token } }) => {
  const query = `MCP capped ${user.id}`;
  const names: string[] = [];
  for (let i = 50; i >= 0; i--) {
    const product = await write(request, token, 'post', '/products', {
      name: `${query} ${String(i).padStart(2, '0')}`, brand: null, unit: 'g', barcode: null,
      per100: ZERO, is_temp: false,
    });
    names.push(product.name);
  }
  const result = await call<McpProductSearchResult>(mcp, 'search_products', { query });
  expect(result.products).toHaveLength(50);
  expect(result.products.map((product) => product.name)).toEqual(names.reverse().slice(0, 50));
  expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: `${query} 50` })).products).toHaveLength(1);
});

test('[J-191] MCP rejects invalid inputs without changing any stored records', async ({ page, request, mcp, mcpHeaders }) => {
  // Stop SPA revalidation requests before comparing session records.
  await page.close();
  const args = { date: '2024-02-29' };
  // Snapshot all test DB tables, including sessions. MCP must not slide app
  // sessions or otherwise write, even when processing rejected tool calls.
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  const snapshot = () => ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights', 'oauth_clients', 'oauth_requests', 'oauth_grants', 'oauth_tokens']
    .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  try {
    const before = snapshot();
    const day = await call<McpDayResult>(mcp, 'get_day', args);
    expect(day.entries).toEqual([]);
    const week = await call<McpWeekResult>(mcp, 'get_week', { date: '2025-03-30' });
    expect(Object.keys(week.days)).toEqual(['2025-03-24', '2025-03-25', '2025-03-26', '2025-03-27', '2025-03-28', '2025-03-29', '2025-03-30']);
    expect(week.totals).toEqual(ZERO);
    const meals = await call<McpMealsResult>(mcp, 'get_meals', { start_date: '2024-02-28', end_date: '2024-03-01' });
    expect(Object.keys(meals.days)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    const summary = await call<McpSummaryResult>(mcp, 'get_summary', { start_date: '2024-01-01', end_date: '2024-12-31' });
    expect(summary.days_total).toBe(366);
    expect(summary.average_on_logged_days).toBeNull();
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: "%' OR 1=1 --" })).products).toEqual([]);
    for (const [name, input] of [
      ['get_day', { ...args, date: '2023-02-29' }],
      ['get_week', { ...args, date: '2024-04-31' }],
      ['get_week', { ...args, date: '2024-01-01T00:00:00Z' }],
      ['get_day', { ...args, user_id: 0 }],
      ['get_day', { ...args, user_id: 1.5 }],
      ['get_day', { ...args, user_id: '1 OR 1=1' }],
      ['get_day', {}],
      ['get_day', { ...args, sql: 'DELETE FROM users' }],
      ['get_day', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_meals', {}],
      ['get_meals', { start_date: '2024-01-01' }],
      ['get_meals', { start_date: '2023-02-29', end_date: '2023-03-01' }],
      ['get_meals', { start_date: '2024-04-01', end_date: '2024-04-31' }],
      ['get_meals', { start_date: '2024-01-01T00:00:00Z', end_date: '2024-01-02' }],
      ['get_meals', { start_date: '2024-03-01', end_date: '2024-02-29' }],
      ['get_meals', { start_date: '2025-01-01', end_date: '2025-02-01' }],
      ['get_meals', { start_date: '2025-01-01', end_date: '2025-01-01', user_id: 1 }],
      ['get_meals', { start_date: '2025-01-01', end_date: '2025-01-01', sql: 'DELETE FROM users' }],
      ['get_week', { ...args, user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { user_id: Number.MAX_SAFE_INTEGER }],
      ['get_weighins', { start_date: '2031-04-03', end_date: '2031-04-01' }],
      ['get_weighins', { start_date: '2031-02-30' }],
      ['get_weighins', { limit: 501 }],
      ['get_summary', {}],
      ['get_summary', { start_date: '2024-01-01' }],
      ['get_summary', { start_date: '2023-02-29', end_date: '2023-03-01' }],
      ['get_summary', { start_date: '2024-04-01', end_date: '2024-04-31' }],
      ['get_summary', { start_date: '2024-01-01T00:00:00Z', end_date: '2024-01-02' }],
      ['get_summary', { start_date: '2024-03-01', end_date: '2024-02-29' }],
      ['get_summary', { start_date: '2024-01-01', end_date: '2025-01-01' }],
      ['get_summary', { start_date: '2024-01-01', end_date: '2024-01-01', user_id: 1 }],
      ['get_summary', { start_date: '2024-01-01', end_date: '2024-01-01', sql: 'DELETE FROM users' }],
      ['search_products', {}],
      ['search_products', { query: '' }],
      ['search_products', { query: '  ' }],
      ['search_products', { query: 1 }],
      ['search_products', { query: 'food', user_id: 1 }],
      ['search_products', { query: 'food', global: true }],
      ['search_products', { query: 'food', sql: 'DELETE FROM users' }],
      ['list_users', { limit: 0 }],
      ['list_users', { limit: 1.5 }],
      ['list_users', { offset: -1 }],
      ['list_users', { offset: Number.MAX_SAFE_INTEGER }],
      ['list_users', { table: 'sessions' }],
    ] as const) {
      const result = await mcp.callTool({ name, arguments: input });
      expect(result.isError, `${name}: ${JSON.stringify(input)}`).toBe(true);
      expect(result.content).toEqual([{ type: 'text', text: expect.any(String) }]);
      expect(result.structuredContent).toBeUndefined();
    }
    const unknown = await request.post('/mcp', {
      headers: mcpHeaders,
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_sql', arguments: { sql: 'DELETE FROM users' } } },
    });
    const unknownBody = await unknown.json();
    expect(unknownBody.error ?? unknownBody.result?.isError).toBeTruthy();
    expect(snapshot()).toEqual(before);
  } finally {
    db.close();
  }
});

test('[J-192] MCP protects discovery and calls from invalid tokens and browser origins', async ({ request, account: { token }, mcpHeaders }) => {
  for (const method of ['initialize', 'tools/list', 'tools/call']) {
    for (const authorization of ['', 'Basic invalid', 'Bearer kcal-e2e-admin-token-not-for-production', `Bearer ${token}`]) {
      const response = await request.post('/mcp', {
        headers: { ...MCP_HEADERS, Authorization: authorization }, data: { jsonrpc: '2.0', id: 1, method },
      });
      expect(response.status()).toBe(401);
      expect((await response.json()).error).toBe('invalid_token');
      expect(response.headers()['www-authenticate']).toContain('resource_metadata=');
    }
  }
  for (const origin of ['https://untrusted.example', 'http://localhost:3001', 'null']) {
    const response = await request.post('/mcp', { headers: { ...mcpHeaders, Origin: origin }, data: {} });
    expect(response.status()).toBe(403);
  }
  for (const method of ['GET', 'DELETE']) {
    const response = await request.fetch('/mcp', { method, headers: mcpHeaders });
    expect(response.status()).toBe(405);
    expect(response.headers()['allow']).toBe('POST');
  }
  const missing = await request.get('/mcp/missing', { headers: mcpHeaders });
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({ error: 'not found' });
  const malformed = await request.post('/mcp', { headers: mcpHeaders, data: { invalid: true } });
  expect(malformed.status()).toBe(400);
  expect((await malformed.json()).error).toBeTruthy();
});

test('[J-193] MCP stays disabled without a public origin and rejects unsafe origins', async ({ request }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kcal-mcp-env-'));
  try {
    for (const origin of [undefined, '', 'http://public.example', 'https://public.example/path']) {
      // Listen on an OS-assigned port in an isolated child. This imports the
      // real router and env gate without touching the suite server or .env.
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env, PORT: '3000', DATABASE_PATH: path.join(directory, 'app.db'),
        TEST_MODE: 'true', POSTMARK_SERVER_TOKEN: 'unused', POSTMARK_FROM: 'test@test.local',
        SESSION_EXPIRY_DAYS: '7', LOGIN_CODE_EXPIRY_MINUTES: '10', AI_SCAN_DAILY_CAP: '100', LOG_LEVEL: 'warn',
      };
      delete childEnv.PUBLIC_ORIGIN;
      if (origin !== undefined) childEnv.PUBLIC_ORIGIN = origin;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
        import './server/env.ts';
        import express from 'express';
        import { mcpRouter } from './server/routes/mcp.ts';
        const app = express();
        app.use(express.json());
        app.use('/mcp', mcpRouter);
        const server = app.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
      `], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });
      const exited = once(child, 'exit');
      try {
        await expect.poll(() => stdout.trim() !== '' || child.exitCode !== null, { timeout: 10_000 }).toBe(true);
        if (origin) {
          expect(child.exitCode).toBe(1);
          expect(stderr).toContain('PUBLIC_ORIGIN must be an HTTPS origin');
        } else {
          expect(child.exitCode, stderr).toBeNull();
          const url = `http://127.0.0.1:${stdout.trim()}/mcp`;
          for (const method of ['GET', 'POST']) {
            const response = await request.fetch(url, { method, headers: MCP_HEADERS });
            expect(response.status()).toBe(404);
            expect(await response.json()).toEqual({ error: 'not found' });
          }
        }
      } finally {
        if (child.exitCode === null) child.kill('SIGTERM');
        await exited;
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
