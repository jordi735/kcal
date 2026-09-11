import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { tokenFrom } from './auth-helpers';
import { longPress, signInFresh } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

type MacroSeed = { kcal: number; protein: number; carbs: number; fat: number };
type SeededEntry = {
  id: number;
  local_date: string;
  tagged: boolean;
  group: { id: number; name: string } | null;
  product: { id: number; name: string };
};

const MACROS_A: MacroSeed = { kcal: 100, protein: 10, carbs: 10, fat: 2 };
const MACROS_B: MacroSeed = { kcal: 200, protein: 20, carbs: 20, fat: 4 };
const MACROS_C: MacroSeed = { kcal: 50, protein: 5, carbs: 5, fat: 1 };

async function localDate(page: Page, dayOffset = 0): Promise<string> {
  return page.evaluate((offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, dayOffset);
}

async function localWeekStart(page: Page): Promise<string> {
  return page.evaluate(() => {
    const date = new Date();
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });
}

async function authHeaders(page: Page): Promise<{ Authorization: string }> {
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
  if (token === null) throw new Error('missing page session token');
  return { Authorization: `Bearer ${token}` };
}

async function seedEntry(
  page: Page,
  request: APIRequestContext,
  name: string,
  macros: MacroSeed,
  date: string,
): Promise<SeededEntry> {
  const headers = await authHeaders(page);
  const productResponse = await request.post('/products', {
    headers,
    data: {
      name,
      brand: null,
      unit: 'g',
      barcode: null,
      per100: macros,
      is_temp: false,
    },
  });
  expect(productResponse.status(), await productResponse.text()).toBe(201);
  const product = (await productResponse.json()) as { id: number };

  const entryResponse = await request.post('/entries', {
    headers,
    data: {
      product_id: product.id,
      grams: 100,
      local_date: date,
      local_time: '12:00',
    },
  });
  expect(entryResponse.ok(), await entryResponse.text()).toBeTruthy();
  return (await entryResponse.json()) as SeededEntry;
}

async function seedToday(
  page: Page,
  request: APIRequestContext,
  seeds: Array<{ name: string; macros: MacroSeed }>,
): Promise<SeededEntry[]> {
  const date = await localDate(page);
  const entries: SeededEntry[] = [];
  for (const seed of seeds) {
    entries.push(await seedEntry(page, request, seed.name, seed.macros, date));
  }
  await page.reload();
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
  return entries;
}

function foodRow(page: Page, name: string): Locator {
  return page.locator('.food-row').filter({ hasText: name });
}

function foodMain(page: Page, name: string): Locator {
  return foodRow(page, name).locator('button').nth(1);
}

function groupRow(page: Page, name: string): Locator {
  return page.locator('.entry-group').filter({ hasText: name });
}

async function createGroupFromRows(
  page: Page,
  firstName: string,
  secondName: string,
  groupName: string,
): Promise<void> {
  await longPress(foodMain(page, firstName));
  await foodMain(page, secondName).tap();
  await page.getByRole('button', { name: 'Group 2 selected', exact: true }).tap();
  await page.getByLabel('Group name', { exact: true }).fill(groupName);
  await page.getByRole('button', { name: 'Group items', exact: true }).tap();
  await expect(groupRow(page, groupName)).toBeVisible();
}

test('[J-169] selected entries become one collapsed persistent group without changing totals', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-happy');
  const a = 'G169 alpha';
  const b = 'G169 beta';
  const c = 'G169 loose';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
    { name: c, macros: MACROS_C },
  ]);

  const consumed = page.getByText('Consumed', { exact: true }).locator('..');
  await expect(consumed).toContainText('350 kcal');
  await createGroupFromRows(page, a, b, 'Ice cream batch');

  const parent = groupRow(page, 'Ice cream batch');
  await expect(parent).toContainText('2 items');
  await expect(parent).toContainText('300');
  await expect(parent).toContainText('P30');
  await expect(parent).toContainText('C30');
  await expect(parent).toContainText('F6');
  await expect(foodRow(page, a)).toHaveCount(0);
  await expect(foodRow(page, b)).toHaveCount(0);
  const looseRow = foodRow(page, c);
  await expect(looseRow).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(0);
  const [parentBackground, looseBackground] = await Promise.all([
    parent.evaluate((element) => getComputedStyle(element).backgroundColor),
    looseRow.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(parentBackground).toBe(looseBackground);
  await expect(consumed).toContainText('350 kcal');

  await page.getByRole('button', { name: 'Expand Ice cream batch', exact: true }).tap();
  await expect(foodRow(page, a)).toBeVisible();
  await expect(foodRow(page, b)).toBeVisible();

  await page.reload();
  await expect(groupRow(page, 'Ice cream batch')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Ice cream batch', exact: true })).toBeVisible();
  await expect(foodRow(page, a)).toHaveCount(0);
  await expect(foodRow(page, b)).toHaveCount(0);
  await expect(consumed).toContainText('350 kcal');
});

test('[J-170] group naming validates input and cancel preserves the selection', async ({ page, request }) => {
  await signInFresh(page, request, 'group-cancel');
  const a = 'G170 alpha';
  const b = 'G170 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);

  await longPress(foodMain(page, a));
  await expect(page.getByRole('button', { name: 'Group 1 selected', exact: true })).toHaveCount(0);
  await foodMain(page, b).tap();
  await page.getByRole('button', { name: 'Group 2 selected', exact: true }).tap();

  const submit = page.getByRole('button', { name: 'Group items', exact: true });
  const input = page.getByLabel('Group name', { exact: true });
  await expect(submit).toBeDisabled();
  await input.fill('   ');
  await expect(submit).toBeDisabled();
  await input.fill('Cancelled group');
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.locator('.sheet')).toHaveCount(0);

  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Group 2 selected', exact: true })).toBeVisible();
  await expect(groupRow(page, 'Cancelled group')).toHaveCount(0);
});

