import { expect, test, type Page } from '@playwright/test';
import { tokenFrom } from './auth-helpers';
import type { EntryUpdate, EntryWithMacros, Product } from '../../src/types';
import { computeMacros } from '../../src/macros';
import { deferred, frame, readCycle, resume } from './app-refresh-helpers';
import { fillNutField } from './helpers';

test('[J-460] product picker labels liquid nutrition per 100ml', async ({ page, request }) => {
  const token = tokenFrom('tests/e2e/.auth/user.json');
  const name = `V5 liquid label ${Date.now()}`;
  const created = await request.post('/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name, brand: null, barcode: null, unit: 'ml', is_temp: false,
      per100: { kcal: 50, protein: 3, carbs: 5, fat: 2 },
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  const sheet = page.locator('.sheet');
  await sheet.getByPlaceholder('Search products...').fill(name);
  const row = sheet.getByRole('button').filter({ hasText: name });
  await expect(row).toBeVisible();
  await expect(row).toContainText('per 100ml');
});

const DATE = '2030-01-07';
const milk: Product = {
  id: 1, name: 'Morning milk', brand: null, barcode: null, unit: 'ml', is_temp: false,
  per100: { kcal: 50, protein: 3, carbs: 5, fat: 2 },
};
const oatMilk: Product = {
  ...milk, id: 2, name: 'Oat milk', per100: { kcal: 40, protein: 1, carbs: 6, fat: 1 },
};
const oats: Product = { ...milk, id: 3, name: 'Oats', unit: 'g' };

async function entryEditorApp(page: Page, grouped = false, temporary = false,
  legacy: { amount?: number; localTime?: string } = {}) {
  const goals = { kcal: 250, protein: 100, carbs: 200, fat: 50 };
  const product = temporary ? { ...milk, is_temp: true } : milk;
  const first: EntryWithMacros = {
    id: 10, product, amount: legacy.amount ?? 250, local_date: DATE, local_time: legacy.localTime ?? '08:00',
    macros: computeMacros(product, legacy.amount ?? 250), tagged: true,
    group: grouped ? { id: 5, name: 'Two glasses of milk' } : null,
  };
  const state = {
    entries: grouped ? [first, { ...first, id: 11, local_time: '20:00' }] : [first],
    products: [product, oatMilk, oats], patches: [] as EntryUpdate[],
    afterPatch: null as (() => Promise<void>) | null,
    afterProductSave: null as (() => Promise<void>) | null,
    failReads: false,
  };
  await page.clock.setFixedTime(new Date(2030, 0, 7, 12));
  await page.addInitScript(() => {
    localStorage.setItem('kcal_session_token', 'entry-editor-v5');
    localStorage.setItem('kcal_user', JSON.stringify({ id: 1, email: 'entry-editor-v5@test.local',
      goal_kcal: 2000, goal_protein: 100, goal_carbs: 200, goal_fat: 50 }));
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/settings') {
      await route.fulfill({ json: { ...goals, goal_history: [{ effective_date: '2020-01-01', goals }], mcp_notice_version: null } });
    } else if (url.pathname === '/entries' && request.method() === 'GET') {
      await route.fulfill(state.failReads ? { status: 500, json: { error: 'unavailable' } } : { json: state.entries });
    } else if (url.pathname === '/entries/week') {
      const totals = state.entries.reduce((sum, entry) => ({ kcal: sum.kcal + entry.macros.kcal,
        protein: sum.protein + entry.macros.protein, carbs: sum.carbs + entry.macros.carbs,
        fat: sum.fat + entry.macros.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
      await route.fulfill(state.failReads ? { status: 500, json: { error: 'unavailable' } } : { json: { [DATE]: totals } });
    } else if (url.pathname === '/entries/recent-amounts') {
      await route.fulfill({ json: { amounts: [250] } });
    } else if (url.pathname === '/entries/10' && request.method() === 'PATCH') {
      const patch = request.postDataJSON() as EntryUpdate;
      state.patches.push(patch);
      const previous = state.entries[0]!;
      const replacement = state.products.find((candidate) => candidate.id === patch.product_id) ?? previous.product;
      const next = { ...previous, ...patch, product: replacement,
        macros: computeMacros(replacement, patch.amount ?? previous.amount) };
      state.entries[0] = next;
      const response = JSON.stringify(next);
      await state.afterPatch?.();
      await route.fulfill({ contentType: 'application/json', body: response });
    } else if (url.pathname === '/products/all' || url.pathname === '/products/recent' || url.pathname === '/products/search') {
      await route.fulfill({ json: state.products.filter((candidate) => !candidate.is_temp) });
    } else if (/^\/products\/\d+$/.test(url.pathname) && request.method() === 'PUT') {
      const id = Number(url.pathname.split('/').at(-1));
      const saved = { ...state.products.find((candidate) => candidate.id === id)!, ...request.postDataJSON() } as Product;
      state.products = state.products.map((candidate) => candidate.id === id ? saved : candidate);
      state.entries = state.entries.map((entry) => entry.product.id === id
        ? { ...entry, product: saved, macros: computeMacros(saved, entry.amount) } : entry);
      await state.afterProductSave?.();
      await route.fulfill({ json: saved });
    } else await route.fallback();
  });
  await readCycle(page, () => page.goto('/'));
  if (grouped) await page.getByRole('button', { name: 'Expand Two glasses of milk', exact: true }).tap();
  await page.locator('.food-row').first().getByRole('button').nth(1).tap();
  await expect(page.getByText('Edit entry', { exact: true })).toBeVisible();
  return state;
}

test('[J-461] replacing a grouped food keeps its quantity, identity, time and group while updating totals', async ({ page }) => {
  const state = await entryEditorApp(page, true);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Change food', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Add New', exact: true })).toHaveCount(0);
  await sheet.getByRole('button').filter({ hasText: oatMilk.name }).tap();
  await expect(sheet.getByRole('spinbutton')).toHaveValue('250');
  await expect(sheet.getByLabel('Entry time')).toHaveValue('08:00');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ product_id: 2 }]);
  expect(state.entries[0]).toMatchObject({ id: 10, amount: 250, local_time: '08:00', tagged: true,
    group: { id: 5, name: 'Two glasses of milk' }, product: { id: 2 } });
  expect(state.entries[1]).toMatchObject({ id: 11, amount: 250, local_time: '20:00', product: { id: 1 } });
  await expect(page.locator('.food-row').first()).toContainText('Oat milk');
  await expect(page.getByText('225 kcal', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'M 7', exact: true })
    .locator('[style*="--dot-opacity"]')).toHaveCSS('opacity', '0.9');
});

