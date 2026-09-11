import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type {
  EntryWithMacros, McpEntryGroupResult, McpEntryWriteResult, McpProductWriteResult,
  Product, WeightEntry,
} from '../../shared/types';
import { fillNutField, signInFresh } from './helpers';
import { call, createMcpTest, rest } from './mcp-helpers';
import { background, CORE_READS, deferred, foreground, frame, readCycle, resume } from './app-refresh-helpers';

const test = createMcpTest({ emailPrefix: 'resume-mcp', scope: 'kcal:read kcal:write' });
test.use({ storageState: { cookies: [], origins: [] } });

const MONDAY = '2030-01-07';
const TUESDAY = '2030-01-08';
const NUTRITION = { kcal: 400, protein: 10, carbs: 20, fat: 5 };
async function boot(page: Page, request: APIRequestContext, prefix: string) {
  await page.clock.setFixedTime(new Date(2030, 0, 7, 16, 0));
  await readCycle(page, () => signInFresh(page, request, prefix));
  return page.evaluate(() => localStorage.getItem('kcal_session_token')!);
}

async function product(request: APIRequestContext, token: string, name: string): Promise<Product> {
  return rest<Product>(request, token, 'post', '/products', {
    name, brand: null, barcode: null, unit: 'g', is_temp: false, per100: NUTRITION,
  });
}

async function entry(request: APIRequestContext, token: string, productId: number, date = MONDAY) {
  return rest<EntryWithMacros>(request, token, 'post', '/entries', {
    product_id: productId, grams: 100, local_date: date, local_time: '12:30',
  });
}

test('[J-236] resuming the same app incorporates MCP entry groups product edits and current goals', async ({
  page, request, mcp, account,
}) => {
  // OAuth has already navigated this page to its callback. Finish connection
  // setup before loading the app whose in-memory cache we intend to exercise.
  await page.clock.setFixedTime(new Date(2030, 0, 7, 16, 0));
  const saved = (await call<McpProductWriteResult>(mcp, 'create_product', {
    name: `Resume MCP food ${account.user.id}`, unit: 'g',
    per100: { ...NUTRITION, kcal: 200 },
  })).product;
  const createEntry = async (date: string, grams = 100) => (await call<McpEntryWriteResult>(mcp, 'create_entry', {
    product_id: saved.id, grams, local_date: date, local_time: '12:30',
  })).entry;
  const removed = await createEntry(MONDAY);
  const tomorrow = await createEntry(TUESDAY);
  await readCycle(page, () => page.goto('/'));
  await expect(page.getByText('200 kcal', { exact: true })).toBeVisible();
  await readCycle(page, () => page.getByRole('button', { name: 'T 8', exact: true }).tap(), 2);
  await readCycle(page, () => page.getByRole('button', { name: 'M 7', exact: true }).tap(), 1);
  await page.evaluate(() => { document.documentElement.dataset.resumeMarker = 'same-page'; });

  await background(page);
  await call(mcp, 'delete_entry', { entry_id: removed.id });
  await call(mcp, 'update_product', { product_id: saved.id, per100: NUTRITION });
  const first = await createEntry(MONDAY);
  const second = await createEntry(MONDAY, 50);
  const group = await call<McpEntryGroupResult>(mcp, 'create_entry_group', {
    name: `Resume meal ${account.user.id}`, entry_ids: [second.id, first.id],
  });
  await call(mcp, 'update_entry', { entry_id: tomorrow.id, grams: 300 });
  const goals = { kcal: 2000, protein: 100, carbs: 200, fat: 70 };
  await rest(request, account.token, 'put', '/settings', goals);
  await readCycle(page, () => foreground(page));

  await expect(page.locator('.entry-group')).toContainText(group.group.name);
  await expect(page.locator('.food-row')).toHaveCount(0);
  await expect(page.getByText('600 kcal', { exact: true })).toBeVisible();
  await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  const tomorrowDot = page.getByRole('button', { name: 'T 8', exact: true }).locator('[style*="--dot-opacity"]');
  await expect(tomorrowDot).toHaveCSS('opacity', '0.6');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user')!).goal_kcal)).toBe(2000);
  expect(await page.evaluate(() => document.documentElement.dataset.resumeMarker)).toBe('same-page');
  await page.getByRole('button', { name: 'T 8', exact: true }).tap();
  await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
  await expect(page.locator('.food-row')).toContainText('300g');
});

