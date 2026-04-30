import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// Per-test fresh user: bypasses the shared `e2e@test.local` storageState so
// existingTotals starts at 0 on today's date. Required by any spec that asserts
// absolute kcal/macro projections in GramsPicker — those rows render
// `existing + entry`, so a polluted day breaks hardcoded numbers (see
// GramsPicker.tsx:51,88). The unique timestamp+random suffix avoids collisions
// when the same prefix is used across many tests in one run. `emailPrefix`
// is purely a debug breadcrumb in the users table — pick something distinctive
// so triage of /tmp/kcal-e2e.db can attribute rows back to the source spec.
//
// Caller MUST also declare `test.use({ storageState: { cookies: [], origins: [] } })`
// at the spec-file level — without it the shared user's auth header survives
// and `page.goto('/')` lands directly on Home, skipping the login form.
export async function signInFresh(
  page: Page,
  request: APIRequestContext,
  emailPrefix: string,
): Promise<void> {
  const email = `${emailPrefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  await page.goto('/');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Send sign-in code' }).tap();
  const res = await request.get(`/auth/test/last-code/${email}`);
  const { code } = await res.json();
  await page.getByLabel('6-digit sign-in code').fill(code);
  // Login.tsx:114 auto-submits at 6 digits; wait for the home shell to land.
  await expect(page.getByRole('button', { name: 'ADD FOOD' })).toBeVisible();
}

// NutField's <label> isn't htmlFor-bound to its input, so getByLabel doesn't
// resolve. Navigate from the label up to the shared parent, then down to the
// number input. Scoping to `label` (not any element) avoids matching MacroBar
// / MacroSummary spans beneath the sheet.
export async function fillNutField(page: Page, label: string, value: string) {
  await page
    .locator('label')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('..')
    .getByRole('spinbutton')
    .fill(value);
}

// FoodRow.tsx:45-48 handles long-press via onContextMenu. Dispatching the
// native event directly sidesteps every touch/mouse/timer question — no
// pointer dance, no waitForTimeout, and it works identically on the Pixel 7
// mobile profile and a desktop viewport.
export async function longPress(locator: Locator) {
  await locator.dispatchEvent('contextmenu');
}

// Full AddPicker → NewProductForm → GramsPicker UI flow, stopping after the
// entry is logged. Used as per-test seeding in selection/tagging specs.
// `barcode` is optional — pass it to exercise the shared-catalog / adopt flow.
export async function seedProductAndLog(
  page: Page,
  name: string,
  macros: { kcal: string; protein: string; carbs: string; fat: string },
  grams: string,
  barcode?: string,
) {
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill(name);
  if (barcode !== undefined) {
    // ClearableField renders a plain text input (role=textbox) — scope via the
    // <label> parent to avoid matching the sibling Brand field.
    await page
      .locator('label')
      .filter({ hasText: /^Barcode$/ })
      .locator('..')
      .getByRole('textbox')
      .fill(barcode);
  }
  await fillNutField(page, 'Kcal', macros.kcal);
  await fillNutField(page, 'Protein', macros.protein);
  await fillNutField(page, 'Carbs', macros.carbs);
  await fillNutField(page, 'Fat', macros.fat);
  await page.getByRole('button', { name: /Save & Continue/ }).tap();
  // GramsPicker's sheet transitions in — sync on its heading before touching
  // the spinbutton, otherwise fill() fires against NewProductForm's inputs
  // that are briefly still mounted.
  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill(grams);
  await page.getByRole('button', { name: /Add to day/ }).tap();
  // Wait for the new row to appear on the home list — confirms all sheets
  // have closed before the caller proceeds (e.g. to a second seed).
  await page.locator('.food-row').filter({ hasText: name }).waitFor({ state: 'visible' });
}
