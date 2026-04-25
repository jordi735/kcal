import { expect, test } from '@playwright/test';
import { fillNutField, seedProductAndLog } from './helpers';

// Edit flows. Entry edit opens GramsPicker in mode='edit' (title 'Edit amount',
// confirm button 'Save', delete TrashIcon aria-label 'Delete entry'). Product
// edit opens NewProductForm in mode='edit' (title 'Save changes'). The
// retroactive-macro invariant lives in App.tsx:381-382: product-edit save
// refetches the day + week, so macros change without a page reload.

const MACROS = { kcal: '100', protein: '10', carbs: '10', fat: '2' };

test('[J-016] edit grams updates the row without adding a new entry', async ({ page }) => {
  const name = 'E2E Edit Grams';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });

  // Tap the main button (nth(1) — dot is 0) to open GramsPicker in edit mode.
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });

  await page.getByRole('spinbutton').fill('200');
  // Confirm button in edit mode is 'Save' (GramsPicker.tsx:160).
  await page.getByRole('button', { name: 'Save', exact: true }).tap();

  // Editing an existing entry updates in place — still exactly one row.
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('200g');
});

test('[J-017] delete button in edit sheet removes the entry', async ({ page }) => {
  const name = 'E2E Edit Delete';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });

  // GramsPicker.tsx:262-269 — TrashIcon button with aria-label 'Delete entry'.
  // No confirmation dialog; one tap removes the row.
  await page.getByRole('button', { name: 'Delete entry' }).tap();

  await expect(row).toHaveCount(0);
});

test('[J-013] editing a product retroactively updates the row on the same day', async ({ page }) => {
  // The crown jewel: per CLAUDE.md, "Macros are computed, never stored."
  // entries only store grams + product_id; macro totals join products on every
  // read. After a product edit, App.tsx:381-382 refetches the day + week,
  // re-deriving macros via the sumMacros useMemo without a page reload.
  const name = 'E2E Edit Product';
  await page.goto('/');
  await seedProductAndLog(page, name, MACROS, '100');

  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row).toContainText('100'); // seeded kcal/100g × 100g = 100

  // Enter edit mode, then tap the pencil icon to escalate to product-edit.
  await row.locator('button').nth(1).tap();
  await page.getByText('Edit amount').waitFor({ state: 'visible' });
  // `exact: true` — the FoodRow behind the sheet has an accessible name that
  // substring-matches 'edit product' (the product's own name is 'E2E Edit
  // Product'), so Playwright's default substring match resolves two buttons.
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();

  // NewProductForm in mode='edit' — wait on the Save-changes button (unique
  // to edit mode) rather than the 'Edit Product' title, which collides with
  // other rendered text.
  await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'visible' });
  await fillNutField(page, 'Kcal', '500');
  await page.getByRole('button', { name: 'Save changes' }).tap();

  // Sheet closes, row's kcal column now reads 500 — no reload performed.
  await expect(row).toContainText('500');
});

test('[J-014] Add Temp Item flow renders a TMP badge on the row', async ({ page }) => {
  // FoodRow.tsx:54-56 — is_temp products render a 'TMP' badge next to the
  // product name. The temp flow is AddPicker search → 'Add Temp' button →
  // NewProductForm (isTemp=true, save button reads 'Add to Day') → GramsPicker.
  const name = 'E2E Temp Thing';
  await page.goto('/');

  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByPlaceholder('Search products...').fill(name);
  await page.getByRole('button', { name: 'Add Temp' }).tap();

  // NewProductForm temp title (NewProductForm.tsx:199) — sync before filling
  // macros so inputs aren't hit mid-animation.
  await page.getByText('Add Temp Item').waitFor({ state: 'visible' });
  await fillNutField(page, 'Kcal', '50');
  await fillNutField(page, 'Protein', '5');
  await fillNutField(page, 'Carbs', '5');
  await fillNutField(page, 'Fat', '1');
  // Temp-mode confirm is 'Add to Day' (capital D) per NewProductForm.tsx:342 —
  // distinct from GramsPicker's 'Add to day' (lowercase d).
  await page.getByRole('button', { name: 'Add to Day' }).tap();

  await page.getByText('How much?').waitFor({ state: 'visible' });
  await page.getByRole('spinbutton').fill('50');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  const row = page.locator('.food-row').filter({ hasText: name });
  await expect(row.getByText('TMP')).toBeVisible();
});
