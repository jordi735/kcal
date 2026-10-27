import { expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import type { Product, EntryWithMacros } from '../../shared/types';
import { createMcpTest } from './mcp-helpers';
import { E2E_DATABASE_PATH } from './test-config';
import { runServerFixture } from './server-fixture';

const test = createMcpTest({ emailPrefix: 'security-inputs', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });

const food: Product = {
  id: 1, name: 'Bounded food', brand: null, barcode: null, unit: 'g', is_temp: false,
  per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
};

async function mockFoodApp(page: Page, count = 0) {
  const goals = { kcal: 2000, protein: 100, carbs: 200, fat: 50 };
  const state = { searchQueries: [] as string[], groupPosts: 0 };
  await page.addInitScript(() => {
    localStorage.setItem('kcal_session_token', 'security-input-ui');
    localStorage.setItem('kcal_user', JSON.stringify({
      id: 1, email: 'input-ui@test.local', goal_kcal: 2000,
      goal_protein: 100, goal_carbs: 200, goal_fat: 50,
    }));
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/settings') {
      await route.fulfill({ json: { ...goals, goal_history: [{ effective_date: '2020-01-01', goals }], mcp_notice_version: null } });
    } else if (url.pathname === '/entries' && request.method() === 'GET') {
      const date = url.searchParams.get('date')!;
      const entries: EntryWithMacros[] = Array.from({ length: count }, (_, index) => ({
        id: index + 1, product: { ...food, name: `Bounded food ${index + 1}` },
        amount: 100, local_date: date, local_time: '12:00', macros: food.per100,
        tagged: false, group: null,
      }));
      await route.fulfill({ json: entries });
    } else if (url.pathname === '/entries/week') {
      await route.fulfill({ json: {} });
    } else if (url.pathname === '/products/all' || url.pathname === '/products/recent') {
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/products/search') {
      state.searchQueries.push(url.searchParams.get('q') ?? '');
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/entries/groups' && request.method() === 'POST') {
      state.groupPosts += 1;
      await route.fulfill({ status: 500, json: { error: 'unexpected_group_write' } });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ADD FOOD', exact: true })).toBeVisible();
  return state;
}

test('[J-505] login guards bound raw and normalized UTF-8 email bytes before issuing codes', async ({ request }) => {
  const atBoundary = `${'a'.repeat(247)}@e.test`;
  const invalid = [
    `${'b'.repeat(248)}@e.test`,
    `${'é'.repeat(124)}@e.test`,
    // Lowercasing U+0130 expands two UTF-8 bytes into three.
    `${'İ'.repeat(123)}@e.test`,
  ];
  expect(Buffer.byteLength(atBoundary)).toBe(254);
  expect((await request.post('/auth/request-code', { data: { email: atBoundary } })).status()).toBe(200);
  expect((await request.get(`/auth/test/last-code/${encodeURIComponent(atBoundary)}`)).status()).toBe(200);

  const results: { status: number; error: unknown; verifyStatus: number }[] = [];
  for (const email of invalid) {
    const issued = await request.post('/auth/request-code', { data: { email } });
    const verified = await request.post('/auth/verify-code', { data: { email, code: '000000' } });
    results.push({ status: issued.status(), error: await issued.json(), verifyStatus: verified.status() });
  }
  expect(results).toEqual(invalid.map(() => ({
    status: 400, error: { error: 'invalid_email' }, verifyStatus: 400,
  })));
  const db = new Database(E2E_DATABASE_PATH, { readonly: true });
  try {
    for (const email of invalid) {
      expect(db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())).toBeUndefined();
    }
  } finally { db.close(); }
  for (const email of invalid) {
    expect((await request.get(`/auth/test/last-code/${encodeURIComponent(email)}`)).status()).toBe(400);
  }
});

test('[J-506] REST and MCP search enforce the raw 512-character boundary before querying', async ({ request, account, mcp }) => {
  const headers = { Authorization: `Bearer ${account.token}` };
  const boundary = 'q'.repeat(512);
  for (const global of ['', '&global=1']) {
    expect((await request.get(`/products/search?q=${boundary}${global}`, { headers })).status()).toBe(200);
    for (const query of ['q'.repeat(513), ' '.repeat(513)]) {
      const result = await request.get(`/products/search?q=${encodeURIComponent(query)}${global}`, { headers });
      expect(result.status()).toBe(400);
      expect(await result.json()).toEqual({ error: 'invalid_query' });
    }
  }
  const accepted = await mcp.callTool({ name: 'search_products', arguments: { query: boundary } });
  expect(accepted.isError).not.toBe(true);
  const rejected = await mcp.callTool({ name: 'search_products', arguments: { query: `${boundary}q` } });
  expect(rejected.isError).toBe(true);
  expect(rejected.structuredContent).toBeUndefined();
  expect((await mcp.callTool({ name: 'search_products', arguments: {} })).isError).not.toBe(true);
});

test('[J-507] group creation caps membership without stranding larger stored groups', () => {
  const result = runServerFixture(new URL('./fixtures/security-inputs.ts', import.meta.url), ':memory:');
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    restBoundary: 1000, mcpBoundary: 1000, rejectedWithoutWrites: true,
    legacyMembers: 1001, legacyRenameTagUngroupDelete: true,
  });
});

