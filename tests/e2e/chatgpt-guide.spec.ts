import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Product } from '../../shared/types';
import type { Goals } from '../../src/types';
import { fillNutField, signInFresh } from './helpers';

const MCP_URL = 'https://usekcal.com/mcp';
const CHATGPT_URL = 'https://chatgpt.com/';
const DOCS_URL = 'https://developers.openai.com/api/docs/guides/custom-mcp-server';
const GUIDE_TITLE = 'Connect KCAL to ChatGPT';

test.use({ storageState: { cookies: [], origins: [] } });

function productField(page: Page, label: string) {
  return page.locator('.sheet label').filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..').getByRole('textbox');
}

function nutritionField(page: Page, label: string) {
  return page.locator('.sheet label').filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..').getByRole('spinbutton');
}

async function openProduct(page: Page, temporary = false) {
  await page.getByRole('button', { name: 'ADD FOOD', exact: true }).tap();
  await page.locator('.sheet').getByRole('button', {
    name: temporary ? 'Add Temp' : 'Add New', exact: true,
  }).tap();
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();
}

async function openGuide(page: Page) {
  await page.locator('.sheet').getByRole('button', { name: 'Connect to ChatGPT', exact: true }).tap();
  await expect(page.locator('.sheet').getByRole('heading', { name: GUIDE_TITLE, level: 1 })).toBeVisible();
  await expect(page.locator('.sheet')).toHaveCount(1);
  await expect(page.locator('.sheet [data-sheet-scroll]')).toHaveCount(1);
  await expect(page.locator('.sheet [data-sheet-scroll]')).toBeVisible();
}

async function backFromGuide(page: Page) {
  await page.locator('.sheet').getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.getByRole('heading', { name: GUIDE_TITLE })).toHaveCount(0);
  await expect(page.locator('.sheet [data-sheet-scroll]')).toHaveCount(1);
}

for (const [id, temporary] of [['J-262', false], ['J-263', true]] as const) {
  test(`[${id}] the guide preserves complete and partial ${temporary ? 'temporary' : 'new'} product drafts`, async ({ page, request }) => {
    await signInFresh(page, request, `guide-product-${temporary ? 'temp' : 'new'}`);
    await openProduct(page, temporary);
    const sheet = page.locator('.sheet');
    const fields = {
      name: page.getByPlaceholder('e.g. Peanut Butter'),
      brand: productField(page, 'Brand'),
      barcode: productField(page, 'Barcode'),
    };
    const raw = { name: '  E2E Guide  Draft  ', brand: '  Guide  Brand  ', barcode: `  963${Date.now()}  ` };
    for (const key of ['name', 'brand', 'barcode'] as const) await fields[key].fill(raw[key]);
    await sheet.getByRole('button', { name: 'Millilitres', exact: true }).tap();
    const nutrition = [['Kcal', '123'], ['Protein', '4.5'], ['Carbs', '6.7'], ['Fat', '8.9']] as const;
    for (const [label, value] of nutrition) await fillNutField(page, label, value);
    const originalInput = await fields.name.elementHandle();
    if (originalInput === null) throw new Error('Product name input missing');
    const save = sheet.getByRole('button', { name: temporary ? 'Add to Day' : 'Save & Continue', exact: true });
    let writes = 0;
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/products') writes++;
    });

    for (const complete of [true, false]) {
      if (!complete) await fillNutField(page, 'Fat', '');
      await openGuide(page);
      await expect(fields.name).toBeHidden();
      // Preserve the mounted input, not merely a reconstructed draft: an
      // all-or-nothing per100 snapshot loses the other three partial values.
      expect(await originalInput.evaluate((input) => input.isConnected)).toBe(true);
      await expect(sheet.getByRole('spinbutton')).toHaveCount(0);
      await backFromGuide(page);
      for (const key of ['name', 'brand', 'barcode'] as const) {
        await expect(fields[key]).toHaveValue(raw[key]);
      }
      await expect(sheet.getByText(temporary ? 'Add Temp Item' : 'New Product', { exact: true })).toBeVisible();
      await expect(sheet.getByText('Per 100ml', { exact: true })).toBeVisible();
      for (const [label, value] of nutrition) {
        await expect(nutritionField(page, label)).toHaveValue(!complete && label === 'Fat' ? '' : value);
      }
      if (complete) await expect(save).toBeEnabled();
      else await expect(save).toBeDisabled();
      expect(writes).toBe(0);
    }

    await fillNutField(page, 'Fat', '8.9');
    const created = page.waitForResponse((res) => res.request().method() === 'POST' && new URL(res.url()).pathname === '/products');
    await save.tap();
    const response = await created;
    expect(response.status()).toBe(201);
    const saved = await response.json() as Product;
    expect(saved).toMatchObject({
      name: 'E2e guide draft', brand: 'Guide Brand', barcode: raw.barcode.trim(), unit: 'ml', is_temp: temporary,
      per100: { kcal: 123, protein: 4.5, carbs: 6.7, fat: 8.9 },
    });
    await expect(sheet.getByText('How much?', { exact: true })).toBeVisible();
    expect(writes).toBe(1);
  });
}

