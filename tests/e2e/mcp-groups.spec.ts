import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import type {
  EntryGroup, EntryWithMacros, McpDayResult, McpEntryDeleteResult, McpEntryGroupDeleteResult,
  McpEntryGroupResult, McpEntryWriteResult, McpMealsResult, McpProductWriteResult,
  McpUngroupResult, McpWeekResult, Product,
} from '../../shared/types';
import { signInFresh } from './helpers';
import { BrowserOAuth, connectMcp } from './oauth-helpers';

const GROUP_TOOLS = [
  'create_entry_group', 'delete_entry_group', 'set_entry_group_tagged', 'ungroup_entries', 'update_entry_group',
];
const NUTRITION = { kcal: 200, protein: 10, carbs: 20, fat: 5 };

type Account = { token: string; user: { id: number; email: string } };
type Connection = Awaited<ReturnType<typeof connectMcp>>;

const test = base.extend<{ account: Account; connection: Connection; mcp: Client }>({
  account: async ({ page, request }, use) => {
    await use(await freshUser(page, request, 'mcp-group'));
  },
  connection: async ({ page, account }, use) => {
    void account;
    const connection = await connectMcp(page, new BrowserOAuth('none', 'kcal:read kcal:write'));
    try { await use(connection); } finally { await connection.mcp.close(); }
  },
  mcp: async ({ connection }, use) => { await use(connection.mcp); },
});

test.use({ storageState: { cookies: [], origins: [] } });

async function freshUser(page: Page, request: APIRequestContext, prefix: string): Promise<Account> {
  await signInFresh(page, request, prefix);
  return page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('kcal_user')!) as Account['user'];
    return { token: localStorage.getItem('kcal_session_token')!, user: { id: user.id, email: user.email } };
  });
}

async function call<T>(mcp: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcp.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, `${name}: ${JSON.stringify(result)}`).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  return result.structuredContent as T;
}

async function reject(mcp: Client, name: string, args: Record<string, unknown>, error?: string) {
  const result = await mcp.callTool({ name, arguments: args }) as CallToolResult;
  expect(result.isError, `${name}: ${JSON.stringify(args)}`).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toEqual([{ type: 'text', text: error ?? expect.any(String) }]);
}

async function rest<T>(
  request: APIRequestContext, token: string, method: 'get' | 'post' | 'patch', url: string, data?: unknown,
): Promise<T> {
  const response = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

async function createProduct(mcp: Client, name: string): Promise<Product> {
  return (await call<McpProductWriteResult>(mcp, 'create_product', { name, unit: 'g', per100: NUTRITION })).product;
}

async function createEntry(
  mcp: Client, product_id: number, local_date: string, grams = 100, local_time = '12:30',
): Promise<EntryWithMacros> {
  return (await call<McpEntryWriteResult>(mcp, 'create_entry', { product_id, grams, local_date, local_time })).entry;
}

async function createGroup(mcp: Client, name: string, entry_ids: number[]): Promise<McpEntryGroupResult> {
  return call<McpEntryGroupResult>(mcp, 'create_entry_group', { name, entry_ids });
}

function storedRecords() {
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  try {
    return ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights']
      .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  } finally {
    db.close();
  }
}

test('[J-218] MCP group tools declare write schemas and read-only tokens cannot mutate groups', async ({ page, mcp, account }) => {
  const { tools } = await mcp.listTools();
  const fields: Record<string, string[]> = {
    create_entry_group: ['user_id', 'group', 'entries'],
    update_entry_group: ['user_id', 'group', 'entries'],
    set_entry_group_tagged: ['user_id', 'group', 'entries'],
    ungroup_entries: ['user_id', 'ok', 'group_id', 'entries'],
    delete_entry_group: ['user_id', 'ok', 'group_id', 'deleted_entry_ids'],
  };
  for (const name of GROUP_TOOLS) {
    const tool = tools.find((item) => item.name === name)!;
    expect(tool, name).toBeDefined();
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false, destructiveHint: name !== 'create_entry_group',
      idempotentHint: name !== 'create_entry_group', openWorldHint: false,
    });
    expect(tool.inputSchema.properties).not.toHaveProperty('user_id');
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.outputSchema!.properties ?? {}).sort()).toEqual(fields[name]!.sort());
    expect(tool.outputSchema!.required).toEqual(expect.arrayContaining(fields[name]!));
  }

  const product = await createProduct(mcp, `MCP group scope ${account.user.id}`);
  const entries: EntryWithMacros[] = [];
  for (let i = 0; i < 4; i++) entries.push(await createEntry(mcp, product.id, '2024-02-29'));
  const group = await createGroup(mcp, 'Scope group', [entries[0]!.id, entries[1]!.id]);
  const readOnly = await connectMcp(page);
  try {
    const readNames = (await readOnly.mcp.listTools()).tools.map((tool) => tool.name);
    for (const name of GROUP_TOOLS) expect(readNames).not.toContain(name);
    expect((await call<McpDayResult>(readOnly.mcp, 'get_day', { date: '2024-02-29' })).entries.slice(0, 2))
      .toEqual(group.entries);
    await page.close(); // Stop app-session revalidation during the database snapshot.
    const before = storedRecords();
    for (const [name, args] of [
      ['create_entry_group', { name: 'Denied group', entry_ids: [entries[2]!.id, entries[3]!.id] }],
      ['update_entry_group', { group_id: group.group.id, name: 'Denied rename' }],
      ['set_entry_group_tagged', { group_id: group.group.id, tagged: true }],
      ['ungroup_entries', { group_id: group.group.id }],
      ['delete_entry_group', { group_id: group.group.id }],
    ] as const) await reject(readOnly.mcp, name, args);
    expect(storedRecords()).toEqual(before);
  } finally {
    await readOnly.mcp.close();
  }
});