test('[J-508] email and product-search controls enforce bounds for clicks keyboard and injected input', async ({ page }) => {
  await page.goto('/');
  const email = page.getByPlaceholder('you@example.com');
  const send = page.getByRole('button', { name: 'Send sign-in code' });
  await email.fill(`${'a'.repeat(247)}@e.test`);
  await expect(send).toBeEnabled();
  await email.fill(`${'é'.repeat(124)}@e.test`);
  await expect(send).toBeDisabled();
  const authRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/auth/request-code') authRequests.push(request.url());
  });
  await email.press('Enter');
  await expect(email).toBeVisible();
  expect(authRequests).toEqual([]);

  const state = await mockFoodApp(page);
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  const sheet = page.locator('.sheet');
  const search = sheet.getByPlaceholder('Search products...');
  await expect(search).toHaveAttribute('maxlength', '512');
  await search.fill('q'.repeat(512));
  await expect.poll(() => state.searchQueries).toEqual(['q'.repeat(512)]);
  await search.evaluate((input) => {
    (input as HTMLInputElement).value = 'q'.repeat(513);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await search.press('Enter');
  await expect(sheet.getByText("Couldn't search foods.", { exact: true })).toBeVisible();
  expect(state.searchQueries).toEqual(['q'.repeat(512)]);
  await search.fill('rice');
  await expect.poll(() => state.searchQueries).toEqual(['q'.repeat(512), 'rice']);
});

test('[J-509] an oversized selection keeps its rows and reports the existing group-limit notification', async ({ page }) => {
  const state = await mockFoodApp(page, 1001);
  const rows = page.locator('.food-row');
  await expect(rows).toHaveCount(1001);
  await rows.first().locator('button').nth(1).dispatchEvent('contextmenu');
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  // Exercise the real row click handlers in one event turn; avoid 1,000 scrolls.
  await rows.evaluateAll((elements) => {
    for (const element of elements.slice(1)) {
      (element.querySelectorAll('button')[1] as HTMLButtonElement).click();
    }
  });
  await expect(page.getByText('1001 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Group 1001 selected', exact: true }).tap();
  await expect(page.getByText('Groups can contain at most 1,000 items.', { exact: true })).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByText('1001 selected', { exact: true })).toBeVisible();
  expect(state.groupPosts).toBe(0);
  await rows.last().locator('button').nth(1).dispatchEvent('click');
  await page.getByRole('button', { name: 'Group 1000 selected', exact: true }).tap();
  await expect(page.locator('.sheet').getByLabel('Group name', { exact: true })).toBeVisible();
  expect(state.groupPosts).toBe(0);
});
