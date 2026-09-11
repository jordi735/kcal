import { expect, test, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { fillNutField, signInFresh } from './helpers';
import type { EntryWithMacros, Product } from '../../shared/types';
import { barcodeFillReturnState, mergeLabelDraft } from '../../src/modalState';

test.use({ storageState: { cookies: [], origins: [] } });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  }));
}

async function account(page: Page) {
  return page.evaluate(() => {
    const now = new Date();
    return {
      token: localStorage.getItem('kcal_session_token')!,
      date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
      dayName: `${['S', 'M', 'T', 'W', 'T', 'F', 'S'][now.getDay()]} ${now.getDate()}`,
    };
  });
}

async function product(request: APIRequestContext, token: string, name: string): Promise<Product> {
  const response = await request.post('/products', {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, brand: null, barcode: null, unit: 'g', is_temp: false,
      per100: { kcal: 400, protein: 10, carbs: 20, fat: 5 } },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

async function logFood(page: Page, name: string, grams: string) {
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button').filter({ hasText: name }).tap();
  await expect(page.locator('.sheet').getByText('How much?', { exact: true })).toBeVisible();
  await page.locator('.sheet').getByRole('spinbutton').fill(grams);
  await page.locator('.sheet').getByRole('button', { name: /Add to day/ }).tap();
  await expect(page.locator('.sheet')).toHaveCount(0);
}

async function fillDraft(page: Page, name: string) {
  await page.getByPlaceholder('e.g. Peanut Butter').fill(name);
  await page.locator('.sheet label').filter({ hasText: /^Brand$/ }).locator('..').getByRole('textbox').fill('Draft Brand');
  await page.locator('.sheet label').filter({ hasText: /^Barcode$/ }).locator('..').getByRole('textbox').fill('1234567890');
  await page.locator('.sheet').getByRole('button', { name: 'Millilitres', exact: true }).tap();
  for (const [label, value] of [['Kcal', '123'], ['Protein', '4.5'], ['Carbs', '6.7'], ['Fat', '8.9']]) {
    await fillNutField(page, label!, value!);
  }
}

async function expectDraft(page: Page, name: string) {
  const sheet = page.locator('.sheet');
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveValue(name);
  await expect(sheet.locator('label').filter({ hasText: /^Brand$/ }).locator('..').getByRole('textbox')).toHaveValue('Draft Brand');
  await expect(sheet.locator('label').filter({ hasText: /^Barcode$/ }).locator('..').getByRole('textbox')).toHaveValue('1234567890');
  await expect(sheet.getByText('Per 100ml', { exact: true })).toBeVisible();
  for (const [label, value] of [['Kcal', '123'], ['Protein', '4.5'], ['Carbs', '6.7'], ['Fat', '8.9']]) {
    await expect(sheet.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').getByRole('spinbutton')).toHaveValue(value!);
  }
}

test('[J-225] goal revalidation and saves do not repeat day or week reads', async ({ page, request }) => {
  // Finish the initial boot before simulating another device's settings edit.
  // Otherwise its still-pending GET could cache the edited goals before reload
  // or leak initial day/week requests into the reload-only counters below.
  const bootReads: Promise<unknown>[] = [];
  const recordBootRead = (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() === 'GET' && ['/settings', '/entries', '/entries/week'].includes(path)) {
      bootReads.push(response.finished());
    }
  };
  page.on('response', recordBootRead);
  await signInFresh(page, request, 'parity-goals');
  await expect.poll(() => bootReads.length).toBe(5);
  await Promise.all(bootReads);
  page.off('response', recordBootRead);
  await frame(page);
  const { token } = await account(page);
  const changed = await request.put('/settings', {
    headers: { Authorization: `Bearer ${token}` }, data: { kcal: 1234, protein: 56, carbs: 78, fat: 90 },
  });
  expect(changed.ok()).toBe(true);
  const release = deferred();
  const seen = deferred();
  const reads = { days: 0, weeks: 0 };
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const path = new URL(req.url()).pathname;
    if (path === '/entries') reads.days++;
    if (path === '/entries/week') reads.weeks++;
  });
  await page.route('**/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    seen.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await page.reload();
    await seen.promise;
    await expect(page.getByText(/^\/ 2400$/)).toBeVisible();
    await expect.poll(() => reads).toEqual({ days: 1, weeks: 3 });
    release.resolve();
    await expect(page.getByText(/^\/ 1234$/)).toBeVisible();
    await frame(page);
    expect(reads).toEqual({ days: 1, weeks: 3 });
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await page.locator('.sheet').getByRole('button', { name: /Save/ }).tap();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await frame(page);
    expect(reads).toEqual({ days: 1, weeks: 3 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user')!).goal_kcal)).toBe(1234);
  } finally { release.resolve(); }
});

for (const [id, mode] of [['J-226', 'new'], ['J-227', 'temp'], ['J-228', 'edit']] as const) {
  test(`[${id}] barcode cancellation preserves the ${mode} product draft and return destination`, async ({ page, request }) => {
    await signInFresh(page, request, `parity-scan-${mode}`);
    if (mode === 'edit') {
      const { token } = await account(page);
      const saved = await product(request, token, 'E2E Parity Scanner Saved');
      await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
      await page.locator('.sheet').getByRole('button').filter({ hasText: saved.name }).tap();
      await page.locator('.sheet').getByRole('button', { name: 'Edit product', exact: true }).tap();
    } else {
      await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
      await page.locator('.sheet').getByRole('button', { name: mode === 'temp' ? 'Add Temp' : 'Add New', exact: true }).tap();
    }
    const name = `E2E Parity ${mode} Draft`;
    await fillDraft(page, name);
    await page.locator('.sheet').getByRole('button', { name: 'Scan barcode', exact: true }).tap();
    await expect(page.getByText('SCAN BARCODE', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '×', exact: true }).tap();
    await expect(page.getByText('SCAN BARCODE', { exact: true })).toHaveCount(0);
    await expectDraft(page, name);
    await expect(page.locator('.sheet').getByText(mode === 'edit' ? 'Edit Product' : mode === 'temp' ? 'Add Temp Item' : 'New Product', { exact: true })).toBeVisible();
    await page.locator('.sheet').getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(page.locator('.sheet').getByText(mode === 'edit' ? 'How much?' : 'Add Food', { exact: true })).toBeVisible();
  });
}

test('[J-229] cancelling the AI file picker preserves a temporary product draft', async ({ page, request }) => {
  await signInFresh(page, request, 'parity-ai-cancel');
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', { name: 'Add Temp', exact: true }).tap();
  await fillDraft(page, 'E2E Parity AI Draft');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.sheet').getByRole('button', { name: /Scan label with AI/ }).tap();
  await chooser;
  await page.locator('input[type=file]').dispatchEvent('cancel');
  await expectDraft(page, 'E2E Parity AI Draft');
  await expect(page.locator('.sheet').getByText('Add Temp Item', { exact: true })).toBeVisible();
});

test('[J-230] a replacement error retains its full notification lifetime', async ({ page, request }) => {
  await signInFresh(page, request, 'parity-toast');
  await page.clock.install();
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', { name: 'Add New', exact: true }).tap();
  await fillDraft(page, 'E2E Parity Invalid Product');
  await fillNutField(page, 'Kcal', '2500');
  const save = page.locator('.sheet').getByRole('button', { name: /Save & Continue/ });
  await save.tap();
  await expect(page.getByText('invalid_product', { exact: true })).toBeVisible();
  await page.clock.fastForward(3000);
  const failed = page.waitForResponse((res) => new URL(res.url()).pathname === '/products' && res.status() === 400);
  await save.tap();
  await failed;
  await frame(page);
  await page.clock.fastForward(1100);
  await expect(page.getByText('invalid_product', { exact: true })).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(page.getByText('invalid_product', { exact: true })).toHaveCount(0);
});

test('[J-231] reversed entry responses preserve insertion order and totals', async ({ page, request }) => {
  await signInFresh(page, request, 'parity-order');
  const { token } = await account(page);
  const first = await product(request, token, 'E2E Parity Order First');
  const second = await product(request, token, 'E2E Parity Order Second');
  const release = deferred();
  const seen = deferred();
  await page.route('**/entries', async (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().product_id !== first.id) return route.continue();
    const response = await route.fetch();
    seen.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await logFood(page, first.name, '100');
    await seen.promise;
    await logFood(page, second.name, '200');
    await expect(page.locator('.food-row')).toHaveCount(1);
    release.resolve();
    await expect(page.locator('.food-row')).toHaveCount(2);
    await expect(page.locator('.food-row').nth(0)).toContainText(first.name);
    await expect(page.locator('.food-row').nth(1)).toContainText(second.name);
    await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('.food-row').nth(0)).toContainText(first.name);
    await expect(page.locator('.food-row').nth(1)).toContainText(second.name);
    await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
  } finally { release.resolve(); }
});

test('[J-232] adding before a day finishes loading preserves the loaded week total', async ({ page, request }) => {
  await signInFresh(page, request, 'parity-unloaded');
  const { token, date, dayName } = await account(page);
  const saved = await product(request, token, 'E2E Parity Unloaded');
  const seeded = await request.post('/entries', {
    headers: { Authorization: `Bearer ${token}` },
    data: { product_id: saved.id, grams: 300, local_date: date, local_time: '10:00' },
  });
  expect(seeded.ok()).toBe(true);
  const release = deferred();
  const seen = deferred();
  await page.route('**/entries?date=*', async (route) => {
    seen.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await page.reload();
    await seen.promise;
    // The progress dot is the visible consumer of cached week totals. This
    // custom property is stable across CSS-module class renaming.
    const dot = page.getByRole('button', { name: dayName, exact: true }).locator('[style*="--dot-opacity"]');
    await expect(dot).toHaveCSS('opacity', '0.5');
    await logFood(page, saved.name, '100');
    await expect(page.locator('.food-row')).toHaveCount(1);
    await expect(dot).toHaveCSS('opacity', '0.5');
    release.resolve();
    await expect(page.locator('.food-row')).toHaveCount(2);
    await expect(page.getByText('1600 kcal', { exact: true })).toBeVisible();
  } finally { release.resolve(); }
});

test('[J-233] a rejected entry edit leaves the client cache and totals unchanged', async ({ page, request }) => {
  await signInFresh(page, request, 'parity-failed-edit');
  const { token, date } = await account(page);
  const saved = await product(request, token, 'E2E Parity Failed Edit');
  await logFood(page, saved.name, '100');
  await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
  const response = await request.get(`/entries?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
  const [entry] = await response.json() as EntryWithMacros[];
  const removed = await request.delete(`/entries/${entry!.id}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(removed.ok()).toBe(true);
  await page.locator('.food-row').getByRole('button').filter({ hasText: saved.name }).tap();
  await page.locator('.sheet').getByRole('spinbutton').fill('200');
  await page.locator('.sheet').getByRole('button', { name: /Save/ }).tap();
  await expect(page.getByText('not_found', { exact: true })).toBeVisible();
  await expect(page.locator('.food-row')).toContainText('100g');
  await expect(page.getByText('400 kcal', { exact: true })).toBeVisible();
});

test('[J-234] scan results preserve typed metadata and change only the intended draft fields', () => {
  // These deterministic draft checks complement cancellation in the browser;
  // they do not claim to exercise camera decoding or live model inference.
  const draft = {
    name: 'My typed name', brand: 'My typed brand', barcode: 'old-code',
    unit: 'g' as const, is_temp: true,
    per100: { kcal: 100, protein: 1, carbs: 2, fat: 3 },
  };
  const label = {
    name: 'Extracted name', brand: 'Extracted brand', unit: 'ml' as const,
    per100: { kcal: 250, protein: 4, carbs: 5, fat: 6 },
  };
  const original = structuredClone(draft);
  expect(mergeLabelDraft(draft, label)).toEqual({
    name: 'My typed name', brand: 'My typed brand', barcode: 'old-code',
    unit: 'ml', is_temp: true, per100: { kcal: 250, protein: 4, carbs: 5, fat: 6 },
  });
  expect(mergeLabelDraft({ ...draft, name: '  ', brand: '' }, label)).toEqual({
    name: 'Extracted name', brand: 'Extracted brand', barcode: 'old-code',
    unit: 'ml', is_temp: true, per100: { kcal: 250, protein: 4, carbs: 5, fat: 6 },
  });
  expect(barcodeFillReturnState({ kind: 'barcode-scanner-fill', returnTo: 'new', draftSoFar: draft }, 'new-code'))
    .toEqual({ kind: 'new-product', initial: { ...original, barcode: 'new-code' } });

  const saved: Product = { ...draft, id: 12, is_temp: false };
  const entry: EntryWithMacros = {
    id: 34, product: saved, grams: 50, local_date: '2031-02-03', local_time: '12:30',
    tagged: true, group: null, macros: { kcal: 50, protein: 0.5, carbs: 1, fat: 1.5 },
  };
  for (const editEntry of [undefined, entry]) {
    expect(barcodeFillReturnState({
      kind: 'barcode-scanner-fill', returnTo: 'edit', draftSoFar: draft,
      editProduct: saved, editEntry,
    }, 'new-code')).toEqual({
      kind: 'edit-product', product: saved, entry: editEntry,
      initialOverride: { ...original, barcode: 'new-code' },
    });
  }
  expect(draft).toEqual(original);
});
