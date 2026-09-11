import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import type { Goals, User } from '../../src/types';
import { frame, readCycle, resume } from './app-refresh-helpers';
import { signInFresh } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function openFreshApp(page: Page, request: APIRequestContext, prefix: string) {
  await readCycle(page, () => signInFresh(page, request, prefix));
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token'));
  expect(token).not.toBeNull();
  return { Authorization: `Bearer ${token}` };
}

async function expectGoals(page: Page, goals: Goals): Promise<void> {
  await expect(page.getByText(`/ ${goals.kcal}`, { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('kcal_user');
    if (raw === null) return null;
    const user = JSON.parse(raw) as User;
    return {
      kcal: user.goal_kcal,
      protein: user.goal_protein,
      carbs: user.goal_carbs,
      fat: user.goal_fat,
    };
  })).toEqual(goals);
}

async function holdNextGoalRead(page: Page) {
  const captured = deferred<Goals>();
  const released = deferred<void>();
  let heldRequest: Request | null = null;
  await page.route('**/settings', async (route) => {
    if (route.request().method() !== 'GET' || heldRequest !== null) {
      await route.fallback();
      return;
    }
    heldRequest = route.request();
    // Capture the real old server snapshot before delaying its delivery.
    // Delaying route.continue() would let the server read the newer goals.
    const response = await route.fetch();
    captured.resolve(await response.json() as Goals);
    await released.promise;
    await route.fulfill({ response });
  });
  return {
    captured: captured.promise,
    unblock: () => released.resolve(),
    release: async () => {
      const finished = page.waitForEvent('requestfinished', {
        predicate: (request) => request === heldRequest,
      });
      released.resolve();
      await finished;
      await frame(page);
    },
  };
}

test('[J-246] foreground goal refresh preserves drafts and an old read cannot undo saved goals', async ({
  page,
  request,
}) => {
  const headers = await openFreshApp(page, request, 'refresh-goal-save');
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  const sheet = page.locator('.sheet');
  await expect(sheet.getByText('Daily goals', { exact: true })).toBeVisible();
  const saved: Goals = { kcal: 1846, protein: 146, carbs: 246, fat: 46 };
  for (const [index, value] of [saved.protein, saved.carbs, saved.fat, saved.kcal].entries()) {
    await sheet.getByRole('spinbutton').nth(index).fill(String(value));
  }

  const remote: Goals = { kcal: 2046, protein: 104, carbs: 204, fat: 64 };
  const updated = await request.put('/settings', { headers, data: remote });
  expect(updated.ok(), await updated.text()).toBeTruthy();
  await resume(page);
  await expectGoals(page, remote);
  // Revalidation updates the live/cached goal props while this mounted form
  // keeps each typed field, including the input that still has focus.
  for (const [index, value] of [saved.protein, saved.carbs, saved.fat, saved.kcal].entries()) {
    await expect(sheet.getByRole('spinbutton').nth(index)).toHaveValue(String(value));
  }

  const held = await holdNextGoalRead(page);
  try {
    await resume(page);
    expect(await held.captured).toEqual(remote);
    await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    await expectGoals(page, saved);

    await held.release();
    await expectGoals(page, saved);
    const persisted = await request.get('/settings', { headers });
    expect(persisted.ok()).toBeTruthy();
    expect(await persisted.json()).toEqual(saved);
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await expect(sheet.getByText('Daily goals', { exact: true })).toBeVisible();
    for (const [index, value] of [saved.protein, saved.carbs, saved.fat, saved.kcal].entries()) {
      await expect(sheet.getByRole('spinbutton').nth(index)).toHaveValue(String(value));
    }
  } finally {
    held.unblock();
  }
});

test('[J-247] an older foreground goal response cannot overwrite a newer refresh', async ({
  page,
  request,
}) => {
  const headers = await openFreshApp(page, request, 'refresh-goal-order');
  const initial = await request.get('/settings', { headers });
  expect(initial.ok()).toBeTruthy();
  const oldGoals = await initial.json() as Goals;
  await expectGoals(page, oldGoals);
  const held = await holdNextGoalRead(page);
  try {
    await resume(page);
    expect(await held.captured).toEqual(oldGoals);
    const fresh: Goals = { kcal: 1947, protein: 147, carbs: 247, fat: 47 };
    const updated = await request.put('/settings', { headers, data: fresh });
    expect(updated.ok(), await updated.text()).toBeTruthy();

    await resume(page);
    await expectGoals(page, fresh);
    await held.release();
    await expectGoals(page, fresh);
  } finally {
    held.unblock();
  }
});
