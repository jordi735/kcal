import { expect, test } from '@playwright/test';
import { fillNutField } from './helpers';

// The kcal CLAUDE.md architecture note states: macros are computed, never
// stored. Editing a product retroactively updates every past day's totals.
// This spec is the UI guarantee of that invariant.
test('edit product updates already-logged entry macros retroactively', async ({ page }) => {
  await page.goto('/');

  // Create "E2E Tofu" at 100 kcal / 100g.
  await page.getByRole('button', { name: 'ADD FOOD' }).tap();
  await page.getByRole('button', { name: 'Add New' }).tap();
  await page.getByPlaceholder('e.g. Peanut Butter').fill('E2E Tofu');
  await fillNutField(page, 'Kcal', '100');
  await fillNutField(page, 'Protein', '10');
  await fillNutField(page, 'Carbs', '5');
  await fillNutField(page, 'Fat', '5');
  await page.getByRole('button', { name: /Save & Continue/ }).tap();

  // Log 100g → 100 kcal.
  await expect(page.getByText('How much?')).toBeVisible();
  await page.getByRole('spinbutton').fill('100');
  await page.getByRole('button', { name: /Add to day/ }).tap();

  const row = page.locator('.food-row').filter({ hasText: 'E2E Tofu' });
  await expect(row).toContainText('100');

  // Open NewProductForm in edit mode:
  // row → GramsPicker (edit) → pencil → NewProductForm (edit).
  await row.locator('button').filter({ hasText: 'E2E Tofu' }).tap();
  await expect(page.getByText('Edit amount')).toBeVisible();
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await expect(page.getByText('Edit Product', { exact: true })).toBeVisible();

  // Double the kcal. Save closes all modals and reloads entries.
  await fillNutField(page, 'Kcal', '200');
  await page.getByRole('button', { name: /Save changes/ }).tap();

  // The already-logged 100g entry now shows 200 kcal (100g × 200/100).
  // This is the retroactive invariant.
  await expect(row).toContainText('200');

  // Two-tap delete via NewProductForm edit mode:
  // first tap arms (aria-label: "Delete product" → "Confirm delete"), second tap deletes.
  await row.locator('button').filter({ hasText: 'E2E Tofu' }).tap();
  await page.getByRole('button', { name: 'Edit product', exact: true }).tap();
  await page.getByRole('button', { name: 'Delete product' }).tap();
  await page.getByRole('button', { name: 'Confirm delete' }).tap();

  // Product + entry cascade-deleted; row is gone.
  await expect(row).toHaveCount(0);
});