test('[J-264] Settings retains unsaved goals through the guide and respects Save and Cancel', async ({ page, request }) => {
  await signInFresh(page, request, 'guide-settings');
  const token = await page.evaluate(() => localStorage.getItem('kcal_session_token')!);
  const headers = { Authorization: `Bearer ${token}` };
  const { kcal, protein, carbs, fat } = await (await request.get('/settings', { headers })).json() as Goals;
  const baseline = { kcal, protein, carbs, fat };
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  const sheet = page.locator('.sheet');
  const inputs = sheet.getByRole('spinbutton');
  const values = ['111', '222', '33', '1888'];
  for (const [index, value] of values.entries()) await inputs.nth(index).fill(value);
  const originalInput = await inputs.first().elementHandle();
  if (originalInput === null) throw new Error('Settings goal input missing');
  await openGuide(page);
  expect(await originalInput.evaluate((input) => input.isConnected)).toBe(true);
  await expect(inputs).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect(await (await request.get('/settings', { headers })).json()).toMatchObject(baseline);
  await backFromGuide(page);
  for (const [index, value] of values.entries()) await expect(inputs.nth(index)).toHaveValue(value);
  await sheet.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  const saved = { kcal: 1888, protein: 111, carbs: 222, fat: 33 };
  expect(await (await request.get('/settings', { headers })).json()).toMatchObject(saved);

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  for (const [index, value] of values.entries()) await expect(inputs.nth(index)).toHaveValue(value);
  await inputs.first().fill('999');
  await inputs.last().fill('1234');
  await openGuide(page);
  await backFromGuide(page);
  await expect(inputs.first()).toHaveValue('999');
  await expect(inputs.last()).toHaveValue('1234');
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  expect(await (await request.get('/settings', { headers })).json()).toMatchObject(saved);
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  for (const [index, value] of values.entries()) await expect(inputs.nth(index)).toHaveValue(value);
});

test('[J-265] the guide copies the MCP URL and opens ChatGPT and official instructions', async ({ page, request, context }) => {
  const copied: string[] = [];
  await page.exposeFunction('__recordGuideCopy', (value: string) => { copied.push(value); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (value: string) => (
        window as unknown as Window & { __recordGuideCopy: (value: string) => Promise<void> }
      ).__recordGuideCopy(value) },
    });
  });
  await signInFresh(page, request, 'guide-copy');
  await openProduct(page);
  await openGuide(page);
  const sheet = page.locator('.sheet');
  await expect(sheet.getByRole('textbox', { name: 'Server URL', exact: true })).toHaveValue(MCP_URL);
  await sheet.getByRole('button', { name: 'Copy URL', exact: true }).tap();
  await expect(sheet.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  await expect.poll(() => copied).toEqual([MCP_URL]);

  // Local responses test the actual new-tab actions without depending on
  // either external website being available during an application test.
  for (const url of [CHATGPT_URL, DOCS_URL]) {
    await context.route(url, (route) => route.fulfill({ contentType: 'text/html', body: '<p>Setup destination</p>' }));
    const link = sheet.locator(`a[href="${url}"]`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    if (url === CHATGPT_URL) await expect(link).toHaveAccessibleName('Open ChatGPT');
    const opened = page.waitForEvent('popup');
    await link.tap();
    const popup = await opened;
    await expect(popup).toHaveURL(url);
    await popup.close();
  }
  await expect(sheet.getByRole('heading', { name: GUIDE_TITLE })).toBeVisible();
});

