import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Database from 'better-sqlite3';
import type {
  EntryGroup, EntryWithMacros, McpDayResult, McpProductSearchResult, Product,
  McpEntryWriteResult as EntryResult, McpEntryDeleteResult as DeleteEntryResult,
  McpProductWriteResult as ProductResult, McpProductDeleteResult as DeleteProductResult,
} from '../../shared/types';
import { fillNutField, signInFresh } from './helpers';
import { BrowserOAuth, connectMcp } from './oauth-helpers';

const READ_TOOLS = ['get_day', 'get_meals', 'get_summary', 'get_week', 'get_weighins', 'search_products'];
const WRITE_TOOLS = [
  'create_entry', 'create_entry_group', 'create_product', 'delete_entry', 'delete_entry_group',
  'delete_product', 'set_entry_group_tagged', 'ungroup_entries', 'update_entry',
  'update_entry_group', 'update_product',
];
const NUTRITION = { kcal: 200, protein: 10, carbs: 20, fat: 5 };
const ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

type Account = { token: string; user: { id: number; email: string } };
type Connection = Awaited<ReturnType<typeof connectMcp>>;

const test = base.extend<{ account: Account; connection: Connection; mcp: Client }>({
  account: async ({ page, request }, use) => {
    await use(await freshUser(page, request, 'mcp-write'));
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
  request: APIRequestContext, token: string, method: 'get' | 'post' | 'put' | 'patch', url: string,
  data?: unknown,
): Promise<T> {
  const response = await request[method](url, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}

async function createProduct(mcp: Client, name: string, extra: Record<string, unknown> = {}): Promise<Product> {
  return (await call<ProductResult>(mcp, 'create_product', { name, unit: 'g', per100: NUTRITION, ...extra })).product;
}

async function createEntry(mcp: Client, product_id: number, local_date: string, grams = 100): Promise<EntryWithMacros> {
  return (await call<EntryResult>(mcp, 'create_entry', { product_id, grams, local_date, local_time: '12:30' })).entry;
}

function storedRecords(options: { ignoreSessionActivity?: boolean } = {}) {
  const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
  try {
    return ['users', 'sessions', 'products', 'entries', 'entry_groups', 'weights']
      .map((table) => {
        const columns = table === 'sessions' && options.ignoreSessionActivity
          ? 'token, user_id, created_at'
          : '*';
        return db.prepare(`SELECT ${columns} FROM ${table} ORDER BY rowid`).all();
      });
  } finally {
    db.close();
  }
}

test('[J-205] MCP write scopes advertise mutation schemas and deny writes to read-only tokens', async ({ page, request, mcp, connection, account }) => {
  expect(connection.oauth.savedTokens!.scope!.split(' ').sort()).toEqual(['kcal:read', 'kcal:write']);
  const { tools } = await mcp.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
  const outputFields: Record<string, string[]> = {
    create_entry: ['user_id', 'entry'], update_entry: ['user_id', 'entry'],
    delete_entry: ['user_id', 'ok', 'entry_id', 'dissolved_group_id'],
    create_product: ['user_id', 'product'], update_product: ['user_id', 'product'],
    delete_product: ['user_id', 'ok', 'product_id', 'deleted_entry_count'],
    create_entry_group: ['user_id', 'group', 'entries'],
    update_entry_group: ['user_id', 'group', 'entries'],
    set_entry_group_tagged: ['user_id', 'group', 'entries'],
    ungroup_entries: ['user_id', 'ok', 'group_id', 'entries'],
    delete_entry_group: ['user_id', 'ok', 'group_id', 'deleted_entry_ids'],
  };
  for (const name of WRITE_TOOLS) {
    const tool = tools.find((item) => item.name === name)!;
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false, destructiveHint: !name.startsWith('create_'), openWorldHint: false,
      idempotentHint: !name.startsWith('create_'),
    });
    expect(tool.inputSchema.properties).not.toHaveProperty('user_id');
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(Object.keys(tool.outputSchema!.properties ?? {}).sort()).toEqual(outputFields[name]!.sort());
    expect(tool.outputSchema!.required).toEqual(expect.arrayContaining(outputFields[name]!));
  }

  const product = await createProduct(mcp, `MCP scope ${account.user.id}`);
  const entry = await createEntry(mcp, product.id, '2024-02-29');
  const ungrouped = [await createEntry(mcp, product.id, '2024-03-01'), await createEntry(mcp, product.id, '2024-03-01')];
  const grouped = [await createEntry(mcp, product.id, '2024-03-02'), await createEntry(mcp, product.id, '2024-03-02')];
  const group = await rest<EntryGroup>(request, account.token, 'post', '/entries/groups', {
    name: `MCP scoped group ${account.user.id}`, entry_ids: grouped.map((item) => item.id),
  });
  const readOnly = await connectMcp(page);
  try {
    expect((await readOnly.mcp.listTools()).tools.map((tool) => tool.name).sort()).toEqual(READ_TOOLS);
    expect((await call<McpDayResult>(readOnly.mcp, 'get_day', { date: entry.local_date })).entries).toEqual([entry]);
    // Closing the page also stops app-session revalidation during the snapshot.
    await page.close();
    const before = storedRecords();
    for (const [name, args] of [
      ['create_entry', { product_id: product.id, grams: 50, local_date: entry.local_date, local_time: '09:00' }],
      ['update_entry', { entry_id: entry.id, grams: 50 }],
      ['delete_entry', { entry_id: entry.id }],
      ['create_product', { name: `MCP denied ${account.user.id}`, unit: 'g', per100: NUTRITION }],
      ['update_product', { product_id: product.id, name: 'Denied' }],
      ['delete_product', { product_id: product.id }],
      ['create_entry_group', { name: 'Denied group', entry_ids: ungrouped.map((item) => item.id) }],
      ['update_entry_group', { group_id: group.id, name: 'Denied rename' }],
      ['set_entry_group_tagged', { group_id: group.id, tagged: true }],
      ['ungroup_entries', { group_id: group.id }],
      ['delete_entry_group', { group_id: group.id }],
    ] as const) await reject(readOnly.mcp, name, args);
    expect(storedRecords()).toEqual(before);
  } finally {
    await readOnly.mcp.close();
  }
});

test('[J-206] MCP product creates and partial edits match REST and recalculate logged nutrition', async ({ request, mcp, account }) => {
  const name = `MCP PRODUCT ${account.user.id}`;
  const created = await call<ProductResult>(mcp, 'create_product', { name: `  ${name}  `, unit: 'g', per100: NUTRITION });
  const product = created.product;
  expect(created.user_id).toBe(account.user.id);
  expect(product).toEqual({ id: expect.any(Number), name: `Mcp product ${account.user.id}`,
    brand: null, barcode: null, unit: 'g', per100: NUTRITION, is_temp: false });
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([product]);
  const entry = await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
    product_id: product.id, grams: 150, local_date: '2024-02-29', local_time: '08:15',
  });
  expect(entry.macros).toEqual({ kcal: 300, protein: 15, carbs: 30, fat: 7.5 });

  const metadata = await call<ProductResult>(mcp, 'update_product', {
    product_id: product.id, name: `  UPDATED   PRODUCT ${account.user.id} `,
    brand: '  mY   MAKER ', barcode: `  mcp-partial-${account.user.id}  `, unit: 'ml',
  });
  expect(metadata).toEqual({ user_id: account.user.id, product: {
    ...product, name: `Updated product ${account.user.id}`, brand: 'My Maker',
    barcode: `mcp-partial-${account.user.id}`, unit: 'ml',
  } });
  const nutrition = await call<ProductResult>(mcp, 'update_product', {
    product_id: product.id, per100: { kcal: 300, protein: 20 },
  });
  expect(nutrition.product).toEqual({ ...metadata.product, per100: { ...NUTRITION, kcal: 300, protein: 20 } });
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([nutrition.product]);
  const day = await call<McpDayResult>(mcp, 'get_day', { date: entry.local_date });
  expect(day.entries).toEqual(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${entry.local_date}`));
  expect(day.entries).toEqual([{ ...entry, product: nutrition.product, macros: { kcal: 450, protein: 30, carbs: 30, fat: 7.5 } }]);
  expect(day.totals).toEqual({ kcal: 450, protein: 30, carbs: 30, fat: 7.5 });

  const cleared = await call<ProductResult>(mcp, 'update_product', { product_id: product.id, brand: null, barcode: null });
  expect(cleared.product).toEqual({ ...nutrition.product, brand: null, barcode: null });
  const blank = await call<ProductResult>(mcp, 'update_product', { product_id: product.id, brand: '   ', barcode: '   ' });
  expect(blank).toEqual(cleared);
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([cleared.product]);
});

test('[J-207] MCP entry create update and delete match REST and preserve or dissolve groups', async ({ request, mcp, account }) => {
  const product = await createProduct(mcp, `MCP entry ${account.user.id}`);
  const date = '2024-02-29';
  const first = await createEntry(mcp, product.id, date, 62.5);
  expect(first).toMatchObject({ product, grams: 62.5, local_date: date, local_time: '12:30',
    macros: { kcal: 125, protein: 6.25, carbs: 12.5, fat: 3.125 }, tagged: false, group: null });
  expect(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`)).toEqual([first]);
  const edited = await call<EntryResult>(mcp, 'update_entry', { entry_id: first.id, grams: 150, tagged: true });
  expect(edited).toEqual({ user_id: account.user.id, entry: { ...first, grams: 150, tagged: true,
    macros: { kcal: 300, protein: 15, carbs: 30, fat: 7.5 } } });
  const untagged = await call<EntryResult>(mcp, 'update_entry', { entry_id: first.id, tagged: false });
  expect(untagged.entry).toEqual({ ...edited.entry, tagged: false });
  expect(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`)).toEqual([untagged.entry]);

  const second = await createEntry(mcp, product.id, date, 50);
  const third = await createEntry(mcp, product.id, date, 25);
  const group = await rest<EntryGroup>(request, account.token, 'post', '/entries/groups', {
    name: `MCP deletion group ${account.user.id}`, entry_ids: [first.id, second.id, third.id],
  });
  const groupRef = { id: group.id, name: group.name };
  const grouped = await call<EntryResult>(mcp, 'update_entry', { entry_id: third.id, tagged: true });
  expect(grouped.entry.group).toEqual(groupRef);

  expect(await call<DeleteEntryResult>(mcp, 'delete_entry', { entry_id: first.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: first.id, dissolved_group_id: null,
  });
  const two = await call<McpDayResult>(mcp, 'get_day', { date });
  expect(two.entries.map((entry) => entry.group)).toEqual([groupRef, groupRef]);
  expect(two.totals).toEqual({ kcal: 150, protein: 7.5, carbs: 15, fat: 3.75 });
  expect(await call<DeleteEntryResult>(mcp, 'delete_entry', { entry_id: second.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: second.id, dissolved_group_id: group.id,
  });
  const survivor = { ...third, tagged: true, group: null };
  expect(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`)).toEqual([survivor]);
  const one = await call<McpDayResult>(mcp, 'get_day', { date });
  expect(one.entries).toEqual([survivor]);
  expect(one.totals).toEqual(third.macros);
  expect(await call<DeleteEntryResult>(mcp, 'delete_entry', { entry_id: third.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: third.id, dissolved_group_id: null,
  });
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries).toEqual([]);
  await reject(mcp, 'delete_entry', { entry_id: third.id }, 'not_found');
});

