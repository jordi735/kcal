import { expect, test } from '@playwright/test';
import { frame, readCycle, resume } from './app-refresh-helpers';
import {
  HISTORY, ORIGINAL, OTHER, TODAY, bootFood, consumed, deleteProduct, dismiss, entryReads,
  expectReadWindow, finishFood, food, holdProductWrite, holdRead, mondayDot, offsetDate, openProduct,
  readAction, releaseHold, selectMonday, selectMondayWithHeldReads, shiftWeek, shiftWeeks,
  shiftWithHeldReads, submitProduct, windowPaths,
} from './food-cache-helpers';
import { computeMacros } from '../../src/macros';
import { removeCachedProduct, updateCachedProduct, type EntryCache } from '../../src/hooks/entryCache';

test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'UTC' });

test('[J-497] product edits and deletes refresh only the active window after zero ten and fifty week visits', async ({ context }) => {
  test.setTimeout(120_000);
  for (const visits of [0, 10, 50]) for (const selectHistoricalDays of [false, true]) {
    await test.step(`${visits} week visits; ${selectHistoricalDays ? 'distinct selected day and today' : 'selected day is today'}`, async () => {
      const page = await context.newPage();
      const state = await bootFood(page);
      try {
        let monday = TODAY;
        let selected = TODAY;
        for (let i = 0; i < visits; i++) {
          await shiftWeek(page, -1);
          monday = offsetDate(monday, -7);
          if (selectHistoricalDays) {
            await selectMonday(page);
            selected = monday;
          }
        }
        if (visits === 0 && selectHistoricalDays) {
          await readCycle(page, () => page.getByRole('button', { name: 'T 8', exact: true }).tap(), 2);
          selected = offsetDate(TODAY, 1);
        }

        await openProduct(page);
        const editStart = state.requests.length;
        await submitProduct(page);
        await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toBeVisible();
        await expectReadWindow(state, editStart, selected, monday);
        await expect(page.locator('.food-row')).toContainText('Edited cache food');
        await expect(consumed(page)).toContainText('200');
        await dismiss(page);

        await openProduct(page);
        const deleteStart = state.requests.length;
        await deleteProduct(page);
        await expect(page.locator('.sheet')).toHaveCount(0);
        await expectReadWindow(state, deleteStart, selected, monday);
        await expect(page.locator('.food-row')).toHaveCount(0);
        await expect(page.getByText('No food logged', { exact: true })).toBeVisible();
        await expect(consumed(page)).toContainText('0');
        expect(state.requests.filter(record => ['PUT', 'DELETE'].includes(record.method))).toHaveLength(2);
        expect(state.unexpected).toEqual([]);
      } finally {
        state.releaseAll();
        await page.close();
      }
    });
  }
});