test('[J-266] clipboard denial keeps the guide usable and exposes manual copying', async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
    });
  });
  await signInFresh(page, request, 'guide-copy-denied');
  await openProduct(page);
  await openGuide(page);
  const sheet = page.locator('.sheet');
  await sheet.getByRole('button', { name: 'Copy URL', exact: true }).tap();
  await expect(sheet.getByText('Could not copy. Select and copy the URL above.', { exact: true })).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Server URL', exact: true })).toHaveValue(MCP_URL);
  await expect(sheet.getByRole('button', { name: 'Copy URL', exact: true })).toBeEnabled();
  await backFromGuide(page);
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toBeVisible();
});

async function swipe(page: Page, target: Locator, deltaY: number) {
  // Actual touch input exercises native overflow scrolling as well as the
  // Sheet's touch-only scroll-vs-dismiss arbitration.
  const box = await target.boundingBox();
  if (box === null) throw new Error('Swipe target has no bounding box');
  // Stay in the content gutter so an input cannot take over the gesture.
  const x = box.x + 10;
  const startY = box.y + box.height * (deltaY < 0 ? 0.75 : 0.3);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 10; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: startY + deltaY * step / 10 }],
      });
      await page.waitForTimeout(20);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test('[J-267] mobile guide scrolling takes priority over dismissal until the scroll is at the top', async ({ page, request }) => {
  await signInFresh(page, request, 'guide-scroll');
  await openProduct(page);
  await openGuide(page);
  const sheet = page.locator('.sheet');
  const scroll = sheet.locator('[data-sheet-scroll]');
  await sheet.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await swipe(page, scroll, -240);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  // Begin a dismiss-sized downward gesture while already scrolled. It must
  // scroll up without initiating the sheet's exit animation.
  await swipe(page, scroll, 100);
  await expect(sheet).toHaveCount(1);
  await expect(sheet.getByRole('heading', { name: GUIDE_TITLE })).toBeVisible();
  expect(await sheet.evaluate((element) => (element as HTMLElement).style.pointerEvents)).not.toBe('none');
  await scroll.evaluate((element) => { element.scrollTop = 0; });
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBe(0);
  await swipe(page, scroll, 110);
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add New', exact: true })).toHaveCount(0);
});

test('[J-268] backdrop dismissal closes the guide and underlying product form together', async ({ page, request }) => {
  await signInFresh(page, request, 'guide-backdrop');
  await openProduct(page, true);
  await openGuide(page);
  await page.locator('.overlay').dispatchEvent('click');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.getByPlaceholder('e.g. Peanut Butter')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Temp', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ADD FOOD', exact: true })).toBeVisible();
});

test.describe('desktop keyboard', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false });

  test('[J-269] keyboard navigation reaches the guide controls and restores focus to the entry point', async ({ page, request }) => {
    await signInFresh(page, request, 'guide-keyboard');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const sheet = page.locator('.sheet');
    const entry = sheet.getByRole('button', { name: 'Connect to ChatGPT', exact: true });
    await entry.focus();
    await page.keyboard.press('Enter');
    const heading = sheet.getByRole('heading', { name: GUIDE_TITLE, level: 1 });
    await expect(heading).toBeFocused();
    await expect(sheet.getByRole('spinbutton')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(sheet.getByRole('button', { name: 'Copy URL', exact: true })).toBeFocused();
    const back = sheet.getByRole('button', { name: 'Back', exact: true });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveCount(0);
    await expect(entry).toBeFocused();
    await expect(sheet.getByRole('spinbutton')).toHaveCount(4);
  });
});
