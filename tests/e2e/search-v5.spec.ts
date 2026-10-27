import { E2E_DATABASE_PATH } from './test-config';
import { expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import type { EntryWithMacros, McpProductSearchResult, Product } from '../../shared/types';
import { call, createMcpTest, freshUser, rest } from './mcp-helpers';

const test = createMcpTest({ emailPrefix: 'search-v5', scope: 'kcal:read' });
test.use({ storageState: { cookies: [], origins: [] } });

function saveProduct(request: APIRequestContext, token: string, name: string,
  fields: Partial<Pick<Product, 'brand' | 'barcode' | 'is_temp'>> = {}) {
  return rest<Product>(request, token, 'post', '/products', {
    name, brand: null, barcode: null, unit: 'g', is_temp: false,
    per100: { kcal: 100, protein: 5, carbs: 10, fat: 3 }, ...fields,
  });
}

test('[J-450] app and MCP search require every term across name and brand in any order', async ({ request, mcp, account }) => {
  const kwark = await saveProduct(request, account.token, 'Magere kwark', { brand: 'De Zaanse Hoeve' });
  const unbranded = await saveProduct(request, account.token, 'Volle kwark');
  const milk = await saveProduct(request, account.token, 'Magere melk', { brand: 'De Zaanse Hoeve' });
  for (const [query, expected] of [
    ['hoeve kwark', [kwark]],
    ['  KWARK\tHOEVE\nkwark  ', [kwark]],
    ['gere zaan', [kwark, milk]],
    ['kwark volle', [unbranded]],
    ['kwark missing', []],
    ['kwrak hoeve', []],
  ] as const) {
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query })).products, query).toEqual(expected);
    expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`), query).toEqual(expected);
  }
});

test('[J-451] multi-term searches preserve literal punctuation and meaningful Unicode accents', async ({ request, mcp, account }) => {
  const literal = await saveProduct(request, account.token, 'Éclair 0% meal_a path\\food', { brand: 'Crème brûlée' });
  await saveProduct(request, account.token, 'Éclair 0 mealxa pathfood', { brand: 'Crème brûlée' });
  for (const query of ['BRÛLÉE 0%', '_ e\u0301clair', '\\ crème', '  meal_a\t0%\nÉCLAIR  ']) {
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query })).products, query).toEqual([literal]);
    expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`), query).toEqual([literal]);
    expect(await rest(request, account.token, 'get', `/products/search?global=1&q=${encodeURIComponent(query)}`), query)
      .toEqual([{ ...literal, is_mine: true }]);
  }
  for (const query of ['eclair 0%', 'éclair creme', 'brulee _']) {
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query })).products, query).toEqual([]);
    expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`), query).toEqual([]);
  }
});

test('[J-452] token search filters before pagination and preserves alphabetical ID ties', async ({ request, mcp, account }) => {
  for (let index = 0; index < 51; index++) {
    await saveProduct(request, account.token, `A decoy ${index}`);
  }
  const zebra = await saveProduct(request, account.token, 'Cereal zebra', { brand: 'Maker' });
  const first = await saveProduct(request, account.token, 'Cereal alpha', { brand: 'Maker' });
  const second = await saveProduct(request, account.token, 'CEREAL ALPHA', { brand: 'Maker' });
  await saveProduct(request, account.token, 'Cereal temporary', { brand: 'Maker', is_temp: true });
  const query = 'maker cereal';
  expect(await call(mcp, 'search_products', { query, limit: 2 })).toEqual({
    user_id: account.user.id, products: [first, second], template: null, next_offset: 2,
  });
  expect(await call(mcp, 'search_products', { query, limit: 2, offset: 2 })).toEqual({
    user_id: account.user.id, products: [zebra], template: null, next_offset: null,
  });
  expect(await call(mcp, 'search_products', { query, limit: 2, offset: 3 })).toMatchObject({
    products: [], next_offset: null,
  });
  expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`))
    .toEqual([first, second, zebra]);
});