test('[J-237] lifecycle bursts coalesce while later visibility focus and restored-page events refresh again', async ({ page, request }) => {
  await boot(page, request, 'resume-events');
  await page.clock.install({ time: new Date(2030, 0, 7, 16, 0) });
  const reads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && CORE_READS.has(path)) reads.push(path);
  });
  const flushEvents = () => page.clock.runFor(300);

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  });
  await flushEvents();
  expect(reads).toEqual([]);
  await background(page);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await flushEvents();
  expect(reads).toEqual([]);

  const cycle = async (action: () => Promise<void>) => {
    const before = reads.length;
    await readCycle(page, async () => { await action(); await flushEvents(); });
    expect(reads.length - before).toBe(5);
    expect(reads.slice(before).filter((path) => path === '/entries')).toHaveLength(1);
    expect(reads.slice(before).filter((path) => path === '/entries/week')).toHaveLength(3);
    expect(reads.slice(before).filter((path) => path === '/settings')).toHaveLength(1);
  };
  await cycle(() => foreground(page));
  await cycle(() => page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  }));
  await cycle(() => page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  }));
  await cycle(() => resume(page));
});

test('[J-238] a failed foreground read retains the day and an online event recovers fresh data', async ({ page, request }) => {
  const token = await boot(page, request, 'resume-retry');
  const saved = await product(request, token, 'Resume retry food');
  const logged = await entry(request, token, saved.id);
  await readCycle(page, () => resume(page));
  await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
  await rest(request, token, 'patch', `/entries/${logged.id}`, { grams: 200 });
  let fail = true;
  await page.route('**/entries?date=*', async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) });
    } else await route.continue();
  });
  await readCycle(page, () => resume(page));
  await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toBeVisible();
  await expect(page.locator('.food-row')).toContainText('100g');
  await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
  await readCycle(page, () => page.evaluate(() => window.dispatchEvent(new Event('online'))));
  await expect(page.locator('.food-row')).toContainText('200g');
  await expect(page.getByText('800 kcal', { exact: true })).toBeVisible();
});

test('[J-239] resuming after midnight refreshes today while preserving the selected day and product draft', async ({ page, request }) => {
  await boot(page, request, 'resume-midnight');
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', { name: 'Add New', exact: true }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('My unfinished midnight food');
  await fillNutField(page, 'Kcal', '123');
  await fillNutField(page, 'Protein', '4.5');
  await background(page);
  await page.clock.setFixedTime(new Date(2030, 0, 8, 8, 0));
  const responses = await readCycle(page, () => foreground(page), 6);
  const dates = responses.map((response) => new URL(response.url()))
    .filter((url) => url.pathname === '/entries').map((url) => url.searchParams.get('date'));
  expect(dates.sort()).toEqual([MONDAY, TUESDAY]);
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveValue('My unfinished midnight food');
  await expect(page.locator('.sheet label').filter({ hasText: /^Kcal$/ }).locator('..').getByRole('spinbutton')).toHaveValue('123');
  await expect(page.locator('.sheet label').filter({ hasText: /^Protein$/ }).locator('..').getByRole('spinbutton')).toHaveValue('4.5');
  await expect(page.getByRole('button', { name: 'M 7', exact: true })).toHaveClass(/selected/);
  await expect(page.getByRole('button', { name: 'T 8', exact: true })).toHaveClass(/today/);
});

test('[J-240] an open product picker refreshes search and library data without losing its query or scope', async ({ page, request }) => {
  const token = await boot(page, request, 'resume-picker');
  const first = await product(request, token, 'Resume picker first');
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  const sheet = page.locator('.sheet');
  await expect(sheet.getByRole('button').filter({ hasText: first.name })).toBeVisible();
  await sheet.getByRole('button', { name: 'Global', exact: true }).tap();
  await page.getByPlaceholder('Search products...').fill('Resume picker');
  await expect(sheet.getByText('1 result', { exact: true })).toBeVisible();
  await background(page);
  const second = await product(request, token, 'Resume picker second');
  await rest(request, token, 'put', `/products/${first.id}`, { ...first, per100: { ...NUTRITION, kcal: 555 } });
  const refreshedSearch = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/products/search' && url.searchParams.get('q') === 'Resume picker' && url.searchParams.get('global') === '1';
  });
  await readCycle(page, () => foreground(page));
  await refreshedSearch;
  await expect(page.getByPlaceholder('Search products...')).toHaveValue('Resume picker');
  await expect(sheet.getByRole('button', { name: 'Global', exact: true })).toHaveClass(/scopeBtnActive/);
  await expect(sheet.getByText('2 results', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: first.name }).getByText('555', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: second.name })).toBeVisible();
  await sheet.getByRole('button', { name: 'Clear', exact: true }).tap();
  await expect(sheet.getByRole('button').filter({ hasText: second.name })).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: first.name }).getByText('555', { exact: true })).toBeVisible();
});

