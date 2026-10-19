import { expect, test, type Page } from '@playwright/test';
import type { EntryWithMacros, Goals, SettingsSnapshot, User } from '../../src/types';
import { deferred, frame, resume } from './app-refresh-helpers';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'UTC' });
const today = '2026-10-22';
const goals: Goals = { kcal: 3000, protein: 150, carbs: 300, fat: 80 };
const user = (id: number): User => ({ id, email: `account-${id}@test.local`, goal_kcal: goals.kcal, goal_protein: goals.protein, goal_carbs: goals.carbs, goal_fat: goals.fat });
const snapshot = (): SettingsSnapshot => ({ ...goals, goal_history: [{ effective_date: '2026-10-20', goals: { ...goals, kcal: 2000 } }, { effective_date: today, goals }], mcp_notice_version: null });
const food = (name = 'Account A food', grams = 100): EntryWithMacros => ({
  id: 1, product: { id: 1, name, brand: null, barcode: null, unit: 'g', is_temp: false, per100: { kcal: 100, protein: 10, carbs: 10, fat: 2 } },
  grams, local_date: today, local_time: '12:00', macros: { kcal: grams, protein: grams / 10, carbs: grams / 10, fat: grams / 50 }, tagged: false, group: null,
});

async function mockApp(page: Page, settings = snapshot(), beforeInitialize?: () => Promise<void>) {
  await page.clock.setFixedTime(new Date(`${today}T12:00:00Z`));
  await page.addInitScript((initial) => {
    localStorage.setItem('kcal_session_token', 'token-A');
    localStorage.setItem('kcal_user', JSON.stringify(initial));
  }, user(1));
  const state = { settings, rows: [food()], settingsReads: 0, initializations: [] as unknown[] };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accountB = request.headers()['authorization'] === 'Bearer token-B';
    if (url.pathname === '/settings' && request.method() === 'GET') {
      state.settingsReads++;
      await route.fulfill({ json: accountB ? { ...snapshot(), kcal: 4000, goal_history: [{ effective_date: today, goals: { ...goals, kcal: 4000 } }] } : state.settings });
    } else if (url.pathname === '/settings/goal-history/initialize') {
      state.initializations.push(request.postDataJSON());
      state.settings = { ...state.settings, goal_history: [{ effective_date: today, goals }] };
      const initialized = structuredClone(state.settings);
      await beforeInitialize?.();
      await route.fulfill({ json: initialized });
    } else if (url.pathname === '/products/recent' || url.pathname === '/products/all') {
      await route.fulfill({ json: [] });
    } else if (url.pathname === '/entries' && request.method() === 'GET') {
      await route.fulfill({ json: accountB ? [food('Account B food', 250)] : state.rows });
    } else if (url.pathname === '/entries/week') {
      await route.fulfill({ json: { [today]: accountB ? food('', 250).macros : state.rows[0]?.macros ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 } } });
    } else if (url.pathname === '/entries/recent-grams') {
      await route.fulfill({ json: { grams: [] } });
    } else if (url.pathname === '/auth/logout') {
      await route.fulfill({ json: { ok: true } });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/');
  await expect(page.locator('.food-row')).toContainText('Account A food');
  if (beforeInitialize === undefined) await expect(page.getByText('/ 3000', { exact: true })).toBeVisible();
  return state;
}

async function switchAccount(page: Page, id = 2) {
  await page.evaluate((next) => {
    localStorage.setItem('kcal_session_token', 'token-B');
    localStorage.setItem('kcal_user', JSON.stringify(next));
    window.dispatchEvent(new StorageEvent('storage', { key: 'kcal_session_token' }));
  }, user(id));
  await expect(page.locator('.food-row')).toContainText('Account B food');
  await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
}

async function finishHeld(page: Page, release: ReturnType<typeof deferred>, path: string, method = 'GET') {
  const response = page.waitForResponse((res) => new URL(res.url()).pathname === path
    && res.request().method() === method && res.request().headers()['authorization'] === 'Bearer token-A');
  release.resolve();
  await (await response).finished();
  await frame(page);
}

async function selectDay(page: Page, day: number) {
  await page.locator('[class*="weekGrid"]').nth(1).getByRole('button').filter({ has: page.locator('span', { hasText: new RegExp(`^${day}$`) }) }).tap();
}

