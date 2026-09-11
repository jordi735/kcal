import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { deferred, frame, readCycle, resume } from './app-refresh-helpers';
import { seedProductAndLog, signInFresh } from './helpers';

test.use({ storageState: { cookies: [], origins: [] } });

const DATE = '2030-01-07';
const DAY_URL = `**/entries?date=${DATE}`;
const WEEK_URL = `**/entries/week?start=${DATE}`;

function dayDot(page: Page) {
  return page.getByRole('button', { name: 'M 7', exact: true })
    .locator('[style*="--dot-opacity"]');
}

async function seedEntry(page: Page, request: APIRequestContext, prefix: string) {
  await page.clock.setFixedTime(new Date(2030, 0, 7, 12));
  await readCycle(page, () => signInFresh(page, request, prefix));
  await seedProductAndLog(page, `Refresh writes ${Date.now()}`, {
    kcal: '400', protein: '10', carbs: '20', fat: '5',
  }, '300');
  await expect(page.getByText('1200 kcal', { exact: true })).toBeVisible();
  await expect(dayDot(page)).toHaveCSS('opacity', '0.5');
}

async function holdTwoReads(page: Page, url: string) {
  const held = () => ({ ready: deferred(), release: deferred(), delivered: deferred() });
  const first = held();
  const second = held();
  let reads = 0;
  await page.route(url, async (route) => {
    reads++;
    if (reads > 2) return route.continue();
    const current = reads === 1 ? first : second;
    // Fetch now, then delay delivery: this is an actual stale server snapshot,
    // rather than a delayed request that would fetch the already-edited data.
    const response = await route.fetch();
    current.ready.resolve();
    await current.release.promise;
    const finished = page.waitForEvent('requestfinished', (request) => request === route.request());
    await route.fulfill({ response });
    await finished;
    current.delivered.resolve();
  });
  return { first, second, count: () => reads };
}

test('[J-248] a local grams edit survives older day and week reads until fresh retries settle', async ({ page, request }) => {
  await seedEntry(page, request, 'refresh-write-overlap');
  const day = await holdTwoReads(page, DAY_URL);
  const week = await holdTwoReads(page, WEEK_URL);
  try {
    await resume(page);
    await Promise.all([day.first.ready.promise, week.first.ready.promise]);

    await page.locator('.food-row').getByRole('button').filter({ hasText: 'Refresh writes' }).tap();
    const sheet = page.locator('.sheet');
    await expect(sheet.getByText('Edit amount', { exact: true })).toBeVisible();
    await sheet.getByRole('spinbutton').fill('450');
    await sheet.getByRole('button', { name: /Save/ }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.food-row')).toContainText('450g');
    await expect(page.getByText('1800 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0.75');

    day.first.release.resolve();
    week.first.release.resolve();
    await Promise.all([day.second.ready.promise, week.second.ready.promise]);
    // Even while the corrective requests remain pending, the stale snapshots
    // must not roll the successful write back in either visible consumer.
    await frame(page);
    await expect(page.locator('.food-row')).toContainText('450g');
    await expect(page.getByText('1800 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0.75');

    day.second.release.resolve();
    week.second.release.resolve();
    await Promise.all([day.second.delivered.promise, week.second.delivered.promise]);
    await frame(page);
    await expect(page.locator('.food-row')).toContainText('450g');
    await expect(page.getByText('1800 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0.75');
    expect({ days: day.count(), weeks: week.count() }).toEqual({ days: 2, weeks: 2 });
  } finally {
    day.first.release.resolve();
    day.second.release.resolve();
    week.first.release.resolve();
    week.second.release.resolve();
  }
});

test('[J-249] deleting an entry during refresh cannot resurrect its row or week progress', async ({ page, request }) => {
  await seedEntry(page, request, 'refresh-delete-overlap');
  const day = await holdTwoReads(page, DAY_URL);
  const week = await holdTwoReads(page, WEEK_URL);
  try {
    await resume(page);
    await Promise.all([day.first.ready.promise, week.first.ready.promise]);

    await page.locator('.food-row').getByRole('button').filter({ hasText: 'Refresh writes' }).tap();
    const sheet = page.locator('.sheet');
    await expect(sheet.getByText('Edit amount', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Delete entry', exact: true }).tap();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('.food-row')).toHaveCount(0);
    await expect(page.getByText('0 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0');

    day.first.release.resolve();
    week.first.release.resolve();
    await Promise.all([day.second.ready.promise, week.second.ready.promise]);
    await frame(page);
    await expect(page.locator('.food-row')).toHaveCount(0);
    await expect(page.getByText('0 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0');

    day.second.release.resolve();
    week.second.release.resolve();
    await Promise.all([day.second.delivered.promise, week.second.delivered.promise]);
    await frame(page);
    await expect(page.locator('.food-row')).toHaveCount(0);
    await expect(page.getByText('0 kcal', { exact: true })).toBeVisible();
    await expect(dayDot(page)).toHaveCSS('opacity', '0');
    expect({ days: day.count(), weeks: week.count() }).toEqual({ days: 2, weeks: 2 });
  } finally {
    day.first.release.resolve();
    day.second.release.resolve();
    week.first.release.resolve();
    week.second.release.resolve();
  }
});
