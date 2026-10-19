import { expect, test, type Page } from '@playwright/test';
import type { Product } from '../../src/types';
import { MAX_ENTRY_AMOUNT } from '../../shared/constraints';
import { frame, resume } from './app-refresh-helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const food: Product = {
  id: 1, name: 'Quality oats', brand: null, barcode: null, unit: 'g', is_temp: false,
  per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 },
};

async function pickerApp(page: Page) {
  const goals = { kcal: 2000, protein: 100, carbs: 200, fat: 50 };
  const state = {
    all: [food], recent: [] as Product[], allFails: false, recentFails: false,
    searchFails: false, searchNetworkFails: false, searchResults: [food],
    searchReads: [] as string[], amounts: [] as number[],
  };
  await page.addInitScript(() => {
    localStorage.setItem('kcal_session_token', 'quality-picker');
    localStorage.setItem('kcal_user', JSON.stringify({
      id: 1, email: 'quality-picker@test.local', goal_kcal: 2000,
      goal_protein: 100, goal_carbs: 200, goal_fat: 50,
    }));
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/settings') {
      await route.fulfill({ json: { ...goals, goal_history: [{ effective_date: '2020-01-01', goals }], mcp_notice_version: null } });
    } else if (url.pathname === '/entries' && request.method() === 'GET') {
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/entries' && request.method() === 'POST') {
      const body = request.postDataJSON() as { amount: number; local_date: string; local_time: string };
      state.amounts.push(body.amount);
      await route.fulfill({ json: { id: 1, ...body, product: food, group: null, tagged: false, macros: food.per100 } });
    } else if (url.pathname === '/entries/week') {
      await route.fulfill({ json: {} });
    } else if (url.pathname === '/entries/recent-amounts') {
      await route.fulfill({ json: { amounts: [] } });
    } else if (url.pathname === '/products/all' || url.pathname === '/products/recent') {
      const all = url.pathname.endsWith('/all');
      await route.fulfill(all ? state.allFails ? { status: 500, json: { error: 'unavailable' } } : { json: state.all }
        : state.recentFails ? { status: 500, json: { error: 'unavailable' } } : { json: state.recent });
    } else if (url.pathname === '/products/search') {
      state.searchReads.push(url.search);
      if (state.searchNetworkFails) await route.abort('failed');
      else await route.fulfill(state.searchFails ? { status: 500, json: { error: 'unavailable' } } : { json: state.searchResults });
    } else await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  return state;
}

async function openPicker(page: Page) {
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  return page.locator('.sheet');
}

test('[J-420] failed initial library requests show a retryable error rather than an empty library', async ({ page }) => {
  const state = await pickerApp(page);
  state.allFails = state.recentFails = true;
  const sheet = await openPicker(page);
  await expect(sheet.getByText(/Couldn't load.*foods/)).toBeVisible();
  await expect(sheet.getByText(/Your library is empty/)).toHaveCount(0);
  state.allFails = state.recentFails = false;
  state.all = [];
  await sheet.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(sheet.getByText(/Your library is empty/)).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
});

test('[J-421] failed searches keep the query and retry without showing empty or unrelated results', async ({ page }) => {
  const state = await pickerApp(page);
  const sheet = await openPicker(page);
  state.searchFails = true;
  const query = sheet.getByPlaceholder('Search products...');
  await query.fill('oats');
  await expect(sheet.getByText("Couldn't search foods.", { exact: true })).toBeVisible();
  await expect(sheet.getByText(/not in your library yet/)).toHaveCount(0);
  state.searchFails = false;
  await sheet.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toBeVisible();
  state.searchNetworkFails = true;
  await query.fill('rice');
  await expect(sheet.getByText("Couldn't search foods.", { exact: true })).toBeVisible();
  await expect(query).toHaveValue('rice');
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toHaveCount(0);
  state.searchNetworkFails = false;
  state.searchResults = [];
  await sheet.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(sheet.getByText(/not in your library yet/)).toBeVisible();
});

test('[J-422] partial library failures retain usable foods and recover on retry', async ({ page }) => {
  const state = await pickerApp(page);
  state.recentFails = true;
  const sheet = await openPicker(page);
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toBeVisible();
  await expect(sheet.getByText(/Couldn't load.*foods/)).toBeVisible();
  state.recentFails = false;
  state.recent = [food];
  await sheet.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(sheet.getByText('Recent', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toHaveCount(1);
  state.allFails = true;
  await resume(page);
  await expect(sheet.getByText(/Couldn't load.*foods/)).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toBeVisible();
});

test('[J-423] failed foreground search preserves matching cached results and scope', async ({ page }) => {
  const state = await pickerApp(page);
  const sheet = await openPicker(page);
  await sheet.getByRole('button', { name: 'Global', exact: true }).tap();
  await sheet.getByPlaceholder('Search products...').fill('oats');
  await expect.poll(() => state.searchReads.at(-1)).toBe('?q=oats&global=1');
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toBeVisible();
  state.searchFails = true;
  await resume(page);
  await expect(sheet.getByText("Couldn't search foods.", { exact: true })).toBeVisible();
  await expect(sheet.getByRole('button').filter({ hasText: food.name })).toBeVisible();
  await expect(sheet.getByPlaceholder('Search products...')).toHaveValue('oats');
  state.searchFails = false;
  await sheet.getByRole('button', { name: 'Retry', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  expect(state.searchReads.at(-1)).toBe('?q=oats&global=1');
});

async function openAmount(page: Page) {
  const state = await pickerApp(page);
  const sheet = await openPicker(page);
  await sheet.getByRole('button').filter({ hasText: food.name }).tap();
  await expect(sheet.getByText('How much?', { exact: true })).toBeVisible();
  return { state, sheet, input: sheet.getByRole('spinbutton') };
}

test('[J-424] an oversized amount cannot submit by button and correcting it preserves decimal portions', async ({ page }) => {
  const { state, sheet, input } = await openAmount(page);
  await input.fill(String(MAX_ENTRY_AMOUNT + 1));
  await sheet.getByRole('button', { name: 'Add to day', exact: false }).tap();
  await frame(page);
  expect(state.amounts).toEqual([]);
  await expect(sheet.getByText(/Amount must be/)).toBeVisible();
  await input.fill('29.5');
  await sheet.getByRole('button', { name: 'Add to day', exact: false }).tap();
  await expect.poll(() => state.amounts).toEqual([29.5]);
  await expect(sheet).toHaveCount(0);
});

test('[J-425] an oversized amount cannot submit with Enter and the exact maximum remains valid', async ({ page }) => {
  const { state, sheet, input } = await openAmount(page);
  await input.fill(String(MAX_ENTRY_AMOUNT + 1));
  await input.press('Enter');
  await frame(page);
  expect(state.amounts).toEqual([]);
  await expect(sheet.getByText(/Amount must be/)).toBeVisible();
  await input.fill(String(MAX_ENTRY_AMOUNT));
  await input.press('Enter');
  await expect.poll(() => state.amounts).toEqual([MAX_ENTRY_AMOUNT]);
});

test('[J-426] amount increments clamp at the maximum and blank Enter does not log food', async ({ page }) => {
  const { state, input } = await openAmount(page);
  await input.fill(String(MAX_ENTRY_AMOUNT));
  await frame(page);
  await input.locator('../..').getByRole('button').last().tap();
  await frame(page);
  await expect(input).toHaveValue(String(MAX_ENTRY_AMOUNT));
  await input.fill('');
  await frame(page);
  await input.press('Enter');
  await frame(page);
  expect(state.amounts).toEqual([]);
  await input.fill('1');
  await input.press('Enter');
  await expect.poll(() => state.amounts).toEqual([1]);
});