test('[J-300] historical goals carry forward while unknown days omit targets and progress', async ({ page }) => {
  await mockApp(page);
  await selectDay(page, 21);
  await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  await selectDay(page, 19);
  await expect(page.getByText('No goal recorded', { exact: true })).toBeVisible();
  await expect(page.locator('[class*="kcalBar"]')).toHaveCount(0);
  await page.locator('.food-row').getByRole('button').last().tap();
  await expect(page.getByRole('group', { name: 'Daily totals' })).toContainText('No goal recorded for this day');
  await expect(page.getByRole('group', { name: 'Daily totals' })).not.toContainText('/ 3000');
  await page.locator('.overlay').dispatchEvent('click');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.locator('.sheet').getByRole('spinbutton').last()).toHaveValue('3000');
  await page.locator('.sheet').getByRole('spinbutton').last().fill('3210');
  await page.getByRole('button', { name: 'Goal history', exact: true }).tap();
  await expect(page.locator('time').first()).toHaveText(today);
  await expect(page.locator('time').last()).toHaveText('2026-10-20');
  await expect(page.locator('[data-sheet-scroll]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.locator('.sheet').getByRole('spinbutton').last()).toHaveValue('3210');
  await expect(page.getByRole('button', { name: 'Goal history', exact: true })).toBeFocused();
});

test('[J-301] an old account 401 cannot clear the new account or restore old rows', async ({ page }) => {
  await mockApp(page);
  const held = deferred();
  const release = deferred();
  await page.route('**/entries?date=*', async (route) => {
    if (route.request().headers()['authorization'] !== 'Bearer token-A') return route.fallback();
    held.resolve();
    await release.promise;
    await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
  });
  try {
    await resume(page);
    await held.promise;
    await switchAccount(page);
    await finishHeld(page, release, '/entries', 'GET');
    await expect(page.locator('.food-row')).toContainText('Account B food');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('kcal_session_token'))).toBe('token-B');
    await expect(page.locator('.food-row')).not.toContainText('Account A food');
  } finally { release.resolve(); }
});

test('[J-302] a late goal save cannot replace another account cached user or goals', async ({ page }) => {
  await mockApp(page);
  const held = deferred();
  const release = deferred();
  await page.route('**/settings', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    held.resolve();
    await release.promise;
    await route.fulfill({ json: { ...snapshot(), kcal: 999, goal_history: [{ effective_date: today, goals: { ...goals, kcal: 999 } }], effective_date: today } });
  });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await page.locator('.sheet').getByRole('spinbutton').last().fill('999');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await held.promise;
    await switchAccount(page);
    await finishHeld(page, release, '/settings', 'PUT');
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user') ?? '{}') as User)).toMatchObject({ id: 2, goal_kcal: 4000 });
  } finally { release.resolve(); }
});

test('[J-303] tag and amount writes are serialized and leave row and totals consistent', async ({ page }) => {
  const state = await mockApp(page);
  const held = deferred();
  const release = deferred();
  const writes: unknown[] = [];
  await page.route('**/entries/1', async (route) => {
    const patch = route.request().postDataJSON() as { tagged?: boolean; grams?: number };
    writes.push(patch);
    if (patch.tagged !== undefined) { held.resolve(); await release.promise; }
    const current = state.rows[0]!;
    state.rows = [{ ...food(current.product.name, patch.grams ?? current.grams), tagged: patch.tagged ?? current.tagged }];
    await route.fulfill({ json: state.rows[0] });
  });
  try {
    await page.getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
    await held.promise;
    await page.locator('.food-row').getByRole('button').last().tap();
    await page.locator('.sheet').getByRole('spinbutton').fill('200');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.locator('.sheet')).toHaveCount(0);
    expect(writes).toEqual([{ tagged: true }]);
    release.resolve();
    await expect(page.locator('.food-row')).toContainText('200g');
    await expect(page.getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
    await expect(page.locator('[class*="consumedValue"]')).toContainText('200');
    expect(writes).toEqual([{ tagged: true }, { grams: 200 }]);
  } finally { release.resolve(); }
});

test('[J-304] a delayed write reconciles instead of replacing a newer refreshed food row', async ({ page }) => {
  const state = await mockApp(page);
  const held = deferred();
  const release = deferred();
  await page.route('**/entries/1', async (route) => {
    held.resolve();
    await release.promise;
    await route.fulfill({ json: { ...food(), tagged: true } });
  });
  try {
    await page.getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
    await held.promise;
    state.rows = [{ ...food('Account A food', 200), tagged: true }];
    await resume(page);
    await expect(page.locator('.food-row')).toContainText('200g');
    await finishHeld(page, release, '/entries/1', 'PATCH');
    await expect(page.locator('.food-row')).toContainText('200g');
    await expect(page.locator('[class*="consumedValue"]')).toContainText('200');
  } finally { release.resolve(); }
});