test('[J-208] MCP writes reject foreign and missing products and entries without mutation', async ({ page, browser, request, mcp, account }) => {
  const ownProduct = await createProduct(mcp, `MCP owner ${account.user.id}`);
  const ownEntry = await createEntry(mcp, ownProduct.id, '2024-05-01');
  const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const otherPage = await otherContext.newPage();
    const other = await freshUser(otherPage, request, 'mcp-write-other');
    const foreign = await rest<Product>(request, other.token, 'post', '/products', {
      name: `MCP foreign ${other.user.id}`, brand: null, barcode: null, unit: 'g', per100: NUTRITION, is_temp: false,
    });
    const shared = await rest<Product>(request, other.token, 'post', '/products', {
      name: `MCP foreign shared ${other.user.id}`, brand: null, barcode: `mcp-foreign-${other.user.id}`,
      unit: 'g', per100: NUTRITION, is_temp: false,
    });
    const foreignEntry = await rest<EntryWithMacros>(request, other.token, 'post', '/entries', {
      product_id: foreign.id, grams: 100, local_date: ownEntry.local_date, local_time: '12:30',
    });
    await otherPage.close();
    await page.close();
    const before = storedRecords();
    const missingId = Number.MAX_SAFE_INTEGER;
    for (const product_id of [foreign.id, shared.id, missingId]) {
      await reject(mcp, 'create_entry', { product_id, grams: 100, local_date: ownEntry.local_date, local_time: '12:30' }, 'product_not_found');
      await reject(mcp, 'update_product', { product_id, name: 'Not owned' }, 'not_found');
      await reject(mcp, 'delete_product', { product_id }, 'not_found');
    }
    for (const entry_id of [foreignEntry.id, missingId]) {
      await reject(mcp, 'update_entry', { entry_id, grams: 1, tagged: true }, 'not_found');
      await reject(mcp, 'delete_entry', { entry_id }, 'not_found');
    }
    expect(storedRecords()).toEqual(before);
    expect((await call<McpDayResult>(mcp, 'get_day', { date: ownEntry.local_date })).entries).toEqual([ownEntry]);
  } finally {
    await otherContext.close();
  }
});

