import { expect, test, type Page } from '@playwright/test';
import type { Goals, SettingsSnapshot, User, WeightEntry } from '../../src/types';
import { MAX_GOAL_KCAL, MAX_GOAL_MACRO_GRAMS } from '../../shared/constraints';
import { deferred, frame, resume } from './app-refresh-helpers';
import { signInFresh } from './helpers';
import { rest } from './mcp-helpers';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'UTC' });

const date = '2026-10-19';
const original: Goals = { kcal: 2000, protein: 100, carbs: 200, fat: 70 };
const changed: Goals = { kcal: 3000, protein: 150, carbs: 350, fat: 90 };
const snapshot = (goals = original): SettingsSnapshot => ({
  ...goals, goal_history: [{ effective_date: date, goals }], mcp_notice_version: null,
});
const user = (id = 1): User => ({
  id, email: `quality-${id}@test.local`, goal_kcal: original.kcal,
  goal_protein: original.protein, goal_carbs: original.carbs, goal_fat: original.fat,
});
const weight = (amount = 75): WeightEntry => ({
  id: 1, local_date: date, weight_kg: amount, note: null, peed: true, pooped: false,
});

async function boot(page: Page, options: { holdSettings?: Promise<void>; failSettings?: boolean } = {}) {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await page.addInitScript((cached) => {
    localStorage.setItem('kcal_session_token', 'quality-A');
    localStorage.setItem('kcal_user', JSON.stringify(cached));
  }, user());
  const state = {
    settings: snapshot(), settingsReads: 0, settingsWrites: [] as Record<string, unknown>[],
    failSettings: options.failSettings ?? false, weights: [weight()], weightReads: 0,
    weightWrites: 0, failWeights: false,
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/settings' && request.method() === 'GET') {
      state.settingsReads++;
      if (state.settingsReads === 1) await options.holdSettings;
      await route.fulfill(state.failSettings
        ? { status: 503, json: { error: 'offline' } } : { json: state.settings });
    } else if (path === '/settings' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Goals & { time_zone: string };
      state.settingsWrites.push(body);
      state.settings = snapshot(body);
      await route.fulfill({ json: { ...state.settings, effective_date: date } });
    } else if (path === '/entries') {
      await route.fulfill({ json: [] });
    } else if (path === '/entries/week') {
      await route.fulfill({ json: {} });
    } else if (path === '/weights') {
      state.weightReads++;
      await route.fulfill(state.failWeights
        ? { status: 503, json: { error: 'offline' } } : { json: state.weights });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  if (options.holdSettings === undefined && !state.failSettings) {
    await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  }
  return state;
}

const fields = (page: Page) => page.locator('.sheet').getByRole('spinbutton');
const saveButton = (page: Page) => page.locator('.sheet').getByRole('button', { name: 'Save', exact: true });
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(saveButton(page)).toBeVisible();
}
async function expectGoals(page: Page, goals: Goals) {
  for (const [index, value] of [goals.protein, goals.carbs, goals.fat, goals.kcal].entries()) {
    await expect(fields(page).nth(index)).toHaveValue(String(value));
  }
}
async function openWeightEdit(page: Page) {
  await page.getByRole('button', { name: 'Weights', exact: true }).tap();
  await page.getByRole('button', { name: `Edit weigh-in for ${date}` }).tap();
  await page.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('80');
}

test('[J-400] an untouched open goals form follows the authoritative snapshot without a stale save', async ({ page }) => {
  const state = await boot(page);
  await openSettings(page);
  // Focusing alone must not turn a pristine form into a draft.
  await fields(page).first().focus();
  await fields(page).first().blur();
  state.settings = snapshot(changed);
  await resume(page);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user')!).goal_kcal as number)).toBe(3000);
  await expectGoals(page, changed);
  await saveButton(page).tap();
  await expect.poll(() => state.settingsWrites).toEqual([{ ...changed, time_zone: 'UTC' }]);
});

test('[J-401] goal editing waits for the first settings snapshot instead of saving cached defaults', async ({ page }) => {
  const release = deferred();
  const state = await boot(page, { holdSettings: release.promise });
  state.settings = snapshot(changed);
  try {
    await openSettings(page);
    await expect(saveButton(page)).toBeDisabled();
    for (const input of await fields(page).all()) await expect(input).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Goal history', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Connect to ChatGPT', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
    release.resolve();
    await expectGoals(page, changed);
    await expect(saveButton(page)).toBeEnabled();
    expect(state.settingsWrites).toEqual([]);
    await saveButton(page).tap();
    await expect.poll(() => state.settingsWrites).toEqual([{ ...changed, time_zone: 'UTC' }]);
  } finally { release.resolve(); }
});

