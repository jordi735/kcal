import { E2E_DATABASE_PATH } from './test-config';
import { expect, type APIRequestContext } from '@playwright/test';
import Database from 'better-sqlite3';
import type { EntryWithMacros, McpProductSearchResult, McpProductWriteResult, Product } from '../../shared/types';
import { normalizeBrandName, normalizeProductName } from '../../shared/normalize';
import { call, createMcpTest, freshUser, reject, rest } from './mcp-helpers';

const test = createMcpTest({ emailPrefix: 'product-v4', scope: 'kcal:read' });
const writeTest = createMcpTest({ emailPrefix: 'product-v4-write', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });
writeTest.use({ storageState: { cookies: [], origins: [] } });
const NUTRITION = { kcal: 100, protein: 5, carbs: 10, fat: 3 };

function saveProduct(request: APIRequestContext, token: string, name: string,
  fields: Partial<Pick<Product, 'brand' | 'barcode' | 'unit' | 'is_temp'>> = {}) {
  return rest<Product>(request, token, 'post', '/products', {
    name, brand: null, barcode: null, unit: 'g', is_temp: false, per100: NUTRITION, ...fields,
  });
}

test('[J-360] MCP browses and paginates the complete owned saved library with stable name ties', async ({ request, mcp, account }) => {
  const descending: Product[] = [];
  for (let index = 52; index >= 0; index--) {
    descending.push(await saveProduct(request, account.token, `Library item ${String(index).padStart(2, '0')}`));
  }
  await saveProduct(request, account.token, 'Library item temporary', { is_temp: true });
  const first = await call<McpProductSearchResult>(mcp, 'search_products');
  const expected = descending.reverse();
  expect(first).toEqual({ user_id: account.user.id, products: expected.slice(0, 50), template: null, next_offset: 50 });
  expect(await call(mcp, 'search_products', { offset: first.next_offset })).toEqual({
    user_id: account.user.id, products: expected.slice(50), template: null, next_offset: null,
  });
  expect(await call(mcp, 'search_products', { offset: 999 })).toMatchObject({ products: [], next_offset: null });
  expect(await call(mcp, 'search_products', { query: 'No such food' })).toMatchObject({ products: [], next_offset: null });
  const duplicateOne = await saveProduct(request, account.token, 'Repeated name');
  const duplicateTwo = await saveProduct(request, account.token, 'REPEATED NAME');
  expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: 'repeated', limit: 1 })).products).toEqual([duplicateOne]);
  expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: 'repeated', limit: 1, offset: 1 })).products).toEqual([duplicateTwo]);
});

test('[J-361] app and MCP product searches match literal symbols and Unicode name or brand casing', async ({ request, mcp, account }) => {
  const percent = await saveProduct(request, account.token, 'Yogurt 0% fat');
  await saveProduct(request, account.token, 'Oats 100 kcal');
  const underscore = await saveProduct(request, account.token, 'Meal_a');
  await saveProduct(request, account.token, 'Mealxa');
  const slash = await saveProduct(request, account.token, 'Path\\food');
  await saveProduct(request, account.token, 'Pathfood');
  const eclair = await saveProduct(request, account.token, 'Éclair');
  const branded = await saveProduct(request, account.token, 'Dessert', { brand: 'Crème brûlée' });
  for (const [query, products] of [
    ['0%', [percent]], ['_', [underscore]], ['\\', [slash]],
    ['éclair', [eclair]], ['E\u0301CLAIR', [eclair]], ['CRÈME BRÛLÉE', [branded]],
  ] as const) {
    const result = await call<McpProductSearchResult>(mcp, 'search_products', { query });
    expect(result.products, query).toEqual(products);
    expect(await rest(request, account.token, 'get', `/products/search?q=${encodeURIComponent(query)}`), query).toEqual(products);
  }
  // Global mode uses exactly the same literal and Unicode matching helper.
  const prefix = `Global ${account.user.id}`;
  const literal = await saveProduct(request, account.token, `${prefix} 0% Éclair`);
  await saveProduct(request, account.token, `${prefix} 100 kcal Éclair`);
  expect(await rest(request, account.token, 'get', `/products/search?global=1&q=${encodeURIComponent(`${prefix} 0% e\u0301clair`)}`))
    .toEqual([{ ...literal, is_mine: true }]);
});