test('[J-462] switching quantity units requires a new amount and blocks blank button and Enter submission', async ({ page }) => {
  const state = await entryEditorApp(page);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Change food', exact: true }).tap();
  await sheet.getByRole('button').filter({ hasText: oats.name }).tap();
  const amount = sheet.getByRole('spinbutton');
  await expect(amount).toHaveValue('');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await amount.press('Enter');
  await frame(page);
  expect(state.patches).toEqual([]);
  await expect(sheet.getByText(/Amount must be/)).toBeVisible();
  await expect(amount).toHaveValue('');
  await amount.fill('29.5');
  await amount.press('Enter');
  await expect.poll(() => state.patches).toEqual([{ product_id: 3, amount: 29.5 }]);
  await expect(page.locator('.food-row')).toContainText('29.5g');
});

test('[J-463] backing out of food selection preserves the quantity and clock-time draft through a refresh', async ({ page }) => {
  const state = await entryEditorApp(page);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('spinbutton').fill('175.5');
  await sheet.getByLabel('Entry time').fill('21:45');
  const changeFood = sheet.getByRole('button', { name: 'Change food', exact: true });
  await changeFood.tap();
  await readCycle(page, () => resume(page));
  await sheet.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(changeFood).toBeFocused();
  await expect(sheet.getByRole('spinbutton')).toHaveValue('175.5');
  await expect(sheet.getByLabel('Entry time')).toHaveValue('21:45');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ amount: 175.5, local_time: '21:45' }]);
});

test('[J-464] library-product editing preserves the entry draft on cancel and save', async ({ page }) => {
  const state = await entryEditorApp(page);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('spinbutton').fill('175.5');
  await sheet.getByLabel('Entry time').fill('21:45');
  await sheet.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(sheet.getByText('Edit entry', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('spinbutton')).toHaveValue('175.5');
  await expect(sheet.getByLabel('Entry time')).toHaveValue('21:45');
  await sheet.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await fillNutField(page, 'Kcal', '100');
  await sheet.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await expect(sheet.getByText('Edit entry', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('spinbutton')).toHaveValue('175.5');
  await expect(sheet.getByLabel('Entry time')).toHaveValue('21:45');
  expect(state.patches).toEqual([]);
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ amount: 175.5, local_time: '21:45' }]);
  await expect(page.getByText('176 kcal', { exact: true })).toBeVisible();
});

test('[J-465] a late food-correction response cannot replace a newer foreground snapshot', async ({ page }) => {
  const state = await entryEditorApp(page);
  const committed = deferred();
  const release = deferred();
  state.afterPatch = async () => { committed.resolve(); await release.promise; };
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Change food', exact: true }).tap();
  await sheet.getByRole('button').filter({ hasText: oatMilk.name }).tap();
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await committed.promise;
  try {
    state.entries[0] = { ...state.entries[0]!, amount: 300, local_time: '22:00', macros: computeMacros(oatMilk, 300) };
    await readCycle(page, () => resume(page));
    await expect(page.locator('.food-row')).toContainText('300ml');
    const completed = page.waitForResponse((response) => new URL(response.url()).pathname === '/entries/10');
    release.resolve();
    await completed;
    await frame(page);
    await expect(page.locator('.food-row')).toContainText('300ml');
    await expect(page.locator('.food-row')).toContainText('22:00');
    await expect(page.getByText('120 kcal', { exact: true })).toBeVisible();
    expect(state.patches).toHaveLength(1);
  } finally { release.resolve(); }
});