test('[J-209] MCP write validation rejects malformed and unsupported inputs without mutation', async ({ page, mcp, account, request }) => {
  const product = await createProduct(mcp, `MCP validation ${account.user.id}`);
  const entry = await createEntry(mcp, product.id, '2024-02-29');
  const newEntry = { product_id: product.id, grams: 100, local_date: entry.local_date, local_time: '12:30' };
  const newProduct = { name: `MCP invalid ${account.user.id}`, unit: 'g', per100: NUTRITION };
  await page.close();
  const before = storedRecords();
  for (const [name, args] of [
    ['create_entry', {}],
    ['create_entry', { ...newEntry, product_id: 0 }],
    ['create_entry', { ...newEntry, product_id: 1.5 }],
    ['create_entry', { ...newEntry, grams: 0 }],
    ['create_entry', { ...newEntry, grams: -1 }],
    ['create_entry', { ...newEntry, grams: 1e308 }],
    ['create_entry', { ...newEntry, grams: 1e306 }],
    ['create_entry', { ...newEntry, grams: '100' }],
    ['create_entry', { ...newEntry, local_date: '2023-02-29' }],
    ['create_entry', { ...newEntry, local_date: '2024-04-31' }],
    ['create_entry', { ...newEntry, local_date: '2024-02-29T00:00:00Z' }],
    ['create_entry', { ...newEntry, local_time: '24:00' }],
    ['create_entry', { ...newEntry, local_time: '12:60' }],
    ['create_entry', { ...newEntry, local_time: '9:00' }],
    ['create_entry', { ...newEntry, local_time: '12:30:00' }],
    ['create_entry', { ...newEntry, user_id: account.user.id }],
    ['create_entry', { ...newEntry, group_id: 1 }],
    ['update_entry', { entry_id: entry.id }],
    ['update_entry', { entry_id: 0, grams: 100 }],
    ['update_entry', { entry_id: entry.id, grams: -1, tagged: true }],
    ['update_entry', { entry_id: entry.id, grams: 1e308, tagged: true }],
    ['update_entry', { entry_id: entry.id, grams: 1e306 }],
    ['update_entry', { entry_id: entry.id, grams: 50, tagged: 'yes' }],
    ['update_entry', { entry_id: entry.id, grams: 50, local_date: '2024-03-01' }],
    ['update_entry', { entry_id: entry.id, tagged: true, user_id: account.user.id }],
    ['delete_entry', { entry_id: -1 }],
    ['delete_entry', { entry_id: entry.id, user_id: account.user.id }],
    ['create_product', {}],
    ['create_product', { ...newProduct, name: '   ' }],
    ['create_product', { ...newProduct, name: 'a'.repeat(201) }],
    ['create_product', { ...newProduct, brand: 'a'.repeat(121) }],
    ['create_product', { ...newProduct, barcode: 'a'.repeat(65) }],
    ['create_product', { ...newProduct, unit: 'kg' }],
    ['create_product', { ...newProduct, per100: { kcal: 200 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, kcal: 2001 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, protein: 201 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, carbs: 201 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, fat: 201 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, kcal: -1 } }],
    ['create_product', { ...newProduct, per100: { ...NUTRITION, fibre: 2 } }],
    ['create_product', { ...newProduct, is_temp: true }],
    ['create_product', { ...newProduct, user_id: account.user.id }],
    ['create_product', { ...newProduct, created_by: account.user.id }],
    ['update_product', { product_id: product.id }],
    ['update_product', { product_id: 0, name: 'Invalid' }],
    ['update_product', { product_id: product.id, name: null }],
    ['update_product', { product_id: product.id, name: 'Invalid', per100: { kcal: 2001 } }],
    ['update_product', { product_id: product.id, per100: {} }],
    ['update_product', { product_id: product.id, per100: { protein: -1 } }],
    ['update_product', { product_id: product.id, per100: { kcal: 300, fibre: 2 } }],
    ['update_product', { product_id: product.id, brand: 123 }],
    ['update_product', { product_id: product.id, barcode: 123 }],
    ['update_product', { product_id: product.id, name: 'Invalid', is_temp: true }],
    ['update_product', { product_id: product.id, name: 'Invalid', user_id: account.user.id }],
    ['delete_product', { product_id: 1.5 }],
    ['delete_product', { product_id: product.id, user_id: account.user.id }],
  ] as const) await reject(mcp, name, args);
  expect(storedRecords()).toEqual(before);

  // Legacy REST input allows extreme finite amounts. If its serialized macros
  // cannot satisfy the MCP output schema, roll back even a valid tag-only edit.
  const legacy = await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
    ...newEntry, grams: 1e308,
  });
  const beforeOutputFailure = storedRecords();
  await reject(mcp, 'update_entry', { entry_id: legacy.id, tagged: true }, 'write_failed');
  expect(storedRecords()).toEqual(beforeOutputFailure);
});

