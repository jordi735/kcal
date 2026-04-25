import { expect, test, type Locator, type Page } from '@playwright/test';
import { longPress, seedProductAndLog } from './helpers';

// Macros are chosen so the kcal readout in the SelectionBar is unambiguous:
//   A = 100 kcal/100g × 100g = 100 kcal
//   B = 200 kcal/100g × 100g = 200 kcal
//   combined = 300 kcal
// Macro columns (P30/C30/F6) do not contain the digits "300" as a substring,
// so asserting the bar contains "300" isolates the kcal total.
const MACROS_A = { kcal: '100', protein: '10', carbs: '10', fat: '2' };
const MACROS_B = { kcal: '200', protein: '20', carbs: '20', fat: '4' };

// Each test uses a unique suffix — the test DB persists across tests within
// a run, so shared names would accumulate rows and break row locators.
async function seedPair(page: Page, suffix: string) {
  await page.goto('/');
  await seedProductAndLog(page, `E2E Sel A ${suffix}`, MACROS_A, '100');
  await seedProductAndLog(page, `E2E Sel B ${suffix}`, MACROS_B, '100');
}

// The FoodRow's main <button> wires both onClick (tap → select/edit) and
// onContextMenu (long-press → select). Within each row there are exactly
// two buttons: index 0 is the dot (aria-label="Mark as eaten"), index 1
// is the main body button — selecting positionally avoids depending on
// the rendered casing of the product name.
function mainButton(page: Page, rowText: string): Locator {
  return page.locator('.food-row').filter({ hasText: rowText })
    .locator('button').nth(1);
}

function dot(page: Page, rowText: string): Locator {
  return page.locator('.food-row').filter({ hasText: rowText })
    .getByRole('button', { name: /Mark as (not )?eaten/ });
}

// SelectionBar doesn't have a stable container selector (CSS-modules hashed
// class). Probe via the stable aria-label on the Clear button — presence of
// that button == bar mounted. During exit animation the bar stays mounted
// for FADE_EXIT_MS; toHaveCount(0) waits for the full unmount.
function clearBtn(page: Page): Locator {
  return page.getByRole('button', { name: 'Clear selection' });
}

test('[J-023] long-press enters selection mode with count 1', async ({ page }) => {
  const s = 'S1';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected')).toBeVisible();
});

test('[J-024] tap after long-press adds a second row; kcal summed', async ({ page }) => {
  const s = 'S2';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();

  await expect(page.getByText('2 selected')).toBeVisible();
  // Combined kcal readout. The Clear button sits two ancestor divs below
  // the bar root — go up to check the aggregate text.
  const bar = clearBtn(page).locator('..').locator('..');
  await expect(bar).toContainText('300');
});

test('[J-025] tapping an already-selected row deselects it', async ({ page }) => {
  const s = 'S3';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await expect(page.getByText('2 selected')).toBeVisible();

  // Tap A again — already in selection mode, so onClick hits toggleSelect
  // and removes it. Count drops to 1 and kcal drops to B-only (200).
  await mainButton(page, `E2E Sel A ${s}`).tap();
  await expect(page.getByText('1 selected')).toBeVisible();
  const bar = clearBtn(page).locator('..').locator('..');
  await expect(bar).toContainText('200');
});

test('[J-026] clear button exits selection mode', async ({ page }) => {
  const s = 'S4';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected')).toBeVisible();

  await clearBtn(page).tap();
  await expect(clearBtn(page)).toHaveCount(0);
});

test('[J-027] multi-delete removes both selected rows', async ({ page }) => {
  const s = 'S5';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Delete 2 selected' }).tap();

  await expect(page.locator('.food-row').filter({ hasText: `E2E Sel A ${s}` })).toHaveCount(0);
  await expect(page.locator('.food-row').filter({ hasText: `E2E Sel B ${s}` })).toHaveCount(0);
});

test('[J-028] multi-tag flips all untagged rows to tagged', async ({ page }) => {
  const s = 'S6';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Tag 2 selected' }).tap();

  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');
});

test('[J-029] multi-tag with all rows tagged flips to untagged', async ({ page }) => {
  const s = 'S7';
  await seedPair(page, s);

  // Pre-tag both via dot taps (not multi-tag — that would clear selection).
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await dot(page, `E2E Sel B ${s}`).tap();
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');

  // Select both. allTagged=true → button label is "Untag".
  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();
  await page.getByRole('button', { name: 'Untag 2 selected' }).tap();

  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'false');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'false');
});

test('[J-028] multi-tag with mixed state tags all (every, not some)', async ({ page }) => {
  const s = 'S8';
  await seedPair(page, s);

  // Tag only A. B stays untagged.
  await dot(page, `E2E Sel A ${s}`).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await mainButton(page, `E2E Sel B ${s}`).tap();

  // The invariant: allTagged = n > 0 && shown.every((e) => e.tagged). With
  // a mixed selection, every() returns false, so the button tags-all (label
  // "Tag"), not untags-all ("Untag"). A regression from every → some would
  // silently flip this — this test pins it.
  await expect(page.getByRole('button', { name: 'Tag 2 selected' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Untag 2 selected' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Tag 2 selected' }).tap();
  await expect(dot(page, `E2E Sel A ${s}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dot(page, `E2E Sel B ${s}`)).toHaveAttribute('aria-pressed', 'true');
});

test('[J-030] switching day clears the selection', async ({ page }) => {
  const s = 'S9';
  await seedPair(page, s);

  await longPress(mainButton(page, `E2E Sel A ${s}`));
  await expect(page.getByText('1 selected')).toBeVisible();

  // Compute a non-today day pill in the current week. If today is Monday,
  // reach for tomorrow instead (yesterday would be in the previous week
  // grid, which is rendered off-screen inside the carousel).
  const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const today = new Date();
  const todayIdx = (today.getDay() + 6) % 7;
  const delta = todayIdx === 0 ? 1 : -1;
  const other = new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta);
  const otherIdx = (other.getDay() + 6) % 7;
  const otherText = `${DAY_LETTERS[otherIdx]} ${other.getDate()}`;

  await page.getByRole('button', { name: otherText }).first().tap();

  // Home.tsx:46-48 — useEffect on selectedDate change calls setSelectedIds(new Set()).
  await expect(clearBtn(page)).toHaveCount(0);
});