test('[J-402] a dirty goal vector survives refresh and both settings subviews without merging fields', async ({ page }) => {
  const state = await boot(page);
  await openSettings(page);
  await fields(page).first().fill('123');
  state.settings = snapshot(changed);
  await resume(page);
  await expect.poll(() => state.settingsReads).toBe(2);
  await frame(page);
  await expectGoals(page, { ...original, protein: 123 });
  for (const name of ['Goal history', 'Connect to ChatGPT']) {
    await page.getByRole('button', { name, exact: true }).tap();
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expectGoals(page, { ...original, protein: 123 });
  }
  await saveButton(page).tap();
  await expect.poll(() => state.settingsWrites).toEqual([{ ...original, protein: 123, time_zone: 'UTC' }]);
});

test('[J-403] failed initial goals offer Retry while later refresh failures retain editable goals', async ({ page }) => {
  const state = await boot(page, { failSettings: true });
  await openSettings(page);
  await expect(saveButton(page)).toBeDisabled();
  await expect(page.locator('.sheet').getByText('Couldn’t load goals. Try again.', { exact: true })).toBeVisible();
  state.failSettings = false;
  state.settings = snapshot(changed);
  await page.locator('.sheet').getByRole('button', { name: 'Retry', exact: true }).tap();
  await expectGoals(page, changed);
  await expect(saveButton(page)).toBeEnabled();
  state.failSettings = true;
  await resume(page);
  await expect.poll(() => state.settingsReads).toBe(3);
  await frame(page);
  await expectGoals(page, changed);
  await expect(saveButton(page)).toBeEnabled();
});

test('[J-404] a delayed committed weight save cannot replace another device’s newer weight', async ({ page, request }) => {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00Z`));
  await signInFresh(page, request, 'quality-weight-newer-read');
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token')!);
  const record = await rest<WeightEntry>(request, token, 'post', '/weights', {
    local_date: date, weight_kg: 75, note: null, peed: true, pooped: false,
  });
  const committed = deferred();
  const release = deferred();
  let browserWrites = 0;
  await page.route(`**/weights/${record.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    browserWrites++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    expect((await response.json() as WeightEntry).weight_kg).toBe(80);
    committed.resolve();
    await release.promise;
    await route.fulfill({ response });
  });
  try {
    await openWeightEdit(page);
    await saveButton(page).tap();
    await committed.promise;
    await rest(request, token, 'put', `/weights/${record.id}`, {
      local_date: date, weight_kg: 81, note: 'Updated on another device', peed: true, pooped: false,
    });
    const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === '/weights'
      && response.request().method() === 'GET');
    await resume(page);
    const read = await refreshed;
    await read.finished();
    expect(await read.json()).toEqual([{ ...record, weight_kg: 81, note: 'Updated on another device' }]);
    await frame(page);
    const writeFinished = page.waitForResponse((response) => new URL(response.url()).pathname === `/weights/${record.id}`
      && response.request().method() === 'PUT');
    release.resolve();
    await (await writeFinished).finished();
    await expect(page.locator('.weight-row')).toContainText('81.0 kg');
    await expect(page.locator('.weight-row')).toContainText('Updated on another device');
    expect(browserWrites).toBe(1);
    expect((await rest<WeightEntry[]>(request, token, 'get', '/weights'))[0]?.weight_kg).toBe(81);
  } finally { release.resolve(); }
});