test('[J-362] recent product pages use log creation time with stable ties and exclude unlogged or temporary foods', async ({ request, mcp, account }) => {
  const oldest = await saveProduct(request, account.token, 'Recent oldest');
  const tieOne = await saveProduct(request, account.token, 'Recent tie one');
  const tieTwo = await saveProduct(request, account.token, 'Recent tie two');
  const temporary = await saveProduct(request, account.token, 'Recent temporary', { is_temp: true });
  await saveProduct(request, account.token, 'Recent never logged');
  const entries: EntryWithMacros[] = [];
  for (const [product, date] of [[oldest, '2030-01-01'], [tieOne, '1999-01-01'], [tieTwo, '2000-01-01'], [temporary, '2025-01-01']] as const) {
    entries.push(await rest<EntryWithMacros>(request, account.token, 'post', '/entries', {
      product_id: product.id, amount: 100, local_date: date, local_time: '12:00',
    }));
  }
  const db = new Database(E2E_DATABASE_PATH);
  try {
    const setCreated = db.prepare('UPDATE entries SET created_at = ? WHERE user_id = ? AND id = ?');
    entries.forEach((entry, index) => setCreated.run([10, 20, 20, 30][index], account.user.id, entry.id));
  } finally { db.close(); }
  expect(await rest(request, account.token, 'get', '/products/recent')).toEqual([tieTwo, tieOne, oldest]);
  expect(await call(mcp, 'search_products', { sort: 'recent', limit: 2 })).toMatchObject({ products: [tieTwo, tieOne], next_offset: 2 });
  expect(await call(mcp, 'search_products', { sort: 'recent', limit: 2, offset: 2 })).toMatchObject({ products: [oldest], next_offset: null });
  expect(await call(mcp, 'search_products', { sort: 'recent', query: 'oldest' })).toMatchObject({ products: [oldest] });
});

test('[J-363] barcode lookup prefers the newest owned saved copy and returns safe shared templates without writes', async ({ request, browser, mcp, account }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const other = await freshUser(await context.newPage(), request, 'barcode-v4-other');
    const barcode = `000-v4-${account.user.id}`;
    const shared = await saveProduct(request, other.token, 'Shared barcode food', { barcode, unit: 'ml', brand: 'Maker' });
    await saveProduct(request, other.token, `Other private ${account.user.id}`);
    await saveProduct(request, account.token, 'Temporary barcode food', { barcode, is_temp: true });
    const template = { name: shared.name, brand: shared.brand, barcode, unit: shared.unit, per100: shared.per100 };
    expect(await call(mcp, 'search_products', { barcode: ` ${barcode} ` })).toEqual({
      user_id: account.user.id, products: [], template, next_offset: null,
    });
    expect(await rest(request, account.token, 'get', `/products/barcode/${barcode}`)).toEqual({ kind: 'template', template });
    expect((await call<McpProductSearchResult>(mcp, 'search_products')).products).toEqual([]);
    const ownFirst = await saveProduct(request, account.token, 'Owned older food', { barcode });
    const ownLast = await saveProduct(request, account.token, 'Owned newer food', { barcode });
    const db = new Database(E2E_DATABASE_PATH);
    try {
      db.prepare('UPDATE products SET created_at = 100 WHERE created_by = ? AND barcode = ?').run(account.user.id, barcode);
    } finally { db.close(); }
    expect(ownFirst.id).toBeLessThan(ownLast.id);
    expect(await call(mcp, 'search_products', { barcode })).toEqual({
      user_id: account.user.id, products: [ownLast], template: null, next_offset: null,
    });
    expect(await rest(request, account.token, 'get', `/products/barcode/${barcode}`)).toEqual({ kind: 'own', product: ownLast });
    expect(await call(mcp, 'search_products', { barcode: `missing-${account.user.id}` })).toMatchObject({ products: [], template: null, next_offset: null });
    expect((await call<McpProductSearchResult>(mcp, 'search_products')).products).toEqual([ownLast, ownFirst]);
    expect((await call<McpProductSearchResult>(mcp, 'search_products', { query: `Other private ${account.user.id}` })).products).toEqual([]);
  } finally { await context.close(); }
});

test('[J-364] global search does not merge private IDs with real barcode strings', async ({ request, account }) => {
  const prefix = `Collision ${account.user.id}`;
  const privateFood = await saveProduct(request, account.token, `${prefix} private`);
  const barcoded = await saveProduct(request, account.token, `${prefix} barcoded`, { barcode: `self-${privateFood.id}` });
  expect(await rest(request, account.token, 'get', `/products/search?global=1&q=${encodeURIComponent(prefix)}`))
    .toEqual([{ ...barcoded, is_mine: true }, { ...privateFood, is_mine: true }]);
});