test('[J-210] MCP product deletion cleans owned history and groups while preserving adopted copies', async ({ browser, request, mcp, account }) => {
  const source = await createProduct(mcp, `MCP cascade ${account.user.id}`, { barcode: `mcp-cascade-${account.user.id}` });
  const keep = await createProduct(mcp, `MCP survivor ${account.user.id}`);
  const firstDate = '2024-05-01';
  const secondDate = '2024-05-02';
  const thirdDate = '2024-05-03';
  const a = await createEntry(mcp, source.id, firstDate);
  const b = await createEntry(mcp, keep.id, firstDate, 50);
  const c = await createEntry(mcp, keep.id, firstDate, 25);
  const d = await createEntry(mcp, source.id, secondDate);
  const e = await createEntry(mcp, keep.id, secondDate, 75);
  const f = await createEntry(mcp, source.id, thirdDate);
  const g = await createEntry(mcp, source.id, thirdDate, 50);
  const groups: EntryGroup[] = [];
  for (const entry_ids of [[a.id, b.id, c.id], [d.id, e.id], [f.id, g.id]]) {
    groups.push(await rest<EntryGroup>(request, account.token, 'post', '/entries/groups', {
      name: `MCP cascade group ${account.user.id} ${groups.length}`, entry_ids,
    }));
  }
  const otherContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const otherPage = await otherContext.newPage();
    const other = await freshUser(otherPage, request, 'mcp-adopt-survivor');
    const adopted = await rest<Product>(request, other.token, 'post', `/products/adopt/${source.id}`);
    expect(adopted.id).not.toBe(source.id);
    const otherEntry = await rest<EntryWithMacros>(request, other.token, 'post', '/entries', {
      product_id: adopted.id, grams: 100, local_date: firstDate, local_time: '08:00',
    });

    expect(await call<DeleteProductResult>(mcp, 'delete_product', { product_id: source.id })).toEqual({
      user_id: account.user.id, ok: true, product_id: source.id, deleted_entry_count: 4,
    });
    expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([keep]);
    const first = await call<McpDayResult>(mcp, 'get_day', { date: firstDate });
    const retainedGroup = { id: groups[0]!.id, name: groups[0]!.name };
    expect(first.entries).toEqual([{ ...b, group: retainedGroup }, { ...c, group: retainedGroup }]);
    expect(first.totals).toEqual({ kcal: 150, protein: 7.5, carbs: 15, fat: 3.75 });
    const second = await call<McpDayResult>(mcp, 'get_day', { date: secondDate });
    expect(second.entries).toEqual([e]);
    expect(second.totals).toEqual(e.macros);
    const third = await call<McpDayResult>(mcp, 'get_day', { date: thirdDate });
    expect(third.entries).toEqual([]);
    expect(third.totals).toEqual(ZERO);
    const db = new Database('/tmp/kcal-e2e.db', { readonly: true });
    try {
      expect(db.prepare('SELECT id FROM entry_groups WHERE user_id = ? ORDER BY id').all(account.user.id))
        .toEqual([{ id: groups[0]!.id }]);
    } finally {
      db.close();
    }
    expect(await rest<Product[]>(request, other.token, 'get', '/products/all')).toEqual([adopted]);
    expect(await rest<EntryWithMacros[]>(request, other.token, 'get', `/entries?date=${firstDate}`)).toEqual([otherEntry]);
    await reject(mcp, 'delete_product', { product_id: source.id }, 'not_found');

    const unused = await createProduct(mcp, `MCP unused ${account.user.id}`);
    expect(await call<DeleteProductResult>(mcp, 'delete_product', { product_id: unused.id })).toEqual({
      user_id: account.user.id, ok: true, product_id: unused.id, deleted_entry_count: 0,
    });
  } finally {
    await otherContext.close();
  }
});