test('[J-453] recent token search retains logged-only filtering and creation-time ordering', async ({ request, mcp, account }) => {
  const old = await saveProduct(request, account.token, 'Milk old', { brand: 'Farm' });
  const tieOne = await saveProduct(request, account.token, 'Milk tie one', { brand: 'Farm' });
  const tieTwo = await saveProduct(request, account.token, 'Milk tie two', { brand: 'Farm' });
  const temporary = await saveProduct(request, account.token, 'Milk temporary', { brand: 'Farm', is_temp: true });
  await saveProduct(request, account.token, 'Milk unlogged', { brand: 'Farm' });
  const entries: EntryWithMacros[] = [];
  for (const [product, date] of [[old, '2030-01-01'], [tieOne, '1999-01-01'], [tieTwo, '2000-01-01'], [temporary, '2020-01-01']] as const) {
    entries.push(await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
      product_id: product.id, amount: 100, local_date: date, local_time: '12:00',
    }));
  }
  const db = new Database(E2E_DATABASE_PATH);
  try {
    const update = db.prepare('UPDATE entries SET created_at = ? WHERE user_id = ? AND id = ?');
    entries.forEach((entry, index) => update.run([10, 20, 20, 30][index], account.user.id, entry.id));
  } finally { db.close(); }
  expect(await call(mcp, 'search_products', { query: 'farm milk', sort: 'recent', limit: 2 }))
    .toMatchObject({ products: [tieTwo, tieOne], next_offset: 2 });
  expect(await call(mcp, 'search_products', { query: 'milk farm', sort: 'recent', limit: 2, offset: 2 }))
    .toMatchObject({ products: [old], next_offset: null });
  expect(await call(mcp, 'search_products', { query: 'milk missing', sort: 'recent' }))
    .toMatchObject({ products: [], next_offset: null });
});

test('[J-454] global token search keeps owned barcode copies and excludes private or temporary sources', async ({ request, browser, account }) => {
  const brand = `Maker ${account.user.id}`;
  const barcode = `token-search-${account.user.id}`;
  const own = await saveProduct(request, account.token, 'Yogurt owned', { brand, barcode });
  const privateFood = await saveProduct(request, account.token, 'Yogurt private', { brand });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const other = await freshUser(await context.newPage(), request, 'search-v5-other');
    await saveProduct(request, other.token, 'Yogurt duplicate', { brand, barcode });
    const shared = await saveProduct(request, other.token, 'Yogurt alphabetically first', { brand, barcode: `${barcode}-shared` });
    await saveProduct(request, other.token, 'Yogurt secret', { brand });
    await saveProduct(request, other.token, 'Yogurt temporary', { brand, barcode: `${barcode}-temporary`, is_temp: true });
    const query = `${brand} yogurt`;
    expect(await rest(request, account.token, 'get', `/products/search?global=1&q=${encodeURIComponent(query)}`))
      .toEqual([{ ...own, is_mine: true }, { ...privateFood, is_mine: true }, { ...shared, is_mine: false }]);
    expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`))
      .toEqual([own, privateFood]);
  } finally { await context.close(); }
});

test('[J-455] Add Food finds a product from reordered name and brand terms', async ({ request, page, account }) => {
  const product = await saveProduct(request, account.token, 'Magere kwark', { brand: 'De Zaanse Hoeve' });
  await saveProduct(request, account.token, 'Magere melk', { brand: 'De Zaanse Hoeve' });
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  const input = page.getByPlaceholder('Search products...');
  const picker = page.locator('.sheet').filter({ has: input });
  await input.fill('hoeve kwark');
  await expect(picker.getByText('1 result', { exact: true })).toBeVisible();
  await expect(picker.getByText(product.name, { exact: true })).toBeVisible();
  await expect(picker.getByText('Magere melk', { exact: true })).toHaveCount(0);
});