test('[J-171] failed group creation keeps the sheet, name, and selection for retry', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-retry');
  const a = 'G171 alpha';
  const b = 'G171 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);

  await longPress(foodMain(page, a));
  await foodMain(page, b).tap();
  await page.getByRole('button', { name: 'Group 2 selected', exact: true }).tap();
  await page.getByLabel('Group name', { exact: true }).fill('Retry batch');
  await page.route('**/entries/groups', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"group_failed"}' });
  });

  await page.getByRole('button', { name: 'Group items', exact: true }).tap();
  await expect(page.getByText('group_failed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Group name', { exact: true })).toHaveValue('Retry batch');
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();

  await page.unroute('**/entries/groups');
  await page.getByRole('button', { name: 'Group items', exact: true }).tap();
  await expect(groupRow(page, 'Retry batch')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(0);
});

test('[J-172] parent eaten control handles mixed state with one atomic request', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-tag');
  const a = 'G172 alpha';
  const b = 'G172 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);
  await createGroupFromRows(page, a, b, 'Tag batch');
  await page.getByRole('button', { name: 'Expand Tag batch', exact: true }).tap();

  await foodRow(page, a).getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
  const parentDot = groupRow(page, 'Tag batch').getByRole('button', {
    name: 'Mark Tag batch as eaten',
    exact: true,
  });
  await expect(parentDot).toHaveAttribute('aria-pressed', 'mixed');

  let groupPatchCount = 0;
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && /\/entries\/groups\/\d+\/tagged$/.test(req.url())) {
      groupPatchCount++;
    }
  });
  await parentDot.tap();
  await expect(
    groupRow(page, 'Tag batch').getByRole('button', {
      name: 'Mark Tag batch as not eaten',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(foodRow(page, a).getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
  await expect(foodRow(page, b).getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
  expect(groupPatchCount).toBe(1);

  await groupRow(page, 'Tag batch')
    .getByRole('button', { name: 'Mark Tag batch as not eaten', exact: true })
    .tap();
  await expect(
    groupRow(page, 'Tag batch').getByRole('button', {
      name: 'Mark Tag batch as eaten',
      exact: true,
    }),
  ).toHaveAttribute('aria-pressed', 'false');
});

test('[J-173] a group can be renamed and ungrouped without deleting entries', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-edit');
  const a = 'G173 alpha';
  const b = 'G173 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);
  await createGroupFromRows(page, a, b, 'Original batch');

  await page.getByRole('button', { name: 'Edit group Original batch', exact: true }).tap();
  await expect(page.getByLabel('Group name', { exact: true })).toHaveValue('Original batch');
  await page.getByLabel('Group name', { exact: true }).fill('Renamed   batch');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(groupRow(page, 'Renamed batch')).toBeVisible();
  await expect(groupRow(page, 'Original batch')).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit group Renamed batch', exact: true }).tap();
  await page.getByRole('button', { name: 'Ungroup', exact: true }).tap();
  await expect(groupRow(page, 'Renamed batch')).toHaveCount(0);
  await expect(foodRow(page, a)).toBeVisible();
  await expect(foodRow(page, b)).toBeVisible();
});

test('[J-174] long-pressing a parent selects and toggles all real children', async ({ page, request }) => {
  await signInFresh(page, request, 'group-select');
  const a = 'G174 alpha';
  const b = 'G174 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);
  await createGroupFromRows(page, a, b, 'Selection batch');

  const parentMain = page.getByRole('button', { name: 'Expand Selection batch', exact: true });
  await longPress(parentMain);
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete 2 selected', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Group 2 selected', exact: true })).toHaveCount(0);
  await expect(parentMain).toHaveAttribute('aria-expanded', 'false');

  await parentMain.tap();
  await expect(page.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(0);
  await expect(parentMain).toHaveAttribute('aria-expanded', 'false');
});