test('[J-305] the ChatGPT reminder dismisses persistently and goal cache updates do not loop reads', async ({ page }) => {
  const state = await mockApp(page, { ...snapshot(), mcp_notice_version: 4 });
  await page.route('**/settings/mcp-notice/dismiss', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ version: 4 });
    state.settings.mcp_notice_version = null;
    await route.fulfill({ json: { mcp_notice_version: null } });
  });
  await expect(page.getByRole('complementary', { name: 'ChatGPT connection reminder' })).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss reminder' }).tap();
  await expect(page.getByRole('complementary', { name: 'ChatGPT connection reminder' })).toHaveCount(0);
  await resume(page);
  await expect.poll(() => state.settingsReads).toBe(2);
  await frame(page);
  expect(state.settingsReads).toBe(2);
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(page.getByRole('complementary', { name: 'ChatGPT connection reminder' })).toHaveCount(0);
});

test('[J-306] sign-in respects Retry-After and permits retry when the countdown expires', async ({ page }) => {
  await page.route('**/auth/request-code', (route) => route.fulfill({ status: 429, headers: { 'Retry-After': '2' }, json: { error: 'too_many_requests' } }));
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill('throttled@test.local');
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  await expect(page.getByText('Too many attempts. Try again in 2s.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Send sign-in code' })).toBeEnabled({ timeout: 5000 });
});


test('[J-307] first app open initializes the baseline once and never invents earlier goals', async ({ page }) => {
  const state = await mockApp(page, { ...snapshot(), goal_history: [] });
  expect(state.initializations).toEqual([{ time_zone: 'UTC' }]);
  await selectDay(page, 21);
  await expect(page.getByText('No goal recorded', { exact: true })).toBeVisible();
  await resume(page);
  await expect.poll(() => state.settingsReads).toBe(2);
  expect(state.initializations).toHaveLength(1);
});

test('[J-308] signing back into the same account drops its old session requests', async ({ page }) => {
  await mockApp(page);
  const held = deferred();
  const release = deferred();
  await page.route('**/settings', async (route) => {
    if (route.request().headers()['authorization'] !== 'Bearer token-A') return route.fallback();
    held.resolve();
    await release.promise;
    await route.fulfill({ json: snapshot() });
  });
  try {
    await resume(page);
    await held.promise;
    // A fresh bearer for the same user must remount all account-owned state.
    await switchAccount(page, 1);
    await finishHeld(page, release, '/settings', 'GET');
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user') ?? '{}') as User)).toMatchObject({ id: 1, goal_kcal: 4000 });
  } finally { release.resolve(); }
});

test('[J-309] queued food writes never start under a replacement session bearer', async ({ page }) => {
  await mockApp(page);
  const held = deferred();
  const release = deferred();
  const writes: string[] = [];
  await page.route('**/entries/1', async (route) => {
    writes.push(route.request().headers()['authorization'] ?? '');
    held.resolve();
    await release.promise;
    await route.fulfill({ json: { ...food(), tagged: true } });
  });
  try {
    await page.getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
    await held.promise;
    await page.locator('.food-row').getByRole('button').last().tap();
    await page.locator('.sheet').getByRole('spinbutton').fill('200');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(page.locator('.sheet')).toHaveCount(0);
    await switchAccount(page);
    await finishHeld(page, release, '/entries/1', 'PATCH');
    expect(writes).toEqual(['Bearer token-A']);
    await expect(page.locator('.food-row')).toContainText('250g');
  } finally { release.resolve(); }
});

test('[J-310] a delayed product save refreshes data without closing a newer modal', async ({ page }) => {
  const state = await mockApp(page);
  const held = deferred();
  const release = deferred();
  await page.route('**/products/1', async (route) => {
    held.resolve();
    await release.promise;
    state.rows = [food('Updated food')];
    await route.fulfill({ json: state.rows[0]!.product });
  });
  try {
    await page.locator('.food-row').getByRole('button').last().tap();
    await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
    await page.locator('.sheet').getByRole('button', { name: 'Save changes' }).tap();
    await held.promise;
    await page.locator('.overlay').dispatchEvent('click');
    await expect(page.locator('.sheet')).toHaveCount(0);
    await page.getByRole('button', { name: 'ADD FOOD' }).tap();
    await page.getByRole('button', { name: 'Add New', exact: true }).tap();
    await page.getByPlaceholder('e.g. Peanut Butter').fill('Keep this draft');
    release.resolve();
    await expect(page.locator('.food-row')).toContainText('Updated food');
    await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveValue('Keep this draft');
  } finally { release.resolve(); }
});

test('[J-311] a delayed initialization cannot overwrite a newer settings refresh', async ({ page }) => {
  const held = deferred();
  const release = deferred();
  const opening = mockApp(page, { ...snapshot(), goal_history: [] }, async () => { held.resolve(); await release.promise; });
  try {
    await held.promise;
    const fresh = { ...snapshot(), kcal: 4000, goal_history: [{ effective_date: today, goals: { ...goals, kcal: 4000 } }] };
    let refreshed = false;
    await page.route('**/settings', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      refreshed = true;
      await route.fulfill({ json: fresh });
    });
    await resume(page);
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
    await finishHeld(page, release, '/settings/goal-history/initialize', 'POST');
    expect(refreshed).toBe(true);
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
  } finally {
    release.resolve();
    await opening;
  }
});