test('[J-223] MCP and REST enforce the UI amount minimum without invalidating legacy entries', async ({ page, request, mcp, account }) => {
  const headers = { Authorization: `Bearer ${account.token}` };
  // REST authentication renews session timestamps even when validation rejects
  // a write. Preserve session identity and all application data in this snapshot.
  const snapshot = () => storedRecords({ ignoreSessionActivity: true });
  const date = '2024-06-03';
  const entries: EntryWithMacros[] = [];
  const products: Product[] = [];
  for (const unit of ['g', 'ml'] as const) {
    const product = await createProduct(mcp, `MCP amount ${unit} ${account.user.id}`, { unit });
    products.push(product);
    for (const grams of [1, 1.5]) {
      const created = await createEntry(mcp, product.id, date, grams);
      expect(created).toMatchObject({ grams, product });
      entries.push(created);
      const fromRest = await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
        product_id: product.id, grams, local_date: date, local_time: '12:30',
      });
      expect(fromRest).toMatchObject({ grams, product });
      entries.push(fromRest);
    }
  }
  const first = entries[0]!;
  for (const grams of [1.5, 1]) {
    expect((await call<EntryResult>(mcp, 'update_entry', { entry_id: first.id, grams })).entry.grams).toBe(grams);
    expect((await rest<EntryWithMacros>(request, account.token, 'patch', `/entries/${entries[1]!.id}`, { grams })).grams).toBe(grams);
  }

  await page.close();
  const before = snapshot();
  for (const product of products) {
    const entry = entries.find((item) => item.product.id === product.id)!;
    for (const grams of [-1, 0, 0.5, 0.999]) {
      const create = { product_id: product.id, grams, local_date: date, local_time: '12:30' };
      await reject(mcp, 'create_entry', create);
      await reject(mcp, 'update_entry', { entry_id: entry.id, grams, tagged: true });
      const createResponse = await request.post('/entries', { headers, data: create });
      expect(createResponse.status()).toBe(400);
      expect(await createResponse.json()).toEqual({ error: 'invalid_entry' });
      const editResponse = await request.patch(`/entries/${entry.id}`, { headers, data: { grams, tagged: true } });
      expect(editResponse.status()).toBe(400);
      expect(await editResponse.json()).toEqual({ error: 'invalid_entry' });
    }
  }
  expect(snapshot()).toEqual(before);

  // Simulate an entry saved before the minimum existed. New validation must
  // apply only when an amount is supplied, never to tag-only edits or reads.
  const db = new Database('/tmp/kcal-e2e.db');
  try {
    expect(db.prepare('UPDATE entries SET grams = ? WHERE user_id = ? AND id = ?')
      .run(0.5, account.user.id, first.id).changes).toBe(1);
  } finally {
    db.close();
  }
  const legacy = { ...first, grams: 0.5, macros: { kcal: 1, protein: 0.05, carbs: 0.1, fat: 0.025 } };
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries.find((item) => item.id === first.id)).toEqual(legacy);
  expect((await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${date}`))
    .find((item) => item.id === first.id)).toEqual(legacy);
  expect((await call<EntryResult>(mcp, 'update_entry', { entry_id: first.id, tagged: true })).entry)
    .toEqual({ ...legacy, tagged: true });
  expect(await rest<EntryWithMacros>(request, account.token, 'patch', `/entries/${first.id}`, { tagged: false })).toEqual(legacy);
  const beforeLegacyRejection = snapshot();
  await reject(mcp, 'update_entry', { entry_id: first.id, grams: 0.5, tagged: true });
  const legacyUpdate = await request.patch(`/entries/${first.id}`, { headers, data: { grams: 0.5, tagged: true } });
  expect(legacyUpdate.status()).toBe(400);
  expect(snapshot()).toEqual(beforeLegacyRejection);
  expect(await call<DeleteEntryResult>(mcp, 'delete_entry', { entry_id: first.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: first.id, dissolved_group_id: null,
  });
  expect((await call<McpDayResult>(mcp, 'get_day', { date })).entries.some((item) => item.id === first.id)).toBe(false);
});

test('[J-224] MCP blocks temporary-food reuse while preserving the UI flow and existing temporary log edits', async ({ page, request, mcp, account }) => {
  const name = `Mcp temp ${account.user.id}`;
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(name);
  await page.getByRole('button', { name: 'Add Temp', exact: true }).tap();
  await expect(page.getByText('Add Temp Item', { exact: true })).toBeVisible();
  await fillNutField(page, 'Kcal', '200');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '20');
  await fillNutField(page, 'Fat', '5');
  await page.getByRole('button', { name: 'Add to Day' }).tap();
  await expect(page.getByText('How much?', { exact: true })).toBeVisible();
  await page.locator('.sheet').getByRole('spinbutton').fill('50');
  const loggedResponse = page.waitForResponse((response) =>
    response.url().endsWith('/entries') && response.request().method() === 'POST' && response.ok());
  await page.getByRole('button', { name: /Add to day/ }).tap();
  const entry = await (await loggedResponse).json() as EntryWithMacros;
  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row.getByText('TMP', { exact: true })).toBeVisible();
  expect(entry).toMatchObject({ grams: 50, product: { name, is_temp: true } });
  expect((await call<McpDayResult>(mcp, 'get_day', { date: entry.local_date })).entries).toEqual([entry]);

  const unlogged = await rest<Product>(request, account.token, 'post', '/products', {
    name: `Mcp unused temp ${account.user.id}`, unit: 'g', brand: null, barcode: null, per100: NUTRITION, is_temp: true,
  });
  expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: 'Mcp' })).products).toEqual([]);
  expect(await rest<Product[]>(request, account.token, 'get', '/products/all')).toEqual([]);
  await page.close();
  const before = storedRecords();
  for (const product of [entry.product, unlogged]) {
    await reject(mcp, 'create_entry', {
      product_id: product.id, grams: 50, local_date: entry.local_date, local_time: '12:30',
    }, 'product_not_loggable');
  }
  expect(storedRecords()).toEqual(before);

  const updatedProduct = await call<ProductResult>(mcp, 'update_product', {
    product_id: entry.product.id, name: `Mcp edited temp ${account.user.id}`, per100: { kcal: 300 },
  });
  expect(updatedProduct.product).toEqual({
    ...entry.product, name: `Mcp edited temp ${account.user.id}`, per100: { ...NUTRITION, kcal: 300 },
  });
  const updatedEntry = await call<EntryResult>(mcp, 'update_entry', { entry_id: entry.id, grams: 1.5, tagged: true });
  expect(updatedEntry).toEqual({ user_id: account.user.id, entry: {
    ...entry, product: updatedProduct.product, grams: 1.5, tagged: true,
    macros: { kcal: 4.5, protein: 0.15, carbs: 0.3, fat: 0.075 },
  } });
  expect(await rest<EntryWithMacros[]>(request, account.token, 'get', `/entries?date=${entry.local_date}`)).toEqual([updatedEntry.entry]);
  expect(await call<DeleteEntryResult>(mcp, 'delete_entry', { entry_id: entry.id })).toEqual({
    user_id: account.user.id, ok: true, entry_id: entry.id, dissolved_group_id: null,
  });
  for (const product of [entry.product, unlogged]) {
    expect(await call<DeleteProductResult>(mcp, 'delete_product', { product_id: product.id })).toEqual({
      user_id: account.user.id, ok: true, product_id: product.id, deleted_entry_count: 0,
    });
  }
  expect((await call<McpDayResult>(mcp, 'get_day', { date: entry.local_date })).entries).toEqual([]);
});