test('[J-175] deleting a child auto-ungroups the final remaining entry', async ({ page, request }) => {
  await signInFresh(page, request, 'group-singleton');
  const a = 'G175 alpha';
  const b = 'G175 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);
  await createGroupFromRows(page, a, b, 'Singleton batch');
  await page.getByRole('button', { name: 'Expand Singleton batch', exact: true }).tap();

  await foodMain(page, a).tap();
  await expect(page.getByText('Edit amount', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete entry', exact: true }).tap();
  await expect(foodRow(page, a)).toHaveCount(0);
  await expect(groupRow(page, 'Singleton batch')).toHaveCount(0);
  await expect(foodRow(page, b)).toBeVisible();

  await page.reload();
  await expect(groupRow(page, 'Singleton batch')).toHaveCount(0);
  await expect(foodRow(page, b)).toBeVisible();
});

test('[J-176] group creation validation is owner-scoped and rolls back invalid memberships', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-api');
  const today = await localDate(page);
  const tomorrow = await localDate(page, 1);
  const a = await seedEntry(page, request, 'G176 alpha', MACROS_A, today);
  const b = await seedEntry(page, request, 'G176 beta', MACROS_B, today);
  const future = await seedEntry(page, request, 'G176 future', MACROS_C, tomorrow);
  const headers = await authHeaders(page);

  const invalidCases = [
    { data: { name: 'One', entry_ids: [a.id] }, status: 400 },
    { data: { name: 'Duplicate', entry_ids: [a.id, a.id] }, status: 400 },
    { data: { name: 'Mixed dates', entry_ids: [a.id, future.id] }, status: 400 },
    { data: { name: 'Unknown', entry_ids: [a.id, 9999999] }, status: 404 },
  ];
  for (const invalid of invalidCases) {
    const response = await request.post('/entries/groups', { headers, data: invalid.data });
    expect(response.status()).toBe(invalid.status);
  }

  const user2Token = tokenFrom('tests/e2e/.auth/user2.json');
  const foreign = await request.post('/entries/groups', {
    headers: { Authorization: `Bearer ${user2Token}` },
    data: { name: 'Foreign', entry_ids: [a.id, b.id] },
  });
  expect(foreign.status()).toBe(404);

  const unchangedResponse = await request.get(`/entries?date=${today}`, { headers });
  const unchanged = (await unchangedResponse.json()) as SeededEntry[];
  expect(unchanged.find((entry) => entry.id === a.id)?.group).toBeNull();
  expect(unchanged.find((entry) => entry.id === b.id)?.group).toBeNull();

  const weekStart = await localWeekStart(page);
  const beforeWeekResponse = await request.get(`/entries/week?start=${weekStart}`, { headers });
  const beforeWeek = await beforeWeekResponse.json();

  const created = await request.post('/entries/groups', {
    headers,
    data: { name: 'Valid API batch', entry_ids: [a.id, b.id] },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: number };

  const afterWeekResponse = await request.get(`/entries/week?start=${weekStart}`, { headers });
  expect(await afterWeekResponse.json()).toEqual(beforeWeek);

  const regroup = await request.post('/entries/groups', {
    headers,
    data: { name: 'Regroup', entry_ids: [a.id, b.id] },
  });
  expect(regroup.status()).toBe(409);

  for (const attempt of [
    request.patch(`/entries/groups/${group.id}`, {
      headers: { Authorization: `Bearer ${user2Token}` },
      data: { name: 'Stolen' },
    }),
    request.patch(`/entries/groups/${group.id}/tagged`, {
      headers: { Authorization: `Bearer ${user2Token}` },
      data: { tagged: true },
    }),
    request.delete(`/entries/groups/${group.id}`, {
      headers: { Authorization: `Bearer ${user2Token}` },
    }),
  ]) {
    expect((await attempt).status()).toBe(404);
  }

  const preservedResponse = await request.get(`/entries?date=${today}`, { headers });
  const preserved = (await preservedResponse.json()) as SeededEntry[];
  expect(preserved.filter((entry) => entry.group?.id === group.id)).toHaveLength(2);
  expect(preserved.every((entry) => !entry.tagged)).toBeTruthy();
});

test('[J-177] deleting a product removes its entry and dissolves the resulting singleton group', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-product-delete');
  const today = await localDate(page);
  const a = await seedEntry(page, request, 'G177 alpha', MACROS_A, today);
  const b = await seedEntry(page, request, 'G177 beta', MACROS_B, today);
  const headers = await authHeaders(page);

  const created = await request.post('/entries/groups', {
    headers,
    data: { name: 'Product cleanup', entry_ids: [a.id, b.id] },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: number };

  const deleted = await request.delete(`/products/${a.product.id}`, { headers });
  expect(deleted.ok(), await deleted.text()).toBeTruthy();

  const listResponse = await request.get(`/entries?date=${today}`, { headers });
  const list = (await listResponse.json()) as SeededEntry[];
  expect(list.find((entry) => entry.id === a.id)).toBeUndefined();
  expect(list.find((entry) => entry.id === b.id)?.group).toBeNull();

  const removedGroup = await request.delete(`/entries/groups/${group.id}`, { headers });
  expect(removedGroup.status()).toBe(404);
});

test('[J-178] Enter submits the group name field', async ({ page, request }) => {
  await signInFresh(page, request, 'group-enter');
  const a = 'G178 alpha';
  const b = 'G178 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);

  await longPress(foodMain(page, a));
  await foodMain(page, b).tap();
  await page.getByRole('button', { name: 'Group 2 selected', exact: true }).tap();
  const input = page.getByLabel('Group name', { exact: true });
  await input.fill('Keyboard batch');
  await input.press('Enter');
  await expect(groupRow(page, 'Keyboard batch')).toBeVisible();
});

test('[J-179] backdrop dismissal makes no group and preserves selected entries', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-backdrop');
  const a = 'G179 alpha';
  const b = 'G179 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);

  await longPress(foodMain(page, a));
  await foodMain(page, b).tap();
  await page.getByRole('button', { name: 'Group 2 selected', exact: true }).tap();
  await page.getByLabel('Group name', { exact: true }).fill('Dismissed batch');
  let createRequests = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/entries/groups') {
      createRequests++;
    }
  });

  await page.locator('.overlay').tap({ position: { x: 10, y: 10 } });
  await expect(page.locator('.sheet')).toHaveCount(0);
  expect(createRequests).toBe(0);
  await expect(page.getByText('2 selected', { exact: true })).toBeVisible();
  await expect(groupRow(page, 'Dismissed batch')).toHaveCount(0);
});

test('[J-180] editing a grouped child updates the parent aggregate and keeps membership', async ({
  page,
  request,
}) => {
  await signInFresh(page, request, 'group-child-edit');
  const a = 'G180 alpha';
  const b = 'G180 beta';
  await seedToday(page, request, [
    { name: a, macros: MACROS_A },
    { name: b, macros: MACROS_B },
  ]);
  await createGroupFromRows(page, a, b, 'Editable batch');
  await page.getByRole('button', { name: 'Expand Editable batch', exact: true }).tap();

  await foodMain(page, a).tap();
  await expect(page.getByText('Edit amount', { exact: true })).toBeVisible();
  await page.getByRole('spinbutton').fill('200');
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  const parent = groupRow(page, 'Editable batch');
  await expect(parent).toContainText('400');
  await expect(parent).toContainText('P40');
  await expect(parent).toContainText('C40');
  await expect(parent).toContainText('F8');
  await expect(foodRow(page, a)).toContainText('200g');

  await page.reload();
  await expect(groupRow(page, 'Editable batch')).toContainText('400');
  await expect(foodRow(page, a)).toHaveCount(0);
});