test('[J-219] MCP group create rename tag and ungroup preserve totals and appear after UI reload', async ({ page, request, mcp, account }) => {
  const date = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const product = await createProduct(mcp, `MCP visible group ${account.user.id}`);
  const first = await createEntry(mcp, product.id, date, 62.5, '08:15');
  const second = await createEntry(mcp, product.id, date, 37.5, '19:45');
  const loose = await createEntry(mcp, product.id, date, 25, '21:10');
  const taggedFirst = (await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: first.id, tagged: true })).entry;
  const baseline = await call<McpDayResult>(mcp, 'get_day', { date });
  const baselineWeek = await call<McpWeekResult>(mcp, 'get_week', { date });
  const assertTotals = async (entries: EntryWithMacros[]) => {
    const day = await call<McpDayResult>(mcp, 'get_day', { date });
    expect(day.entries).toEqual([...entries, loose]);
    expect(day.entries).toEqual(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`));
    expect(day.totals).toEqual(baseline.totals);
    expect(await call<McpWeekResult>(mcp, 'get_week', { date })).toEqual(baselineWeek);
    const meals = await call<McpMealsResult>(mcp, 'get_meals', { start_date: date, end_date: date });
    expect(meals.days[date]).toEqual({ entries: day.entries, totals: day.totals });
  };

  const name = `MCP Mixed Meal ${account.user.id}`;
  const created = await createGroup(mcp, `  MCP   Mixed\nMeal ${account.user.id}  `, [second.id, first.id]);
  expect(created).toEqual({
    user_id: account.user.id, group: { id: expect.any(Number), name, local_date: date },
    entries: [taggedFirst, second].map((entry) => ({ ...entry, group: { id: created.group.id, name } })),
  });
  await assertTotals(created.entries);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  const parent = (groupName: string) => page.locator('.entry-group').filter({ hasText: groupName });
  await expect(parent(name)).toContainText('2 items');
  await expect(parent(name).getByRole('button', { name: `Mark ${name} as eaten`, exact: true }))
    .toHaveAttribute('aria-pressed', 'mixed');
  await expect(page.locator('.food-row')).toHaveCount(1);
  await page.getByRole('button', { name: `Expand ${name}`, exact: true }).tap();
  await expect(page.locator('.food-row')).toHaveCount(3);
  await assertTotals(created.entries);

  const renamedName = `MCP Renamed Meal ${account.user.id}`;
  const renamed = await call<McpEntryGroupResult>(mcp, 'update_entry_group', {
    group_id: created.group.id, name: `  MCP   Renamed Meal ${account.user.id} `,
  });
  expect(renamed).toEqual({ user_id: account.user.id,
    group: { ...created.group, name: renamedName },
    entries: created.entries.map((entry) => ({ ...entry, group: { id: created.group.id, name: renamedName } })),
  });
  await assertTotals(renamed.entries);
  await page.reload();
  await expect(parent(renamedName)).toBeVisible();
  await expect(parent(name)).toHaveCount(0);

  for (const tagged of [true, false]) {
    const result = await call<McpEntryGroupResult>(mcp, 'set_entry_group_tagged', { group_id: created.group.id, tagged });
    expect(result).toEqual({ user_id: account.user.id, group: renamed.group,
      entries: renamed.entries.map((entry) => ({ ...entry, tagged })),
    });
    expect(await call(mcp, 'set_entry_group_tagged', { group_id: created.group.id, tagged })).toEqual(result);
    await assertTotals(result.entries);
    await page.reload();
    await expect(parent(renamedName).getByRole('button', {
      name: `Mark ${renamedName} as ${tagged ? 'not eaten' : 'eaten'}`, exact: true,
    })).toHaveAttribute('aria-pressed', String(tagged));
  }

  // Keep a mixed tag state through Ungroup to verify each child's value survives.
  await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: first.id, tagged: true });
  const ungrouped = await call<McpUngroupResult>(mcp, 'ungroup_entries', { group_id: created.group.id });
  expect(ungrouped).toEqual({ user_id: account.user.id, ok: true, group_id: created.group.id,
    entries: [taggedFirst, second],
  });
  await assertTotals(ungrouped.entries);
  await page.reload();
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  await expect(page.locator('.entry-group')).toHaveCount(0);
  await expect(page.locator('.food-row')).toHaveCount(3);
  await expect(page.locator('.food-row').filter({ hasText: '62.5g' })
    .getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
  await reject(mcp, 'ungroup_entries', { group_id: created.group.id }, 'not_found');
});

test('[J-220] MCP groups reject invalid memberships and unsupported edits without partial changes', async ({ page, request, mcp, account }) => {
  const product = await createProduct(mcp, `MCP group validation ${account.user.id}`);
  const date = '2024-02-29';
  const a = await createEntry(mcp, product.id, date);
  const b = await createEntry(mcp, product.id, date);
  const c = await createEntry(mcp, product.id, date);
  const d = await createEntry(mcp, product.id, date);
  const future = await createEntry(mcp, product.id, '2024-03-01');
  const group = await createGroup(mcp, `  ${'N'.repeat(64)}  `, [c.id, d.id]);
  expect(group.group.name).toBe('N'.repeat(64));
  const creation = { name: 'Valid name', entry_ids: [a.id, b.id] };
  const rename = { group_id: group.group.id, name: 'Valid rename' };
  await page.close();
  const before = storedRecords();
  for (const [name, args] of [
    ['create_entry_group', {}],
    ['create_entry_group', { ...creation, entry_ids: [] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, a.id] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, a.id, b.id] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, 0] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, -1] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, 1.5] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, String(b.id)] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, future.id] }],
    ['create_entry_group', { ...creation, entry_ids: [a.id, c.id] }],
    ['create_entry_group', { ...creation, entry_ids: [c.id, d.id] }],
    ['create_entry_group', { ...creation, name: '' }],
    ['create_entry_group', { ...creation, name: ' \n\t ' }],
    ['create_entry_group', { ...creation, name: 'N'.repeat(65) }],
    ['create_entry_group', { ...creation, name: null }],
    ['create_entry_group', { ...creation, local_date: date }],
    ['create_entry_group', { ...creation, group_id: group.group.id }],
    ['create_entry_group', { ...creation, user_id: account.user.id }],
    ['update_entry_group', { group_id: group.group.id }],
    ['update_entry_group', { ...rename, group_id: 0 }],
    ['update_entry_group', { ...rename, name: '   ' }],
    ['update_entry_group', { ...rename, name: 'N'.repeat(65) }],
    ['update_entry_group', { ...rename, name: null }],
    ['update_entry_group', { ...rename, entry_ids: [a.id, b.id] }],
    ['update_entry_group', { ...rename, local_date: '2024-03-01' }],
    ['update_entry_group', { ...rename, grams: 200 }],
    ['update_entry_group', { ...rename, per100: NUTRITION }],
    ['update_entry_group', { ...rename, tagged: true }],
    ['update_entry_group', { ...rename, user_id: account.user.id }],
    ['set_entry_group_tagged', { group_id: group.group.id }],
    ['set_entry_group_tagged', { group_id: group.group.id, tagged: 'true' }],
    ['set_entry_group_tagged', { group_id: group.group.id, tagged: 1 }],
    ['set_entry_group_tagged', { group_id: group.group.id, tagged: true, entry_ids: [c.id] }],
    ['set_entry_group_tagged', { group_id: group.group.id, tagged: true, user_id: account.user.id }],
    ['ungroup_entries', { group_id: 0 }],
    ['ungroup_entries', { group_id: group.group.id, entry_ids: [c.id] }],
    ['ungroup_entries', { group_id: group.group.id, user_id: account.user.id }],
    ['delete_entry_group', { group_id: 1.5 }],
    ['delete_entry_group', { group_id: group.group.id, entry_ids: [c.id] }],
    ['delete_entry_group', { group_id: group.group.id, user_id: account.user.id }],
  ] as const) await reject(mcp, name, args);
  expect(storedRecords()).toEqual(before);

  // Simulate legacy stored values independently of current REST validation.
  const impossibleA = await createEntry(mcp, product.id, '2024-02-28');
  const impossibleB = await createEntry(mcp, product.id, '2024-02-28');
  const extremeA = await createEntry(mcp, product.id, '2024-03-02');
  const extremeB = await createEntry(mcp, product.id, '2024-03-02');
  const extremeGroup = await rest<EntryGroup>(request, account.token, 'post', '/entries/groups', {
    name: 'Legacy extreme group', entry_ids: [extremeA.id, extremeB.id],
  });
  const db = new Database('/tmp/kcal-e2e.db');
  try {
    db.prepare('UPDATE entries SET local_date = ? WHERE user_id = ? AND id IN (?, ?)')
      .run('2024-02-30', account.user.id, impossibleA.id, impossibleB.id);
    db.prepare('UPDATE entries SET grams = ? WHERE user_id = ? AND id = ?')
      .run(1e308, account.user.id, extremeA.id);
  } finally {
    db.close();
  }
  const beforeLegacyRejections = storedRecords();
  await reject(mcp, 'create_entry_group', { name: 'Impossible date', entry_ids: [impossibleA.id, impossibleB.id] });
  for (const [name, args] of [
    ['update_entry_group', { group_id: extremeGroup.id, name: 'Must roll back' }],
    ['set_entry_group_tagged', { group_id: extremeGroup.id, tagged: true }],
    ['ungroup_entries', { group_id: extremeGroup.id }],
  ] as const) await reject(mcp, name, args, 'write_failed');
  expect(storedRecords()).toEqual(beforeLegacyRejections);
});

test('[J-221] MCP groups isolate owners and reject missing or mixed-owner resources atomically', async ({ page, browser, request, mcp, account }) => {
  const date = '2024-05-01';
  const ownProduct = await createProduct(mcp, `MCP group owner ${account.user.id}`);
  const ownA = await createEntry(mcp, ownProduct.id, date);
  const ownB = await createEntry(mcp, ownProduct.id, date);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const otherPage = await context.newPage();
    const other = await freshUser(otherPage, request, 'mcp-group-other');
    const otherConnection = await connectMcp(otherPage, new BrowserOAuth('none', 'kcal:read kcal:write'));
    try {
      const foreignProduct = await createProduct(otherConnection.mcp, `MCP foreign group ${other.user.id}`);
      const foreignEntries: EntryWithMacros[] = [];
      for (let i = 0; i < 4; i++) foreignEntries.push(await createEntry(otherConnection.mcp, foreignProduct.id, date));
      const foreignGroup = await createGroup(otherConnection.mcp, 'Foreign meal', [foreignEntries[2]!.id, foreignEntries[3]!.id]);
      await otherPage.close();
      await page.close();
      const before = storedRecords();
      for (const entry_ids of [
        [ownA.id, foreignEntries[0]!.id],
        [foreignEntries[0]!.id, ownA.id],
        [foreignEntries[0]!.id, foreignEntries[1]!.id],
        [ownA.id, Number.MAX_SAFE_INTEGER],
      ]) await reject(mcp, 'create_entry_group', { name: 'Denied meal', entry_ids }, 'not_found');
      for (const group_id of [foreignGroup.group.id, Number.MAX_SAFE_INTEGER]) {
        await reject(mcp, 'update_entry_group', { group_id, name: 'Stolen meal' }, 'not_found');
        await reject(mcp, 'set_entry_group_tagged', { group_id, tagged: true }, 'not_found');
        await reject(mcp, 'ungroup_entries', { group_id }, 'not_found');
        await reject(mcp, 'delete_entry_group', { group_id }, 'not_found');
      }
      expect(storedRecords()).toEqual(before);
      expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries).toEqual([ownA, ownB]);
      expect((await call<McpDayResult>(otherConnection.mcp, 'get_day', { date })).entries)
        .toEqual([...foreignEntries.slice(0, 2), ...foreignGroup.entries]);
      const ownGroup = await createGroup(mcp, 'Owned meal', [ownA.id, ownB.id]);
      const afterOwnedGroup = storedRecords();
      await reject(otherConnection.mcp, 'delete_entry_group', { group_id: ownGroup.group.id }, 'not_found');
      expect(storedRecords()).toEqual(afterOwnedGroup);
    } finally {
      await otherConnection.mcp.close();
    }
  } finally {
    await context.close();
  }
});

test('[J-222] MCP groups support temporary children and deletion while preserving library products', async ({ request, mcp, account }) => {
  const date = '2024-05-01';
  const saved = await createProduct(mcp, `MCP group saved ${account.user.id}`);
  const temporary = await rest<Product>(request, account.token, 'post', '/products', {
    name: `MCP group temporary ${account.user.id}`, brand: null, barcode: null,
    unit: 'ml', per100: NUTRITION, is_temp: true,
  });
  // The UI creates and logs temporary foods through REST; MCP can manage that existing log.
  const tempEntry = await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
    product_id: temporary.id, grams: 50, local_date: date, local_time: '08:00',
  });
  const savedA = await createEntry(mcp, saved.id, date, 100);
  const savedB = await createEntry(mcp, saved.id, date, 25);
  const group = await createGroup(mcp, 'Temporary and saved', [savedB.id, tempEntry.id, savedA.id]);
  expect(group.entries.map((entry) => entry.id)).toEqual([tempEntry.id, savedA.id, savedB.id]);
  expect(group.entries[0]!.product.is_temp).toBe(true);
  const groupRef = { id: group.group.id, name: group.group.name };
  const changed = await call<McpEntryWriteResult>(mcp, 'update_entry', { entry_id: tempEntry.id, grams: 75, tagged: true });
  expect(changed.entry).toEqual({ ...tempEntry, grams: 75, tagged: true, group: groupRef,
    macros: { kcal: 150, protein: 7.5, carbs: 15, fat: 3.75 },
  });
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).totals)
    .toEqual({ kcal: 400, protein: 20, carbs: 40, fat: 10 });
  const tagged = await call<McpEntryGroupResult>(mcp, 'set_entry_group_tagged', { group_id: group.group.id, tagged: true });
  expect(tagged.entries.every((entry) => entry.tagged)).toBe(true);
  expect(await call<McpEntryDeleteResult>(mcp, 'delete_entry', { entry_id: savedB.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: savedB.id, dissolved_group_id: null,
  });
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries.map((entry) => entry.group)).toEqual([groupRef, groupRef]);
  expect(await call<McpEntryDeleteResult>(mcp, 'delete_entry', { entry_id: savedA.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: savedA.id, dissolved_group_id: group.group.id,
  });
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries).toEqual([{ ...changed.entry, group: null }]);
  await reject(mcp, 'update_entry_group', { group_id: group.group.id, name: 'Dissolved' }, 'not_found');

  const replacement = await createEntry(mcp, saved.id, date, 25);
  const loose = await createEntry(mcp, saved.id, date, 10);
  const outside = await createEntry(mcp, saved.id, '2024-05-02', 20);
  const deleteGroup = await createGroup(mcp, 'Delete both logs', [replacement.id, tempEntry.id]);
  const productsBefore = await rest<Product[]>(request, account.token, 'get', '/products/all');
  const beforeWeek = await call<McpWeekResult>(mcp, 'get_week', { date });
  expect(beforeWeek.totals).toEqual({ kcal: 260, protein: 13, carbs: 26, fat: 6.5 });
  expect(await call<McpEntryGroupDeleteResult>(mcp, 'delete_entry_group', { group_id: deleteGroup.group.id })).toEqual({
    user_id: account.user.id, ok: true, group_id: deleteGroup.group.id,
    deleted_entry_ids: [tempEntry.id, replacement.id],
  });
  const day = await call<McpDayResult>(mcp, 'get_day', { date });
  expect(day.entries).toEqual([loose]);
  expect(day.totals).toEqual(loose.macros);
  expect(day.entries).toEqual(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`));
  expect((await call<McpDayResult>(mcp, 'get_day', { date: outside.local_date })).entries).toEqual([outside]);
  expect((await call<McpWeekResult>(mcp, 'get_week', { date })).totals)
    .toEqual({ kcal: 60, protein: 3, carbs: 6, fat: 1.5 });
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual(productsBefore);
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  try {
    expect(db.prepare('SELECT id FROM products WHERE created_by = ? AND id = ?').get(account.user.id, temporary.id))
      .toEqual({ id: temporary.id });
    expect(db.prepare('SELECT id FROM entry_groups WHERE user_id = ?').all(account.user.id)).toEqual([]);
  } finally {
    db.close();
  }
  await reject(mcp, 'delete_entry_group', { group_id: deleteGroup.group.id }, 'not_found');
  await reject(mcp, 'ungroup_entries', { group_id: deleteGroup.group.id }, 'not_found');
});