test('[J-312] a recorded zero target remains a known goal', async ({ page }) => {
  const state = await mockApp(page);
  const zero = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  state.settings = { ...zero, goal_history: [{ effective_date: today, goals: zero }], mcp_notice_version: null };
  await resume(page);
  await expect(page.getByText('/ 0', { exact: true })).toBeVisible();
  await expect(page.getByText('Over budget', { exact: true })).toBeVisible();
  await expect(page.getByText('No goal recorded', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'T 22', exact: true }).locator('[style*="--dot-opacity"]')).toHaveCSS('opacity', '0');
});

test('[J-313] a committed product save stays successful when its follow-up refresh fails', async ({ page }) => {
  await mockApp(page);
  let committed = false;
  await page.route('**/entries**', async (route) => {
    if (!committed || !['/entries', '/entries/week'].includes(new URL(route.request().url()).pathname)) return route.fallback();
    await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
  });
  await page.route('**/products/1', async (route) => {
    committed = true;
    await route.fulfill({ json: food('Saved product').product });
  });
  await page.locator('.food-row').getByRole('button').last().tap();
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', { name: 'Save changes' }).tap();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toBeVisible();
  await expect(page.getByText("Couldn't save product", { exact: true })).toHaveCount(0);
});

test('[J-314] a delayed normal refresh cannot undo a completed settings reconciliation', async ({ page }) => {
  await mockApp(page);
  const saveHeld = deferred();
  const releaseSave = deferred();
  const reconcileHeld = deferred();
  const releaseReconcile = deferred();
  const refreshHeld = deferred();
  const releaseRefresh = deferred();
  const saved = { ...snapshot(), kcal: 3500, goal_history: [{ effective_date: today, goals: { ...goals, kcal: 3500 } }] };
  const fresh = { ...snapshot(), kcal: 4000, goal_history: [{ effective_date: today, goals: { ...goals, kcal: 4000 } }] };
  let reads = 0;
  await page.route('**/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      saveHeld.resolve();
      await releaseSave.promise;
      await route.fulfill({ json: { ...saved, effective_date: today } });
      return;
    }
    reads++;
    if (reads === 2) {
      // Delay the reconciliation read before it takes its server snapshot.
      reconcileHeld.resolve();
      await releaseReconcile.promise;
      await route.fulfill({ json: fresh });
    } else if (reads === 3) {
      // This normal refresh captures the saved value before another device's
      // change, but its delivery arrives after reconciliation saw that change.
      const captured = structuredClone(saved);
      refreshHeld.resolve();
      await releaseRefresh.promise;
      await route.fulfill({ json: captured });
    } else {
      await route.fulfill({ json: saved });
    }
  });
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await page.locator('.sheet').getByRole('spinbutton').last().fill('3500');
    await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).tap();
    await saveHeld.promise;
    // The first normal read applies during the pending write, requiring a
    // reconciliation rather than blindly accepting the write's snapshot.
    await resume(page);
    await expect(page.getByText('/ 3500', { exact: true })).toBeVisible();
    await finishHeld(page, releaseSave, '/settings', 'PUT');
    await reconcileHeld.promise;
    await resume(page);
    await refreshHeld.promise;
    await finishHeld(page, releaseReconcile, '/settings');
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
    await finishHeld(page, releaseRefresh, '/settings');
    await expect(page.getByText('/ 4000', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('kcal_user') ?? '{}') as User)).toMatchObject({ goal_kcal: 4000 });
  } finally {
    releaseSave.resolve();
    releaseReconcile.resolve();
    releaseRefresh.resolve();
  }
});

test('[J-315] Settings edits the latest goals while the home view resolves the local day', async ({ page }) => {
  const state = await mockApp(page);
  const earlier = { kcal: 2000, protein: 100, carbs: 200, fat: 50 };
  const latest = { kcal: 4000, protein: 200, carbs: 400, fat: 100 };
  state.settings = {
    ...latest,
    goal_history: [
      { effective_date: today, goals: earlier },
      { effective_date: '2026-10-23', goals: latest },
    ],
    mcp_notice_version: null,
  };
  await resume(page);
  await expect(page.getByText('/ 2000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  for (const [index, value] of [latest.protein, latest.carbs, latest.fat, latest.kcal].entries()) {
    await expect(page.locator('.sheet').getByRole('spinbutton').nth(index)).toHaveValue(String(value));
  }
});