test('[J-405] a delayed weight save preserves a newer read even when reconciliation fails', async ({ page }) => {
    const state = await boot(page);
    const committed = deferred();
    const release = deferred();
    await page.route('**/weights/1', async (route) => {
      state.weightWrites++;
      const saved = { ...weight(), ...route.request().postDataJSON() } as WeightEntry;
      state.weights = [saved];
      committed.resolve();
      await release.promise;
      await route.fulfill({ json: saved });
    });
    try {
      await openWeightEdit(page);
      await saveButton(page).tap();
      await committed.promise;
      state.weights = [weight(81)];
      const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === '/weights'
        && response.request().method() === 'GET');
      await resume(page);
      await (await refreshed).finished();
      await expect.poll(() => state.weightReads).toBe(2);
      await frame(page);
      state.failWeights = true;
      release.resolve();
      await expect(page.locator('.weight-row')).toContainText('81.0 kg');
      await expect.poll(() => state.weightReads).toBe(3);
      expect(state.weightWrites).toBe(1);
      expect(state.weights[0]?.weight_kg).toBe(81);
      await expect(page.getByText("Couldn't save this weigh-in. Try again.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toBeVisible();
    } finally { release.resolve(); }
});

test('[J-406] a delayed weight save from an old session cannot alter the replacement account history', async ({ page }) => {
  const state = await boot(page);
  const committed = deferred();
  const release = deferred();
  await page.route('**/weights/1', async (route) => {
    committed.resolve();
    await release.promise;
    await route.fulfill({ json: weight(80) });
  });
  try {
    await openWeightEdit(page);
    await saveButton(page).tap();
    await committed.promise;
    state.weights = [weight(90)];
    await page.evaluate((next) => {
      localStorage.setItem('kcal_session_token', 'quality-B');
      localStorage.setItem('kcal_user', JSON.stringify(next));
      window.dispatchEvent(new StorageEvent('storage', { key: 'kcal_session_token' }));
    }, user(2));
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.getByRole('button', { name: 'Weights', exact: true }).tap();
    await expect(page.locator('.weight-row')).toContainText('90.0 kg');
    const finished = page.waitForResponse((response) => new URL(response.url()).pathname === '/weights/1');
    release.resolve();
    await (await finished).finished();
    await frame(page);
    await expect(page.locator('.weight-row')).toContainText('90.0 kg');
    await expect(page.getByText("Couldn't save this weigh-in. Try again.", { exact: true })).toHaveCount(0);
  } finally { release.resolve(); }
});

test('[J-407] fractional goals show field validation and never issue a settings write', async ({ page }) => {
  const state = await boot(page);
  await openSettings(page);
  for (const index of [0, 1, 2, 3]) {
    const input = fields(page).nth(index);
    const before = await input.inputValue();
    await input.fill('1.5');
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.locator('.sheet').getByText(`Use a whole number from 0 to ${index === 3 ? MAX_GOAL_KCAL : MAX_GOAL_MACRO_GRAMS}.`, { exact: true })).toBeVisible();
    await saveButton(page).dispatchEvent('click');
    await frame(page);
    expect(state.settingsWrites).toEqual([]);
    await input.fill(before);
  }
  await expect(saveButton(page)).toBeEnabled();
});

test('[J-408] goal bounds reject oversized input and plus buttons stop at the shared maximum', async ({ page }) => {
  const state = await boot(page);
  await openSettings(page);
  for (const index of [0, 1, 2, 3]) {
    const input = fields(page).nth(index);
    const max = index === 3 ? MAX_GOAL_KCAL : MAX_GOAL_MACRO_GRAMS;
    await input.fill(String(max + 1));
    await expect(saveButton(page)).toBeDisabled();
    await input.fill(String(max));
    await expect(saveButton(page)).toBeEnabled();
    await input.locator('xpath=../..').getByRole('button').last().tap();
    await expect(input).toHaveValue(String(max));
  }
  await saveButton(page).tap();
  await expect.poll(() => state.settingsWrites).toEqual([{
    kcal: MAX_GOAL_KCAL, protein: MAX_GOAL_MACRO_GRAMS, carbs: MAX_GOAL_MACRO_GRAMS,
    fat: MAX_GOAL_MACRO_GRAMS, time_zone: 'UTC',
  }]);
});

test('[J-409] zero goals remain editable and save without macro split division errors', async ({ page }) => {
  const state = await boot(page);
  await openSettings(page);
  for (const input of await fields(page).all()) await input.fill('0');
  await expect(saveButton(page)).toBeEnabled();
  await expect(page.locator('.sheet')).not.toContainText('NaN');
  await saveButton(page).tap();
  await expect.poll(() => state.settingsWrites).toEqual([{ kcal: 0, protein: 0, carbs: 0, fat: 0, time_zone: 'UTC' }]);
});

test('[J-417] a weight save invalidates a still-pending older history response', async ({ page }) => {
  const state = await boot(page);
  await openWeightEdit(page);
  const captured = deferred();
  const release = deferred();
  let heldOnce = false;
  await page.route('**/weights', async (route) => {
    if (heldOnce) return route.fallback();
    heldOnce = true;
    const older = structuredClone(state.weights);
    captured.resolve();
    await release.promise;
    await route.fulfill({ json: older });
  });
  await page.route('**/weights/1', async (route) => {
    state.weightWrites++;
    state.weights = [{ ...weight(), ...route.request().postDataJSON() } as WeightEntry];
    await route.fulfill({ json: state.weights[0] });
  });
  try {
    await resume(page);
    await captured.promise;
    await saveButton(page).tap();
    await expect(page.locator('.weight-row')).toContainText('80.0 kg');
    const finished = page.waitForResponse((response) => new URL(response.url()).pathname === '/weights');
    release.resolve();
    await (await finished).finished();
    await frame(page);
    await expect(page.locator('.weight-row')).toContainText('80.0 kg');
    expect(state.weightWrites).toBe(1);
  } finally { release.resolve(); }
});