test('[J-241] an open weight history refreshes while an unfinished weight edit keeps every typed field', async ({ page, request }) => {
  const token = await boot(page, request, 'resume-weights');
  const first = await rest<WeightEntry>(request, token, 'post', '/weights', {
    local_date: MONDAY, weight_kg: 80, note: 'Original note',
  });
  await page.getByRole('button', { name: 'Weights', exact: true }).tap();
  await expect(page.locator('.weight-row')).toContainText('80.0 kg');
  await background(page);
  await rest(request, token, 'put', `/weights/${first.id}`, { ...first, weight_kg: 81.2, note: 'Changed elsewhere' });
  await rest(request, token, 'post', '/weights', { local_date: TUESDAY, weight_kg: 82, note: 'New elsewhere' });
  await readCycle(page, () => foreground(page));
  await expect(page.locator('.weight-row')).toHaveCount(2);
  await expect(page.locator('.weight-row').filter({ hasText: 'Changed elsewhere' })).toContainText('81.2 kg');
  await page.getByRole('button', { name: `Edit weigh-in for ${MONDAY}`, exact: true }).tap();
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('83.3');
  await page.getByLabel('Note', { exact: true }).fill('My unfinished weight note');
  await page.getByRole('checkbox', { name: 'Pooped', exact: true }).tap();
  await background(page);
  await rest(request, token, 'post', '/weights', { local_date: '2030-01-09', weight_kg: 84, note: 'Newest elsewhere' });
  await readCycle(page, () => foreground(page));
  await expect(page.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue('83.3');
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('My unfinished weight note');
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(MONDAY);
  await expect(page.getByRole('checkbox', { name: 'Peed', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Pooped', exact: true })).toBeChecked();
  await page.locator('.sheet').getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.locator('.weight-row')).toHaveCount(3);
  await expect(page.locator('.weight-row').first()).toContainText('Newest elsewhere');
});

test('[J-242] an older resume response cannot overwrite newer day entries or week totals', async ({ page, request }) => {
  const token = await boot(page, request, 'resume-stale-read');
  const saved = await product(request, token, 'Resume stale read food');
  const logged = await entry(request, token, saved.id);
  await readCycle(page, () => resume(page));
  const release = deferred();
  const captured = deferred();
  const fulfilled = deferred();
  const held = new Set<string>();
  let fetched = 0;
  let completed = 0;
  await page.route('**/entries?*', holdFirstRead);
  await page.route('**/entries/week?*', holdFirstRead);
  async function holdFirstRead(route: import('@playwright/test').Route) {
    const url = route.request().url();
    if (held.has(url)) return route.continue();
    held.add(url);
    // Fetch before waiting, otherwise the delayed request would see the new
    // server state and could not expose stale-response overwrites.
    const response = await route.fetch();
    if (++fetched === 4) captured.resolve();
    await release.promise;
    await route.fulfill({ response });
    if (++completed === 4) fulfilled.resolve();
  }
  try {
    await resume(page);
    await captured.promise;
    await rest(request, token, 'patch', `/entries/${logged.id}`, { grams: 300 });
    await readCycle(page, () => resume(page));
    await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
    const dot = page.getByRole('button', { name: 'M 7', exact: true }).locator('[style*="--dot-opacity"]');
    await expect(dot).toHaveCSS('opacity', '0.5');
    release.resolve();
    await fulfilled.promise;
    await frame(page);
    await expect(page.locator('.food-row')).toContainText('300g');
    await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
    await expect(dot).toHaveCSS('opacity', '0.5');
  } finally { release.resolve(); }
});

test('[J-243] refreshing a committed entry before its delayed save response does not duplicate it', async ({ page, request }) => {
  const token = await boot(page, request, 'resume-post');
  const saved = await product(request, token, 'Resume pending save food');
  const release = deferred();
  const committed = deferred();
  await page.route('**/entries', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    committed.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
    await page.locator('.sheet').getByRole('button').filter({ hasText: saved.name }).tap();
    await expect(page.locator('.sheet').getByText('How much?', { exact: true })).toBeVisible();
    await page.locator('.sheet').getByRole('spinbutton').fill('100');
    const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/entries' && response.request().method() === 'POST');
    await page.locator('.sheet').getByRole('button', { name: /Add to day/ }).tap();
    await committed.promise;
    await readCycle(page, () => resume(page));
    await expect(page.locator('.food-row')).toHaveCount(1);
    await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
    release.resolve();
    await (await savedResponse).finished();
    await frame(page);
    await expect(page.locator('.food-row')).toHaveCount(1);
    await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
    expect(await rest<EntryWithMacros[]>(request, token, 'get', `/entries?date=${MONDAY}`)).toHaveLength(1);
  } finally { release.resolve(); }
});