test('[J-466] temporary entries allow time-only corrections without changing their amount', async ({ page }) => {
  const state = await entryEditorApp(page, false, true);
  const sheet = page.locator('.sheet');
  await sheet.getByLabel('Entry time').fill('20:30');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ local_time: '20:30' }]);
  await expect(page.locator('.food-row')).toContainText('250ml');
  await expect(page.locator('.food-row')).toContainText('20:30');
  await expect(page.locator('.food-row').getByText('TMP')).toBeVisible();
  await expect(page.getByText('125 kcal', { exact: true })).toBeVisible();
});

test('[J-467] failed reconciliation after a committed food correction remains a refresh failure', async ({ page }) => {
  const state = await entryEditorApp(page);
  const committed = deferred();
  const release = deferred();
  state.afterPatch = async () => { committed.resolve(); await release.promise; };
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Change food', exact: true }).tap();
  await sheet.getByRole('button').filter({ hasText: oatMilk.name }).tap();
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await committed.promise;
  try {
    state.entries[0] = { ...state.entries[0]!, amount: 300, macros: computeMacros(oatMilk, 300) };
    await readCycle(page, () => resume(page));
    await expect(page.locator('.food-row')).toContainText('300ml');
    state.failReads = true;
    release.resolve();
    await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toBeVisible();
    await expect(page.locator('.food-row')).toContainText('300ml');
    await expect(sheet).toHaveCount(0);
    expect(state.patches).toHaveLength(1);
    expect(state.entries[0]!.product.id).toBe(oatMilk.id);
  } finally { release.resolve(); }
});

test('[J-468] time and same-unit food corrections preserve an untouched legacy amount', async ({ page }) => {
  const state = await entryEditorApp(page, false, false, { amount: 0.5 });
  const sheet = page.locator('.sheet');
  await sheet.getByRole('spinbutton').focus();
  await sheet.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(sheet.getByText('Edit entry', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('spinbutton')).toHaveValue('0.5');
  await sheet.getByLabel('Entry time').fill('21:45');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ local_time: '21:45' }]);
  expect(state.entries[0]!.amount).toBe(0.5);
  await page.locator('.food-row').getByRole('button').nth(1).tap();
  await sheet.getByRole('button', { name: 'Change food', exact: true }).tap();
  await sheet.getByRole('button').filter({ hasText: oatMilk.name }).tap();
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ local_time: '21:45' }, { product_id: 2 }]);
  expect(state.entries[0]!.amount).toBe(0.5);
  await expect(page.locator('.food-row')).toContainText('0.5ml');
});

test('[J-469] amount-only correction preserves an untouched invalid legacy clock time', async ({ page }) => {
  const state = await entryEditorApp(page, false, false, { localTime: '99:99' });
  const sheet = page.locator('.sheet');
  // Native time inputs cannot display malformed stored values; the empty
  // control is not an instruction to clear or replace that legacy value.
  await expect(sheet.getByLabel('Entry time')).toHaveValue('');
  await sheet.getByRole('spinbutton').fill('300');
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect.poll(() => state.patches).toEqual([{ amount: 300 }]);
  expect(state.entries[0]!.local_time).toBe('99:99');
  await expect(page.locator('.food-row')).toContainText('300ml');
});

test('[J-470] dismissing a product form wins over a save completed during its closing fade', async ({ page }) => {
  await page.clock.install({ time: new Date(2030, 0, 7, 12) });
  const state = await entryEditorApp(page);
  const committed = deferred();
  const release = deferred();
  state.afterProductSave = async () => { committed.resolve(); await release.promise; };
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await fillNutField(page, 'Kcal', '100');
  await sheet.getByRole('button', { name: 'Save changes', exact: true }).tap();
  await committed.promise;
  try {
    await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 60_000));
    await page.locator('.overlay').dispatchEvent('click');
    await expect(sheet).toHaveCSS('pointer-events', 'none');
    let refreshed = 0;
    page.on('requestfinished', (request) => {
      if (request.method() === 'GET' && ['/entries', '/entries/week'].includes(new URL(request.url()).pathname)) refreshed++;
    });
    release.resolve();
    await expect.poll(() => refreshed).toBe(4);
    await page.clock.runFor(100);
    await expect(sheet.getByText('Edit entry', { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(1);
    await page.clock.runFor(250);
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText('250 kcal', { exact: true })).toBeVisible();
  } finally {
    release.resolve();
    await page.clock.resume();
  }
});