test('[J-498] retained historical days apply product edits and deletion without resurrecting rows or singleton groups', async ({ page }) => {
  const state = await bootFood(page);
  const pair = { id: 10, name: 'Cached pair' };
  const trio = { id: 11, name: 'Cached trio' };
  state.rows.set(HISTORY, [food(HISTORY, ORIGINAL, 1, pair), food(HISTORY, OTHER, 2, pair),
    food(HISTORY, ORIGINAL, 3, trio), food(HISTORY, OTHER, 4, trio), food(HISTORY, OTHER, 5, trio)]);
  try {
    await shiftWeeks(page, -4);
    await selectMonday(page);
    await expect(consumed(page)).toContainText('350');
    await shiftWeeks(page, 4);
    await selectMonday(page, true);
    await openProduct(page);
    await submitProduct(page);
    await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toBeVisible();
    await dismiss(page);

    const editedDay = holdRead(state, 'day', HISTORY);
    await shiftWeeks(page, -4);
    await selectMondayWithHeldReads(state);
    await editedDay.started.promise;
    await expect(consumed(page)).toContainText('550');
    await page.getByRole('button', { name: 'Expand Cached pair', exact: true }).tap();
    await page.getByRole('button', { name: 'Expand Cached trio', exact: true }).tap();
    const updated = page.locator('.food-row').filter({ hasText: 'Edited cache food' });
    await expect(updated).toHaveCount(2);
    await expect(updated.first()).toContainText('100g');
    await expect(updated.first()).toContainText('12:34');
    await releaseHold(page, editedDay);

    await shiftWeeks(page, 4);
    await selectMonday(page, true);
    await openProduct(page);
    await deleteProduct(page);
    await expect(page.locator('.sheet')).toHaveCount(0);
    const deletedDay = holdRead(state, 'day', HISTORY);
    await shiftWeeks(page, -4);
    await selectMondayWithHeldReads(state);
    await deletedDay.started.promise;
    await expect(page.getByRole('button', { name: 'Expand Cached pair', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand Cached trio', exact: true })).toBeVisible();
    await expect(page.locator('.food-row')).toHaveCount(1);
    await expect(page.locator('.food-row')).toContainText('Other food');
    await expect(consumed(page)).toContainText('150');
    await page.getByRole('button', { name: 'Expand Cached trio', exact: true }).tap();
    await expect(page.locator('.food-row')).toHaveCount(3);
    await expect(page.locator('.food-row').filter({ hasText: 'Edited cache food' })).toHaveCount(0);
    await releaseHold(page, deletedDay);
    expect(state.unexpected).toEqual([]);
  } finally { await finishFood(state); }
});

test('[J-499] obsolete off-screen day and week responses neither retry nor resurrect a deleted product', async ({ page }) => {
  const state = await bootFood(page);
  try {
    await shiftWeeks(page, -4);
    await selectMonday(page);
    const oldDay = holdRead(state, 'day', HISTORY, Infinity);
    const oldWeek = holdRead(state, 'week', HISTORY, Infinity);
    const oldFailure = holdRead(state, 'week', offsetDate(HISTORY, -7), Infinity, 503);
    await readAction(state, () => resume(page), 5);
    await Promise.all([oldDay.started.promise, oldWeek.started.promise, oldFailure.started.promise]);
    await shiftWithHeldReads(state, 4);
    await selectMondayWithHeldReads(state, true);
    await openProduct(page);
    const start = state.requests.length;
    await deleteProduct(page);
    await expect(page.locator('.sheet')).toHaveCount(0);
    await expectReadWindow(state, start, TODAY, TODAY);

    const beforeRelease = state.requests.length;
    await Promise.all([releaseHold(page, oldDay), releaseHold(page, oldWeek), releaseHold(page, oldFailure)]);
    await frame(page);
    expect(entryReads(state, beforeRelease)).toEqual([]);
    await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toHaveCount(0);

    // New authoritative responses remain held: these assertions therefore
    // inspect the retained cache after the obsolete snapshots were delivered.
    const revisitDay = holdRead(state, 'day', HISTORY);
    const revisitWeek = holdRead(state, 'week', HISTORY, Infinity);
    await shiftWithHeldReads(state, -4);
    await selectMondayWithHeldReads(state);
    await Promise.all([revisitDay.started.promise, revisitWeek.started.promise]);
    await expect(page.locator('.food-row')).toHaveCount(0);
    await expect(page.getByText('No food logged', { exact: true })).toBeVisible();
    await expect(consumed(page)).toContainText('0');
    await expect(mondayDot(page)).toHaveCSS('opacity', '0');
    expect(state.unexpected).toEqual([]);
  } finally { await finishFood(state); }
});

test('[J-500] delayed product completion refreshes the latest window and preserves a newer form draft', async ({ page }) => {
  const state = await bootFood(page);
  const write = holdProductWrite(state);
  try {
    await openProduct(page);
    await submitProduct(page);
    await write.started.promise;
    await dismiss(page);
    await shiftWeeks(page, -4);
    await selectMonday(page);
    await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
    await page.getByRole('button', { name: 'Add New', exact: true }).tap();
    await page.getByPlaceholder('e.g. Peanut Butter', { exact: true }).fill('Keep this newer draft');
    const start = state.requests.length;
    await releaseHold(page, write);
    await expectReadWindow(state, start, HISTORY, HISTORY);
    await expect(page.getByPlaceholder('e.g. Peanut Butter', { exact: true })).toHaveValue('Keep this newer draft');
    await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toHaveCount(0);
    await expect(page.locator('.food-row')).toContainText('Edited cache food');
    expect(state.unexpected).toEqual([]);
  } finally { await finishFood(state); }
});

test('[J-501] queued food writes wait for the active refresh but do not wait for an obsolete historical read', async ({ page }) => {
  const state = await bootFood(page);
  try {
    await shiftWeeks(page, -4);
    await selectMonday(page);
    const historical = holdRead(state, 'day', HISTORY, Infinity);
    await readAction(state, () => resume(page), 5);
    await historical.started.promise;
    await shiftWeeks(page, 4);
    await selectMonday(page, true);
    const active = holdRead(state, 'week', TODAY);
    await openProduct(page);
    await submitProduct(page);
    await active.started.promise;
    await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeVisible();
    await dismiss(page);
    await page.locator('.food-row').getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
    await frame(page);
    expect(state.requests.filter(record => record.method === 'PATCH')).toEqual([]);
    await releaseHold(page, active);
    await expect(page.locator('.food-row').getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
    expect(state.requests.filter(record => ['PUT', 'PATCH'].includes(record.method)).map(record => record.method)).toEqual(['PUT', 'PATCH']);
    // The historical response is still deferred; its completion cannot be
    // necessary for the positive PATCH observation above.
    expect(historical.records).toHaveLength(1);
    await releaseHold(page, historical);
    await expect(page.locator('.food-row')).toContainText('Edited cache food');
    await expect(page.locator('.food-row').getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
    expect(state.unexpected).toEqual([]);
  } finally { await finishFood(state); }
});

test('[J-502] delayed product responses preserve newer day snapshots and do not derive over newer week totals', async ({ context }) => {
  test.setTimeout(90_000);
  await test.step('A day read applied during PUT survives in retained off-screen data', async () => {
    const page = await context.newPage();
    const state = await bootFood(page);
    const write = holdProductWrite(state);
    try {
      await shiftWeeks(page, -4);
      await selectMonday(page);
      await openProduct(page);
      await submitProduct(page);
      await write.started.promise;
      const newer = { ...ORIGINAL, name: 'Newer canonical food', per100: { ...ORIGINAL.per100, kcal: 300 } };
      state.replaceProduct(newer);
      state.rows.set(HISTORY, state.getRows(HISTORY).map(row => ({ ...row, amount: 175,
        local_time: '10:45', tagged: true, macros: computeMacros(newer, 175) })));
      await readCycle(page, () => resume(page), 6);
      await expect(consumed(page)).toContainText('525');
      await dismiss(page);
      await shiftWeeks(page, 4);
      await selectMonday(page, true);
      const start = state.requests.length;
      await releaseHold(page, write);
      await expectReadWindow(state, start, TODAY, TODAY);

      const revisit = holdRead(state, 'day', HISTORY);
      await shiftWeeks(page, -4);
      await selectMondayWithHeldReads(state);
      await revisit.started.promise;
      await expect(page.locator('.food-row')).toContainText('Newer canonical food');
      await expect(page.locator('.food-row')).toContainText('175g');
      await expect(page.locator('.food-row')).toContainText('10:45');
      await expect(page.locator('.food-row').getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
      await expect(consumed(page)).toContainText('525');
      expect(state.unexpected).toEqual([]);
    } finally { await finishFood(state); await page.close(); }
  });

  await test.step('A week read applied during PUT cannot be overwritten from an older complete day', async () => {
    const page = await context.newPage();
    const state = await bootFood(page);
    const write = holdProductWrite(state);
    try {
      await openProduct(page);
      await submitProduct(page);
      await write.started.promise;
      // The server now has another food worth 500 kcal. Only its week snapshot
      // arrives before the PUT; the complete day in the UI still has one row.
      const extra = food(TODAY, OTHER, 2);
      state.rows.set(TODAY, [...state.getRows(TODAY), { ...extra, amount: 1000, macros: computeMacros(OTHER, 1000) }]);
      const day = holdRead(state, 'day', TODAY, Infinity);
      await readAction(state, () => resume(page), 4);
      await day.started.promise;
      await expect(mondayDot(page)).toHaveCSS('opacity', '0.7');
      const week = holdRead(state, 'week', TODAY);
      const start = state.requests.length;
      await releaseHold(page, write);
      await week.started.promise;
      await expect.poll(() => entryReads(state, start).map(record => record.path).sort()).toEqual(windowPaths(TODAY, TODAY));
      // The product transform updates the one cached row to 200 kcal, but the
      // newer 700-kcal week snapshot must not become the partial 200-kcal sum.
      await expect(consumed(page)).toContainText('200');
      await expect(mondayDot(page)).toHaveCSS('opacity', '0.7');
      await Promise.all([releaseHold(page, day), releaseHold(page, week)]);
      await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toBeVisible();
      await expect(consumed(page)).toContainText('700');
      expect(state.unexpected).toEqual([]);
    } finally { await finishFood(state); await page.close(); }
  });

  await test.step('An ambiguous pre-commit day read is retained and recovers on revisit', async () => {
    const page = await context.newPage();
    const state = await bootFood(page);
    const write = holdProductWrite(state);
    try {
      await shiftWeeks(page, -4);
      await selectMonday(page);
      const oldRows = structuredClone(state.getRows(HISTORY));
      await openProduct(page);
      await submitProduct(page);
      await write.started.promise;
      state.daySnapshot = (date, rows) => date === HISTORY ? oldRows : rows;
      await readCycle(page, () => resume(page), 6);
      state.daySnapshot = null;
      await dismiss(page);
      await shiftWeeks(page, 4);
      await selectMonday(page, true);
      const start = state.requests.length;
      await releaseHold(page, write);
      await expectReadWindow(state, start, TODAY, TODAY);
      const revisit = holdRead(state, 'day', HISTORY);
      await shiftWeeks(page, -4);
      await selectMondayWithHeldReads(state);
      await revisit.started.promise;
      await expect(page.locator('.food-row')).toContainText(ORIGINAL.name);
      await expect(consumed(page)).toContainText('100');
      await releaseHold(page, revisit);
      await expect(page.locator('.food-row')).toContainText('Edited cache food');
      await expect(consumed(page)).toContainText('200');
      expect(state.unexpected).toEqual([]);
    } finally { await finishFood(state); await page.close(); }
  });
});

test('[J-503] product cache transforms preserve protected snapshots partial-day totals and complete group membership', () => {
  const protectedDate = offsetDate(TODAY, 1);
  const partialDate = offsetDate(TODAY, 2);
  const loadedLater = offsetDate(TODAY, 3);
  const untouchedDate = offsetDate(TODAY, 4);
  const preserved = { ...food(TODAY, OTHER, 2), tagged: true, local_time: '23:59' };
  const cache: EntryCache = {
    entriesByDate: {
      [TODAY]: [food(TODAY), preserved],
      [protectedDate]: [{ ...food(protectedDate), amount: 175, macros: computeMacros(ORIGINAL, 175), tagged: true }],
      [partialDate]: [food(partialDate)],
      [loadedLater]: [food(loadedLater)],
      [untouchedDate]: [food(untouchedDate, OTHER)],
    },
    loadedDates: new Set([TODAY, protectedDate, loadedLater, untouchedDate]),
    weekTotals: Object.fromEntries([TODAY, protectedDate, partialDate, loadedLater, untouchedDate]
      .map((date, index) => [date, { kcal: 800 + index, protein: 80 + index, carbs: 90 + index, fat: 20 + index }])),
  };
  const before = structuredClone(cache);
  const saved = { ...ORIGINAL, name: 'Canonical liquid', unit: 'ml' as const,
    per100: { kcal: 200, protein: 20, carbs: 30, fat: 4 } };
  // Including a partial date in totalDates deliberately exercises the helper's
  // own completeness guard. loadedLater is complete now but was not eligible
  // when this command was submitted.
  const changed = updateCachedProduct(cache, saved, new Set([protectedDate]), new Set([TODAY, partialDate]));
  expect(changed.entriesByDate[TODAY]![0]).toEqual({ ...cache.entriesByDate[TODAY]![0]!, product: saved,
    macros: computeMacros(saved, 100) });
  expect(changed.entriesByDate[TODAY]![1]).toBe(preserved);
  expect(changed.weekTotals[TODAY]).toEqual({ kcal: 250, protein: 25, carbs: 35, fat: 5 });
  expect(changed.entriesByDate[protectedDate]).toBe(cache.entriesByDate[protectedDate]);
  expect(changed.weekTotals[protectedDate]).toBe(cache.weekTotals[protectedDate]);
  expect(changed.entriesByDate[partialDate]![0]!.product).toEqual(saved);
  expect(changed.weekTotals[partialDate]).toBe(cache.weekTotals[partialDate]);
  expect(changed.entriesByDate[loadedLater]![0]!.product).toEqual(saved);
  expect(changed.weekTotals[loadedLater]).toBe(cache.weekTotals[loadedLater]);
  expect(changed.entriesByDate[untouchedDate]).toBe(cache.entriesByDate[untouchedDate]);
  expect(changed.loadedDates).toBe(cache.loadedDates);
  expect(cache).toEqual(before);

  const pair = { id: 1, name: 'Updated pair name' };
  const trio = { id: 2, name: 'Updated trio name' };
  const incomplete = { id: 3, name: 'Incomplete group snapshot' };
  const newerSurvivor = { ...food(protectedDate, OTHER, 2), tagged: true, local_time: '23:59' };
  const deletionCache: EntryCache = { ...cache, entriesByDate: {
    [TODAY]: [food(TODAY, ORIGINAL, 1, pair), food(TODAY, OTHER, 2, pair),
      food(TODAY, ORIGINAL, 3, trio), food(TODAY, OTHER, 4, trio), food(TODAY, OTHER, 5, trio)],
    [partialDate]: [food(partialDate, ORIGINAL, 1, incomplete), food(partialDate, OTHER, 2, incomplete)],
    [protectedDate]: [food(protectedDate, ORIGINAL), newerSurvivor],
    [untouchedDate]: cache.entriesByDate[untouchedDate]!,
  } };
  const deletionBefore = structuredClone(deletionCache);
  const removed = removeCachedProduct(deletionCache, ORIGINAL.id, new Set([TODAY, partialDate]));
  expect(removed.entriesByDate[TODAY]!.map(row => row.id)).toEqual([2, 4, 5].map(index => food(TODAY, OTHER, index).id));
  expect(removed.entriesByDate[TODAY]![0]).toEqual({ ...deletionCache.entriesByDate[TODAY]![1]!, group: null });
  expect(removed.entriesByDate[TODAY]![1]).toBe(deletionCache.entriesByDate[TODAY]![3]);
  expect(removed.entriesByDate[TODAY]![2]).toBe(deletionCache.entriesByDate[TODAY]![4]);
  expect(removed.entriesByDate[TODAY]![1]!.group).toEqual(trio);
  expect(removed.weekTotals[TODAY]).toEqual({ kcal: 150, protein: 15, carbs: 15, fat: 3 });
  expect(removed.entriesByDate[partialDate]).toEqual([deletionCache.entriesByDate[partialDate]![1]]);
  expect(removed.entriesByDate[partialDate]![0]!.group).toEqual(incomplete);
  expect(removed.weekTotals[partialDate]).toBe(deletionCache.weekTotals[partialDate]);
  expect(removed.entriesByDate[protectedDate]).toEqual([newerSurvivor]);
  expect(removed.entriesByDate[protectedDate]![0]).toBe(newerSurvivor);
  expect(removed.weekTotals[protectedDate]).toBe(deletionCache.weekTotals[protectedDate]);
  expect(removed.entriesByDate[untouchedDate]).toBe(deletionCache.entriesByDate[untouchedDate]);
  expect(removed.loadedDates).toBe(deletionCache.loadedDates);
  expect(deletionCache).toEqual(deletionBefore);
});

test('[J-504] committed product refresh failures preserve drafts release queued writes and recover without resubmission', async ({ page }) => {
  const state = await bootFood(page);
  try {
    await page.locator('.food-row').getByRole('button').last().tap();
    await page.locator('.sheet').getByRole('spinbutton').fill('175.5');
    await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
    state.failReadsAfterWrite = true;
    const start = state.requests.length;
    await submitProduct(page);
    await expect(page.locator('.sheet').getByText('Edit entry', { exact: true })).toBeVisible();
    await expectReadWindow(state, start, TODAY, TODAY);
    await expect(page.locator('.sheet').getByRole('spinbutton')).toHaveValue('175.5');
    await expect(page.getByText("Couldn't refresh data. Check your connection.", { exact: true })).toBeVisible();
    await expect(page.getByText("Couldn't save product", { exact: true })).toHaveCount(0);
    await expect(page.locator('.food-row')).toContainText('Edited cache food');
    await expect(consumed(page)).toContainText('200');
    await dismiss(page);
    await page.locator('.food-row').getByRole('button', { name: 'Mark as eaten', exact: true }).tap();
    await expect(page.locator('.food-row').getByRole('button', { name: 'Mark as not eaten', exact: true })).toBeVisible();
    expect(state.requests.filter(record => record.method === 'PUT')).toHaveLength(1);

    state.failEntryReads = false;
    state.failReadsAfterWrite = false;
    state.rows.set(TODAY, state.getRows(TODAY).map(row => ({ ...row, amount: 250, macros: computeMacros(row.product, 250) })));
    await readCycle(page, () => resume(page));
    await expect(page.locator('.food-row')).toContainText('250g');
    await expect(consumed(page)).toContainText('500');
    expect(state.requests.filter(record => record.method === 'PUT')).toHaveLength(1);

    // An actual write failure still leaves the form retryable and performs
    // neither a cache projection nor the post-commit read batch.
    await openProduct(page);
    state.nextProductError = true;
    const failedStart = state.requests.length;
    await submitProduct(page, 'Must not reach the cache', '900');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    await expect(page.getByText('product_unavailable', { exact: true })).toBeVisible();
    await frame(page);
    expect(entryReads(state, failedStart)).toEqual([]);
    await expect(page.locator('.food-row')).toContainText('Edited cache food');
    await expect(consumed(page)).toContainText('500');
    expect(state.unexpected).toEqual([]);
  } finally { await finishFood(state); }
});