test('[J-365] adopting a saved barcode skips owned temporary copies and rejects temporary sources', async ({ request, browser, account }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const other = await freshUser(await context.newPage(), request, 'adopt-v4-other');
    const barcode = `adopt-v4-${account.user.id}`;
    const temporary = await saveProduct(request, account.token, 'Temporary own food', { barcode, is_temp: true });
    const source = await saveProduct(request, other.token, 'Saved shared food', { barcode });
    const headers = { Authorization: `Bearer ${account.token}` };
    const response = await request.post(`/products/adopt/${source.id}`, { headers });
    expect(response.status()).toBe(201);
    const adopted = await response.json() as Product;
    expect(adopted.is_temp).toBe(false);
    expect(adopted.id).not.toBe(temporary.id);
    expect(await rest(request, account.token, 'post', `/products/adopt/${source.id}`)).toEqual(adopted);
    expect(await rest(request, account.token, 'get', '/products/all')).toEqual([adopted]);
    const temporarySource = await saveProduct(request, other.token, 'Temporary shared food', { barcode: `${barcode}-temp`, is_temp: true });
    const rejected = await request.post(`/products/adopt/${temporarySource.id}`, { headers });
    expect(rejected.status()).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'not_adoptable' });
  } finally { await context.close(); }
});

test('[J-366] product normalization is stable for Unicode expansions and enforces final stored length', async ({ request, account }) => {
  const product = await saveProduct(request, account.token, 'ßoup', { brand: 'ßeta ﬃrm' });
  expect(product).toMatchObject({ name: 'Ssoup', brand: 'Sseta Ffirm' });
  const body = { name: product.name, brand: product.brand, barcode: product.barcode, unit: product.unit, per100: product.per100 };
  expect(await rest(request, account.token, 'put', `/products/${product.id}`, body)).toEqual(product);
  for (const original of ['ßoup', 'ﬃber', '𐐨eseret', 'İstanbul', 'E\u0301clair']) {
    expect(normalizeProductName(normalizeProductName(original))).toBe(normalizeProductName(original));
    expect(normalizeBrandName(normalizeBrandName(original))).toBe(normalizeBrandName(original));
  }
  for (const fields of [{ name: `ß${'a'.repeat(199)}` }, { brand: `ß${'a'.repeat(119)}` }]) {
    const response = await request.post('/products', {
      headers: { Authorization: `Bearer ${account.token}` },
      data: { ...body, is_temp: false, ...fields },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_product' });
    const update = await request.put(`/products/${product.id}`, {
      headers: { Authorization: `Bearer ${account.token}` }, data: { ...body, ...fields },
    });
    expect(update.status()).toBe(400);
  }
  expect(await rest(request, account.token, 'get', '/products/all')).toEqual([product]);
});

writeTest('[J-367] partial MCP product updates preserve omitted legacy metadata and reject expanded oversized text', async ({ request, mcp, account }) => {
  const product = await saveProduct(request, account.token, 'Initial food');
  const db = new Database(E2E_DATABASE_PATH);
  try {
    db.prepare('UPDATE products SET name = ?, brand = ?, barcode = ? WHERE created_by = ? AND id = ?')
      .run('RAW  legacy NAME', 'OLD  BRAND', '  old barcode  ', account.user.id, product.id);
  } finally { db.close(); }
  const changed = await call<McpProductWriteResult>(mcp, 'update_product', { product_id: product.id, per100: { kcal: 111 } });
  expect(changed.product).toMatchObject({ name: 'RAW  legacy NAME', brand: 'OLD  BRAND', barcode: '  old barcode  ', per100: { kcal: 111 } });
  await reject(mcp, 'update_product', { product_id: product.id, name: `ß${'a'.repeat(199)}` });
  await reject(mcp, 'create_product', {
    idempotency_key: 'oversized-name', name: `ß${'a'.repeat(199)}`, unit: 'g', per100: NUTRITION,
  });
  expect(await rest(request, account.token, 'get', '/products/all')).toEqual([changed.product]);
});

test('[J-368] product discovery rejects conflicting barcode modes and invalid pagination', async ({ mcp }) => {
  for (const input of [
    { query: '' }, { query: '   ' }, { barcode: '' }, { barcode: 'x'.repeat(65) },
    { barcode: '123', query: 'food' }, { barcode: '123', sort: 'name' },
    { barcode: '123', limit: 50 }, { barcode: '123', offset: 0 },
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER }, { sort: 'popular' }, { user_id: 1 }, { global: true },
  ]) await reject(mcp, 'search_products', input);
});
